# Changelog

## \[1.1.0] - 2026-07-14

### ✨ Features

* **使用历史记录** — 每次复制提示词自动记录历史（最多 200 条，可在设置中调节），支持查看、重新复制、单条删除、清空，历史条目可跳转到原始提示词
* **Fuse.js 模糊搜索** — 搜索引擎替换为 Fuse.js，支持容错匹配、拼音、权重排序（标题 > 内容 > 标签），SpaceView 和 ManageView 均已生效
* **提示词排序增强** — 排序栏新增「名称」按钮，支持按标题字母顺序排序
* **MAX\_HISTORY 可配置** — 设置页新增「历史记录上限」滑块控件（50–500），替代原来硬编码的 200 条限制
* **空状态引导** — 「最近」和「收藏」tab 无数据时显示针对性引导文案，而非通用的「没有找到提示词」

### 🐛 Bug Fixes

* **排序不生效修复** — `sortBy`/`sortDir` 等筛选状态定义在 `usePromptStore()` 函数内部，每次调用创建新 ref，导致 PromptList 与 SpaceView 使用不同实例。将所有筛选/排序状态提升到模块级别，确保全局共享
* **autoFocus 设置未生效** — `appSettings.autoFocus` 定义了但 SpaceView 搜索框 focus 是硬编码的 `setTimeout`，现已读取设置值
* **版本恢复语义修复** — 恢复快照时复用 `saveEdit()` 导致备注为「编辑 V4」语义不清，改为独立保存逻辑，备注为「保存于恢复前」/「编辑前保存」；版本 tab 新增当前版本卡片
* **版本恢复幽灵变量** — 恢复快照时保留了旧模板中存在但新模板中不存在的变量，导致 UI 显示无用输入框。改为只提取新模板实际包含的变量
* **历史记录变量污染** — 保存历史时解构整个 `variableValues` 可能包含其他提示词残留的变量值，改为只过滤当前提示词实际声明的变量
* **历史查看按钮空值保护** — 原始提示词被硬删除后「查看」按钮自动禁用，避免导航到空管理页面

### ♻️ Refactor

* **平台 API 类型声明** — 新建 `src/types/ztools.d.ts`，`platform.ts` 和 `storage.ts` 中 `window as any` 替换为类型安全访问
* **存储错误处理统一** — `storage.ts` 所有 `catch` 块统一添加 `console.error` 日志，`save` 函数补全 `try-catch`
* **ManageView 搜索性能优化** — `filteredItems` 拆分为 `baseItems` + `fuseInstance` + `filteredItems` 三层计算属性，Fuse 索引仅在基础列表变化时重建，避免每次按键重新实例化

## \[1.0.0] - 2026-07-11

### 🐛 Bug Fixes

* **ComposeView 滚动修复** — 左侧提示词列表无法上下滑动，为 `.compose-body` 添加 `grid-template-rows: 1fr` 约束网格行高
* **精确重复检测修复** — `detectDuplicate` 中 `(e as any).hash` 永远为 `undefined`，改为直接字符串比对 `e.content === newContent`
* **版本号不一致** — `SettingsView.vue` 显示 `v2.0.0`，与 `package.json` 的 `1.0.0` 不一致，已统一
* **README 视图名不一致** — 项目结构中 `CallView.vue`、`LibraryView.vue` 与实际代码不符，已更正为 `SpaceView.vue`、`ManageView.vue`
* **saveEdit 快照空值崩溃** — `u.snapshots` 为 `undefined` 时调用 `.push()` 抛出 `TypeError`，添加空值容错处理

### ⚡ Performance

* **批量删除优化** — `ManageView.batchDelete` 从循环内逐条调用 `softDelete`（每次触发 `persistAll`）改为内存批量标记后统一持久化，数据库写入从 N 次降为 1 次
* **批量移动项目优化** — `ManageView` 的 `@change` 内联处理器提取为 `batchMoveProject` 函数，批量更新 `projectId` 后仅调用一次 `persistAll()`
* **删除项目优化** — `SpaceView.deleteProject` 从循环内逐条调用 `updateItem` 改为内存批量修改后统一持久化
* **导入词库优化** — `SettingsView.importJson` 从循环内逐条调用 `addItem`（每次触发 `persistAll`）改为内存批量 `push` 后统一持久化

### 🎨 Design

* **新图标** — 生成"词匠"专属图标（铁砧 + 锤子 + 金色火花 + `{{词}}` 变量符号），替换默认占位图标

### 🗑️ Removed

* 移除未使用的 `fnvHash` 函数（精确重复检测改为字符串比对后不再需要）

