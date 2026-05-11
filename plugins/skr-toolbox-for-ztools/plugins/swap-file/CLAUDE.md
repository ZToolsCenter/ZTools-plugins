# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概述

**swap-file** 是一个 ZTools 桌面插件，用于局域网文件分享。它运行一个本地 Fastify HTTP 服务器 + WebSocket 服务器，允许用户将文件/文件夹分享给同一局域网内的其他设备。其他设备通过浏览器访问 Web 界面来浏览和下载文件。

这是一个 **ZTools 插件** —— 运行在 ZTools 桌面应用（基于 Electron）内部，不是独立应用。

## 构建命令

```bash
npm run dev     # 启动 Vite 开发服务器，地址 http://localhost:5173
npm run build   # 先执行类型检查 (vue-tsc)，再用 Vite 构建 → dist/
```

未配置测试和 lint 命令。

## 架构

### 两个运行上下文

插件跨两个不同的上下文运行，通过 `window.services` 连接：

1. **渲染进程 (Vue 3)** — `src/` — 在 ZTools webview 中运行的插件 UI。使用 Vue 3 + Pinia + TypeScript + SCSS。仅通过 `window.services` 访问 Node.js 能力。

2. **Preload (Node.js)** — `public/preload/services.js` — CommonJS 模块，在 preload 上下文中运行，拥有完整的 Node.js 访问权限。通过 `window.services` 向渲染进程暴露方法。Fastify 服务器、WebSocket 服务器和文件系统操作都在这里实现。

### 核心数据流

```
用户选择文件 → Store 调用 window.services.scanDirectory()
             → Store 调用 window.services.startServer(port, paths)
             → Fastify 在局域网提供文件服务（HTTP 端口，如 32123）
             → WebSocket 运行在 端口+1，用于实时状态更新
             → 其他设备通过浏览器访问 public/web/index.html
```

### 插件配置

`public/plugin.json` 定义 ZTools 插件清单（功能、命令、入口）。`features` 数组将命令代码映射到触发词。每个 feature 的 `code` 字段在 `App.vue` 中通过 `window.ztools.onPluginEnter(action)` 作为路由键使用。

### 状态管理

单个 Pinia store 位于 `src/store/fileShare.ts`，管理所有状态：服务器生命周期、文件树、IP 选择、WebSocket 连接和错误处理。Store 直接调用 `window.services.*` 方法。

### 组件结构

- `FileShare/index.vue` — 主视图，包含文件选择、树形展示、状态栏和服务器控制
- `TreeNode.vue` — 递归树组件，支持懒加载子节点，通过 `provide/inject` 模式实现展开/折叠
- `QRCode.vue` — 悬停触发的二维码弹出框（使用 `qrcode` 库 + Teleport）

### Web 客户端

`public/web/index.html` 是一个独立的原生 HTML/JS 页面，由 Fastify 服务器提供给局域网客户端。它调用 `/api/files` 和 `/download/*` 接口。此文件无构建步骤。

## ZTools API

插件使用 `window.ztools.*` 与宿主应用集成：
- `onPluginEnter` / `onPluginOut` — 生命周期钩子
- `showOpenDialog` — 原生文件/文件夹选择器
- `copyText`、`showNotification`、`isDarkColors`、`getPath`、`hideMainWindow`

类型来自 `@ztools-center/ztools-api-types`（在 tsconfig.json 中配置）。

## 样式

- 通过 `sass-embedded` 使用 SCSS，见 `FileShare/style.scss`
- 通过 `data-theme` 属性和 CSS 自定义属性实现亮色/暗色主题
- 图标来自 `lucide-vue-next`

## 重要说明

- tsconfig 中 `strict: false` 且 `noImplicitAny: false` —— TypeScript 配置较宽松
- Preload 脚本使用 CommonJS（`require`）—— 见 `public/preload/package.json` 中 `"type": "commonjs"`
- Fastify 服务器仅允许局域网 IP 访问（私有地址段 + localhost）
- 默认服务器端口 32123；WebSocket 使用端口 32124
