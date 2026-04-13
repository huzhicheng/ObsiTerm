import { MarkdownView, Notice, normalizePath, type Editor, type TFile } from 'obsidian';
import type XTermTerminalPlugin from './main';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { randomBytes } from 'crypto';

export interface ObsidianContextSnapshot {
    updatedAt: string;
    vaultPath: string;
    activeFilePath: string | null;
    activeFileAbsolutePath: string | null;
    selection: string;
    hasSelection: boolean;
    cursor: {
        line: number;
        ch: number;
    } | null;
    selectionAnchor: {
        line: number;
        ch: number;
    } | null;
    currentLine: string | null;
    selectedLineCount: number;
}

export interface ObsidianContextRuntimePaths {
    runtimeDir: string;
    contextFile: string;
    selectionFile: string;
    mcpConfigFile: string;
}

export interface ObsidianContextBridgeInfo {
    baseUrl: string;
    token: string;
    contextUrl: string;
    selectionUrl: string;
    activeNoteUrl: string;
    selectionPromptUrl: string;
    activeNotePromptUrl: string;
}

export class ObsidianContextService {
    private readonly plugin: XTermTerminalPlugin;
    private pollTimer: number | null = null;
    private lastSerializedContext = '';
    private lastSelection = '';
    private lastComparableContext = '';
    private lastSnapshot: ObsidianContextSnapshot | null = null;
    private lastSelectionSnapshot: ObsidianContextSnapshot | null = null;
    private listeners = new Set<(snapshot: ObsidianContextSnapshot) => void>();
    private bridgeServer: http.Server | null = null;
    private bridgeInfo: ObsidianContextBridgeInfo | null = null;
    private static readonly UTF8_BOM = '\uFEFF';

    constructor(plugin: XTermTerminalPlugin) {
        this.plugin = plugin;
    }

