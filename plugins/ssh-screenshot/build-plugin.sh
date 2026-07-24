#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "==> 1/3 install build deps (vue + vite)"
npm install

echo "==> 2/3 install runtime deps for preload (node-ssh)"
(cd src/release_npm && npm install --omit=dev)

echo "==> 3/3 vite build"
npm run build

echo
echo "构建完成，可加载的插件目录： $(pwd)/dist"
