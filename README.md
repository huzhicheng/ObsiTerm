# xTerm Terminal - Obsidian Plugin

在 Obsidian 右侧边栏打开终端界面，支持使用 @ 符号自动补全 vault 中的文件/文件夹绝对路径。

## 功能特点

- 📟 **完整终端体验** - 使用 xterm.js 提供真实的终端界面
- 📁 **@ 符号自动补全** - 输入 `@` 后自动提示 vault 中的文件和文件夹
- 🔗 **绝对路径** - 选择文件后自动插入完整的绝对路径
- 🎨 **美观界面** - 适配 Obsidian 的深色/浅色主题

## 安装

### 手动安装

1. 安装依赖：
   ```bash
   cd /path/to/xTermObsidian
   npm install
   ```

2. 构建插件：
   ```bash
   npm run build
   ```

3. 将以下文件复制到你的 vault 的 `.obsidian/plugins/xterm-terminal/` 目录：
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `themes/`

4. 在 Obsidian 设置 -> 社区插件中启用 "xTerm Terminal"

### 关于 node-pty

由于 `node-pty` 是原生模块，需要针对 Obsidian 的 Electron 版本编译。如果遇到问题：

```bash
# 获取 Obsidian 的 Electron 版本，然后：
npx electron-rebuild -v <electron-version>
```

## 使用方法

1. **打开终端**
   - 点击左侧边栏的终端图标
   - 或使用命令面板 (Cmd/Ctrl + P) 搜索 "Open Terminal"

2. **使用 @ 自动补全**
   - 在终端中输入 `@`
   - 输入文件名进行过滤
   - 使用 ↑/↓ 选择，Tab/Enter 确认
   - 按 Esc 取消

3. **示例**
   ```bash
   cat @readme    # 输入后选择文件，会自动补全为绝对路径
   # 变为: cat "/Volumes/扩展硬盘/obsdian/vault/README.md"
   ```

## 开发

```bash
# 开发模式（监听文件变化）
npm run dev

# 生产构建
npm run build
```
