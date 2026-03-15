import { App, PluginSettingTab, Setting, getLanguage } from 'obsidian';
import { getThemeByName } from './themes';
import type XTermTerminalPlugin from './main';

export interface TerminalSettings {
    themeName: string;
    fontSize: number;
    fontFamily: string;
}

export const DEFAULT_SETTINGS: TerminalSettings = {
    themeName: '',
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace'
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
            .setName(this.t('fontFamily'))
            .setDesc(this.t('fontFamilyDesc'))
            .addText((text) => {
                text
                    .setValue(this.plugin.settings.fontFamily)
                    .onChange(async (value) => {
                        this.plugin.settings.fontFamily = value;
                        await this.plugin.saveSettings();
                        this.plugin.applySettingsToAllTerminals();
                        this.updatePreview();
                    });
            });
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
    | 'fontFamily'
    | 'fontFamilyDesc';

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
    fontFamily: 'Font Family',
    fontFamilyDesc: 'Terminal font family'
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
    fontFamily: '字体族',
    fontFamilyDesc: '终端字体族'
};
