# ZTools Batch Start Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vue 3 ZTools plugin that scans apps (system + custom dirs), supports manual categories, and registers launch groups as dynamic ZTools Features for near-simultaneous batch start.

**Architecture:** Preload hosts pure services (AppLibrary, Category, LaunchGroup, FeatureSync, Launcher, platform Scanners). Vue UI manages data via exposed preload APIs. Static Feature `manage` opens the UI; dynamic Features `group:<id>` launch a group then `outPlugin`. Persistence uses `ztools.db`.

**Tech Stack:** Vue 3, TypeScript, Vite, Vitest, `@ztools-center/plugin-cli` conventions, Node `fs`/`path`/`child_process` in preload, `ztools` host APIs.

**Spec:** `docs/superpowers/specs/2026-09-14-ztools-batch-start-design.md`

---

## File map

| Path | Responsibility |
|------|----------------|
| `plugin.json` | Plugin id, logo, preload, static `manage` feature, platforms |
| `package.json` | Scripts: `dev`, `build`, `test` |
| `vite.config.ts` | UI + preload build |
| `src/types.ts` | Shared domain types |
| `src/services/db.ts` | Thin `ztools.db.promises` helpers + id factories |
| `src/services/appLibrary.ts` | App CRUD, merge-on-scan, assign category |
| `src/services/category.ts` | Category CRUD; delete clears app.categoryId |
| `src/services/scanner/types.ts` | `ScannedApp`, `PlatformScanner` |
| `src/services/scanner/win.ts` | Start Menu `.lnk` + custom dirs `.exe/.bat/.cmd/.lnk` |
| `src/services/scanner/mac.ts` | `/Applications`, `~/Applications` `.app` + custom |
| `src/services/scanner/linux.ts` | `.desktop` + custom executables |
| `src/services/scanner/index.ts` | Pick scanner by `process.platform`, run + merge |
| `src/services/launcher.ts` | Parallel `shellOpenPath`, success/fail summary |
| `src/services/launchGroup.ts` | Group CRUD + validation |
| `src/services/featureSync.ts` | `setFeature` / `removeFeature` / reconcile |
| `src/services/enterRouter.ts` | Map `onPluginEnter` code → manage vs launch |
| `src/preload.ts` | Wire services, expose API, enter routing |
| `src/main.ts` / `src/App.vue` | Mount UI |
| `src/components/TopBar.vue` | Scan, add dir, trial launch |
| `src/components/CategorySidebar.vue` | Categories + 未分类 |
| `src/components/AppList.vue` | Search, select, change category |
| `src/components/GroupPanel.vue` | Groups edit + sync status |
| `tests/**/*.test.ts` | Unit tests with mocked `ztools` / fs |

---

### Task 1: Scaffold project in current repo

**Files:**
- Create: `package.json`, `plugin.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.ts`, `src/App.vue`, `src/env.d.ts`, `public/logo.png`, `vitest.config.ts`, `.gitignore`
- Keep: existing `docs/` and git remote `origin`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ztools-batch-start",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "vue": "^3.5.13"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@vitejs/plugin-vue": "^5.2.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.3",
    "vitest": "^2.1.8",
    "vue-tsc": "^2.1.10"
  }
}
```

- [ ] **Step 2: Create `plugin.json`**

```json
{
  "name": "batch-start",
  "title": "批量启动",
  "description": "扫描应用、手动分类，并将启动组注册为 ZTools 指令一键批量启动",
  "version": "0.1.0",
  "platform": ["win32", "darwin", "linux"],
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "features": [
    {
      "code": "manage",
      "explain": "管理应用分类与启动组",
      "cmds": ["批量启动", "应用启动组"]
    }
  ],
  "development": {
    "main": "http://localhost:5173"
  }
}
```

- [ ] **Step 3: Create Vite + TS + Vitest config and minimal Vue entry**

`vite.config.ts` must build UI to `dist/` and compile `src/preload.ts` to `dist/preload.js`. Copy `plugin.json` + `logo.png` into `dist` on build so `dist/` is the installable plugin app folder.

Minimal `src/App.vue`:

```vue
<template>
  <div class="app">批量启动 — 脚手架就绪</div>
