# Overview

## Product Identity

- Product name in code and packaging: `CodePulse`
- Repository folder name: `Rich_Presence_Watcher`
- Description from `package.json`: "CodePulse is a Windows desktop utility for Discord Rich Presence while coding."
- Platform assumption: Windows desktop with Discord installed

## Core Purpose

The app watches a coding workspace and tries to keep Discord Rich Presence aligned with what the user is currently working on. It is not a code editor plugin and not a Discord bot. It is a local desktop process that:

1. Detects recent development activity.
2. Resolves activity to an active project.
3. Derives a short phase or activity label.
4. Pushes that label into Discord Rich Presence.
5. Shows watcher state in its own desktop UI.

## Main User-Facing Capabilities

- Tiny desktop utility instead of a terminal-only script.
- Live status window with current project, phase, timer, AI state, and Discord state.
- Minimize/close to tray behavior.
- Saveable settings for workspace folder, presence templates, AI labeling, poll intervals, and startup behavior.
- Discord Rich Presence updates with elapsed-time support.
- Optional OpenAI refinement of activity labels.

## Mental Model

The app has three layers:

1. Detection layer
2. Decision layer
3. Delivery layer

Detection gathers local signals. Decision picks the active project and label. Delivery updates Discord and the desktop UI.

## Current Runtime Shape

The default launch path is the Electron desktop app:

- Electron main process creates the window and tray.
- Main process loads settings and starts `PresenceWatcherApp`.
- `PresenceWatcherApp` watches workspace activity and emits snapshots.
- Renderer receives snapshots and updates the UI.

There is still a CLI entrypoint:

- `src/index.ts`
- command: `npm run watcher:cli`

## Important Terminology

- Watched folder: the main workspace directory selected in settings.
- Project root: the directory CodePulse treats as the active project.
- Repo root: git root if the file activity sits inside a git repository.
- Phase: activity string such as `UI Work`, `Feature Development`, or `Editing Settings`.
- Session: the time window attached to the currently active project/activity.
- Snapshot: the serialized watcher state sent to the UI.
