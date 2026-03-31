# Module Reference

## Root Files

### `package.json`

- Declares app name `codepulse`.
- Uses CommonJS output and Node 20+.
- Main Electron entry is `dist/electron/main.js`.
- Defines build, check, dev, CLI watcher, and Windows packaging scripts.

### `start.bat`

- Installs dependencies if needed.
- Launches `npm run dev`.

### `tsconfig.json`

- TypeScript strict mode.
- `src` to `dist`.
- CommonJS module output.

## `src/index.ts`

CLI entrypoint for the watcher without Electron.

## `src/watcherApp.ts`

Main orchestration class for:

- file watching
- project tracking
- session management
- activity selection
- snapshot publishing
- Discord updates

## `src/config.ts`

Configuration bootstrap and persistence.

## `src/projectResolver.ts`

Project root detection and path ignore logic.

## `src/git.ts`

Minimal git metadata helper.

## `src/phase.ts`

Heuristic phase derivation.

## `src/codexContext.ts`

Codex-aware activity detector using local process/session artifacts.

## `src/openAiActivityLabeler.ts`

Optional AI classifier for richer activity labels.

## `src/discordIpc.ts`

Discord local RPC transport over named pipes.

## `src/presenceTemplates.ts`

Simple variable substitution for Discord strings.

## `src/watcherSnapshot.ts`

Factory helpers for default and error snapshots.

## `src/env.ts`

Custom `.env` loader with diagnostics.

## `src/electron/main.ts`

Electron main-process shell.

## `src/electron/preload.ts`

Safe bridge from renderer to main process via `contextBridge`.

## `src/renderer/index.html`

Static renderer markup for the compact status window and settings modal.

## `src/renderer/renderer.js`

Renderer-side UI controller.

## `src/renderer/styles.css`

Dark compact desktop UI styling.

## `scripts/copyRendererAssets.cjs`

Copies renderer and asset folders into `dist/` after build.
