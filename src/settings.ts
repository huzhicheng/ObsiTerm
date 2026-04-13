import { App, FuzzyMatch, FuzzySuggestModal, PluginSettingTab, Setting, getLanguage } from 'obsidian';
import { getThemeByName } from './themes';
import type XTermTerminalPlugin from './main';

export interface InstalledFontFamily {
    family: string;
    aliases: string[];
}

export interface TerminalSettings {
    themeName: string;
    fontSize: number;
    fontFamily: string;
    autocompleteTrigger: string;
    shellPath: string;
    initialWorkingDirectory: string;
    compatibilityMode: boolean;
}

function getDefaultFontFamily(): string {
    if (process.platform === 'win32') {
        return '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';
    }

    if (process.platform === 'darwin') {
        return 'Menlo, Monaco, "SF Mono", "Courier New", monospace';
    }

    return '"DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", "Courier New", monospace';
}

function getRecommendedFontFamily(): string {
    return getDefaultFontFamily();
}

export const DEFAULT_SETTINGS: TerminalSettings = {
    themeName: '',
    fontSize: 14,
    fontFamily: getDefaultFontFamily(),
    autocompleteTrigger: '@',
    shellPath: '',
    initialWorkingDirectory: '',
    compatibilityMode: true
};

export class TerminalSettingTab extends PluginSettingTab {
    plugin: XTermTerminalPlugin;
    private previewContainer: HTMLElement | null = null;
    private isChinese: boolean;

    constructor(app: App, plugin: XTermTerminalPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.isChinese = false;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.isChinese = getLanguage().toLowerCase().startsWith('zh');

        containerEl.createEl('h2', { text: this.t('terminalSettings') });

        this.renderThemeDirectory(containerEl);
        this.renderThemeSelector(containerEl);
        this.renderThemeInfo(containerEl);
        this.renderAppearanceSettings(containerEl);

        containerEl.createEl('h3', { text: this.t('themePreview') });
        this.previewContainer = containerEl.createDiv({ cls: 'terminal-theme-preview' });
        this.renderThemePreview();
    }

