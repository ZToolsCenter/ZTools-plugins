#!/usr/bin/env bash
# ZTools 插件仓库的官方构建钩子：打包目录由 src-ztools/pkg 决定
# （scripts/build-plugins.js 只认插件根目录下的 plugin.json，
#  或 main 字段所在目录里确实有 plugin.json，因此运行时代码放在 pkg/）
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build-process-killer.mjs
