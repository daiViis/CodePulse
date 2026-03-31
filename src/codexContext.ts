import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROCESS_CACHE_MS = 5000;
const SESSION_CACHE_MS = 5000;
const SESSION_HEAD_BYTES = 65536;
const SESSION_INDEX_TAIL_BYTES = 131072;
const SESSION_INDEX_TAIL_LINES = 400;
const HISTORY_TAIL_BYTES = 131072;
const HISTORY_TAIL_LINES = 300;
const MAX_ACTIVITY_LENGTH = 120;

type CodexSource = "codex-session" | "codex-process" | "codex-artifact";

export interface CodexRuntimeContext {
  source: CodexSource | null;
  processDetected: boolean;
  processCount: number;
  processNames: string[];
  sessionDetected: boolean;
  sessionId: string | null;
  sessionTitle: string | null;
  workingDirectory: string | null;
  sessionStartedAt: number | null;
  sessionUpdatedAt: number | null;
  activity: string | null;
}

interface CodexProcess {
  processName: string;
  startedAt: number | null;
}

interface SessionArtifact {
  sessionId: string;
  sessionTitle: string | null;
  workingDirectory: string | null;
  sessionStartedAt: number | null;
  sessionUpdatedAt: number;
  recentPrompt: string | null;
}

interface Cache<T> {
  value: T;
  loadedAt: number;
}

export class CodexContextDetector {
  private readonly codexRoot: string;
  private processCache: Cache<CodexProcess[]> | null = null;
  private latestSessionCache: Cache<SessionArtifact | null> | null = null;

  constructor(codexRoot = path.join(os.homedir(), ".codex")) {
    this.codexRoot = codexRoot;
  }

  detect(now: number, inactivityTimeoutMs: number): CodexRuntimeContext {
    const processes = this.readProcesses(now);
    const processDetected = processes.length > 0;
    const newestProcessStartedAt = processes
      .map((process) => process.startedAt ?? 0)
      .reduce((max, current) => Math.max(max, current), 0);

    const latestSession = this.readLatestSession(now);
    const sessionFresh = Boolean(
      latestSession && now - latestSession.sessionUpdatedAt <= Math.max(inactivityTimeoutMs, 30_000)
    );
    const sessionLikelyMatchesProcess = Boolean(
      latestSession &&
        newestProcessStartedAt > 0 &&
        latestSession.sessionUpdatedAt >= newestProcessStartedAt - 120_000
    );
    const sessionDetected = Boolean(latestSession);

    let source: CodexSource | null = null;
    if (processDetected && sessionFresh) {
      source = "codex-session";
    } else if (processDetected) {
      source = "codex-process";
    } else if (sessionFresh) {
      source = "codex-artifact";
    }

    const canUseSessionSignals = Boolean(
      latestSession && (sessionFresh || (!processDetected || sessionLikelyMatchesProcess))
    );
    const activity = canUseSessionSignals
      ? pickActivity(latestSession?.recentPrompt ?? null, latestSession?.sessionTitle ?? null)
      : null;

    return {
      source,
      processDetected,
      processCount: processes.length,
      processNames: processes.map((process) => process.processName),
      sessionDetected,
      sessionId: latestSession?.sessionId ?? null,
      sessionTitle: latestSession?.sessionTitle ?? null,
      workingDirectory: canUseSessionSignals ? latestSession?.workingDirectory ?? null : null,
      sessionStartedAt: latestSession?.sessionStartedAt ?? null,
      sessionUpdatedAt: latestSession?.sessionUpdatedAt ?? null,
      activity
    };
  }

