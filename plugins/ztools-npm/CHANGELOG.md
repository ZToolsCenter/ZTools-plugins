# Changelog

项目版本号与 [package.json](./package.json) / [plugin.json](./plugin.json) 保持一致。

## [Unreleased]

### Added

- **管理模式**：NpmUi 顶部新增「创建 / 管理」模式切换（左上角），并记入 `npm-mode` 存储，重启后停留在上次页面。
- **全局 npm 包管理**：左侧选择 Node 版本 → 右侧列出该版本的全局安装包。
  - 每包支持**更新**（安装到 latest）与**卸载**（二次确认弹窗）。
  - 顶部「全部更新」一键 `npm update -g`。
  - 默认隐藏包管理工具（npm / npx / yarn / pnpm / corepack），可通过「含 N 工具」展开。
- **本地 Node 版本管理**：自动探测 nvm / nvm-windows / fnm / volta 已安装版本，按数字降序排列。
  - 高亮**当前全局默认版本**（PATH 上的 node，或 nvm alias/default），并禁用其「切换 / 默认」按钮。
  - 「切换」复制 `nvm use <ver>`；「默认」复制 `nvm alias default <ver>` 到剪贴板。
  - 版本文字探针失败时给出诊断信息（`<details>` 折叠展示）。
- **跨版本复制包**：在包列表勾选一个或多个包 →「复制到另一版本…」→ 选目标 Node 版本 → 逐个 `npm install -g <name>@<exactVer> --prefix <target> [--registry=<mirror>]`，默认走国内淘宝镜像 `https://registry.npmmirror.com`，带进度条。
- **顶部开源链接**：结果页头部加「开源 v1.0.0」链接（GitHub mark + `shellOpenExternal`）。

### Fixed

- **npm 返回 `{"name":"lib"}` / 空包列表**：nvm 的 npm shim 在 Electron 渲染进程里解析错误 prefix。所有 npm 子进程调用现在显式传 `--prefix <versionRoot>`。
- **`spawn npm ENOENT`**：Electron 渲染进程继承的 PATH 被剥离，新增 `SHELL_ENV` 增强 PATH（含 `/opt/homebrew/bin`、`/usr/local/bin`、nvm 各版本 bin），并兜底 `HOME / USER / NVM_DIR`。
- **当前全局版本错配**：`~/.nvm/alias/default` 可能是大版本别名（`22`）或 `lts/iron`，原解析只认完整版本号导致误判；现支持递归解析大版本/lts 别名到已安装的最新版本。
- **列表不滚动**：把根容器锁到视口高度（`html/body/#app { height:100% }`），结果列表与版本列表各自成为内部滚动区，↑↓ 时高亮项自动滚入可视区。
- **首次进入管理页不加载**：修复 `switchMode` 同模式早退导致 `loadNodeVersions` 漏跑。
- **顶部提示/工具栏挤掉包列表**：多选工具栏与包列表合并到同一 `v-else-if` 分支。

### Changed

- **移除 AI Skills 生成功能**：删除 `skill-from-readme.ts` 及其测试、`npm-skills` feature 注册；插件描述同步精简，专注 npm 检索与管理。
- **字号与间距**：面板整体缩一级（`16px → 13.5px`），管理页两栏独立滚动。

### Removed

- `src/lib/skill-from-readme.ts`、`tests/unit/skill-from-readme.spec.ts`
- 根目录与 `public/plugin.json` 中的 `npm-skills` feature

---

## 1.0.0 - 2026-08-17

### Added

- **Npm Lite 核心**：Npm 双源聚合搜索（npm 官方 + npmmirror）、安装指令复制（npm / pnpm / yarn）、包元数据与 README 使用指南渲染。
- **HTTP 代理设置**：`NpmSettings` 弹窗配置代理，启动时从 `dbStorage` 恢复。
- 官方 npm logo、MIT License、README 文档。
