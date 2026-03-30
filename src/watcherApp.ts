import fs from "node:fs";
import path from "node:path";
import { DiscordIpcClient } from "./discordIpc";
import { readBranchName } from "./git";
import { derivePhase } from "./phase";
import { deriveProjectName, isIgnoredPath, resolveProjectContext } from "./projectResolver";
import { LoadedConfig, PresenceState, ProjectActivity, SessionState } from "./types";
import { dedupeRecentPaths, formatDuration, normalizePathCase } from "./utils";

const ACTIVITY_REFRESH_DELAY_MS = 750;

export class PresenceWatcherApp {
  private readonly discord: DiscordIpcClient;
  private readonly projectActivity = new Map<string, ProjectActivity>();
  private readonly rootWatchers: fs.FSWatcher[] = [];
  private session: SessionState | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private activityRefreshTimer: NodeJS.Timeout | null = null;
  private tickInFlight = false;
  private tickQueued = false;

  constructor(private readonly config: LoadedConfig) {
    this.discord = new DiscordIpcClient(config.discordClientId);
  }

  async start(): Promise<void> {
    this.startWorkspaceWatchers();
    console.log(`[watcher] Monitoring ${this.config.workspaceRoots.length} workspace root(s).`);
    for (const root of this.config.workspaceRoots) {
      console.log(`[watcher] Root: ${root}`);
    }

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

  private recordActivity(absolutePath: string): void {
    if (isIgnoredPath(absolutePath, this.config.appRoot)) {
      return;
    }

    const context = resolveProjectContext(absolutePath, this.config.workspaceRoots, this.config.appRoot);
    if (!context) {
      return;
    }

    if (!fs.existsSync(context.projectRoot)) {
      return;
    }

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

    const activeProject = this.pickActiveProject(now);
    const presence = this.buildPresence(activeProject);
    await this.discord.setPresence(presence);

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

  private pickActiveProject(now: number): ProjectActivity | null {
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

  private buildPresence(activeProject: ProjectActivity | null): PresenceState {
    if (!activeProject) {
      this.session = null;
      return {
        details: "Working",
        state: "Idle"
      };
    }

    const phase = derivePhase(activeProject.branch, activeProject.recentPaths);

    if (!this.session || normalizePathCase(this.session.projectRoot) !== normalizePathCase(activeProject.projectRoot)) {
      this.session = {
        projectRoot: activeProject.projectRoot,
        projectName: activeProject.projectName,
        phase,
        startedAt: activeProject.lastActivityAt,
        lastActivityAt: activeProject.lastActivityAt
      };
    } else {
      this.session.projectName = activeProject.projectName;
      this.session.phase = phase;
      this.session.lastActivityAt = Math.max(this.session.lastActivityAt, activeProject.lastActivityAt);
    }

    return {
      details: "Working",
      state: `Project: ${this.session.projectName} \u2022 Phase: ${this.session.phase}`,
      startTimestamp: this.session.startedAt
    };
  }

  private logStatus(presence: PresenceState, now: number): void {
    if (!this.session || !presence.startTimestamp) {
      console.log(`[status] ${presence.state}`);
      return;
    }

    const duration = formatDuration(now - presence.startTimestamp);
    console.log(
      `[status] ${this.session.projectName} | ${this.session.phase} | ${duration}${this.projectBranchSuffix()}`
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
}
