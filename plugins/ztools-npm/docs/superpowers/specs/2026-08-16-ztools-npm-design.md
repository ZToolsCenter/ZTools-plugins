# ztools-npm「Npm Lite」设计文档

> 日期：2026-08-16
> 参照工程：`../ztools-maven`（架构对齐）
> 状态：已确认范围，待实现

## 1. 背景与目标

`public/plugin.json` 声明了一个真正的「Npm Lite」插件：**NPM 包检索、安装指令复制、使用指南查看、技能沉淀**。但当前 `features` 仍是模板占位（hello/read/write），`src/` 也只有三个示例组件。

本工程目标：**把占位模板替换为完整的 npm 工具**，严格仿照 `../ztools-maven` 的架构：

- 主面板检索（`npm-ui`）→ 版本列表 → README 使用指南（三级面板）
- 快捷搜索复制（`npm-search`，over 指令触发）
- 镜像源设置弹窗（`NpmSettings`）
- 预置 Skills 技能库（**仅预置模板**，不做用户自定义动态注册，不调用 `setFeature`）

已确认的决策：

- 数据源：**双源聚合**（官方 `registry.npmjs.org` + 国内 `registry.npmmirror.com`），用 **Tabs 切换**（全部 / npm / npmmirror），对齐 maven 的三源 Tab 交互。
- preload 位置：**根目录 `preload.js`**（对齐 maven），build 脚本手动复制进 `dist/`。
- Skills：仅预置 7 个模板，每个模板是 `plugin.json` 里的一个独立 feature，从搜索框直接触发；另有 `npm-skills` 技能库浏览入口。

## 2. plugin.json（重写）

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "ztools-npm",
  "title": "Npm Lite",
  "description": "一款面向前端与 Node.js 开发者的轻量级效率工具。它集成了 NPM 包检索、安装指令复制以及使用指南查看功能，让依赖管理不再依赖浏览器。插件不仅能帮助开发者快速获取安装命令，更内置了一套 Npm 常用技能模板，将常用的命令模式、配置技巧沉淀为可复用的知识库，助您在开发中事半功倍。",
  "author": "康康学长",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload.js",
  "logo": "logo.png",
  "development": { "main": "http://localhost:5173" },
  "features": [
    { "code": "npm-ui",     "explain": "Npm 包检索与安装",      "icon": "logo.png", "cmds": ["npm", "node"] },
    {
      "code": "npm-search", "explain": "快速复制 npm 安装指令",  "icon": "logo.png", "mainHide": true,
      "cmds": [{ "type": "over", "label": "搜索 npm 包", "minLength": 1, "maxLength": 200 }]
    },
    { "code": "npm-skills", "explain": "Npm 常用技能库",         "icon": "logo.png", "cmds": ["技能库", "npm 技能"] },
    { "code": "npm-skill-init",    "explain": "初始化 npm 项目", "icon": "logo.png", "cmds": ["npm init", "初始化项目"] },
    { "code": "npm-skill-install", "explain": "安装 npm 依赖",   "icon": "logo.png", "cmds": ["npm install", "安装依赖"] },
    { "code": "npm-skill-run",     "explain": "运行 npm 脚本",   "icon": "logo.png", "cmds": ["npm run", "运行脚本"] },
    { "code": "npm-skill-update",  "explain": "更新 npm 依赖",   "icon": "logo.png", "cmds": ["npm update", "更新依赖"] },
    { "code": "npm-skill-publish", "explain": "发布 npm 包",     "icon": "logo.png", "cmds": ["npm publish", "发布 npm 包"] },
    { "code": "npm-skill-create",  "explain": "创建脚手架项目",  "icon": "logo.png", "cmds": ["npm create", "脚手架"] },
    { "code": "npm-skill-global",  "explain": "全局安装 CLI",    "icon": "logo.png", "cmds": ["npm -g", "全局安装"] }
  ]
}
```

## 3. 目录结构

```
ztools-npm/
├── plugin.json            # 重写（features 如上）
├── preload.js             # 由 public/preload/services.js 迁移到根目录；删除 public/preload/
├── index.html             # 不变
├── vite.config.js         # 不变（base: './'）
├── tsconfig.json          # 不变
├── package.json           # 更新 scripts/devDeps
├── src/
│   ├── App.vue            # 路由：npm-ui / npm-search / npm-skills / npm-skill-*
│   ├── main.ts            # 不变
│   ├── main.css           # 替换为 maven 版深浅主题 CSS 变量
│   ├── env.d.ts           # 重写：window.services 类型 + Vue shim
│   ├── NpmUi/             # 主检索面板
│   ├── NpmQuick/          # 快捷复制面板（over 触发）
│   ├── NpmSettings/       # 镜像源设置弹窗
│   ├── SkillView/         # 技能详情（渲染 skills.ts 中的模板）
│   └── lib/
│       ├── types.ts
│       ├── useTheme.ts            # 移植 maven
│       ├── useNpmCache.ts         # 搜索/元数据缓存
│       ├── search-parser.ts       # @scope/pkg、name@ver、自由文本
│       ├── version-tag.ts         # stable/rc/beta/alpha/dev + dist-tag
│       ├── command-builder.ts     # npm/pnpm/yarn/-D/-g 安装指令
│       ├── markdown.ts            # 轻量 Markdown → 安全 HTML
│       └── skills.ts              # 7 个预置模板数据 + getSkill(code)
├── public/
│   ├── logo.png           # 不变
│   └── plugin.json        # 与根 plugin.json 一致（Vite 输入）
├── tests/                 # vitest：unit + component
└── docs/superpowers/specs/2026-08-16-ztools-npm-design.md
```

> `public/plugin.json` 与根 `plugin.json` 保持内容一致（maven 项目里两者一致，plugin.json 是发布时打包装入，public/plugin.json 是 Vite 输出）。

## 4. 数据源与 preload 服务

### 4.1 双源聚合

| 数据源 | Base | 说明 |
|---|---|---|
| npm 官方 | `https://registry.npmjs.org` | 全球权威 |
| npmmirror | `https://registry.npmmirror.com` | 国内镜像，快速稳定 |

