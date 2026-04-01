import crypto from "node:crypto";
import path from "node:path";
import { CodexRuntimeContext } from "./codexContext";
import { AiLabelingState, ProjectActivity } from "./types";
import { normalizeProjectName } from "./utils";

const DEFAULT_MODEL = "gpt-5.4-nano";
const REQUEST_TIMEOUT_MS = 8000;
const MIN_CLASSIFICATION_INTERVAL_MS = 120_000;
const MAX_CACHE_ENTRIES = 100;
const MAX_WORDS = 6;
const MAX_LABEL_LENGTH = 64;

interface LabelerConfig {
  enabled: boolean;
  model: string;
  apiKey: string;
  geminiApiKey?: string;
  envLoaded: boolean;
  envPath: string | null;
}

interface CachedLabel {
  label: string;
  createdAt: number;
}

interface AiStatusSnapshot {
  state: AiLabelingState;
  message: string;
  model: string | null;
  tokensUsed: number | null;
  envPath: string | null;
}

interface ClassificationInput {
  project: ProjectActivity;
  codexContext: CodexRuntimeContext;
  fallbackLabel: string;
}

interface SanitizedClassificationContext {
  projectName: string;
  repoName: string;
  branchName: string | null;
  changedAreas: string[];
  changedFileGroups: string[];
  recentIntent: string | null;
  fallbackLabel: string;
}

export class OpenAiActivityLabeler {
  private config: LabelerConfig;
  private readonly cache = new Map<string, CachedLabel>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly lastAttemptBySignature = new Map<string, number>();
  private lastRequestAt = 0;
  private lastProjectKey: string | null = null;
  private lastAvailabilityLog = "";
  private lastFallbackReason = "";
  private status: AiStatusSnapshot;
  private tokenDisplayTimer: NodeJS.Timeout | null = null;

  constructor(config: LabelerConfig, private readonly onStateChange: () => void) {
    this.config = normalizeConfig(config);
    this.status = createInitialStatus(this.config);
  }

  updateConfig(config: LabelerConfig): void {
    const nextConfig = normalizeConfig(config);
    const previousLogSignature = this.getAvailabilitySignature();
    this.config = nextConfig;

    if (previousLogSignature !== this.getAvailabilitySignature()) {
      this.lastAvailabilityLog = "";
      this.lastFallbackReason = "";
    }

    this.setStatus(createInitialStatus(this.config));
  }

  logConfiguration(): void {
    const signature = this.getAvailabilitySignature();
    if (signature === this.lastAvailabilityLog) {
      return;
    }

    const model = this.config.model.toLowerCase();
    const isGemini = model.includes("gemini");
    const keyToUse = isGemini ? this.config.geminiApiKey : this.config.apiKey;

    console.log(
      `[ai] labeling=${this.config.enabled ? "enabled" : "disabled"} model=${this.config.model} api_key=${
        keyToUse ? "configured" : "missing"
      } type=${isGemini ? "gemini" : "openai"}`
    );
    this.lastAvailabilityLog = signature;
  }

  getLabel(input: ClassificationInput): string | null {
    const context = buildSanitizedContext(input);
    const signature = hashContext(context);
    const projectKey = normalizeProjectKey(input.project.projectRoot);
    const cached = this.cache.get(signature);

    if (cached) {
      this.setStatus({
        state: "active",
        message: "AI Active",
        model: this.config.model,
        tokensUsed: this.status.tokensUsed,
        envPath: this.config.envPath
      });
      return cached.label;
    }

    if (!this.config.enabled) {
      this.setStatus({
        state: "disabled",
        message: "AI Off",
        model: null,
        tokensUsed: null,
        envPath: this.config.envPath
      });
      return null;
    }

    const model = this.config.model.toLowerCase();
    const isGemini = model.includes("gemini");
    const apiKey = isGemini ? this.config.geminiApiKey : this.config.apiKey;

    if (!apiKey) {
      this.setStatus({
        state: "missing-config",
        message: this.config.envLoaded ? "AI Key Missing" : "Env Not Loaded",
        model: this.config.model,
        tokensUsed: null,
        envPath: this.config.envPath
      });
      this.logFallback(`${isGemini ? "GEMINI" : "OPENAI"}_API_KEY is missing.`);
      return null;
    }

    if (this.status.state !== "active" && this.status.state !== "classifying") {
      this.setStatus({
        state: "ready",
        message: "AI Ready",
        model: this.config.model,
        tokensUsed: this.status.tokensUsed,
        envPath: this.config.envPath
      });
    }

    const projectChanged = this.lastProjectKey !== projectKey;
    const lastAttemptAt = this.lastAttemptBySignature.get(signature) ?? 0;
    const enoughTimePassed = Date.now() - lastAttemptAt >= MIN_CLASSIFICATION_INTERVAL_MS;
    const shouldRequest =
      !this.inFlight.has(signature) &&
      (projectChanged || enoughTimePassed);

    if (shouldRequest) {
      const now = Date.now();
      this.lastRequestAt = Date.now();
      this.lastAttemptBySignature.set(signature, now);
      this.lastProjectKey = projectKey;
      this.setStatus({
        state: "classifying",
        message: "AI Classifying",
        model: this.config.model,
        tokensUsed: this.status.tokensUsed,
        envPath: this.config.envPath
      });
      const request = this.classify(signature, context).finally(() => {
        this.inFlight.delete(signature);
      });
      this.inFlight.set(signature, request);
    }

    return null;
  }

