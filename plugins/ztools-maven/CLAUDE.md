# CLAUDE.md

ZTools 插件 `ztools-maven` —— 在 ZTools 弹窗内检索 Maven 依赖、一键复制 Maven / Gradle 坐标。

## 技术栈

Vue 3 (Composition API + `<script setup>`) · Vite 6 · TypeScript · Vitest · @vue/test-utils · Playwright (E2E)

## 命令

```bash
npm run dev          # vite dev server (http://localhost:5173, ZTools 自动加载)
npm run build        # vue-tsc + vite build + zip dist.zip (扁平 preload 结构)
npm test             # vitest run (所有套件)
npm run test:component   # 仅 component 套件
npm run test:unit        # 仅 unit 套件
npm run test:integration # 仅 integration 套件
npm run test:e2e         # Playwright E2E
```

## 项目结构

```
src/
  main.ts                      # createApp(App).mount('#app')
  main.css                     # 全局：:root 主题变量、html/body/#app 高度链、button 默认
  App.vue                      # 路由根：根据 ztools.onPluginEnter 切到 MavenUi / MavenSearch
  MavenUi/index.vue            # 主面板（~1200 行）：搜索 → 一级结果 → 二级版本 → 复制
  MavenSearch/index.vue        # 快捷复制面板（ZTools 主搜索框触发）
  MavenSettings/index.vue      # 代理设置弹窗
  lib/
    pom-builder.ts             # buildDependency() / buildGradleCoord()
    version-tag.ts             # tagVersion() / dedupeVersions() / pickLatest() / formatTimestamp()
    search-parser.ts           # parseSearch(input) → { kind: 'scoped' | 'freeText', g?, a?, rawQuery? }
    useMavenCache.ts           # 基于 dbStorage 的搜索 / 版本缓存
    useTheme.ts                # 跟随 ZTools isDarkColors()
    types.ts                   # MavenArtifact / MavenVersion 等共享类型
  preload.js                   # Solr / 阿里云 / CodeRead HTTP 客户端 + ServiceError 包装
tests/
  unit/  integration/  component/  e2e/  helpers/ztools-stub.ts
```

## 关键约定

### 键盘快捷键（在 `MavenUi/index.vue` 的 `onGlobalKey` 里集中处理）

| 键 | 行为 |
|---|---|
| `/` | 聚焦搜索框 |
| `↑` / `↓` | 列表内移动（结果 / 版本各一份 local handler + 全局回落） |
| `←` / `→` | 结果面板切数据源 Tab；版本面板 ← 返回 |
| `Shift` + `←` / `→` | 切分类（全部 / Android / 非安卓），结果 + 版本面板通用 |
| `Enter` / `c` / `p` | 结果面板进入二级；版本面板打开操作菜单 |
| `m` | 复制 Maven `<dependency>` |
| `g` | 复制 Gradle `implementation 'g:a:v'` |
| `Esc` | 版本面板返回；根级隐藏窗口 |
| `Cmd/Ctrl+K` | 切换帮助浮层 |

**local handler 注意点**：版本面板的 `onVersionKey` 会拦截 ← 作返回。若新增 shift 修饰的快捷键，必须在 local handler 里加 `!e.shiftKey` 守卫，否则 local 先跑修改 state 后全局处理器切到错的 ref。

### 列表布局（独立滚动）

```
html, body, #app { height: 100%; overflow: hidden }   # main.css
.maven-panel      { height: 100%; display: flex; flex-direction: column }
.results / .versions { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column }
.results > ul, .versions > ul { flex: 1 1 auto; min-height: 0; overflow-y: auto }   # 唯一滚动容器
```

箭头键移动后 `scrollSelectedIntoView(listEl, idx)` 调 `scrollIntoView({ block: 'nearest' })`，no-op 当行已可见。

### 三源聚合（preload.js）

- **Maven Central**：Solr `search.maven.org/solrsearch/select`，可能需要代理
- **阿里云**：`maven.aliyun.com/artifact/aliyunMaven/searchArtifactByWords`，国内快；`groupId` 返回 `#` 时回填 Solr
- **CodeRead**：`mvn.coderead.cn/search`（仅 HTTP），版本列表走 `codeReadVersions(g, a)` 解析其 HTML 版本页

聚合去重在 preload.js 内的 `mavenSearch` 入口完成，按 `id (g:a)` 去重、按 groupId 前缀（`com|org|dev|cn`）优先排序。

### 分类判定

- 结果：`groupId` 或 `artifactId` 含 `android`（不区分大小写）→ Android，否则 Java
- 版本：版本号字符串含 `android`（`2.0.60.android8` 这种）→ Android，否则 Java

### 错误处理

所有 HTTP 错误统一包装为 `ServiceError(msg, { url, status, durationMs, body })`，UI 端在 `.error-box` 展开详情，可一键复制。

## 发布 / 维护

### 版本号必须同时改两个文件

每次发版都要 bump，漏一个就是 bug：

- `package.json` → `"version"` 字段（npm 元数据）
- `plugin.json` → `"version"` 字段（uTools 插件清单，发布后用户看到的版本号）

build 出来的 `dist.zip` 里 `plugin.json` 的 version 也会被原样带上，所以 ZTools 插件中心读到的版本号以 `plugin.json` 为准。

### `dist.zip` **不**进 git

`dist.zip` 已经在 `.gitignore` 里（commit `1593552`）。它是 `npm run build` 的产物，每次发版都会重新生成，tracking 它只会让 PR diff 噪音大、repo 体积膨胀。

本地 `dist.zip` 仍在，可手动拖到 ZTools 插件中心或 GitHub Release 上传。**真正的发布物是 GitHub Release 附件**，不是 git tree 里的文件。

## 提交规范

`<type>(<scope>): <subject>`，type 用 `feat` / `fix` / `style` / `refactor` / `docs` / `test` / `chore`，scope 常用 `ui` / `aliyun` / `coderead` / `central`。
