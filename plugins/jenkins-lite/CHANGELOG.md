# Changelog


# Jenkins Lite - 更新日志

一款轻量级的 Jenkins 辅助工具，帮助开发者快速检索任务状态、监控构建进度并秒级触发构建。

---


## 快捷指令

- `jenkins` - 打开 Jenkins Lite
- `jenkins lite` - 打开 Jenkins Lite
- 任意文字 - 搜索 Jenkins 任务

---

## 数据安全

本插件完全开源透明：

- 所有配置（Jenkins 地址、用户名、API Token）**仅保存在你的本地设备**
- **不向任何服务器上传数据**
- 源码公开，可审计

开源仓库：[github.com/kshq1996/ztools-jenkins](https://github.com/kshq1996/ztools-jenkins)

## 1.4.0 - 2026-08-25

### 🆕 新增

- **日志高亮 + 自动滚到底**：BuildLogModal 打开后日志自动滚到底部；含 `ERROR / Exception / FATAL / BUILD FAILURE / failed / Error:` 的行红字 + 浅红底 + 红色左边框
- **复制错误日志**：弹窗底部新增「复制错误 (N)」按钮，仅复制含错误关键字的行，N 为错误行数
- **日志滚动快捷键**：弹窗打开时 `↑ / ↓` 滚一行、`PgUp / PgDn` 翻页、`Home / End` 顶/底
- **键盘操作提示**：Sidebar / JobsList / BuildHistory 各自下方加 `<kbd>` 风格的快捷键提示行
- **Sidebar 视图即时切换**：`↑↓` 直接切视图，不再需要 `Enter` 确认
- **JobsList 即时联动右侧**：`↑↓ / Shift+↑↓` 切换选中项时自动联动右侧构建历史
- **弹窗 Enter 确认 / Esc 取消**：构建确认和收藏确认弹窗都支持 Enter 直接确认、Esc 取消
- **Esc 后焦点还原**：弹窗关闭时焦点回到打开它的那条 Job / build，不再被强制弹到搜索框

### 🎨 优化

- **BuildLogModal 布局**：`.log-body` 去掉冲突的 `min/max-height` 限制，`.modal-footer` 加 `flex: 0 0 auto`，日志很长时 footer 始终可见
- **键盘提示分隔符**：Sidebar 提示行加 `·` 分隔，多个快捷键之间不挤

### 🐛 修复

- **空白页**：根因是 Vue 3 `provide / inject` 在同组件内不自洽（provide 存到 `instance.provides`，同组件 inject 走 `appContext.provides`），App.vue 改用直接 import 模块级 ref
- **JobItem 受控展开**：Folder 展开状态从组件内提升到 JobsList，便于键盘导航跨层操作

### 🔧 内部

- `useBuildPolling` 新增 `stopWatchingBuild(jobName?, buildNumber?)` 参数化清理
- `useKeyboardNav` 模块级 ref export 给 App.vue 直接使用（绕过 provide/inject 同组件限制）
- `tests/App.smoke.test.ts` 新增，捕获 App 根挂载类回归

---

## 1.3.0 - 2026-08-25

### 🆕 新增

- **构建完成通知**：触发构建后自动监听该 build 直到结束，完成时弹出系统通知（成功 / 失败 / 不稳定 / 中止）
- **构建日志弹窗**：右侧历史面板点击构建记录不再跳转 Jenkins，而是打开弹窗直接查看 console log
  - 弹窗内仍提供「在 Jenkins 中打开」按钮，需要详细页面时一键跳转
  - 支持「复制日志」到剪贴板
- **键盘快捷键**：
  - `←` / `→` 在 Sidebar / JobsList / BuildHistory 三个面板间循环切换（焦点默认在 Sidebar）
  - `↑` / `↓` 在当前面板内上下移动选中项
  - `Shift + ↑` / `Shift + ↓` 在 JobsList 中进入 Folder / 退出到父 Folder（同级导航走纯 ↑↓）
  - `Enter` 触发当前选中项的主操作：Sidebar 切视图 / JobsList 触发构建（含二次确认）/ BuildHistory 打开构建日志
  - `Cmd / Ctrl + Enter` 在 JobsList 收藏当前选中项（走二次确认，防误触）
  - `Esc` 关闭弹窗
  - 被聚焦的面板有蓝色描边，选中项左侧出现蓝色高亮条

### 🔧 内部

- `preload.js` 新增 `getBuildConsole` 接口（`/job/<segments>/<n>/consoleText`），沿用 Folder 嵌套路径分段规则
- `useBuildPolling` 新增 `watchBuild(jobName, buildNumber, onComplete)`：独立定时器监听单个 build 完成，不影响右侧历史面板的轮询
- 新增 `useKeyboardNav` composable：provide/inject 集中管面板焦点与选中索引
- `JobItem` 的 Folder 展开状态从组件内提升到 `JobsList`，以便键盘导航能跨层操作

---

## 1.2.1 - 2026-08-25

### 🎨 优化

- **Job 树形列表更紧凑**：
  - 移除每行名称前的状态图标，只保留 Folder 展开/收起箭头（▶ / ▼）
  - 每行垂直内边距减半（10px → 5px），行间距减半（4px → 2px）
  - Folder 嵌套缩进从 16px 缩到 10px，仍能清晰看出层级
- **同屏可见 Job 更多**：上述改动组合后，相同滚动区域内可见 Job 数量提升约 50%
- **长名称 hover 显示全名**：依赖原生 `title` 属性 tooltip，悬停约 500ms 后展示完整 Job 名

---

## 1.2.0 - 2026-08-24

### 🆕 新增

- **Jenkins 文件夹下钻**：支持展开 Folder / 组织目录 / 多分支流水线目录，逐级查看嵌套的 Job
- **嵌套 Job 操作**：目录里的 Job 可直接收藏 + 一键构建，不再被父目录吞掉
- **启动状态恢复**：重新打开插件自动停留到上次的实例 + 视图 + 选中的 Job（含嵌套路径）
- **收藏路径完整展示**：收藏视图扁平显示叶子 Job，用 `fullName` 展示完整路径（如 `team/services/deploy`）
- **搜索支持嵌套**：搜索框可命中目录内嵌套 Job

### 🐛 修复

- **侧边栏新增实例卡编辑模式**：点击下拉菜单的"新增实例"现正确进入添加模式
- **打包后插件空白页**：生产 manifest 自动移除 `development` 字段，避免 ZTools 误走开发入口
- **打包脚本跨平台**：用纯 Node 脚本生成 `dist.zip`，Windows 也可构建
- **CommonJS 边界**：生产目录补 `package.json`，让 `preload.js` 被正确加载

---

## 1.1.0 - 2026-08-13

### 🆕 新增

- **顶部设置按钮直编辑当前实例**：点击即可编辑，无需在多个实例中查找
- **侧边栏下拉菜单新增实例**：清晰区分"新增"与"编辑"入口
- **收藏作为视图**：侧边栏把【收藏】作为视图项，点击后中间区域过滤显示已收藏的 Jobs
- **收藏记录视图**：收藏时记录所在视图，点击收藏跳转对应视图
- **搜索自动聚焦**：通过 ZTools 搜索打开插件时，自动聚焦搜索框并填入搜索词
- **数据安全声明**：设置弹窗底部展示数据安全策略

### 🎨 优化

- **表单布局**：改为两列两行（名称+URL 一行，用户名+Token 一行）
- **保存前必须测试通过**：新增/编辑必须先点击【测试连接】，确保连接成功才能保存
- **构建记录布局**：
  - 状态 + 编号 + 结果 + 耗时 在一行
  - 开始/结束时间分开两行显示（含完整日期）
- **构建时间显示**：开始/结束时间均显示年月日时分
- **UI 图标**：移除 emoji 图标，统一使用 CSS 绘制的 SVG mask 图标
- **长名称 hover 显示全名**：所有 job 名、视图名都支持 hover tooltip

### 🐛 修复

- **收藏取消失败**：修复 IPC 传输时无法克隆对象的错误，改为传 `_id` 字符串
- **构建通知 undefined**：修复弹窗关闭后引用丢失的问题
- **视图自动选中**：切换视图时自动选中第一个 job

---

## 1.0.0 - 2026-08-13

### 核心功能

- **多实例管理**：添加、编辑、删除多个 Jenkins 实例
- **实例切换**：通过下拉菜单快速切换
- **任务列表**：查看所有 Jenkins Jobs，支持 Folder 嵌套
- **视图筛选**：按 Jenkins 视图筛选 Jobs
- **搜索**：在当前列表中按名称搜索
- **任务状态**：显示成功/失败/运行中/禁用等状态
- **收藏常用 Jobs**
- **一键触发构建**：带确认弹窗
- **构建历史**：
  - 查看构建记录
  - 显示时间信息
  - 点击跳转到 Jenkins 详情页
- **通知提醒**：构建触发、实例变更等系统通知

### 技术特性

- 基于 **Vue 3 + TypeScript** 构建
- 支持**暗黑模式**
- 数据**本地持久化**（基于 ZTools 数据库）
- 响应式设计

---
