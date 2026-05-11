#!/bin/bash

# 构建插件脚本
set -e  # 遇到错误立即退出

echo "开始构建插件..."

# 安装依赖
echo "1. 安装依赖..."
pnpm install

# 编译核心文件
echo "2. 编译核心文件..."
pnpm run build

# 编译插件
echo "3. 编译插件..."
pnpm --filter ctool-adapter-utools run platform-release

# 清空并创建 dist 目录
echo "4. 准备输出目录..."
rm -rf dist
mkdir -p dist

# 解压构建产物到 dist 目录
echo "5. 解压构建产物..."
if [ -f "_release/ctool_utools.zip" ]; then
    # 解压到 dist 目录
    unzip -q _release/ctool_utools.zip -d dist/
    echo "✓ 构建产物已解压到 dist/ctool_utools"
else
    echo "✗ 错误: _release/ctool_utools.zip 文件不存在"
    exit 1
fi

echo "构建完成！"
