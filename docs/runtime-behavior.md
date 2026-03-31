# Runtime Behavior

## Startup Sequence

### Electron Startup

On app launch:

1. Electron acquires a single-instance lock.
2. Current settings are loaded.
3. `launchOnStartup` is applied.
4. IPC handlers are registered.
5. Main window and tray are created.
6. Watcher startup begins.

If watcher startup fails, the Electron shell stays up and exposes an error snapshot.

### CLI Startup

`src/index.ts` loads config directly from the app root, creates `PresenceWatcherApp`, wires SIGINT/SIGTERM shutdown handlers, and starts the watcher.

## Workspace Watching

The watcher creates one recursive `fs.watch` watcher per configured workspace root. In the current desktop flow there is effectively one workspace root: the selected watched folder from settings.

For each file event:

1. resolve absolute path
2. ignore noisy/internal paths
3. resolve project context
4. read branch if repo root exists
5. update or create `ProjectActivity`
6. debounce a presence refresh

The refresh is delayed by 750 ms to collapse bursts of events.

## Project Resolution

Resolution order:

1. find containing watched root
2. resolve start directory
3. look upward for git root
4. look upward for project markers
5. prefer git root
6. otherwise use project marker root
7. otherwise use first folder under the workspace root

## Codex Context Detection

The app can infer project/activity context from the local Codex environment:

- process detection via PowerShell `Get-Process`
- latest session file under `~/.codex/sessions`
- session title from `~/.codex/session_index.jsonl`
- recent prompt text from `~/.codex/history.jsonl`

Possible source labels:

- `codex-session`
- `codex-process`
- `codex-artifact`

## Phase / Activity Derivation

The activity label is produced in layers.

### Layer 1: Branch Rule

- `bugfix`, `fix` -> `Bug Fixing`
- `feature`, `feat` -> `Feature Development`
- `refactor` -> `Refactoring`
- `test` -> `Testing`
- `docs` -> `Documentation`
- `chore`, `build`, `config` -> `Project Setup`

### Layer 2: Path Rule

Recent paths map to categories such as documentation, testing, project setup, UI work, and backend.

### Layer 3: Fallback Label

If no category matches, the app falls back to:

- `Editing <name derived from recent file/folder>`
- otherwise `In Progress`

## Optional OpenAI Labeling

If AI labeling is enabled and an API key exists:

1. a sanitized context is built
2. the context is hashed
3. cached label is reused if available
4. otherwise a throttled request goes to `/v1/responses`
5. output is normalized into a short label

Sanitized context contains:

- project name
- repo name
- branch name
- changed areas
- changed file groups
- recent intent from Codex prompt/title if available
- fallback heuristic label

## Discord Publishing

The app connects to local Discord using Windows named pipes:

- `\\?\pipe\discord-ipc-0`
- through `discord-ipc-9`

It performs a handshake, sends `SET_ACTIVITY`, suppresses duplicate payloads, and reconnects on failure.
