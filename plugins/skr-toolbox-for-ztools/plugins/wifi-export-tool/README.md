# WiFi 历史密码查看器

> Ztools 插件 — 一键查看设备上保存的所有 WiFi 网络名称及密码。

## 功能特性

- 🔍 自动扫描设备上所有已保存的 WiFi 网络
- 🔑 显示 WiFi 密码和安全类型
- 📋 一键复制密码到剪贴板
- 📤 支持导出为 CSV / JSON / TXT 格式
- 🖥️ 跨平台支持：Windows / macOS / Linux

## 安装

在 Ztools 应用中搜索 `wifi-export-tool` 进行安装，或手动安装：


## 使用方式

在 Ztools 搜索框中输入以下关键词之一：

- `wifi`
- `wifipassword`
- `无线网络`
- `密码`

## 权限说明

本插件需要以下权限：

| 权限 | 说明 |
|------|------|
| `shell_execute` | 调用系统命令获取 WiFi 信息 |
| `clipboard_write` | 复制密码到剪贴板 |
| `file_system_read` | 读取文件系统 |

## 平台支持

| 平台 | 命令 |
|------|------|
| Windows | `netsh wlan show profiles` |
| macOS | `networksetup` + `security` |
| Linux | `nmcli` |

## 许可证

MIT
