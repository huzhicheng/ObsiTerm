import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const rootDir = path.resolve(import.meta.dirname, '..');
const distDir = path.join(rootDir, 'dist-release');

const args = process.argv.slice(2);
const options = {
    version: '',
    tag: '',
    title: '',
    notesFile: '',
    skipBuild: false,
    packageOnly: false,
    prerelease: false,
    dryRun: false,
    platform: mapPlatform(process.platform)
};

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
        case '--version':
            options.version = args[++i] ?? '';
            break;
        case '--tag':
            options.tag = args[++i] ?? '';
            break;
        case '--title':
            options.title = args[++i] ?? '';
            break;
        case '--notes-file':
            options.notesFile = args[++i] ?? '';
            break;
        case '--platform':
            options.platform = args[++i] ?? '';
            break;
        case '--skip-build':
            options.skipBuild = true;
            break;
        case '--package-only':
            options.packageOnly = true;
            break;
        case '--prerelease':
            options.prerelease = true;
            break;
        case '--dry-run':
            options.dryRun = true;
            break;
        case '-h':
        case '--help':
            printHelp();
            process.exit(0);
        default:
            console.error(`Unknown option: ${arg}`);
            printHelp();
            process.exit(1);
    }
}

const releaseDir = path.join(rootDir, 'releases', options.platform);
const bundleDir = path.join(releaseDir, 'obsidian-term');
const manifestPath = path.join(bundleDir, 'manifest.json');

ensureCommand('git');
ensureArchiveSupport();

if (!options.skipBuild) {
    if (options.platform !== mapPlatform(process.platform)) {
        throw new Error(`Cannot build ${options.platform} assets on ${mapPlatform(process.platform)}. Use --skip-build to package an existing bundle.`);
    }

    runCommand(process.execPath, ['scripts/deploy.mjs', '--release-only'], rootDir);
}

if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
}

if (!options.version) {
    options.version = readManifestVersion(manifestPath);
}

if (!options.version) {
    throw new Error(`Failed to determine version from ${manifestPath}`);
}

if (!options.tag) {
    options.tag = `v${options.version}`;
}

if (!options.title) {
    options.title = `ObsiTerm ${options.version}`;
}

mkdirSync(distDir, { recursive: true });

const zipBaseName = `ObsiTerm-${options.platform}-${options.tag}.zip`;
const zipPath = path.join(distDir, zipBaseName);
const autoNotesFile = path.join(distDir, `release-notes-${options.platform}-${options.tag}.md`);
const generatedNotes = generateNotes(options);

if (!options.notesFile) {
    options.notesFile = autoNotesFile;
}

if (options.dryRun) {
    console.log('Dry run only.');
    console.log(`Platform: ${options.platform}`);
    console.log(`Version: ${options.version}`);
    console.log(`Tag: ${options.tag}`);
    console.log(`Title: ${options.title}`);
    console.log(`Zip: ${zipPath}`);
    console.log(`Notes: ${options.notesFile}`);
    console.log(`Package only: ${options.packageOnly ? 'yes' : 'no'}`);
    console.log(`Prerelease: ${options.prerelease ? 'yes' : 'no'}`);
    process.exit(0);
}

mkdirSync(distDir, { recursive: true });
rmSync(zipPath, { force: true });
createArchive(releaseDir, zipPath, getArchiveItems(options.platform));

if (options.notesFile === autoNotesFile) {
    writeFileSync(autoNotesFile, generatedNotes, 'utf8');
}

if (options.packageOnly) {
    console.log('Release package created locally.');
    console.log(`Zip: ${zipPath}`);
    console.log(`Notes: ${options.notesFile}`);
    process.exit(0);
}

ensureCommand('gh');
runCommand('gh', ['auth', 'status'], rootDir);

if (commandSucceeded('gh', ['release', 'view', options.tag], rootDir)) {
    console.log(`Release ${options.tag} already exists. Uploading asset and updating notes/title...`);
    runCommand('gh', ['release', 'upload', options.tag, zipPath, '--clobber'], rootDir);
    runCommand('gh', ['release', 'edit', options.tag, '--title', options.title, '--notes-file', options.notesFile], rootDir);
} else {
    const createArgs = [
        'release',
        'create',
        options.tag,
        zipPath,
        '--title',
        options.title,
        '--notes-file',
        options.notesFile
    ];

    if (options.prerelease) {
        createArgs.push('--prerelease');
    }

    runCommand('gh', createArgs, rootDir);
}

