# Implementation Notes

## Current Design Tradeoffs

The codebase is optimized for a working desktop utility rather than a reusable framework. The main abstractions are practical and thin.

The app relies on heuristics:

- file activity
- path rules
- branch naming
- lightweight Codex artifact scraping

That keeps dependencies low, but accuracy depends on repo layout and naming conventions.

## Important Observations

### Legacy/new config split

Current configuration is split across:

- `watcher.settings.json`
- `watcher.config.json`

That works, but it is conceptually awkward and easy for maintainers to forget.

### Current workspace model is effectively singular

Although the watcher class still supports multiple roots internally, the desktop app currently exposes one watched folder in settings and converts it into a one-item `workspaceRoots` array.

### Codex support is unusually specific

This version has bespoke support for the local Codex runtime:

- codex process detection
- `~/.codex` session artifact parsing
- recent prompt/title extraction

### AI labeling is privacy-aware by design

The OpenAI layer sends a compact sanitized summary rather than raw file content or diffs.

## Current Quirks And Risks

### Renderer text encoding artifacts

`src/renderer/index.html` currently contains mojibake-looking glyphs for some button labels, which strongly suggests encoding corruption in the HTML source.

### Window close behavior differs by path

The custom close button in the renderer quits the application, while the Electron window close event usually hides to tray when `minimizeToTray` is enabled.

### Watcher startup can fail while app shell stays open

The Electron shell can launch while the watcher itself is in an error snapshot state because settings or config are invalid. That is intentional, but "app launched" does not always mean "watcher operational."

## Likely Improvement Areas

- unify config into one coherent format
- expose multi-root support or remove leftover multi-root terminology
- add automated tests for project resolution and phase derivation
- normalize renderer character encoding
- formalize log destinations if packaging becomes more serious