    async start(): Promise<void> {
        await this.startBridgeServer();
        await this.captureSnapshotFromActiveMarkdownView();

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', () => {
                void this.writeContextSnapshot();
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('file-open', () => {
                void this.writeContextSnapshot();
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('editor-change', () => {
                void this.writeContextSnapshot();
            })
        );

        this.pollTimer = window.setInterval(() => {
            void this.captureSnapshotFromActiveMarkdownView();
        }, 400);

        this.plugin.register(() => {
            if (this.pollTimer !== null) {
                window.clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            this.stopBridgeServer();
        });
    }

    getRuntimePaths(): ObsidianContextRuntimePaths {
        const vaultPath = this.getVaultPath();
        const manifestDir = this.plugin.manifest.dir;
        const pluginDir = manifestDir
            ? (path.isAbsolute(manifestDir) ? manifestDir : path.join(vaultPath, manifestDir))
            : path.join(vaultPath, '.obsidian', 'plugins', this.plugin.manifest.id);
        const runtimeDir = path.join(pluginDir, 'runtime');

        return {
            runtimeDir,
            contextFile: path.join(runtimeDir, 'obsidian-context.json'),
            selectionFile: path.join(runtimeDir, 'obsidian-selection.txt'),
            mcpConfigFile: path.join(runtimeDir, 'obsiterm-mcp.json')
        };
    }

    getLatestSnapshot(): ObsidianContextSnapshot {
        const liveSnapshot = this.createSnapshotFromActiveMarkdownView();
        if (liveSnapshot) {
            this.lastSnapshot = liveSnapshot;
            if (liveSnapshot.hasSelection) {
                this.lastSelectionSnapshot = liveSnapshot;
            }
            return liveSnapshot;
        }

        if (this.lastSnapshot) {
            return this.lastSnapshot;
        }

        return this.createEmptySnapshot();
    }

    getLatestSelectionSnapshot(): ObsidianContextSnapshot | null {
        const liveSnapshot = this.createSnapshotFromActiveMarkdownView();
        if (liveSnapshot) {
            this.lastSnapshot = liveSnapshot;
            if (liveSnapshot.hasSelection) {
                this.lastSelectionSnapshot = liveSnapshot;
                return liveSnapshot;
            }
        }

        return this.lastSelectionSnapshot;
    }

    getBridgeInfo(): ObsidianContextBridgeInfo | null {
        return this.bridgeInfo;
    }

    subscribe(listener: (snapshot: ObsidianContextSnapshot) => void): () => void {
        this.listeners.add(listener);
        const snapshot = this.getLatestSnapshot();
        listener(snapshot);
        return () => {
            this.listeners.delete(listener);
        };
    }

    async captureSnapshotFromActiveMarkdownView(): Promise<void> {
        const snapshot = this.createSnapshotFromActiveMarkdownView() ?? this.lastSnapshot ?? this.createEmptySnapshot();
        this.lastSnapshot = snapshot;
        if (snapshot.hasSelection) {
            this.lastSelectionSnapshot = snapshot;
        }
        await this.writeContextSnapshot(snapshot);
    }

    private createSnapshotFromActiveMarkdownView(): ObsidianContextSnapshot | null {
        const vaultPath = this.getVaultPath();
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            return null;
        }

        const file = view.file ?? null;
        const editor = view.editor ?? null;
        const selection = editor?.getSelection() ?? '';
        const cursor = editor ? editor.getCursor('from') : null;
        const anchor = editor ? editor.getCursor('to') : null;
        const currentLine = cursor && editor ? editor.getLine(cursor.line) : null;

        return {
            updatedAt: new Date().toISOString(),
            vaultPath,
            activeFilePath: file?.path ?? null,
            activeFileAbsolutePath: file ? this.getAbsoluteFilePath(file) : null,
            selection,
            hasSelection: selection.length > 0,
            cursor: cursor ? { line: cursor.line, ch: cursor.ch } : null,
            selectionAnchor: anchor ? { line: anchor.line, ch: anchor.ch } : null,
            currentLine,
            selectedLineCount: this.countSelectedLines(selection),
        };
    }

    private createEmptySnapshot(): ObsidianContextSnapshot {
        return {
            updatedAt: new Date().toISOString(),
            vaultPath: this.getVaultPath(),
            activeFilePath: null,
            activeFileAbsolutePath: null,
            selection: '',
            hasSelection: false,
            cursor: null,
            selectionAnchor: null,
            currentLine: null,
            selectedLineCount: 0,
        };
    }

    async writeContextSnapshot(snapshot = this.getLatestSnapshot()): Promise<void> {
        const runtimePaths = this.getRuntimePaths();
        const comparableContext = this.serializeComparableSnapshot(snapshot);
        if (comparableContext === this.lastComparableContext && snapshot.selection === this.lastSelection) {
            return;
        }

        const snapshotToPersist: ObsidianContextSnapshot = {
            ...snapshot,
            updatedAt: new Date().toISOString(),
        };
        const serializedContext = `${JSON.stringify(snapshotToPersist, null, 2)}\n`;
        const serializedContextForDisk = `${ObsidianContextService.UTF8_BOM}${serializedContext}`;
        const selectionForDisk = `${ObsidianContextService.UTF8_BOM}${snapshotToPersist.selection}`;
        const mcpConfigForDisk = `${ObsidianContextService.UTF8_BOM}${JSON.stringify(this.buildMcpConfig(), null, 2)}\n`;

        await fs.promises.mkdir(runtimePaths.runtimeDir, { recursive: true });
        await fs.promises.writeFile(runtimePaths.contextFile, serializedContextForDisk, 'utf8');
        await fs.promises.writeFile(runtimePaths.selectionFile, selectionForDisk, 'utf8');
        await fs.promises.writeFile(runtimePaths.mcpConfigFile, mcpConfigForDisk, 'utf8');

        this.lastSerializedContext = serializedContext;
        this.lastComparableContext = comparableContext;
        this.lastSelection = snapshotToPersist.selection;
        this.lastSnapshot = snapshotToPersist;
        if (snapshotToPersist.hasSelection) {
            this.lastSelectionSnapshot = snapshotToPersist;
        }
        this.notifyListeners(snapshotToPersist);
    }

    async copyContextFilePath(): Promise<void> {
        const { contextFile } = this.getRuntimePaths();
        await this.writeContextSnapshot();
        await navigator.clipboard.writeText(contextFile);
        new Notice(`Copied Obsidian context file path: ${contextFile}`, 3000);
    }

    async copyCurrentSelection(): Promise<void> {
        const snapshot = this.getLatestSelectionSnapshot() ?? this.getLatestSnapshot();
        if (!snapshot.selection) {
            new Notice('No selected text in the active note.', 3000);
            return;
        }

        await navigator.clipboard.writeText(snapshot.selection);
        new Notice('Copied current note selection.', 2500);
    }

    buildContextSummary(snapshot = this.getLatestSnapshot()): string {
        const parts = [
            `Active note: ${snapshot.activeFilePath ?? '(none)'}`,
            `Selection lines: ${snapshot.selectedLineCount}`,
        ];

        if (snapshot.currentLine) {
            parts.push(`Current line: ${snapshot.currentLine}`);
        }

        if (snapshot.selection) {
            parts.push('');
            parts.push(snapshot.selection);
        }

        return parts.join('\n');
    }

    buildClaudePromptForSelection(snapshot = this.getLatestSelectionSnapshot() ?? this.getLatestSnapshot()): string {
        if (!snapshot.selection) {
            return '';
        }

        const parts = [
            '请基于下面这段我当前在 Obsidian 中选中的文本来回答。',
            '如果信息不足，请明确说明还缺什么，不要假设未给出的上下文。',
            '',
            `当前笔记: ${snapshot.activeFilePath ?? '(unknown)'}`,
            `选中行数: ${snapshot.selectedLineCount}`,
            '',
            '选中文本：',
            snapshot.selection,
            '',
        ];

        return parts.join('\n');
    }

    buildClaudePromptForActiveNote(snapshot = this.getLatestSnapshot()): string {
        if (!snapshot.activeFileAbsolutePath) {
            return '';
        }

        const parts = [
            '请基于我当前在 Obsidian 中打开的笔记继续协助我。',
            '下面是当前笔记路径；如果需要完整内容，请明确告诉我下一步该读取什么。',
            '',
            `当前笔记路径: ${snapshot.activeFileAbsolutePath}`,
            '',
        ];

        return parts.join('\n');
    }

    private getVaultPath(): string {
        const adapter = this.plugin.app.vault.adapter as { basePath?: string };
        return adapter.basePath ?? process.cwd();
    }

    private getAbsoluteFilePath(file: TFile): string {
        return normalizePath(path.join(this.getVaultPath(), file.path));
    }

    private notifyListeners(snapshot: ObsidianContextSnapshot): void {
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }

    private countSelectedLines(selection: string): number {
        if (!selection) {
            return 0;
        }

        return selection.split(/\r?\n/).length;
    }

    private serializeComparableSnapshot(snapshot: ObsidianContextSnapshot): string {
        const { updatedAt: _updatedAt, ...stableFields } = snapshot;
        return JSON.stringify(stableFields);
    }

    private async startBridgeServer(): Promise<void> {
        if (this.bridgeServer && this.bridgeInfo) {
            return;
        }

        const token = randomBytes(18).toString('hex');
        this.bridgeServer = http.createServer((request, response) => {
            void this.handleBridgeRequest(request, response, token);
        });

        await new Promise<void>((resolve, reject) => {
            const server = this.bridgeServer;
            if (!server) {
                reject(new Error('Context bridge server was not initialized.'));
                return;
            }

            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.off('error', reject);
                resolve();
            });
        });

