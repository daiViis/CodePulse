# Data Models And Schemas

## Main Configuration Shapes

### Legacy App Config

Source type: `AppConfig`

Purpose:

- legacy file-backed config
- still used for Discord application ID

Fields:

- `discordClientId: string`
- `workspaceRoots: string[]`
- `pollIntervalSeconds: number`
- `inactivityTimeoutMinutes: number`

Important note:

- current desktop runtime does not directly depend on all of these fields anymore
- the live desktop workflow primarily uses `watcher.settings.json`

### App Settings

Source type: `AppSettings`

Fields:

- `username: string`
- `watchedFolderPath: string`
- `detailsTemplate: string`
- `stateTemplate: string`
- `aiLabelingEnabled: boolean`
- `openAiModel: string`
- `pollIntervalSeconds: number`
- `inactivityTimeoutMinutes: number`
- `showElapsedTime: boolean`
- `minimizeToTray: boolean`
- `launchOnStartup: boolean`

Default values:

- `username`: empty string, which means "fall back to system username"
- `watchedFolderPath`: empty string
- `detailsTemplate`: `{username} is working on {project}`
- `stateTemplate`: `{phase}`
- `aiLabelingEnabled`: `false`
- `openAiModel`: `gpt-5.4-mini`
- `pollIntervalSeconds`: `15`
- `inactivityTimeoutMinutes`: `30`
- `showElapsedTime`: `true`
- `minimizeToTray`: `true`
- `launchOnStartup`: `false`

### Loaded App Settings

Source type: `LoadedAppSettings`

Adds metadata to `AppSettings`:

- `settingsPath`
- `legacyConfigPath`
- `discordClientId`
- `discordClientIdSource`
- `systemUsername`

Observed `discordClientIdSource` values in practice:

- `legacy-config`
- `environment`
- `missing`

The type also allows `settings`, but the current code path does not populate the Discord client ID from settings.

### Loaded Runtime Config

Source type: `LoadedConfig`

This is the final watcher-ready config consumed by `PresenceWatcherApp`.

Fields:

- `appRoot`
- `configPath`
- `settingsPath`
- `discordClientId`
- `workspaceRoots`
- `pollIntervalMs`
- `inactivityTimeoutMs`
- `username`
- `detailsTemplate`
- `stateTemplate`
- `aiLabelingEnabled`
- `openAiModel`
- `openAiApiKey`
- `openAiEnvLoaded`
- `openAiEnvPath`
- `showElapsedTime`

Key transformation rules:

- `watchedFolderPath` becomes `workspaceRoots: [watchedFolderPath]`
- poll seconds become milliseconds
- inactivity minutes become milliseconds
- blank username falls back to the OS username
- missing watched folder throws a startup/settings error
- missing Discord client ID throws a startup/config error

## Project Tracking Models

### `ProjectActivity`

Represents remembered activity for a project candidate.

Fields:

- `workspaceRoot`
- `projectRoot`
- `projectName`
- `repoRoot`
- `branch`
- `lastActivityAt`
- `recentPaths`

How it is used:

- every meaningful file event updates one `ProjectActivity`
- the watcher stores them in a `Map` keyed by normalized project root
- stale entries are pruned after `inactivityTimeoutMs * 3`

### `SessionState`

Represents the currently active time-tracked session.

Fields:

- `projectRoot`
- `projectName`
- `phase`
- `activitySource`
- `projectSource`
- `sessionId`
- `startedAt`
- `lastActivityAt`

Reset conditions:

- project root changes
- Codex session ID changes
- no active project remains

## Presence Model

### `PresenceState`

Fields:

- `details`
- `state`
- optional `startTimestamp`

This is the payload shape passed into `DiscordIpcClient.setPresence()`.

### Template Context

Source type: `PresenceTemplateContext`

Variables available to templates:

- `username`
- `project`
- `phase`

No other placeholders are supported.

## Snapshot Model

### `WatcherSnapshot`

This is the main UI-facing state object.

Fields:

