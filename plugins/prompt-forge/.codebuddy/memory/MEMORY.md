# PromptForge 项目记忆

## 项目信息
- 项目名称：PromptForge（词匠）
- 定位：ZTools 插件平台的提示词资产管理工具
- 技术栈：Vue 3 + TypeScript + Vite + Fuse.js + ZTools LMDB
- 开发端口：`5174`

## 架构约定
- 状态管理：模块级单例 ref（非 Pinia），存储是全局共享
- 持久化：全量读写模式，读时加载内存，写时序列化
- 存储层：优先 preload `window.kvStorage`，fallback `ztools.dbStorage`
- 组件风格：Composition API + `<script setup>`
- 样式：CSS 变量双主题（`--pf-*` 前缀）

## 2026-08-10 优化记录
- D4：300ms debounce 持久化，高频操作合并写入
- A4：搜索高亮（PromptList `<mark>` 标签）
- B1：版本差异对比（LCS-based unified diff overlay）
- A1：快捷键面板（`?` 键弹出）
- D2：组件拆分（SpaceView 4 个子组件，ManageView 5 个 Tab 组件）
- F1：FillPanel null 安全（修复 v-for 崩溃风险）
- F2：ComposeView 空值保护（basePrompts[0] 守卫）
- F3：存储 key 前缀统一（`pf:` → `promptforge:`）
- F8：Fuse 索引懒加载（仅搜索时按需构建，避免冗余重建）
- 详见 `20260810-优化.md`

## 待修复问题
- tsconfig.json strict: false，存在隐式 any
