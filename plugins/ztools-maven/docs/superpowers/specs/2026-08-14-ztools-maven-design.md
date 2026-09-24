# ztools-maven 插件设计

> 日期：2026-08-14
> 状态：定稿
> 项目：`/Users/kangshaoqi/自研项目/ztools 插件/ztools-maven`

## 1. 目标

为 ZTools 提供一个 Maven 依赖检索插件，让开发者无需打开浏览器就能：
- 搜索 Maven Central 上的 Java 构件
- 浏览历史版本（含发布时间、版本状态标签）
- 一键复制 `<dependency>` XML 到剪贴板并粘贴到当前应用

支持两种入口：
- **UI 模式**（`maven-ui`）：在面板中交互式搜索→选包→选版本→选复制格式
- **指令模式**（`maven-search`）：在 ZTools 主搜索框直接输入关键字，自动完成搜索→选包→选版本→复制粘贴，全程零面板交互

## 2. 架构

方案 A：分层架构。Preload 层封装网络，lib 层放纯函数，组件层只做 UI 编排。

```
ZTools 宿主
  ├─ feature: maven-ui      ── 字符串 cmds：["maven","mvn search"]
  └─ feature: maven-search  ── over 类型 cmds：匹配任意文本

两者各自渲染 Vue 组件（命名与目录一致）：
  src/MavenUi/index.vue     → 组件名 MavenUiPanel
  src/MavenSearch/index.vue → 组件名 MavenSearchPanel

两个面板共享：
  src/lib/
    search-parser.ts   输入解析（纯函数）
    version-tag.ts     版本状态分类（纯函数）
    pom-builder.ts     生成 <dependency> XML（纯函数）
    useTheme.ts        主题 hook
    types.ts           共享类型

共享调用底座：
  public/preload/services.js
    mavenSearch(query: ParsedQuery): Promise<SearchResult>       → 返回 { data: MavenArtifact[], source: 'solr' | 'graphql' }
    mavenVersions(g, a): Promise<{ data: MavenVersion[], source: 'solr' }>  → Solr core=gav
    会话内 Map 缓存
```

### 模块职责

| 模块 | 做什么 | 依赖 |
|---|---|---|
| `preload/services.js` | Solr/GraphQL 双通道 + 降级（rawQuery 不降级） | Node `fetch` + ZTools preload 环境 |
| `src/lib/search-parser.ts` | 把 `spring-core` / `org.x:y` / `g:org.x AND a:y` 解析成 `{g?, a?, v?, freeText}` | 无 |
| `src/lib/version-tag.ts` | `6.0.0` → stable；`6.0.0-SNAPSHOT` → snapshot；`1.0.0-alpha` → alpha；`2.0.0.Beta` → beta | 无 |
| `src/lib/pom-builder.ts` | 把 `{g,a,v,scope?,classifier?,optional?}` 渲染成 `<dependency>` 字符串（字段 XML 转义） | 无 |
| `src/lib/useTheme.ts` | 跟随 `ztools.isDarkColors()`，写 `data-theme` 属性 | ZTools API |
| `src/lib/types.ts` | `MavenArtifact` / `MavenVersion` / `ParsedQuery` (discriminated union, `kind` 必填) / `PomOptions` / `CacheEntry<T>` (= `{ data: T[]; source: 'solr' \| 'graphql' \| null }`) / `SearchResult<T>` (= `{ data: T[]; source: 'solr' \| 'graphql' }`) | 无 |
| `src/MavenUi/index.vue` (MavenUiPanel) | 搜索框 + 结果列表 + 版本面板 + 操作菜单 + 错误详情 + Toast | lib + `window.services` + `window.ztools` |
| `src/MavenSearch/index.vue` (MavenSearchPanel) | 挂载即读 `LaunchParam.payload`，复用 lib，自动默认复制 | lib + `window.services` + `window.ztools` |
| `public/plugin.json` | 注册两个 feature | 无 |

