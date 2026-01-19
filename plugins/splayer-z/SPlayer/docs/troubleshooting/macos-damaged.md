# Mac 系统应用显示已损坏

在 macOS 上打开 SPlayer 时，可能会遇到"应用已损坏，无法打开"的提示。这通常是由于 macOS 的安全机制导致的，而非应用本身损坏。

## 问题现象

打开应用时出现以下提示：

> "SPlayer" 已损坏，无法打开。您应该将它移到废纸篓。

或

> 无法打开 "SPlayer"，因为 Apple 无法检查其是否包含恶意软件。

## 原因分析

这是 macOS Gatekeeper 安全机制的正常行为。从非 Mac App Store 下载的应用，如果没有 Apple 签名认证，系统会阻止其运行。

SPlayer 目前未进行 Apple 开发者签名，因此会触发此保护机制。

## 解决方案

### 方法一：移除隔离属性（推荐）

打开 **终端** 应用，执行以下命令：

```bash
sudo xattr -r -d com.apple.quarantine /Applications/SPlayer.app
```

执行后输入管理员密码，然后重新打开应用即可。

### 方法二：临时允许任意来源

::: warning 安全提示
此方法会降低系统安全性，仅建议临时使用，安装完成后建议恢复设置。
:::

**步骤 1：允许任意来源**

```bash
sudo spctl --master-disable
```

**步骤 2：在设置中选择任意来源**

1. 打开 **系统偏好设置** → **安全性与隐私** → **通用**
2. 在"允许从以下位置下载的应用"中选择 **任何来源**

**步骤 3：恢复安全设置（安装后执行）**

```bash
sudo spctl --master-enable
```

### 方法三：右键打开

1. 在 Finder 中找到 SPlayer.app
2. 按住 `Control` 键并点击应用图标
3. 在弹出菜单中选择 **打开**
4. 在确认对话框中点击 **打开**

此方法可能需要重复 2-3 次才能成功。

## 验证应用完整性

如果担心应用完整性，可以验证下载文件的 SHA256 校验和：

```bash
# 计算下载文件的校验和
shasum -a 256 ~/Downloads/SPlayer-x.x.x-mac.dmg

# 与 GitHub Release 页面提供的校验和对比
```

## M 系列芯片注意事项

如果您使用的是 M1/M2/M3 芯片的 Mac：

1. 确保下载的是 ARM 版本（arm64）的安装包
2. 首次运行可能需要 Rosetta 2 转译（如果下载了 x64 版本）

安装 Rosetta 2：

```bash
softwareupdate --install-rosetta
```

## 仍然无法解决？

如果上述方法都无法解决问题：

1. 完全删除应用及其相关文件：

   ```bash
   rm -rf /Applications/SPlayer.app
   rm -rf ~/Library/Application\ Support/SPlayer
   rm -rf ~/Library/Caches/SPlayer
   ```

2. 重新从 [GitHub Releases](https://github.com/imsyy/SPlayer/releases) 下载最新版本

3. 使用方法一移除隔离属性后再打开
