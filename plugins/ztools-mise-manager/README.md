# ztools-mise-manager — Mise 控制台

🚀 ZTools 插件：可视化管理 [mise](https://mise.jdx.dev)（开发工具版本管理器）。
基于 React + TypeScript + Vite 构建，通过 `preload.js` 桥接 mise CLI。

## 功能

- **📊 仪表盘** — 已装工具总览：激活版本、已装版本数、可升级提示（`mise outdated`）、一键打开安装目录
- **🛠️ 工具管理** — 查看已装版本 / 远程可装版本、安装（实时进度+日志）、卸载、全局切换（`mise use -g`）
- **🧩 工具市场** — 浏览 mise registry 1000+ 工具，搜索 + 一键安装
- **📁 项目配置** — 收藏项目、读写 `.mise.toml` / `.tool-versions`、为项目添加工具版本（`mise use`）
- **⚡ 快速指令**（主搜索框）：
  - `mise` / `mise管理` / `mise版本` → 打开插件
  - `mise 装 node@22` / `mise install node@22` → 快速安装
  - `mise 切 node@22` / `mise use node@22` → 全局切换

## 环境要求

- ZTools（[下载](https://github.com/ZToolsCenter/ZTools/releases)）
- mise（`winget install jdx.mise` 或参考 [官网](https://mise.jdx.dev)）
- Node.js >= 16（构建用）

## 开发

```bash
npm install            # 安装依赖（若全局配置 omit=dev 需加 --include=dev）
npm run dev            # Vite 开发服务器
npm run build          # 构建到 dist/（自动安装 preload 依赖）
```

## 安装到 ZTools

```bash
# 构建后把 dist/ 复制到 ZTools 本地插件目录，重启 ZTools 即可
cp -r dist ~/AppData/Roaming/ztools/plugins/ztools-mise-manager
```

或通过 ZTools 插件中心发布（`ztools publish`）。

## 架构

```
React UI (src/) ──> window.miseManager (public/preload.js) ──> mise.exe <cmd> --json
```

- 数据层优先使用 `mise --json` 结构化输出（ls / ls-remote / registry）
- 长任务（install/upgrade）用 `spawn` 流式回传日志与进度（支持百分比与 `[n/m]` 阶段式进度）
- 编码：mise 为 Rust 程序输出 UTF-8；Windows 下含替换字符时用 iconv-lite GBK 兜底
- 本地数据：`projects.json`（收藏项目，与 preload.js 同级）

## 已知问题

- 网络受限环境（如访问 GitHub API 超时）下安装可能较慢或失败，插件会实时显示日志（含 mise WARN 信息）便于排查；可配置系统代理后重试。
- Windows 下 mise 的部分高级特性（shims 激活等）能力有限，插件仅封装 mise 官方命令，不做扩展。

## 验证

`scripts/verify-preload.js` 可在无 ZTools 环境下模拟调用桥接层做全量功能验证：

```bash
node scripts/verify-preload.js
```
