#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RELEASE_DIR="${REPO_ROOT}/releases/macos"
MANIFEST_PATH="${RELEASE_DIR}/obsidian-term/manifest.json"
DIST_DIR="${REPO_ROOT}/dist-release"

DRY_RUN=0
SKIP_BUILD=0
PRERELEASE=0
VERSION=""
TAG=""
TITLE=""
NOTES_FILE=""

usage() {
    cat <<'EOF'
Usage:
  ./scripts/release-github.sh [options]

Options:
  --version <version>     Override version. Default: read from releases/macos/obsidian-term/manifest.json
  --tag <tag>             Override tag. Default: v<version>
  --title <title>         Override release title. Default: ObsiTerm <version>
  --notes-file <path>     Use a custom release notes file
  --skip-build            Skip ./deploy.sh
  --prerelease            Mark GitHub release as prerelease
  --dry-run               Print actions without creating release
  -h, --help              Show help
EOF
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

read_manifest_version() {
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST_PATH" | head -n 1
}

repo_slug() {
    git remote get-url origin | sed -E 's#(git@github\.com:|https://github\.com/)##; s#\.git$##'
}

latest_tag() {
    git tag --sort=-v:refname | head -n 1
}

generate_notes() {
    local notes_path="$1"
    local last_tag
    local repo

    last_tag="$(latest_tag)"
    repo="$(repo_slug)"

    {
        echo "## ObsiTerm ${VERSION}"
        echo
        echo "### Assets"
        echo "- macOS release bundle zip"
        echo "- install.sh"
        echo "- obsidian-term plugin bundle"
        echo
        if [ -n "$last_tag" ]; then
            echo "### Changes Since ${last_tag}"
            git log "${last_tag}..HEAD" --pretty=format:'- %s (%h)'
        else
            echo "### Changes"
            git log --pretty=format:'- %s (%h)'
        fi
        echo
        echo
        echo "Repository: https://github.com/${repo}"
    } > "$notes_path"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --version)
            VERSION="${2:-}"
            shift 2
            ;;
        --tag)
            TAG="${2:-}"
            shift 2
            ;;
        --title)
            TITLE="${2:-}"
            shift 2
            ;;
        --notes-file)
            NOTES_FILE="${2:-}"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=1
            shift
            ;;
        --prerelease)
            PRERELEASE=1
            shift
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            exit 1
            ;;
    esac
done

require_cmd git
require_cmd gh
require_cmd zip

if [ ! -f "$MANIFEST_PATH" ]; then
    echo "Manifest not found: $MANIFEST_PATH" >&2
    exit 1
fi

cd "$REPO_ROOT"

if [ "$SKIP_BUILD" -eq 0 ]; then
    echo "Running ./deploy.sh to refresh releases/macos..."
    ./deploy.sh
fi

if [ -z "$VERSION" ]; then
    VERSION="$(read_manifest_version)"
fi

if [ -z "$VERSION" ]; then
    echo "Failed to determine version from ${MANIFEST_PATH}" >&2
    exit 1
fi

if [ -z "$TAG" ]; then
    TAG="v${VERSION}"
fi

if [ -z "$TITLE" ]; then
    TITLE="ObsiTerm ${VERSION}"
fi

mkdir -p "$DIST_DIR"

ZIP_BASENAME="ObsiTerm-macos-${TAG}.zip"
ZIP_PATH="${DIST_DIR}/${ZIP_BASENAME}"
AUTO_NOTES_FILE="${DIST_DIR}/release-notes-${TAG}.md"

rm -f "$ZIP_PATH"
(
    cd "$RELEASE_DIR"
    zip -r "$ZIP_PATH" install.sh obsidian-term >/dev/null
)

if [ -z "$NOTES_FILE" ]; then
    generate_notes "$AUTO_NOTES_FILE"
    NOTES_FILE="$AUTO_NOTES_FILE"
fi

if [ "$DRY_RUN" -eq 1 ]; then
    echo "Dry run only."
    echo "Version: $VERSION"
    echo "Tag: $TAG"
    echo "Title: $TITLE"
    echo "Zip: $ZIP_PATH"
    echo "Notes: $NOTES_FILE"
    if [ "$PRERELEASE" -eq 1 ]; then
        echo "Release type: prerelease"
    else
        echo "Release type: normal"
    fi
    exit 0
fi

gh auth status >/dev/null

if gh release view "$TAG" >/dev/null 2>&1; then
    echo "Release ${TAG} already exists. Uploading asset and updating notes/title..."
    gh release upload "$TAG" "$ZIP_PATH" --clobber
    gh release edit "$TAG" --title "$TITLE" --notes-file "$NOTES_FILE"
else
    CREATE_ARGS=(
        release create "$TAG" "$ZIP_PATH"
        --title "$TITLE"
        --notes-file "$NOTES_FILE"
    )
    if [ "$PRERELEASE" -eq 1 ]; then
        CREATE_ARGS+=(--prerelease)
    fi
    gh "${CREATE_ARGS[@]}"
fi

echo "Release published."
echo "Tag: $TAG"
echo "Asset: $ZIP_PATH"