## 3. plugin.json

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "ztools-maven",
  "title": "Maven Lite",
  "description": "在 ZTools 内搜索 Maven Central 上的 Java 构件并一键复制 <dependency> XML 到剪贴板",
  "author": "康康学长",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "development": { "main": "http://localhost:5173" },
  "features": [
    {
      "code": "maven-ui",
      "explain": "Maven 包检索",
      "icon": "logo.png",
      "cmds": ["maven", "mvn search"]
    },
    {
      "code": "maven-search",
      "explain": "快速复制 Maven 依赖",
      "icon": "logo.png",
      "mainHide": true,
      "cmds": [
        {
          "type": "over",
          "label": "搜索 Maven 依赖",
          "minLength": 1,
          "maxLength": 200
        }
      ]
    }
  ]
}
```

## 4. 数据流

### 模式 A：`maven-ui`

```
用户触发：输入 "maven" 或 "mvn search"
  ↓
MavenUiPanel 挂载
  ↓
调 ztools.setSubInput(onChange, '搜索 Maven 包…', true)
  ↓
用户在主输入框打字（如 "spring-core"）
  ↓
onChange 防抖 300ms
  ↓
search-parser("spring-core") → { kind: 'freeText', freeText: "spring-core" }
  ↓
window.services.mavenSearch({ kind: 'freeText', freeText: "spring-core" })
  ├─ 缓存命中 → 直接返回
  └─ 未命中 → fetch Solr /solrsearch/select?q=spring-core&rows=20&wt=json
                ├─ 2xx → 规范化 → 写缓存 → 返回
                └─ 4xx/5xx/timeout → fetch GraphQL → 失败 → 抛错
  ↓
UI 渲染结果列表（groupId : artifactId : latestVersion [STATUS]）
  ↓
用户点击某行（或键盘 Enter）
  ↓
window.services.mavenVersions(g, a)
  → fetch Solr /solrsearch/select?q=g:xxx AND a:yyy&core=gav&rows=200&wt=json
  → 返回 MavenVersion[]，timestamp → YYYY-MM，version-tag 分类
  ↓
UI 渲染版本列表（按 timestamp 倒序）
  ↓
用户点击某版本
  ↓
**模式 A 行为**（与 §12 键盘表一致）：
  - 鼠标点击 / `Enter` / `c` → 弹出操作菜单（焦点默认在"复制 XML"），用户用 `Tab`/`Shift+Tab` 切换、`Enter` 确认、`Esc` 取消
  - `g` → 直接复制 Gradle 坐标（跳过菜单）
  - `u` → 直接复制 JAR URL（跳过菜单）
  - 菜单确认后 → pom-builder 生成字符串 → `window.ztools.clipboard.writeContent({type:'text', content, shouldPaste:true})`
  ↓
window.ztools.showNotification('已复制 Maven 依赖')
  ↓
window.ztools.hideMainWindow()
```

### 模式 B：`maven-search`

```
用户触发：在 ZTools 主搜索框直接输入任意文字（如 "spring-core"）
  → over cmd 命中 → 插件被唤起
  ↓
MavenSearchPanel 挂载
  → LaunchParam.payload = "spring-core"（从 onPluginEnter 回调，over cmd 自动传入）
  ↓
自动调用 mavenSearch({ kind: 'freeText', freeText: "spring-core" })（与模式 A 步骤相同）
  ↓
用户选择包（鼠标点击或在结果列表按 `Enter`，详见 §12）→ 自动拉版本列表
  ↓
用户选择版本 → **直接默认复制**（不弹菜单；`Enter` / `c` / `g` / `u` 在模式 B 中行为完全一致，统一触发默认复制，详见 §12）
  → pom-builder({g,a,v, scope:'compile'})  生成默认 XML
  → clipboard.writeContent({type:'text', content, shouldPaste:true})
  → showNotification('已复制：org.springframework:spring-core:6.0.0')
  → hideMainWindow()
  → 中途中止：`Esc` 隐藏主窗口；面板关闭后用户可重新触发
