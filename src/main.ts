import { Plugin, WorkspaceLeaf } from 'obsidian';
import { TerminalView, TERMINAL_VIEW_TYPE } from './TerminalView';
import { TerminalSettingTab, TerminalSettings, DEFAULT_SETTINGS } from './settings';
import type { InstalledFontFamily } from './settings';
import {
    GhosttyThemeDefinition,
    TerminalTheme,
    getFallbackTheme,
    getThemeByName,
    loadBundledGhosttyThemes
} from './themes';
import * as path from 'path';

export default class XTermTerminalPlugin extends Plugin {
    settings: TerminalSettings = DEFAULT_SETTINGS;
    private bundledThemes: GhosttyThemeDefinition[] = [];
    private installedFonts: InstalledFontFamily[] = [];
    private installedFontsPromise: Promise<InstalledFontFamily[]> | null = null;

    async onload(): Promise<void> {
        console.log('Loading xTerm Terminal plugin');

        // Load settings
        await this.loadSettings();

        // Register the terminal view
        this.registerView(
            TERMINAL_VIEW_TYPE,
            (leaf) => new TerminalView(leaf, this)
        );

        // Add settings tab
        this.addSettingTab(new TerminalSettingTab(this.app, this));

        // Add ribbon icon - always opens new terminal
        this.addRibbonIcon('square-terminal', 'New Terminal', () => {
            this.openNewTerminalTab();
        });

        // Add command
        this.addCommand({
            id: 'open-terminal',
            name: 'Open Terminal',
            callback: () => {
                this.activateView();
            }
        });

        // Add command to open new terminal tab
        this.addCommand({
            id: 'new-terminal-tab',
            name: 'New Terminal Tab',
            callback: () => {
                this.openNewTerminalTab();
            }
        });

        // Add command to open terminal in current folder
        this.addCommand({
            id: 'open-terminal-here',
            name: 'Open Terminal Here',
            callback: () => {
                this.activateView();
            }
        });

        // Add command to switch theme
        this.addCommand({
            id: 'switch-terminal-theme',
            name: 'Switch Terminal Theme',
            callback: () => {
                this.showThemeSelector();
            }
        });
    }

    async onunload(): Promise<void> {
        console.log('Unloading xTerm Terminal plugin');
        this.app.workspace.detachLeavesOfType(TERMINAL_VIEW_TYPE);
    }

