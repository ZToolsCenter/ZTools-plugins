# Windows 右键菜单管理 (`win-context-menu`)

> 作者：Pizalo  
> 适用平台：Windows 10 / Windows 11

一款面向 ZTools 的无损 Windows 右键菜单管理工具，支持可视化查看、停用、启用及一键还原系统右键菜单项。

## 核心特性

- **全场景覆盖**：支持管理 **文件夹空白处**（`Directory\Background`）、**文件**（`*` + `AllFilesystemObjects`）、**文件夹**（`Directory` + `AllFilesystemObjects`）、**桌面空白处**（`DesktopBackground`）四大场景。
- **全面兼容传统项与 Win11 现代扩展**：同时识别传统 `shell` 项、`shellex` COM 扩展以及 Windows 11 现代 AppX / Sparse Package 右键扩展（如 QQ、火绒、PowerToys、Notepad++、压缩软件等）；在 Windows 10 上自动跳过 Win11 AppX 扫描以加速启动。
- **真实图标与系统排序**：通过 Win32 API 解析本地化菜单名称并提取真实程序小图标，按接近 Windows 资源管理器的真实顺序排列。
- **独立窗口与一次 UAC**：默认以独立任务栏窗口打开，不因切出验收或弹窗而自动关闭；采用常驻本地提权会话（仅监听 `127.0.0.1` 随机端口 + 随机 Token + 15 分钟空闲自动退出），一次授权后全程免重复弹窗，单次开关毫秒级生效。
- **无损修改与一键还原**：
  - 传统 `shell` 项使用微软原生 `LegacyDisable` 值停用，不删除原软件任何配置；
  - COM 扩展与 Win11 现代扩展使用 `HKCU\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked` 拦截（免管理员权限，重启资源管理器即生效）；
  - 每次修改前自动备份 `.reg` 快照与原始状态至 `~/.ztools/plugin-backups/win-context-menu/`，随时支持 **一键还原全部修改**。

## 触发指令

在 ZTools 搜索框中输入以下任一关键词即可唤起：
- `右键菜单`
- `右键管理`
- `context menu`
- `youjian`
- `menu`

## 权限说明（UAC）

- **免管理员权限**：`HKCU` 下的 `shell` 项，以及所有 `shellex` COM 扩展与 Win11 现代扩展的停用/启用。
- **需要管理员权限**：`HKLM` 下的全局 `shell` 项（插件启动时自动一次性申请 UAC，也可随时取消以普通模式运行）。
