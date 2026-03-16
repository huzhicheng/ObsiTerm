<div align="center">
  <h1>ObsiTerm</h1>
  <p><em>A terminal plugin for Obsidian, making it easy to use Claude Code, Codex, Gemini CLI, and other command-line tools directly inside Obsidian.</em></p>
  <p><a href="./README-ZH.md">简体中文</a></p>
  <p>
    <img alt="version" src="https://img.shields.io/badge/version-v1.0.0-1677ff?style=flat-square">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-1677ff?style=flat-square">
    <img alt="platform" src="https://img.shields.io/badge/obsidian-desktop%20only-6f42c1?style=flat-square">
    <a href="https://github.com/huzhicheng"><img alt="follow" src="https://img.shields.io/badge/follow-huzhicheng-f97316?style=flat-square"></a>
  </p>
  <p>
    <img alt="ObsiTerm Preview" src="./assets/light-theme.png">
  </p>
</div>

## Overview

`ObsiTerm` opens a real terminal in the right sidebar of Obsidian Desktop. You can use it like any other terminal, including running Claude Code, Codex, Gemini CLI, and other command-line workflows.

## Features

- A terminal integrated into Obsidian, so you can use Claude Code, Codex, Gemini CLI, and other CLI tools directly inside Obsidian with real-time interaction.
- Fully compatible with Ghostty terminal themes. You can copy Ghostty theme files directly into the `themes` directory, open it from the settings page, and switch themes from the plugin settings.
- Comes with 9 built-in themes

<table padding="0">
  <tr>
    <td align="center"><b>Light Theme</b></td>
    <td align="center"><b>Dark Theme</b></td>
  </tr>
  <tr>
    <td align="center">
      <img src="assets/light-theme.png" alt="Light Theme" width="400">
    </td>
    <td align="center">
      <img src="assets/dark-theme.png" alt="Dark Theme" width="400">
    </td>
  </tr>
</table>


- Supports `@` file search without interfering with native commands in Claude Code, Codex, or Gemini CLI
- Configurable font, font size, and file-path autocomplete trigger
- Supports folding large pasted text blocks and pasting images as temporary file paths, similar to Claude Code

## Usage

### Installation

Download the package for your platform from [Releases](https://github.com/huzhicheng/ObsiTerm/releases) (currently macOS only).

#### Automatic installation

Run the `install.sh` script in the release directory from Terminal. It will automatically find Obsidian vaults on the current machine, list them, and let you select one or more vaults with the space key, then press Enter to install.

<p>
    <img alt="Auto Install" src="./assets/install-1.png">
  </p>

#### Manual installation

Download the archive, extract it, and copy the `ObsiTerm` folder into the `.obsidian/plugins/` directory of your vault.

### Enable and configure

In Obsidian Settings, open Community plugins, find `ObsiTerm`, and enable it.


<p>
    <img alt="turn on" src="./assets/on.png">
  </p>


In the settings page, you can configure the theme, font size, font family, autocomplete trigger, and more.

<p>
    <img alt="setting" src="./assets/settings.png">
  </p>

### Open terminal

Click the `New Terminal` icon in the left sidebar to open a terminal.

<p>
    <img alt="new Terminal" src="./assets/new.png">
  </p>


### `@` autocomplete


1. Type `@`
2. Continue typing keywords
3. Use `↑` / `↓` to select
4. Press `Tab` or `Enter` to confirm
5. Press `Esc` to cancel

The selected item is inserted as an absolute path.

## Settings

Available options:

- Theme
- Reload themes
- Font size
- Font family
- Autocomplete trigger

Theme files are located in `themes/`.

## License

MIT
