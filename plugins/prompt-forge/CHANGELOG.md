# Changelog

## 1.4.0 - 2026-08-27

### ✨ Features

* **完整备份 / 恢复** — 导入导出从「仅提示词裸数组」升级为结构化数据包（`promptforge-backup` 格式），涵盖提示词、项目、设置、历史记录；导入时合并去重、`projectId` 完整性校验（指向不存在项目的提示词自动转为资产）、settings 逐字段合并；内置种子数据（教程提示词）导出时自动排除；兼容旧版裸数组格式

### 🐛 Bug Fixes

* **设置覆盖主题丢失** — 修复保存行为设置时覆盖整个 settings 文档、导致主题（theme）字段丢失的问题，改为合并写入

## 1.3.0 - 2026-08-25

### ✨ Features

* **Markdown 渲染预览** — FillPanel 预览区与 ManageView 编辑页新增「文本 / Markdown」「编辑 / 预览」切换按钮，基于 markdown-it 渲染（`html: false` 防 XSS），支持标题、列表、代码块、引用、表格、链接等；渲染顺序为先替换变量再渲染 Markdown
* **使用统计分析面板** — 空间页新增「统计」tab，手写 SVG 可视化仪表盘：总提示词数 / 累计使用 / 收藏 / 含变量四个指标卡、类型分布环形图、使用 TOP10（本周 / 本月切换）、使用频次趋势折线图（基于历史记录按日期聚合）

### 🎨 Design

* **UI 图标现代化** — 引入 lucide-vue-next 图标库，将全部 emoji 图标（侧栏导航、右键菜单、卡片元信息、面板标题、关闭 / 移动按钮等）替换为统一的线条图标，按需 tree-shake（JS 仅 +14KB）

### ⚡ Enhancement

* **无变量提示词全宽预览** — 点击不含变量的提示词时隐藏「填写变量」表单区域，预览占满全部显示空间；含变量时保持左右分栏

## 1.2.0 - 2026-08-20

### ✨ Features

* **版本差异对比** — 版本 Tab 新增「对比」按钮，基于 LCS（最长公共子序列）算法生成行级 diff，覆盖层并排展示快照版本与当前版本差异（新增绿色 / 删除红色 / 相同无色）
* **全局快捷键面板** — 按 `?` 键弹出快捷键速查面板，按视图分组展示所有可用快捷键，`Esc` 或点击遮罩关闭

### ⚡ Performance

* **持久化 Debounce** — `prompt.ts` 新增 `schedulePersist()` 300ms debounce，高频操作（收藏 / 删除 / 新增 / 更新）合并写入，连续操作 I/O 从 N 次降为 1 次；关键操作（记录使用、批量操作）保留立即 flush
* **Fuse 索引懒加载** — `prompt.ts` 与 `ManageView.vue` 的 Fuse 索引从 `computed(new Fuse(...))` 改为 `ref + watch` 懒加载，仅在搜索词非空时按需构建，避免列表变化时冗余重建

### 🎨 Design

* **搜索高亮** — PromptList 搜索结果标题中匹配关键词以 `<mark>` 标签高亮，支持浅色 / 深色主题

### 🐛 Bug Fixes

* **FillPanel null 安全** — `v-for` 访问 `unit.tags.slice()` 改为 `(unit?.tags || []).slice()`，防止 `unit` 为 null 时运行时崩溃
* **ComposeView 空值保护** — `onMounted` 中 `basePrompts[0].id` 添加空值守卫，防止空库打开组合视图崩溃
* **存储 Key 前缀统一** — `storage.ts` fallback 路径 key 前缀 `pf:` 统一为 `promptforge:`，与 preload `services.js` 一致，消除切换存储路径后数据不互通风险

### ♻️ Refactor

* **SpaceView 组件拆分** — 从 608 行拆分为 SpaceView（210 行）+ SpaceSidebar / ProjectPanel / HistoryPanel / TrashPanel 四个子组件
* **ManageView 组件拆分** — 从 477 行拆分为 ManageView（280 行）+ ManageContentTab / ManagePropsTab / ManageVarsTab / ManageVersionsTab / ManageStatsTab 五个 Tab 子组件

## 1.1.0 - 2026-07-14

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

## 1.0.0 - 2026-07-11

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

### 根据提交记录补充

- 添加图标