```

## 5. ZTools API 使用

| 用途 | API |
|---|---|
| 接收模式 A 主输入 | `ztools.setSubInput(onChange, placeholder, isFocus)` |
| 接收模式 B 搜索词 | `onPluginEnter` 回调的 `LaunchParam.payload` |
| 搜索 Maven Central | `preload/services.js` 内 `fetch`（Node 环境无 CORS） |
| 复制 + 自动粘贴 | `ztools.clipboard.writeContent({type:'text', content, shouldPaste:true})` |
| 反馈提示 | `ztools.showNotification(body)` |
| 主题检测 | `ztools.isDarkColors()`（权威源） |
| 自动隐藏主窗口 | `ztools.hideMainWindow()` |
| HTTP 头 | `ztools.http.setHeaders({'User-Agent': 'ztools-maven/1.0'})` —— `preload/services.js` 启动时调用一次，避免 Maven Central 对裸 `node-fetch` UA 限流 |

> 注：`ztools.redirect()` 列出但本设计不主动使用——两个 feature 都从 ZTools 主搜索框独立触发，无需跨 feature 跳转。

## 6. 搜索语法（`search-parser.ts`）

支持的输入形式（智能识别）：

| 输入 | 解析结果（带 `kind` 判别字段） |
|---|---|
| `spring-core` | `{ kind: 'freeText', freeText: "spring-core" }` —— 模糊搜索 |
| `org.springframework:spring-core` | `{ kind: 'scoped', g: "org.springframework", a: "spring-core" }` —— 限定 groupId |
| `org.springframework:spring-core:6.0.0` | `{ kind: 'scoped', g, a, v }` —— 直接定位，跳过搜索列表 |
| `g:org.springframework` | `{ kind: 'scoped', g: "org.springframework" }` —— 只按 groupId |
| `g:org.springframework AND a:spring-core OR a:spring-test` | `{ kind: 'rawQuery', rawQuery: "g:org.springframework AND a:spring-core OR a:spring-test" }` —— 含 Solr 操作符，整段透传 |
| `  spring-core  ` | `{ kind: 'freeText', freeText: "spring-core" }` —— 归一化多余空格 |

### Solr 原生语法透传规则

- **触发条件**：输入字符串包含 `AND` / `OR` / `NOT`（不区分大小写，被空白包围）**或**圆括号
- **触发后行为**：整个字符串写入 `rawQuery` 字段，**不做任何智能分割**（即不再识别 `g:` `a:` `v:` 前缀——用户需自行用 Solr 字段语法）
- **未触发**：继续走 `:` 分隔符解析

归一化规则：
- 去除前后空格
- `g:` `a:` `v:` 字段值统一 trim，**不强制小写**（groupId 大小写敏感）
- 自由词合并多余空白

### 解析结果到网络层的契约

`search-parser.ts` 导出 `ParsedQuery` 类型与 `parseSearch(input: string): ParsedQuery`：

```ts
type ParsedQuery =
  | { kind: 'freeText'; freeText: string }
  | { kind: 'scoped'; g?: string; a?: string; v?: string }
  | { kind: 'rawQuery'; rawQuery: string }
```

`preload/services.js` 的 `mavenSearch` 签名改为：

```ts
mavenSearch(query: ParsedQuery): Promise<SearchResult>
```

内部根据 `kind` 分支构造 Solr `q=`：
- `freeText` → `q=${encodeURIComponent(query.freeText)}`
- `scoped` → 拼接 `g:` `a:` `v:` 段，缺失段省略，`AND` 连接
- `rawQuery` → `q=${encodeURIComponent(query.rawQuery)}`

GraphQL 降级路径：仅 `freeText` / `scoped` 走 GraphQL `search(query: string)`，`rawQuery` 模式不降级（Solr 专属语法，GraphQL 不支持）——降级失败时提示用户简化查询。

## 7. 输出格式（`pom-builder.ts`）

默认复制（含可选元素）：

```xml
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-core</artifactId>
    <version>6.0.0</version>
    <scope>compile</scope>
    <classifier>sources</classifier>
    <optional>true</optional>
</dependency>
```

- `scope` / `classifier` / `optional` 仅在用户主动设置时才输出
- 默认模式 A 用户在操作菜单里选择；模式 B 强制 `scope=compile`、不输出 classifier/optional
- 所有字段值 XML 转义（`<` `>` `&` `"` `'`）
- 缩进 4 空格，行尾 `\n`，与 Maven 官方格式一致

快捷键 `c` / `g` / `u` 复制不同格式：
- `c` → `<dependency>` XML（使用 `PomOptions` 中所有字段）
- `g` → Gradle 坐标：`org.springframework:spring-core:6.0.0`
- `u` → JAR 中央仓库 URL：**仅主 JAR**（无 classifier），格式 `https://repo1.maven.org/maven2/org/springframework/spring-core/6.0.0/spring-core-6.0.0.jar`；用户选择 `-sources` / `-javadoc` classifier 时 URL 末尾加 `-sources` / `-javadoc`

## 8. 版本标签（`version-tag.ts`）

