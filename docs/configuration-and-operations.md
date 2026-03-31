# Configuration And Operations

## Config Sources

The current app uses three local configuration sources:

1. `watcher.settings.json`
2. `watcher.config.json`
3. `.env`

## `watcher.settings.json`

Purpose:

- main user-editable runtime settings used by the Electron app

Stored in:

- Electron user data directory

Contains:

- `username`
- `watchedFolderPath`
- `detailsTemplate`
- `stateTemplate`
- `aiLabelingEnabled`
- `openAiModel`
- `pollIntervalSeconds`
- `inactivityTimeoutMinutes`
- `showElapsedTime`
- `minimizeToTray`
- `launchOnStartup`

## `watcher.config.json`

Purpose in current code:

- legacy config
- still the source of the Discord application ID
- can provide a fallback initial workspace root

Important observation:

- old docs/types still mention `workspaceRoots`
- current desktop flow derives active watcher roots from `watchedFolderPath`

## `.env`

Purpose:

- environment variables, primarily `OPENAI_API_KEY`
- optionally `DISCORD_CLIENT_ID`

## Commands

Install:

```powershell
npm install
```

Build:

```powershell
npm run build
```

Type-check:

```powershell
npm run check
```

Run Electron desktop app:

```powershell
npm run start
```

Run build then Electron:

```powershell
npm run dev
```

Run CLI watcher:

```powershell
npm run watcher:cli
```

Build Windows portable executable:

```powershell
npm run dist:win
```

## Packaging

Electron Builder config in `package.json`:

- `appId`: `com.codex.codepulse`
- `productName`: `CodePulse`
- target: Windows portable executable
- output directory: `release`

The renderer and tray assets are copied into `dist/` by `scripts/copyRendererAssets.cjs` after TypeScript compilation.
