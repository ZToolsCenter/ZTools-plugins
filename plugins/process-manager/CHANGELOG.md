# Changelog

## 1.1.0 - 2026-10-22

新增文件进程占用检测以及修复新版Windows采集不到进程文件路径的问题

### ✨ 新增

- **🔒 文件占用查询** — 在搜索框粘贴盘符或 UNC 文件路径（如 `D:\Downloads\setup.exe`），可直接查看该文件被哪些进程占用。基于 Windows Restart Manager，无需安装第三方工具
- **占用进程视图** — 复用现有进程行展示占用者，支持服务标识、Restart Manager 友好名称和端口信息，以及右键 Kill、返回进程列表、无占用和查询失败状态
- **进程行锁图标** — 悬停进程行右侧的锁图标，可快速查询该 exe 的文件占用
- **Kill 占用提示** — 在占用视图中 Kill 进程时，提示文件占用将解除，并提醒未保存的工作可能丢失

### 🐛 修复

- **进程文件路径采集不到** — Windows 11 24H2 起 `wmic` 默认不再安装，原逻辑取路径失败后回退到 `tasklist`（无路径列），导致路径全部为空。现改为优先使用 PowerShell `Get-CimInstance Win32_Process` 获取 `ExecutablePath`，`wmic` 保留为旧系统兜底

### 🧹 优化

- preload 的 CSV 解析改为按 CSV 规则逐字段拆分，支持路径中包含逗号或引号
- 主数据源解析失败时逐级回退（PowerShell → `wmic` → `tasklist`），不再出现“解析结果为空但不回退”
- 搜索框占位文案更新为“输入 PID / 端口 / 进程名，或粘贴文件路径...”，提升文件占用入口的发现性
- `whoLocks` 返回 PID、进程名、服务短名和 Restart Manager 类型，服务进程可在占用视图中标识；`public/who-locks.ps1` 随构建复制到插件目录

## 1.0.2 — 2026-08-29

### 🐛 修复

- **iconv-lite 加载失败** — 使用 esbuild 将 `iconv-lite` 打包进 `preload/services.js`，修复 build 模式下 ZTools 无法加载 `iconv-lite` 模块的问题

### 🧹 优化

- 新增 `esbuild` 作为 devDependency，build 脚本自动将 preload 脚本及其依赖打包为单文件

## 1.0.1 — 2026-07-08

### 🐛 修复

- **中文路径乱码** — 使用 iconv-lite 将 `wmic` 输出的 GBK 编码转换为 UTF-8，修复中文 Windows 下进程路径显示乱码的问题

### 🧹 优化

- 移除 `App.tsx` 中未使用的 `route` state
- 统一 `CACHE_TTL` 常量定义，消除重复代码

## 1.0.0 — 2026-07-07

### 🎉 初始发布

Process Port Manager 正式发布 — 为 ZTools 打造的进程端口管理插件，支持快速搜索进程、端口、PID、路径，并一键 Kill 进程。

### ✨ 功能特性

- **🔍 多维搜索** — 支持按进程名、PID、端口号、文件路径模糊搜索，一处输入全字段匹配
- **📋 一键复制** — 点击进程名 / PID / 端口号 / 路径即可复制到剪贴板
- **⚡ 一键 Kill 进程** — 通过右键唤出确认弹窗，确认后调用 `taskkill /F` 强制终止进程
- **🔄 自动刷新** — 5 秒缓存 TTL，进度条直观展示缓存倒计时
- **🌙 暗色模式** — 跟随系统主题自适应，UI 与 ZTools 原生风格统一
- **🪟 Windows 原生** — 基于 `wmic` / `netstat` / `tasklist`，零第三方系统依赖

### 📄 许可

MIT License
