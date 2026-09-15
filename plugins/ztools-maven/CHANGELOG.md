# Changelog

本插件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## 1.1.0 - 2026-08-25

聚焦交互紧凑度与列表滚动体验。

### 新增

- **智能滚动**：箭头键上下移动光标时，列表区域自动 `scrollIntoView({ block: 'nearest' })`，高亮行始终保持在视窗内（不再依赖浏览器页面滚动）
- **Shift+← / Shift+→**：切换分类（全部 / Android / 非安卓），结果面板与版本面板均生效，从循环起点环绕
- **开源仓库链接**：结果面板底部新增 footer-link 跳转到 [https://github.com/kshq1996/ztools-maven](https://github.com/kshq1996/ztools-maven)，标签「开源 v{version}」版本号从 `package.json` 自动读取

### 变更

- **头部紧凑化**：`.maven-panel` padding、`result-header` / `header` 边距、`.tabs` / `.source-tip` / `.cat` 内边距与字号全面缩小，约 90px 高度让渡给 list 区域（600px 视窗下 list 从 ~370px 提升到 ~460px）
- **顶部 hints 同步更新**：结果面板 `↑↓ 选包 · ←→ 切源 · Shift+←→ 切分类 · m Maven · g Gradle · Enter 进入`，版本面板 `↑↓ 选版本 · Shift+←→ 切分类 · Enter/c/p 菜单 · m Maven · g Gradle · ← 返回`
- **Help 浮层（Cmd/Ctrl+K）新增一行**：`Shift+←/→` 切换分类
- **README 快捷键表新增一行**：`Shift + ← / →` 在两个面板的分类切换

### 修复

- **列表独立滚动链**：补齐 `html` / `body` / `#app` 到 viewport 的 `height: 100%` + `overflow: hidden`，`.maven-panel` 由 `min-height` 改为 `height`，让 `.results > ul` / `.versions > ul` 的 `overflow-y: auto` 真正生效
- **Shift+← 在版本面板不再误返回**：版本面板的 `onVersionKey` 之前不区分 shift 修饰键，按 ← 一律返回上层并提前把 `selectedArtifact` 清空，导致全局 `cycleCategory` 切到错的 ref。增加 `!e.shiftKey` 守卫让 Shift+← 透传到全局处理器

## 1.0.0 - 2026-08-14

首个正式版本。一款在 ZTools 内快速检索 Maven 依赖、浏览历史版本并一键复制依赖声明的插件。

### 新增

- **三源聚合搜索**：同时查询 Maven Central（Solr）、阿里云 Maven 镜像、CodeRead 镜像，单源失败不影响其他
- **数据源 Tab**：全部（聚合去重）/ Central / 阿里云 / CodeRead 自由切换，记忆用户偏好（`dbStorage`）
- **分类筛选**：一级结果与二级版本面板均支持 全部 / Android / 非安卓 分类，判定基于 groupId / artifactId / 版本号是否含 `android`，偏好持久化
- **复制能力**：
  - `m` 复制 Maven `<dependency>` XML，`g` 复制 Gradle `implementation 'g:a:v'`
  - 阿里云结果自带版本，一级直接复制；Central / CodeRead 进入二级版本面板选版本后复制
  - CodeRead 二级版本页 HTML 解析（`/version?groupId=&artifactId=`）
  - 操作菜单（Enter/c/p）选择 POM / Android 格式
- **历史版本**：版本号 + 发布时间 + stable / snapshot / alpha / beta 标签 + LATEST 徽章，按时间倒序
- **代理配置**：设置弹窗（⚙），默认关闭，可配置后即时生效并持久化
- **搜索防抖**：停止输入 700ms 后触发
- **暗夜模式**：跟随 ZTools `isDarkColors()`
- **键盘导航**：↑↓ 移动、←→ 切源、全局复制快捷键、帮助浮层（Cmd/Ctrl+K）
- **错误处理**：结构化 `ServiceError`（URL/状态/耗时/响应体），429 重试，超时包装，可展开错误详情并一键复制
- **排序**：`com|org|dev|cn` 开头的 groupId 优先置顶

### 变更

- 移除模板示例功能（hello / read / write）
- 移除 GraphQL 降级（`central.sonatype.com/graphql` 不可达）
- 移除坐标 / JAR URL 复制及对应快捷键
- 插件打包：`npm run build` 产出 `dist.zip`（扁平 `preload.js` 结构，对齐 ztools-jenkins）

### 修复

- 修复 ZTools 沙箱 preload 中 `require` 不可用导致空白页
- 修复 `setSubInput` 回调参数实际为 `{ text }` 对象导致的崩溃
- 修复空态在搜索完成前误显示"没找到相关包"
- 修复阿里云 `unknown` 版本、`packaging != pom`、`#` groupId 数据问题
- 修复 CodeRead 仅支持 HTTP（无 TLS）
- 修复搜索框聚焦时复制快捷键泄漏到输入框

### 技术栈

Vue 3 · Vite · TypeScript · Vitest · @vue/test-utils · Playwright
