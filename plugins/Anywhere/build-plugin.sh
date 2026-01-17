#!/bin/bash

# 构建脚本 - 自动化构建 Anywhere 插件
# 构建顺序：backend -> Anywhere_main -> Anywhere_window -> 复制文件

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}🚀 开始构建 Anywhere 插件${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 记录开始时间
START_TIME=$(date +%s)

# 函数：构建单个项目
build_project() {
    local project_name=$1
    local project_path=$2

    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}📦 构建: ${project_name}${NC}"
    echo -e "${YELLOW}========================================${NC}"

    if [ ! -d "$project_path" ]; then
        echo -e "${RED}❌ 错误: 目录不存在 - ${project_path}${NC}"
        exit 1
    fi

    cd "$project_path"

    # 安装依赖
    echo -e "${BLUE}📥 安装依赖...${NC}"
    pnpm install

    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ ${project_name} 依赖安装失败${NC}"
        exit 1
    fi

    # 构建
    echo -e "${BLUE}🔨 开始构建...${NC}"
    pnpm build

    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ ${project_name} 构建失败${NC}"
        exit 1
    fi

    echo -e "${GREEN}✅ ${project_name} 构建成功${NC}"
    echo ""

    cd "$SCRIPT_DIR"
}

# 1. 清理旧的 dist 目录
echo -e "${BLUE}🧹 清理旧的 dist 目录...${NC}"
if [ -d "dist" ]; then
    rm -rf dist
    echo -e "${GREEN}✅ 旧的 dist 目录已清理${NC}"
fi
echo ""

# 2. 创建 dist 目录结构
echo -e "${BLUE}📁 创建 dist 目录结构...${NC}"
mkdir -p dist/main
mkdir -p dist/window
mkdir -p dist/fast_window
echo -e "${GREEN}✅ 目录结构创建完成${NC}"
echo ""

# 3. 构建 backend
build_project "Backend" "$SCRIPT_DIR/backend"

# 4. 构建 Anywhere_main
build_project "Anywhere Main" "$SCRIPT_DIR/Anywhere_main"

# 5. 构建 Anywhere_window
build_project "Anywhere Window" "$SCRIPT_DIR/Anywhere_window"

# 6. 复制构建产物
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}📋 复制构建产物${NC}"
echo -e "${YELLOW}========================================${NC}"

# 复制 Anywhere_main/dist 到 dist/main
echo -e "${BLUE}📦 复制 Anywhere_main 构建产物...${NC}"
if [ -d "Anywhere_main/dist" ]; then
    cp -r Anywhere_main/dist/* dist/main/
    echo -e "${GREEN}✅ Anywhere_main 产物已复制到 dist/main/${NC}"
else
    echo -e "${RED}❌ 错误: Anywhere_main/dist 不存在${NC}"
    exit 1
fi

# 复制 Anywhere_window/dist 到 dist/window
echo -e "${BLUE}📦 复制 Anywhere_window 构建产物...${NC}"
if [ -d "Anywhere_window/dist" ]; then
    cp -r Anywhere_window/dist/* dist/window/
    echo -e "${GREEN}✅ Anywhere_window 产物已复制到 dist/window/${NC}"
else
    echo -e "${RED}❌ 错误: Anywhere_window/dist 不存在${NC}"
    exit 1
fi

# 复制 backend/public 到 dist 根目录
echo -e "${BLUE}📦 复制 backend 构建产物...${NC}"
if [ -d "backend/public" ]; then
    cp -r backend/public/* dist/
    echo -e "${GREEN}✅ backend 产物已复制到 dist/${NC}"
else
    echo -e "${RED}❌ 错误: backend/public 不存在${NC}"
    exit 1
fi

# 复制 Fast_window 到 dist/fast_window
echo -e "${BLUE}📦 复制 Fast_window...${NC}"
if [ -d "Fast_window" ]; then
    cp -r Fast_window/* dist/fast_window/
    echo -e "${GREEN}✅ Fast_window 已复制到 dist/fast_window/${NC}"
else
    echo -e "${RED}❌ 错误: Fast_window 目录不存在${NC}"
    exit 1
fi

# 复制 public 文件夹到 dist 根目录
echo -e "${BLUE}📦 复制 public 文件夹...${NC}"
if [ -d "public" ]; then
    cp -r public/* dist/
    echo -e "${GREEN}✅ public 文件夹已复制到 dist/${NC}"
else
    echo -e "${RED}❌ 错误: public 目录不存在${NC}"
    exit 1
fi

echo ""

# 计算耗时
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 所有构建任务完成！${NC}"
echo -e "${GREEN}⏱️  总耗时: ${ELAPSED} 秒${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}📂 构建产物位置: ${SCRIPT_DIR}/dist${NC}"
