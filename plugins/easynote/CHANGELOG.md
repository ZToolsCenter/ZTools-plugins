# Changelog


本文件记录 easynote 便签插件的版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## 1.7.3 - 2026-09-01

### 新增

- **笔记 / 待办分别清空**：笔记栏、待办栏表头各新增「清空」按钮，二次确认（弹窗显示将删除的对应类型数量）后仅删除该类型全部便签，并提示已删除条数；该栏无便签时按钮置灰不可用。

## 1.7.2 - 2026-08-20

### 修复

- **复制多余空行 / `<br />` 残留**：Milkdown 序列化空段落产生的 `<br />` 行（包括块引用内 `> <br />`）在复制时被一并带入；连续空行出现多余换行符。新增 `normalizeContent` 净化函数，在复制原文/纯文本时自动移除 `<br />` 空行、合并连续空行、清理行首转义（如 `\=` → `=`）、移除尾部空引用行，使复制内容更紧凑干净。

## 1.7.1 - 2026-08-13

### 新增

- **笔记/待办互转**：列表每条便签新增转换按钮，笔记可转为待办、待办可转为笔记，转换后移动到对应分栏并更新时间。
- **待办完成时间**：待办勾选完成时记录完成时间（`doneAt`），列表显示「完成于 xx」；鼠标悬浮时间可查看全部完整时间（创建于 / 更新于 / 完成于，年-月-日 时:分格式）。

### 变更

- **待办排序**：已完成的待办沉底显示在下方，未完成的保持在上方，各组内仍按更新时间降序。

### 修复

- **类型转换残留完成样式**：已完成的待办转为笔记后仍保留划线样式的问题。转换类型时统一重置完成状态。

## 1.7.0 - 2026-08-13

### 变更

- **双栏管理主页**：已保存列表由单一列表改为左右两栏——左栏集中展示「笔记」，右栏集中展示「待办」，各自独立滚动、互不干扰；待办栏顶部实时统计完成进度（已完成 / 总数，如 `2/5`），勾选完成即时更新。

## 1.6.0 - 2026-08-12

### 新增

- **普通内容页**：列表点击便签改为直接打开普通内容页面（主窗口内，可查看、可编辑），不再默认打开便利贴；列表每条新增「打开便利贴」按钮，可随时以桌面便利贴形式打开。
- **待办类型**：新增 `待办` / `笔记` 双类型。便利贴保存新便签时弹窗选择保存类型；待办在列表中前置任务勾选框，可勾选完成（`done` 持久化），已完成标题划线显示。

### 修复

- **便利贴关闭后插件进程残留**：关闭便利贴独立窗口时插件仍显示在 ZTools 后台。现由便利贴窗口关闭即调用 `outPlugin(true)`，同时主窗口轮询便利贴销毁状态兜底（覆盖任务栏 / 快捷键等外部关闭场景），确保关闭便利贴后插件进程立即结束。

## 1.5.0 - 2026-07-22

### 修复

- **便利贴关闭后插件进程未结束**：关闭便利贴独立窗口时，插件仍在 ZTools 后台运行。改为由主窗口轮询检测便利贴窗口状态，关闭后调用 `outPlugin(true)` 结束整个插件进程。

## 1.4.0 - 2026-07-21

### 新增

- **直接新建便签指令**：新增 `新建便签` / `新便签` / `new-note` 三个指令，在 ZTools 中直接触发即可打开空白便利贴，无需经过管理主页。由 `plugin.json` 中新增的 `new-note` feature 实现，`App.vue` 的 `onPluginEnter` 处理器按 action code 分发，`new-note` 直接调用 `openEditor(null)` 跳过 Home 页面。

## 1.3.0 - 2026-07-20

### 修复

- **字号控制**：修复所见即所得模式下 Ctrl+滚轮只缩放列表圆点、不缩放正文和标题的问题。通过覆盖 Milkdown nord 主题的 `--text-*` CSS 变量，让所有文字（标题、段落、代码块）随 `--note-font-size` 整体缩放。
- **独立窗口生命周期**：关闭 ZTools 主页面时不再连带关闭便利贴窗口。添加 `parent: null` 选项使便利贴窗口独立于主窗口，并拦截 `beforeunload` 事件阻止主窗口关闭时杀死进程。
- **新建便签冲突**：修复便利贴已打开时，点击「新建便签」出现的 WPS 报错。改为每次新建时先关闭旧窗口再创建新窗口，同时 `createBrowserWindow` 失败时自动回退到嵌入模式。

### 变更

- 插件分类从 `productivity` 改为 `效率工具`。
- `openStickyWindow` 返回 `boolean` 以支持调用方判断创建结果。
- 导出 `isStickyNoteOpen()` 和 `closeStickyWindow()` 供主窗口生命周期管理使用。

## 1.2.1 - 2026-07-18

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

## 1.2.0 - 2026-07-18

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

## 1.1.0 - 2026-07-18

### 新增

- 便签核心功能：Markdown 双栏编辑（textarea + marked 预览）。
- 字号控制（CSS 变量 `--note-font-size`，+/- 按钮，持久化到 dbStorage）。
- 纯文本复制（剥离 Markdown 标记）。
- 便签数据持久化（dbStorage，结构含 id / title / content / createdAt / updatedAt）。
- 暗色模式适配。

## 1.0.0 - 2026-07-20

- 初始 ZTools 插件脚手架（Hello / Read / Write 示例）。
