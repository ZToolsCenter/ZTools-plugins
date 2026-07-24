# TopWindow - ZTools 窗口置顶插件

一个简单高效的 Windows 窗口置顶插件，适用于 [ZTools](https://github.com/ZToolsCenter/ZTools)。

## 功能

- **一键置顶**：将当前活动窗口设为置顶（Always on Top）
- **一键取消**：再次执行即可取消置顶
- **窗口识别**：系统通知中显示被操作窗口的标题名称
- **即时反馈**：通过系统通知提示操作结果

## 使用方式

1. 呼出 ZTools
2. 输入 `置顶`、`TopWindow` 或 `窗口置顶`
3. 当前窗口即被置顶/取消置顶，并收到系统通知

## 技术实现

- 通过 PowerShell 调用 Win32 API (`SetWindowPos`, `GetForegroundWindow`, `GetWindowText`)
- 使用 `preload.js` 的 Node.js 能力执行系统级操作
- 无需额外安装任何依赖

## 文件结构

```
TopWindow-ztools/
├── plugin.json          # 插件配置
├── preload.js           # 插件入口（Node.js 环境）
├── toggle-topmost.ps1   # 核心 PowerShell 脚本
├── index.html           # 插件界面
└── logo.png             # 插件图标
```

## 仅支持 Windows

本插件使用 Windows 原生 API，仅支持 Windows 系统。

## License

MIT