</template>

<script setup lang="ts"></script>
```

Use a simple 128×128 PNG as `public/logo.png`.

`.gitignore`:

```
node_modules/
dist/
.DS_Store
*.local
.env*
```

- [ ] **Step 4: Install and verify**

Run: `npm install`  
Expected: lockfile created, no errors.

Run: `npm run build`  
Expected: exit 0; `dist/` contains `index.html` and `preload.js`.

- [ ] **Step 5: Commit**

```bash
git add package.json plugin.json vite.config.ts tsconfig.json tsconfig.node.json index.html src public vitest.config.ts .gitignore package-lock.json
git commit -m "chore: scaffold Vue ZTools batch-start plugin"
```

---

### Task 2: Domain types + db helpers

**Files:**
- Create: `src/types.ts`, `src/services/db.ts`, `tests/db.test.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
export type Platform = 'win32' | 'darwin' | 'linux'
export type AppSource = 'scan' | 'manual'

export interface AppDoc {
  _id: string
  _rev?: string
  name: string
  path: string
  icon?: string | null
  source: AppSource
  categoryId: string | null
  platform: Platform
}

export interface CategoryDoc {
  _id: string
  _rev?: string
  name: string
  order: number
}

export interface GroupDoc {
  _id: string
  _rev?: string
  name: string
  cmds: string[]
  appIds: string[]
  order: number
  featureSynced: boolean
}

export interface SettingsDoc {
  _id: 'settings'
  _rev?: string
  customScanDirs: string[]
  lastScanAt: number | null
}

export interface LaunchResult {
  success: number
  failed: number
  errors: Array<{ path: string; error: string }>
}
```

- [ ] **Step 2: Write failing test for id helpers**

`tests/db.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { makeAppId, makeCategoryId, makeGroupId } from '../src/services/db'

describe('id factories', () => {
  it('prefixes ids', () => {
    expect(makeAppId('abc')).toBe('app:abc')
    expect(makeCategoryId('abc')).toBe('category:abc')
    expect(makeGroupId('abc')).toBe('group:abc')
  })
})
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `npm test -- tests/db.test.ts`  
Expected: FAIL (module not found / export missing).

- [ ] **Step 4: Implement `src/services/db.ts`**

```typescript
import type { SettingsDoc } from '../types'

export function makeAppId(uuid: string): string {
  return `app:${uuid}`
}
export function makeCategoryId(uuid: string): string {
  return `category:${uuid}`
}
export function makeGroupId(uuid: string): string {
  return `group:${uuid}`
}

export function newId(): string {
  return crypto.randomUUID()
}

export type ZtoolsDb = {
  put: (doc: object) => Promise<object>
  get: (id: string) => Promise<object | null>
  remove: (docOrId: object | string) => Promise<object>
  allDocs: (key?: string) => Promise<object[]>
}

export function getDb(): ZtoolsDb {
  // @ts-expect-error host injects ztools in plugin runtime
  const z = globalThis.ztools ?? (window as any).ztools
  return z.db.promises
}

export async function getSettings(db: ZtoolsDb = getDb()): Promise<SettingsDoc> {
  const existing = (await db.get('settings')) as SettingsDoc | null
  if (existing) return existing
  const doc: SettingsDoc = {
    _id: 'settings',
    customScanDirs: [],
    lastScanAt: null,
  }
  await db.put(doc)
  return (await db.get('settings')) as SettingsDoc
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npm test -- tests/db.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/services/db.ts tests/db.test.ts
git commit -m "feat: add domain types and db id helpers"
```

---

### Task 3: Category + AppLibrary services

**Files:**
- Create: `src/services/category.ts`, `src/services/appLibrary.ts`, `tests/mocks/memoryDb.ts`, `tests/category.test.ts`, `tests/appLibrary.test.ts`

- [ ] **Step 1: Create in-memory db mock**

`tests/mocks/memoryDb.ts`:

