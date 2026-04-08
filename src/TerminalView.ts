import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { VaultScanner } from './VaultScanner';
import { AutocompleteManager } from './AutocompleteManager';
import type { ObsidianContextSnapshot } from './ObsidianContext';
import { spawn, ChildProcess } from 'child_process';
import { TerminalTheme } from './themes';
import { TerminalSettings } from './settings';
import type XTermTerminalPlugin from './main';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export const TERMINAL_VIEW_TYPE = 'xterm-terminal-view';

export class TerminalView extends ItemView {
    private terminal: Terminal | null = null;
    private fitAddon: FitAddon | null = null;
    private ptyProcess: ChildProcess | null = null;
    private resizePipe: fs.WriteStream | null = null;
    private terminalContainer: HTMLElement | null = null;
    private statusBarEl: HTMLElement | null = null;
    private statusHintEl: HTMLElement | null = null;
    private statusSelectionEl: HTMLElement | null = null;
    private statusContextEl: HTMLElement | null = null;
    private scanner: VaultScanner;
    private autocomplete: AutocompleteManager | null = null;
    private currentTheme: TerminalTheme | null = null;
    private plugin: XTermTerminalPlugin;
    private outputAnsiBuffer: string = '';
    private clipboardSequence: number = 0;
    private lastResizeCols: number | null = null;
    private lastResizeRows: number | null = null;
    private inputBuffer: string = '';
    private foregroundStatusBuffer: string = '';
    private foregroundCommands: string[] = [];
    private resizeObserver: ResizeObserver | null = null;
    private fitFrame: number | null = null;
    private shellDisplayName: string = '';
    private unsubscribeContext: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: XTermTerminalPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.scanner = new VaultScanner(this.app);
    }

    getViewType(): string {
        return TERMINAL_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Terminal';
    }

    getIcon(): string {
        return 'square-terminal';
    }

    async onOpen(): Promise<void> {
        const container = this.contentEl;
        container.empty();
        container.addClass('xterm-terminal-view');
        container.style.padding = '0';

        this.statusBarEl = container.createDiv({ cls: 'xterm-terminal-statusbar' });
        this.statusHintEl = this.statusBarEl.createDiv({ cls: 'xterm-terminal-statusbar-hint' });
        this.statusSelectionEl = this.statusBarEl.createDiv({ cls: 'xterm-terminal-statusbar-selection' });
        this.statusContextEl = this.statusBarEl.createDiv({ cls: 'xterm-terminal-statusbar-context' });
        this.statusHintEl.setText('? for shortcuts');
        // Terminal container - below host status bar
        this.terminalContainer = container.createDiv({ cls: 'xterm-terminal-container' });

        // Initialize terminal
        await this.initTerminal();
    }

    private async initTerminal(): Promise<void> {
        if (!this.terminalContainer) return;

        // Get theme from plugin settings
        this.currentTheme = this.plugin.getCurrentTheme();
        const settings = this.plugin.settings;
        const typography = this.getTerminalTypography(settings.fontFamily, settings.fontSize);

        // Create xterm.js terminal
        this.terminal = new Terminal({
            cursorBlink: true,
            cursorStyle: 'bar',
            cursorWidth: 2,
            cursorInactiveStyle: 'outline',
            fontSize: settings.fontSize,
            fontFamily: settings.fontFamily,
            fontWeight: typography.fontWeight,
            fontWeightBold: typography.fontWeightBold,
            lineHeight: typography.lineHeight,
            letterSpacing: typography.letterSpacing,
            customGlyphs: true,
            allowTransparency: false,
            minimumContrastRatio: 4.5,
            theme: this.getVisibleCursorTheme(this.currentTheme),
            allowProposedApi: true,
            scrollback: 10000,
            convertEol: false,  // Let PTY handle line endings
            scrollOnUserInput: true
        });

        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);

        // Open terminal in container
        this.terminal.open(this.terminalContainer);

        await this.ensureTerminalFontReady(settings.fontFamily, settings.fontSize);

        // Update container background to match terminal
        this.contentEl.style.backgroundColor = this.currentTheme.background;
        this.terminalContainer.style.backgroundColor = this.currentTheme.background;

        this.fitAddon.fit();
        this.terminal.onResize(({ cols, rows }) => {
            this.sendResize(cols, rows);
            this.requestTerminalRefresh();
        });

        this.registerDomEvent(this.terminalContainer, 'mousedown', () => {
            void this.plugin.getObsidianContextService()?.captureSnapshotFromActiveMarkdownView();
        }, { capture: true });

        // Initialize autocomplete
        this.autocomplete = new AutocompleteManager(
            this.scanner,
            this.terminalContainer,
            (absolutePath, searchText) => this.handleAutocompleteSelect(absolutePath, searchText)
        );

        this.registerPasteHandling();

        this.setupResizeHandling();
        this.bindContextStatus();

        // Start PTY helper
        await this.startPtyHelper();

        // Setup input handling
        this.setupInputHandling();

        // Focus terminal
        this.terminal.focus();
    }

    /**
     * Get the path to the PTY helper script
     */
    private getPtyHelperPath(): string {
        // @ts-ignore - basePath exists but not in type definitions
        const vaultPath = this.app.vault.adapter.basePath;
        const manifestDir = this.plugin.manifest.dir;
        const pluginDir = manifestDir
            ? (path.isAbsolute(manifestDir) ? manifestDir : path.join(vaultPath, manifestDir))
            : path.join(vaultPath, '.obsidian', 'plugins', this.plugin.manifest.id);

        const helperName = process.platform === 'win32' ? 'pty-helper.exe' : 'pty-helper';
        return path.join(pluginDir, 'resources', helperName);
    }

    /**
     * Start the PTY helper process
     */
    private async startPtyHelper(): Promise<void> {
        const ptyHelperPath = this.getPtyHelperPath();
        const userShell = this.getDefaultShell();
        const workingDirectory = this.getInitialWorkingDirectory();
        const contextRuntimePaths = this.plugin.getObsidianContextService()?.getRuntimePaths();
        const latestContext = this.plugin.getObsidianContextService()?.getLatestSnapshot();
        this.shellDisplayName = userShell;

        try {
            if (!fs.existsSync(ptyHelperPath)) {
                throw new Error(`PTY helper not found at ${ptyHelperPath}`);
            }

            // Create a FIFO (named pipe) for resize events
            // We'll use process.send or a workaround with stdio

            this.ptyProcess = spawn(ptyHelperPath, [userShell], {
                cwd: workingDirectory,
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    LANG: process.env.LANG || 'en_US.UTF-8',
                    OBSITERM_INITIAL_CWD: workingDirectory,
                    OBSITERM_CONTEXT_FILE: contextRuntimePaths?.contextFile ?? '',
                    OBSITERM_SELECTION_FILE: contextRuntimePaths?.selectionFile ?? '',
                    OBSITERM_ACTIVE_FILE: latestContext?.activeFileAbsolutePath ?? '',
                    OBSITERM_ACTIVE_FILE_RELATIVE: latestContext?.activeFilePath ?? '',
                    XTERM_INITIAL_COLS: String(this.terminal?.cols ?? 0),
                    XTERM_INITIAL_ROWS: String(this.terminal?.rows ?? 0),
                },
                stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] // stdin, stdout, stderr, resize fd, status fd
            });

            this.lastResizeCols = this.terminal?.cols ?? null;
            this.lastResizeRows = this.terminal?.rows ?? null;
            this.writeLaunchBanner(userShell, workingDirectory);

            // Get fd 3 for resize events
            // @ts-ignore - stdio[3] exists when we specify 4 pipes
            if (this.ptyProcess.stdio && this.ptyProcess.stdio[3]) {
                // @ts-ignore
                this.resizePipe = this.ptyProcess.stdio[3] as fs.WriteStream;
            }

            // @ts-ignore - stdio[4] exists when we specify 5 pipes
            if (this.ptyProcess.stdio && this.ptyProcess.stdio[4]) {
                // @ts-ignore
                const statusPipe = this.ptyProcess.stdio[4] as NodeJS.ReadableStream;
                statusPipe.on('data', (data: Buffer | string) => {
                    this.handleForegroundStatusChunk(data.toString());
                });
            }

            // Handle PTY output
            this.ptyProcess.stdout?.on('data', (data: Buffer) => {
                const output = this.sanitizeTerminalOutput(data.toString('utf-8'));
                if (output) {
                    this.terminal?.write(output);
                }
            });

            this.ptyProcess.stderr?.on('data', (data: Buffer) => {
                // Show errors in terminal with red color
                const output = this.sanitizeTerminalOutput(data.toString('utf-8'));
                if (output) {
                    this.terminal?.write(`\x1b[31m${output}\x1b[0m`);
                }
            });

            this.ptyProcess.on('close', (code: number) => {
                this.terminal?.writeln(`\r\n\x1b[90m[Shell exited with code ${code}]\x1b[0m`);
                this.terminal?.writeln('\x1b[90mPress any key to restart...\x1b[0m');
                this.ptyProcess = null;
                this.foregroundCommands = [];
            });

            this.ptyProcess.on('error', (err: Error) => {
                this.terminal?.writeln(`\r\n\x1b[31mError: ${err.message}\x1b[0m`);
                this.terminal?.writeln('\x1b[33mMake sure the bundled PTY helper is built and deployed.\x1b[0m');
                this.ptyProcess = null;
                this.foregroundCommands = [];
            });

            // Sync once after startup in case the terminal size changed during launch.
            setTimeout(() => this.sendResize(), 100);

        } catch (error) {
            this.writeStartupFailure(error as Error, userShell, ptyHelperPath, workingDirectory);
        }
    }

    private getDefaultShell(): string {
        if (this.plugin.settings.shellPath.trim().length > 0) {
            return this.plugin.settings.shellPath.trim();
        }

        if (process.platform === 'win32') {
            const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
            const preferredShells = [
                process.env.OBSITERM_SHELL,
                'pwsh.exe',
                'powershell.exe',
                path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
                process.env.COMSPEC,
                'cmd.exe'
            ];

            for (const shellPath of preferredShells) {
                if (!shellPath) continue;
                if (this.commandExists(shellPath)) {
                    return shellPath;
                }
            }

            return 'cmd.exe';
        }

        // GUI apps can inherit a stale SHELL env; prefer the account's actual login shell.
        return os.userInfo().shell || process.env.SHELL || '/bin/bash';
    }

    private commandExists(command: string): boolean {
        if (path.isAbsolute(command)) {
            return fs.existsSync(command);
        }

        const pathEnv = process.env.PATH ?? '';
        const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);
        const extensions = process.platform === 'win32'
            ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
                .split(';')
                .filter(Boolean)
            : [''];

        for (const entry of pathEntries) {
            for (const ext of extensions) {
                const candidate = path.join(entry, process.platform === 'win32' && path.extname(command) ? command : `${command}${ext}`);
                if (fs.existsSync(candidate)) {
                    return true;
                }
            }
        }

        return false;
    }

    private writeLaunchBanner(shellPath: string, workingDirectory: string): void {
        const shellName = path.basename(shellPath);
        const trigger = this.getAutocompleteTrigger();
        const contextRuntimePaths = this.plugin.getObsidianContextService()?.getRuntimePaths();
        const latestContext = this.plugin.getObsidianContextService()?.getLatestSnapshot();
        this.terminal?.writeln(`\x1b[90m[ObsiTerm] shell: ${shellName} | path trigger: ${trigger}\x1b[0m`);
        this.terminal?.writeln(`\x1b[90m[ObsiTerm] cwd: ${workingDirectory}\x1b[0m`);
        if (latestContext?.activeFilePath) {
            this.terminal?.writeln(`\x1b[90m[ObsiTerm] active note: ${latestContext.activeFilePath}\x1b[0m`);
        }
        if (contextRuntimePaths) {
            this.terminal?.writeln(`\x1b[90m[ObsiTerm] context json: ${contextRuntimePaths.contextFile}\x1b[0m`);
            this.terminal?.writeln(`\x1b[90m[ObsiTerm] selection txt: ${contextRuntimePaths.selectionFile}\x1b[0m`);
        }
        this.terminal?.writeln('\x1b[90mUse @ path autocomplete, or paste an image to insert a temp file path.\x1b[0m');
    }

    private writeStartupFailure(error: Error, shellPath: string, ptyHelperPath: string, workingDirectory: string): void {
        this.terminal?.writeln(`\x1b[31mFailed to start terminal: ${error.message}\x1b[0m`);
        this.terminal?.writeln(`\x1b[33mShell: ${shellPath}\x1b[0m`);
        this.terminal?.writeln(`\x1b[33mWorking directory: ${workingDirectory}\x1b[0m`);
        this.terminal?.writeln(`\x1b[33mHelper: ${ptyHelperPath}\x1b[0m`);
        this.terminal?.writeln('\x1b[33mCheck the shell setting, rebuild the helper, or redeploy the plugin.\x1b[0m');
        new Notice(`ObsiTerm failed to start terminal: ${error.message}`, 5000);
    }

    private getInitialWorkingDirectory(): string {
        const vaultPath = this.scanner.getVaultPath();
        const configuredPath = this.plugin.settings.initialWorkingDirectory.trim();
        if (!configuredPath) {
            return vaultPath;
        }

        const expandedPath = this.expandHomeDirectory(configuredPath);
        const resolvedPath = path.isAbsolute(expandedPath)
            ? expandedPath
            : path.resolve(vaultPath, expandedPath);

        try {
            const stats = fs.statSync(resolvedPath);
            if (stats.isDirectory()) {
                return resolvedPath;
            }
        } catch {
            // Fall back to the vault root when the configured path does not exist.
        }

        return vaultPath;
    }

    private expandHomeDirectory(targetPath: string): string {
        if (targetPath === '~') {
            return os.homedir();
        }

        if (targetPath.startsWith('~/') || targetPath.startsWith('~\\')) {
            return path.join(os.homedir(), targetPath.slice(2));
        }

        return targetPath;
    }

    /**
     * Send terminal size to PTY helper via fd 3
     */
    private sendResize(cols = this.terminal?.cols, rows = this.terminal?.rows): void {
        if (!this.terminal || !this.resizePipe || !cols || !rows) return;

        if (this.lastResizeCols === cols && this.lastResizeRows === rows) {
            return;
        }

        // struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel }
        // Pack as 4 unsigned shorts (8 bytes total)
        const buffer = Buffer.alloc(8);
        buffer.writeUInt16LE(rows, 0);     // ws_row
        buffer.writeUInt16LE(cols, 2);     // ws_col
        buffer.writeUInt16LE(0, 4);        // ws_xpixel (unused)
        buffer.writeUInt16LE(0, 6);        // ws_ypixel (unused)

        try {
            this.resizePipe.write(buffer);
            this.lastResizeCols = cols;
            this.lastResizeRows = rows;
        } catch {
            // Ignore resize errors
        }
    }

    /**
     * Setup input handling from xterm.js
     */
    private setupInputHandling(): void {
        if (!this.terminal) return;

        this.terminal.onData((data: string) => {
            this.handleInput(data);
        });
    }

    public sendTextToTerminal(text: string): void {
        if (!this.terminal) return;
        this.terminal.focus();
        this.autocomplete?.deactivate();
        this.terminal.paste(text);
    }

    public sendCurrentSelectionToTerminal(selection: string): void {
        if (!selection) return;
        this.sendTextToTerminal(this.formatSelectionPayload(selection));
    }

    public sendActiveFilePathToTerminal(absolutePath: string): void {
        if (!absolutePath) return;
        this.sendTextToTerminal(this.formatActiveFilePayload(absolutePath));
    }

    public sendContextSummaryToTerminal(summary: string): void {
        if (!summary) return;
        this.sendTextToTerminal(this.formatContextSummaryPayload(summary));
    }

    public sendClaudePromptToTerminal(prompt: string): void {
        if (!prompt) return;
        this.sendTextToTerminal(this.formatClaudePromptPayload(prompt));
    }

    /**
     * Handle system paste so text goes through xterm's paste path and
     * clipboard images become temporary files that terminal tools can read.
     */
    private registerPasteHandling(): void {
        if (!this.terminalContainer) return;

        this.registerDomEvent(
            this.terminalContainer,
            'paste',
            (event: ClipboardEvent) => {
                void this.handlePasteEvent(event);
            },
            { capture: true }
        );
    }

    private async handlePasteEvent(event: ClipboardEvent): Promise<void> {
        const clipboardData = event.clipboardData;
        if (!clipboardData || !this.terminal) return;

        const imageItem = Array.from(clipboardData.items).find((item) => item.type.startsWith('image/'));
        if (imageItem) {
            event.preventDefault();
            event.stopPropagation();

            const imageFile = imageItem.getAsFile();
            if (!imageFile) return;

            await this.handleImagePaste(imageFile);
            return;
        }

        const text = clipboardData.getData('text/plain');
        if (!text) return;

        event.preventDefault();
        event.stopPropagation();

        this.autocomplete?.deactivate();
        this.inputBuffer = text.includes('\n') || text.includes('\r') ? '' : this.inputBuffer + text;

        this.terminal.paste(text);
    }

    private async handleImagePaste(imageFile: File): Promise<void> {
        try {
            const ext = this.getClipboardImageExtension(imageFile.type);
            const tempDir = path.join(os.tmpdir(), 'xterm-obsidian-paste');
            await fs.promises.mkdir(tempDir, { recursive: true });

            const fileName = `clipboard-${Date.now()}-${this.clipboardSequence++}.${ext}`;
            const filePath = path.join(tempDir, fileName);
            const imageBuffer = Buffer.from(await imageFile.arrayBuffer());

            await fs.promises.writeFile(filePath, imageBuffer);

            this.autocomplete?.deactivate();
            this.inputBuffer = '';

            const pastedPath = filePath.includes(' ') ? `"${filePath}"` : filePath;
            this.terminal?.paste(pastedPath);

            new Notice(`Image saved to ${filePath}`, 3000);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`Failed to paste image: ${message}`, 4000);
        }
    }

    private getClipboardImageExtension(mimeType: string): string {
        switch (mimeType) {
            case 'image/jpeg':
                return 'jpg';
            case 'image/gif':
                return 'gif';
            case 'image/webp':
                return 'webp';
            default:
                return 'png';
        }
    }

    private sanitizeTerminalOutput(chunk: string): string {
        const combined = this.outputAnsiBuffer + chunk;
        const incompleteSequenceStart = this.findIncompleteAnsiSequenceStart(combined);

        let completeOutput = combined;
        this.outputAnsiBuffer = '';

        if (incompleteSequenceStart !== -1) {
            completeOutput = combined.slice(0, incompleteSequenceStart);
            this.outputAnsiBuffer = combined.slice(incompleteSequenceStart);
        }

        return this.stripBackgroundColors(completeOutput);
    }

    private findIncompleteAnsiSequenceStart(output: string): number {
        const lastEscapeIndex = output.lastIndexOf('\x1b');
        if (lastEscapeIndex === -1) {
            return -1;
        }

        const trailingSequence = output.slice(lastEscapeIndex);
        if (trailingSequence[1] !== '[') {
            return trailingSequence.length === 1 ? lastEscapeIndex : -1;
        }

        return /\x1b\[[0-9;]*$/.test(trailingSequence) ? lastEscapeIndex : -1;
    }

    private stripBackgroundColors(output: string): string {
        return output.replace(/\x1b\[([0-9;]*)m/g, (fullMatch, rawParams: string) => {
            const filteredParams = this.filterSgrParams(rawParams);
            return filteredParams === null ? '' : `\x1b[${filteredParams}m`;
        });
    }

    private filterSgrParams(rawParams: string): string | null {
        if (rawParams === '') {
            return rawParams;
        }

        const tokens = rawParams.split(';');
        const filtered: string[] = [];

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const code = Number(token || 0);

            if (!Number.isFinite(code)) {
                filtered.push(token);
                continue;
            }

            if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107) || code === 49) {
                continue;
            }

            if (code === 48) {
                const mode = tokens[i + 1];
                if (mode === '5') {
                    i += 2;
                } else if (mode === '2') {
                    i += 4;
                }
                continue;
            }

            filtered.push(token);
        }

        return filtered.length > 0 ? filtered.join(';') : null;
    }

    /**
     * Handle input from terminal
     */
    private handleInput(data: string): void {
        // If no PTY process, try to restart on any key
        if (!this.ptyProcess) {
            this.startPtyHelper();
            return;
        }

        if (this.autocomplete?.isActive()) {
            // Handle autocomplete navigation keys
            if (data === '\x1b[A') { // Up
                this.autocomplete.handleSpecialKey('ArrowUp');
                return;
            } else if (data === '\x1b[B') { // Down
                this.autocomplete.handleSpecialKey('ArrowDown');
                return;
            } else if (data === '\t') { // Tab
                this.autocomplete.handleSpecialKey('Tab');
                return;
            } else if (data === '\r') { // Enter - select autocomplete
                this.autocomplete.handleSpecialKey('Enter');
                return;
            } else if (data === '\x1b') { // Escape
                this.autocomplete.handleSpecialKey('Escape');
                return;
            }

            // Let autocomplete handle the input
            if (this.autocomplete.handleInput(data, this.inputBuffer.length)) {
                // Also send to PTY so it appears in terminal
                this.writeToPty(data);

                if (data === '\x7f' || data === '\b') {
                    this.inputBuffer = this.inputBuffer.slice(0, -1);
                } else {
                    this.inputBuffer += data;
                }
                return;
            } else {
                // Enter closes autocomplete without selection
            }
        }

        const trigger = this.getAutocompleteTrigger();
        if (this.shouldActivateAutocomplete(data, trigger)) {
            this.inputBuffer += data;
            this.writeToPty(data);
            this.autocomplete?.activate(this.inputBuffer.length);
            return;
        }

        // Track input buffer for autocomplete replacement
        if (data === '\r' || data === '\n') {
            this.inputBuffer = '';
        } else if (data === '\x7f' || data === '\b') {
            this.inputBuffer = this.inputBuffer.slice(0, -1);
        } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
            this.inputBuffer += data;
        }

        // Forward everything else to PTY
        this.writeToPty(data);
    }

    /**
     * Write data to PTY process
     */
    private writeToPty(data: string): void {
        if (this.ptyProcess?.stdin) {
            this.ptyProcess.stdin.write(data);
        }
    }

    /**
     * Handle autocomplete selection
     */
    private handleAutocompleteSelect(absolutePath: string, searchText: string): void {
        if (!this.ptyProcess?.stdin) return;

        const deleteCount = searchText.length + this.getAutocompleteTrigger().length;

        // Send backspaces to delete @searchText
        for (let i = 0; i < deleteCount; i++) {
            this.writeToPty('\x7f'); // Backspace
        }

        // If path contains spaces, wrap in quotes
        const pathToInsert = absolutePath.includes(' ') ? `"${absolutePath}"` : absolutePath;

        // Send the path
        this.writeToPty(pathToInsert);
        // Update input buffer
        this.inputBuffer = this.inputBuffer.slice(0, -(deleteCount)) + pathToInsert;
    }

    /**
     * Apply a new theme to the terminal
     */
    public applyTheme(theme: TerminalTheme): void {
        if (!this.terminal) return;

        this.currentTheme = theme;
        this.terminal.options.theme = this.getVisibleCursorTheme(theme);

        // Update container background
        this.contentEl.style.backgroundColor = theme.background;
        if (this.terminalContainer) {
            this.terminalContainer.style.backgroundColor = theme.background;
        }
    }

    /**
     * Apply new settings to the terminal
     */
    public applySettings(settings: TerminalSettings): void {
        if (!this.terminal) return;

        const typography = this.getTerminalTypography(settings.fontFamily, settings.fontSize);
        this.terminal.options.fontSize = settings.fontSize;
        this.terminal.options.fontFamily = settings.fontFamily;
        this.terminal.options.fontWeight = typography.fontWeight;
        this.terminal.options.fontWeightBold = typography.fontWeightBold;
        this.terminal.options.lineHeight = typography.lineHeight;
        this.terminal.options.letterSpacing = typography.letterSpacing;

        void this.ensureTerminalFontReady(settings.fontFamily, settings.fontSize).then(() => {
            this.scheduleFit();
        });
    }

    /**
     * Cleanup resources
     */
    private cleanup(): void {
        this.outputAnsiBuffer = '';
        this.foregroundStatusBuffer = '';
        this.foregroundCommands = [];
        this.contentEl.style.backgroundColor = '';
        this.contentEl.style.padding = '';
        this.unsubscribeContext?.();
        this.unsubscribeContext = null;
        this.statusBarEl?.remove();
        this.statusBarEl = null;
        this.statusHintEl = null;
        this.statusSelectionEl = null;
        this.statusContextEl = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        if (this.fitFrame !== null) {
            cancelAnimationFrame(this.fitFrame);
            this.fitFrame = null;
        }

        // Close resize pipe first to stop any pending resize events
        if (this.resizePipe) {
            try {
                this.resizePipe.end();
            } catch {
                // Ignore
            }
            this.resizePipe = null;
        }

        // Kill PTY process with timeout fallback
        if (this.ptyProcess) {
            const proc = this.ptyProcess;
            this.ptyProcess = null;

            // First try SIGTERM for graceful shutdown
            proc.kill('SIGTERM');

            // Force SIGKILL after 200ms if still running
            setTimeout(() => {
                try {
                    proc.kill('SIGKILL');
                } catch {
                    // Process already dead, ignore
                }
            }, 200);
        }

        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = null;
        }
        if (this.fitAddon) {
            this.fitAddon.dispose();
            this.fitAddon = null;
        }
        this.autocomplete?.deactivate();
    }

    async onClose(): Promise<void> {
        this.cleanup();
    }

    private getAutocompleteTrigger(): string {
        return this.plugin.settings.autocompleteTrigger || '@';
    }

    private setupResizeHandling(): void {
        if (!this.terminalContainer) return;

        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => {
            this.scheduleFit();
        });
        this.resizeObserver.observe(this.terminalContainer);

        this.registerEvent(
            this.app.workspace.on('resize', () => {
                this.scheduleFit();
            })
        );
    }

    private scheduleFit(): void {
        if (this.fitFrame !== null) {
            cancelAnimationFrame(this.fitFrame);
        }

        this.fitFrame = requestAnimationFrame(() => {
            this.fitFrame = null;
            this.fitAddon?.fit();
            this.requestTerminalRefresh();
        });
    }

    private async ensureTerminalFontReady(fontFamily: string, fontSize: number): Promise<void> {
        if (!('fonts' in document)) {
            return;
        }

        try {
            const fontFaceSet = document.fonts;
            const fontSpec = `${fontSize}px ${fontFamily}`;
            if (fontFaceSet.check(fontSpec)) {
                return;
            }

            await Promise.race([
                fontFaceSet.load(fontSpec),
                new Promise((resolve) => window.setTimeout(resolve, 800))
            ]);
        } catch {
            // Ignore font loading failures and fall back to current metrics.
        }
    }

    private requestTerminalRefresh(): void {
        if (!this.terminal || this.terminal.rows <= 0) return;
        requestAnimationFrame(() => {
            if (!this.terminal || this.terminal.rows <= 0) return;
            this.terminal.refresh(0, this.terminal.rows - 1);
        });
    }

    private getTerminalTypography(fontFamily: string, fontSize: number): {
        fontWeight: '400';
        fontWeightBold: '500' | '600';
        lineHeight: number;
        letterSpacing: -1 | 0;
    } {
        const normalized = fontFamily.toLowerCase();
        const compactFonts = [
            'jetbrainsmono',
            'jetbrains mono',
            'nerd font',
            'cascadia',
            'fira code',
            'monaspace',
            'iosevka'
        ];
        const shouldTightenSpacing = compactFonts.some((fontName) => normalized.includes(fontName));
        const shouldUseCompactTracking = shouldTightenSpacing && fontSize >= 15;

        return {
            fontWeight: '400',
            fontWeightBold: shouldTightenSpacing ? '500' : '600',
            lineHeight: shouldTightenSpacing ? 1.06 : 1.04,
            letterSpacing: shouldUseCompactTracking ? -1 : 0
        };
    }

    private shouldActivateAutocomplete(data: string, trigger: string): boolean {
        if (!trigger) return false;
        if (data.length !== 1) return false;
        if (data.charCodeAt(0) < 32) return false;
        if (trigger === '@' && this.isAgentCliInForeground()) return false;

        const nextBuffer = this.inputBuffer + data;
        return nextBuffer.endsWith(trigger);
    }

    private handleForegroundStatusChunk(chunk: string): void {
        this.foregroundStatusBuffer += chunk;
        const lines = this.foregroundStatusBuffer.split('\n');
        this.foregroundStatusBuffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.startsWith('foreground')) continue;
            const commands = line
                .split('\t')
                .slice(1)
                .map((command) => command.trim())
                .filter((command) => command.length > 0);
            this.foregroundCommands = commands;
            this.updateStatusBar(this.plugin.getObsidianContextService()?.getLatestSnapshot() ?? null);
        }
    }

    private isAgentCliInForeground(): boolean {
        return this.foregroundCommands.some((command) => this.matchesAgentCli(command));
    }

    private matchesAgentCli(command: string): boolean {
        const normalized = command.toLowerCase();
        return normalized.includes('claude')
            || normalized.includes('codex')
            || normalized.includes('gemini');
    }

    private bindContextStatus(): void {
        this.unsubscribeContext?.();
        const contextService = this.plugin.getObsidianContextService();
        if (!contextService) {
            return;
        }

        this.unsubscribeContext = contextService.subscribe((snapshot) => {
            this.updateStatusBar(snapshot);
        });
    }

    private updateStatusBar(snapshot: ObsidianContextSnapshot | null): void {
        if (!this.statusBarEl || !this.statusHintEl || !this.statusSelectionEl || !this.statusContextEl) {
            return;
        }

        const agentCliInForeground = this.isAgentCliInForeground();
        this.statusBarEl.toggleClass('is-agent-active', agentCliInForeground);
        this.statusHintEl.setText(agentCliInForeground ? '? for shortcuts' : 'Obsidian context');

        if (!snapshot) {
            this.statusSelectionEl.setText('No note context');
            this.statusContextEl.setText('');
            return;
        }

        this.statusSelectionEl.setText(
            snapshot.hasSelection
                ? `${snapshot.selectedLineCount} line${snapshot.selectedLineCount === 1 ? '' : 's'} selected`
                : 'No current selection'
        );
        this.statusContextEl.setText(snapshot.activeFilePath ?? 'No active note');
    }

    private formatSelectionPayload(selection: string): string {
        if (this.isPowerShellShell()) {
            return `$obsitermSelection = @'\r\n${this.normalizeForPowerShell(selection)}\r\n'@\r\n`;
        }

        if (this.isPosixShell()) {
            return `export OBSITERM_SELECTION=$(cat <<'EOF'\n${selection}\nEOF\n)\n`;
        }

        return `${selection}\n`;
    }

    private formatActiveFilePayload(absolutePath: string): string {
        if (this.isPowerShellShell()) {
            return `$obsitermActiveFile = '${this.escapePowerShellSingleQuoted(absolutePath)}'\r\n`;
        }

        if (this.isPosixShell()) {
            return `export OBSITERM_ACTIVE_FILE='${this.escapePosixSingleQuoted(absolutePath)}'\n`;
        }

        return `${absolutePath.includes(' ') ? `"${absolutePath}"` : absolutePath}\n`;
    }

    private formatContextSummaryPayload(summary: string): string {
        if (this.isPowerShellShell()) {
            return `$obsitermContext = @'\r\n${this.normalizeForPowerShell(summary)}\r\n'@\r\n`;
        }

        if (this.isPosixShell()) {
            return `export OBSITERM_CONTEXT=$(cat <<'EOF'\n${summary}\nEOF\n)\n`;
        }

        return `${summary}\n`;
    }

    private formatClaudePromptPayload(prompt: string): string {
        if (this.isAgentCliInForeground()) {
            return `${prompt}\r\n`;
        }

        if (this.isPowerShellShell()) {
            return `$obsitermClaudePrompt = @'\r\n${this.normalizeForPowerShell(prompt)}\r\n'@\r\n`;
        }

        if (this.isPosixShell()) {
            return `export OBSITERM_CLAUDE_PROMPT=$(cat <<'EOF'\n${prompt}\nEOF\n)\n`;
        }

        return `${prompt}\n`;
    }

    private isPowerShellShell(): boolean {
        const shellName = path.basename(this.shellDisplayName || '').toLowerCase();
        return shellName === 'powershell.exe' || shellName === 'pwsh.exe' || shellName === 'powershell' || shellName === 'pwsh';
    }

    private isPosixShell(): boolean {
        const shellName = path.basename(this.shellDisplayName || '').toLowerCase();
        return shellName === 'bash' || shellName === 'zsh' || shellName === 'sh' || shellName === 'fish';
    }

    private escapePowerShellSingleQuoted(value: string): string {
        return value.replace(/'/g, "''");
    }

    private normalizeForPowerShell(value: string): string {
        return value.replace(/\r?\n/g, '\r\n');
    }

    private escapePosixSingleQuoted(value: string): string {
        return value.replace(/'/g, `'\\''`);
    }

    private getVisibleCursorTheme(theme: TerminalTheme): TerminalTheme {
        const fallbackCursor = this.getHighContrastColor(theme.background);
        const resolvedCursor = this.isCursorVisible(theme.cursor, theme.background)
            ? theme.cursor
            : fallbackCursor;
        const resolvedCursorAccent = this.isCursorVisible(theme.cursorAccent, resolvedCursor)
            ? theme.cursorAccent
            : theme.background;

        return {
            ...theme,
            cursor: resolvedCursor,
            cursorAccent: resolvedCursorAccent
        };
    }

    private isCursorVisible(cursorColor: string, backgroundColor: string): boolean {
        if (!cursorColor || cursorColor === 'transparent') {
            return false;
        }

        return this.getColorDistance(cursorColor, backgroundColor) >= 80;
    }

    private getHighContrastColor(backgroundColor: string): string {
        const rgb = this.parseHexColor(backgroundColor);
        if (!rgb) return '#ffffff';

        const luminance = (0.299 * rgb.r) + (0.587 * rgb.g) + (0.114 * rgb.b);
        return luminance > 186 ? '#111111' : '#f5f5f5';
    }

    private getColorDistance(colorA: string, colorB: string): number {
        const rgbA = this.parseHexColor(colorA);
        const rgbB = this.parseHexColor(colorB);
        if (!rgbA || !rgbB) return Number.POSITIVE_INFINITY;

        const r = rgbA.r - rgbB.r;
        const g = rgbA.g - rgbB.g;
        const b = rgbA.b - rgbB.b;
        return Math.sqrt((r * r) + (g * g) + (b * b));
    }

    private parseHexColor(value: string): { r: number; g: number; b: number } | null {
        const normalized = value.trim();
        const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
        if (!/^[0-9a-f]{6}$/i.test(hex)) {
            return null;
        }

        return {
            r: Number.parseInt(hex.slice(0, 2), 16),
            g: Number.parseInt(hex.slice(2, 4), 16),
            b: Number.parseInt(hex.slice(4, 6), 16),
        };
    }
}
