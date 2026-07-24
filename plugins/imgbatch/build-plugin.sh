#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
RUNTIME_SRC_DIR="$SCRIPT_DIR/runtime-packages"
RUNTIME_DIST_DIR="$DIST_DIR/runtime-packages"

cd "$SCRIPT_DIR"

echo "Building imgbatch plugin package..."

if [ ! -f "node_modules/gifenc/dist/gifenc.js" ] || [ ! -f "node_modules/pdf-lib/node_modules/tslib/tslib.js" ]; then
  echo "Installing npm dependencies required to complete runtime-packages..."
  npm ci
fi

echo "Preparing clean dist directory..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

echo "Copying plugin files..."
cp -R assets "$DIST_DIR/"
cp -R lib "$DIST_DIR/"
cp -R workers "$DIST_DIR/"
cp -R "$RUNTIME_SRC_DIR" "$RUNTIME_DIST_DIR"
cp index.html plugin.json preload.js logo.png "$DIST_DIR/"

echo "Completing runtime dependencies..."
mkdir -p "$RUNTIME_DIST_DIR/gifenc/dist"
cp node_modules/gifenc/dist/gifenc.js "$RUNTIME_DIST_DIR/gifenc/dist/"

mkdir -p "$RUNTIME_DIST_DIR/tslib"
cp node_modules/pdf-lib/node_modules/tslib/package.json "$RUNTIME_DIST_DIR/tslib/"
cp node_modules/pdf-lib/node_modules/tslib/tslib.js "$RUNTIME_DIST_DIR/tslib/"
cp node_modules/pdf-lib/node_modules/tslib/LICENSE.txt "$RUNTIME_DIST_DIR/tslib/" 2>/dev/null || true

echo "Pruning development-only runtime files..."
rm -rf "$RUNTIME_DIST_DIR/pdf-lib/es"
rm -rf "$RUNTIME_DIST_DIR/pdf-lib/src"
rm -rf "$RUNTIME_DIST_DIR/pdf-lib/ts3.4"
rm -rf "$RUNTIME_DIST_DIR/pdf-lib/dist"
rm -rf "$RUNTIME_DIST_DIR/@pdf-lib/standard-fonts/es"
rm -rf "$RUNTIME_DIST_DIR/@pdf-lib/standard-fonts/dist"
rm -rf "$RUNTIME_DIST_DIR/@pdf-lib/upng/dist"
rm -rf "$RUNTIME_DIST_DIR/pako/dist"
rm -rf "$RUNTIME_DIST_DIR/sharp/install"
rm -rf "$RUNTIME_DIST_DIR/sharp/src"

find "$DIST_DIR" -name ".DS_Store" -delete
find "$RUNTIME_DIST_DIR" -type f \( \
  -name "*.map" -o \
  -name "*.d.ts" -o \
  -name "*.ts" -o \
  -name "README*" -o \
  -name "CHANGELOG*" -o \
  -name "yarn.lock" \
\) -delete

echo "Verifying runtime module resolution..."
NODE_PATH="$RUNTIME_DIST_DIR" node - <<'NODE'
for (const packageName of ['pdf-lib', 'gifenc']) {
  require(packageName)
}
NODE

echo "Build complete: $DIST_DIR"