```typescript
import type { ZtoolsDb } from '../../src/services/db'

export function createMemoryDb(): ZtoolsDb {
  const map = new Map<string, any>()
  return {
    async put(doc: any) {
      const prev = map.get(doc._id)
      const revNum = prev?._rev ? Number(String(prev._rev).split('-')[1]) + 1 : 1
      const next = { ...doc, _rev: `rev-${revNum}` }
      map.set(doc._id, next)
      return next
    },
    async get(id: string) {
      return map.get(id) ?? null
    },
    async remove(docOrId: any) {
      const id = typeof docOrId === 'string' ? docOrId : docOrId._id
      map.delete(id)
      return { ok: true, id }
    },
    async allDocs(key?: string) {
      const all = [...map.values()]
      if (!key) return all
      return all.filter((d) => String(d._id).startsWith(key))
    },
  }
}
```

- [ ] **Step 2: Write failing category tests**

```typescript
import { describe, it, expect } from 'vitest'
import { createMemoryDb } from './mocks/memoryDb'
import { createCategory, deleteCategory, listCategories } from '../src/services/category'
import { upsertApp, listApps } from '../src/services/appLibrary'
import { makeAppId } from '../src/services/db'

describe('category', () => {
  it('creates and lists categories', async () => {
    const db = createMemoryDb()
    const c = await createCategory(db, '开发')
    expect(c.name).toBe('开发')
    expect(c._id.startsWith('category:')).toBe(true)
    expect((await listCategories(db)).length).toBe(1)
  })

  it('deleteCategory clears app.categoryId', async () => {
    const db = createMemoryDb()
    const c = await createCategory(db, '办公')
    await upsertApp(db, {
      _id: makeAppId('1'),
      name: 'A',
      path: 'C:/a.exe',
      source: 'manual',
      categoryId: c._id,
      platform: 'win32',
    })
    await deleteCategory(db, c._id)
    const apps = await listApps(db)
    expect(apps[0].categoryId).toBeNull()
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npm test -- tests/category.test.ts`  
Expected: FAIL (missing modules).

- [ ] **Step 4: Implement `category.ts` and `appLibrary.ts`**

`src/services/category.ts` exports: `createCategory`, `renameCategory`, `deleteCategory`, `listCategories` (sorted by `order`).

`src/services/appLibrary.ts` exports: `upsertApp`, `listApps`, `assignCategory`, `removeApp`, `mergeScannedApps(db, scanned[])`:
- Match existing by case-normalized `path`
- On match: keep existing `categoryId` and `name`; refresh `platform` / optional icon
- On insert: `categoryId: null`, `source: 'scan'`

- [ ] **Step 5: Add merge test in `tests/appLibrary.test.ts`**

```typescript
it('mergeScannedApps keeps categoryId on path match', async () => {
  const db = createMemoryDb()
  await upsertApp(db, {
    _id: makeAppId('1'),
    name: 'Old',
    path: 'C:/Tool/a.exe',
    source: 'scan',
    categoryId: 'category:x',
    platform: 'win32',
  })
  await mergeScannedApps(db, [
    { name: 'New', path: 'C:/Tool/a.exe', platform: 'win32' },
  ])
  const apps = await listApps(db)
  expect(apps).toHaveLength(1)
  expect(apps[0].categoryId).toBe('category:x')
  expect(apps[0].name).toBe('Old')
})
```

Implement until all category/appLibrary tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/category.ts src/services/appLibrary.ts tests
git commit -m "feat: add category and app library services"
```

---

### Task 4: Platform scanners

**Files:**
- Create: `src/services/scanner/types.ts`, `win.ts`, `mac.ts`, `linux.ts`, `index.ts`
- Create: `tests/scanner-win.test.ts`, `tests/scanner-index.test.ts`

- [ ] **Step 1: Define scanner types**

```typescript
import type { Platform } from '../../types'

export interface ScannedApp {
  name: string
  path: string
  platform: Platform
}

