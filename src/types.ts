export interface AppConfig {
  discordClientId: string;
  workspaceRoots: string[];
  pollIntervalSeconds: number;
  inactivityTimeoutMinutes: number;
}

export interface LoadedConfig {
  appRoot: string;
  configPath: string;
  discordClientId: string;
  workspaceRoots: string[];
  pollIntervalMs: number;
  inactivityTimeoutMs: number;
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

export interface SessionState {
  projectRoot: string;
  projectName: string;
  phase: string;
  startedAt: number;
  lastActivityAt: number;
}

export interface PresenceState {
  details: string;
  state: string;
  startTimestamp?: number;
}

export interface ResolvedProjectContext {
  workspaceRoot: string;
  projectRoot: string;
  repoRoot: string | null;
}