- 搜索：`GET <base>/-/v1/search?text=<q>&size=20`
  - 响应 `objects[].package`：`{ name, version, description, keywords, date, links, publisher }`
  - 两个源 `Promise.allSettled` 并行；单源失败仅 `console.warn`，不影响另一源。
  - 按 `name` 去重，保留信息更全/时间更新的条目；`source: 'npm' | 'npmmirror'` 标签。
- 元数据（版本/时间/readme）：`GET <base>/<name>`（scoped 名编码：`@scope%2Fpkg`）
  - `versions`（对象键）→ 版本列表；`time.<version>` → 发布时间；`dist-tags` → latest/next/beta 等标签；`readme` → 使用指南（markdown）；`license / homepage / repository`。
  - 版本列表**按所选包的来源获取**（npm 包从官方取，npmmirror 包从镜像取），对齐 maven「Solr 查版本」。
- 超时 5s，AbortController；错误统一 `ServiceError`（`url / status / durationMs / body`），对齐 maven。

### 4.2 preload.js 导出服务

```js
window.services = {
  npmSearch(query),          // 双源聚合搜索
  npmMeta(name, source),     // 包元数据（版本 + readme）
  setRegistry(url),          // 覆盖 npmmirror 基地址（设置弹窗）
  getRegistry(),
}
```

- 启动时设置 `User-Agent`（`window.ztools?.http?.setHeaders`，可选链）。
- 无代理需求（npm 官方/镜像对国内均可直连，npmmirror 为默认国内源）；设置弹窗只管理「自定义镜像基地址」。

## 5. UI 组件设计

### 5.1 App.vue 路由

```vue
<NpmUi     v-if="!route || route === 'npm-ui'"          :enter-action="enterAction" />
<NpmQuick  v-else-if="route === 'npm-search'"           :enter-action="enterAction" />
<SkillsLib v-else-if="route === 'npm-skills'"           />
<SkillView v-else-if="route.startsWith('npm-skill-')"   :code="route" />
<NpmUi     v-else                                       :enter-action="enterAction" />
```

- `window.ztools` 不存在时（浏览器预览）安全退出，不抛错（对齐 maven 的 guard）。

### 5.2 NpmUi（主检索面板）

三级面板 + 两个覆盖层，全部镜像 MavenUi 的交互模式：

1. **结果列表（一级）**
   - 顶部：搜索提示 + 「技能库」入口 + 设置按钮
   - 数据源 Tabs：`全部 / npm / npmmirror`（带计数；用户选择持久化到 `dbStorage`）
   - 行：包名（等宽）、最新版本、一行描述、来源标签、快捷复制提示（`n npm / p pnpm / y yarn / Enter 进入`）
   - 空态：`没找到相关包` + 百度搜索链接；加载中提示；错误详情可折叠可复制
