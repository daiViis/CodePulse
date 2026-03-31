export interface AppConfig {
  discordClientId: string;
  workspaceRoots: string[];
  pollIntervalSeconds: number;
  inactivityTimeoutMinutes: number;
}

export interface AppSettings {
  username: string;
  watchedFolderPath: string;
  detailsTemplate: string;
  stateTemplate: string;
  aiLabelingEnabled: boolean;
  openAiModel: string;
  pollIntervalSeconds: number;
  inactivityTimeoutMinutes: number;
  showElapsedTime: boolean;
  minimizeToTray: boolean;
  launchOnStartup: boolean;
}

export interface LoadedAppSettings extends AppSettings {
  settingsPath: string;
  legacyConfigPath: string | null;
  discordClientId: string;
  discordClientIdSource: "settings" | "legacy-config" | "environment" | "missing";
  systemUsername: string;
}

export interface LoadedConfig {
  appRoot: string;
  configPath: string | null;
  settingsPath: string;
  discordClientId: string;
  workspaceRoots: string[];
  pollIntervalMs: number;
  inactivityTimeoutMs: number;
  username: string;
  detailsTemplate: string;
  stateTemplate: string;
  aiLabelingEnabled: boolean;
  openAiModel: string;
  openAiApiKey: string;
  openAiEnvLoaded: boolean;
  openAiEnvPath: string | null;
  showElapsedTime: boolean;
}

export interface ProjectActivity {
  workspaceRoot: string;
  projectRoot: string;
  projectName: string;
  repoRoot: string | null;
  branch: string | null;
  lastActivityAt: number;
  recentPaths: string[];
}

export type ActivitySource =
  | "openai"
  | "codex-session"
  | "codex-process"
  | "codex-artifact"
  | "git"
  | "file-heuristic"
  | "generic";

export type ProjectSource =
  | "codex-session"
  | "codex-process"
  | "codex-artifact"
  | "file-heuristic";

export interface SessionState {
  projectRoot: string;
  projectName: string;
  phase: string;
  activitySource: ActivitySource;
  projectSource: ProjectSource;
  sessionId: string | null;
  startedAt: number;
  lastActivityAt: number;
}

export interface PresenceState {
  details: string;
  state: string;
  startTimestamp?: number;
}

export interface PresenceTemplateContext {
  username: string;
  project: string;
  phase: string;
}

export interface ResolvedProjectContext {
  workspaceRoot: string;
  projectRoot: string;
  repoRoot: string | null;
}

export type WatcherLifecycleState = "starting" | "running" | "stopped" | "error";
export type WatcherStatus = "working" | "idle" | "error";
export type DiscordConnectionState = "connected" | "disconnected";
export type AiLabelingState = "disabled" | "missing-config" | "ready" | "classifying" | "active" | "fallback";

export interface WatcherSnapshot {
  watcherState: WatcherLifecycleState;
  status: WatcherStatus;
  projectName: string | null;
  phase: string | null;
  activitySource: ActivitySource | null;
  projectSource: ProjectSource | null;
  sessionStartedAt: number | null;
  sessionElapsedMs: number;
  lastActivityAt: number | null;
  branch: string | null;
  watcherMessage: string;
  discordState: DiscordConnectionState;
  aiState: AiLabelingState;
  aiMessage: string;
  aiModel: string | null;
  aiTokensUsed: number | null;
  aiEnvPath: string | null;
  updatedAt: number;
  errorMessage?: string;
}