  shouldPreferAiLabels(): boolean {
    const isGemini = this.config.model.toLowerCase().includes("gemini");
    const apiKey = isGemini ? this.config.geminiApiKey : this.config.apiKey;
    return this.config.enabled && Boolean(apiKey);
  }

  getStatus(): AiStatusSnapshot {
    return { ...this.status };
  }

  private async classify(signature: string, context: SanitizedClassificationContext): Promise<void> {
    console.log(
      `[ai] Requesting activity label model=${this.config.model} repo=${context.repoName} branch=${context.branchName ?? "n/a"}`
    );

    try {
      const result = await requestActivityLabel(this.config, context);
      const label = result.label;
      console.log(`[ai] Raw response: ${result.rawLabel ?? "<empty>"}`);
      if (!label) {
        this.logFallback("API response did not return a valid label.");
        return;
      }

      this.cache.set(signature, {
        label,
        createdAt: Date.now()
      });
      trimCache(this.cache);
      this.lastFallbackReason = "";
      this.setStatus({
        state: "active",
        message: result.tokensUsed ? `AI ${result.tokensUsed} Tok` : "AI Active",
        model: this.config.model,
        tokensUsed: result.tokensUsed,
        envPath: this.config.envPath
      });

      if (this.tokenDisplayTimer) {
        clearTimeout(this.tokenDisplayTimer);
      }

      if (result.tokensUsed) {
        this.tokenDisplayTimer = setTimeout(() => {
          this.tokenDisplayTimer = null;
          this.setStatus({
            ...this.status,
            message: "AI Active"
          });
        }, 5000);
      }

      console.log(`[ai] Activity label ready: ${label}`);
      if (result.tokensUsed) {
        console.log(`[ai] Tokens used: ${result.tokensUsed}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus({
        state: "fallback",
        message: "AI Fallback",
        model: this.config.model,
        tokensUsed: this.status.tokensUsed,
        envPath: this.config.envPath
      });
      this.logFallback(message);
    }
  }

  private getAvailabilitySignature(): string {
    const isGemini = this.config.model.toLowerCase().includes("gemini");
    const apiKey = isGemini ? this.config.geminiApiKey : this.config.apiKey;
    return `${this.config.enabled}|${this.config.model}|${Boolean(apiKey)}`;
  }

  private logFallback(reason: string): void {
    if (reason === this.lastFallbackReason) {
      return;
    }

    console.log(`[ai] Fallback heuristic used: ${reason}`);
    this.lastFallbackReason = reason;
  }

  private setStatus(nextStatus: AiStatusSnapshot): void {
    if (
      this.status.state === nextStatus.state &&
      this.status.message === nextStatus.message &&
      this.status.model === nextStatus.model &&
      this.status.tokensUsed === nextStatus.tokensUsed &&
      this.status.envPath === nextStatus.envPath
    ) {
      return;
    }

    this.status = nextStatus;
    this.onStateChange();
  }
}

function createInitialStatus(config: LabelerConfig): AiStatusSnapshot {
  if (!config.enabled) {
    return {
      state: "disabled",
      message: "AI Off",
      model: null,
      tokensUsed: null,
      envPath: config.envPath
    };
  }

  if (!config.apiKey) {
    return {
      state: "missing-config",
      message: config.envLoaded ? "AI Key Missing" : "Env Not Loaded",
      model: config.model,
      tokensUsed: null,
      envPath: config.envPath
    };
  }

  return {
    state: "ready",
    message: "AI Ready",
    model: config.model,
    tokensUsed: null,
    envPath: config.envPath
  };
}

function normalizeConfig(config: LabelerConfig): LabelerConfig {
  return {
    enabled: Boolean(config.enabled),
    model: config.model?.trim() || DEFAULT_MODEL,
    apiKey: config.apiKey?.trim() ?? "",
    geminiApiKey: config.geminiApiKey?.trim() ?? "",
    envLoaded: Boolean(config.envLoaded),
    envPath: config.envPath ?? null
  };
}

function buildSanitizedContext(input: ClassificationInput): SanitizedClassificationContext {
  const repoName = normalizeProjectName(path.basename(input.project.repoRoot ?? input.project.projectRoot));
  const projectName = normalizeProjectName(input.project.projectName) || repoName || "Project";
  const changedAreas = collectChangedAreas(input.project);
  const changedFileGroups = collectChangedFileGroups(input.project.recentPaths);
  const recentIntent = sanitizeIntent(input.codexContext.activity);

  return {
    projectName,
    repoName: repoName || projectName,
    branchName: sanitizeBranchName(input.project.branch),
    changedAreas,
    changedFileGroups,
    recentIntent,
    fallbackLabel: normalizeLabel(input.fallbackLabel) ?? "In Progress"
  };
}

function collectChangedAreas(project: ProjectActivity): string[] {
  const baseDirectory = project.repoRoot ?? project.projectRoot;
  const uniqueAreas = new Set<string>();

  for (const recentPath of project.recentPaths) {
    const relativePath = path.relative(baseDirectory, recentPath);
    if (!relativePath || relativePath.startsWith("..")) {
      continue;
    }

    const normalized = relativePath.replace(/\\/g, "/");
    const firstSegment = normalized.split("/").find(Boolean) ?? "";
    const candidate = path.parse(firstSegment).name || firstSegment;
    const normalizedArea = normalizeProjectName(candidate.replace(/\.[^.]+$/, ""));
    if (!normalizedArea) {
      continue;
    }

    uniqueAreas.add(normalizedArea);
    if (uniqueAreas.size >= 4) {
      break;
    }
  }

  return Array.from(uniqueAreas);
}

function collectChangedFileGroups(recentPaths: string[]): string[] {
  const groups = new Set<string>();

  for (const recentPath of recentPaths) {
    const normalized = recentPath.toLowerCase().replace(/\\/g, "/");

    if (matchesAny(normalized, ["components", "ui", "pages", "styles", ".css", ".scss", ".tsx", ".jsx", ".html", ".svg"])) {
      groups.add("UI");
    }

    if (matchesAny(normalized, ["api", "server", "routes", "controllers", "services", "db", "database", "migration", ".sql"])) {
      groups.add("Backend");
    }

    if (matchesAny(normalized, ["test", "tests", "spec", ".test.", ".spec."])) {
      groups.add("Testing");
    }

    if (matchesAny(normalized, ["docs", "readme", ".md"])) {
      groups.add("Documentation");
    }

    if (
      matchesAny(normalized, [
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        ".env",
        "config",
        "scripts",
        "build"
      ])
    ) {
      groups.add("Setup");
    }

    if (groups.size >= 4) {
      break;
    }
  }

  return Array.from(groups);
}

async function requestActivityLabel(
  config: LabelerConfig,
  context: SanitizedClassificationContext
): Promise<{ label: string | null; rawLabel: string | null; tokensUsed: number | null }> {
  const model = config.model.toLowerCase();
  const isGemini = model.includes("gemini");

  if (isGemini) {
    return requestGeminiActivityLabel(config, context);
  }

  return requestOpenAiActivityLabel(config, context);
}

async function requestOpenAiActivityLabel(
  config: LabelerConfig,
  context: SanitizedClassificationContext
): Promise<{ label: string | null; rawLabel: string | null; tokensUsed: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        reasoning: {
          effort: "low"
        },
        instructions:
          "You convert sanitized local coding context into a concise professional Discord Rich Presence activity label for the user. Prefer a project-specific label over a generic category whenever the context supports it. Use the fallback label only when the evidence is weak. Return only the label in title case, ideally 2 to 6 words, with no sentence, quotes, punctuation, emojis, or explanation. Never mention Codex, assistant, agent, AI, ChatGPT, OpenAI, prompts, chats, or that anyone is working on something. Do not repeat the project name, repo name, or branch name in the label.",
        input: `Sanitized work context:\n${JSON.stringify(context, null, 2)}`
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API ${response.status}: ${truncateError(errorText)}`);
    }

    const payload = (await response.json()) as {
      output_text?: unknown;
      usage?: {
        total_tokens?: unknown;
      };
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
    };

    const outputText = extractOutputText(payload);
    return {
      rawLabel: outputText,
      label: normalizeLabel(outputText, context),
      tokensUsed: typeof payload.usage?.total_tokens === "number" ? payload.usage.total_tokens : null
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestGeminiActivityLabel(
  config: LabelerConfig,
  context: SanitizedClassificationContext
): Promise<{ label: string | null; rawLabel: string | null; tokensUsed: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const apiKey = config.geminiApiKey || config.apiKey;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`;

    const prompt = `You convert sanitized local coding context into a concise professional Discord Rich Presence activity label for the user.
Prefer a project-specific label over a generic category whenever the context supports it. Use the fallback label only when the evidence is weak.
Return only the label in title case, ideally 2 to 6 words, with no sentence, quotes, punctuation, emojis, or explanation.
Never mention Codex, assistant, agent, AI, Gemini, Google, prompts, chats, or that anyone is working on something.
Do not repeat the project name, repo name, or branch name in the label.

Sanitized work context:
${JSON.stringify(context, null, 2)}`;

    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 100
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API ${response.status}: ${truncateError(errorText)}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
      usageMetadata?: {
        totalTokenCount?: number;
      };
    };

    const outputText = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    return {
      rawLabel: outputText,
      label: normalizeLabel(outputText, context),
      tokensUsed: payload.usageMetadata?.totalTokenCount ?? null
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractOutputText(payload: {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }

  return null;
}

function normalizeLabel(
  value: string | null | undefined,
  context?: Pick<SanitizedClassificationContext, "projectName" | "repoName" | "branchName">
): string | null {
  if (!value) {
    return null;
  }

  const condensed = value
    .replace(/["'`]/g, " ")
    .replace(/[.!?,:;()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!condensed) {
    return null;
  }

  const words = condensed.split(" ").filter(Boolean);
  if (words.length < 1) {
    return null;
  }

  const limitedWords = words.slice(0, MAX_WORDS);
  const label = limitedWords
    .map((word) => {
      const cleaned = word.replace(/[^A-Za-z0-9+#&/-]/g, "");
      return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : "";
    })
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_LABEL_LENGTH)
    .trim();

  if (!label || isDisallowedLabel(label, context)) {
    return null;
  }

  return label;
}

function sanitizeIntent(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const sanitized = value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[path]")
    .replace(/\/[^\s]+/g, (match) => (match.includes("/") && match.length > 3 ? "[path]" : match))
    .replace(/["'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) {
    return null;
  }

  const words = sanitized.split(" ").slice(0, 10).join(" ");
  return words.slice(0, 80).trim() || null;
}

function sanitizeBranchName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const sanitized = value.replace(/[^A-Za-z0-9/_-]/g, "").trim();
  return sanitized ? sanitized.slice(0, 60) : null;
}

function matchesAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

function hashContext(context: SanitizedClassificationContext): string {
  return crypto.createHash("sha1").update(JSON.stringify(context)).digest("hex");
}

function normalizeProjectKey(projectRoot: string): string {
  return path.resolve(projectRoot).toLowerCase();
}

function truncateError(value: string): string {
  const condensed = value.replace(/\s+/g, " ").trim();
  if (condensed.length <= 160) {
    return condensed;
  }

  return `${condensed.slice(0, 157).trimEnd()}...`;
}

function trimCache(cache: Map<string, CachedLabel>): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestEntry = cache.entries().next().value;
    if (!oldestEntry) {
      return;
    }

    cache.delete(oldestEntry[0]);
  }
}

function isDisallowedLabel(
  value: string,
  context?: Pick<SanitizedClassificationContext, "projectName" | "repoName" | "branchName">
): boolean {
  if (/\b(codex|assistant|agent|openai|chatgpt|prompt|chat)\b/i.test(value) || /\bworking on\b/i.test(value)) {
    return true;
  }

  const bannedPhrases = new Set<string>();
  for (const candidate of [context?.projectName, context?.repoName, context?.branchName]) {
    for (const normalized of tokenizeComparableTerms(candidate)) {
      bannedPhrases.add(normalized);
    }
  }

  if (bannedPhrases.size === 0) {
    return false;
  }

  const comparableLabel = normalizeComparableValue(value);
  for (const bannedPhrase of bannedPhrases) {
    if (bannedPhrase.length < 4) {
      continue;
    }

    if (comparableLabel.includes(bannedPhrase)) {
      return true;
    }
  }

  return false;
}

function tokenizeComparableTerms(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const normalized = normalizeComparableValue(value);
  if (!normalized) {
    return [];
  }

  const phrases = [normalized];
  phrases.push(...normalized.split(" ").filter(Boolean));
  return Array.from(new Set(phrases));
}

function normalizeComparableValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
