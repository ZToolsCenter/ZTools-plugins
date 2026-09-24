# Changelog

## 1.0.2 - 2026-08-29

### 🐛 修复

- **iconv-lite 加载失败** — 使用 esbuild 将 `iconv-lite` 打包进 `preload/services.js`，修复 build 模式下 ZTools 无法加载 `iconv-lite` 模块的问题

### 🧹 优化

- 新增 `esbuild` 作为 devDependency，build 脚本自动将 preload 脚本及其依赖打包为单文件

## 1.0.1 - 2026-07-08

### 🐛 修复

- **中文路径乱码** — 使用 iconv-lite 将 `wmic` 输出的 GBK 编码转换为 UTF-8，修复中文 Windows 下进程路径显示乱码的问题

### 🧹 优化

- 移除 `App.tsx` 中未使用的 `route` state
- 统一 `CACHE_TTL` 常量定义，消除重复代码

## 1.0.0 - 2026-07-07

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

### 根据提交记录补充

- 优化进程管理交互及搜索排序。
- 搜索逻辑改为字符串模糊匹配，支持 PID/端口部分匹配
- 修复 pnpm 构建失败。
