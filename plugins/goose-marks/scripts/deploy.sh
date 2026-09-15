#!/bin/bash

# ==========================================
# 书签分享系统服务器部署脚本 (Docker/1Panel 专用)
# 项目名称: GooseMarks
# ==========================================

# 1. 进入部署目录
cd "${DEPLOY_PATH}" || exit 1

echo ">>> 正在更新目录权限..."
# 确保文件权限正确，方便容器内部读取
chmod -R 755 .

echo ">>> 正在重启 1Panel Docker 容器: GooseMarks..."

# 2. 重启 1Panel 中的项目容器
# 注意：1Panel 的容器名通常就是项目名，如果重启失败，请检查 1Panel 面板中的实际容器名
docker restart GooseMarks

if [ $? -eq 0 ]; then
    echo ">>> 部署成功！GooseMarks 容器已重启。"
else
    echo ">>> 错误: 无法重启容器，请检查容器名称是否为 GooseMarks。"
    exit 1
fi
