#!/bin/bash

# 进入脚本所在目录
cd "$(dirname "$0")"

# 1. 把 src 的内容复制到插件目录的 dist 目录
echo "正在将 src 内容复制到 dist 目录..."

#如果有dist目录，先清除，保持干净的构建上下文
if [ -d "dist" ]; then
    rm -rf dist
fi

mkdir -p dist
cp -R src/* dist/

# 2. 进入 dist/preload 执行 install
echo "正在进入 dist/preload 安装依赖..."
cd dist/preload
npm install

echo "构建完成！"
