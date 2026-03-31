import { WatcherSnapshot } from "./types";

export function createDefaultWatcherSnapshot(): WatcherSnapshot {
  return {
    watcherState: "stopped",
    status: "idle",
    projectName: null,
    phase: null,
    activitySource: null,
    projectSource: null,
    sessionStartedAt: null,
    sessionElapsedMs: 0,
    lastActivityAt: null,
    branch: null,
    watcherMessage: "Watcher is ready.",
    discordState: "disconnected",
    aiState: "disabled",
    aiMessage: "AI Off",
    aiModel: null,
    aiTokensUsed: null,
    aiEnvPath: null,
    updatedAt: Date.now()
  };
}

export function createErrorWatcherSnapshot(errorMessage: string): WatcherSnapshot {
  return {
    ...createDefaultWatcherSnapshot(),
    watcherState: "error",
    status: "error",
    watcherMessage: errorMessage,
    errorMessage,
    updatedAt: Date.now()
  };
}
