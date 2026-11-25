#!/usr/bin/env bash
# 市场 CI 的构建入口。
#
# 市场仓库只接收源码，这个脚本由 scripts/build-plugins.js 在插件目录下执行；
# 构建完成后，build-plugins.js 的 getManifestBuildDir() 依据 plugin.json 的
# main（app/index.html）取出 app/ 目录作为安装包内容。
#
# 三步与本地发版完全一致：装依赖 -> vite 构建到 app/ -> 把 plugin.json / preload / logo 复制进 app/。
set -euo pipefail

echo "[cmark] npm ci"
npm ci --no-audit --no-fund

echo "[cmark] npm run build"
npm run build

echo "[cmark] 准备 app/ 目录"
node scripts/pack.mjs

# 让安装包里带上文档，插件详情页与本地目录都能直接看到版本说明
for f in README.md CHANGELOG.md LICENSE THIRD-PARTY.md; do
  if [ -f "$f" ]; then cp "$f" app/; fi
done

echo "[cmark] 构建完成，产物在 app/"