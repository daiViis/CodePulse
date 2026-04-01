import fs from "node:fs";
import path from "node:path";
import { CodexContextDetector, CodexRuntimeContext } from "./codexContext";
import { DiscordIpcClient } from "./discordIpc";
import { readBranchName, readGitDiffStats } from "./git";
import { OpenAiActivityLabeler } from "./openAiActivityLabeler";
import { derivePhaseWithSource } from "./phase";
import { renderPresenceTemplate } from "./presenceTemplates";
import {
  deriveProjectName,
  isIgnoredPath,
  resolveProjectContext,
  resolveProjectContextFromDirectory
} from "./projectResolver";
import {
  ActivitySource,
  LoadedConfig,
  PresenceState,
  ProjectActivity,
  ProjectSource,
  SessionState,
  WatcherSnapshot
} from "./types";
import { dedupeRecentPaths, formatDuration, normalizePathCase, truncate } from "./utils";
import { createDefaultWatcherSnapshot } from "./watcherSnapshot";

const ACTIVITY_REFRESH_DELAY_MS = 750;
type WatcherSnapshotListener = (snapshot: WatcherSnapshot) => void;

const DEFAULT_DETAILS_TEMPLATE = "{username} is working on {project}";
const DEFAULT_STATE_TEMPLATE = "{phase}";

interface ProjectSelection {
  activeProject: ProjectActivity | null;
  projectSource: ProjectSource | null;
}

interface ActivitySelection {
  value: string;
  source: ActivitySource;
}

export class PresenceWatcherApp {
  private readonly discord: DiscordIpcClient;
  private readonly codexContextDetector = new CodexContextDetector();
  private readonly activityLabeler: OpenAiActivityLabeler;
  private readonly projectActivity = new Map<string, ProjectActivity>();
  private readonly rootWatchers: fs.FSWatcher[] = [];
  private readonly snapshotListeners = new Set<WatcherSnapshotListener>();
  private session: SessionState | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private activityRefreshTimer: NodeJS.Timeout | null = null;
  private tickInFlight = false;
  private tickQueued = false;
  private currentSnapshot: WatcherSnapshot = createDefaultWatcherSnapshot();
  private readonly appStartedAt = Date.now();
  private lastEditedFileName: string | null = null;

  constructor(private config: LoadedConfig) {
    this.discord = new DiscordIpcClient(config.discordClientId);
    this.activityLabeler = new OpenAiActivityLabeler(
      {
        enabled: config.aiLabelingEnabled,
        model: config.openAiModel,
        apiKey: config.openAiApiKey,
        geminiApiKey: config.geminiApiKey,
        envLoaded: config.openAiEnvLoaded,
        envPath: config.openAiEnvPath
      },
      () => {
        this.scheduleActivityRefresh();
      }
    );
  }

  getSnapshot(): WatcherSnapshot {
    return { ...this.currentSnapshot };
  }

  subscribe(listener: WatcherSnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    listener(this.getSnapshot());

    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    this.publishSnapshot({
      ...this.currentSnapshot,
      watcherState: "starting",
      watcherMessage: `Starting watcher for ${this.config.workspaceRoots.length} workspace root(s).`,
      updatedAt: Date.now(),
      errorMessage: undefined
    });

    this.startWorkspaceWatchers();
    console.log(`[watcher] Monitoring ${this.config.workspaceRoots.length} workspace root(s).`);
    this.activityLabeler.logConfiguration();
    for (const root of this.config.workspaceRoots) {
      console.log(`[watcher] Root: ${root}`);
    }

    this.publishSnapshot({
      ...this.currentSnapshot,
      watcherState: "running",
      watcherMessage: `Watching ${this.config.workspaceRoots.length} workspace root(s).`,
      updatedAt: Date.now(),
      errorMessage: undefined
    });

    await this.runTick();
    this.pollTimer = setInterval(() => {
      void this.runTick();
    }, this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.activityRefreshTimer) {
      clearTimeout(this.activityRefreshTimer);
      this.activityRefreshTimer = null;
    }

    for (const watcher of this.rootWatchers) {
      watcher.close();
    }

    this.rootWatchers.length = 0;
    this.discord.close();
    this.publishSnapshot({
      ...this.currentSnapshot,
      watcherState: "stopped",
      status: this.currentSnapshot.errorMessage ? "error" : "idle",
      watcherMessage: "Watcher stopped.",
      discordState: "disconnected",
      updatedAt: Date.now()
    });
  }

