#!/bin/bash

# Define paths
SOURCE_BIN="$PWD/packages/opencode/dist/opencode-linux-x64/bin/opencode"
TARGET_BIN="/home/ness/.opencode/bin/opencode"
BACKUP_BIN="${TARGET_BIN}.orig.$(date +%Y%m%d_%H%M%S)"

# 1. Validation: Ensure we are in the right spot
if [ ! -f "$SOURCE_BIN" ]; then
    echo "❌ Local binary not found at: $SOURCE_BIN"
    echo "Run './packages/opencode/script/build.ts --single' first."
    exit 1
fi

# 2. Backup: Save the original if it exists and isn't already a symlink
if [ -f "$TARGET_BIN" ] && [ ! -L "$TARGET_BIN" ]; then
    echo "📦 Backing up original binary to $BACKUP_BIN"
    cp "$TARGET_BIN" "$BACKUP_BIN"
fi

# 3. Deploy: Remove the old target and create a symlink
echo "🚀 Deploying local dev version to $TARGET_BIN"
rm -f "$TARGET_BIN"
ln -s "$SOURCE_BIN" "$TARGET_BIN"

echo "✅ Done! 'which opencode' now points to your local build."
