# Release

This repository already builds a publishable macOS bundle into [`releases/macos`](/Volumes/扩展硬盘/obsdian/xTermObsidian/releases/macos). Use the script below to package that directory and publish it to GitHub Releases.

## One-time setup

1. Install GitHub CLI: `gh`
2. Log in once:

```bash
gh auth login
```

## Publish

From the repo root:

```bash
npm run release:github
```

The script will:

1. Run `./deploy.sh`
2. Refresh [`releases/macos`](/Volumes/扩展硬盘/obsdian/xTermObsidian/releases/macos)
3. Create `dist-release/ObsiTerm-macos-v<version>.zip`
4. Create or update GitHub Release `v<version>`
5. Upload the zip asset

## Dry run

```bash
npm run release:github -- --dry-run
```

## Common options

Skip rebuild:

```bash
npm run release:github -- --skip-build
```

Publish prerelease:

```bash
npm run release:github -- --prerelease
```

Override tag or title:

```bash
npm run release:github -- --tag v1.0.0 --title "ObsiTerm 1.0.0"
```

Use custom release notes:

```bash
npm run release:github -- --notes-file ./notes.md
```

## Recommended release order

1. Make sure `main` is up to date and clean.
2. Update version in [`manifest.json`](/Volumes/扩展硬盘/obsdian/xTermObsidian/manifest.json) if needed.
3. Commit and push `main`.
4. Run `npm run release:github`.
5. Open the generated GitHub Release page and confirm the uploaded asset.
