# ztools-npm「Npm Lite」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ztools-npm` 从模板占位（hello/read/write）改造成完整的「Npm Lite」工具：双源 npm 包检索、安装指令复制（npm/pnpm/yarn）、README 使用指南查看、预置技能模板库，架构对齐 `../ztools-maven`。

**Architecture:** 前端 Vue3+SFC 按路由（npm-ui / npm-search / npm-skills / npm-skill-*）切换；根目录 `preload.js` 提供双源聚合搜索与包元数据服务（`window.services`）；纯逻辑全部下沉到 `src/lib/*`（可单测）；样式复用 maven 的深浅主题 CSS 变量。

**Tech Stack:** Vue 3 · Vite 6 · TypeScript · Vitest · @vue/test-utils · jsdom

**Spec:** `docs/superpowers/specs/2026-08-16-ztools-npm-design.md`

## Global Constraints

- 工作目录：`/Users/kangshaoqi/自研项目/ztools 插件/ztools-npm`（已 `git init`，feature 分支 `feat/npm-lite`；每个任务完成后提交）
- 数据源基地址固定：官方 `https://registry.npmjs.org`、镜像默认 `https://registry.npmmirror.com`
- 版本分类 `VersionStatus = 'stable' | 'rc' | 'beta' | 'alpha' | 'dev'`
- 快捷键：`n`=npm、`p`=pnpm、`y`=yarn、`Enter`/`c`=打开复制菜单、`r`=查看使用指南、`Esc`=返回/隐藏、`Cmd/Ctrl+K`=帮助
- 所有 `window.ztools` / `window.services` 调用在非 ZTools 宿主（浏览器预览）下必须安全降级（可选链 / 判空），不得让整个组件树崩溃
- README 渲染必须**先转义 HTML 再转 markdown**，禁止把未转义内容塞进 `v-html`
- 包管理器指令：npm=`npm install`、pnpm=`pnpm add`、yarn=`yarn add`；开发依赖=`npm install -D`；全局=`npm install -g`/`pnpm add -g`/`yarn global add`
- 每次构建必须通过：`npm test`（vitest）+ `npm run build`（vue-tsc + vite + zip）

---

### Task 1: 工程脚手架与配置

**Files:**
- Modify: `package.json`（scripts + devDeps）
- Modify: `vite.config.js`（test 配置）
- Modify: `src/env.d.ts`（services 类型）
- Create: `src/main.css`（覆盖为 maven 版主题变量）
- 保留 `src/App.vue` / `src/Hello|Read|Write` 不动（Task 13 再清理）

**Interfaces:**
- Produces: 可 `npm install`、可 `npm test` 的最小可跑工程；`window.services` 的 TS 类型骨架

- [ ] **Step 1: 重写 package.json**

```json
{
  "name": "ztools-npm",
  "version": "1.0.0",
  "description": "一款面向前端与 Node.js 开发者的轻量级效率工具。它集成了 NPM 包检索、安装指令复制以及使用指南查看功能，让依赖管理不再依赖浏览器。插件不仅能帮助开发者快速获取安装命令，更内置了一套 Npm 常用技能模板，将常用的命令模式、配置技巧沉淀为可复用的知识库，助您在开发中事半功倍。",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "rm -rf dist dist.zip && vue-tsc && vite build && cp preload.js dist/ && cd dist && zip -r ../dist.zip . && cd ..",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "vue": "^3.5.13"
  },
  "devDependencies": {
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

- [ ] **Step 2: 重写 vite.config.js**

```js
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
})
```

- [ ] **Step 3: 覆盖 src/main.css 为 maven 版主题变量**

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
  --radius: 6px;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
}

@media (prefers-color-scheme: dark) {
  :root {
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
  }
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
}
button { font-family: inherit; cursor: pointer; }
```

- [ ] **Step 4: 重写 src/env.d.ts**

```ts
/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应根目录 preload.js）
interface Services {
  npmSearch(query: any): Promise<{ data: any[]; sources: { npm: any[]; npmmirror: any[] } }>
  npmMeta(name: string, source?: string): Promise<any>
  setRegistry(url: string): string
  getRegistry(): string
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
```

- [ ] **Step 5: 安装依赖**

Run: `npm install`
Expected: 成功，`node_modules/@ztools-center/ztools-api-types` 存在

- [ ] **Step 6: 验证类型可通过**

Run: `npx vue-tsc --noEmit`
Expected: 退出码 0（App.vue 仍引用 Hello/Read/Write 占位组件，未受影响）

> 说明：`npm run build` 里的 `cp preload.js dist/` 在 Task 8 之后才会成功；当前阶段用 `vue-tsc --noEmit` 验证类型即可。

---

### Task 2: 基础模块 + plugin.json 重写

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/useTheme.ts`
- Create: `src/lib/useNpmCache.ts`
- Create: `plugin.json`（重写）
- Create: `public/plugin.json`（与根一致）
- Delete: `public/preload/`（目录整体删除）

**Interfaces:**
- Produces: `types.ts` 导出 `NpmSource / NpmPackage / NpmVersion / VersionStatus / ParsedQuery / NpmSkill / NpmMeta / PackageManager`；`useTheme()`；`useNpmCache()` 导出 `getSearch/setSearch/getMeta/setMeta`

- [ ] **Step 1: 创建 src/lib/types.ts**

```ts
// 双源标识
export type NpmSource = 'npm' | 'npmmirror'

// 搜索结果包
export interface NpmPackage {
  id: string
  name: string
  version: string          // latest version
  description: string
  keywords?: string[]
  date?: string
  source?: NpmSource
}

// 单个版本（版本面板行）
export interface NpmVersion {
  v: string
  time?: number            // ms epoch
  status: VersionStatus
  isLatest: boolean
  isDistTag?: boolean
}

export type VersionStatus = 'stable' | 'rc' | 'beta' | 'alpha' | 'dev'

// 解析后的搜索意图
export type ParsedQuery =
  | { kind: 'freeText'; text: string }
  | { kind: 'package'; name: string; versionPrefix?: string }

// 包元数据（npmMeta 返回）
export interface NpmMeta {
  name: string
  description: string
  distTags: Record<string, string>
  versions: { v: string; time?: number }[]
  readme?: string
  license?: string
  homepage?: string
  repository?: string
}

// 技能模板
export interface NpmSkill {
  code: string
  title: string
  cmds: string[]
  description: string
  commands: { cmd: string; comment?: string }[]
  tips?: string[]
  config?: { title: string; code: string }[]
}

// 包管理器
export type PackageManager = 'npm' | 'pnpm' | 'yarn'
```

- [ ] **Step 2: 创建 src/lib/useTheme.ts（移植 maven）**

```ts
export function detectDark(): boolean {
  if (typeof window !== 'undefined' && (window as any).ztools?.isDarkColors) {
    return !!(window as any).ztools.isDarkColors()
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return true
  }
  return false
}

export function applyTheme(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = detectDark() ? 'dark' : 'light'
}

export function useTheme() {
  applyTheme()
}
```

- [ ] **Step 3: 创建 src/lib/useNpmCache.ts**

```ts
import type { NpmPackage, NpmMeta } from './types'

export interface NpmCache {
  getSearch(key: string): { data: NpmPackage[] } | null
  setSearch(key: string, entry: { data: NpmPackage[] }): void
  getMeta(key: string): NpmMeta | null
  setMeta(key: string, meta: NpmMeta): void
}

export function createNpmCache(): NpmCache {
  const searchCache = new Map<string, { data: NpmPackage[] }>()
  const metaCache = new Map<string, NpmMeta>()
  const trim = (k: string) => k.trim()
  return {
    getSearch(key) { return searchCache.get(trim(key)) ?? null },
    setSearch(key, entry) { searchCache.set(trim(key), entry) },
    getMeta(key) { return metaCache.get(trim(key)) ?? null },
    setMeta(key, meta) { metaCache.set(trim(key), meta) },
  }
}

export function useNpmCache(): NpmCache {
  return createNpmCache()
}
```

- [ ] **Step 4: 重写 plugin.json（根）**

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
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    { "code": "npm-ui", "explain": "Npm 包检索与安装", "icon": "logo.png", "cmds": ["npm", "node"] },
    {
      "code": "npm-search",
      "explain": "快速复制 npm 安装指令",
      "icon": "logo.png",
      "mainHide": true,
      "cmds": [{ "type": "over", "label": "搜索 npm 包", "minLength": 1, "maxLength": 200 }]
    },
    { "code": "npm-skills", "explain": "Npm 常用技能库", "icon": "logo.png", "cmds": ["技能库", "npm 技能"] },
    { "code": "npm-skill-init", "explain": "初始化 npm 项目", "icon": "logo.png", "cmds": ["npm init", "初始化项目"] },
    { "code": "npm-skill-install", "explain": "安装 npm 依赖", "icon": "logo.png", "cmds": ["npm install", "安装依赖"] },
    { "code": "npm-skill-run", "explain": "运行 npm 脚本", "icon": "logo.png", "cmds": ["npm run", "运行脚本"] },
    { "code": "npm-skill-update", "explain": "更新 npm 依赖", "icon": "logo.png", "cmds": ["npm update", "更新依赖"] },
    { "code": "npm-skill-publish", "explain": "发布 npm 包", "icon": "logo.png", "cmds": ["npm publish", "发布 npm 包"] },
    { "code": "npm-skill-create", "explain": "创建脚手架项目", "icon": "logo.png", "cmds": ["npm create", "脚手架"] },
    { "code": "npm-skill-global", "explain": "全局安装 CLI", "icon": "logo.png", "cmds": ["npm -g", "全局安装"] }
  ]
}
```

