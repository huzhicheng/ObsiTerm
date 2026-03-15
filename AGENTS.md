# AGENTS.md

## Project

`xTermObsidian` is an Obsidian desktop plugin that opens a terminal in the right sidebar and supports `@` autocomplete for vault file and folder absolute paths.

## Read First

- `README.md`
- `manifest.json`
- `package.json`
- `esbuild.config.mjs`
- `src/main.ts`
- `src/TerminalView.ts`
- `src/AutocompleteManager.ts`
- `src/VaultScanner.ts`
- `resources/pty-helper.py`

## Rules

- Treat this as an Obsidian desktop plugin, not a generic web app.
- Preserve `manifest.json` `isDesktopOnly: true` unless explicitly asked otherwise.
- Do not rename plugin IDs, command IDs, view types, or manifest fields without approval.
- Do not edit generated `main.js` directly. Change source and rebuild.
- Prefer small, local fixes over large refactors.
- Do not assume path handling is ASCII-only.
- Verify shell behavior in code before trusting README notes about `node-pty`.

## Key Ownership

- `src/main.ts`: plugin registration, commands, settings, view lifecycle
- `src/TerminalView.ts`: xterm UI, shell process, resize, input routing
- `src/AutocompleteManager.ts`: `@` autocomplete popup and keyboard handling
- `src/VaultScanner.ts`: vault scan, cache, path filtering
- `resources/pty-helper.py`: shell integration helper

## Build

- Install: `npm install`
- Dev: `npm run dev`
- Preferred local deploy: `./deploy.sh`
- `./deploy.sh` runs `npm run build` and copies plugin files into the local Obsidian plugin directory

## Validation

For code changes:

1. Run `./deploy.sh` unless the task only needs a compile check
2. Report changed files and impact

If terminal behavior changes, also verify:

1. Terminal opens from ribbon or command palette
2. Terminal accepts input
3. `@` popup appears and filters
4. Selected item inserts correct absolute path
5. Resize still works
6. Multiple terminal tabs still work