export interface PlatformScanner {
  scanSystem(): Promise<ScannedApp[]>
  scanCustomDir(dir: string): Promise<ScannedApp[]>
}
```

- [ ] **Step 2: Write Windows custom-dir test with injectable fs**

`createWinScanner({ readdir, stat, resolveLnk })` for testability.

```typescript
it('scanCustomDir includes exe bat cmd lnk', async () => {
  const files = ['a.exe', 'b.bat', 'c.cmd', 'd.lnk', 'e.txt']
  const scanner = createWinScanner({
    readdir: async () => files,
    stat: async () => ({ isFile: () => true, isDirectory: () => false }),
    resolveLnk: async (p: string) => ({
      name: 'D',
      target: p.replace(/\.lnk$/i, '.exe'),
    }),
  })
  const apps = await scanner.scanCustomDir('C:/Apps')
  const names = apps.map((a) => a.path.toLowerCase())
  expect(names.some((p) => p.endsWith('a.exe'))).toBe(true)
  expect(names.some((p) => p.endsWith('b.bat'))).toBe(true)
  expect(names.some((p) => p.endsWith('c.cmd'))).toBe(true)
  expect(names.some((p) => p.endsWith('.exe'))).toBe(true) // resolved lnk
  expect(names.some((p) => p.endsWith('e.txt'))).toBe(false)
})
```

- [ ] **Step 3: Run — expect FAIL, then implement Win/Mac/Linux**

**Windows:**
- System: `%AppData%\Microsoft\Windows\Start Menu\Programs` and `%ProgramData%\Microsoft\Windows\Start Menu\Programs`, recursive `.lnk`
- Resolve shortcut via PowerShell COM `WScript.Shell.CreateShortcut`
- Custom dirs: recursive depth ≤ 4 for `.exe|.bat|.cmd|.lnk`
- Missing dirs: skip, do not throw

**macOS:**
- `/Applications`, `~/Applications` — each `.app` → path = bundle, name = basename without `.app`
- Custom: `.app` + files with execute bit

**Linux:**
- `/usr/share/applications`, `~/.local/share/applications` — parse `Name=` / `Exec=` (strip `%u` etc., first token)
- Custom: execute-bit files

**`index.ts` `runFullScan`:** pick scanner → system + `settings.customScanDirs` → `mergeScannedApps` → update `lastScanAt`.

- [ ] **Step 4: Tests pass + commit**

```bash
git add src/services/scanner tests/scanner-win.test.ts tests/scanner-index.test.ts
git commit -m "feat: add win/mac/linux app scanners"
```

---

### Task 5: Launcher (parallel open)

**Files:**
- Create: `src/services/launcher.ts`, `tests/launcher.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { launchPaths } from '../src/services/launcher'

describe('launchPaths', () => {
  it('opens all paths in parallel and summarizes failures', async () => {
    const open = vi.fn(async (p: string) => {
      if (p.includes('bad')) return { success: false, error: 'missing' }
      return { success: true }
    })
    const result = await launchPaths(['/a', '/bad', '/c'], open)
    expect(open).toHaveBeenCalledTimes(3)
    expect(result.success).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors[0].path).toBe('/bad')
  })
})
```

- [ ] **Step 2: Implement**

```typescript
import type { LaunchResult } from '../types'

export type OpenPath = (
  fullPath: string,
) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string }

export async function launchPaths(paths: string[], openPath: OpenPath): Promise<LaunchResult> {
  const settled = await Promise.all(
    paths.map(async (path) => {
      try {
        const res = await Promise.resolve(openPath(path))
        if (!res?.success) return { path, ok: false as const, error: res?.error || 'open failed' }
        return { path, ok: true as const, error: '' }
      } catch (e: any) {
        return { path, ok: false as const, error: String(e?.message ?? e) }
      }
    }),
  )
  const errors = settled.filter((s) => !s.ok).map((s) => ({ path: s.path, error: s.error }))
  return {
    success: settled.filter((s) => s.ok).length,
    failed: errors.length,
    errors,
  }
}

