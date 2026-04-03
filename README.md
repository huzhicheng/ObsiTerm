<div align="center">
  <h1>ObsiTerm</h1>
  <p><em>A terminal plugin for Obsidian that brings Claude Code, Codex, Gemini CLI, and other command-line tools into the right sidebar.</em></p>
  <p><a href="./README-ZH.md">简体中文</a></p>
  <p>
    <img alt="version" src="https://img.shields.io/badge/version-v1.0.0-1677ff?style=flat-square">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-1677ff?style=flat-square">
    <img alt="platform" src="https://img.shields.io/badge/desktop-macOS%20%7C%20Windows-6f42c1?style=flat-square">
    <a href="https://github.com/Youket/ObsiTerm"><img alt="repo" src="https://img.shields.io/badge/fork-Youket%2FObsiTerm-f97316?style=flat-square"></a>
  </p>
  <p>
    <img alt="ObsiTerm Preview" src="./assets/light-theme.png">
  </p>
</div>

## Overview

`ObsiTerm` opens a real terminal in the right sidebar of Obsidian Desktop. It currently supports macOS and Windows builds from the same source tree.

## Features

- Integrated terminal inside Obsidian with real-time interaction
- Works well with Claude Code, Codex, Gemini CLI, and other terminal tools
- `@` autocomplete for vault file and folder absolute paths
- Ghostty theme compatibility plus built-in themes
- Configurable font, font size, autocomplete trigger, shell command, and initial directory
- Paste large text blocks or images as temporary file paths

## Installation

### From Releases

Download the asset for your platform from the [Releases](https://github.com/Youket/ObsiTerm/releases) page.

- `ObsiTerm-macos-...zip`: macOS bundle
- `ObsiTerm-windows-...zip`: Windows bundle

Extract the archive and copy the `obsidian-term` folder into your vault's `.obsidian/plugins/` directory.

### Manual Development Install

1. Clone the repository into your vault plugin directory or anywhere else on disk.
2. Install dependencies:

```bash
npm install
```

3. Build:

```bash
npm run build
```

4. Copy these files into `.obsidian/plugins/obsidian-term/`:

- `main.js`
- `manifest.json`
- `styles.css`
- `themes/`
- `resources/pty-helper` on macOS
- `resources/pty-helper.exe` on Windows

## Local Deploy

The recommended cross-platform deploy command is:

```bash
npm run deploy
```

Optional environment variable:

- `OBSIDIAN_PLUGIN_DIR`
  Example on macOS: `/Users/name/Vault/.obsidian/plugins/obsidian-term`
  Example on Windows: `E:\Vault\.obsidian\plugins\obsidian-term`

What it does:

- runs `npm run build`
- refreshes `releases/<platform>/obsidian-term`
- optionally copies the plugin bundle into `OBSIDIAN_PLUGIN_DIR`

The legacy `deploy.sh` remains as a thin wrapper for Unix-like shells, but `npm run deploy` is the primary entry point.

## GitHub Release

The recommended cross-platform release command is:

```bash
npm run release:github
```

This packages the current platform bundle from `releases/<platform>/obsidian-term` and uploads a platform-specific zip asset to GitHub Releases.

Useful options:

```bash
npm run release:github -- --dry-run
npm run release:github -- --skip-build
npm run release:github -- --prerelease
npm run release:github -- --platform windows
npm run release:github -- --platform macos
```

Notes:

- Build Windows assets on Windows.
- Build macOS assets on macOS.
- `gh` must be installed and authenticated before publishing.

## Usage

### Enable and configure

In Obsidian Settings, open Community plugins, find `ObsiTerm`, and enable it.

You can configure:

- theme
- font size
- font family
- autocomplete trigger
- shell command override
- initial directory

### Initial directory

Use the `Initial Directory` setting when you want new terminal tabs to start somewhere other than the user home directory.

- Leave it empty to start in the vault root
- Use a relative path such as `.` or `./scripts` to resolve from the vault root
- Use an absolute path such as `E:\Projects` or `/Users/name/Projects` to start elsewhere
- `~`, `~/...`, and `~\...` expand to the current user's home directory

If the configured directory does not exist, ObsiTerm falls back to the vault root.

### Open terminal

Click the `New Terminal` ribbon icon in the left sidebar.

### `@` autocomplete

1. Type `@`
2. Continue typing keywords
3. Use arrow keys to select
4. Press `Tab` or `Enter` to confirm
5. Press `Esc` to cancel

The selected item is inserted as an absolute path.

## Development Notes

- `npm run build` builds both the TypeScript plugin and the native PTY helper
- `npm run deploy` is the preferred local workflow after code changes
- If Windows reports that `resources/pty-helper.exe` is locked, close Obsidian and run the build again to refresh the helper binary

## License

MIT
