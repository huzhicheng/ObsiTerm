# Claude Project Setup

This directory provides a project-level setup template for using ObsiTerm context features with Claude Code.

## Goal

When you sync your Obsidian vault or project to another machine, you want the Claude-side setup to be easy to restore.

This project-level setup is meant to travel with the repository, while still keeping machine-specific absolute paths easy to edit.

## What This Solves

The plugin itself already ships:

- `resources/obsiterm-context.mjs`
- `resources/obsiterm-mcp.mjs`

So after installing the plugin, users already get:

- runtime context files
- prompt buttons and command palette actions
- HTTP context bridge
- CLI access

What still needs machine-local setup is Claude Code MCP registration.

## Recommended Model

Keep these two layers separate:

1. Repository-synced layer
   - this `.claude/` directory
   - MCP config template
   - setup instructions
2. Machine-local layer
   - actual absolute vault path on that machine
   - local Claude Code config that enables the `obsiterm` MCP server

## Files

- `.claude/settings.example.json`
  - project-level template for Claude Code MCP configuration
- `examples/claude-code-obsiterm-mcp.json`
  - minimal standalone MCP example

## How To Use On Another Machine

1. Install the latest ObsiTerm plugin in the synced Obsidian vault.
2. Open at least one ObsiTerm terminal so the runtime bridge starts.
3. Copy `.claude/settings.example.json` to the location you actually use for Claude project settings.
4. Replace `E:/YourVault/...` with the local vault path on that machine.
5. Start Claude Code from inside the ObsiTerm terminal.
6. Run `/mcp` and confirm that `obsiterm` is connected.

## Important Notes

- Do not commit a machine-specific final config with your personal absolute path unless that path is intentionally shared by every machine.
- The safest repository strategy is:
  - commit templates
  - keep final machine-local activation editable
- If Claude Code is not configured yet, ObsiTerm context features still work through:
  - buttons
  - command palette actions
  - runtime files
  - HTTP bridge
  - CLI
