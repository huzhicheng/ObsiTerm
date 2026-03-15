import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { VaultScanner } from './VaultScanner';
import { AutocompleteManager } from './AutocompleteManager';
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
    private scanner: VaultScanner;
    private autocomplete: AutocompleteManager | null = null;
    private currentTheme: TerminalTheme | null = null;
    private plugin: XTermTerminalPlugin;
    private outputAnsiBuffer: string = '';
    private clipboardSequence: number = 0;

    // For @ autocomplete - track what user is typing
    private inputBuffer: string = '';
    private isCapturingAtSearch: boolean = false;
    private atSearchText: string = '';

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
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('xterm-terminal-view');

        // Terminal container - no header, full height
        this.terminalContainer = container.createDiv({ cls: 'xterm-terminal-container' });

        // Initialize terminal
        await this.initTerminal();
    }

    private async initTerminal(): Promise<void> {
        if (!this.terminalContainer) return;

        // Get theme from plugin settings
        this.currentTheme = this.plugin.getCurrentTheme();
        const settings = this.plugin.settings;

        // Create xterm.js terminal
        this.terminal = new Terminal({
            cursorBlink: true,
            fontSize: settings.fontSize,
            fontFamily: settings.fontFamily,
            theme: this.currentTheme,
            allowProposedApi: true,
            scrollback: 10000,
            convertEol: false,  // Let PTY handle line endings
            scrollOnUserInput: true
        });

        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);

        // Open terminal in container
        this.terminal.open(this.terminalContainer);

        // Update container background to match terminal
        this.terminalContainer.style.backgroundColor = this.currentTheme.background;

        this.fitAddon.fit();

        // Initialize autocomplete
        this.autocomplete = new AutocompleteManager(
            this.scanner,
            this.terminalContainer,
            (absolutePath, searchText) => this.handleAutocompleteSelect(absolutePath, searchText)
        );

        this.registerPasteHandling();

        // Handle resize
        this.registerEvent(
            this.app.workspace.on('resize', () => {
                setTimeout(() => {
                    this.fitAddon?.fit();
                    this.sendResize();
                }, 300);  // Increased debounce for better performance
            })
        );

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
        const pluginsDir = path.join(vaultPath, '.obsidian', 'plugins');

        try {
            // Scan all plugin directories to find one with pty-helper.py
            const pluginFolders = fs.readdirSync(pluginsDir);

            for (const folder of pluginFolders) {
                const ptyPath = path.join(pluginsDir, folder, 'resources', 'pty-helper.py');
                try {
                    if (fs.existsSync(ptyPath)) {
                        return ptyPath;
                    }
                } catch {
                    // Continue checking
                }
            }
        } catch {
            // Ignore directory read errors
        }

        // Fallback: check development path
        const devPath = path.join(this.scanner.getVaultPath(), '..', 'xTermObsidian', 'resources', 'pty-helper.py');
        if (fs.existsSync(devPath)) {
            return devPath;
        }

        // Last resort fallback
        return path.join(pluginsDir, 'obsidian-term', 'resources', 'pty-helper.py');
    }

    /**
     * Start the PTY helper process
     */
    private async startPtyHelper(): Promise<void> {
        const pythonPath = this.findPython();
        const ptyHelperPath = this.getPtyHelperPath();

        // Get user's preferred shell
        const userShell = process.env.SHELL || '/bin/zsh';

        try {
            // Create a FIFO (named pipe) for resize events
            // We'll use process.send or a workaround with stdio

            this.ptyProcess = spawn(pythonPath, [ptyHelperPath, userShell], {
                cwd: this.scanner.getVaultPath(),
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    LANG: process.env.LANG || 'en_US.UTF-8',
                },
                stdio: ['pipe', 'pipe', 'pipe', 'pipe'] // stdin, stdout, stderr, resize fd
            });

            // Get fd 3 for resize events
            // @ts-ignore - stdio[3] exists when we specify 4 pipes
            if (this.ptyProcess.stdio && this.ptyProcess.stdio[3]) {
                // @ts-ignore
                this.resizePipe = this.ptyProcess.stdio[3] as fs.WriteStream;
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
            });

            this.ptyProcess.on('error', (err: Error) => {
                this.terminal?.writeln(`\r\n\x1b[31mError: ${err.message}\x1b[0m`);
                this.terminal?.writeln('\x1b[33mMake sure Python 3 is installed.\x1b[0m');
                this.ptyProcess = null;
            });

            // Send initial terminal size
            setTimeout(() => this.sendResize(), 100);

        } catch (error) {
            this.terminal?.writeln(`\x1b[31mFailed to start terminal: ${(error as Error).message}\x1b[0m`);
            this.terminal?.writeln('\x1b[33mMake sure Python 3 is installed and pty-helper.py exists.\x1b[0m');
        }
    }

    /**
     * Find Python 3 executable
     */
    private findPython(): string {
        // Common Python 3 paths
        const pythonPaths = [
            '/usr/bin/python3',
            '/usr/local/bin/python3',
            '/opt/homebrew/bin/python3',
            'python3',
            'python'
        ];

        for (const p of pythonPaths) {
            try {
                if (p.startsWith('/') && fs.existsSync(p)) {
                    return p;
                }
            } catch {
                // Continue checking
            }
        }

        // Default to python3 and hope it's in PATH
        return 'python3';
    }

    /**
     * Send terminal size to PTY helper via fd 3
     */
    private sendResize(): void {
        if (!this.terminal || !this.resizePipe) return;

        const cols = this.terminal.cols;
        const rows = this.terminal.rows;

        // struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel }
        // Pack as 4 unsigned shorts (8 bytes total)
        const buffer = Buffer.alloc(8);
        buffer.writeUInt16LE(rows, 0);     // ws_row
        buffer.writeUInt16LE(cols, 2);     // ws_col
        buffer.writeUInt16LE(0, 4);        // ws_xpixel (unused)
        buffer.writeUInt16LE(0, 6);        // ws_ypixel (unused)

        try {
            this.resizePipe.write(buffer);
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
        this.isCapturingAtSearch = false;
        this.atSearchText = '';
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
            this.isCapturingAtSearch = false;
            this.atSearchText = '';
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

            if (code === 7) {
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

        // Handle @ autocomplete
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

                // Track for path replacement
                if (data === '\x7f' || data === '\b') {
                    this.atSearchText = this.atSearchText.slice(0, -1);
                    this.inputBuffer = this.inputBuffer.slice(0, -1);
                } else {
                    this.atSearchText += data;
                    this.inputBuffer += data;
                }
                return;
            } else {
                // Enter closes autocomplete without selection
                this.isCapturingAtSearch = false;
                this.atSearchText = '';
            }
        }

        // Detect @ to trigger autocomplete
        if (data === '@') {
            this.isCapturingAtSearch = true;
            this.atSearchText = '';
            this.inputBuffer += data;
            this.writeToPty(data);
            this.autocomplete?.handleInput(data, this.inputBuffer.length);
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

        // Calculate how many characters to delete (@searchText)
        const deleteCount = searchText.length + 1; // +1 for @

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
        this.isCapturingAtSearch = false;
        this.atSearchText = '';
    }

    /**
     * Apply a new theme to the terminal
     */
    public applyTheme(theme: TerminalTheme): void {
        if (!this.terminal) return;

        this.currentTheme = theme;
        this.terminal.options.theme = theme;

        // Update container background
        if (this.terminalContainer) {
            this.terminalContainer.style.backgroundColor = theme.background;
        }
    }

    /**
     * Apply new settings to the terminal
     */
    public applySettings(settings: TerminalSettings): void {
        if (!this.terminal) return;

        this.terminal.options.fontSize = settings.fontSize;
        this.terminal.options.fontFamily = settings.fontFamily;

        // Refit terminal after font changes
        setTimeout(() => {
            this.fitAddon?.fit();
            this.sendResize();
        }, 50);
    }

    /**
     * Cleanup resources
     */
    private cleanup(): void {
        this.outputAnsiBuffer = '';

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
}