  async applyConfig(nextConfig: LoadedConfig): Promise<void> {
    const workspaceRootsChanged = !sameWorkspaceRoots(this.config.workspaceRoots, nextConfig.workspaceRoots);
    const pollIntervalChanged = this.config.pollIntervalMs !== nextConfig.pollIntervalMs;

    this.config = nextConfig;
    this.activityLabeler.updateConfig({
      enabled: nextConfig.aiLabelingEnabled,
      model: nextConfig.openAiModel,
      apiKey: nextConfig.openAiApiKey,
      geminiApiKey: nextConfig.geminiApiKey,
      envLoaded: nextConfig.openAiEnvLoaded,
      envPath: nextConfig.openAiEnvPath
    });
    this.activityLabeler.logConfiguration();

    if (workspaceRootsChanged) {
      this.stopWorkspaceWatchers();
      this.startWorkspaceWatchers();
    }

    if (pollIntervalChanged && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => {
        void this.runTick();
      }, this.config.pollIntervalMs);
    }

    await this.runTick();
  }

  private startWorkspaceWatchers(): void {
    for (const workspaceRoot of this.config.workspaceRoots) {
      try {
        const watcher = fs.watch(workspaceRoot, { recursive: true }, (_eventType, filename) => {
          if (!filename) {
            return;
          }

          const relativePath = filename.toString();
          const absolutePath = path.resolve(workspaceRoot, relativePath);
          this.recordActivity(absolutePath);
        });

        watcher.on("error", (error) => {
          console.log(`[watcher] File watch error for ${workspaceRoot}: ${error.message}`);
        });

        this.rootWatchers.push(watcher);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[watcher] Unable to watch ${workspaceRoot}: ${message}`);
      }
    }
  }

  private stopWorkspaceWatchers(): void {
    for (const watcher of this.rootWatchers) {
      watcher.close();
    }

    this.rootWatchers.length = 0;
  }

  private recordActivity(absolutePath: string): void {
    if (isIgnoredPath(absolutePath, this.config.appRoot)) {
      return;
    }

    const context = resolveProjectContext(absolutePath, this.config.workspaceRoots, this.config.appRoot);
    if (!context || !fs.existsSync(context.projectRoot)) {
      return;
    }

    this.lastEditedFileName = path.basename(absolutePath);
    const key = normalizePathCase(context.projectRoot);
    const current = this.projectActivity.get(key);
    const branch = context.repoRoot ? readBranchName(context.repoRoot) : null;
    const now = Date.now();

    const next: ProjectActivity = {
      workspaceRoot: context.workspaceRoot,
      projectRoot: context.projectRoot,
      projectName: deriveProjectName(context.projectRoot),
      repoRoot: context.repoRoot,
      branch,
      lastActivityAt: now,
      recentPaths: dedupeRecentPaths(current?.recentPaths ?? [], absolutePath, 5)
    };

    this.projectActivity.set(key, next);
    this.scheduleActivityRefresh();
  }

  private scheduleActivityRefresh(): void {
    if (this.activityRefreshTimer) {
      clearTimeout(this.activityRefreshTimer);
    }

    this.activityRefreshTimer = setTimeout(() => {
      this.activityRefreshTimer = null;
      void this.runTick();
    }, ACTIVITY_REFRESH_DELAY_MS);
  }

  private async runTick(): Promise<void> {
    if (this.tickInFlight) {
      this.tickQueued = true;
      return;
    }

    this.tickInFlight = true;

    try {
      do {
        this.tickQueued = false;
        await this.tick();
      } while (this.tickQueued);
    } finally {
      this.tickInFlight = false;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    this.pruneStaleProjects(now);

    const codexContext = this.codexContextDetector.detect(now, this.config.inactivityTimeoutMs);
    const projectSelection = this.pickActiveProject(now, codexContext);
    const presence = this.buildPresence(projectSelection, codexContext, now);
    const discordConnected = await this.discord.setPresence(presence);

    this.publishSnapshot(
      this.buildSnapshot(projectSelection.activeProject, presence, discordConnected, codexContext.cliTool, now)
    );
    this.logDetection(projectSelection.activeProject, codexContext);
    this.logStatus(presence, now);
  }

  private pruneStaleProjects(now: number): void {
    const threshold = now - this.config.inactivityTimeoutMs * 3;

    for (const [key, activity] of this.projectActivity.entries()) {
      if (activity.lastActivityAt < threshold) {
        this.projectActivity.delete(key);
      }
    }
  }

  private pickActiveProject(now: number, codexContext: CodexRuntimeContext): ProjectSelection {
    const codexProject = this.pickCodexProject(now, codexContext);
    if (codexProject && codexContext.source) {
      return {
        activeProject: codexProject,
        projectSource: codexContext.source
      };
    }

    const fileProject = this.pickRecentFileProject(now);
    if (fileProject) {
      return {
        activeProject: fileProject,
        projectSource: "file-heuristic"
      };
    }

    return {
      activeProject: null,
      projectSource: null
    };
  }

  private pickCodexProject(now: number, codexContext: CodexRuntimeContext): ProjectActivity | null {
    if (!codexContext.source || !codexContext.workingDirectory) {
      return null;
    }

    const workingDirectory = path.resolve(codexContext.workingDirectory);
    if (!fs.existsSync(workingDirectory)) {
      return null;
    }

    const fromWorkspace = resolveProjectContext(workingDirectory, this.config.workspaceRoots, this.config.appRoot);
    const context = fromWorkspace ?? resolveProjectContextFromDirectory(workingDirectory, this.config.appRoot);
    if (!context || !fs.existsSync(context.projectRoot)) {
      return null;
    }

    const key = normalizePathCase(context.projectRoot);
    const current = this.projectActivity.get(key);
    const branch = context.repoRoot ? readBranchName(context.repoRoot) : current?.branch ?? null;
    const lastActivityAt = Math.max(current?.lastActivityAt ?? 0, codexContext.sessionUpdatedAt ?? now);

    const next: ProjectActivity = {
      workspaceRoot: context.workspaceRoot,
      projectRoot: context.projectRoot,
      projectName: deriveProjectName(context.projectRoot),
      repoRoot: context.repoRoot,
      branch,
      lastActivityAt,
      recentPaths: dedupeRecentPaths(current?.recentPaths ?? [], workingDirectory, 5)
    };

    this.projectActivity.set(key, next);
    return next;
  }

  private pickRecentFileProject(now: number): ProjectActivity | null {
    const threshold = now - this.config.inactivityTimeoutMs;
    let candidate: ProjectActivity | null = null;

    for (const activity of this.projectActivity.values()) {
      if (activity.lastActivityAt < threshold) {
        continue;
      }

      if (activity.repoRoot) {
        activity.branch = readBranchName(activity.repoRoot);
      }

      if (!candidate || activity.lastActivityAt > candidate.lastActivityAt) {
        candidate = activity;
      }
    }

    return candidate;
  }

  private buildPresence(projectSelection: ProjectSelection, codexContext: CodexRuntimeContext, now: number): PresenceState {
    const activeProject = projectSelection.activeProject;
    const projectSource = projectSelection.projectSource;

    if (!activeProject || !projectSource) {
      this.session = null;
      return {
        details: "Working",
        state: "Idle"
      };
    }

    const activity = this.resolveActivity(activeProject, projectSource, codexContext);
    const isProjectChanged =
      !this.session || normalizePathCase(this.session.projectRoot) !== normalizePathCase(activeProject.projectRoot);
    const isCodexSessionChanged =
      Boolean(codexContext.sessionId) && this.session?.sessionId !== codexContext.sessionId;

    if (isProjectChanged || isCodexSessionChanged) {
      this.session = {
        projectRoot: activeProject.projectRoot,
        projectName: activeProject.projectName,
        phase: activity.value,
        activitySource: activity.source,
        projectSource,
        sessionId: codexContext.sessionId,
        startedAt: this.resolveSessionStart(activeProject, codexContext, now),
        lastActivityAt: Math.max(activeProject.lastActivityAt, codexContext.sessionUpdatedAt ?? 0)
      };
    } else if (this.session) {
      this.session.projectName = activeProject.projectName;
      this.session.phase = activity.value;
      this.session.activitySource = activity.source;
      this.session.projectSource = projectSource;
      this.session.sessionId = codexContext.sessionId ?? this.session.sessionId;
      this.session.lastActivityAt = Math.max(this.session.lastActivityAt, activeProject.lastActivityAt, codexContext.sessionUpdatedAt ?? 0);
    }

    const session = this.session;
    if (!session) {
      return {
        details: "Working",
        state: "Idle"
      };
    }

    const context = {
      username: this.config.username,
      project: session.projectName,
      phase: session.phase,
      file: this.lastEditedFileName ?? "none"
    };

    return {
      details: renderPresenceTemplate(this.config.detailsTemplate, DEFAULT_DETAILS_TEMPLATE, context),
      state: renderPresenceTemplate(this.config.stateTemplate, DEFAULT_STATE_TEMPLATE, context),
      startTimestamp: this.config.showElapsedTime ? session.startedAt : undefined
    };
  }

  private resolveActivity(
    activeProject: ProjectActivity,
    projectSource: ProjectSource,
    codexContext: CodexRuntimeContext
  ): ActivitySelection {
    const derived = derivePhaseWithSource(activeProject.branch, activeProject.recentPaths, activeProject.projectName);
    const heuristicSource: ActivitySource =
      derived.source === "git" ? "git" : derived.source === "file-heuristic" ? "file-heuristic" : "generic";
    const aiLabel = this.activityLabeler.getLabel({
      project: activeProject,
      codexContext,
      fallbackLabel: derived.phase
    });

    if (aiLabel) {
      return {
        value: aiLabel,
        source: "openai"
      };
    }

    if (this.activityLabeler.shouldPreferAiLabels()) {
      const aiStatus = this.activityLabeler.getStatus();
      const sameProjectAsSession =
        this.session && normalizePathCase(this.session.projectRoot) === normalizePathCase(activeProject.projectRoot);

      if (sameProjectAsSession && this.session?.activitySource === "openai") {
        return {
          value: this.session.phase,
          source: "openai"
        };
      }

      if (aiStatus.state === "classifying" || aiStatus.state === "ready") {
        return {
          value: "Analyzing Activity",
          source: "openai"
        };
      }

      return {
        value: derived.phase,
        source: heuristicSource
      };
    }

    return {
      value: derived.phase,
      source: heuristicSource
    };
  }

  private resolveSessionStart(activeProject: ProjectActivity, codexContext: CodexRuntimeContext, now: number): number {
    const candidates = [activeProject.lastActivityAt];
    if (codexContext.sessionStartedAt) {
      candidates.push(codexContext.sessionStartedAt);
    }

    const earliestCandidate = Math.min(...candidates.filter((value) => Number.isFinite(value) && value > 0));
    if (!Number.isFinite(earliestCandidate)) {
      return now;
    }

    // Ensure the session start is NOT earlier than when the CodePulse app was started.
    return Math.max(Math.min(now, earliestCandidate), this.appStartedAt);
  }

  private buildSnapshot(
    activeProject: ProjectActivity | null,
    presence: PresenceState,
    discordConnected: boolean,
    cliTool: "Codex" | "Gemini" | null,
    now: number
  ): WatcherSnapshot {
    const aiStatus = this.activityLabeler.getStatus();
    const diffStats = activeProject?.repoRoot ? readGitDiffStats(activeProject.repoRoot) : null;

    if (!this.session || !activeProject) {
      return {
        ...this.currentSnapshot,
        watcherState: "running",
        status: "idle",
        projectName: null,
        phase: null,
        lastFile: this.lastEditedFileName,
        diffStats,
        activitySource: null,
        projectSource: null,
        sessionStartedAt: null,
        sessionElapsedMs: 0,
        lastActivityAt: null,
        branch: null,
        watcherMessage: "Waiting for coding activity in the configured workspace roots.",
        discordState: discordConnected ? "connected" : "disconnected",
        cliTool,
        aiState: aiStatus.state,
        aiMessage: aiStatus.message,
        aiModel: aiStatus.model,
        aiTokensUsed: aiStatus.tokensUsed,
        aiEnvPath: aiStatus.envPath,
        updatedAt: now,
        errorMessage: undefined
      };
    }

    return {
      ...this.currentSnapshot,
      watcherState: "running",
      status: "working",
      projectName: this.session.projectName,
      phase: this.session.phase,
      lastFile: this.lastEditedFileName,
      diffStats,
      activitySource: this.session.activitySource,
      projectSource: this.session.projectSource,
      sessionStartedAt: this.config.showElapsedTime ? this.session.startedAt : null,
      sessionElapsedMs: this.config.showElapsedTime ? Math.max(0, now - this.session.startedAt) : 0,
      lastActivityAt: this.session.lastActivityAt,
      branch: activeProject.branch,
      watcherMessage: `Watching ${this.config.workspaceRoots.length} workspace root(s).`,
      discordState: discordConnected ? "connected" : "disconnected",
      cliTool,
      aiState: aiStatus.state,
      aiMessage: aiStatus.message,
      aiModel: aiStatus.model,
      aiTokensUsed: aiStatus.tokensUsed,
      aiEnvPath: aiStatus.envPath,
      updatedAt: now,
      errorMessage: undefined
    };
  }

  private logStatus(presence: PresenceState, now: number): void {
    if (!this.session) {
      console.log(`[status] ${presence.state}`);
      return;
    }

    const duration = formatDuration(now - this.session.startedAt);
    console.log(
      `[status] ${this.session.projectName} | ${truncate(this.session.phase, 72)} | ${duration}${this.projectBranchSuffix()}`
    );
  }

  private logDetection(activeProject: ProjectActivity | null, codexContext: CodexRuntimeContext): void {
    const processState = codexContext.processDetected ? `yes (${codexContext.processCount})` : "no";
    const sessionState = codexContext.sessionDetected ? `yes (${codexContext.sessionId ?? "unknown"})` : "no";
    const processNames = codexContext.processNames.length > 0 ? codexContext.processNames.join(",") : "none";

    console.log(
      `[detect] codex_source=${codexContext.source ?? "none"} codex_process=${processState} names=${processNames} codex_session=${sessionState} cwd=${codexContext.workingDirectory ?? "n/a"}`
    );
    console.log(
      `[detect] project_source=${this.session?.projectSource ?? "none"} project=${activeProject?.projectName ?? "none"} repo=${activeProject?.repoRoot ?? "n/a"} branch=${activeProject?.branch ?? "n/a"}`
    );
    console.log(
      `[detect] activity_source=${this.session?.activitySource ?? "none"} activity=${truncate(this.session?.phase ?? "Idle", 100)}`
    );
  }

  private projectBranchSuffix(): string {
    if (!this.session) {
      return "";
    }

    const key = normalizePathCase(this.session.projectRoot);
    const activity = this.projectActivity.get(key);
    if (!activity?.branch) {
      return "";
    }

    return ` | branch: ${activity.branch}`;
  }

  private publishSnapshot(snapshot: WatcherSnapshot): void {
    this.currentSnapshot = snapshot;

    for (const listener of this.snapshotListeners) {
      listener({ ...snapshot });
    }
  }
}

function sameWorkspaceRoots(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => normalizePathCase(value) === normalizePathCase(right[index] ?? ""));
}