console.log('Release published.');
console.log(`Tag: ${options.tag}`);
console.log(`Asset: ${zipPath}`);

function getArchiveItems(platform) {
    if (platform === 'macos' && existsSync(path.join(releaseDir, 'install.sh'))) {
        return ['install.sh', 'obsidian-term'];
    }

    return ['obsidian-term'];
}

function createArchive(cwd, archivePath, items) {
    if (process.platform === 'win32') {
        const archiveItems = items.map((item) => `'${item.replace(/'/g, "''")}'`).join(', ');
        const escapedArchivePath = archivePath.replace(/'/g, "''");
        runCommand(
            'powershell',
            [
                '-NoProfile',
                '-Command',
                `Compress-Archive -Path ${archiveItems} -DestinationPath '${escapedArchivePath}' -Force`
            ],
            cwd
        );
        return;
    }

    runCommand('zip', ['-r', archivePath, ...items], cwd);
}

function generateNotes(options) {
    const lastTag = getCommandOutput('git', ['tag', '--sort=-v:refname'], rootDir)
        .split(/\r?\n/)
        .find(Boolean);
    const repo = normalizeRepoSlug(getCommandOutput('git', ['remote', 'get-url', 'origin'], rootDir).trim());
    const logArgs = lastTag
        ? ['log', `${lastTag}..HEAD`, '--pretty=format:- %s (%h)']
        : ['log', '--pretty=format:- %s (%h)'];
    const changes = getCommandOutput('git', logArgs, rootDir).trim();

    return [
        `## ObsiTerm ${options.version}`,
        '',
        '### Assets',
        `- ${options.platform} release bundle zip`,
        '',
        lastTag ? `### Changes Since ${lastTag}` : '### Changes',
        changes || '- No commits found',
        '',
        `Repository: https://github.com/${repo}`
    ].join('\n');
}

function readManifestVersion(manifestPath) {
    const contents = readFileSync(manifestPath, 'utf8');
    const match = contents.match(/"version"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? '';
}

function ensureCommand(command) {
    if (!commandSucceeded(command, ['--version'], rootDir) && !commandSucceeded(command, ['version'], rootDir)) {
        throw new Error(`Missing required command: ${command}`);
    }
}

function ensureArchiveSupport() {
    if (process.platform === 'win32') {
        if (!commandSucceeded('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], rootDir)) {
            throw new Error('Missing required command: powershell');
        }
        return;
    }

    if (!commandSucceeded('zip', ['-v'], rootDir)) {
        throw new Error('Missing required command: zip');
    }
}

function commandSucceeded(command, commandArgs, cwd) {
    const result = spawnSync(command, commandArgs, {
        cwd,
        stdio: 'ignore',
        shell: false
    });
    return result.status === 0;
}

function getCommandOutput(command, commandArgs, cwd) {
    const result = spawnSync(command, commandArgs, {
        cwd,
        encoding: 'utf8',
        shell: false
    });

    if (result.status !== 0) {
        throw new Error(result.stderr || `Command failed: ${command} ${commandArgs.join(' ')}`);
    }

    return result.stdout;
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

function mapPlatform(value) {
    if (value === 'darwin') return 'macos';
    if (value === 'win32') return 'windows';
    if (value === 'linux') return 'linux';
    return value;
}

function normalizeRepoSlug(remoteUrl) {
    return remoteUrl
        .replace(/^git@github\.com:/, '')
        .replace(/^https:\/\/github\.com\//, '')
        .replace(/\.git$/, '');
}

function printHelp() {
    console.log(`Usage: node scripts/release-github.mjs [options]

Options:
  --version <version>  Override version
  --tag <tag>          Override tag, default v<version>
  --title <title>      Override release title
  --notes-file <path>  Use a custom release notes file
  --platform <name>    Package releases/<platform>, default current platform
  --skip-build         Skip npm run deploy
  --package-only       Create zip and notes without publishing to GitHub
  --prerelease         Mark release as prerelease
  --dry-run            Print actions without publishing
  -h, --help           Show help`);
}