    private renderThemeSelector(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(this.t('theme'))
            .setDesc(this.t('themeDesc'))
            .addDropdown((dropdown) => {
                const themes = this.plugin.getThemeDefinitions();

                if (themes.length === 0) {
                    dropdown.addOption('', this.t('noBundledThemes'));
                    dropdown.setDisabled(true);
                    return;
                }

                for (const theme of themes) {
                    dropdown.addOption(theme.name, theme.name);
                }

                const selectedTheme = themes.some((theme) => theme.name === this.plugin.settings.themeName)
                    ? this.plugin.settings.themeName
                    : themes[0].name;

                dropdown.setValue(selectedTheme);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.themeName = value;
                    await this.plugin.saveSettings();
                    this.plugin.applyThemeToAllTerminals();
                    this.display();
                });
            });
    }

    private renderThemeDirectory(containerEl: HTMLElement): void {
        const themeDir = this.plugin.getThemeDirectoryPath();

        new Setting(containerEl)
            .setName(this.t('themeDirectory'))
            .setDesc(themeDir)
            .addExtraButton((button) => {
                button
                    .setIcon('refresh-cw')
                    .setTooltip(this.t('reloadThemes'))
                    .onClick(async () => {
                        await this.plugin.reloadBundledThemes();
                        this.plugin.applyThemeToAllTerminals();
                        this.display();
                    });
            })
            .addButton((button) => {
                button
                    .setButtonText(this.t('open'))
                    .onClick(async () => {
                        const { shell } = require('electron');
                        await shell.openPath(themeDir);
                    });
            });
    }

    private renderThemeInfo(containerEl: HTMLElement): void {
        const bundledThemeNames = this.plugin.getThemeDefinitions().map((theme) => theme.name).join(', ');
        const info = containerEl.createDiv({ cls: 'setting-item-description' });
        info.style.marginTop = '8px';
        info.style.marginBottom = '16px';
        info.createDiv({ text: `${this.t('bundledThemes')}: ${bundledThemeNames || this.t('noBundledThemes')}` });
        info.createDiv({ text: this.t('themeInfo') });
    }

    private renderAppearanceSettings(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(this.t('fontSize'))
            .setDesc(this.t('fontSizeDesc'))
            .addSlider((slider) => {
                slider
                    .setLimits(10, 24, 1)
                    .setValue(this.plugin.settings.fontSize)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.fontSize = value;
                        await this.plugin.saveSettings();
                        this.plugin.applySettingsToAllTerminals();
                        this.updatePreview();
                    });
            });

        new Setting(containerEl)
            .setName(this.t('autocompleteTrigger'))
            .setDesc(this.t('autocompleteTriggerDesc'))
            .addText((text) => {
                text
                    .setPlaceholder(DEFAULT_SETTINGS.autocompleteTrigger)
                    .setValue(this.plugin.settings.autocompleteTrigger)
                    .onChange(async (value) => {
                        const normalized = this.normalizeAutocompleteTrigger(value);
                        if (normalized === this.plugin.settings.autocompleteTrigger) return;
                        this.plugin.settings.autocompleteTrigger = normalized;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(this.t('shellPath'))
            .setDesc(this.t('shellPathDesc'))
            .addText((text) => {
                text
                    .setPlaceholder(this.getShellPlaceholder())
                    .setValue(this.plugin.settings.shellPath)
                    .onChange(async (value) => {
                        const normalized = value.trim();
                        if (normalized === this.plugin.settings.shellPath) return;
                        this.plugin.settings.shellPath = normalized;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(this.t('initialWorkingDirectory'))
            .setDesc(this.t('initialWorkingDirectoryDesc'))
            .addText((text) => {
                text
                    .setPlaceholder(this.getInitialWorkingDirectoryPlaceholder())
                    .setValue(this.plugin.settings.initialWorkingDirectory)
                    .onChange(async (value) => {
                        const normalized = value.trim();
                        if (normalized === this.plugin.settings.initialWorkingDirectory) return;
                        this.plugin.settings.initialWorkingDirectory = normalized;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(this.t('compatibilityMode'))
            .setDesc(this.t('compatibilityModeDesc'))
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.compatibilityMode)
                    .onChange(async (value) => {
                        if (value === this.plugin.settings.compatibilityMode) return;
                        this.plugin.settings.compatibilityMode = value;
                        await this.plugin.saveSettings();
                        this.plugin.applySettingsToAllTerminals();
                    });
            });

        const fontSetting = new Setting(containerEl)
            .setName(this.t('fontFamily'))
            .setDesc(this.t('fontFamilyDesc'))
            .addButton((button) => {
                button
                    .setButtonText(this.t('chooseFont'))
                    .onClick(async () => {
                        const fonts = await this.plugin.getInstalledFonts();
                        new FontFamilySuggestModal(this.app, fonts, this.plugin.settings.fontFamily, {
                            isChinese: this.isChinese,
                            onChoose: async (fontFamily) => {
                                this.plugin.settings.fontFamily = fontFamily;
                                await this.plugin.saveSettings();
                                this.plugin.applySettingsToAllTerminals();
                                this.updatePreview();
                                this.display();
                            }
                        }).open();
                    });
            })
            .addButton((button) => {
                button
                    .setButtonText(this.t('useRecommendedFont'))
                    .onClick(async () => {
                        const recommendedFont = getRecommendedFontFamily();
                        if (recommendedFont === this.plugin.settings.fontFamily) return;
                        this.plugin.settings.fontFamily = recommendedFont;
                        await this.plugin.saveSettings();
                        this.plugin.applySettingsToAllTerminals();
                        this.updatePreview();
                        this.display();
                    });
            })
            .addExtraButton((button) => {
                button
                    .setIcon('refresh-cw')
                    .setTooltip(this.t('reloadFonts'))
                    .onClick(async () => {
                        await this.renderFontFamilyControl(fontSetting, true);
                    });
            });

        void this.renderFontFamilyControl(fontSetting, false);
    }

    private async renderFontFamilyControl(setting: Setting, forceRefresh: boolean): Promise<void> {
        setting.infoEl.querySelector('.xterm-font-family-value')?.remove();
        setting.infoEl.querySelector('.xterm-font-status')?.remove();

        const currentFontEl = setting.infoEl.createDiv({ cls: 'xterm-font-family-value' });
        currentFontEl.setText(this.plugin.settings.fontFamily);
        currentFontEl.title = this.plugin.settings.fontFamily;
        currentFontEl.style.fontFamily = this.plugin.settings.fontFamily;

        const statusEl = setting.infoEl.createDiv({ cls: 'setting-item-description xterm-font-status' });
        statusEl.setText(this.t('loadingFonts'));

        const fonts = await this.plugin.getInstalledFonts(forceRefresh);
        if (!setting.settingEl.isConnected) return;

        statusEl.setText(this.t('fontFamilyLoaded').replace('{count}', String(fonts.length)));
    }

    private updatePreview(): void {
        if (this.previewContainer) {
            this.previewContainer.empty();
            this.renderThemePreview();
        }
    }

    private renderThemePreview(): void {
        if (!this.previewContainer) return;

        const currentTheme = getThemeByName(this.plugin.getThemeDefinitions(), this.plugin.settings.themeName);
        if (!currentTheme) return;

        const settings = this.plugin.settings;
        const container = this.previewContainer;

        container.style.backgroundColor = currentTheme.background;
        container.style.padding = '16px';
        container.style.borderRadius = '8px';
        container.style.fontFamily = settings.fontFamily;
        container.style.fontSize = `${settings.fontSize}px`;
        container.style.lineHeight = '1.5';
        container.style.marginTop = '10px';

        const lines = [
            { color: currentTheme.green, text: '$ ls -la' },
            { color: currentTheme.foreground, text: 'drwxr-xr-x  5 user staff  160 Jan  8 12:00 .' },
            { color: currentTheme.blue, text: 'drwxr-xr-x 20 user staff  640 Jan  8 11:00 ..' },
            { color: currentTheme.yellow, text: '-rw-r--r--  1 user staff 1234 Jan  8 10:00 README.md' },
            { color: currentTheme.magenta, text: '-rwxr-xr-x  1 user staff 5678 Jan  8 09:00 script.sh' },
            { color: currentTheme.cyan, text: this.isChinese ? '$ echo "你好，Ghostty！"' : '$ echo "Hello, Ghostty!"' },
            { color: currentTheme.foreground, text: this.isChinese ? '你好，Ghostty！' : 'Hello, Ghostty!' },
            { color: currentTheme.red, text: '$ exit' },
        ];

        for (const line of lines) {
            const lineEl = container.createDiv();
            lineEl.style.color = line.color;
            lineEl.textContent = line.text;
        }
    }

    private t(key: TranslationKey): string {
        return this.isChinese ? ZH[key] : EN[key];
    }

    private normalizeAutocompleteTrigger(value: string): string {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.autocompleteTrigger;
    }

    private getShellPlaceholder(): string {
        return process.platform === 'win32'
            ? 'pwsh.exe or C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
            : '/bin/zsh or /bin/bash';
    }

    private getInitialWorkingDirectoryPlaceholder(): string {
        return process.platform === 'win32'
            ? 'Leave empty for vault root, or .\\notes, E:\\Projects'
            : 'Leave empty for vault root, or ./notes, /Users/name/Projects';
    }
}

type TranslationKey =
    | 'terminalSettings'
    | 'themePreview'
    | 'theme'
    | 'themeDesc'
    | 'noBundledThemes'
    | 'themeDirectory'
    | 'reloadThemes'
    | 'open'
    | 'bundledThemes'
    | 'themeInfo'
    | 'fontSize'
    | 'fontSizeDesc'
    | 'autocompleteTrigger'
    | 'autocompleteTriggerDesc'
    | 'shellPath'
    | 'shellPathDesc'
    | 'initialWorkingDirectory'
    | 'initialWorkingDirectoryDesc'
    | 'compatibilityMode'
    | 'compatibilityModeDesc'
    | 'fontFamily'
    | 'fontFamilyDesc'
    | 'useRecommendedFont'
    | 'loadingFonts'
    | 'fontFamilyLoaded'
    | 'reloadFonts'
    | 'chooseFont'
    | 'fontPickerPlaceholder'
    | 'fontPickerInstructions'
    | 'fontPickerNoMatch'
    | 'currentFont'
    | 'typeToFilter';

const EN: Record<TranslationKey, string> = {
    terminalSettings: 'Terminal Settings',
    themePreview: 'Theme Preview',
    theme: 'Theme',
    themeDesc: 'Select one of the bundled Ghostty-compatible terminal themes',
    noBundledThemes: 'No bundled themes found',
    themeDirectory: 'Theme Directory',
    reloadThemes: 'Reload themes from directory',
    open: 'Open',
    bundledThemes: 'Bundled themes',
    themeInfo: 'Edit files in the theme directory and click reload to refresh the list.',
    fontSize: 'Font Size',
    fontSizeDesc: 'Terminal font size in pixels',
    autocompleteTrigger: 'Vault Path Trigger',
    autocompleteTriggerDesc: 'Trigger bundled vault path autocomplete. When Claude Code, Codex CLI, or Gemini CLI is in the foreground, single @ is passed through to the agent.',
    shellPath: 'Shell Command',
    shellPathDesc: 'Optional shell override. Leave empty to auto-detect the best shell for the current platform.',
    initialWorkingDirectory: 'Initial Directory',
    initialWorkingDirectoryDesc: 'Optional terminal startup directory. Leave empty to start in the vault root. Relative paths are resolved from the vault root.',
    compatibilityMode: 'Terminal Compatibility Mode',
    compatibilityModeDesc: 'Prioritize Unicode logos, box-drawing, and mixed glyph alignment over tighter spacing. This also disables xterm custom glyph rendering for more predictable fallback behavior.',
    fontFamily: 'Font Family',
    fontFamilyDesc: 'Pick a local installed monospace font. For CLI logos and box-drawing alignment, prefer terminal-oriented fonts such as Cascadia Mono, SF Mono, Menlo, or Consolas.',
    useRecommendedFont: 'Use Recommended',
    loadingFonts: 'Loading installed fonts...',
    fontFamilyLoaded: '{count} local font families available',
    reloadFonts: 'Reload installed fonts',
    chooseFont: 'Choose',
    fontPickerPlaceholder: 'Search local fonts',
    fontPickerInstructions: 'Apply selected font',
    fontPickerNoMatch: 'No matching fonts found',
    currentFont: 'Current',
    typeToFilter: 'Type'
};

const ZH: Record<TranslationKey, string> = {
    terminalSettings: '终端设置',
    themePreview: '主题预览',
    theme: '主题',
    themeDesc: '选择一个插件内置的 Ghostty 兼容终端主题',
    noBundledThemes: '未找到内置主题',
    themeDirectory: '主题目录',
    reloadThemes: '从目录重新加载主题',
    open: '打开',
    bundledThemes: '内置主题',
    themeInfo: '修改主题目录中的文件后，点击刷新按钮即可重新加载列表。',
    fontSize: '字体大小',
    fontSizeDesc: '终端字体大小（像素）',
    autocompleteTrigger: '路径补全触发符',
    autocompleteTriggerDesc: '触发插件内置 vault 路径补全。当 Claude Code、Codex CLI、Gemini CLI 处于前台时，单个 @ 会让给这些 Agent 自己处理。',
    shellPath: 'Shell 命令',
    shellPathDesc: '可选的 shell 覆盖值。留空时会按当前平台自动选择最合适的 shell。',
    initialWorkingDirectory: '初始目录',
    initialWorkingDirectoryDesc: '可选的终端启动目录。留空时默认使用 vault 根目录，相对路径会相对于 vault 根目录解析。',
    compatibilityMode: '终端兼容模式',
    compatibilityModeDesc: '优先保证 Unicode logo、边框字符和混合字形对齐，而不是追求更紧凑的排版。同时会关闭 xterm 的 custom glyph 渲染，以获得更稳定的回退字体行为。',
    fontFamily: '字体族',
    fontFamilyDesc: '从可搜索弹窗中选择本机已安装的等宽字体。若要改善 Claude 等 CLI 的 logo、边框和特殊字符对齐，优先选择 Cascadia Mono、SF Mono、Menlo、Consolas 等终端友好字体。',
    useRecommendedFont: '使用推荐字体',
    loadingFonts: '正在加载本机字体...',
    fontFamilyLoaded: '可用字体族：{count}',
    reloadFonts: '重新加载本机字体',
    chooseFont: '选择',
    fontPickerPlaceholder: '搜索本机字体',
    fontPickerInstructions: '应用当前选中字體',
    fontPickerNoMatch: '没有匹配的字体',
    currentFont: '当前',
    typeToFilter: '输入'
};

class FontFamilySuggestModal extends FuzzySuggestModal<string> {
    constructor(
        app: App,
        private readonly fonts: InstalledFontFamily[],
        private readonly currentFont: string,
        options: {
            isChinese: boolean;
            onChoose: (fontFamily: string) => Promise<void> | void;
        }
    ) {
        super(app);
        this.isChinese = options.isChinese;
        this.onChooseCallback = options.onChoose;

        this.setPlaceholder(this.t('fontPickerPlaceholder'));
        this.setInstructions([
            { command: this.t('typeToFilter'), purpose: this.t('fontPickerPlaceholder') },
            { command: '↑↓', purpose: this.t('fontPickerInstructions') },
            { command: 'Enter', purpose: this.t('chooseFont') }
        ]);
    }

    private readonly isChinese: boolean;
    private readonly onChooseCallback: (fontFamily: string) => Promise<void> | void;

    getItems(): InstalledFontFamily[] {
        return this.fonts;
    }

    getItemText(font: InstalledFontFamily): string {
        return [font.family, ...font.aliases].join(' ');
    }

    renderSuggestion(match: FuzzyMatch<InstalledFontFamily>, el: HTMLElement): void {
        const font = match.item;
        const titleEl = el.createDiv({ cls: 'xterm-font-suggestion-title', text: font.family });
        titleEl.style.fontFamily = font.family;

        const metaEl = el.createDiv({
            cls: 'xterm-font-suggestion-meta',
            text: font.aliases.length > 0 ? font.aliases.join(' / ') : this.t('currentFont')
        });
        metaEl.style.fontFamily = font.family;

        if (font.family === this.currentFont) {
            el.addClass('is-current');
            const badgeEl = el.createSpan({ cls: 'xterm-font-current-badge', text: this.t('currentFont') });
            titleEl.appendChild(document.createTextNode(' '));
            titleEl.appendChild(badgeEl);
        }
    }

    onNoSuggestion(): void {
        this.emptyState.setText(this.t('fontPickerNoMatch'));
    }

    onChooseSuggestion(match: FuzzyMatch<InstalledFontFamily>): void {
        void this.onChooseCallback(match.item.family);
    }

    private t(
        key: 'fontPickerPlaceholder' | 'fontPickerInstructions' | 'fontPickerNoMatch' | 'chooseFont' | 'currentFont' | 'typeToFilter'
    ): string {
        return this.isChinese ? ZH[key] : EN[key];
    }
}
