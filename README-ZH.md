<div align="center">
  <h1>ObsiTerm</h1>
  <p><em>运行在 Obsidian 右侧边栏中的终端插件，可直接配合 Claude Code、Codex、Gemini CLI 等命令行工具使用。</em></p>
  <p><a href="./README.md">English</a></p>
  <p>
    <img alt="version" src="https://img.shields.io/badge/version-v1.0.1-1677ff?style=flat-square">
    <img alt="license" src="https://img.shields.io/badge/license-MIT-1677ff?style=flat-square">
    <img alt="platform" src="https://img.shields.io/badge/desktop-macOS%20%7C%20Windows-6f42c1?style=flat-square">
    <a href="https://github.com/Youket/ObsiTerm"><img alt="repo" src="https://img.shields.io/badge/fork-Youket%2FObsiTerm-f97316?style=flat-square"></a>
  </p>
  <p>
    <img alt="ObsiTerm Preview" src="./assets/light-theme.png">
  </p>
</div>

## 概览

`ObsiTerm` 会在 Obsidian Desktop 的右侧边栏中打开一个真实终端。目前同一套源码同时支持 macOS 和 Windows。

## 功能

- 在 Obsidian 内直接使用终端，支持实时交互
- 适合运行 Claude Code、Codex、Gemini CLI 等命令行工具
- 支持基于 `@` 的 vault 文件和文件夹绝对路径补全
- 支持 Ghostty 主题兼容和内置主题
- 可配置字体、字号、补全触发符、shell 命令、初始目录
- 支持粘贴大段文本，或将图片粘贴成临时文件路径
- 会把当前笔记路径和选中文本同步到终端可读取的运行时文件

## 安装

### 从 Releases 安装

从 [Releases](https://github.com/Youket/ObsiTerm/releases) 页面下载对应平台的压缩包：

- `ObsiTerm-macos-...zip`：macOS
- `ObsiTerm-windows-...zip`：Windows

解压后，将 `obsidian-term` 文件夹复制到你的 vault 的 `.obsidian/plugins/` 目录下。

### 本地开发安装

1. 将仓库 clone 到任意目录。
2. 安装依赖：

```bash
npm install
```

3. 构建：

```bash
npm run build
```

4. 将以下文件复制到 `.obsidian/plugins/obsidian-term/`：

- `main.js`
- `manifest.json`
- `styles.css`
- `themes/`
- macOS：`resources/pty-helper`
- Windows：`resources/pty-helper.exe`

## 本地部署

推荐使用跨平台命令：

```bash
npm run deploy
```

可选环境变量：

- `OBSIDIAN_PLUGIN_DIR`
  - macOS 示例：`/Users/name/Vault/.obsidian/plugins/obsidian-term`
  - Windows 示例：`E:\Vault\.obsidian\plugins\obsidian-term`

它会执行：

- `npm run build`
- 刷新 `releases/<platform>/obsidian-term`
- 如果设置了 `OBSIDIAN_PLUGIN_DIR`，则把插件包同步到本地 Obsidian 插件目录

仓库中的 `deploy.sh` 现在只是 Unix shell 的兼容包装，推荐统一使用 `npm run deploy`。

## GitHub 发布

推荐使用跨平台命令：

```bash
npm run release:github
```

这个命令会把当前平台的 `releases/<platform>/obsidian-term` 打包成 zip，并上传到 GitHub Releases。

常用选项：

```bash
npm run release:github -- --dry-run
npm run release:github -- --skip-build
npm run release:github -- --prerelease
npm run release:github -- --platform windows
npm run release:github -- --platform macos
```

注意：

- Windows 资源包应在 Windows 上构建
- macOS 资源包应在 macOS 上构建
- 发布前需要先安装并登录 `gh`

## 使用

### 启用与配置

在 Obsidian 设置中打开“社区插件”，找到 `ObsiTerm` 并启用。

可配置项包括：

- 主题
- 字号
- 字体
- 自动补全触发符
- shell 命令覆盖
- 初始目录

### 初始目录

如果你希望新终端标签默认从用户目录之外的位置启动，可以使用 `Initial Directory / 初始目录` 设置。

- 留空时，终端从 vault 根目录启动
- 可填写相对路径，例如 `.` 或 `./scripts`，相对于 vault 根目录解析
- 可填写绝对路径，例如 `E:\Projects` 或 `/Users/name/Projects`
- `~`、`~/...`、`~\...` 会展开到当前用户目录

如果配置的目录不存在，ObsiTerm 会自动回退到 vault 根目录。

### 打开终端

点击左侧边栏中的 `New Terminal` 图标。

### `@` 自动补全

1. 输入 `@`
2. 继续输入关键字
3. 使用方向键选择
4. 按 `Tab` 或 `Enter` 确认
5. 按 `Esc` 取消

选中的项目会直接插入为绝对路径。

### 当前笔记与选区上下文

ObsiTerm 会把当前笔记上下文写入终端可读取的运行时文件：

- `OBSITERM_CONTEXT_FILE`：当前笔记、光标、选区等信息的 JSON 快照
- `OBSITERM_SELECTION_FILE`：当前选中文本的纯文本文件
- `OBSITERM_ACTIVE_FILE`：终端标签打开时的当前笔记绝对路径

当你在 Obsidian 中切换笔记、编辑内容或修改选区时，JSON 文件会持续更新。

终端中常见的读取方式：

```bash
cat "$OBSITERM_CONTEXT_FILE"
cat "$OBSITERM_SELECTION_FILE"
```

Windows PowerShell：

```powershell
Get-Content $env:OBSITERM_CONTEXT_FILE
Get-Content $env:OBSITERM_SELECTION_FILE
```

命令面板里的辅助命令：

- `ObsiTerm: Copy Obsidian Context File Path`
- `ObsiTerm: Copy Current Note Selection`
- `ObsiTerm: Send Current Selection To Terminal`
- `ObsiTerm: Send Active Note Path To Terminal`
- `ObsiTerm: Send Obsidian Context Summary To Terminal`
- `ObsiTerm: Send Current Selection As Claude Prompt`
- `ObsiTerm: Send Active Note As Claude Prompt`

### 终端上下文状态栏

参考 Claude Code 的 IDE footer，每个终端视图顶部都有一条由宿主侧渲染的轻量状态栏。

- 显示当前 Obsidian 选中的行数
- 显示当前活动笔记路径
- 当前台检测到 Claude Code、Codex CLI 或 Gemini CLI 时，提示会切换成 `? for shortcuts`
- 右上角提供 `Send Selection` 和 `Send Note` 按钮，可直接发送 Claude 风格的 prompt
- 在终端区域内点击鼠标右键，也可以看到同样的 Claude prompt 操作菜单

这个设计的目的是让 Obsidian 侧上下文保持可见，而不必要求终端工具先手动读取运行时文件。

## 开发说明

- `npm run build` 会同时构建 TypeScript 插件和原生 PTY helper
- 修改代码后，推荐执行 `npm run deploy`
- 如果 Windows 提示 `resources/pty-helper.exe` 被占用，先关闭 Obsidian，再重新构建以刷新 helper

## 许可证

MIT