| 版本号 | 标签 | 颜色（CSS 变量） |
|---|---|---|
| `6.0.0` | stable | `--status-stable` |
| `6.0.0.RELEASE` / `6.0.0.Final` / `6.0.0.GA` | stable | `--status-stable` |
| `1.0.0-rc1` / `1.0.0.RC1` | rc（视同 beta） | `--status-beta` |
| `1.0.0-M1` / `1.0.0-milestone` | milestone（视同 beta） | `--status-beta` |
| `1.0.0-alpha` / `1.0.0-alpha.1` | alpha | `--status-alpha` |
| `1.0.0-beta` / `2.0.0.Beta` | beta | `--status-beta` |
| `1.0.0-SNAPSHOT` | snapshot | `--status-snapshot` |
| 第一条记录（按 timestamp 最新） | LATEST（额外叠加徽章） | `--accent` |
| 未匹配以上规则 | stable（兜底） | `--status-stable` |

### LATEST 判定规则

- 仅当记录的 `timestamp > 0`（即真实发布时间）时才参与 LATEST 判定
- `timestamp === 0` / 缺失 / null 的记录视为"占位符"（如 Maven `LATEST`/`RELEASE` 元数据版本），不显示 LATEST 徽章，但仍在列表中
- 一个 `(g, a)` 下最多一条 LATEST（取 `timestamp` 最大且 `> 0` 的）

### 版本去重规则

排序时若多条记录归一化后等价（去掉 `RELEASE` / `.Final` / `.GA` / `+` build 号后字符串相同），保留**首条非占位符**记录：
- 优先级：`1.0.0` > `1.0.0.RELEASE` > `1.0.0.Final` > `1.0.0.GA`
- 归一化算法：`version.replace(/\.(RELEASE|Final|GA|release|final|ga)$/, '')`，不区分大小写
- 归一化后相同的记录只保留 timestamp 最大的那条（其他丢弃，不显示）

> 兜底"stable"是故意为之——绝大多数陌生版本号是稳定版，标 stable 比误标 alpha/snapshot 更安全；用户可凭版本号字面判断。

UI 同时显示版本号 + YYYY-MM + 标签（颜色 + 文字双通道），按 timestamp 倒序，最多展示 200 条，"加载更多"再请求 `start=200`。

## 9. 缓存策略

**归属**：缓存是组合式 `src/lib/useMavenCache.ts`，**不**放在 `preload/services.js`（preload 生命周期长于单次面板挂载，会导致缓存语义不清）。

**调用顺序**（组件侧）：

```
useMavenCache().getSearch(key)
  ├─ 命中 → 直接返回 CacheEntry<MavenArtifact>
  └─ 未命中 → await window.services.mavenSearch(query: ParsedQuery)
              → 拿到结果 → cache.setSearch(key, entry) → 返回 entry
```

`preload/services.js` 的 `mavenSearch` **不感知缓存**——纯网络层，只负责 Solr/GraphQL 拉取与降级。缓存是组件级关切。

```
useMavenCache() 返回:
  {
    searchCache: Map<string, CacheEntry<MavenArtifact>>,
    versionCache: Map<string, CacheEntry<MavenVersion>>,
    getSearch(key): CacheEntry<MavenArtifact> | null,
    setSearch(key, entry: CacheEntry<MavenArtifact>): void,
    getVersions(key): CacheEntry<MavenVersion> | null,
    setVersions(key, entry: CacheEntry<MavenVersion>): void,
  }
```

- **键归一化**：trim 前后空格；`g` / `a` / `rawQuery` 不强制小写（groupId 大小写敏感）；自由词合并多余空白
  - `mavenSearch` 键：`freeText` / `g + ':' + a` / `rawQuery`
  - `mavenVersions` 键：`g + ':' + a`
- **值**：`CacheEntry<T> = { data: T[]; source: 'solr' | 'graphql' | null }`
  - `mavenVersions` 的 `source` 固定为 `'solr'`（不存在 GraphQL 降级路径）
- **TTL**：随组件卸载销毁；不实现主动过期
- **不命中时**：降级结果也写入缓存（避免重复打 GraphQL）

不实现持久化、收藏、历史搜索。

## 10. 错误处理与降级

### 错误分类

