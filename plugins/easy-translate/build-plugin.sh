#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "开始构建 easy-translate 插件..."

# 进入 preload 目录并安装依赖
echo "正在安装 preload 依赖..."
cd src/preload
npm install
if [ $? -ne 0 ]; then
    echo "错误: npm install 失败"
    exit 1
fi

# 返回项目根目录
cd "$SCRIPT_DIR"

# 创建或清空 dist 目录
echo "正在准备 dist 目录..."
if [ -d "dist" ]; then
    rm -rf dist
fi
mkdir -p dist

# 复制 src 目录的所有内容到 dist
echo "正在复制文件到 dist 目录..."
cp -r src/* dist/

echo "构建完成！"
