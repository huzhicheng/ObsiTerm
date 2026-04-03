import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const pluginDirName = 'obsidian-term';
const platformName = mapPlatform(process.platform);

const args = process.argv.slice(2);
const options = {
    skipBuild: false,
    releaseOnly: false,
    target: process.env.OBSIDIAN_PLUGIN_DIR ?? ''
};

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--skip-build') {
        options.skipBuild = true;
    } else if (arg === '--release-only') {
        options.releaseOnly = true;
    } else if (arg === '--target') {
        options.target = args[++i] ?? '';
    } else if (arg === '-h' || arg === '--help') {
        printHelp();
        process.exit(0);
    } else {
        console.error(`Unknown option: ${arg}`);
        printHelp();
        process.exit(1);
    }
}

if (!options.skipBuild) {
    runCommand(getNpmCommand(), ['run', 'build'], rootDir);
}

const helperFileName = process.platform === 'win32' ? 'pty-helper.exe' : 'pty-helper';
const bundleFiles = [
    'main.js',
    'manifest.json',
    'styles.css'
];
const helperSourcePath = path.join(rootDir, 'resources', helperFileName);
const themesSourcePath = path.join(rootDir, 'themes');
const releaseBundleDir = path.join(rootDir, 'releases', platformName, pluginDirName);

for (const file of bundleFiles) {
    const filePath = path.join(rootDir, file);
    if (!existsSync(filePath)) {
        throw new Error(`Missing build artifact: ${filePath}`);
    }
}

if (!existsSync(helperSourcePath)) {
    throw new Error(`Missing PTY helper: ${helperSourcePath}`);
}

try {
    copyPluginBundle(releaseBundleDir);
    console.log(`Release bundle refreshed: ${releaseBundleDir}`);

    if (!options.releaseOnly && options.target) {
        copyPluginBundle(options.target);
        console.log(`Local plugin deployed: ${options.target}`);
    } else if (!options.releaseOnly) {
        console.log('Local plugin deploy skipped. Set OBSIDIAN_PLUGIN_DIR or pass --target to enable it.');
    }
} catch (error) {
    reportDeployError(error);
    process.exit(1);
}

function copyPluginBundle(destinationDir) {
    mkdirSync(destinationDir, { recursive: true });

    for (const entry of ['resources', 'themes']) {
        const entryPath = path.join(destinationDir, entry);
        try {
            rmSync(entryPath, { recursive: true, force: true });
        } catch (error) {
            throw wrapFileError(`Failed to remove ${entryPath}`, error, entryPath);
        }
    }

    try {
        mkdirSync(path.join(destinationDir, 'resources'), { recursive: true });
        mkdirSync(path.join(destinationDir, 'themes'), { recursive: true });
    } catch (error) {
        throw wrapFileError(`Failed to create bundle directories in ${destinationDir}`, error, destinationDir);
    }

    for (const file of bundleFiles) {
        const sourcePath = path.join(rootDir, file);
        const targetPath = path.join(destinationDir, file);
        try {
            cpSync(sourcePath, targetPath);
        } catch (error) {
            throw wrapFileError(`Failed to copy ${sourcePath} -> ${targetPath}`, error, targetPath);
        }
    }

    const helperTargetPath = path.join(destinationDir, 'resources', helperFileName);
    try {
        cpSync(helperSourcePath, helperTargetPath);
    } catch (error) {
        throw wrapFileError(`Failed to copy ${helperSourcePath} -> ${helperTargetPath}`, error, helperTargetPath);
    }

    for (const entry of readdirSync(themesSourcePath)) {
        const sourcePath = path.join(themesSourcePath, entry);
        const targetPath = path.join(destinationDir, 'themes', entry);
        try {
            cpSync(sourcePath, targetPath, { recursive: true });
        } catch (error) {
            throw wrapFileError(`Failed to copy ${sourcePath} -> ${targetPath}`, error, targetPath);
        }
    }
}

function runCommand(command, commandArgs, cwd) {
    const result = spawnSync(command, commandArgs, {
        cwd,
        stdio: 'inherit',
        shell: false
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function getNpmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function mapPlatform(value) {
    if (value === 'darwin') return 'macos';
    if (value === 'win32') return 'windows';
    if (value === 'linux') return 'linux';
    return value;
}

function printHelp() {
    console.log(`Usage: node scripts/deploy.mjs [options]

Options:
  --skip-build   Skip npm run build
  --release-only Refresh releases/<platform>/obsidian-term only
  --target <dir> Deploy to a specific Obsidian plugin directory
  -h, --help     Show help`);
}

function wrapFileError(message, error, filePath) {
    const wrappedError = error instanceof Error ? error : new Error(String(error));
    wrappedError.message = `${message}: ${wrappedError.message}`;
    wrappedError.cause = error;
    wrappedError.filePath = filePath;
    return wrappedError;
}

function reportDeployError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = getErrorCode(error);
    const filePath = getErrorFilePath(error);

    console.error(`Deploy failed: ${message}`);

    if (filePath) {
        console.error(`Path: ${filePath}`);
    }

    if (process.platform === 'win32' && isLockError(code)) {
        console.error('Windows file locking blocked deployment.');
        console.error('Close Obsidian and terminate any leftover pty-helper.exe processes, then run npm run deploy again.');
    }
}

function getErrorCode(error) {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return '';
    }

    return typeof error.code === 'string' ? error.code : String(error.code);
}

function getErrorFilePath(error) {
    if (!error || typeof error !== 'object') {
        return '';
    }

    if ('filePath' in error && typeof error.filePath === 'string') {
        return error.filePath;
    }

    if ('path' in error && typeof error.path === 'string') {
        return error.path;
    }

    return '';
}

function isLockError(code) {
    return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}
