#!/bin/bash
# Build and deploy xTermObsidian plugin

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="/Users/fengzheng/知识管理/风筝记/.obsidian/plugins/obsidian-term"

echo "🔨 Building plugin..."
cd "$SCRIPT_DIR"
npm run build

echo "📁 Creating target directory..."
mkdir -p "$TARGET_DIR"
mkdir -p "$TARGET_DIR/resources"
mkdir -p "$TARGET_DIR/themes"

echo "📦 Copying files..."
cp main.js "$TARGET_DIR/"
cp manifest.json "$TARGET_DIR/"
cp styles.css "$TARGET_DIR/"
cp -r resources/* "$TARGET_DIR/resources/"
cp -r themes/* "$TARGET_DIR/themes/"

echo "✅ Deployed to: $TARGET_DIR"
echo ""
echo "📋 Copied files:"
ls -la "$TARGET_DIR"
