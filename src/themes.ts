import * as fs from 'fs';
import * as path from 'path';

export interface TerminalTheme {
    name: string;
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    selectionForeground: string;
    selectionInactiveBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
    extendedAnsi?: string[];
}

export interface GhosttyThemeDefinition {
    id: string;
    name: string;
    content: string;
}

const FALLBACK_THEME_NAME = 'tokyo-night-storm';
const FALLBACK_THEME_CONTENT = `background = #24283b
foreground = #c0caf5
selection-background = #2e3c64
selection-foreground = #c0caf5
cursor-color = #c0caf5
cursor-text = #24283b
palette = 0=#1d202f
palette = 1=#f7768e
palette = 2=#9ece6a
palette = 3=#e0af68
palette = 4=#7aa2f7
palette = 5=#bb9af7
palette = 6=#7dcfff
palette = 7=#a9b1d6
palette = 8=#414868
palette = 9=#f7768e
palette = 10=#9ece6a
palette = 11=#e0af68
palette = 12=#7aa2f7
palette = 13=#bb9af7
palette = 14=#7dcfff
palette = 15=#c0caf5`;

let parsedFallbackTheme: TerminalTheme | null = null;

export async function loadBundledGhosttyThemes(themeDir: string): Promise<GhosttyThemeDefinition[]> {
    const themes = await readGhosttyThemeDirectory(themeDir, 'bundled');
    return themes.length > 0 ? themes : [getFallbackThemeDefinition()];
}

export function getThemeDefinitionByName(
    themes: GhosttyThemeDefinition[],
    name: string
): GhosttyThemeDefinition | undefined {
    return themes.find((theme) => theme.name === name);
}

export function getThemeByName(themes: GhosttyThemeDefinition[], name: string): TerminalTheme | undefined {
    const definition = getThemeDefinitionByName(themes, name);
    if (!definition) return undefined;

    return parseGhosttyTheme(definition.name, definition.content);
}

export function getFallbackThemeDefinition(): GhosttyThemeDefinition {
    return {
        id: 'fallback:tokyo-night-storm',
        name: FALLBACK_THEME_NAME,
        content: FALLBACK_THEME_CONTENT
    };
}

export function getFallbackTheme(): TerminalTheme {
    return { ...getParsedFallbackTheme() };
}

export function parseGhosttyTheme(name: string, content: string): TerminalTheme {
    return parseGhosttyThemeWithFallback(name, content, getParsedFallbackTheme());
}

async function readGhosttyThemeDirectory(themeDir: string, idPrefix: string): Promise<GhosttyThemeDefinition[]> {
    try {
        const entries = await fs.promises.readdir(themeDir, { withFileTypes: true });
        const files = entries
            .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
            .sort((a, b) => a.name.localeCompare(b.name));

        const themes: GhosttyThemeDefinition[] = [];

        for (const entry of files) {
            const filePath = path.join(themeDir, entry.name);
            const content = await fs.promises.readFile(filePath, 'utf8');
            parseGhosttyTheme(entry.name, content);

            themes.push({
                id: `${idPrefix}:${entry.name}`,
                name: entry.name,
                content
            });
        }

        return themes;
    } catch {
        return [];
    }
}

function parseGhosttyThemeWithFallback(
    name: string,
    content: string,
    fallbackTheme?: TerminalTheme
): TerminalTheme {
    const config = parseGhosttyConfig(content);
    if (!config.values.has('background') || !config.values.has('foreground')) {
        throw new Error(`Ghostty theme "${name}" must define both background and foreground.`);
    }

    const background = resolveGhosttyColor(config.values.get('background'), fallbackTheme?.background ?? '#000000', undefined);
    const foreground = resolveGhosttyColor(config.values.get('foreground'), fallbackTheme?.foreground ?? '#ffffff', {
        background,
        foreground: fallbackTheme?.foreground ?? '#ffffff'
    });

    const palette = new Map<number, string>();
    for (const [index, value] of config.palette.entries()) {
        palette.set(index, resolveGhosttyColor(value, fallbackPaletteColor(index, fallbackTheme), { background, foreground }));
    }

    const selectionBackground = resolveGhosttyColor(
        config.values.get('selection-background'),
        fallbackTheme?.selectionBackground ?? background,
        { background, foreground }
    );
    const selectionForeground = resolveGhosttyColor(
        config.values.get('selection-foreground'),
        foreground,
        { background, foreground }
    );
    const cursor = resolveGhosttyColor(config.values.get('cursor-color'), foreground, { background, foreground });
    const cursorAccent = resolveGhosttyColor(config.values.get('cursor-text'), background, { background, foreground });

    return {
        name,
        background,
        foreground,
        cursor,
        cursorAccent,
        selectionBackground,
        selectionForeground,
        selectionInactiveBackground: selectionBackground,
        black: palette.get(0) ?? fallbackPaletteColor(0, fallbackTheme),
        red: palette.get(1) ?? fallbackPaletteColor(1, fallbackTheme),
        green: palette.get(2) ?? fallbackPaletteColor(2, fallbackTheme),
        yellow: palette.get(3) ?? fallbackPaletteColor(3, fallbackTheme),
        blue: palette.get(4) ?? fallbackPaletteColor(4, fallbackTheme),
        magenta: palette.get(5) ?? fallbackPaletteColor(5, fallbackTheme),
        cyan: palette.get(6) ?? fallbackPaletteColor(6, fallbackTheme),
        white: palette.get(7) ?? fallbackPaletteColor(7, fallbackTheme),
        brightBlack: palette.get(8) ?? fallbackPaletteColor(8, fallbackTheme),
        brightRed: palette.get(9) ?? fallbackPaletteColor(9, fallbackTheme),
        brightGreen: palette.get(10) ?? fallbackPaletteColor(10, fallbackTheme),
        brightYellow: palette.get(11) ?? fallbackPaletteColor(11, fallbackTheme),
        brightBlue: palette.get(12) ?? fallbackPaletteColor(12, fallbackTheme),
        brightMagenta: palette.get(13) ?? fallbackPaletteColor(13, fallbackTheme),
        brightCyan: palette.get(14) ?? fallbackPaletteColor(14, fallbackTheme),
        brightWhite: palette.get(15) ?? fallbackPaletteColor(15, fallbackTheme),
        extendedAnsi: buildExtendedAnsiColors(palette)
    };
}

