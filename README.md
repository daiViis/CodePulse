# Discord Rich Presence Watcher

Standalone local utility for keeping your Discord Rich Presence updated while you work across local coding projects with Codex CLI or any other editor/tool. It runs independently from the repos you work on and only needs one global config.

## What it does

- Watches one or more workspace root folders that contain your coding projects
- Detects the currently active project from recent file activity
- Uses the repo or folder name as the project name automatically
- Derives the current phase from the git branch and recently changed files
- Starts a fresh elapsed timer when you switch to another active project
- Falls back to `Idle` after the inactivity timeout
- Retries Discord IPC automatically if Discord is closed and opened later

Target Rich Presence while active:

```text
Working
Project: Feign Overlay - Phase: UI Work
```

## Runtime choice

This utility uses Node.js with TypeScript:

- Good fit for a small Windows background utility
- Easy file watching and named-pipe IPC for Discord
- Minimal dependency surface
- Simple one-click startup via `start.bat`

Runtime npm dependencies are intentionally avoided. The only npm packages are TypeScript build tools.

## Project structure

```text
Rich_Presence_Watcher/
  README.md
  package.json
  start.bat
  tsconfig.json
  watcher.config.example.json
  src/
    config.ts
    discordIpc.ts
    git.ts
    index.ts
    phase.ts
    projectResolver.ts
    types.ts
    utils.ts
    watcherApp.ts
```

## One-time setup

### 1. Install Node.js

Node.js 20+ is required.

### 2. Create a Discord application

Discord Rich Presence requires an application ID. This is the only Discord-specific setup step.

1. Open the Discord Developer Portal.
2. Create a new application.
3. Copy the **Application ID**.
4. Paste it into `watcher.config.json` as `discordClientId`.

You do not need per-project presence setup.

### 3. Create your local config

Copy `watcher.config.example.json` to `watcher.config.json`, then edit it.

`watcher.config.json` is ignored by git so you can keep local paths and your Discord application ID out of the repository.

### 4. Configure watched workspace roots

Edit `watcher.config.json` and set:

- `discordClientId`: your Discord application ID
- `workspaceRoots`: one or more root folders that contain the projects you actually work in
- `pollIntervalSeconds`: usually `10` to `15`
- `inactivityTimeoutMinutes`: default `30`

Example:

```json
{
  "discordClientId": "123456789012345678",
  "workspaceRoots": [
    "C:\\path\\to\\your\\projects"
  ],
  "pollIntervalSeconds": 15,
  "inactivityTimeoutMinutes": 30
}
```

## Install steps

From this project folder:

```powershell
npm install
npm run build
```

`start.bat` will also do both automatically if needed.

## Run steps

### One-click

Double-click `start.bat`.

### Terminal

```powershell
npm run build
npm start
```

## How detection works

### Active project detection

- The watcher creates a recursive file watcher for each configured workspace root.
- Every file change is mapped to a project root.
- If the changed file is inside a git repo, the repo root becomes the active project candidate.
- If the changed file is not inside a git repo, the first folder under the configured workspace root is used as the project.
- The most recently active project inside the inactivity window wins.
- The watcher ignores noisy folders such as `.git`, `node_modules`, `dist`, `build`, `coverage`, and the watcher project itself.

### Phase detection

Branch rules are checked first:

- `fix` or `bugfix` => `Bug Fixing`
- `feature` or `feat` => `Feature Development`
- `refactor` => `Refactoring`
- `test` => `Testing`
- `docs` => `Documentation`

If no branch rule matches, recent file paths are used:

- `components`, `ui`, `pages`, `styles` => `UI Work`
- `api`, `server`, `routes`, `controllers`, `db` => `Backend`
- `tests`, `spec` => `Testing`
- `docs` => `Documentation`
- `config`, `scripts`, `build` => `Project Setup`

Fallback:

- `In Progress`

### Session timing

- A session starts when file activity is detected for a project.
- The timer stays attached to that same project while it remains the most recently active one.
- If activity moves to another project, a new session starts from that project's first detected activity time.
- If no project activity is detected within the inactivity timeout, Rich Presence switches to `Idle` and the timer is removed.

## Notes

- Discord does not need to be open before you launch the watcher.
- If Discord is closed, the watcher keeps running and retries automatically.
- This utility does not modify or embed anything inside the projects you work on.
- The watcher is designed for local file-activity-based automation. It does not require per-project config, auth, cloud services, databases, or MCP.