export async function launchGroupApps(
  paths: string[],
  openPath: OpenPath = (p) => {
    // @ts-expect-error host
    return ztools.shellOpenPath(p)
  },
): Promise<LaunchResult> {
  return launchPaths(paths, openPath)
}
```

- [ ] **Step 3: Tests pass + commit**

```bash
git add src/services/launcher.ts tests/launcher.test.ts
git commit -m "feat: add parallel launcher with failure summary"
```

---

### Task 6: LaunchGroup validation + FeatureSync

**Files:**
- Create: `src/services/launchGroup.ts`, `src/services/featureSync.ts`, `tests/launchGroup.test.ts`, `tests/featureSync.test.ts`

- [ ] **Step 1: Failing validation tests**

```typescript
it('rejects empty name', async () => {
  await expect(
    saveGroup(db, { name: '  ', cmds: [], appIds: ['app:1'], order: 0 }),
  ).rejects.toThrow(/name/i)
})

it('rejects zero apps', async () => {
  await expect(
    saveGroup(db, { name: 'Dev', cmds: ['Dev'], appIds: [], order: 0 }),
  ).rejects.toThrow(/app/i)
})

it('rejects duplicate cmd against other groups', async () => {
  await saveGroup(db, { name: 'A', cmds: ['开工'], appIds: ['app:1'], order: 0 })
  await expect(
    saveGroup(db, { name: 'B', cmds: ['开工'], appIds: ['app:2'], order: 1 }),
  ).rejects.toThrow(/conflict|冲突|cmd/i)
})
```

- [ ] **Step 2: Implement `launchGroup.ts`**

Exports: `saveGroup`, `deleteGroup`, `listGroups`, `getGroup`.

Rules:
- `name.trim()` required
- `appIds.length >= 1`
- default `cmds` to `[name.trim()]` if empty
- cmd conflict: any overlapping cmd string with another group (case-sensitive)
- new docs use `makeGroupId(newId())`, `featureSynced: false`

- [ ] **Step 3: FeatureSync tests + implement**

```typescript
it('setFeature on syncGroup and marks featureSynced', async () => {
  const setFeature = vi.fn(() => true)
  const removeFeature = vi.fn(() => true)
  const group = await saveGroup(db, {
    name: '开工',
    cmds: ['开工'],
    appIds: ['app:1'],
    order: 0,
  })
  await syncGroupFeature(group, { setFeature, removeFeature }, db)
  expect(setFeature).toHaveBeenCalledWith(
    expect.objectContaining({ code: group._id, cmds: ['开工'] }),
  )
  expect((await getGroup(db, group._id))!.featureSynced).toBe(true)
})

