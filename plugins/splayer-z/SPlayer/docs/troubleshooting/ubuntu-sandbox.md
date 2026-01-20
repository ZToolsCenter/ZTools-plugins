# Ubuntu 系统沙箱启动失败

在 Ubuntu 及其他 Linux 发行版上，可能会遇到 Electron 应用因沙箱限制而无法启动的问题。

## 问题现象

启动应用时出现以下错误：

```
[xxxx:xxxx:xxxx] FATAL:setuid_sandbox_host.cc(163)]
The SUID sandbox helper binary was found, but is not configured correctly.
```

或

```
Running as root without --no-sandbox is not supported.
```

## 原因分析

Electron 使用 Chromium 的沙箱机制来增强安全性。在某些 Linux 配置下，沙箱可能无法正常工作：

1. **用户命名空间未启用**：内核未开启用户命名空间功能
2. **权限问题**：沙箱辅助程序权限配置不正确
3. **容器/WSL 环境**：在容器或 WSL 中运行时沙箱受限

## 解决方案

### 方案一：启用用户命名空间（推荐）

这是最安全的解决方案：

```bash
# 检查当前状态
cat /proc/sys/kernel/unprivileged_userns_clone

# 如果输出 0，需要启用
echo 1 | sudo tee /proc/sys/kernel/unprivileged_userns_clone

# 永久启用（重启后生效）
echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/00-local-userns.conf
sudo sysctl --system
```

### 方案二：配置沙箱权限

设置 chrome-sandbox 的正确权限：

```bash
# 找到 chrome-sandbox 文件位置
find /opt -name "chrome-sandbox" 2>/dev/null
# 或
find /usr -name "chrome-sandbox" 2>/dev/null

# 设置正确的权限和所有者
sudo chown root:root /path/to/chrome-sandbox
sudo chmod 4755 /path/to/chrome-sandbox
```

对于 AppImage 格式：

```bash
# 解压 AppImage
./SPlayer.AppImage --appimage-extract

# 设置权限
sudo chown root:root squashfs-root/chrome-sandbox
sudo chmod 4755 squashfs-root/chrome-sandbox

# 运行解压后的版本
./squashfs-root/splayer
```

### 方案三：禁用沙箱（不推荐）

::: danger 安全警告
禁用沙箱会降低应用的安全性，仅在其他方法无效时使用。
:::

**方法 1：命令行参数**

```bash
./SPlayer.AppImage --no-sandbox
```

**方法 2：环境变量**

```bash
export ELECTRON_DISABLE_SANDBOX=1
./SPlayer.AppImage
```

**方法 3：修改 .desktop 文件**

```bash
# 编辑桌面快捷方式
sudo nano /usr/share/applications/splayer.desktop

# 修改 Exec 行，添加 --no-sandbox
Exec=/path/to/SPlayer.AppImage --no-sandbox %U
```

## 特定发行版解决方案

### Ubuntu 22.04+

```bash
# 安装必要的库
sudo apt update
sudo apt install libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2

# 启用用户命名空间
echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/00-local-userns.conf
sudo sysctl --system
```

### Debian

```bash
# 安装依赖
sudo apt install libnotify4 libsecret-1-0

# 启用用户命名空间
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

### Arch Linux

```bash
# 安装依赖
sudo pacman -S nss libxss alsa-lib libpulse

# 通常 Arch 默认已启用用户命名空间
```

### Fedora

```bash
# 安装依赖
sudo dnf install libXScrnSaver alsa-lib

# Fedora 通常不需要额外配置沙箱
```

## WSL 环境

在 Windows Subsystem for Linux 中运行 Electron 应用需要特殊配置：

1. **使用 WSL2**：WSL1 不支持图形界面应用
2. **安装 WSLg**：Windows 11 或 Windows 10 21H2+
3. **禁用沙箱**：WSL 环境中沙箱通常无法正常工作

```bash
# WSL 中运行
export DISPLAY=:0
./SPlayer.AppImage --no-sandbox
```

## Docker 容器

在 Docker 中运行需要额外的安全配置：

```dockerfile
# Dockerfile 示例
FROM node:24

# 安装依赖
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2

# 必须添加 --no-sandbox 参数运行
```

运行容器时：

```bash
docker run --cap-add SYS_ADMIN splayer-container
```

## 验证修复

修复后，验证应用是否正常启动：

```bash
# 检查进程
ps aux | grep -i splayer

# 查看日志
./SPlayer.AppImage 2>&1 | head -50
```

## 仍有问题？

如果上述方法都无法解决问题，请提交 Issue 并附上：

1. Linux 发行版和版本
2. 完整的错误信息
3. `uname -a` 输出
4. `cat /proc/sys/kernel/unprivileged_userns_clone` 输出
