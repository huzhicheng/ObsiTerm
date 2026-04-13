<div align="center">
  <h1>ObsiTerm</h1>
  <p><em>A terminal plugin for Obsidian that brings Claude Code, Codex, Gemini CLI, and other command-line tools into the right sidebar.</em></p>
  <p><a href="./README-ZH.md">简体中文</a></p>
  <p>
    <img alt="version" src="https://img.shields.io/badge/version-v1.1.0-1677ff?style=flat-square">
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
- Keeps the active note path and current selection synced to terminal-readable runtime files

## Installation

### From Releases

Download the asset for your platform from the [Releases](https://github.com/Youket/ObsiTerm/releases) page.

- `ObsiTerm-macos-...zip`: macOS bundle
- `ObsiTerm-windows-...zip`: Windows bundle

Extract the archive and copy the `obsidian-term` folder into your vault's `.obsidian/plugins/` directory.

### What Works Out Of The Box

After installing the plugin itself, these features work without any extra Claude or MCP setup:

- embedded terminal in Obsidian
- `@` path autocomplete
- initial directory support
- active note and selection runtime files
- context bridge HTTP endpoints
- prompt buttons and command palette actions such as `Send Selection` and `Send Note`
- the bundled CLI wrapper:
  - `resources/obsiterm-context.mjs`

Users can already pass note context into terminal workflows without configuring MCP.

### What Requires Extra Claude Setup

The bundled MCP server is included in the plugin package, but Claude Code will not discover it automatically. Users who want Claude Code to call tools like `get_current_selection` or `get_obsidian_context` must add the MCP server to Claude Code separately.

Bundled files:

- `resources/obsiterm-context.mjs`
- `resources/obsiterm-mcp.mjs`

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
- `resources/obsiterm-context.mjs`
- `resources/obsiterm-mcp.mjs`

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

### Active note and selection context

ObsiTerm now writes the active note context into runtime files that terminal tools can read:

- `OBSITERM_CONTEXT_FILE`: JSON snapshot of the current note, cursor, and selection
- `OBSITERM_SELECTION_FILE`: plain text file containing only the current selection
- `OBSITERM_ACTIVE_FILE`: absolute path of the active note when a terminal tab starts
- `OBSITERM_CONTEXT_BRIDGE_URL`: local read-only HTTP bridge for terminal tools
- `OBSITERM_CONTEXT_BRIDGE_TOKEN`: bearer token for the local HTTP bridge
- `OBSITERM_CONTEXT_MCP_CONFIG_FILE`: runtime JSON file containing a ready-to-use MCP config for the current session

The JSON file is updated while you switch notes, edit, or change the current selection in Obsidian.

Typical terminal usage:

```bash
cat "$OBSITERM_CONTEXT_FILE"
cat "$OBSITERM_SELECTION_FILE"
```

On Windows PowerShell:

```powershell
Get-Content $env:OBSITERM_CONTEXT_FILE
Get-Content $env:OBSITERM_SELECTION_FILE
```

### Context bridge API

ObsiTerm also exposes a local read-only HTTP bridge so terminal tools can query the current note context on demand instead of only reading files.

Available endpoints:

- `OBSITERM_CONTEXT_ENDPOINT`
- `OBSITERM_SELECTION_ENDPOINT`
- `OBSITERM_ACTIVE_NOTE_ENDPOINT`
- `OBSITERM_SELECTION_PROMPT_ENDPOINT`
- `OBSITERM_ACTIVE_NOTE_PROMPT_ENDPOINT`
- `OBSITERM_CONTEXT_CLI`
- `OBSITERM_CONTEXT_MCP`

PowerShell example:

```powershell
$headers = @{ Authorization = "Bearer $env:OBSITERM_CONTEXT_BRIDGE_TOKEN" }
Invoke-RestMethod -Headers $headers $env:OBSITERM_SELECTION_ENDPOINT
Invoke-RestMethod -Headers $headers $env:OBSITERM_CONTEXT_ENDPOINT
```

POSIX shell example:

```bash
curl -H "Authorization: Bearer $OBSITERM_CONTEXT_BRIDGE_TOKEN" "$OBSITERM_SELECTION_ENDPOINT"
curl -H "Authorization: Bearer $OBSITERM_CONTEXT_BRIDGE_TOKEN" "$OBSITERM_CONTEXT_ENDPOINT"
```

Prompt endpoints return JSON with a `prompt` field, which is useful when you want Claude Code or another agent CLI to fetch the current Obsidian context on demand.

CLI examples:

```powershell
node $env:OBSITERM_CONTEXT_CLI selection
node $env:OBSITERM_CONTEXT_CLI context
node $env:OBSITERM_CONTEXT_CLI selection-prompt --text
node $env:OBSITERM_CONTEXT_CLI mcp-config
```

### MCP server for agent CLIs

ObsiTerm also bundles a minimal stdio MCP server that proxies the local context bridge. This makes the current note and selection available as tools for Claude Code, Codex, and other MCP-capable terminal clients.

Available MCP tools:

- `get_obsidian_context`
- `get_current_selection`
- `get_active_note`
- `get_selection_prompt`
- `get_active_note_prompt`

PowerShell inspection:

```powershell
$env:OBSITERM_CONTEXT_MCP
$env:OBSITERM_CONTEXT_BRIDGE_TOKEN
Get-Content -Raw $env:OBSITERM_CONTEXT_MCP_CONFIG_FILE
```

Example MCP config:

```json
{
  "mcpServers": {
    "obsiterm": {
      "command": "node",
      "args": ["E:/Obsidian/obsidian_private/.obsidian/plugins/ObsiTerm/resources/obsiterm-mcp.mjs"],
      "env": {
        "OBSITERM_CONTEXT_BRIDGE_TOKEN": "...",
        "OBSITERM_CONTEXT_ENDPOINT": "...",
        "OBSITERM_SELECTION_ENDPOINT": "...",
        "OBSITERM_ACTIVE_NOTE_ENDPOINT": "...",
        "OBSITERM_SELECTION_PROMPT_ENDPOINT": "...",
        "OBSITERM_ACTIVE_NOTE_PROMPT_ENDPOINT": "..."
      }
    }
  }
}
```

A ready-to-edit example file is also included in this repository:

- [examples/claude-code-obsiterm-mcp.json](/E:/Development/Github/ObsiTerm/examples/claude-code-obsiterm-mcp.json)
- [.claude/settings.example.json](/E:/Development/Github/ObsiTerm/.claude/settings.example.json)
- [.claude/README.md](/E:/Development/Github/ObsiTerm/.claude/README.md)

Typical Claude Code setup on another machine:

1. Install the latest ObsiTerm release in Obsidian.
2. Open a terminal inside ObsiTerm at least once so the runtime bridge is available.
3. Copy the template above into Claude Code's MCP config and replace the vault path with the local vault path on that machine.
4. Start Claude Code from inside the ObsiTerm terminal.
5. Run `/mcp` in Claude Code and confirm that `obsiterm` is connected.

Important:

- the plugin ships the MCP server file, but the Claude-side MCP registration is still optional and machine-local
- without Claude MCP setup, users can still use the built-in buttons, commands, runtime files, HTTP bridge, and CLI wrapper
- if you sync your vault or project across machines, prefer keeping a project-level template in `.claude/` and editing only the machine-specific vault path locally

Command palette helpers:

- `ObsiTerm: Copy Obsidian Context File Path`
- `ObsiTerm: Copy Current Note Selection`
- `ObsiTerm: Send Current Selection To Terminal`
- `ObsiTerm: Send Active Note Path To Terminal`
- `ObsiTerm: Send Obsidian Context Summary To Terminal`
- `ObsiTerm: Send Current Selection As Claude Prompt`
- `ObsiTerm: Send Active Note As Claude Prompt`

### Terminal context status bar

Inspired by Claude Code's IDE footer, each terminal view now shows a lightweight host-owned status bar above the terminal.

- It shows the current Obsidian selection line count
- It shows the active note path
- When Claude Code, Codex CLI, or Gemini CLI is detected in the foreground, the hint switches to `? for shortcuts`
- It includes `Send Selection` and `Send Note` buttons for quickly sending Claude-style prompts without opening the command palette

This is meant to make the Obsidian-side context visible without forcing terminal tools to read files manually first.

## Development Notes

- `npm run build` builds both the TypeScript plugin and the native PTY helper
- `npm run deploy` is the preferred local workflow after code changes
- If Windows reports that `resources/pty-helper.exe` is locked, close Obsidian and run the build again to refresh the helper binary

## License

MIT
