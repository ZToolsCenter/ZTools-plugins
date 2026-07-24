# AGENTS.md

## 项目概览

本项目是 ZTools 插件 `local-search-neo`，用于借助 Everything 做本地文件搜索与预览。

- 前端：Vue 3 + Vite + TypeScript，入口主要在 `src/Finder/`。
- 原生能力：`addon/` 是 Neon + Rust addon，暴露 Everything IPC、文本预览、目录/压缩包树等能力。
- Preload：`public/preload/services.js` 把 Node / addon 能力挂到 `window.services`。
- ZTools API：必须到 `node_modules/@ztools-center/ztools-api-types/ztools.api.d.ts` 查找插件 API，例如 `window.ztools.copyText`、`copyImage`、文件/窗口相关能力。

## 关键目录

- `src/Finder/index.vue`：Finder 主界面和整体布局。
- `src/Finder/components/`：侧栏、结果列表、底栏、设置等组件。
- `src/Finder/preview/`：各种预览组件。
- `src/Finder/composables/`：搜索、预览、键盘、设置、持久化等逻辑。
- `src/Finder/core/`：纯逻辑、类型、测试。
- `addon/src/`：Rust addon 源码。
- `public/preload/services.js`：渲染进程可用服务封装。
- `src/env.d.ts`：`window.services` 等前端类型声明。

## 常用命令

- `npm run lint`：前端 lint。
- `npm run format:check`：格式检查。
- `npm test`：运行核心 TS 单测。
- `npx vue-tsc --noEmit`：Vue/TS 类型检查。
- `npm --prefix addon test`：Rust addon 测试。
- `npm --prefix addon run build-release`：构建 release addon。
- `npm run build`：完整构建，会先准备 pdfjs 和 addon。
- `node scripts/test-everything-addon.cjs`：简单验证 addon 导出、Everything 状态、版本和查询结果。
- `node scripts/benchmark-everything-addon.cjs`：压测/对比 Everything addon 查询性能。

## 开发注意事项

- Vue 代码使用 `<script setup lang="ts">` 和 Composition API。
- 新增/修改 preload 服务时，同步更新：
  - `addon/index.d.ts`（如果是 addon 导出）
  - `src/env.d.ts`
  - `src/devMock.ts`
- 修改 addon 导出时同步更新：
  - `addon/src/lib.rs`
  - `addon/index.d.ts`
  - `addon/README.md`
- 预览相关逻辑优先看 `src/Finder/composables/useFilePreview.ts`。
- 文件类型判断和纯逻辑测试优先放在 `src/Finder/core/finderLogic.ts` / `.test.ts`。
- 不要直接假设 ZTools API 签名；先查 `node_modules/@ztools-center/ztools-api-types/ztools.api.d.ts`。
- 查 Rust crate API 时优先看 docs.rs 文档，不要直接翻依赖源码。
