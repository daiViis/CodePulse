# CodePulse Knowledge Pack

This `docs/` folder is a code-derived knowledge base for the current repository state.

It is intended for NotebookLM ingestion, so the content is split into focused documents instead of one giant dump.

## What This App Is

CodePulse is a Windows Electron desktop utility that updates Discord Rich Presence based on coding activity.

At runtime it combines:

1. File-system activity inside a configured watched workspace folder.
2. Git metadata, mainly repository root detection and current branch name.
3. Codex runtime context from local process/session artifacts in `~/.codex`.
4. Optional OpenAI labeling that turns sanitized context into a short activity label.

The app then publishes a Discord Rich Presence payload and mirrors its internal state in a compact desktop window plus system tray.

## Document Map

- `overview.md`: product-level description, capabilities, constraints, terminology, and behavior summary.
- `architecture.md`: system architecture, runtime flow, data model, and control flow between modules.
- `runtime-behavior.md`: startup, watcher loop, project detection, activity detection, Discord publishing, and session handling.
- `configuration-and-operations.md`: config files, settings persistence, environment variables, build/run/distribution behavior, and operations notes.
- `data-models-and-schemas.md`: type-level reference for configs, snapshots, statuses, and important derived data.
- `module-reference.md`: module-by-module source reference for `src/`, `scripts/`, and key root files.
- `implementation-notes.md`: detailed observations, tradeoffs, quirks, and likely maintenance risks.

## High-Level Summary

- Primary runtime shell: Electron.
- Core engine: `PresenceWatcherApp`.
- Discord transport: named pipe IPC to local Discord desktop app.
- Current watched workspace model: one folder selected in desktop settings.
- Legacy compatibility: `watcher.config.json` still provides the Discord application ID and can seed an initial workspace root.
- Optional AI enhancement: OpenAI Responses API using a sanitized context payload and cached labels.
- UI model: a tiny frameless status window plus a settings modal and tray menu.