- `watcherState`
- `status`
- `projectName`
- `phase`
- `activitySource`
- `projectSource`
- `sessionStartedAt`
- `sessionElapsedMs`
- `lastActivityAt`
- `branch`
- `watcherMessage`
- `discordState`
- `aiState`
- `aiMessage`
- `aiModel`
- `aiTokensUsed`
- `aiEnvPath`
- `updatedAt`
- optional `errorMessage`

### Watcher Lifecycle States

- `starting`
- `running`
- `stopped`
- `error`

### Watcher Status Values

- `working`
- `idle`
- `error`

### Discord Connection States

- `connected`
- `disconnected`

### AI Labeling States

- `disabled`
- `missing-config`
- `ready`
- `classifying`
- `active`
- `fallback`

## Source Attribution Models

### Activity Source

Where the current activity label came from:

- `openai`
- `codex-session`
- `codex-process`
- `codex-artifact`
- `git`
- `file-heuristic`
- `generic`

Important note:

- current watcher logic only directly emits `openai`, `git`, `file-heuristic`, and `generic` into session state
- Codex source values are defined in the type system and used for project selection/source reporting

### Project Source

Where the active project came from:

- `codex-session`
- `codex-process`
- `codex-artifact`
- `file-heuristic`

## Codex Runtime Context

Source type: `CodexRuntimeContext`

Fields:

- `source`
- `processDetected`
- `processCount`
- `processNames`
- `sessionDetected`
- `sessionId`
- `sessionTitle`
- `workingDirectory`
- `sessionStartedAt`
- `sessionUpdatedAt`
- `activity`

Internal freshness/caching constants:

- process cache: `5000 ms`
- session cache: `5000 ms`
- session head bytes: `65536`
- session index tail bytes: `131072`
- session index tail lines: `400`
- history tail bytes: `131072`
- history tail lines: `300`
- max activity length: `120`

Trust rules:

- session can remain usable when fresh even if no Codex process is currently detected
- the detector prefers a recent prompt, then session title, as the best human-readable intent

## AI Labeling Internals

### Sanitized Classification Context

Fields:

- `projectName`
- `repoName`
- `branchName`
- `changedAreas`
- `changedFileGroups`
- `recentIntent`
- `fallbackLabel`

### AI Runtime Constants

- default model: `gpt-5.4-mini`
- request timeout: `8000 ms`
- minimum classification interval per signature: `120000 ms`
- max cache entries: `100`
- max words in normalized label: `6`
- max normalized label length: `64`

### Cache Behavior

- cache key is SHA-1 hash of the sanitized context JSON
- identical context reuses cached label
- in-flight requests are de-duplicated per signature
- oldest cache entries are trimmed when exceeding 100 items

### Label Safety Rules

Returned labels are discarded if they:

- are empty after normalization
- include banned terms like `codex`, `assistant`, `agent`, `openai`, `chatgpt`, `prompt`, or `chat`
- contain project/repo/branch names strongly enough to look repetitive

## Heuristic Rule Sets

### Branch Rules

- `bugfix`, `fix` -> `Bug Fixing`
- `feature`, `feat` -> `Feature Development`
- `refactor` -> `Refactoring`
- `test` -> `Testing`
- `docs` -> `Documentation`
- `chore`, `build`, `config` -> `Project Setup`

### Path Rules

Broad categories:

- documentation
- testing
- project setup
- UI work
- backend

Examples of path keywords:

- docs and `.md` files -> documentation
- tests/spec files -> testing
- config/build/script files -> project setup
- components/pages/styles/tsx/css/html/svg -> UI work
- api/server/routes/controllers/services/db/sql -> backend

## Ignore Rules

Important ignored directories include:

- `.git`
- `node_modules`
- `dist`
- `build`
- `coverage`
- `.next`
- `.nuxt`
- `.turbo`
- `.cache`
- `.venv`
- `venv`
- `target`
- `bin`
- `obj`
- `out`
- `.idea`
- `.vs`
- `.vscode`
- `.codex`
- `.cursor`
- `.pytest_cache`
- `.svelte-kit`
- `.angular`
- `.gradle`
- `.terraform`
- `tmp`
- `temp`

Ignored suffixes:

- `.log`
- `.tmp`
- `.temp`
- `.swp`
- `.swo`
- `.tsbuildinfo`

Special ignored filename:

- `4913`