- [ ] **Step 5: 复制为 public/plugin.json 并删除 public/preload/**

Run: `cp plugin.json public/plugin.json && rm -rf public/preload`
Expected: `public/` 下只剩 `logo.png` 和 `plugin.json`

- [ ] **Step 6: 验证**

Run: `npx vue-tsc --noEmit`
Expected: 退出码 0（占位组件仍被 App.vue 引用，不受影响）

---

### Task 3: search-parser（TDD）

**Files:**
- Create: `src/lib/search-parser.ts`
- Create: `tests/unit/search-parser.spec.ts`

**Interfaces:**
- Consumes: `types.ts` 的 `ParsedQuery`
- Produces: `export function parseSearch(input: string): ParsedQuery`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { parseSearch } from '../../src/lib/search-parser'

describe('parseSearch', () => {
  it('空输入 → freeText 空串', () => {
    expect(parseSearch('')).toEqual({ kind: 'freeText', text: '' })
    expect(parseSearch('   ')).toEqual({ kind: 'freeText', text: '' })
  })
  it('普通词 → freeText', () => {
    expect(parseSearch('vue')).toEqual({ kind: 'freeText', text: 'vue' })
    expect(parseSearch('  react hooks ')).toEqual({ kind: 'freeText', text: 'react hooks' })
  })
  it('scoped 包名（单个 @）→ package 且整串为包名', () => {
    expect(parseSearch('@vue/cli')).toEqual({ kind: 'package', name: '@vue/cli' })
  })
  it('name@version → package + versionPrefix', () => {
    expect(parseSearch('lodash@4')).toEqual({ kind: 'package', name: 'lodash', versionPrefix: '4' })
    expect(parseSearch('lodash@^4.0')).toEqual({ kind: 'package', name: 'lodash', versionPrefix: '^4.0' })
  })
  it('name@（空版本）→ 去掉版本前缀', () => {
    expect(parseSearch('lodash@')).toEqual({ kind: 'package', name: 'lodash' })
  })
  it('scoped + 版本（两个 @）→ 在最后一个 @ 处拆分', () => {
    expect(parseSearch('@vue/cli@5')).toEqual({ kind: 'package', name: '@vue/cli', versionPrefix: '5' })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/search-parser.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
import type { ParsedQuery } from './types'

export function parseSearch(input: string): ParsedQuery {
  const trimmed = input.trim()
  if (trimmed === '') return { kind: 'freeText', text: '' }

  const atCount = [...trimmed].filter(c => c === '@').length
  if (atCount === 0) return { kind: 'freeText', text: trimmed }

  if (atCount === 1) {
    if (trimmed.startsWith('@')) return { kind: 'package', name: trimmed } // @scope/name
    const atIdx = trimmed.indexOf('@')
    const name = trimmed.slice(0, atIdx).trim()
    const versionPrefix = trimmed.slice(atIdx + 1).trim()
    return versionPrefix ? { kind: 'package', name, versionPrefix } : { kind: 'package', name }
  }

  // >= 2 个 @：scoped 包名 + 版本，在最后一个 @ 处拆分
  const atIdx = trimmed.lastIndexOf('@')
  const name = trimmed.slice(0, atIdx).trim()
  const versionPrefix = trimmed.slice(atIdx + 1).trim()
  return versionPrefix ? { kind: 'package', name, versionPrefix } : { kind: 'package', name }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/search-parser.spec.ts`
Expected: PASS（8 个用例）

- [ ] **Step 5: 记录完成**（无 git）

---

### Task 4: version-tag（TDD）

**Files:**
- Create: `src/lib/version-tag.ts`
- Create: `tests/unit/version-tag.spec.ts`

**Interfaces:**
- Consumes: `types.ts` 的 `NpmVersion / VersionStatus`
- Produces: `tagVersion(v: string): VersionStatus`、`pickLatest(versions): NpmVersion | null`、`dedupeVersions(versions): NpmVersion[]`、`formatTimestamp(ts: number): string`、`applyDistTags(versions, distTags): NpmVersion[]`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { tagVersion, pickLatest, dedupeVersions, formatTimestamp, applyDistTags } from '../../src/lib/version-tag'
import type { NpmVersion } from '../../src/lib/types'

const V = (v: string, time = 0): NpmVersion => ({ v, time, status: 'stable', isLatest: false })

describe('tagVersion', () => {
  it('无后缀 → stable', () => {
    expect(tagVersion('1.0.0')).toBe('stable')
    expect(tagVersion('2.7.16')).toBe('stable')
  })
  it('rc → rc', () => {
    expect(tagVersion('3.6.0-rc.4')).toBe('rc')
  })
  it('beta / milestone → beta', () => {
    expect(tagVersion('3.6.0-beta.17')).toBe('beta')
    expect(tagVersion('0.12.0-beta1')).toBe('beta')
  })
  it('alpha → alpha', () => {
    expect(tagVersion('3.6.0-alpha.7')).toBe('alpha')
  })
  it('canary/next/dev/nightly/insiders → dev', () => {
    expect(tagVersion('1.0.0-canary.3')).toBe('dev')
    expect(tagVersion('1.0.0-next.1')).toBe('dev')
    expect(tagVersion('1.0.0-dev.1')).toBe('dev')
    expect(tagVersion('1.0.0-nightly.20240101')).toBe('dev')
  })
})

describe('dedupeVersions', () => {
  it('按 v 去重并合并时间，+build 元数据视为同版本', () => {
    const a = V('1.0.0', 100)
    const b = V('1.0.0+build.2', 200)
    const out = dedupeVersions([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].time).toBe(200)
  })
})

describe('pickLatest', () => {
  it('选 time 最大的版本，无 time 的跳过', () => {
    const list = [V('1.0.0', 0), V('1.1.0', 300), V('1.2.0', 200)]
    expect(pickLatest(list)?.v).toBe('1.1.0')
    expect(pickLatest([V('1.0.0', 0)])).toBeNull()
  })
})

describe('formatTimestamp', () => {
  it('输出 UTC YYYY-MM，无时间用 —', () => {
    expect(formatTimestamp(Date.parse('2024-03-05T00:00:00Z'))).toBe('2024-03')
    expect(formatTimestamp(0)).toBe('—')
  })
})

describe('applyDistTags', () => {
  it('latest 对应的版本标记 isLatest，其余 dist-tag 版本标记 isDistTag', () => {
    const list = [V('3.5.41'), V('3.6.0-beta.17'), V('3.6.0-alpha.7')]
    const out = applyDistTags(list, { latest: '3.5.41', beta: '3.6.0-beta.17' })
    expect(out.find(x => x.v === '3.5.41')?.isLatest).toBe(true)
    expect(out.find(x => x.v === '3.5.41')?.isDistTag).toBe(true)
    expect(out.find(x => x.v === '3.6.0-beta.17')?.isDistTag).toBe(true)
    expect(out.find(x => x.v === '3.6.0-alpha.7')?.isDistTag).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/version-tag.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
import type { NpmVersion, VersionStatus } from './types'

const QUALIFIER_GROUPS: [string[], VersionStatus][] = [
  [['canary', 'dev', 'nightly', 'insiders', 'experimental', 'snapshot', 'next', 'future'], 'dev'],
  [['alpha'], 'alpha'],
  [['beta', 'milestone'], 'beta'],
  [['rc'], 'rc'],
]

function classifyQualifier(seg: string): VersionStatus | null {
  const lower = seg.toLowerCase()
  for (const [keys, status] of QUALIFIER_GROUPS) {
    if (keys.some(k => lower === k || lower.startsWith(k))) return status
  }
  return null
}

export function tagVersion(v: string): VersionStatus {
  const segments = v.split(/[-.+]/)
  for (const seg of segments) {
    const status = classifyQualifier(seg)
    if (status) return status
  }
  return 'stable'
}

export function hasTimestamp(rec: NpmVersion): boolean {
  return (rec.time ?? 0) > 0
}

export function pickLatest(versions: NpmVersion[]): NpmVersion | null {
  let best: NpmVersion | null = null
  for (const v of versions) {
    if (!hasTimestamp(v)) continue
    if (!best || (v.time ?? 0) > (best.time ?? 0)) best = v
  }
  return best
}

// npm 语义化版本：剥离 +build 元数据后作为去重键（1.0.0 与 1.0.0+build.2 视为同一版本）
function canonicalize(v: string): string {
  return v.split('+')[0]
}

export function dedupeVersions(versions: NpmVersion[]): NpmVersion[] {
  const groups = new Map<string, NpmVersion>()
  for (const v of versions) {
    const key = canonicalize(v.v)
    const existing = groups.get(key)
    if (!existing || (v.time ?? 0) > (existing.time ?? 0)) {
      groups.set(key, { ...v, v: key })
    }
  }
  return Array.from(groups.values())
}

export function formatTimestamp(ts: number): string {
  if (ts <= 0) return '—'
  const d = new Date(ts)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

export function applyDistTags(versions: NpmVersion[], distTags: Record<string, string>): NpmVersion[] {
  const values = Object.values(distTags)
  const tagged = versions.map(v => ({
    ...v,
    isDistTag: values.includes(v.v),
  }))
  const latest = distTags.latest
  if (latest) {
    const idx = tagged.findIndex(v => v.v === latest)
    if (idx >= 0) tagged[idx] = { ...tagged[idx], isLatest: true }
  }
  return tagged
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/version-tag.spec.ts`
Expected: PASS（14 个用例）

- [ ] **Step 5: 记录完成**

---

### Task 5: command-builder（TDD）

**Files:**
- Create: `src/lib/command-builder.ts`
- Create: `tests/unit/command-builder.spec.ts`

**Interfaces:**
- Consumes: `types.ts` 的 `PackageManager`
- Produces: `buildInstallCommand(coord: { name: string; version?: string }, manager?: PackageManager, opts?: { dev?: boolean; global?: boolean }): string`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { buildInstallCommand } from '../../src/lib/command-builder'

describe('buildInstallCommand', () => {
  it('npm / pnpm / yarn 基础指令', () => {
    const c = { name: 'lodash', version: '4.17.21' }
    expect(buildInstallCommand(c, 'npm')).toBe('npm install lodash@4.17.21')
    expect(buildInstallCommand(c, 'pnpm')).toBe('pnpm add lodash@4.17.21')
    expect(buildInstallCommand(c, 'yarn')).toBe('yarn add lodash@4.17.21')
  })
  it('默认包管理器为 npm', () => {
    expect(buildInstallCommand({ name: 'vue', version: '3.5.41' })).toBe('npm install vue@3.5.41')
  })
  it('无版本时省略 @version', () => {
    expect(buildInstallCommand({ name: 'vue' }, 'npm')).toBe('npm install vue')
  })
  it('npm 开发依赖 -D', () => {
    expect(buildInstallCommand({ name: 'vite', version: '6.0.11' }, 'npm', { dev: true })).toBe('npm install -D vite@6.0.11')
  })
  it('全局安装', () => {
    expect(buildInstallCommand({ name: 'vue-cli' }, 'npm', { global: true })).toBe('npm install -g vue-cli')
    expect(buildInstallCommand({ name: 'vue-cli' }, 'pnpm', { global: true })).toBe('pnpm add -g vue-cli')
    expect(buildInstallCommand({ name: 'vue-cli' }, 'yarn', { global: true })).toBe('yarn global add vue-cli')
  })
  it('scoped 包名', () => {
    expect(buildInstallCommand({ name: '@vue/cli', version: '5.0.8' }, 'npm')).toBe('npm install @vue/cli@5.0.8')
    expect(buildInstallCommand({ name: '@scope/pkg' }, 'pnpm')).toBe('pnpm add @scope/pkg')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/command-builder.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
import type { PackageManager } from './types'

export interface Coord {
  name: string
  version?: string
}

export interface InstallOptions {
  dev?: boolean
  global?: boolean
}

export function buildInstallCommand(
  coord: Coord,
  manager: PackageManager = 'npm',
  opts: InstallOptions = {}
): string {
  const target = coord.version ? `${coord.name}@${coord.version}` : coord.name
  switch (manager) {
    case 'pnpm':
      return opts.global ? `pnpm add -g ${coord.name}` : `pnpm add ${target}`
    case 'yarn':
      return opts.global ? `yarn global add ${coord.name}` : `yarn add ${target}`
    case 'npm':
    default:
      if (opts.global) return `npm install -g ${coord.name}`
      if (opts.dev) return `npm install -D ${target}`
      return `npm install ${target}`
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/command-builder.spec.ts`
Expected: PASS（6 个用例）

- [ ] **Step 5: 记录完成**

---

### Task 6: markdown 渲染器（TDD）

**Files:**
- Create: `src/lib/markdown.ts`
- Create: `tests/unit/markdown.spec.ts`

**Interfaces:**
- Produces: `renderMarkdown(src: string): string`（先转义 HTML，再转 markdown 语法，可安全 `v-html`）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/lib/markdown'

describe('renderMarkdown', () => {
  it('标题', () => {
    expect(renderMarkdown('# Hello')).toContain('<h1>Hello</h1>')
    expect(renderMarkdown('## World')).toContain('<h2>World</h2>')
  })
  it('围栏代码块保留换行与缩进', () => {
    const out = renderMarkdown('```bash\nnpm install vue\nnpm run dev\n```')
    expect(out).toContain('<pre><code class="lang-bash">npm install vue\nnpm run dev</code></pre>')
  })
  it('行内代码 / 粗体 / 链接', () => {
    const out = renderMarkdown('use `npm run` and **bold** and [vue](https://vuejs.org)')
    expect(out).toContain('<code>npm run</code>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<a href="https://vuejs.org"')
  })
  it('无序 / 有序列表', () => {
    expect(renderMarkdown('- a\n- b')).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(renderMarkdown('1. a\n2. b')).toContain('<ol><li>a</li><li>b</li></ol>')
  })
  it('HTML 标签被转义（防 XSS）', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })
  it('javascript: 链接被中和', () => {
    const out = renderMarkdown('[x](javascript:alert(1))')
    expect(out).not.toContain('href="javascript:')
    expect(out).toContain('href="#"')
  })
  it('简单表格', () => {
    const out = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(out).toContain('<table>')
    expect(out).toContain('<th>a</th>')
    expect(out).toContain('<td>1</td>')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/markdown.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function safeHref(u: string): string {
  if (/^(javascript|data|vbscript):/i.test(u)) return '#'
  return escapeHtml(u)
}

// 行内：转义后应用 行内代码 / 粗体 / 斜体 / 链接
function inline(src: string): string {
  let t = escapeHtml(src)
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>')
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => `<a href="${safeHref(url)}" target="_blank" rel="noopener">${label}</a>`)
  return t
}

export function renderMarkdown(src: string): string {
  if (!src) return ''
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listType) { html.push(`</${listType}>`); listType = null }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()

    if (t.startsWith('```')) {
      if (inCode) {
        html.push(`<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
        codeBuf = []
        inCode = false
      } else {
        closeList()
        inCode = true
        codeLang = t.slice(3).trim()
      }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    if (t === '') { closeList(); continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(t)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^([-*_])\s*(\1\s*){2,}$/.test(t)) { closeList(); html.push('<hr>'); continue }

    // 表格：连续 | 行，第二行为分隔行
    if (t.startsWith('|')) {
      const rows = [line]
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        rows.push(lines[++i])
      }
      const isTable = rows.length >= 2 && rows[1].includes('-') && /^[|:\s-]+$/.test(rows[1].trim())
      if (isTable) {
        const parseRow = (r: string) =>
          r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
        const header = parseRow(rows[0])
        const body = rows.slice(2).map(parseRow)
        let out = '<table><thead><tr>' + header.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>'
        for (const b of body) out += '<tr>' + b.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'
        out += '</tbody></table>'
        closeList()
        html.push(out)
        continue
      }
      closeList()
      for (const r of rows) html.push(`<p>${inline(r.trim().replace(/^\|/, '').replace(/\|$/, ''))}</p>`)
      continue
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (ul) {
      if (listType !== 'ul') { closeList(); listType = 'ul'; html.push('<ul>') }
      html.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ol) {
      if (listType !== 'ol') { closeList(); listType = 'ol'; html.push('<ol>') }
      html.push(`<li>${inline(ol[1])}</li>`)
      continue
    }
    closeList()

    const bq = /^\s*>\s?(.*)$/.exec(line)
    if (bq) { html.push(`<blockquote>${inline(bq[1])}</blockquote>`); continue }

    html.push(`<p>${inline(line)}</p>`)
  }

  if (inCode) {
    html.push(`<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  }
  closeList()
  return html.join('\n')
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/markdown.spec.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: 记录完成**

---

### Task 7: skills 预置模板（TDD）

**Files:**
- Create: `src/lib/skills.ts`
- Create: `tests/unit/skills.spec.ts`

**Interfaces:**
- Consumes: `types.ts` 的 `NpmSkill`
- Produces: `SKILL_TEMPLATES: NpmSkill[]`（7 个）、`getSkill(code: string): NpmSkill | undefined`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { SKILL_TEMPLATES, getSkill } from '../../src/lib/skills'

describe('skills', () => {
  it('预置 7 个模板，code 唯一且与 plugin.json features 对齐', () => {
    const codes = SKILL_TEMPLATES.map(s => s.code)
    expect(codes).toEqual([
      'npm-skill-init',
      'npm-skill-install',
      'npm-skill-run',
      'npm-skill-update',
      'npm-skill-publish',
      'npm-skill-create',
      'npm-skill-global',
    ])
    expect(new Set(codes).size).toBe(codes.length)
  })
  it('每个模板字段完整：title/cmds/description/commands 非空', () => {
    for (const s of SKILL_TEMPLATES) {
      expect(s.title).toBeTruthy()
      expect(s.cmds.length).toBeGreaterThan(0)
      expect(s.description).toBeTruthy()
      expect(s.commands.length).toBeGreaterThan(0)
      for (const c of s.commands) expect(c.cmd).toBeTruthy()
    }
  })
  it('getSkill 命中与未命中', () => {
    expect(getSkill('npm-skill-init')?.title).toBe('初始化 npm 项目')
    expect(getSkill('no-such')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/unit/skills.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（完整内容）**

```ts
import type { NpmSkill } from './types'

export const SKILL_TEMPLATES: NpmSkill[] = [
  {
    code: 'npm-skill-init',
    title: '初始化 npm 项目',
    cmds: ['npm init', '初始化项目'],
    description: '快速创建 package.json，开始新的前端 / Node.js 项目。',
    commands: [
      { cmd: 'npm init -y', comment: '跳过交互问答，直接生成默认 package.json' },
      { cmd: 'npm init', comment: '交互式填写项目信息' },
      { cmd: 'npm pkg set name="my-app" version="0.1.0"', comment: '事后用命令直接改字段' },
    ],
    tips: [
      'package.json 的 name 决定包名，发布前确保唯一。',
      '加 "type": "module" 即可使用 ES Module 语法。',
      '库项目才需要配置 main / exports 入口。',
    ],
    config: [
      {
        title: '默认初始化配置（~/.npmrc）',
        code: 'init-author-name=康康学长\ninit-license=MIT\ninit-version=0.1.0',
      },
    ],
  },
  {
    code: 'npm-skill-install',
    title: '安装 npm 依赖',
    cmds: ['npm install', '安装依赖'],
    description: '安装、卸载、锁定依赖，以及区分依赖类型。',
    commands: [
      { cmd: 'npm install <pkg>', comment: '安装到 dependencies（生产依赖）' },
      { cmd: 'npm install -D <pkg>', comment: '安装到 devDependencies（开发依赖）' },
      { cmd: 'npm install', comment: '按 package-lock.json 精确还原依赖' },
      { cmd: 'npm uninstall <pkg>', comment: '卸载依赖' },
    ],
    tips: [
      '--save-exact 可锁定精确版本（不写 ^ 前缀）。',
      'npm ci 适合 CI 环境，严格按锁文件安装且更干净。',
      '依赖装在根还是子包，取决于 monorepo 的 workspaces 配置。',
    ],
  },
  {
    code: 'npm-skill-run',
    title: '运行 npm 脚本',
    cmds: ['npm run', '运行脚本'],
    description: '运行 package.json scripts 中的自定义脚本。',
    commands: [
      { cmd: 'npm run dev', comment: '开发模式（常见约定）' },
      { cmd: 'npm run build', comment: '构建产物（常见约定）' },
      { cmd: 'npm run <script> -- --flag', comment: '向脚本透传参数' },
      { cmd: 'npm start', comment: '等价 npm run start' },
    ],
    tips: [
      'scripts 里可以用 npx 调用任意本地/远程 CLI。',
      '给脚本加 pre/post 前缀会自动联动（如 prebuild 在 build 前执行）。',
      'npm run 会把 node_modules/.bin 加入 PATH，本地 CLI 可直接用。',
    ],
  },
  {
    code: 'npm-skill-update',
    title: '更新 npm 依赖',
    cmds: ['npm update', '更新依赖'],
    description: '查看过期依赖并批量升级到最新。',
    commands: [
      { cmd: 'npm outdated', comment: '列出过期依赖及最新版本' },
      { cmd: 'npm update', comment: '按 semver 范围更新到最新允许版本' },
      { cmd: 'npm install <pkg>@latest', comment: '升级单个包到最新（重写锁文件）' },
      { cmd: 'npm-check-updates -u', comment: '（需安装）把 package.json 里的范围也改成最新' },
    ],
    tips: [
      'npm update 不会跨大版本升级（受 ^ 范围限制）。',
      '升级前先看 changelog，破坏性变更常见于大版本。',
      '上线前用 npm ci 确保锁文件一致。',
    ],
  },
  {
    code: 'npm-skill-publish',
    title: '发布 npm 包',
    cmds: ['npm publish', '发布 npm 包'],
    description: '版本号管理、登录与发布流程。',
    commands: [
      { cmd: 'npm login', comment: '登录 npm 账号' },
      { cmd: 'npm version patch', comment: 'patch/minor/major 自动 bump 并打 tag' },
      { cmd: 'npm publish', comment: '发布到 registry' },
      { cmd: 'npm publish --tag beta', comment: '发布为 beta 标签（dist-tag）' },
      { cmd: 'npm unpublish <pkg>@<ver> --force', comment: '删除已发布版本（慎用）' },
    ],
    tips: [
      '发布前先跑构建与测试，确认 files 字段只包含产物。',
      '默认私有源时，记得配置 registry 或使用 --registry 参数。',
      'scope 包默认私有，公开发布需 --access public。',
    ],
    config: [
      { title: '私有源发布（~/.npmrc）', code: 'registry=https://registry.npmmirror.com\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}' },
    ],
  },
  {
    code: 'npm-skill-create',
    title: '创建脚手架项目',
    cmds: ['npm create', '脚手架'],
    description: '用社区脚手架一键初始化项目。',
    commands: [
      { cmd: 'npm create vite@latest my-app', comment: '创建 Vite 项目（React/Vue/TS 任选）' },
      { cmd: 'npm create next-app@latest', comment: '创建 Next.js 项目' },
      { cmd: 'npm create vue@latest', comment: '创建 Vue 官方脚手架项目' },
      { cmd: 'npx create-react-app my-app', comment: '创建 React 项目（经典方案）' },
    ],
    tips: [
      'npm create 是 npm init 的别名，会执行对应 create-* 包的初始化。',
      '脚手架交互选项多，先 --help 看参数，脚本化可全参数直给。',
      '大型脚手架先看 README，确认 Node 版本要求。',
    ],
  },
  {
    code: 'npm-skill-global',
    title: '全局安装 CLI',
    cmds: ['npm -g', '全局安装'],
    description: '全局安装命令行工具，随时调用。',
    commands: [
      { cmd: 'npm install -g <cli>', comment: '全局安装（npm）' },
      { cmd: 'pnpm add -g <cli>', comment: '全局安装（pnpm）' },
      { cmd: 'yarn global add <cli>', comment: '全局安装（yarn）' },
      { cmd: 'npm ls -g --depth=0', comment: '列出已安装的全局包' },
      { cmd: 'npm uninstall -g <cli>', comment: '卸载全局包' },
    ],
    tips: [
      '个人推荐用 npx 按需执行，不污染全局环境。',
      '全局安装目录权限不足时，检查 node 的安装方式（nvm / homebrew）。',
      '需要固定版本时：npm install -g <cli>@<ver>。',
    ],
  },
]

export function getSkill(code: string): NpmSkill | undefined {
  return SKILL_TEMPLATES.find(s => s.code === code)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/unit/skills.spec.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 记录完成**

---

### Task 8: preload.js 双源服务

**Files:**
- Create: `preload.js`（根目录）
- 说明：preload 是普通脚本（非 module），构建时 `cp` 进 dist；不含可单测的 import/export，纯逻辑已由 Task 3-7 的 lib 覆盖

**Interfaces:**
- Produces: `window.services.npmSearch(query)`、`window.services.npmMeta(name, source)`、`window.services.setRegistry(url)`、`window.services.getRegistry()`

- [ ] **Step 1: 创建 preload.js**

```js
// Npm Lite preload 服务：双源聚合搜索 + 包元数据
// 1. npm 官方 registry.npmjs.org
// 2. npmmirror registry.npmmirror.com（国内镜像，可在设置中覆盖基地址）

const SEARCH_SIZE = 20
const TIMEOUT_MS = 5000
const OFFICIAL_BASE = 'https://registry.npmjs.org'
const DEFAULT_MIRROR = 'https://registry.npmmirror.com'
let mirrorBase = DEFAULT_MIRROR

if (window.ztools?.http?.setHeaders) {
  window.ztools.http.setHeaders({ 'User-Agent': 'ztools-npm/1.0' })
}

class ServiceError extends Error {
  constructor(message, meta) {
    super(message)
    this.name = 'ServiceError'
    this.url = meta.url
    this.status = meta.status
    this.durationMs = meta.durationMs
    this.body = meta.body
  }
}

async function fetchJson(url, init = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const durationMs = Date.now() - start
    if (!res.ok) {
      let body
      try { body = await res.text() } catch {}
      throw new ServiceError(`HTTP ${res.status}`, { url, status: res.status, durationMs, body })
    }
    return { json: await res.json(), durationMs }
  } catch (err) {
    const durationMs = Date.now() - start
    if (err instanceof ServiceError) throw err
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw new ServiceError(`请求超时（${timeoutMs}ms）`, { url, status: 0, durationMs, body: err.message })
    }
    throw new ServiceError(`网络错误：${err?.message || String(err)}`, { url, status: 0, durationMs, body: err?.stack })
  } finally {
    clearTimeout(timer)
  }
}

// @scope/pkg → %40scope%2Fpkg
function encodeName(name) {
  return name.startsWith('@') ? encodeURIComponent(name) : name
}

function buildTerm(query) {
  if (query.kind === 'package') {
    return query.versionPrefix ? `${query.name}@${query.versionPrefix}` : query.name
  }
  return query.text
}

async function searchSource(base, source, query) {
  const term = buildTerm(query)
  if (!term) return []
  const url = `${base}/-/v1/search?text=${encodeURIComponent(term)}&size=${SEARCH_SIZE}`
  const { json } = await fetchJson(url)
  return (json.objects ?? []).map(o => ({
    id: o.package.name,
    name: o.package.name,
    version: o.package.version,
    description: o.package.description ?? '',
    keywords: o.package.keywords ?? [],
    date: o.package.date ?? '',
    source,
  }))
}

function dedupeByName(list) {
  const map = new Map()
  const score = (it) =>
    (it.description ? 1 : 0) + ((it.keywords && it.keywords.length) ? 1 : 0) + (it.date ? 1 : 0)
  for (const item of list) {
    if (!item.name) continue
    const existing = map.get(item.name)
    if (!existing) { map.set(item.name, item); continue }
    if (score(item) > score(existing)) map.set(item.name, item)
  }
  return [...map.values()]
}

async function npmSearch(query) {
  const settled = await Promise.allSettled([
    searchSource(OFFICIAL_BASE, 'npm', query).catch(e => { console.warn('npm failed:', e); return [] }),
    searchSource(mirrorBase, 'npmmirror', query).catch(e => { console.warn('npmmirror failed:', e); return [] }),
  ])
  const [npm, npmmirror] = settled.map(r => (r.status === 'fulfilled' ? r.value : []))
  return {
    data: dedupeByName([...npm, ...npmmirror]),
    sources: { npm, npmmirror },
  }
}

async function npmMeta(name, source = 'npm') {
  const base = source === 'npmmirror' ? mirrorBase : OFFICIAL_BASE
  const url = `${base}/${encodeName(name)}`
  const { json } = await fetchJson(url)
  const time = json.time ?? {}
  const versions = Object.keys(json.versions ?? {}).map(v => ({
    v,
    time: time[v] ? Date.parse(time[v]) || 0 : 0,
  }))
  const lic = json.license
  return {
    name: json.name ?? name,
    description: json.description ?? '',
    distTags: json['dist-tags'] ?? {},
    versions,
    readme: json.readme ?? '',
    license: typeof lic === 'string' ? lic : (lic && lic.type) || '',
    homepage: json.homepage ?? '',
    repository: (json.repository && json.repository.url) || '',
  }
}

function registerServices(api) {
  globalThis.services = api
  if (typeof window !== 'undefined') window.services = api
  return api
}

window.services = registerServices({
  npmSearch,
  npmMeta,
  setRegistry(url) {
    mirrorBase = typeof url === 'string' && url.trim() ? url.trim() : DEFAULT_MIRROR
    return mirrorBase
  },
  getRegistry() {
    return mirrorBase
  },
})
```

- [ ] **Step 2: 语法检查**

Run: `node --check preload.js`
Expected: 退出码 0

- [ ] **Step 3: 记录完成**

---

### Task 9: NpmSettings 设置弹窗

**Files:**
- Create: `src/NpmSettings/index.vue`

**Interfaces:**
- Consumes: `window.services.setRegistry/getRegistry`、`window.ztools.dbStorage`
- Produces: 组件 `NpmSettings`，props `{ open: boolean }`，emits `close`；存储 key `npm-registry`

- [ ] **Step 1: 创建组件（移植 MavenSettings 模式，字段改为「自定义镜像源」）**

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const DEFAULT_REGISTRY = 'https://registry.npmmirror.com'
const STORAGE_KEY = 'npm-registry'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const registry = ref('')
const saved = ref('')
const status = ref<{ type: 'idle' | 'saved' | 'cleared' }>({ type: 'idle' })

async function load() {
  if (!window.ztools?.dbStorage) {
    registry.value = DEFAULT_REGISTRY
    return
  }
  const stored = window.ztools.dbStorage.getItem(STORAGE_KEY)
  const value = typeof stored === 'string' ? stored : (stored as any)?.url ?? ''
  saved.value = value
  registry.value = value || DEFAULT_REGISTRY
}

async function save() {
  if (!window.ztools?.dbStorage) return
  const value = registry.value.trim()
  window.ztools.dbStorage.setItem(STORAGE_KEY, value)
  window.services?.setRegistry(value)
  saved.value = value
  status.value = { type: 'saved' }
  setTimeout(() => { status.value = { type: 'idle' } }, 1500)
}

async function reset() {
  if (!window.ztools?.dbStorage) return
  window.ztools.dbStorage.removeItem(STORAGE_KEY)
  window.services?.setRegistry(DEFAULT_REGISTRY)
  saved.value = ''
  registry.value = DEFAULT_REGISTRY
  status.value = { type: 'cleared' }
  setTimeout(() => { status.value = { type: 'idle' } }, 1500)
}

watch(() => props.open, (open) => {
  if (open) { load(); document.addEventListener('keydown', onEsc) }
  else document.removeEventListener('keydown', onEsc)
})
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  if (props.open) load()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-dialog" role="dialog" aria-modal="true">
        <header>
          <h2>Npm 插件设置</h2>
          <button class="close" @click="emit('close')" title="关闭 (Esc)" aria-label="关闭">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </header>

        <div class="field">
          <label for="registry">自定义镜像源</label>
          <input
            id="registry"
            v-model="registry"
            type="text"
            :placeholder="DEFAULT_REGISTRY"
            spellcheck="false"
          />
          <p class="hint">
            用于访问 <code>/-/v1/search</code> 与包元数据。留空 = 默认 npmmirror。
            <br />
            可填官方 <code>https://registry.npmjs.org</code> 或任意 npm registry 镜像。
          </p>
        </div>

        <div class="actions">
          <button class="primary" @click="save">保存</button>
          <button @click="reset">恢复默认</button>
          <button class="ghost" @click="emit('close')">取消</button>
        </div>

        <div v-if="status.type === 'saved'" class="status saved">
          <span class="ok-dot"></span> 已保存
        </div>
        <div v-else-if="status.type === 'cleared'" class="status cleared">已重置为默认</div>

        <div v-if="saved" class="current">
          当前镜像：<code>{{ saved }}</code>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 500; backdrop-filter: blur(2px);
}
.settings-dialog {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 10px; padding: 20px 24px; width: min(520px, 90vw);
  box-shadow: 0 12px 48px rgba(0,0,0,0.4); color: var(--text-primary);
}
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
header h2 { margin: 0; font-size: 1.15em; }
.close { background: transparent; border: none; color: var(--text-muted); font-size: 1.4em; line-height: 1; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.close:hover { background: var(--bg-hover); color: var(--text-primary); }
.field { margin-bottom: 16px; }
label { display: block; margin-bottom: 6px; font-weight: 600; color: var(--text-secondary); font-size: 0.95em; }
input {
  width: 100%; padding: 8px 10px; font-family: var(--font-mono); font-size: 0.95em;
  border: 1px solid var(--border); border-radius: 6px; background: var(--bg-primary);
  color: var(--text-primary); box-sizing: border-box;
}
input:focus { outline: none; border-color: var(--accent); }
.hint { margin: 6px 0 0; font-size: 0.85em; color: var(--text-muted); line-height: 1.4; }
.hint code { background: var(--bg-hover); padding: 1px 5px; border-radius: 3px; font-family: var(--font-mono); }
.actions { display: flex; gap: 8px; }
button { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-primary); cursor: pointer; font-size: 0.95em; }
button:hover { background: var(--bg-hover); }
button.primary { background: var(--accent); color: white; border-color: var(--accent); }
button.ghost { color: var(--text-muted); }
.status { margin-top: 12px; padding: 6px 10px; border-radius: 6px; font-size: 0.9em; display: flex; align-items: center; gap: 6px; }
.status.saved { background: var(--status-stable); color: white; }
.status.cleared { background: var(--bg-hover); color: var(--text-secondary); }
.ok-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.current { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 0.85em; color: var(--text-secondary); }
.current code { font-family: var(--font-mono); background: var(--bg-hover); padding: 1px 5px; border-radius: 3px; }
</style>
```

- [ ] **Step 2: 验证可编译**

Run: `npx vue-tsc --noEmit`
Expected: 退出码 0

- [ ] **Step 3: 记录完成**

---

### Task 10: NpmQuick 快捷复制（组件测试）

**Files:**
- Create: `src/NpmQuick/index.vue`
- Create: `tests/component/npm-quick.spec.ts`

**Interfaces:**
- Consumes: `parseSearch`、`buildInstallCommand`、`window.services.npmSearch`、`window.ztools.clipboard.writeContent`
- Produces: 组件 `NpmQuick`，props `{ enterAction: any }`；onMounted 读取 `enterAction.payload` 自动搜索；Enter/n/p/y 复制

- [ ] **Step 1: 写失败测试（mock 双源服务）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import NpmQuick from '../../src/NpmQuick/index.vue'

const mockSearch = vi.fn()
const mockWrite = vi.fn()

beforeEach(() => {
  ;(window as any).services = {
    npmSearch: mockSearch,
    npmMeta: vi.fn(),
    setRegistry: vi.fn(),
    getRegistry: vi.fn(),
  }
  ;(window as any).ztools = {
    setSubInput: vi.fn(),
    onPluginEnter: vi.fn(),
    onPluginOut: vi.fn(),
    clipboard: { writeContent: mockWrite },
    showNotification: vi.fn(),
    hideMainWindow: vi.fn(),
  }
  mockSearch.mockReset()
  mockWrite.mockReset()
})

describe('NpmQuick', () => {
  it('进入时按 payload 自动搜索并渲染列表', async () => {
    mockSearch.mockResolvedValue({
      data: [{ id: 'vue', name: 'vue', version: '3.5.41', description: 'progressive', source: 'npm' }],
      sources: { npm: [], npmmirror: [] },
    })
    const wrapper = mount(NpmQuick, {
      props: { enterAction: { code: 'npm-search', type: 'over', payload: 'vue' } },
    })
    await flushPromises()
    expect(mockSearch).toHaveBeenCalledWith({ kind: 'freeText', text: 'vue' })
    expect(wrapper.text()).toContain('vue')
    expect(wrapper.text()).toContain('3.5.41')
  })

  it('Enter 复制 npm install 并隐藏窗口', async () => {
    mockSearch.mockResolvedValue({
      data: [{ id: 'vue', name: 'vue', version: '3.5.41', description: '', source: 'npm' }],
      sources: { npm: [], npmmirror: [] },
    })
    const wrapper = mount(NpmQuick, {
      props: { enterAction: { code: 'npm-search', type: 'over', payload: 'vue' } },
    })
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(mockWrite).toHaveBeenCalledWith({
      type: 'text',
      content: 'npm install vue@3.5.41',
      shouldPaste: true,
    })
    expect((window as any).ztools.hideMainWindow).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/component/npm-quick.spec.ts`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现组件**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useTheme } from '../lib/useTheme'
import { parseSearch } from '../lib/search-parser'
import { buildInstallCommand } from '../lib/command-builder'
import type { NpmPackage } from '../lib/types'

const props = defineProps<{ enterAction: any }>()

useTheme()

const keyword = ref('')
const results = ref<NpmPackage[]>([])
const selectedIdx = ref(0)
const loading = ref(false)
const error = ref<any>(null)
const helpOpen = ref(false)

async function doSearch() {
  const q = keyword.value.trim()
  if (!q) return
  error.value = null
  loading.value = true
  try {
    const parsed = parseSearch(q)
    const r = await window.services.npmSearch(parsed)
    results.value = r.data
    selectedIdx.value = 0
  } catch (e: any) {
    error.value = e
    results.value = []
  } finally {
    loading.value = false
  }
}

async function copyCommand(manager: 'npm' | 'pnpm' | 'yarn') {
  const p = results.value[selectedIdx.value]
  if (!p) return
  const content = buildInstallCommand({ name: p.name, version: p.version }, manager)
  await window.ztools.clipboard.writeContent({ type: 'text', content, shouldPaste: true })
  window.ztools.showNotification(`已复制：${content}`)
  window.ztools.hideMainWindow()
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    helpOpen.value = !helpOpen.value; e.preventDefault(); return
  }
  if (e.key === 'ArrowDown') { selectedIdx.value = Math.min(selectedIdx.value + 1, results.value.length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { selectedIdx.value = Math.max(selectedIdx.value - 1, 0); e.preventDefault() }
  else if (e.key === 'Enter' || e.key === 'n') { copyCommand('npm'); e.preventDefault() }
  else if (e.key === 'p') { copyCommand('pnpm'); e.preventDefault() }
  else if (e.key === 'y') { copyCommand('yarn'); e.preventDefault() }
  else if (e.key === 'Escape') { window.ztools.hideMainWindow() }
}

onMounted(() => {
  keyword.value = String(props.enterAction?.payload ?? '')
  window.addEventListener('keydown', onKey)
  if (keyword.value) doSearch()
})
</script>

<template>
  <div class="npm-quick">
    <div v-if="helpOpen" class="help-overlay" @click.self="helpOpen = false">
      <div class="help-box">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>↑</kbd>/<kbd>↓</kbd> 列表内移动</li>
          <li><kbd>Enter</kbd>/<kbd>n</kbd> 复制 npm</li>
          <li><kbd>p</kbd> 复制 pnpm</li>
          <li><kbd>y</kbd> 复制 yarn</li>
          <li><kbd>Esc</kbd> 退出</li>
          <li><kbd>Cmd/Ctrl+K</kbd> 帮助</li>
        </ul>
      </div>
    </div>

    <div v-if="error" class="error-box">
      <pre>{{ error?.message || String(error) }}</pre>
    </div>

    <div class="quick-header">
      <span class="search-tip">↑↓ 选择 · Enter/n/p/y 复制</span>
    </div>

    <div v-if="!keyword" class="empty">请先输入要搜索的关键字</div>
    <div v-else-if="loading">检索中…</div>
    <ul v-else-if="results.length">
      <li
        v-for="(p, i) in results"
        :key="p.name"
        :class="{ active: i === selectedIdx }"
        @click="selectedIdx = i"
      >
        <span class="name">{{ p.name }}</span>
        <span class="version">{{ p.version }}</span>
      </li>
    </ul>
    <p v-else class="empty">未找到包。可尝试其他关键字，或换官方源。</p>
  </div>
</template>

<style scoped>
.npm-quick { padding: 20px 24px; background: var(--bg-primary); color: var(--text-primary); font-size: 16px; min-height: 100%; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: 10px 14px; cursor: pointer; border-radius: var(--radius); margin-bottom: 4px; border: 1px solid transparent; display: flex; gap: 12px; }
li.active { background: var(--bg-hover); border-color: var(--accent); }
.name { font-family: var(--font-mono); font-weight: 500; }
.version { margin-left: auto; color: var(--text-secondary); font-size: 0.9em; font-family: var(--font-mono); }
.empty { color: var(--text-muted); padding: 12px; text-align: center; }
.error-box { padding: 8px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius); margin-bottom: 8px; }
.error-box pre { font-size: 0.8em; max-height: 200px; overflow: auto; white-space: pre-wrap; }
.quick-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.search-tip { color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); }
.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.help-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; min-width: 240px; }
.help-box h3 { margin-top: 0; }
.help-box ul { padding-left: 0; }
.help-box li { padding: 3px 0; cursor: default; border: none; }
kbd { background: var(--bg-hover); padding: 1px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.85em; }
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/component/npm-quick.spec.ts`
Expected: PASS（2 个用例）

- [ ] **Step 5: 记录完成**

---

### Task 11: SkillView + SkillsLib（组件测试）

**Files:**
- Create: `src/SkillView/index.vue`
- Create: `src/SkillsLib/index.vue`
- Create: `tests/component/skill-view.spec.ts`

**Interfaces:**
- Consumes: `getSkill`、`SKILL_TEMPLATES`、`buildInstallCommand`
- Produces: `SkillView`（props `{ code: string }`）、`SkillsLib`（emits `select: [code: string]`）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SkillView from '../../src/SkillView/index.vue'

const mockWrite = vi.fn()

beforeEach(() => {
  ;(window as any).ztools = {
    clipboard: { writeContent: mockWrite },
    showNotification: vi.fn(),
    hideMainWindow: vi.fn(),
  }
  mockWrite.mockReset()
})

describe('SkillView', () => {
  it('按 code 渲染技能标题与命令块', () => {
    const wrapper = mount(SkillView, { props: { code: 'npm-skill-init' } })
    expect(wrapper.text()).toContain('初始化 npm 项目')
    expect(wrapper.text()).toContain('npm init -y')
  })
  it('未知 code 显示空态', () => {
    const wrapper = mount(SkillView, { props: { code: 'no-such' } })
    expect(wrapper.text()).toContain('未找到该技能')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/component/skill-view.spec.ts`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现 SkillView**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from '../lib/useTheme'
import { getSkill } from '../lib/skills'

const props = defineProps<{ code: string }>()

useTheme()

const skill = computed(() => getSkill(props.code))

async function copyText(text: string, msg: string) {
  if (!window.ztools?.clipboard) return
  await window.ztools.clipboard.writeContent({ type: 'text', content: text, shouldPaste: true })
  window.ztools.showNotification(msg)
  window.ztools.hideMainWindow()
}
</script>

<template>
  <div class="skill-view">
    <template v-if="skill">
      <header>
        <span class="title">{{ skill.title }}</span>
        <span class="trigger">触发：{{ skill.cmds.join(' / ') }}</span>
      </header>

      <p class="desc">{{ skill.description }}</p>

      <h3>常用命令</h3>
      <ul class="commands">
        <li v-for="(c, i) in skill.commands" :key="i">
          <code class="cmd">{{ c.cmd }}</code>
          <span class="comment">{{ c.comment }}</span>
          <button @click="copyText(c.cmd, `已复制：${c.cmd}`)">复制</button>
        </li>
      </ul>

      <template v-if="skill.tips?.length">
        <h3>小贴士</h3>
        <ul class="tips">
          <li v-for="(tip, i) in skill.tips" :key="i">{{ tip }}</li>
        </ul>
      </template>

      <template v-if="skill.config?.length">
        <h3>配置参考</h3>
        <div v-for="(cfg, i) in skill.config" :key="i" class="config">
          <div class="cfg-title">{{ cfg.title }}</div>
          <pre><code>{{ cfg.code }}</code></pre>
          <button @click="copyText(cfg.code, `已复制：${cfg.title}`)">复制</button>
        </div>
      </template>
    </template>

    <p v-else class="empty">未找到该技能</p>
  </div>
</template>

<style scoped>
.skill-view { padding: 24px 28px; background: var(--bg-primary); color: var(--text-primary); font-size: 16px; min-height: 100%; }
header { display: flex; align-items: baseline; gap: 12px; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.title { font-size: 1.4em; font-weight: 600; }
.trigger { color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); }
.desc { color: var(--text-secondary); }
h3 { margin: 20px 0 8px; font-size: 1em; }
ul { list-style: none; padding: 0; margin: 0; }
.commands li {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: var(--radius); margin-bottom: 6px;
  background: var(--bg-secondary); border: 1px solid var(--border);
}
.commands .cmd { font-family: var(--font-mono); font-weight: 500; flex-shrink: 0; }
.commands .comment { color: var(--text-muted); font-size: 0.9em; }
.commands button, .config button { margin-left: auto; background: transparent; color: var(--accent); border: 1px solid var(--border); padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.commands button:hover, .config button:hover { background: var(--bg-hover); border-color: var(--accent); }
.tips li { list-style: disc; margin-left: 20px; padding: 3px 0; color: var(--text-secondary); }
.config { margin-bottom: 12px; }
.cfg-title { color: var(--text-muted); font-size: 0.85em; margin-bottom: 4px; }
.config pre {
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 12px; overflow: auto; font-family: var(--font-mono); font-size: 0.9em;
  white-space: pre-wrap; margin: 0 0 6px;
}
.empty { color: var(--text-muted); text-align: center; padding: 40px; }
</style>
```

- [ ] **Step 4: 实现 SkillsLib**

```vue
<script setup lang="ts">
import { useTheme } from '../lib/useTheme'
import { SKILL_TEMPLATES } from '../lib/skills'

const emit = defineEmits<{ select: [code: string] }>()

useTheme()
</script>

<template>
  <div class="skills-lib">
    <header>
      <span class="title">Npm 技能库</span>
      <span class="hint">点选技能查看用法，也可直接在搜索框输入触发指令</span>
    </header>
    <ul class="skills">
      <li v-for="s in SKILL_TEMPLATES" :key="s.code" @click="emit('select', s.code)">
        <span class="name">{{ s.title }}</span>
        <span class="desc">{{ s.description }}</span>
        <span class="cmds">{{ s.cmds.join(' / ') }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.skills-lib { padding: 24px 28px; background: var(--bg-primary); color: var(--text-primary); font-size: 16px; min-height: 100%; }
header { border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 16px; }
.title { font-size: 1.4em; font-weight: 600; }
.hint { color: var(--text-muted); font-size: 0.85em; margin-left: 12px; }
ul { list-style: none; padding: 0; margin: 0; }
.skills li {
  padding: 14px 16px; border-radius: var(--radius); margin-bottom: 8px;
  border: 1px solid var(--border); cursor: pointer; transition: background 0.1s, border-color 0.1s;
  display: grid; grid-template-columns: 160px 1fr auto; gap: 12px; align-items: center;
}
.skills li:hover { background: var(--bg-hover); border-color: var(--accent); }
.name { font-weight: 600; }
.desc { color: var(--text-secondary); font-size: 0.92em; }
.cmds { color: var(--text-muted); font-size: 0.8em; font-family: var(--font-mono); }
</style>
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/component/skill-view.spec.ts`
Expected: PASS（2 个用例）

- [ ] **Step 6: 记录完成**

---

### Task 12: NpmUi 主检索面板

**Files:**
- Create: `src/NpmUi/index.vue`

**Interfaces:**
- Consumes: `parseSearch`、`tagVersion/dedupeVersions/pickLatest/formatTimestamp/applyDistTags`、`buildInstallCommand`、`renderMarkdown`、`useNpmCache`、`window.services.npmSearch/npmMeta`、`NpmSettings`、`SkillsLib`
- Produces: 组件 `NpmUi`，props `{ enterAction: any }`；三级面板（结果→版本→README）+ 复制菜单 + 技能库/设置弹窗

- [ ] **Step 1: 实现组件（完整代码）**

```vue
<script setup lang="ts">
import { onMounted, ref, computed, nextTick, watch } from 'vue'
import { useTheme } from '../lib/useTheme'
import { useNpmCache } from '../lib/useNpmCache'
import { parseSearch } from '../lib/search-parser'
import { tagVersion, dedupeVersions, formatTimestamp, pickLatest, applyDistTags } from '../lib/version-tag'
import { buildInstallCommand } from '../lib/command-builder'
import { renderMarkdown } from '../lib/markdown'
import type { NpmPackage, NpmVersion, ParsedQuery, NpmMeta } from '../lib/types'
import NpmSettings from '../NpmSettings/index.vue'
import SkillsLib from '../SkillsLib/index.vue'
import SkillView from '../SkillView/index.vue'

const props = defineProps<{ enterAction: any }>()

useTheme()
const cache = useNpmCache()

const searchInput = ref('')
const debouncedInput = ref('')
let debounceTimer: any = null
const searchResult = ref<{ data: NpmPackage[]; sources: { npm: NpmPackage[]; npmmirror: NpmPackage[] } } | null>(null)
const selectedIdx = ref(0)
const selectedPackage = ref<NpmPackage | null>(null)
const meta = ref<NpmMeta | null>(null)
const versions = ref<NpmVersion[]>([])
const versionIdx = ref(0)
const MAX_VERSIONS_PER_PAGE = 200
const versionPage = ref(1)
const visibleVersions = computed(() => versions.value.slice(0, versionPage.value * MAX_VERSIONS_PER_PAGE))
const versionsHasMore = computed(() => visibleVersions.value.length < versions.value.length)
function loadMoreVersions() { versionPage.value += 1 }
const readmeOpen = ref(false)
const loading = ref(false)
const error = ref<any>(null)
const settingsOpen = ref(false)
const skillsOpen = ref(false)
const skillViewCode = ref('')   // 技能库弹窗内的二级导航：非空则显示对应技能详情
const helpOpen = ref(false)
const menuOpen = ref(false)
const menuFocusIdx = ref(0)

const STORAGE_TAB_KEY = 'npm-search-tab'
const TABS = [
  { key: 'all', label: '全部' },
  { key: 'npm', label: 'npm' },
  { key: 'npmmirror', label: 'npmmirror' },
]
const activeTab = ref('all')
let tabIdx = 0

const SOURCE_LABELS: Record<string, string> = { npm: 'npm', npmmirror: 'npmmirror' }

const MENU_ITEMS = [
  { label: '复制 npm install', shortcut: 'n', build: (c: any) => buildInstallCommand(c, 'npm') },
  { label: '复制 pnpm add', shortcut: 'p', build: (c: any) => buildInstallCommand(c, 'pnpm') },
  { label: '复制 yarn add', shortcut: 'y', build: (c: any) => buildInstallCommand(c, 'yarn') },
]

const resultsListRef = ref<HTMLUListElement | null>(null)
const versionsListRef = ref<HTMLDivElement | null>(null)

function baseTabResults(): NpmPackage[] {
  const s = searchResult.value
  if (!s) return []
  if (activeTab.value === 'npm') return s.sources?.npm ?? []
  if (activeTab.value === 'npmmirror') return s.sources?.npmmirror ?? []
  return s.data ?? []
}
function tabCount(key: string): number {
  const s = searchResult.value
  if (!s) return 0
  if (key === 'npm') return s.sources?.npm?.length ?? 0
  if (key === 'npmmirror') return s.sources?.npmmirror?.length ?? 0
  return s.data?.length ?? 0
}
function persistTab(key: string) { try { window.ztools?.dbStorage?.setItem?.(STORAGE_TAB_KEY, key) } catch {} }
function switchTab(key: string) {
  activeTab.value = key
  tabIdx = TABS.findIndex(t => t.key === key)
  selectedIdx.value = 0
  persistTab(key)
}
function tabStep(dir: 1 | -1) {
  tabIdx = (tabIdx + dir + TABS.length) % TABS.length
  switchTab(TABS[tabIdx].key)
}

function cacheKey(parsed: ParsedQuery): string {
  if (parsed.kind === 'package') return `${parsed.name}${parsed.versionPrefix ? '@' + parsed.versionPrefix : ''}`
  return parsed.text
}

async function doSearch() {
  const input = debouncedInput.value.trim()
  if (!input) { searchResult.value = null; return }
  const parsed = parseSearch(input)
  const key = cacheKey(parsed)
  const cached = cache.getSearch(key)
  if (cached) { searchResult.value = cached as any; return }
  loading.value = true
  error.value = null
  try {
    const r = await window.services.npmSearch(parsed)
    cache.setSearch(key, r)
    searchResult.value = r
    selectedIdx.value = 0
  } catch (e: any) {
    error.value = e
    searchResult.value = null
  } finally {
    loading.value = false
  }
}

async function loadMeta(pkg: NpmPackage) {
  const key = `${pkg.source === 'npmmirror' ? 'm:' : ''}${pkg.name}`
  const cached = cache.getMeta(key)
  const metaData: NpmMeta = cached ?? (await window.services.npmMeta(pkg.name, pkg.source ?? 'npm'))
  if (!cached) cache.setMeta(key, metaData)
  meta.value = metaData
  const tagged: NpmVersion[] = (metaData.versions ?? []).map(v => ({
    v: v.v, time: v.time ?? 0, status: tagVersion(v.v), isLatest: false, isDistTag: false,
  }))
  const deduped = applyDistTags(dedupeVersions(tagged), metaData.distTags ?? {})
  const latest = pickLatest(deduped)
  if (latest) {
    const idx = deduped.findIndex(v => v === latest)
    if (idx >= 0 && !deduped[idx].isLatest) deduped[idx] = { ...deduped[idx], isLatest: true }
  }
  versions.value = deduped.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
  versionIdx.value = Math.max(versions.value.findIndex(v => v.isLatest), 0)
  versionPage.value = 1
  readmeOpen.value = false
}

async function selectPackage(pkg: NpmPackage) {
  selectedPackage.value = pkg
  loading.value = true
  error.value = null
  try {
    await loadMeta(pkg)
  } catch (e: any) {
    error.value = e
    versions.value = []
    meta.value = null
  } finally {
    loading.value = false
  }
}

async function copyContent(content: string, msg: string) {
  if (!window.ztools?.clipboard) return
  await window.ztools.clipboard.writeContent({ type: 'text', content, shouldPaste: true })
  window.ztools.showNotification(msg)
  window.ztools.hideMainWindow()
}

function currentCoord(): { name: string; version?: string } | null {
  const p = selectedPackage.value
  if (!p) return null
  const v = versions.value[versionIdx.value]
  return { name: p.name, version: v ? v.v : p.version }
}
function copyNpm() { const c = currentCoord(); if (c) copyContent(buildInstallCommand(c, 'npm'), '已复制 npm install') }
function copyPnpm() { const c = currentCoord(); if (c) copyContent(buildInstallCommand(c, 'pnpm'), '已复制 pnpm add') }
function copyYarn() { const c = currentCoord(); if (c) copyContent(buildInstallCommand(c, 'yarn'), '已复制 yarn add') }
function copyFromRow(pkg: NpmPackage | undefined, manager: 'npm' | 'pnpm' | 'yarn') {
  if (!pkg) return
  copyContent(buildInstallCommand({ name: pkg.name, version: pkg.version }, manager), `已复制 ${manager} 安装指令`)
}

function openMenu() {
  if (!currentCoord()) return
  menuOpen.value = true
  menuFocusIdx.value = 0
}
function closeMenu() { menuOpen.value = false }
function confirmMenu() {
  const c = currentCoord()
  if (!c) return
  const item = MENU_ITEMS[menuFocusIdx.value]
  copyContent(item.build(c), item.label)
  closeMenu()
}

function onSearchChange(input: unknown) {
  const text = typeof input === 'string' ? input : (input as any)?.text ?? ''
  searchInput.value = text
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { debouncedInput.value = text; doSearch() }, 700)
}

function onResultKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { selectedIdx.value = Math.min(selectedIdx.value + 1, baseTabResults().length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { selectedIdx.value = Math.max(selectedIdx.value - 1, 0); e.preventDefault() }
}
function onVersionKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { versionIdx.value = Math.min(versionIdx.value + 1, visibleVersions.value.length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { versionIdx.value = Math.max(versionIdx.value - 1, 0); e.preventDefault() }
  else if (e.key === 'ArrowLeft') { selectedPackage.value = null; e.preventDefault() }
}
function onMenuKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeMenu(); e.preventDefault() }
  else if (e.key === 'Tab') {
    e.preventDefault()
    menuFocusIdx.value = (menuFocusIdx.value + (e.shiftKey ? -1 : 1) + MENU_ITEMS.length) % MENU_ITEMS.length
  } else if (e.key === 'Enter') { confirmMenu(); e.preventDefault() }
}

function onGlobalKey(e: KeyboardEvent) {
  if (menuOpen.value || settingsOpen.value || skillsOpen.value || readmeOpen.value) return
  const inVersionPanel = !!selectedPackage.value
  const hasSelection = inVersionPanel || (!selectedPackage.value && baseTabResults().length > 0)
  const key = e.key.toLowerCase()

  if (e.key === 'Escape') {
    if (selectedPackage.value) selectedPackage.value = null
    else window.ztools.hideMainWindow()
    e.preventDefault(); return
  }
  if ((e.metaKey || e.ctrlKey) && key === 'k') { helpOpen.value = !helpOpen.value; e.preventDefault(); return }
  if (e.key === '/') { document.getElementById('npm-search-input')?.focus(); e.preventDefault(); return }

  if (!selectedPackage.value && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    tabStep(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); return
  }
  if (selectedPackage.value && e.key === 'ArrowLeft') { selectedPackage.value = null; e.preventDefault(); return }
  if (selectedPackage.value && key === 'r') { readmeOpen.value = true; e.preventDefault(); return }
  if (selectedPackage.value && key === 's') { skillsOpen.value = true; e.preventDefault(); return }

  if (hasSelection && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'Enter' || key === 'c') {
      if (inVersionPanel) openMenu()
      else { const entry = baseTabResults()[selectedIdx.value]; if (entry) selectPackage(entry) }
      e.preventDefault()
    } else if (key === 'n') {
      if (inVersionPanel) copyNpm()
      else copyFromRow(baseTabResults()[selectedIdx.value], 'npm')
      e.preventDefault()
    } else if (key === 'p') {
      if (inVersionPanel) copyPnpm()
      else copyFromRow(baseTabResults()[selectedIdx.value], 'pnpm')
      e.preventDefault()
    } else if (key === 'y') {
      if (inVersionPanel) copyYarn()
      else copyFromRow(baseTabResults()[selectedIdx.value], 'yarn')
      e.preventDefault()
    }
  }
}

watch([() => activeTab.value, () => baseTabResults().length], async () => {
  if (baseTabResults().length > 0 && !selectedPackage.value) {
    await nextTick()
    resultsListRef.value?.focus({ preventScroll: true })
  }
})

onMounted(() => {
  window.ztools?.setSubInput?.(onSearchChange, '搜索 npm 包…', true)
  window.addEventListener('keydown', onGlobalKey)
  Promise.resolve()
    .then(() => window.ztools?.dbStorage?.getItem?.(STORAGE_TAB_KEY))
    .then((saved) => {
      if (saved && TABS.some(t => t.key === saved)) switchTab(saved)
      else tabIdx = TABS.findIndex(t => t.key === activeTab.value)
    })
    .catch(() => { tabIdx = 0 })
})
</script>

<template>
  <div class="npm-panel">
    <div v-if="helpOpen" class="help-overlay" @click.self="helpOpen = false">
      <div class="help-box">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>/</kbd> 聚焦搜索</li>
          <li><kbd>↑</kbd>/<kbd>↓</kbd> 列表内移动</li>
          <li><kbd>←</kbd>/<kbd>→</kbd> 切换数据源</li>
          <li><kbd>Enter</kbd> 进入版本列表</li>
          <li><kbd>n</kbd> npm / <kbd>p</kbd> pnpm / <kbd>y</kbd> yarn</li>
          <li><kbd>r</kbd> 查看使用指南</li>
          <li><kbd>Esc</kbd> 返回 / 退出</li>
          <li><kbd>Cmd/Ctrl+K</kbd> 帮助</li>
        </ul>
      </div>
    </div>

    <div v-if="menuOpen" class="menu-overlay" @click.self="closeMenu" @keydown="onMenuKey" tabindex="0">
      <div class="menu-box">
        <button v-for="(item, i) in MENU_ITEMS" :key="item.label" :class="{ focused: i === menuFocusIdx }" @click="confirmMenu">
          <span>{{ item.label }}</span>
          <span class="hint">({{ item.shortcut }})</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="error-box">
      <div class="error-msg">{{ error?.message || '出错了' }}</div>
      <details>
        <summary class="err-toggle">查看错误详情</summary>
        <pre>{{ error?.url }} · {{ error?.status }} · {{ error?.durationMs }}ms</pre>
      </details>
    </div>

    <!-- 一级：结果列表 -->
    <div v-if="!selectedPackage" class="results">
      <header class="result-header">
        <span class="search-tip">↑↓ 选包 · ←→ 切源 · n npm / p pnpm / y yarn · Enter 进入</span>
        <button class="side-btn" @click="skillsOpen = true">技能库</button>
        <button class="settings-btn" @click="settingsOpen = true" title="镜像源等设置">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          设置
        </button>
      </header>

      <div v-if="searchResult" class="tabs">
        <button v-for="t in TABS" :key="t.key" class="tab" :class="{ active: activeTab === t.key }" @click="switchTab(t.key)">
          {{ t.label }}
          <span class="tab-count">{{ tabCount(t.key) }}</span>
        </button>
      </div>

      <div v-if="loading" class="loading">检索中…</div>
      <div v-else-if="searchResult && baseTabResults().length === 0" class="empty">
        <template v-if="searchResult.data.length === 0">
          没找到相关包。
          <a :href="`https://www.npmjs.com/search?q=${encodeURIComponent(searchInput)}`" target="_blank" rel="noopener">去 npmjs.com 搜 “{{ searchInput }}”</a>
        </template>
        <template v-else>
          当前数据源暂无结果，按 ← → 切换数据源查看
        </template>
      </div>
      <ul v-else-if="searchResult && baseTabResults().length > 0" ref="resultsListRef" tabindex="0" @keydown="onResultKey">
        <li v-for="(p, i) in baseTabResults()" :key="p.name + '-' + p.source" :class="{ active: i === selectedIdx }" @click="selectPackage(p)">
          <span class="name">{{ p.name }}</span>
          <span class="version">{{ p.version }}</span>
          <span v-if="activeTab === 'all' && p.source" class="src-tag" :class="'src-' + p.source">{{ SOURCE_LABELS[p.source] }}</span>
          <span class="copy-hint"><kbd>n</kbd>/<kbd>p</kbd>/<kbd>y</kbd> 复制 · <kbd>Enter</kbd> 进入</span>
        </li>
      </ul>
    </div>

    <!-- 二级：版本列表 -->
    <div v-else-if="!readmeOpen" class="versions" @keydown="onVersionKey" tabindex="0">
      <header>
        <button class="back-btn" @click="selectedPackage = null">← 返回</button>
        <span class="id">{{ selectedPackage.name }}</span>
        <span v-if="meta?.description" class="desc">{{ meta.description }}</span>
        <span class="hint-mini">↑↓ 选版本 · Enter 菜单 · n/p/y 复制 · r 指南</span>
        <button class="settings-btn" @click="settingsOpen = true">设置</button>
      </header>

      <ul ref="versionsListRef">
        <li v-for="(v, i) in visibleVersions" :key="v.v" :class="{ active: i === versionIdx, latest: v.isLatest }" @click="versionIdx = i" tabindex="0" @focus="versionIdx = i">
          <span class="ver">{{ v.v }}</span>
          <span class="time">{{ formatTimestamp(v.time ?? 0) }}</span>
          <span :class="['status', v.status]">{{ v.status }}</span>
          <span v-if="v.isLatest" class="latest-badge">LATEST</span>
          <span v-if="v.isDistTag && !v.isLatest" class="dist-tag">dist-tag</span>
        </li>
      </ul>
      <button v-if="versionsHasMore" class="more" @click="loadMoreVersions">加载更多（{{ versions.length - visibleVersions.length }} 条）</button>
      <footer>
        <span>r 使用指南 · Enter/c 菜单 · n/p/y 复制 · Esc 返回 · Cmd+K 帮助</span>
      </footer>
    </div>

    <!-- 三级：README 使用指南 -->
    <div v-else class="readme" tabindex="0" @keydown.escape="readmeOpen = false">
      <header>
        <button class="back-btn" @click="readmeOpen = false">← 返回版本</button>
        <span class="id">{{ selectedPackage.name }}</span>
        <span class="hint-mini">Esc 返回 · Cmd+K 帮助</span>
      </header>
      <div class="readme-body" v-html="renderMarkdown(meta?.readme ?? '')"></div>
      <button class="copy-readme" @click="meta?.readme && copyContent(meta.readme, '已复制 README')">复制 README</button>
    </div>

    <!-- 弹窗：技能库（弹窗内二级导航：技能列表 → 技能详情） / 设置 -->
    <div v-if="skillsOpen" class="dialog-overlay" @click.self="skillsOpen = false">
      <div class="dialog-panel">
        <button class="close" @click="skillsOpen = false">×</button>
        <template v-if="skillViewCode">
          <SkillView :code="skillViewCode" />
          <button class="back-btn" @click="skillViewCode = ''">← 返回技能列表</button>
        </template>
        <SkillsLib v-else @select="skillViewCode = $event" />
      </div>
    </div>

    <NpmSettings :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.npm-panel {
  padding: 20px 24px; background: var(--bg-primary); color: var(--text-primary);
  position: relative; font-size: 16px; line-height: 1.5; min-height: 100%;
}
ul { list-style: none; padding: 0; margin: 0; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.id { font-family: var(--font-mono); font-weight: 500; }
.desc { color: var(--text-secondary); font-size: 0.9em; }
.hint-mini { color: var(--text-muted); font-size: 0.8em; margin-left: auto; font-family: var(--font-mono); }
.result-header { margin-bottom: 12px; }
.search-tip { color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); }
.results li, .versions li {
  padding: 12px 14px; cursor: pointer; border-radius: var(--radius); margin-bottom: 4px;
  border: 1px solid transparent; display: flex; align-items: center; gap: 12px;
  transition: background 0.1s, border-color 0.1s;
}
.results li:hover, .versions li:hover { background: var(--bg-hover); }
.results li.active, .versions li.active { background: var(--bg-hover); border-color: var(--accent); }
.name { font-family: var(--font-mono); font-weight: 500; }
.version { margin-left: auto; color: var(--text-secondary); font-size: 0.9em; font-family: var(--font-mono); }
.copy-hint { margin-left: auto; color: var(--text-muted); font-size: 0.72em; font-family: var(--font-mono); white-space: nowrap; }
.copy-hint kbd { background: var(--bg-hover); border: 1px solid var(--border); border-radius: 3px; padding: 0 5px; font-size: 0.9em; }
.src-tag { font-size: 0.7em; padding: 2px 8px; border-radius: 999px; font-weight: 500; }
.src-npm { background: var(--status-stable); color: white; }
.src-npmmirror { background: var(--status-beta); color: white; }
.ver { font-family: var(--font-mono); }
.time { color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); margin-left: 8px; }
.status { font-size: 0.7em; padding: 2px 8px; border-radius: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
.status.stable { background: var(--status-stable); color: white; }
.status.rc { background: var(--status-snapshot); color: white; }
.status.beta { background: var(--status-beta); color: white; }
.status.alpha { background: var(--status-alpha); color: white; }
.status.dev { background: var(--status-snapshot); color: white; }
.latest-badge { background: var(--accent); color: white; font-size: 0.7em; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
.dist-tag { color: var(--text-muted); font-size: 0.7em; border: 1px dashed var(--border); padding: 2px 6px; border-radius: 999px; }
.tabs { display: flex; gap: 4px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-secondary); font-size: 0.9em; cursor: pointer; }
.tab.active { background: var(--accent); color: white; border-color: var(--accent); }
.tab-count { font-size: 0.75em; font-family: var(--font-mono); padding: 1px 6px; border-radius: 999px; background: rgba(128,128,128,0.2); }
.tab.active .tab-count { background: rgba(255,255,255,0.25); }
button { background: transparent; color: var(--accent); border: 1px solid var(--border); padding: 6px 12px; border-radius: var(--radius); font-size: 0.95em; cursor: pointer; }
button:hover { background: var(--bg-hover); }
.settings-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.side-btn { white-space: nowrap; }
.back-btn { display: inline-flex; align-items: center; gap: 5px; }
.more { margin-top: 12px; display: block; width: 100%; padding: 10px; }
.empty { color: var(--text-muted); padding: 32px 16px; text-align: center; }
.empty a { color: var(--accent); display: block; margin-top: 12px; text-decoration: none; }
.loading { padding: 32px; text-align: center; color: var(--text-muted); }
.error-box { padding: 12px 14px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius); margin-bottom: 12px; }
.error-box pre { font-size: 0.85em; max-height: 240px; overflow: auto; white-space: pre-wrap; font-family: var(--font-mono); }
.err-toggle { cursor: pointer; list-style: none; }
footer { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.85em; font-family: var(--font-mono); }
.menu-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; backdrop-filter: blur(2px); }
.menu-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 12px; min-width: 300px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
.menu-box button { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; margin-bottom: 6px; padding: 12px 14px; }
.menu-box button.focused { background: var(--bg-hover); outline: 2px solid var(--accent); outline-offset: -2px; }
.menu-box .hint { color: var(--text-muted); font-size: 0.8em; font-family: var(--font-mono); }
.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 200; backdrop-filter: blur(2px); }
.help-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 10px; padding: 24px; min-width: 360px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
.help-box h3 { margin-top: 0; }
.help-box li { padding: 6px 0; }
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 150; backdrop-filter: blur(2px); }
.dialog-panel { position: relative; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 10px; padding: 20px; width: min(560px, 92vw); max-height: 80vh; overflow: auto; box-shadow: 0 12px 48px rgba(0,0,0,0.4); }
.dialog-panel .close { position: absolute; top: 8px; right: 8px; z-index: 1; font-size: 1.4em; line-height: 1; padding: 4px 8px; }
.readme-body { line-height: 1.7; overflow: auto; max-height: 60vh; }
.readme-body :deep(pre) { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow: auto; font-family: var(--font-mono); font-size: 0.88em; }
.readme-body :deep(code) { font-family: var(--font-mono); background: var(--bg-hover); padding: 1px 5px; border-radius: 3px; }
.readme-body :deep(pre code) { background: none; padding: 0; }
.readme-body :deep(a) { color: var(--accent); }
.readme-body :deep(table) { border-collapse: collapse; }
.readme-body :deep(th), .readme-body :deep(td) { border: 1px solid var(--border); padding: 6px 10px; }
.copy-readme { margin-top: 12px; display: block; }
kbd { background: var(--bg-hover); padding: 2px 8px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.85em; border: 1px solid var(--border); }
</style>
```

> 注：技能库在主面板内以弹窗呈现，弹窗内做「技能列表 → 技能详情」的二级导航；用户也可在搜索框直接输入技能触发指令（`npm init` 等），由 App.vue 路由到独立 SkillView 页（Task 13）。

- [ ] **Step 2: 验证可编译**

Run: `npx vue-tsc --noEmit`
Expected: 退出码 0

- [ ] **Step 3: 记录完成**

---

### Task 13: App.vue 路由 + 清理占位组件

**Files:**
- Modify: `src/App.vue`（重写）
- Delete: `src/Hello/`、`src/Read/`、`src/Write/`（整目录删除）

**Interfaces:**
- Consumes: `NpmUi`、`NpmQuick`、`SkillsLib`、`SkillView`
- Produces: 路由映射：`npm-ui`(默认) / `npm-search` / `npm-skills` / `npm-skill-*`

- [ ] **Step 1: 重写 src/App.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import NpmUi from './NpmUi/index.vue'
import NpmQuick from './NpmQuick/index.vue'
import SkillsLib from './SkillsLib/index.vue'
import SkillView from './SkillView/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  // 非 ZTools 宿主（浏览器预览）下安全退出，避免整棵树崩溃
  if (!window.ztools) return
  window.ztools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
  })
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <NpmUi v-if="!route || route === 'npm-ui'" :enter-action="enterAction" />
  <NpmQuick v-else-if="route === 'npm-search'" :enter-action="enterAction" />
  <SkillsLib v-else-if="route === 'npm-skills'" @select="route = $event" />
  <SkillView v-else-if="route.startsWith('npm-skill-')" :code="route" />
  <NpmUi v-else :enter-action="enterAction" />
</template>
```

- [ ] **Step 2: 删除占位组件**

Run: `rm -rf src/Hello src/Read src/Write`
Expected: `src/` 下只剩 `App.vue / env.d.ts / main.css / main.ts / NpmUi / NpmQuick / NpmSettings / SkillView / SkillsLib / lib`

- [ ] **Step 3: 全量验证**

Run: `npm test`
Expected: 全部 PASS（Task 3-7 单元 + Task 10-11 组件）

Run: `npx vue-tsc --noEmit`
Expected: 退出码 0

Run: `npm run build`
Expected: 退出码 0，产出 `dist/` 与 `dist.zip`（含 `preload.js`）

- [ ] **Step 4: 记录完成**

---

### Task 14: README 与收尾

**Files:**
- Modify: `README.md`（重写为 npm 工具说明）
- Modify: `index.html`（`lang="en"` → `lang="zh-CN"`，可选）

**Interfaces:**
- 无新接口

- [ ] **Step 1: 重写 README.md**

内容要点（仿照 maven README 结构，用中文）：
- 项目标题与一句话简介（引用 plugin.json description）
- 功能特性：双源聚合搜索（官方 npm + npmmirror，Tab 切换）、一键复制（npm/pnpm/yarn）、README 使用指南、预置技能库、快捷搜索（over 触发）、镜像源设置
- 快捷键表（n/p/y/r/Enter/Esc/Cmd+K）
- 触发方式：`npm` 主面板、`技能库`、各技能指令（`npm init` 等）
- 项目结构、开发命令（dev/test/build）、安装到 ZTools 的步骤
- 技术栈与致谢

- [ ] **Step 2: 修改 index.html 语言**

把 `<html lang="en">` 改为 `<html lang="zh-CN">`。

- [ ] **Step 3: 最终全量验证**

Run: `npm test`
Expected: 全部 PASS

Run: `npm run build`
Expected: 退出码 0，`dist.zip` 生成，`dist/preload.js` 存在

Run: `node --check preload.js`
Expected: 退出码 0

- [ ] **Step 4: 手动冒烟（可选）**

在 ZTools 中加载 `dist.zip`：输入 `npm` 应打开主面板；输入 `npm init` 应打开技能详情；选中一段文本按空格应触发 `npm-search`。

---

## Self-Review（对照 spec）

- **Spec §2 plugin.json** → Task 2 Step 4/5 ✅（7 技能 + npm-ui/npm-search/npm-skills）
- **Spec §3 目录结构** → Task 1（main.css/env.d.ts/vite）、Task 2（lib 基础 + 删 public/preload）、Task 8（preload.js）、Task 9-13（组件）、Task 14（README）✅
- **Spec §4 双源聚合 / ServiceError / 设置** → Task 8（preload）、Task 9（NpmSettings）✅
- **Spec §5.1 App 路由 + ztools guard** → Task 13 ✅
- **Spec §5.2 三级面板 / 复制菜单 / 快捷键** → Task 12 ✅（n/p/y、Enter/c 菜单、r 指南、Esc、Cmd+K、/）
- **Spec §5.3 NpmQuick** → Task 10 ✅
- **Spec §5.4 NpmSettings** → Task 9 ✅
- **Spec §5.5 SkillsLib/SkillView** → Task 11 + Task 13 路由 ✅
- **Spec §6 数据模型** → Task 2 types.ts ✅
- **Spec §7 lib 各模块** → Task 3（parser）、4（version-tag）、5（command-builder）、6（markdown）、7（skills）、2（cache/theme）✅
- **Spec §8 测试计划** → Task 3-7 单元 + Task 10-11 组件 ✅
- **Spec §9 构建** → Task 1 package.json/vite、Task 13/14 build 验证 ✅
