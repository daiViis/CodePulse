# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the TypeScript source. `index.ts` is the entrypoint, `watcherApp.ts` coordinates polling and presence updates, and modules such as `config.ts`, `discordIpc.ts`, `projectResolver.ts`, and `phase.ts` handle focused parts of the watcher. Shared types and helpers live in `types.ts` and `utils.ts`.

`dist/` is generated output from the TypeScript build. Do not edit it by hand. Root-level operational files include `watcher.config.json`, `start.bat`, and runtime logs like `watcher.runtime.log`.

## Build, Test, and Development Commands
Use Node.js 20+.

- `npm install`: install the TypeScript toolchain.
- `npm run build`: compile `src/` into `dist/`.
- `npm run check`: run strict type-checking without emitting files.
- `npm start`: run the compiled watcher from `dist/index.js`.
- `.\start.bat`: Windows shortcut that installs dependencies if missing, builds, and starts the app.

Run `npm run build` before `npm start`; `start` does not compile automatically.

## Coding Style & Naming Conventions
Follow the existing TypeScript style: 2-space indentation, double quotes, semicolons, and small focused modules. The project uses CommonJS output with `strict` type-checking enabled in `tsconfig.json`.

Use `PascalCase` for classes, interfaces, and types such as `PresenceWatcherApp` and `LoadedConfig`. Use `camelCase` for functions, variables, and file names such as `projectResolver.ts`. Prefer explicit return types on exported functions and methods.

## Testing Guidelines
No automated test suite is committed in this snapshot. Before opening a PR, run `npm run check` and `npm run build`, then verify behavior manually with a safe local `watcher.config.json`.

For behavior changes, capture the manual scenario you tested, for example: startup, project switching, idle fallback, and Discord reconnect handling.

## Commit & Pull Request Guidelines
Local git history is not available in this workspace snapshot, so follow short imperative commit subjects. A Conventional Commit prefix is a good default, for example `fix: handle missing repo root`.

PRs should include the behavior change, any config or logging impact, and the verification steps you ran. Include screenshots or log excerpts when changing Rich Presence text, startup flow, or watcher status output.

## Configuration & Security Tips
Keep example config values generic. Do not commit personal workspace paths, private Discord application IDs, or generated `*.log` files.