function parseGhosttyConfig(content: string): {
    values: Map<string, string>;
    palette: Map<number, string>;
} {
    const values = new Map<string, string>();
    const palette = new Map<number, string>();

    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
            continue;
        }

        const equalIndex = trimmed.indexOf('=');
        if (equalIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, equalIndex).trim().toLowerCase();
        const value = trimmed.slice(equalIndex + 1).trim();
        if (!value) {
            continue;
        }

        if (key === 'palette') {
            const match = value.match(/^(\d{1,3})\s*=\s*(.+)$/);
            if (!match) {
                continue;
            }

            const paletteIndex = Number(match[1]);
            if (paletteIndex < 0 || paletteIndex > 255) {
                continue;
            }

            palette.set(paletteIndex, match[2].trim());
            continue;
        }

        values.set(key, value);
    }

    return { values, palette };
}

function resolveGhosttyColor(
    value: string | undefined,
    fallback: string,
    context?: { background: string; foreground: string }
): string {
    if (!value) {
        return fallback;
    }

    const trimmed = value.trim();
    const normalized = trimmed.toLowerCase();

    if (normalized === 'cell-background') {
        return context?.background ?? fallback;
    }

    if (normalized === 'cell-foreground') {
        return context?.foreground ?? fallback;
    }

    if (normalized === 'none') {
        return 'transparent';
    }

    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(trimmed)) {
        return `#${trimmed}`;
    }

    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(trimmed)) {
        return trimmed;
    }

    if (isSupportedCssColor(trimmed)) {
        return trimmed;
    }

    throw new Error(`Unsupported Ghostty color value: ${value}`);
}

function isSupportedCssColor(value: string): boolean {
    if (typeof document === 'undefined') {
        return false;
    }

    const optionStyle = new Option().style;
    optionStyle.color = '';
    optionStyle.color = value;
    return optionStyle.color !== '';
}

function buildExtendedAnsiColors(palette: Map<number, string>): string[] | undefined {
    const indexes = Array.from(palette.keys()).filter((index) => index >= 16).sort((a, b) => a - b);
    if (indexes.length === 0) {
        return undefined;
    }

    const highestIndex = indexes[indexes.length - 1];
    const extended: string[] = [];

    for (let index = 16; index <= highestIndex; index++) {
        const color = palette.get(index);
        if (color) {
            extended.push(color);
        } else if (extended.length > 0) {
            extended.push(extended[extended.length - 1]);
        }
    }

    return extended.length > 0 ? extended : undefined;
}

function fallbackPaletteColor(index: number, fallbackTheme?: TerminalTheme): string {
    if (fallbackTheme) {
        switch (index) {
            case 0:
                return fallbackTheme.black;
            case 1:
                return fallbackTheme.red;
            case 2:
                return fallbackTheme.green;
            case 3:
                return fallbackTheme.yellow;
            case 4:
                return fallbackTheme.blue;
            case 5:
                return fallbackTheme.magenta;
            case 6:
                return fallbackTheme.cyan;
            case 7:
                return fallbackTheme.white;
            case 8:
                return fallbackTheme.brightBlack;
            case 9:
                return fallbackTheme.brightRed;
            case 10:
                return fallbackTheme.brightGreen;
            case 11:
                return fallbackTheme.brightYellow;
            case 12:
                return fallbackTheme.brightBlue;
            case 13:
                return fallbackTheme.brightMagenta;
            case 14:
                return fallbackTheme.brightCyan;
            case 15:
                return fallbackTheme.brightWhite;
            default:
                return fallbackTheme.foreground;
        }
    }

    switch (index) {
        case 0:
            return '#000000';
        case 1:
            return '#ff0000';
        case 2:
            return '#00ff00';
        case 3:
            return '#ffff00';
        case 4:
            return '#0000ff';
        case 5:
            return '#ff00ff';
        case 6:
            return '#00ffff';
        case 7:
            return '#ffffff';
        case 8:
            return '#808080';
        case 9:
            return '#ff5555';
        case 10:
            return '#55ff55';
        case 11:
            return '#ffff55';
        case 12:
            return '#5555ff';
        case 13:
            return '#ff55ff';
        case 14:
            return '#55ffff';
        case 15:
            return '#f5f5f5';
        default:
            return '#ffffff';
    }
}

function getParsedFallbackTheme(): TerminalTheme {
    if (!parsedFallbackTheme) {
        parsedFallbackTheme = parseGhosttyThemeWithFallback(FALLBACK_THEME_NAME, FALLBACK_THEME_CONTENT);
    }

    return parsedFallbackTheme;
}