2. **版本列表（二级）**
   - 返回按钮 + 包名 + 快捷键提示
   - 行：版本号、发布时间（YYYY-MM）、状态标签、`LATEST` 徽章（dist-tag latest）
   - 版本过多时分页（200 条一页「加载更多」，对齐 maven）
   - 按钮「查看使用指南」进入 README 视图
3. **README 使用指南（三级）**
   - `markdown.ts` 渲染为安全 HTML（`v-html`），等宽代码块高亮化
   - 操作：复制 `npm install`、复制 README 纯文本、返回

**复制菜单（Mode A）**：`Enter / c` 打开，选项为 npm / pnpm / yarn 三种安装指令。

### 5.3 NpmQuick（快捷复制面板）

镜像 MavenSearch（Mode B）：over 选中文本 → 自动搜索 → 列表 → `Enter` 复制 `npm install <name>@<latest>`；`n/p/y` 切换包管理器。错误框、帮助覆盖层与 maven 一致。

### 5.4 NpmSettings（设置弹窗）

镜像 MavenSettings：`自定义镜像源`（覆盖 npmmirror 基地址，留空回默认），保存/恢复默认/取消，状态提示，`dbStorage` 持久化。

### 5.5 SkillsLib / SkillView（技能库）

- `npm-skills` → SkillsLib：网格/列表展示 7 个模板（标题 + 描述 + 触发指令），点选 → SkillView。
- `npm-skill-*` → SkillView：直接渲染对应模板的用法详情。
- SkillView 内容来自 `skills.ts`：标题、描述、命令块（含注释）、技巧清单、配置代码（`.npmrc` 等），每个命令块可一键复制。

### 5.6 快捷键（对齐 maven）

| 按键 | 一级结果 | 二级版本 | README | 说明 |
|---|---|---|---|---|
| `↑`/`↓` | 移动 | 移动 | 滚动 | — |
| `←`/`→` | 切换数据源 Tab | `←` 返回结果 | — | — |
| `Enter` | 进入版本面板（或一级直接复制） | 打开复制菜单 | — | 复制菜单：npm/pnpm/yarn |
| `n`/`p`/`y` | 复制 npm/pnpm/yarn | 复制 npm/pnpm/yarn | — | 一级有最新版信息即可直接复制 |
| `r` | — | 查看使用指南 | — | — |
| `Esc` | 隐藏窗口 | 返回/退出 | 返回 | — |
| `Cmd/Ctrl+K` | 帮助覆盖层 | 帮助覆盖层 | — | — |
| `/` | 聚焦搜索 | — | — | — |

> 快捷约定：`n` = npm、`p` = pnpm、`y` = yarn（记忆点：首字母）；`Enter`/`c` 打开复制菜单，避免 `p` 同时承担「菜单」与「pnpm」两个职责。

复制后：`clipboard.writeContent({ type:'text', content, shouldPaste:true })` + `showNotification` + `hideMainWindow()`（对齐 maven `copyContent`）。

## 6. 数据模型（lib/types.ts）

```ts
export type NpmSource = 'npm' | 'npmmirror'

export interface NpmPackage {
  id: string              // 包名
  name: string
  version: string         // latest version
  description: string
  keywords?: string[]
  date?: string
  source?: NpmSource
}

export interface NpmVersion {
  v: string
  time?: number           // ms epoch
  status: VersionStatus
  isLatest: boolean
  isDistTag?: boolean     // 出现在 dist-tags 中
}

export type VersionStatus = 'stable' | 'rc' | 'beta' | 'alpha' | 'dev'

export type ParsedQuery =
  | { kind: 'freeText'; text: string }
  | { kind: 'package'; name: string; versionPrefix?: string }

export interface NpmSkill {
  code: string
  title: string
  cmds: string[]
  description: string
  commands: { cmd: string; comment?: string }[]
  tips?: string[]
  config?: { title: string; code: string }[]
}
```

## 7. lib 纯函数设计

- **search-parser.ts**：`parseSearch(input)` → `ParsedQuery`
  - 空 → freeText ''
  - `@scope/name`（以 `@` 开头且仅一个 `@`）→ package，整串为包名
  - `name@version`（含 `@` 且不以 `@` 开头）→ package + versionPrefix（支持 `name@1`、`name@^1.2`、`@scope/name@2`）
  - 其余 → freeText
