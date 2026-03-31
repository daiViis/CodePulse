# Architecture

## Primary Components

### Electron Shell

Files:

- `src/electron/main.ts`
- `src/electron/preload.ts`
- `src/renderer/index.html`
- `src/renderer/renderer.js`
- `src/renderer/styles.css`

Responsibilities:

- create frameless desktop window
- create tray icon and tray menu
- load and save settings
- start and reconfigure the watcher
- bridge watcher snapshots into the renderer

### Watcher Core

Main file:

- `src/watcherApp.ts`

Responsibilities:

- watch the configured workspace roots
- record file activity
- resolve project context
- detect Codex context
- derive presence
- manage active session lifetime
- update Discord
- emit snapshots

### Configuration Layer

Main file:

- `src/config.ts`

Responsibilities:

- load `watcher.settings.json`
- load legacy `watcher.config.json`
- load `.env`
- validate watched folder
- build runtime `LoadedConfig`

### Supporting Modules

- `src/projectResolver.ts`
- `src/git.ts`
- `src/phase.ts`
- `src/codexContext.ts`
- `src/presenceTemplates.ts`
- `src/openAiActivityLabeler.ts`
- `src/discordIpc.ts`

## Runtime Control Flow

### Electron Mode

1. Electron app starts.
2. `main.ts` obtains a single-instance lock.
3. Settings are loaded and startup behavior is applied.
4. Window and tray are created.
5. `PresenceWatcherApp` starts.
6. Watcher snapshots are pushed to the main process.
7. Main process forwards snapshots to the renderer.

### Watcher Tick

Each watcher tick:

1. prunes stale remembered projects
2. detects Codex context
3. picks active project from Codex or file heuristics
4. derives the current activity label
5. creates Discord presence payload
6. publishes presence through Discord IPC
7. builds a new watcher snapshot
8. logs detection and status

## Core State Model

Important types from `src/types.ts`:

- `LoadedConfig`
- `ProjectActivity`
- `SessionState`
- `PresenceState`
- `WatcherSnapshot`

## Presence String Construction

The final Discord presence uses two templates:

- `detailsTemplate`
- `stateTemplate`

Variables:

- `{username}`
- `{project}`
- `{phase}`
