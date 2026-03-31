#!/bin/bash
# CI build script for ZTools-plugins GitHub Actions
# Runs from the plugin root directory (git root submitted to ZTools-plugins)
set -e

echo "Installing dependencies..."
npm install

echo "Building plugin (mode: ztools, outDir: dist)..."
npx vite build --mode ztools --outDir dist

echo "Copying plugin assets to dist/..."
cp ztools/plugin.json dist/plugin.json
cp ztools/preload.js  dist/preload.js
cp public/logo.png    dist/logo.png

echo "Build complete."