  private readProcesses(now: number): CodexProcess[] {
    if (this.processCache && now - this.processCache.loadedAt <= PROCESS_CACHE_MS) {
      return this.processCache.value;
    }

    const command =
      "Get-Process | Where-Object { $_.ProcessName -match 'codex' } | Select-Object ProcessName, StartTime | ConvertTo-Json -Compress";

    const parsed = this.runPowerShellJson(command);
    const processRows = toArray(parsed).map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const processName =
        typeof (entry as { ProcessName?: unknown }).ProcessName === "string"
          ? ((entry as { ProcessName: string }).ProcessName ?? "").trim()
          : "";

      if (!processName) {
        return null;
      }

      return {
        processName,
        startedAt: parseTimestamp((entry as { StartTime?: unknown }).StartTime)
      } satisfies CodexProcess;
    });

    const processes = processRows.filter((entry): entry is CodexProcess => Boolean(entry));
    this.processCache = {
      value: processes,
      loadedAt: now
    };

    return processes;
  }

  private readLatestSession(now: number): SessionArtifact | null {
    if (this.latestSessionCache && now - this.latestSessionCache.loadedAt <= SESSION_CACHE_MS) {
      return this.latestSessionCache.value;
    }

    const sessionFile = findLatestSessionFile(path.join(this.codexRoot, "sessions"));
    if (!sessionFile) {
      this.latestSessionCache = {
        value: null,
        loadedAt: now
      };
      return null;
    }

    const meta = readSessionMeta(sessionFile);
    if (!meta?.sessionId) {
      this.latestSessionCache = {
        value: null,
        loadedAt: now
      };
      return null;
    }

    const sessionUpdatedAt = safeMtime(sessionFile) ?? now;
    const sessionTitle = this.lookupSessionTitle(meta.sessionId);
    const recentPrompt = this.lookupRecentPrompt(meta.sessionId);

    const artifact: SessionArtifact = {
      sessionId: meta.sessionId,
      sessionTitle,
      workingDirectory: meta.workingDirectory,
      sessionStartedAt: meta.sessionStartedAt,
      sessionUpdatedAt,
      recentPrompt
    };

    this.latestSessionCache = {
      value: artifact,
      loadedAt: now
    };

    return artifact;
  }

  private lookupSessionTitle(sessionId: string): string | null {
    const sessionIndexPath = path.join(this.codexRoot, "session_index.jsonl");
    const rows = readTailJsonl(sessionIndexPath, SESSION_INDEX_TAIL_BYTES, SESSION_INDEX_TAIL_LINES);

    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (!row || typeof row !== "object") {
        continue;
      }

      const candidateId = typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id : "";
      if (candidateId !== sessionId) {
        continue;
      }

      const threadName =
        typeof (row as { thread_name?: unknown }).thread_name === "string"
          ? (row as { thread_name: string }).thread_name.trim()
          : "";

      return threadName || null;
    }

    return null;
  }

  private lookupRecentPrompt(sessionId: string): string | null {
    const historyPath = path.join(this.codexRoot, "history.jsonl");
    const rows = readTailJsonl(historyPath, HISTORY_TAIL_BYTES, HISTORY_TAIL_LINES);

    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (!row || typeof row !== "object") {
        continue;
      }

      const candidateSessionId =
        typeof (row as { session_id?: unknown }).session_id === "string"
          ? (row as { session_id: string }).session_id
          : "";
      if (candidateSessionId !== sessionId) {
        continue;
      }

      const text = typeof (row as { text?: unknown }).text === "string" ? (row as { text: string }).text : "";
      const normalized = normalizeActivityText(text);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private runPowerShellJson(command: string): unknown {
    try {
      const output = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 2500
        }
      ).trim();

      if (!output) {
        return null;
      }

      return JSON.parse(output);
    } catch {
      return null;
    }
  }
}

function pickActivity(recentPrompt: string | null, sessionTitle: string | null): string | null {
  const prompt = normalizeActivityText(recentPrompt);
  if (prompt && prompt.length <= 90) {
    return prompt;
  }

  const title = normalizeActivityText(sessionTitle);
  if (title) {
    return title;
  }

  return prompt;
}

