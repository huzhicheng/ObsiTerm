# Release

This repository now uses cross-platform release scripts.

## Requirements

1. Install GitHub CLI: `gh`
2. Authenticate once:

```bash
gh auth login
```

3. Build the asset on the target platform:

- build Windows release assets on Windows
- build macOS release assets on macOS

## Local Bundle Refresh

```bash
npm run deploy
```

This refreshes `releases/<platform>/obsidian-term` for the current platform.

## Publish To GitHub Releases

```bash
npm run release:github
```

The release script will:

1. Run `npm run deploy` unless `--skip-build` is used
2. Read the version from `releases/<platform>/obsidian-term/manifest.json`
3. Create `dist-release/ObsiTerm-<platform>-v<version>.zip`
4. Create or update GitHub Release `v<version>`
5. Upload the platform zip asset

Also verify that the bundle includes the context integration resources:

- `resources/obsiterm-context.mjs`
- `resources/obsiterm-mcp.mjs`

These files are required for:

- runtime context CLI access
- optional Claude Code MCP integration

## Dry Run

```bash
npm run release:github -- --dry-run
```

`--dry-run` now prints the resolved version, tag, zip path, and notes path without writing any files.

## Package Without Publishing

Use this when `gh` is not installed yet or when you want to upload the release manually:

```bash
npm run release:github -- --package-only
```

This creates:

- `dist-release/ObsiTerm-<platform>-v<version>.zip`
- `dist-release/release-notes-<platform>-v<version>.md`

## Common Options

```bash
npm run release:github -- --skip-build
npm run release:github -- --package-only
npm run release:github -- --prerelease
npm run release:github -- --platform windows
npm run release:github -- --platform macos
npm run release:github -- --tag v1.0.0 --title "ObsiTerm 1.0.0"
npm run release:github -- --notes-file ./notes.md
```

## Recommended Order

1. Make sure `main` is clean and up to date
2. Update `manifest.json` if needed
3. Commit and push
4. Run `npm run release:github`
5. Verify the uploaded asset on GitHub

## Distribution Notes

Users get two layers of functionality:

1. Out of the box after installing the plugin release:
   - terminal
   - note and selection runtime files
   - prompt buttons and command palette actions
   - HTTP context bridge
   - bundled CLI wrapper
2. Optional extra setup for Claude Code tool calling:
   - users must register `resources/obsiterm-mcp.mjs` in their local Claude Code MCP config

So the plugin release should ship the MCP server, but users still need a local Claude-side configuration step if they want Claude Code to call `get_current_selection` and related tools directly.