    async loadSettings(): Promise<void> {
        const rawData = await this.loadData() ?? {};
        this.settings = {
            themeName: typeof rawData.themeName === 'string' ? rawData.themeName : DEFAULT_SETTINGS.themeName,
            fontSize: typeof rawData.fontSize === 'number' ? rawData.fontSize : DEFAULT_SETTINGS.fontSize,
            fontFamily: typeof rawData.fontFamily === 'string' ? rawData.fontFamily : DEFAULT_SETTINGS.fontFamily,
            autocompleteTrigger: typeof rawData.autocompleteTrigger === 'string' && rawData.autocompleteTrigger.trim().length > 0
                ? rawData.autocompleteTrigger.trim()
                : DEFAULT_SETTINGS.autocompleteTrigger,
            shellPath: typeof rawData.shellPath === 'string' ? rawData.shellPath.trim() : DEFAULT_SETTINGS.shellPath,
            initialWorkingDirectory: typeof rawData.initialWorkingDirectory === 'string'
                ? rawData.initialWorkingDirectory.trim()
                : DEFAULT_SETTINGS.initialWorkingDirectory
        };

        this.bundledThemes = await loadBundledGhosttyThemes(this.getThemeDirectoryPath());

        let hasChanges = false;
        if (!this.settings.themeName || !this.bundledThemes.some((theme) => theme.name === this.settings.themeName)) {
            this.settings.themeName = this.bundledThemes[0].name;
            hasChanges = true;
        }

        if ('themes' in rawData || 'ghosttyThemeDirectory' in rawData) {
            hasChanges = true;
        }

        if (hasChanges) await this.saveSettings();
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    /**
     * Get current theme
     */
    getCurrentTheme(): TerminalTheme {
        const theme = getThemeByName(this.getThemeDefinitions(), this.settings.themeName);
        if (theme) return theme;

        return getFallbackTheme();
    }

    getThemeDefinitions(): GhosttyThemeDefinition[] {
        return this.bundledThemes;
    }

    async reloadBundledThemes(): Promise<void> {
        this.bundledThemes = await loadBundledGhosttyThemes(this.getThemeDirectoryPath());

        if (!this.bundledThemes.some((theme) => theme.name === this.settings.themeName)) {
            this.settings.themeName = this.bundledThemes[0].name;
            await this.saveSettings();
        }
    }

    getThemeDirectoryPath(): string {
        // @ts-ignore - basePath exists at runtime
        const vaultPath = this.app.vault.adapter.basePath;
        const manifestDir = this.manifest.dir;
        const pluginDir = manifestDir
            ? (path.isAbsolute(manifestDir) ? manifestDir : path.join(vaultPath, manifestDir))
            : path.join(vaultPath, '.obsidian', 'plugins', this.manifest.id);

        return path.join(pluginDir, 'themes');
    }

    async getInstalledFonts(forceRefresh = false): Promise<InstalledFontFamily[]> {
        if (!forceRefresh && this.installedFonts.length > 0) {
            return this.installedFonts;
        }

        if (!forceRefresh && this.installedFontsPromise) {
            return this.installedFontsPromise;
        }

        this.installedFontsPromise = this.loadInstalledFonts();
        const fonts = await this.installedFontsPromise;
        this.installedFonts = fonts;
        this.installedFontsPromise = null;
        return fonts;
    }

    private async loadInstalledFonts(): Promise<InstalledFontFamily[]> {
        const queryLocalFonts = (window as Window & {
            queryLocalFonts?: () => Promise<Array<{
                family?: string | null;
                fullName?: string | null;
                postscriptName?: string | null;
            }>>;
        }).queryLocalFonts;

        if (typeof queryLocalFonts !== 'function') {
            return this.withCurrentFont([]);
        }

        try {
            const fonts = await queryLocalFonts();
            const fontFamilies = new Map<string, Set<string>>();

            for (const font of fonts) {
                const family = font.family?.trim();
                if (!family) continue;

                const aliases = fontFamilies.get(family) ?? new Set<string>();
                const fullName = font.fullName?.trim();
                const postscriptName = font.postscriptName?.trim();

                if (fullName && fullName !== family) aliases.add(fullName);
                if (postscriptName && postscriptName !== family && postscriptName !== fullName) aliases.add(postscriptName);

                fontFamilies.set(family, aliases);
            }

            return this.withCurrentFont(
                Array.from(fontFamilies.entries())
                    .map(([family, aliases]) => ({
                        family,
                        aliases: Array.from(aliases).sort((a, b) => a.localeCompare(b))
                    }))
                    .sort((a, b) => a.family.localeCompare(b.family))
            );
        } catch (error) {
            console.error('Failed to query local fonts', error);
            return this.withCurrentFont([]);
        }
    }

    private withCurrentFont(fonts: InstalledFontFamily[]): InstalledFontFamily[] {
        const currentFont = this.settings.fontFamily.trim();
        if (!currentFont) return fonts;
        return fonts.some((font) => font.family === currentFont)
            ? fonts
            : [{ family: currentFont, aliases: [] }, ...fonts];
    }

    /**
     * Apply theme to all open terminals
     */
    applyThemeToAllTerminals(): void {
        const leaves = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
        for (const leaf of leaves) {
            const view = leaf.view as TerminalView;
            if (view && view.applyTheme) {
                view.applyTheme(this.getCurrentTheme());
            }
        }
    }

    /**
     * Apply settings to all open terminals
     */
    applySettingsToAllTerminals(): void {
        const leaves = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
        for (const leaf of leaves) {
            const view = leaf.view as TerminalView;
            if (view && view.applySettings) {
                view.applySettings(this.settings);
            }
        }
    }

    /**
     * Show theme selector modal
     */
    private showThemeSelector(): void {
        const menu = new (require('obsidian').Menu)();

        for (const theme of this.getThemeDefinitions()) {
            menu.addItem((item: any) => {
                item.setTitle(theme.name);
                item.setChecked(theme.name === this.settings.themeName);
                item.onClick(async () => {
                    this.settings.themeName = theme.name;
                    await this.saveSettings();
                    this.applyThemeToAllTerminals();
                });
            });
        }

        // Show menu at cursor position
        const activeView = this.app.workspace.getActiveViewOfType(TerminalView);
        if (activeView) {
            menu.showAtMouseEvent(new MouseEvent('click', {
                clientX: window.innerWidth / 2,
                clientY: window.innerHeight / 2
            }));
        }
    }

    /**
     * 激活终端视图（如果已有则激活，否则新建）
     */
    async activateView(): Promise<void> {
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);

        if (leaves.length > 0) {
            // 如果已经有终端视图，激活第一个
            workspace.revealLeaf(leaves[0]);
        } else {
            // 否则创建新的终端视图
            await this.createNewTerminal();
        }
    }

    /**
     * 创建新的终端标签页
     */
    async createNewTerminal(): Promise<void> {
        const { workspace } = this.app;

        // 在右侧边栏创建新的终端视图
        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: TERMINAL_VIEW_TYPE,
                active: true,
            });
            workspace.revealLeaf(leaf);
        }
    }

    /**
     * 在新标签页打开终端（总是在右侧边栏创建新的）
     */
    async openNewTerminalTab(): Promise<void> {
        const { workspace } = this.app;

        // 获取现有终端
        const existingLeaves = workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);

        let leaf;
        if (existingLeaves.length > 0) {
            // 在现有终端旁边创建新标签（垂直分割但很小的分割）
            // 使用 'vertical' 分割可以在同一侧栏添加
            leaf = workspace.createLeafBySplit(existingLeaves[0], 'vertical', false);
        } else {
            // 在右侧边栏创建第一个终端
            leaf = workspace.getRightLeaf(false);
        }

        if (leaf) {
            await leaf.setViewState({
                type: TERMINAL_VIEW_TYPE,
                active: true,
            });
            workspace.revealLeaf(leaf);
        }
    }
}