function normalizeActivityText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const condensed = value.replace(/\s+/g, " ").trim();
  if (!condensed || isLowSignalText(condensed)) {
    return null;
  }

  const firstSentence = condensed.split(/[.!?](?:\s|$)/, 1)[0]?.trim() ?? condensed;
  const preferred = firstSentence || condensed;

  if (preferred.length <= MAX_ACTIVITY_LENGTH) {
    return preferred;
  }

  return `${preferred.slice(0, MAX_ACTIVITY_LENGTH - 3).trimEnd()}...`;
}

function isLowSignalText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (/^https?:\/\//.test(normalized)) {
    return true;
  }

  const lowSignalPatterns = [
    /^what next$/,
    /^how$/,
    /^what are you currently working on$/,
    /^run .*auth$/,
    /^open .*auth setup$/,
    /^codex app$/
  ];

  return lowSignalPatterns.some((pattern) => pattern.test(normalized));
}

function readSessionMeta(filePath: string): {
  sessionId: string;
  workingDirectory: string | null;
  sessionStartedAt: number | null;
} | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const fileSize = fs.statSync(filePath).size;
  const bytesToRead = Math.min(fileSize, SESSION_HEAD_BYTES);
  const buffer = Buffer.alloc(bytesToRead);
  const fileDescriptor = fs.openSync(filePath, "r");

  try {
    fs.readSync(fileDescriptor, buffer, 0, bytesToRead, 0);
  } finally {
    fs.closeSync(fileDescriptor);
  }

  const rawText = buffer.toString("utf8");
  const firstLine = rawText.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!firstLine) {
    return null;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const payload = (parsed as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const sessionId = typeof (payload as { id?: unknown }).id === "string" ? (payload as { id: string }).id : "";
  if (!sessionId) {
    return null;
  }

  const workingDirectory =
    typeof (payload as { cwd?: unknown }).cwd === "string" ? (payload as { cwd: string }).cwd.trim() : "";
  const sessionStartedAt = parseTimestamp((payload as { timestamp?: unknown }).timestamp);

  return {
    sessionId,
    workingDirectory: workingDirectory || null,
    sessionStartedAt
  };
}

function readTailJsonl(filePath: string, maxBytes: number, maxLines: number): unknown[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const fileSize = fs.statSync(filePath).size;
  if (fileSize <= 0) {
    return [];
  }

  const bytesToRead = Math.min(fileSize, maxBytes);
  const start = Math.max(0, fileSize - bytesToRead);
  const buffer = Buffer.alloc(bytesToRead);
  const fileDescriptor = fs.openSync(filePath, "r");

  try {
    fs.readSync(fileDescriptor, buffer, 0, bytesToRead, start);
  } finally {
    fs.closeSync(fileDescriptor);
  }

  let text = buffer.toString("utf8");
  if (start > 0) {
    const firstNewLine = text.indexOf("\n");
    if (firstNewLine >= 0) {
      text = text.slice(firstNewLine + 1);
    } else {
      text = "";
    }
  }

  if (!text.trim()) {
    return [];
  }

  const parsed: unknown[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const selectedLines = lines.slice(-maxLines);

  for (const line of selectedLines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // Ignore malformed lines and continue parsing the rest.
    }
  }

  return parsed;
}

function findLatestSessionFile(sessionsRoot: string): string | null {
  if (!fs.existsSync(sessionsRoot)) {
    return null;
  }

  const stack = [sessionsRoot];
  let latestPath: string | null = null;
  let latestMtime = -1;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      const mtime = safeMtime(fullPath);
      if (mtime === null || mtime < latestMtime) {
        continue;
      }

      latestMtime = mtime;
      latestPath = fullPath;
    }
  }

  return latestPath;
}

function safeMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const dotNetDateMatch = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(value);
  if (dotNetDateMatch) {
    const numeric = Number(dotNetDateMatch[1]);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toArray(value: unknown): unknown[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
