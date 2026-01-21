#!/bin/bash

# 构建插件脚本
set -e  # 遇到错误立即退出

echo "开始构建插件..."

# 安装主目录依赖
echo "1. 安装主目录依赖..."
npm install

# 安装 release_npm 依赖
echo "2. 安装 release_npm 依赖..."
cd src/release_npm
npm install
cd ../..
echo "✓ 依赖安装完成"

# 构建插件
echo "3. 构建插件..."
npm run build

echo "构建完成！"
