# CLAUDE.md

本文件为 Claude Code 在本仓库中工作时提供指引。

## 项目概述

ZTools 插件「代码模板」（code-snippets），用于管理和快速复制代码模板。技术栈为 Vue 3 + Vite + TypeScript。ZTools 是一个基于 Electron 的效率工具，本插件运行于其中。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 启动 Vite 开发服务器，端口 5173
npm run build      # vue-tsc 类型检查 + vite 构建，输出到 dist/
```

未配置测试框架和代码检查工具。

## 架构

**双运行环境**：应用同时运行在 ZTools（生产环境）和独立浏览器（开发环境）中。代码中通过 `window.ztools` 和 `window.services` 进行运行时判断，如果不存在则降级为 `localStorage` 和浏览器 API。

- **`public/plugin.json`** — ZTools 插件清单，定义触发命令（`代码模板`、`snippet` 等）、入口文件和 preload 脚本路径。`development.main` 指向 Vite 开发服务器地址。
- **`public/preload/services.js`** — 注入 Electron preload 上下文的 CommonJS 模块，通过 `window.services` 暴露 Node.js 文件读写能力（读写文件、通过系统对话框导入导出 JSON）。类型声明在 `src/env.d.ts`。
- **`src/App.vue`** — 根组件，监听 `ztools.onPluginEnter` 按功能 `code` 路由。开发模式下自动路由到 `snippets`。
- **`src/Snippets/index.vue`** — 主要业务逻辑：模板 CRUD、搜索过滤、复制到剪贴板、导入导出 JSON，使用 CodeMirror 实现代码编辑和语法高亮。

**存储层**：生产环境使用 `window.ztools.db`（类似 PouchDB 的 API，提供 `put`、`remove`、`allDocs`、`bulkDocs`），开发环境降级为 `localStorage`。模板 ID 前缀为 `tpl_`。

**添加新功能**：在 `src/<FeatureName>/index.vue` 创建 Vue 组件，在 `App.vue` 的路由中注册，并在 `public/plugin.json` 中添加功能条目（`code` 和触发 `cmds`）。

## 核心类型

`Template` 接口（定义在 `Snippets/index.vue`）：
```ts
{ _id: string; _rev?: string; name: string; description: string; language: string; tags: string[]; code: string; usageCount: number; createdAt: string; updatedAt: string }
```

## ZTools API 注意事项

通过 `window.ztools` 访问（类型定义在 `@ztools-center/ztools-api-types`）。

**重要：`db` 对象的所有方法（`put`、`remove`、`allDocs`、`bulkDocs`）都是同步返回的，不是回调式 API。** 传入回调函数作为多余参数会被忽略，导致回调中的逻辑永远不会执行。正确用法：

```ts
// 正确 — 同步调用，直接使用返回值
const result = window.ztools.db.put(doc)
const docs = window.ztools.db.allDocs('tpl_')
window.ztools.db.remove(id)

// 错误 — 回调不会被执行
window.ztools.db.put(doc, (result) => { /* 不会执行 */ })
window.ztools.db.allDocs('tpl_', (docs) => { /* 不会执行 */ })
```

同样，`db` 子对象上还提供 `promises` 命名空间，包含对应的 Promise 版本（如 `window.ztools.db.promises.put()`）。

## 开发注意事项

### Vue 响应式与 Electron IPC

Electron IPC（`sendSync`）使用 `structuredClone` 序列化参数，**无法序列化 Vue 的响应式代理对象**。传递对象给 `ztools.db` 方法时，必须使用 `toRaw()` 剥离代理：

```ts
import { toRaw } from 'vue'
window.ztools.db.put(toRaw(doc))
```

不要使用 `JSON.parse(JSON.stringify(obj))`，它对大段代码有性能开销且会丢失 `undefined` 属性。

### ID 生成

`Date.now()` 在同一毫秒内可能重复，模板 ID 应加随机后缀避免碰撞：
```ts
_id: 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
```

### `remove` 方法参数

`db.remove()` 接受 `string | DbDoc`，优先传 `_id` 字符串，避免传递整个响应式对象。

### 主题适配

如果使用了 `prefers-color-scheme` 媒体查询，需要监听 `change` 事件以便实时响应系统主题切换，并在 `onUnmounted` 中清理监听器。

### 代码审查清单

修改本项目时，注意检查以下问题：
- 是否有使用回调式 API 调用 `ztools.db`（应为同步调用）
- 传给 `ztools.db` 的对象是否已用 `toRaw()` 脱除响应式代理
- 是否使用了 `JSON.parse(JSON.stringify())` 做深拷贝（应改用 `toRaw()`）
- 模板 ID 是否有碰撞风险
- 是否有未清理的事件监听器

## 构建产物

`npm run build` 生成 `dist/` 目录，`base: './'`（相对路径）。将 `dist/` 内容复制到 ZTools 插件目录即可测试。