| 错误 | 处理 |
|---|---|
| 网络错误（DNS/断网/timeout 5s） | Solr 失败自动降级 GraphQL；两者都失败 → `showNotification('网络异常，请稍后再试')`；UI 不阻塞，保留输入 |
| 限流（429） | 退避重试 1 次（1.5s 后），仍失败走"网络错误"分支 |
| 零结果 | 显示空状态插画 + "没找到相关包，确认关键字？" + 快捷链接 `https://www.google.com/search?q=maven%20<keyword>` |
| 模式 B 搜索词为空 | 显示"请先输入要搜索的关键字" + 备用搜索框（指向模式 A） |
| 解析失败（仅空格/非法字符） | 搜索按钮禁用，placeholder 引导 |
| 版本列表过大 | 截断 200 + "加载更多" |

### 失败错误详情（开发者）

请求失败时，UI 底部出现灰色 "查看错误详情 ▾"（可折叠）。展开后展示：
- 请求 URL、HTTP 状态码、耗时
- Solr `responseHeader` 或 GraphQL `errors[]` 原始 JSON
- 异常 message / stack 前 5 行
- "复制错误信息" 按钮

### Solr → GraphQL 降级流程（纯网络层，缓存由调用方负责）

```
mavenSearch(query: ParsedQuery)
  ├─ query.kind === 'rawQuery' → Solr fetch (timeout 5s)
  │                              ├─ 2xx & 有数据 → 返回
  │                              ├─ 2xx & 0 结果 → 返回空数组
  │                              └─ 失败 → 抛错 "请简化查询"（不降级）
  ├─ Solr fetch (timeout 5s)
  │   ├─ 2xx & 有数据 → 返回
  │   ├─ 2xx & 0 结果 → 返回空数组（不降级——避免 GraphQL 误命中无关结果）
  │   └─ 4xx/5xx/timeout → 降级 ↓
  ├─ GraphQL fetch (timeout 5s)
  │   ├─ 2xx & 有数据 → 字段映射 → 返回
  │   └─ 失败 → 抛错
  └─ 调用方 catch → showNotification + 错误详情展开
```

**调用方（组件）缓存流程**：

```
component.onSearch(query):
  entry = cache.getSearch(keyOf(query))
  if entry: use entry
  else:
    try:
      data = await window.services.mavenSearch(query)
      entry = { data, source: <'solr' | 'graphql' 由组件根据 metadata 标记> }
      cache.setSearch(keyOf(query), entry)
      use entry
    catch err:
      showNotification(...)
      showErrorDetails(err)
```

> 注：组件需在调用 `services.mavenSearch` 后判断 source——可在 services 返回的元数据中携带（如 `{ data: MavenArtifact[], source: 'solr' | 'graphql' }`）。spec 接受 services 返回 `{ data, source }` 而非裸数组。

## 11. 暗夜模式

### 主题源（统一承诺）

- **权威源**：`ztools.isDarkColors()`（仅一次性读取，**ZTools 不向 webview 广播主题变更**）
- **兜底**：开发模式或宿主未暴露时用 `matchMedia('(prefers-color-scheme: dark)')`
- **响应式行为**：宿主不广播主题变化，**用户在 ZTools 中途切换主题后，必须重新进入插件面板才能生效**（详见 §16 关键边界）
- `useTheme.ts` 在 `onMounted` 时调用一次 `apply()`，不再注册任何监听器

### 应用方式

`<html data-theme="dark|light">` + CSS 变量覆盖：

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-hover: #ececec;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --text-muted: #999999;
  --border: #e0e0e0;
  --accent: #0066cc;
  --accent-hover: #0052a3;
  --status-stable: #2e7d32;
  --status-snapshot: #f57c00;
  --status-alpha: #d32f2f;
  --status-beta: #7b1fa2;
  --error-bg: #fff3f3;
  --error-border: #ffcdd2;
  --shadow: rgba(0, 0, 0, 0.08);
}

[data-theme="dark"] {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2a2a2a;
  --bg-hover: #353535;
  --text-primary: #e6e6e6;
  --text-secondary: #a0a0a0;
  --text-muted: #707070;
  --border: #3a3a3a;
  --accent: #4d9fff;
  --accent-hover: #6cb1ff;
  --status-stable: #66bb6a;
  --status-snapshot: #ffa726;
  --status-alpha: #ef5350;
  --status-beta: #ab47bc;
  --error-bg: #2d1f1f;
  --error-border: #5a2828;
  --shadow: rgba(0, 0, 0, 0.4);
}