        const address = this.bridgeServer.address();
        if (!address || typeof address === 'string') {
            throw new Error('Failed to resolve context bridge server address.');
        }

        const baseUrl = `http://127.0.0.1:${address.port}`;
        this.bridgeInfo = {
            baseUrl,
            token,
            contextUrl: `${baseUrl}/context`,
            selectionUrl: `${baseUrl}/selection`,
            activeNoteUrl: `${baseUrl}/active-note`,
            selectionPromptUrl: `${baseUrl}/prompts/selection`,
            activeNotePromptUrl: `${baseUrl}/prompts/active-note`,
        };
    }

    private stopBridgeServer(): void {
        this.bridgeInfo = null;
        if (!this.bridgeServer) {
            return;
        }

        const server = this.bridgeServer;
        this.bridgeServer = null;
        server.close();
    }

    private async handleBridgeRequest(
        request: http.IncomingMessage,
        response: http.ServerResponse,
        token: string
    ): Promise<void> {
        try {
            if (!this.isAuthorizedBridgeRequest(request, token)) {
                this.sendBridgeJson(response, 401, { error: 'Unauthorized' });
                return;
            }

            const method = request.method ?? 'GET';
            if (method !== 'GET') {
                this.sendBridgeJson(response, 405, { error: 'Method not allowed' });
                return;
            }

            const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
            switch (requestUrl.pathname) {
                case '/health':
                    this.sendBridgeJson(response, 200, { ok: true });
                    return;
                case '/context':
                    this.sendBridgeJson(response, 200, this.getLatestSnapshot());
                    return;
                case '/selection': {
                    const snapshot = this.getLatestSelectionSnapshot() ?? this.getLatestSnapshot();
                    this.sendBridgeJson(response, 200, {
                        updatedAt: snapshot.updatedAt,
                        activeFilePath: snapshot.activeFilePath,
                        activeFileAbsolutePath: snapshot.activeFileAbsolutePath,
                        selection: snapshot.selection,
                        hasSelection: snapshot.hasSelection,
                        selectedLineCount: snapshot.selectedLineCount,
                    });
                    return;
                }
                case '/active-note': {
                    const snapshot = this.getLatestSnapshot();
                    this.sendBridgeJson(response, 200, {
                        updatedAt: snapshot.updatedAt,
                        activeFilePath: snapshot.activeFilePath,
                        activeFileAbsolutePath: snapshot.activeFileAbsolutePath,
                        currentLine: snapshot.currentLine,
                    });
                    return;
                }
                case '/prompts/selection': {
                    const snapshot = this.getLatestSelectionSnapshot() ?? this.getLatestSnapshot();
                    this.sendBridgeJson(response, 200, {
                        prompt: this.buildClaudePromptForSelection(snapshot),
                    });
                    return;
                }
                case '/prompts/active-note': {
                    const snapshot = this.getLatestSnapshot();
                    this.sendBridgeJson(response, 200, {
                        prompt: this.buildClaudePromptForActiveNote(snapshot),
                    });
                    return;
                }
                default:
                    this.sendBridgeJson(response, 404, { error: 'Not found' });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.sendBridgeJson(response, 500, { error: message });
        }
    }

    private isAuthorizedBridgeRequest(request: http.IncomingMessage, token: string): boolean {
        const authHeader = request.headers.authorization ?? '';
        if (authHeader === `Bearer ${token}`) {
            return true;
        }

        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        return requestUrl.searchParams.get('token') === token;
    }

    private sendBridgeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
        const body = JSON.stringify(payload, null, 2);
        response.writeHead(statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        response.end(body);
    }

    private buildMcpConfig(): { mcpServers: Record<string, unknown> } {
        const bridgeInfo = this.bridgeInfo;
        const runtimePaths = this.getRuntimePaths();
        return {
            mcpServers: {
                obsiterm: {
                    command: 'node',
                    args: [path.join(path.dirname(runtimePaths.contextFile), '..', 'resources', 'obsiterm-mcp.mjs')],
                    env: {
                        OBSITERM_CONTEXT_BRIDGE_TOKEN: bridgeInfo?.token ?? '',
                        OBSITERM_CONTEXT_ENDPOINT: bridgeInfo?.contextUrl ?? '',
                        OBSITERM_SELECTION_ENDPOINT: bridgeInfo?.selectionUrl ?? '',
                        OBSITERM_ACTIVE_NOTE_ENDPOINT: bridgeInfo?.activeNoteUrl ?? '',
                        OBSITERM_SELECTION_PROMPT_ENDPOINT: bridgeInfo?.selectionPromptUrl ?? '',
                        OBSITERM_ACTIVE_NOTE_PROMPT_ENDPOINT: bridgeInfo?.activeNotePromptUrl ?? '',
                    },
                },
            },
        };
    }
}
