# 修改笔记

## 适用

- 用户要求润色、精简、改写、总结或调整当前页面。
- 用户明确指定当前笔记中的内容需要替换或删除。
- 用户要求追加内容或重命名页面。

## 不适用

- 用户要求生成到新笔记。改用 `createNoote`。
- 用户没有要求写入。改用 `chat`。

## 执行

- 先调用 `readPage` 读取当前页面。
- 保留用户未要求改动的内容；未触及段落不得重写或臆造。
- **默认**用 `search_replace` 局部替换，经 `executeBatchPlan` 提交计划（须用户审批后才写入）。
- 默认不搜索其他页面。
- 不把修改结果写入新页面。

### 默认：search_replace

- 在 `executeBatchPlan.operations` 中使用：
  - `type`: `"search_replace"`
  - `pageId`: 目标页
  - `oldString`: 从 readPage 原文原样复制的连续片段（含足够上下文以保证唯一）
  - `newString`: 仅替换后的片段
  - `replaceAll`: 仅当用户要求全文同一字符串全局替换时为 `true`
- 同一页可有多条 `search_replace`，按顺序应用；不可与同页的 `edit`/`delete` 混用。
- 全文同一词替换：单条 `search_replace` 且 `replaceAll: true`。
- 追加内容：`oldString` 取文末稳定片段，`newString` 为该片段加追加内容。
- 仍应**主动**写 `search_replace`；若误用局部 `edit`，prepare 阶段可能自动拆成 `search_replace`，但不要依赖该兜底。

### 仅在必要时用 edit（整页 markdown）

- 用户明确要求整页重写 / 全文重写。
- 页面为空或近似从零填满。
- 结构性大改，`search_replace` 无法表达。
- 仅重命名：`edit` 带新 `title`，`markdown` 用 readPage 正文且不得改动正文（带 `title` 的 edit 不会被自动拆分）。

### 禁止

- 为单段润色等小改动把完整正文塞进 `edit`。
- 为未改动章节编造或改写内容。

## 完成

- 生成审批计划后停止，等待用户确认（含 search_replace/edit/delete 不会自动写入）。
- 用户确认并执行后，用一句话概括实际修改。
- 计划生成失败时说明原因，不连续重试。