@media (prefers-color-scheme: dark) {
  :root { /* 同 dark 变量集，作为首屏兜底 */ }
}
```

### 原则

- 所有颜色用变量，禁止硬编码
- SVG 用 `currentColor`
- 状态色"颜色 + 文字"双通道（色盲友好）
- WCAG AA 对比度：深色正文 ≥ 4.5:1，状态色 ≥ 3:1

## 12. 键盘快捷键

仅在插件面板内生效，不污染全局。**Mode 列说明**：A = 仅 `maven-ui` 生效；B = 仅 `maven-search` 生效；All = 两者都生效。

| 按键 | Mode | 上下文 | 行为 |
|---|---|---|---|
| `/` | All | 任意 | 聚焦主输入框（清空已有内容） |
| `Enter` | All | 主输入框 | 触发搜索 |
| `↑` / `↓` | All | 结果列表 | 上下移动选中行 |
| `→` / `←` | All | 结果列表 | 切换聚焦到/回到版本列表 |
| `Enter` | All | 结果列表 | 进入该包的版本面板（同时拉历史版本） |
| `↑` / `↓` | All | 版本列表 | 上下移动选中版本 |
| `Enter` | A | 版本列表 | **弹出操作菜单**（焦点默认在"复制 XML"） |
| `c` | A | 版本列表 | **弹出操作菜单**（焦点默认在"复制 XML"），等同于 Enter |
| `g` | A | 版本列表 | 跳过菜单，直接复制 Gradle 坐标 |
| `u` | A | 版本列表 | 跳过菜单，直接复制 JAR URL |
| `Enter` | B | 版本列表 | 直接默认复制 `<dependency>` + 自动粘贴 + 隐藏主窗口 |
| `c` / `g` / `u` | B | 版本列表 | **等同于 Enter**（快速模式不区分格式，统一默认复制） |
| `Esc` | All | 任意（菜单打开时优先） | 关闭菜单 / 隐藏主窗口 |
| `Tab` / `Shift+Tab` | A | 操作菜单 | 切换菜单按钮焦点 |
| `Enter` | A | 操作菜单 | 确认当前焦点按钮 |
| `Cmd/Ctrl + K` | All | 任意 | 显示/隐藏快捷键帮助浮层 |

### 模式 B 简化说明

`maven-search` 的设计目标是"最少击键完成复制"，因此模式 B 中所有版本列表快捷键（`Enter` / `c` / `g` / `u`）**统一触发默认复制**（`<dependency>` XML，无 scope/classifier/optional，`shouldPaste: true`）。菜单在模式 B 中**不渲染**。

输入框聚焦时不拦截原生 `Enter` / `↑` / `↓`；用 `event.target` + `stopPropagation` 防止穿透。

## 13. 测试策略

### 单测（Vitest，目标 100% 覆盖 `src/lib/`）

`src/lib/` 纯函数目标 100% 行/分支覆盖；组件/集成/E2E 不追求 100%，按 ≥ 80% 覆盖为基线。

| 模块 | 用例 |
|---|---|
| `search-parser.ts` | 单自由词 / `g:a:b` / `org.x:y` / 字段前缀 / 空格归一化 / 全空 / 多余分隔符 / 含 `AND` 走 rawQuery / 含括号走 rawQuery |
| `version-tag.ts` | `6.0.0` / `6.0.0-SNAPSHOT` / `1.0.0-alpha` / `2.0.0.Beta` / LATEST 判定（timestamp>0）/ 去重（`1.0.0` vs `1.0.0.RELEASE`）/ timestamp 格式化 |
| `pom-builder.ts` | 必填三件套 / scope / classifier / optional / 全组合 / XML 转义 |

### 集成测试（mock 网络）

- `services.mavenSearch`：Solr 200 / Solr 500 降级 GraphQL / GraphQL 失败 / rawQuery 不降级 / 429 重试 / timeout / 返回值带 source 标记
- `services.mavenVersions`：gav core 正常 / 空结果 / 分页
- 缓存（`useMavenCache`）：归一化命中 / 不同 key / 卸载即清 / source 字段正确填充

### 组件测试（Vue Test Utils + jsdom）

- `MavenUiPanel`：输入触发防抖搜索 / 点击结果拉版本 / 键盘导航 / Enter 复制 / 错误详情展开
- `MavenSearchPanel`：挂载即读 `LaunchParam.payload` / payload 空提示 / 默认复制路径

### E2E（Playwright + `vite dev`）

跑一条 happy path：搜索 `spring-core` → 点第一条 → 选版本 `6.0.0` → 校验剪贴板内容。

**Stub 决策**：组件测试（Vitest/jsdom）与 E2E（Playwright）共享 `tests/helpers/ztools-stub.ts`，导出 `installZtoolsStub()`：
- 注入 `window.services`（含 `mavenSearch` / `mavenVersions`，默认返回空 + 可注入 mock）
- 注入 `window.ztools`（含 `clipboard.writeContent`、`showNotification`、`isDarkColors`、`hideMainWindow`、`onPluginEnter`、`setSubInput`）
- 组件测试在 `setup()` 中调用；E2E 在 Playwright `addInitScript` 中调用
- **不** stub `copyText`——spec 已统一为 `clipboard.writeContent`，stub 也保持一致

实现计划阶段不再决定 stub 结构——直接复用本文件。

### 不做的

- ❌ 视觉回归测试（主题差异大，截图断言易脆）
- ❌ 真实 API 快照测试（外部数据不稳定）
- ❌ 压力测试

## 14. 不实现（YAGNI）

- ❌ 私有仓库（Nexus / Artifactory）配置
- ❌ JAR 包下载
- ❌ Gradle 输出作为默认（仅快捷键 `g` 支持）
- ❌ JAR `pom.xml` / `aar`（Android）URL 输出（v1 仅 main JAR）
- ❌ 持久化缓存、收藏、历史搜索
- ❌ 依赖冲突分析
- ❌ 主题手动切换开关 / 实时主题更新
- ❌ 真实 API key 认证
- ❌ i18n 国际化（v1 字符串硬编码 zh-CN）

## 15. 文件结构（最终）

```
ztools-maven/
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-08-14-ztools-maven-design.md   (本文件)
├── public/
│   ├── plugin.json                                   (新增两个 feature)
│   ├── logo.png
│   ├── preload/
│   │   ├── package.json
│   │   └── services.js                              (+ mavenSearch / mavenVersions;剪贴板由组件直接调 window.ztools.clipboard)
│   └── index.html
├── src/
│   ├── main.ts
│   ├── main.css                                      (+ CSS 变量集 + 暗色媒体查询)
│   ├── App.vue                                       (+ 两个新路由)
│   ├── env.d.ts
│   ├── lib/                                          (新增目录)
│   │   ├── search-parser.ts
│   │   ├── version-tag.ts
│   │   ├── pom-builder.ts
│   │   ├── useTheme.ts
│   │   └── types.ts
│   ├── MavenUi/                                      (新增)
│   │   └── index.vue
│   ├── MavenSearch/                                  (新增)
│   │   └── index.vue
│   ├── Hello/                                        (保留示例)
│   ├── Read/
│   └── Write/
├── tests/                                            (新增)
│   ├── unit/
│   │   ├── search-parser.spec.ts
│   │   ├── version-tag.spec.ts
│   │   └── pom-builder.spec.ts
│   ├── integration/
│   │   └── services.spec.ts
│   ├── component/
│   │   ├── MavenUi.spec.ts
│   │   └── MavenSearch.spec.ts
│   └── e2e/
│       └── happy-path.spec.ts
├── index.html
├── package.json                                      (+ vitest / @vue/test-utils / playwright)
├── vite.config.js
├── tsconfig.json
└── README.md
```

## 16. 关键边界

- ZTools 主题切换中途**不会自动更新**插件主题——需重新进入面板（`isDarkColors` 是 one-shot API，无变更事件）
- Solr `core=gav` 单次最多 200 条；超出需手动"加载更多"
- 模式 B 的 `over` cmd：`minLength: 1` / `maxLength: 200`——输入超过 200 字符时 ZTools 不触发本 feature（静默忽略，宿主行为），不展示提示
- 网络层全部在 Node Preload，避免 CORS 与浏览器限流差异
- `rawQuery` 模式（Solr 原生语法）不降级 GraphQL——GraphQL schema 不支持 Solr 操作符；失败时提示用户简化查询
- 模式 B 不渲染操作菜单；`Enter` / `c` / `g` / `u` 在模式 B 中均触发默认复制（详见 §12）
