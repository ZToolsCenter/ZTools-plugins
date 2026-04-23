#!/bin/bash

# 构建沙拉查词 ZTools 插件脚本
# 在干净环境下执行，构建产物输出到 dist/ 目录
set -e  # 遇到错误立即退出

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 脚本所在目录即为插件源码目录（也是 git 根目录）
# dist 输出到脚本所在目录下的 dist/
DIST_DIR="$SCRIPT_DIR/dist"

echo "开始构建沙拉查词 ZTools 插件..."

# 1. 安装根目录依赖
echo "1. 安装根目录依赖..."
pnpm install

# 2. 安装模拟器子工程依赖
echo "2. 安装 webextensions-emulator 依赖..."
cd "$SCRIPT_DIR/webextensions-emulator-master"
pnpm install

# 3. 构建模拟器
echo "3. 构建 webextensions-emulator..."
pnpm run build
cd "$SCRIPT_DIR"

# 4. 执行路径替换（将 ext-saladic 中的浏览器扩展路径适配为 ZTools 环境）
echo "4. 执行路径替换..."
cd "$SCRIPT_DIR/webextensions-emulator-master"
node replace_url.js
cd "$SCRIPT_DIR"

# 5. 清空并创建 dist 目录
echo "5. 准备输出目录..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 6. 复制插件文件到 dist
echo "6. 复制插件文件到 dist/..."

# 复制入口文件和元数据
cp "$SCRIPT_DIR/index.html" "$DIST_DIR/"
cp "$SCRIPT_DIR/plugin.json" "$DIST_DIR/"

# 打包 preload.cjs（将 axios/tough-cookie 等依赖内联，electron 保持外部引用）
echo "  打包 preload.cjs..."
npx esbuild "$SCRIPT_DIR/preload.cjs" \
  --bundle \
  --platform=node \
  --external:electron \
  --outfile="$DIST_DIR/preload.cjs" \
  --format=cjs

# 复制 preload 目录
cp -r "$SCRIPT_DIR/preload" "$DIST_DIR/"

# 复制 Saladict 扩展资源
cp -r "$SCRIPT_DIR/ext-saladic" "$DIST_DIR/"

# 复制模拟器构建产物（排除 .map 文件和 .DS_Store）
mkdir -p "$DIST_DIR/webextensions-emulator-master/dist"
cp "$SCRIPT_DIR/webextensions-emulator-master/dist/core.js" "$DIST_DIR/webextensions-emulator-master/dist/"
cp "$SCRIPT_DIR/webextensions-emulator-master/dist/background.js" "$DIST_DIR/webextensions-emulator-master/dist/"

# 7. 清理 dist 中的 .DS_Store 文件
echo "7. 清理 .DS_Store 文件..."
find "$DIST_DIR" -name '.DS_Store' -delete

echo "构建完成！产物已输出到 dist/ 目录"
