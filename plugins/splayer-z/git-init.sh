#!/bin/bash

echo "========================================"
echo "   Git 仓库初始化脚本"
echo "========================================"
echo ""

# 检查是否已经初始化
if [ -d .git ]; then
    echo "[警告] Git 仓库已存在！"
    echo ""
    read -p "是否继续 (将跳过 git init)? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "[1/6] 初始化 Git 仓库..."
    git init
    echo "✅ Git 仓库初始化完成"
    echo ""
fi

echo "[2/6] 配置 Git 用户信息..."
read -p "请输入你的 Git 用户名: " username
git config user.name "$username"

read -p "请输入你的 Git 邮箱: " email
git config user.email "$email"
echo "✅ 用户信息配置完成"
echo ""

echo "[3/6] 配置 Git 设置..."
git config core.autocrlf false
git config core.ignorecase false
echo "✅ Git 设置配置完成"
echo ""

echo "[4/6] 添加文件到暂存区..."
git add .
echo "✅ 文件添加完成"
echo ""

echo "[5/6] 查看状态..."
git status
echo ""

echo "[6/6] 创建首次提交..."
git commit -m "🎉 Initial commit: SPlayer ZTools Plugin Monorepo

- 完成 Monorepo 架构搭建
- 实现 Fastify API 服务器 (366 个路由)
- 完成用户登录和认证功能
- 实现音乐播放和歌词显示
- 优化 UI 界面 (侧边栏折叠、设置页面滚动)
- 添加完整的项目文档"
echo "✅ 首次提交完成"
echo ""

echo "========================================"
echo "   初始化完成！"
echo "========================================"
echo ""
echo "下一步:"
echo "1. 在 GitHub/Gitee 创建远程仓库"
echo "2. 关联远程仓库:"
echo "   git remote add origin https://github.com/your-username/splayer-porting.git"
echo "3. 推送代码:"
echo "   git push -u origin master"
echo ""
echo "详细说明请查看: GIT_SETUP.md"
echo ""

