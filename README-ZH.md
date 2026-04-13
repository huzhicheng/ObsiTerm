<div align="center">
  <h1>ObsiTerm</h1>
  <p><em>运行在 Obsidian 右侧边栏中的终端插件，可直接配合 Claude Code、Codex、Gemini CLI 等命令行工具使用。</em></p>
  <p><a href="./README.md">English</a></p>
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

## 概览

`ObsiTerm` 会在 Obsidian Desktop 的右侧边栏中打开一个真实终端。当前同一套源码同时支持 macOS 和 Windows。

## 功能

- 在 Obsidian 内直接使用终端，支持实时交互
- 适合运行 Claude Code、Codex、Gemini CLI 等命令行工具
- 支持基于 `@` 的 vault 文件和文件夹绝对路径补全
- 支持 Ghostty 主题兼容和内置主题
- 可配置字体、字号、补全触发符、shell 命令、初始目录
- 支持粘贴大段文本，或将图片粘贴成临时文件路径
- 可同步当前笔记、当前选区、当前行、光标位置等上下文
- 内置 HTTP bridge、CLI 和 MCP server，便于终端工具读取 Obsidian 上下文

## 安装

### 从 Releases 安装

从 [Releases](https://github.com/Youket/ObsiTerm/releases) 页面下载对应平台的压缩包：

- `ObsiTerm-macos-...zip`
- `ObsiTerm-windows-...zip`

解压后，将 `obsidian-term` 文件夹复制到你的 vault 的 `.obsidian/plugins/` 目录下。

### 开箱即用的功能

只要安装好插件本身，不需要额外配置 Claude 或 MCP，下列功能就可以直接使用：

- Obsidian 内嵌终端
- `@` 路径补全
- 初始目录设置
- 当前笔记 / 选区运行时文件
- context bridge HTTP 接口
- `Send Selection` / `Send Note` 按钮和命令面板动作
- 内置 CLI：
  - `resources/obsiterm-context.mjs`

也就是说，即使不配置 MCP，用户也能把 Obsidian 上下文传递给终端工作流。

### 需要额外 Claude 配置的部分

插件包里已经带有 MCP server，但 Claude Code 不会自动发现它。  
如果用户想让 Claude Code 直接调用 `get_current_selection`、`get_obsidian_context` 这类工具，还需要在 Claude Code 本地额外配置 MCP。

插件内置的相关文件：

- `resources/obsiterm-context.mjs`
- `resources/obsiterm-mcp.mjs`

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
- `resources/pty-helper`（macOS）
- `resources/pty-helper.exe`（Windows）
- `resources/obsiterm-context.mjs`
- `resources/obsiterm-mcp.mjs`

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
- 如果设置了 `OBSIDIAN_PLUGIN_DIR`，则把插件包复制到本地 Obsidian 插件目录

## GitHub 发布

推荐使用：

```bash
npm run release:github
```

常用选项：

```bash
npm run release:github -- --dry-run
npm run release:github -- --skip-build
npm run release:github -- --prerelease
npm run release:github -- --platform windows
npm run release:github -- --platform macos
```

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

使用 `Initial Directory / 初始目录` 设置新终端标签默认启动位置：

- 留空：从 vault 根目录启动
- 相对路径：如 `.`、`./scripts`
- 绝对路径：如 `E:\Projects` 或 `/Users/name/Projects`
- `~`、`~/...`、`~\...` 会展开到当前用户目录

如果目录不存在，会回退到 vault 根目录。

### 打开终端

点击左侧边栏里的 `New Terminal` 图标。

### `@` 自动补全

1. 输入 `@`
2. 继续输入关键字
3. 用方向键选择
4. 按 `Tab` 或 `Enter` 确认
5. 按 `Esc` 取消

选中项会插入为绝对路径。

### 当前笔记与选区上下文

ObsiTerm 会把当前笔记上下文写入运行时文件：

- `OBSITERM_CONTEXT_FILE`
- `OBSITERM_SELECTION_FILE`
- `OBSITERM_ACTIVE_FILE`
- `OBSITERM_CONTEXT_BRIDGE_URL`
- `OBSITERM_CONTEXT_BRIDGE_TOKEN`
- `OBSITERM_CONTEXT_MCP_CONFIG_FILE`

PowerShell 示例：

```powershell
Get-Content $env:OBSITERM_CONTEXT_FILE
Get-Content $env:OBSITERM_SELECTION_FILE
```

### Context bridge API

ObsiTerm 还会暴露一个本地只读 HTTP bridge，终端工具可以按需查询当前上下文。

可用接口：

- `OBSITERM_CONTEXT_ENDPOINT`
- `OBSITERM_SELECTION_ENDPOINT`
- `OBSITERM_ACTIVE_NOTE_ENDPOINT`
- `OBSITERM_SELECTION_PROMPT_ENDPOINT`
- `OBSITERM_ACTIVE_NOTE_PROMPT_ENDPOINT`
- `OBSITERM_CONTEXT_CLI`
- `OBSITERM_CONTEXT_MCP`
- `OBSITERM_CONTEXT_MCP_CONFIG_FILE`

PowerShell 示例：

```powershell
$headers = @{ Authorization = "Bearer $env:OBSITERM_CONTEXT_BRIDGE_TOKEN" }
Invoke-RestMethod -Headers $headers $env:OBSITERM_SELECTION_ENDPOINT
Invoke-RestMethod -Headers $headers $env:OBSITERM_CONTEXT_ENDPOINT
```

CLI 示例：

```powershell
node $env:OBSITERM_CONTEXT_CLI selection
node $env:OBSITERM_CONTEXT_CLI context
node $env:OBSITERM_CONTEXT_CLI selection-prompt --text
node $env:OBSITERM_CONTEXT_CLI mcp-config
```

### MCP server（给 Claude Code / Codex 等工具）

ObsiTerm 还打包了一个最小可用的 `stdio` MCP server，会复用本地 context bridge，将当前笔记和选区暴露成 MCP tools。

可用 tools：

- `get_obsidian_context`
- `get_current_selection`
- `get_active_note`
- `get_selection_prompt`
- `get_active_note_prompt`

PowerShell 查看环境变量：

```powershell
$env:OBSITERM_CONTEXT_MCP
$env:OBSITERM_CONTEXT_BRIDGE_TOKEN
Get-Content -Raw $env:OBSITERM_CONTEXT_MCP_CONFIG_FILE
```

MCP 配置示例：

```json
{
  "mcpServers": {
    "obsiterm": {
      "command": "node",
      "args": ["E:/YourVault/.obsidian/plugins/ObsiTerm/resources/obsiterm-mcp.mjs"]
    }
  }
}
```

仓库里还提供了一个可直接修改的示例文件：

- [examples/claude-code-obsiterm-mcp.json](/E:/Development/Github/ObsiTerm/examples/claude-code-obsiterm-mcp.json)
- [.claude/settings.example.json](/E:/Development/Github/ObsiTerm/.claude/settings.example.json)
- [.claude/README.md](/E:/Development/Github/ObsiTerm/.claude/README.md)

另一台机器上接入 Claude Code 的常见步骤：

1. 在 Obsidian 中安装最新 ObsiTerm
2. 至少在 ObsiTerm 里打开一次终端，让运行时 bridge 启动
3. 把示例 MCP 配置写入 Claude Code，并把 vault 路径改成那台机器的本地路径
4. 从 ObsiTerm 终端内部启动 Claude Code
5. 在 Claude Code 里运行 `/mcp`，确认 `obsiterm` 已连接

注意：

- 插件 release 会带上 MCP server 脚本，但 Claude 侧的 MCP 注册仍然是可选、且机器本地的步骤
- 如果不配置 Claude MCP，用户依然可以使用按钮、命令、运行时文件、HTTP bridge 和 CLI
- 如果你会在多台机器之间同步 vault 或项目，建议把模板放在 `.claude/` 中随仓库同步，只在本机修改实际 vault 绝对路径

### 命令面板与状态栏

命令面板可用动作包括：

- `ObsiTerm: Copy Obsidian Context File Path`
- `ObsiTerm: Copy Current Note Selection`
- `ObsiTerm: Send Current Selection To Terminal`
- `ObsiTerm: Send Active Note Path To Terminal`
- `ObsiTerm: Send Obsidian Context Summary To Terminal`
- `ObsiTerm: Send Current Selection As Claude Prompt`
- `ObsiTerm: Send Active Note As Claude Prompt`

顶部状态栏会显示：

- 选中行数
- 当前活动笔记路径
- `Send Selection`
- `Send Note`

## 开发说明

- `npm run build` 会同时构建 TypeScript 插件和原生 PTY helper
- `npm run deploy` 是推荐的本地工作流
- 如果 Windows 提示 `resources/pty-helper.exe` 被占用，先关闭 Obsidian 再重试

## 许可证

MIT