- **version-tag.ts**：`tagVersion(v)` 分段识别 `rc/beta/alpha/canary/next/dev/nightly/insiders/experimental/snapshot`（`+build` 元数据不参与分类）；`pickLatest`、`dedupeVersions`（按 `+build` 元数据去重，`1.0.0` 与 `1.0.0+build.2` 合并取新——npm 的 `-dev.N` 等预发布各是独立发布版本，不合并）、`formatTimestamp(YYYY-MM)`；dist-tag `latest` → `isLatest`（`applyDistTags` 与 dedupe 一致地剥离 `+build` 后匹配）。
- **command-builder.ts**：
  - `buildInstallCommand({name, version}, manager, {dev?, global?})`
    - npm：`npm install <name>@<version>` / `npm install -D ...` / `npm install -g <name>`
    - pnpm：`pnpm add <name>@<version>`
    - yarn：`yarn add <name>@<version>`
  - 无版本时省略 `@<version>`（如全局安装、快捷复制 latest）。
- **markdown.ts**：`renderMarkdown(src) → string`
  - 覆盖：标题（#~##）、围栏代码块（```）、行内代码、粗体/斜体、链接、有序/无序列表、引用、分隔线、表格（尽量）
  - **先转义所有 HTML，再转换 markdown 语法** → 输出可安全 `v-html`，无 XSS 注入面。
- **useNpmCache.ts**：`createNpmCache()` / `useNpmCache()`，`getSearch/setSearch/getMeta/setMeta`，key 规整化 trim，实例绑定组件生命周期（对齐 maven）。
- **skills.ts**：`SKILL_TEMPLATES: NpmSkill[]`（7 个，含命令/技巧/.npmrc 配置），`getSkill(code): NpmSkill | undefined`。

## 8. 测试计划（vitest + jsdom）

- **单元**（tests/unit）：
  - `search-parser`：`vue`→freeText；`@vue/cli`→package；`lodash@4`→package+vPrefix；`@scope/pkg@2`→package；边界（空、多余 `@`）
  - `version-tag`：rc/beta/alpha/canary/next/dev 归类；dedupe 合并；pickLatest 选最新时间；formatTimestamp
  - `command-builder`：npm/pnpm/yarn、`-D`、`-g`、scoped 名、无版本省略
  - `markdown`：标题/代码块/行内码/列表/链接；**HTML 注入被转义**
  - `skills`：7 个模板 code 唯一、与 plugin.json features 一致、commands/cmds 非空
- **组件**（tests/component）：
  - `NpmQuick`：注入 mock services → 搜索渲染列表 → Enter 复制调用 `clipboard.writeContent`
  - `SkillView`：给定 code 渲染对应标题与命令块
- **不做**：Playwright E2E（npm 工程未配置，需 ZTools 宿主环境，YAGNI）。

## 9. 构建与发布

`package.json`：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "rm -rf dist dist.zip && vue-tsc && vite build && cp preload.js dist/ && cd dist && zip -r ../dist.zip . && cd ..",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vue": "^3.5.13",
    "@vitejs/plugin-vue": "^5.2.1",
    "@ztools-center/ztools-api-types": "^1.0.1",
    "typescript": "^5.3.0",
    "vite": "^6.0.11",
    "vue-tsc": "^2.0.0",
    "vitest": "^2.1.0",
    "@vue/test-utils": "^2.4.6",
    "jsdom": "^25.0.0",
    "@types/node": "^22.0.0"
  }
}
```

`vite.config.js` 增加 `test` 配置（jsdom、globals、include `tests/**/*.spec.ts`），其余不变。

## 10. 交付物清单

- [ ] `plugin.json`（根 + public 同步）重写
- [ ] `preload.js`（根）双源聚合服务；删除 `public/preload/`
- [ ] `src/main.css` 深浅主题 CSS 变量
- [ ] `src/lib/*`（8 个模块）
- [ ] `src/NpmUi|NpmQuick|NpmSettings|SkillView|SkillsLib/index.vue`
- [ ] `src/App.vue`、`src/env.d.ts`
- [ ] 删除 `src/Hello|Read|Write`
- [ ] `tests/`（unit + component）
- [ ] `package.json` / `vite.config.js` 更新
- [ ] README.md 更新
- [ ] `npm install && npm test && npm run build` 全绿
