# macOS ARM 设备 API 启动失败

在 Apple Silicon (M1/M2/M3) 设备上，可能会遇到 API 服务启动失败的问题。

## 问题现象

启动应用后，出现以下情况：

- 无法加载歌曲列表
- API 请求超时或失败
- 控制台显示 "API server failed to start" 错误

## 原因分析

### 1. Node.js 架构不匹配

如果系统中安装的 Node.js 是 x64 版本，在 ARM 设备上可能会有兼容性问题。

### 2. 依赖编译问题

部分原生 Node.js 模块需要针对 ARM 架构重新编译。

### 3. Rosetta 转译问题

通过 Rosetta 2 运行的 x64 应用可能与系统服务存在兼容性问题。

## 解决方案

### 方案一：使用 ARM 原生版本

确保下载并安装 ARM 架构的 SPlayer：

1. 访问 [GitHub Releases](https://github.com/imsyy/SPlayer/releases)
2. 下载文件名包含 `arm64` 的版本
3. 删除旧版本后重新安装

### 方案二：检查 Node.js 架构

如果您在开发环境中遇到此问题：

```bash
# 检查 Node.js 架构
node -p "process.arch"

# 应该显示 arm64
# 如果显示 x64，需要重新安装 ARM 版本的 Node.js
```

**重新安装 ARM 版本 Node.js：**

```bash
# 使用 nvm 安装 ARM 版本
arch -arm64 zsh
nvm install 24

# 验证架构
node -p "process.arch"  # 应显示 arm64
```

### 方案三：重新编译依赖

在开发环境中，删除并重新安装依赖：

```bash
# 删除现有依赖
rm -rf node_modules
rm -rf native/*/target

# 重新安装
pnpm install

# 重新编译原生模块
pnpm build:native
```

## 开发环境专用

### 检查终端架构

确保终端以原生 ARM 模式运行：

```bash
# 检查当前架构
uname -m  # 应显示 arm64

# 如果显示 x86_64，说明在 Rosetta 模式下
# 请使用原生 ARM 终端
```

### 配置 Homebrew

确保 Homebrew 安装在正确的位置：

- ARM 版本：`/opt/homebrew/`
- x64 版本：`/usr/local/`

```bash
# 检查 Homebrew 位置
which brew
# ARM 版本应显示 /opt/homebrew/bin/brew
```

### 重装开发环境

如果问题持续存在：

```bash
# 1. 卸载 x64 版本的开发工具
brew uninstall node

# 2. 确保使用 ARM Homebrew
/opt/homebrew/bin/brew install node

# 3. 验证
node -p "process.arch"  # arm64
```

## 已知限制

- 部分依赖可能暂不支持 ARM 架构
- 某些功能可能需要 Rosetta 2 转译层
- 性能可能略低于原生 ARM 编译版本

## 反馈问题

如果上述方法都无法解决问题，请在 [GitHub Issues](https://github.com/imsyy/SPlayer/issues) 提交问题，并附上：

1. macOS 版本
2. 芯片型号（M1/M2/M3）
3. `node -p "process.arch"` 输出
4. 完整的错误日志
