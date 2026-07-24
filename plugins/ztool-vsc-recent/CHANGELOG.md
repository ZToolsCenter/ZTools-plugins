# Changelog

## 0.1.2 — 2026-06-29

### 修复
- 修复未安装应用或未配置环境变量时由于无报错而导致的静默失效问题
- 修复 macOS 下 ZTools GUI 环境中环境变量缺失导致无法拉起 VSCode 的问题（重构使用 ZTools 原生 `isMacOs` 判断并优先通过 `open -b` 原生应用唤醒）
- 为 Remote 连接的 Folder URI 在 Windows shell 模式下增加双引号包裹，防御特殊路径空格导致截断的边缘异常


## 0.1.1 — 2026-06-12

### 修复

- 选中条目启动 VSCode 后，ztool 主窗口未关闭。改为先 `hideMainWindow(false)` 再 `outPlugin()`，让 VSCode 自然抢焦点。

### 测试

- 新增 `tests/select-actions.test.ts`，将 select 后的 host 动作策略提取到 `src/select-actions.ts`，覆盖成功/失败/空 reason 三种分支。

## 0.1.0 — 2026-05-23

首个公开版本。

### 功能

- 关键字 `vsc` 唤起，列表展示 VSCode 最近打开的项目（最近的在最上）。
- 三类条目：本地文件夹、`.code-workspace` 多根工作区、Remote / WSL 会话。
- 模糊搜索（fuse.js），支持名称与路径双字段匹配。
- 键盘导航：↑/↓ 移动高亮，Enter 启动 VSCode；鼠标点击同样可用。
- 启动后插件自动隐藏，窗口高度自适应内容。

### 数据源（多源探测，按优先级降级）

1. `workspaceStorage/<hash>/workspace.json` — 真实最近列表，按目录 mtime 倒序。
2. `state.vscdb` — `history.recentlyOpenedPathsList` 键（部分 VSCode 版本）。
3. `storage.json` — `backupWorkspaces` / `windowsState` 兜底。

### 平台

- Windows 10/11
- macOS / Linux 路径已就位但仅在 Windows 实际验证；欢迎跨平台反馈。

### 已知限制

- 单文件历史（`fileUri`）按设计丢弃。
- Remote/WSL 路径无法本地存在性校验，全部保留。
- 启动 VSCode 依赖 PATH 中的 `code` 命令。