it('reconcile removes orphan features and restores missing', async () => {
  const setFeature = vi.fn(() => true)
  const removeFeature = vi.fn(() => true)
  const keep = await saveGroup(db, {
    name: 'Keep',
    cmds: ['Keep'],
    appIds: ['app:1'],
    order: 0,
  })
  const getFeatures = () => [{ code: 'group:orphan' }, { code: keep._id }]
  await reconcileFeatures(db, { setFeature, removeFeature, getFeatures })
  expect(removeFeature).toHaveBeenCalledWith('group:orphan')
})
```

`syncGroupFeature` / `removeGroupFeature` / `reconcileFeatures` as in design: `setFeature({ code: group._id, explain: \`启动组：${group.name}\`, cmds })`; on failure set `featureSynced: false` but keep local doc.

- [ ] **Step 4: Pass + commit**

```bash
git add src/services/launchGroup.ts src/services/featureSync.ts tests/launchGroup.test.ts tests/featureSync.test.ts
git commit -m "feat: add launch groups and feature sync"
```

---

### Task 7: Preload wiring + onPluginEnter routing

**Files:**
- Create: `src/services/enterRouter.ts`, `tests/preload-routing.test.ts`
- Modify: `src/preload.ts`

- [ ] **Step 1: Router + test**

```typescript
export type EnterAction =
  | { type: 'manage' }
  | { type: 'launch-group'; groupId: string }

export function routePluginEnter(code: string | undefined): EnterAction {
  if (!code || code === 'manage') return { type: 'manage' }
  if (code.startsWith('group:')) return { type: 'launch-group', groupId: code }
  return { type: 'manage' }
}
```

```typescript
expect(routePluginEnter('manage')).toEqual({ type: 'manage' })
expect(routePluginEnter('group:abc')).toEqual({
  type: 'launch-group',
  groupId: 'group:abc',
})
```

- [ ] **Step 2: Implement `src/preload.ts`**

Expose `window.batchStart` with:
`listApps`, `listCategories`, `listGroups`, `getSettings`, `createCategory`, `renameCategory`, `deleteCategory`, `assignCategory`, `addManualApp`, `addCustomScanDir`, `removeCustomScanDir`, `runScan`, `saveGroup`, `deleteGroup`, `retrySyncGroup`, `reconcileFeatures`, `launchGroup(groupId)`.

On `ztools.onPluginEnter`:
1. `reconcileFeatures`
2. If `launch-group`: resolve app paths → `launchGroupApps` → `showToast(\`成功 ${n} / 失败 ${m}\`)` → `outPlugin()`
3. If `manage`: UI only

Manual add filters: win `exe,bat,cmd,lnk`; mac/linux permissive. Custom dir via `showOpenDialog({ properties: ['openDirectory'] })`.

- [ ] **Step 3: Manual smoke checklist in ZTools**

- 「批量启动」opens UI  
- Save group → cmd appears in search  
- Trigger group → apps open, plugin exits  

- [ ] **Step 4: Commit**

```bash
git add src/preload.ts src/services/enterRouter.ts tests/preload-routing.test.ts
git commit -m "feat: wire preload APIs and plugin enter routing"
```

---

### Task 8: Management UI

**Files:**
- Modify: `src/App.vue`, `src/main.ts`
- Create: `src/components/TopBar.vue`, `CategorySidebar.vue`, `AppList.vue`, `GroupPanel.vue`, `src/styles.css`

- [ ] **Step 1: Layout shell**

Top bar + left categories + center apps + right groups. Load data on mount from `window.batchStart`.

Empty states: no apps → CTA 扫描应用; no groups → CTA 创建启动组.

- [ ] **Step 2: TopBar**

扫描 / 添加目录 / 试跑当前组; show `lastScanAt`; disable 试跑 when no selection.

- [ ] **Step 3: CategorySidebar + AppList**

Filter by category (`null` = 未分类); search; multi-select for join group; category dropdown; red badge + 重试同步 when `featureSynced === false`.

- [ ] **Step 4: GroupPanel**

CRUD groups; edit cmds; member list; save with validation error toast.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src
git commit -m "feat: add management UI for scan, categories, and groups"
```

---

### Task 9: End-to-end hardening

**Files:**
- Modify: as needed from QA
- Create: `README.md`

- [ ] **Step 1: QA checklist**

- [ ] Windows `.bat` in custom dir / manual add launches in group  
- [ ] Duplicate cmd rejected  
- [ ] Delete group removes Feature  
- [ ] Invalid path: partial success toast  
- [ ] `npm test` green  
- [ ] `npm run build` succeeds  

- [ ] **Step 2: README**

Document: Node requirement, `npm i && npm run build`, load plugin in ZTools, scan → categorize → create group → trigger cmd.

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: add usage README and finish MVP hardening"
```

- [ ] **Step 4: Push only if user explicitly asks**

```bash
git push -u origin master
```

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| System + custom dir scan | 4 |
| Manual categories | 3, 8 |
| Launch groups → dynamic Features | 6, 7 |
| Full manage UI | 8 |
| Win/Mac/Linux | 4, `plugin.json` platforms |
| Parallel launch | 5 |
| Win exe/bat/cmd/lnk | 4, 7 |
| Errors / toast / sync retry | 5, 6, 8 |
| Core unit tests | 2–7 |

## Consistency check

- Feature codes: static `manage`, dynamic `group:<uuid>` (= `GroupDoc._id`) across Tasks 6–8.
- Windows extensions: `.exe|.bat|.cmd|.lnk` only.
- No TBD / placeholder steps.
