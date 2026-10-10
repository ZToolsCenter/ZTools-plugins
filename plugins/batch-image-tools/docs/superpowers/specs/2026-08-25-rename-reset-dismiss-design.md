# 批量重命名 / 结果可关闭 / 全局重置 — 设计说明

**日期:** 2026-08-25  
**状态:** 已批准

## 目标

1. 新增工具「批量重命名」：序号模板 + 查找替换；原地改名；冲突跳过。
2. 任务完成提示框可关闭；错误条可关闭。
3. 顶部右上角「重置」：清空队列、结果、错误、进度，并恢复各工具默认参数与默认工具。

## 架构原则

- **高内聚**：重命名逻辑独立 `processors/rename.js`，不进入 sharp pipeline。
- **低耦合**：`useImageQueue.reset` / `useBatchProcess.reset` 各自重置；`BatchImage` 只编排；`ResultBanner` 纯展示 + `onDismiss`。

## 重命名

- `ToolId: 'rename'`，`batchMode: 'single'`
- `RenameOptions`：`renameMode: 'sequence' | 'replace'`；sequence 用 `prefix` / `startIndex` / `padLength` / `separator`；replace 用 `findText` / `replaceText`
- 保留扩展名；非法字符替换为 `_`
- 目标路径已存在 → `success: false, error: '目标文件名已存在，已跳过'`
- 成功后由队列 `applyPathUpdates` 同步更新列表中的 path/name
- UI 不展示 OutputSettings

## UI

- `ResultBanner`：关闭 → `setResults([])`
- 错误条关闭 → `setError('')`
- Header 右侧：统计 +「重置」按钮

## 非目标

- 不支持另存副本 / 覆盖目录输出
- 不自动解决文件名冲突
