#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting plugin build process..."

# Step 1: Install specific pnpm version
echo "📦 Installing pnpm@9.12.2..."
if ! command -v pnpm &> /dev/null || [ "$(pnpm -v)" != "9.12.2" ]; then
    npm install -g pnpm@9.12.2
fi

# Step 2: Install dependencies
echo "📥 Installing dependencies..."
pnpm i

# Step 3: Build the plugin
echo "🔨 Building plugin..."
pnpm build

echo "✅ Build completed successfully!"
