# Windows 7 系统兼容性问题

SPlayer 基于 Electron 构建，对 Windows 7 的支持存在一定限制。

## 系统要求

::: warning 重要提示
从 Electron 23 开始，官方不再支持 Windows 7/8/8.1。SPlayer 使用的 Electron 版本可能已不再兼容这些系统。
:::

**推荐系统**：Windows 10 版本 1903 或更高版本

## 常见问题

### 应用无法启动

**症状**：双击应用无反应，或提示缺少系统组件

**原因**：

- 缺少必要的系统更新
- Electron 版本不兼容

**解决方案**：

1. 安装所有可用的 Windows 更新
2. 安装以下必要组件：
   - [.NET Framework 4.7.2](https://dotnet.microsoft.com/download/dotnet-framework/net472)
   - [Visual C++ Redistributable 2015-2022](https://aka.ms/vs/17/release/vc_redist.x64.exe)

### 缺少 API 函数

**症状**：提示 "The procedure entry point xxx could not be located"

**原因**：Windows 7 缺少部分现代 API 函数

**解决方案**：

1. 确保已安装 SP1 (Service Pack 1)
2. 安装 KB2533623 更新
3. 安装 KB3063858 更新

### 媒体功能缺失

**症状**：SMTC 媒体控制不可用

**说明**：Windows 7 不支持 SMTC (System Media Transport Controls)，这是 Windows 10 引入的功能。

### SSL/TLS 连接问题

**症状**：无法连接到 API 服务器，网络请求失败

**原因**：Windows 7 默认不支持 TLS 1.2

**解决方案**：

1. 安装 KB3140245 更新
2. 运行以下注册表修改（以管理员身份）：

```reg
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\SecurityProviders\SCHANNEL\Protocols\TLS 1.2\Client]
"DisabledByDefault"=dword:00000000
"Enabled"=dword:00000001

[HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\SecurityProviders\SCHANNEL\Protocols\TLS 1.2\Server]
"DisabledByDefault"=dword:00000000
"Enabled"=dword:00000001
```

## 兼容模式

如果仍然遇到问题，可以尝试兼容模式运行：

1. 右键点击 SPlayer.exe
2. 选择 **属性**
3. 切换到 **兼容性** 选项卡
4. 勾选 **以兼容模式运行这个程序**
5. 选择 **Windows 8**

## 历史版本

如果新版本无法在 Windows 7 上运行，可以尝试使用旧版本：

1. 访问 [GitHub Releases](https://github.com/imsyy/SPlayer/releases)
2. 查找使用 Electron 22 或更早版本的发布
3. 下载对应的安装包

::: warning 安全警告
旧版本可能存在已知的安全漏洞，建议尽快升级到 Windows 10 或更高版本。
:::

## 升级建议

考虑到 Windows 7 已于 2020 年 1 月结束支持，强烈建议升级到 Windows 10/11：

1. **安全性**：Windows 7 不再收到安全更新
2. **兼容性**：越来越多的应用不再支持 Windows 7
3. **性能**：新系统通常有更好的性能优化
4. **功能**：可以使用 SMTC 等现代功能

## 相关链接

- [Windows 7 生命周期结束说明](https://docs.microsoft.com/zh-cn/lifecycle/products/windows-7)
- [Electron 系统要求](https://www.electronjs.org/docs/latest/tutorial/support#windows)
