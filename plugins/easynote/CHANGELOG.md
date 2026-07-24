# 更新日志

本文件记录 easynote 便签插件的版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [1.5.0] - 2026-07-22

### 修复

- **便利贴关闭后插件进程未结束**：关闭便利贴独立窗口时，插件仍在 ZTools 后台运行。改为由主窗口轮询检测便利贴窗口状态，关闭后调用 `outPlugin(true)` 结束整个插件进程。

## [1.4.0] - 2026-07-21

### 新增

- **直接新建便签指令**：新增 `新建便签` / `新便签` / `new-note` 三个指令，在 ZTools 中直接触发即可打开空白便利贴，无需经过管理主页。由 `plugin.json` 中新增的 `new-note` feature 实现，`App.vue` 的 `onPluginEnter` 处理器按 action code 分发，`new-note` 直接调用 `openEditor(null)` 跳过 Home 页面。

## [1.3.0] - 2026-07-20

### 修复

- **字号控制**：修复所见即所得模式下 Ctrl+滚轮只缩放列表圆点、不缩放正文和标题的问题。通过覆盖 Milkdown nord 主题的 `--text-*` CSS 变量，让所有文字（标题、段落、代码块）随 `--note-font-size` 整体缩放。
- **独立窗口生命周期**：关闭 ZTools 主页面时不再连带关闭便利贴窗口。添加 `parent: null` 选项使便利贴窗口独立于主窗口，并拦截 `beforeunload` 事件阻止主窗口关闭时杀死进程。
- **新建便签冲突**：修复便利贴已打开时，点击「新建便签」出现的 WPS 报错。改为每次新建时先关闭旧窗口再创建新窗口，同时 `createBrowserWindow` 失败时自动回退到嵌入模式。

### 变更

- 插件分类从 `productivity` 改为 `效率工具`。
- `openStickyWindow` 返回 `boolean` 以支持调用方判断创建结果。
- 导出 `isStickyNoteOpen()` 和 `closeStickyWindow()` 供主窗口生命周期管理使用。

## [1.2.1] - 2026-07-18

### 修复

- 修复 milkdown 所见即所得编辑器无法输入的问题：
  - 补上 `MilkdownProvider` 包裹（`useEditor` / `Milkdown` 组件依赖其通过 `provide` 注入的 context，缺省则编辑器不会初始化）。
  - 移除 `useEditor` 回调中多余的 `create()` 调用（由内部 `useGetEditor` 负责 create）。
  - 为 milkdown 编辑区（`data-milkdown-root` / `.milkdown-theme-nord` / `.editor` / `.ProseMirror`）补充 flex 高度，避免 contenteditable 高度为 0 不可点击。
- 修正 `Home.vue` 的 `useNotes` / `useSettings` 导入路径（`../` -> `./`）。
- 修正 milkdown 子路径导入：`@milkdown/kit` 根入口为空导出，改用 `@milkdown/kit/core`、`@milkdown/kit/preset/commonmark`、`@milkdown/kit/plugin/listener`。
- 修正 `marked` 版本号（`^12.2.0` 不存在，改为 `^18.0.6`）。

### 变更

- Windows 下 `npm` 命令改用 `npm.cmd` 以绕过 PowerShell 执行策略限制。
- 删除不再使用的旧组件（`NoteEditor.vue`、`NoteList.vue`、`Note/index.vue`）。

### 文档

- 新增面向用户的 README。
- 新增 CHANGELOG。

## [1.2.0] - 2026-07-18

### 新增

- **桌面便利贴独立窗口**：通过 `ztools.createBrowserWindow` 创建独立窗口，定位屏幕右上角，无边框、置顶、可拖动；主窗口自动隐藏，便利贴常驻桌面。
- **所见即所得模式**：引入 Milkdown，输入 Markdown 语法即时渲染为富文本。
- **编辑模式切换**：在设置中选择「所见即所得」或「双栏」（textarea + marked 预览），偏好持久化。
- **管理面板**：主页面提供设置区（模式、字号）、新建按钮、已保存便签列表（打开 / 删除）。
- **草稿保存机制**：新建便签默认为草稿不落库，点击「保存」才写入 dbStorage；关闭未保存即丢弃。
- **Ctrl + 滚轮调字号**：便利贴内实时调整字号并持久化。
- **复制按钮文字化**：以「复制原文」/「复制纯文本」文字按钮形式呈现。
- 引入依赖：milkdown（kit / vue / theme-nord / plugin-listener）、marked、element-plus、@element-plus/icons-vue、unplugin-auto-import、unplugin-vue-components。

### 变更

- 移除 Hello / Read / Write 示例功能，聚焦便签单一功能（指令 `便签` / `note` / `bj`）。
- `build` 脚本改为 `vite build`（适配自动导入方案），新增 `type-check` 脚本。
- Element Plus 改为按需自动导入。

## [1.1.0] - 2026-07-18

### 新增

- 便签核心功能：Markdown 双栏编辑（textarea + marked 预览）。
- 字号控制（CSS 变量 `--note-font-size`，+/- 按钮，持久化到 dbStorage）。
- 纯文本复制（剥离 Markdown 标记）。
- 便签数据持久化（dbStorage，结构含 id / title / content / createdAt / updatedAt）。
- 暗色模式适配。

## [1.0.0]

- 初始 ZTools 插件脚手架（Hello / Read / Write 示例）。
