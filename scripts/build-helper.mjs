import { cpSync, existsSync, mkdirSync, chmodSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const cargoManifest = path.join(rootDir, 'native', 'pty-helper', 'Cargo.toml');
const releaseDir = path.join(rootDir, 'native', 'pty-helper', 'target', 'release');
const helperFileName = process.platform === 'win32' ? 'pty-helper.exe' : 'pty-helper';
const builtHelperPath = path.join(releaseDir, helperFileName);
const resourcesDir = path.join(rootDir, 'resources');
const targetHelperPath = path.join(resourcesDir, helperFileName);

const cargoResult = spawnSync('cargo', ['build', '--release', '--manifest-path', cargoManifest], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
});

if (cargoResult.status !== 0) {
    process.exit(cargoResult.status ?? 1);
}

if (!existsSync(builtHelperPath)) {
    console.error(`Built PTY helper not found at ${builtHelperPath}`);
    process.exit(1);
}

mkdirSync(resourcesDir, { recursive: true });
try {
    cpSync(builtHelperPath, targetHelperPath);
} catch (error) {
    if (
        process.platform === 'win32'
        && error
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'EPERM'
    ) {
        console.warn(`Skipping helper copy because ${targetHelperPath} is locked by another process.`);
        console.warn('Close Obsidian and rerun the build if you need the updated helper binary in resources/.');
    } else {
        throw error;
    }
}

if (process.platform !== 'win32') {
    chmodSync(targetHelperPath, 0o755);
}
