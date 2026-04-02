#!/bin/bash
# CI build script for ZTools-plugins GitHub Actions
# Runs from the plugin root directory: plugins/project-manager/
# plugin.json, preload.js, logo.png are already at this level.
set -e

echo "Installing dependencies..."
npm install

echo "Building plugin (mode: ztools, outDir: dist)..."
npx vite build --mode ztools --outDir dist

echo "Copying plugin assets to dist/..."
cp plugin.json dist/plugin.json
cp preload.js  dist/preload.js
cp logo.png    dist/logo.png

echo "Build complete."
