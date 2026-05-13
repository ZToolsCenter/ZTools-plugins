# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ZTools 平台插件——"纯文本编辑"，一个极简纯文本编辑器。基于 React 19 + Vite 6 + TypeScript 构建，运行在 ZTools 桌面应用环境中。

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 开发服务器 (http://localhost:5173)
npm run build        # TypeScript 类型检查 + Vite 生产构建 → dist/
```

无 linter/formatter 配置，无测试框架。

## 架构

### 插件运行模型

这是一个 ZTools 插件，不是独立 Web 应用。插件在 ZTools 桌面应用的 WebView 中运行：

- **渲染进程**：React 组件在浏览器环境执行，通过 `window.ztools` 调用 ZTools API
- **Preload 桥接**：`public/preload/services.js` 在 Node.js 上下文执行，通过 `window.services` 向渲染进程暴露文件系统等 Node 能力
- **路由机制**：无 React Router，`App.tsx` 根据 `window.ztools.onPluginEnter` 回调的 `action.code` 手动切换功能组件

### 功能注册流程

每个功能需要三处配置：

1. **`public/plugin.json` → features[]**：定义功能 code、触发指令(cmds)、图标、是否隐藏主窗口等
2. **`src/` 目录下创建组件**：每个功能一个文件夹（`index.tsx` + `index.css`）
3. **`src/App.tsx`**：添加条件渲染分支

### ZTools API（通过 `window.ztools`）

- `onPluginEnter(callback)` — 插件被激活时触发，callback 接收 action 对象（含 code、type、payload）
- `onPluginOut(callback)` — 插件退出时触发
- `getClipboardContent()` — 获取剪贴板
- `showOpenDialog(options)` — 打开文件选择对话框
- `showNotification(msg)` — 显示通知
- `shellShowItemInFolder(path)` — 在文件管理器中显示
- `hideMainWindow()` / `outPlugin()` — 隐藏/退出插件
- `getPath(name)` — 获取系统路径（如 'downloads'）

### Preload 服务（通过 `window.services`）

定义在 `public/preload/services.js`，使用 CommonJS 模块格式（`preload/package.json` 声明 `"type": "commonjs"`）：

- `readFile(filePath)` — 同步读取文件
- `writeTextFile(text)` — 文本写入下载目录
- `writeImageFile(base64Url)` — base64 图片写入下载目录

扩展新 Node 能力时：在 `services.js` 添加方法，在 `src/env.d.ts` 添加对应类型声明。

### 类型系统

- TypeScript strict mode 关闭（`strict: false`, `noImplicitAny: false`）
- ZTools API 类型由 `@ztools-center/ztools-api-types` 包提供
- 自定义类型声明集中在 `src/env.d.ts`

### 样式约定

- 全局 CSS 变量在 `src/main.css` 中定义
- ZTools 提供 `--bg-color`、`--text-color`、`--border-color` 等主题变量
- 支持暗色模式：使用 `@media (prefers-color-scheme: dark)` 媒体查询
- 每个功能组件自带 `index.css`，无 CSS Modules
