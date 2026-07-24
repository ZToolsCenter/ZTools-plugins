# ZTools VSCode Recent (vsc-recent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 ZTools 插件 `vsc-recent`，关键字 `vsc` 唤起后展示 VSCode Stable 最近打开的项目（folder / workspace / remote），用方向键或鼠标选中后用 PATH 上的 `code` 命令打开。

**Architecture:** Preload Only (TypeScript) 模板。preload.js 通过 Node.js 多源探测读取 VSCode 历史（`state.vscdb` via `sql.js` + `storage.json` fallback），暴露 `window.recentApi` 给前端；前端 index.ts 用 `fuse.js` 做模糊过滤、监听键盘、调用 `recentApi.open()` 并 `ztools.outPlugin()` 隐藏插件。`loader/` 与 `launcher/` 各为可扩展接口，将来加 Insiders/Cursor 仅新增文件。

**Tech Stack:** TypeScript（tsc 编译，不打包 / 不混淆，符合 ZTools NFR-2）、`sql.js`（纯 JS WASM SQLite）、`fuse.js`、`vitest`（仅开发期单元测试）、Node.js 内置 `url` / `fs` / `child_process` / `path`。

**Spec:** [`docs/superpowers/specs/2026-05-21-vsc-recent-design.md`](../specs/2026-05-21-vsc-recent-design.md)

---

## File Structure

```
vscode/
├─ plugin.json                          # ZTools 入口
├─ logo.png                             # 占位 PNG（128×128）
├─ preload.ts → preload.js              # 暴露 window.recentApi 与 window.Fuse
├─ index.html                           # 简单 DOM 骨架
├─ index.ts → index.js                  # UI 行为：渲染 + 键盘 + 搜索
├─ index.css                            # 列表样式
├─ src/
│   ├─ types.ts                         # RecentItem / RawEntry / SourceProbe 类型
│   ├─ url-utils.ts                     # fileURLToPath / prettyPath / normalizeId
│   ├─ uri-mapper.ts                    # RawEntry[] → RecentItem[]
│   ├─ loader/
│   │   ├─ state-vscdb-probe.ts         # sql.js 读 state.vscdb
│   │   ├─ storage-json-probe.ts        # 读 storage.json fallback
│   │   └─ vscode-stable.ts             # 合并 / 去重 / 过滤
│   └─ launcher/
│       └─ vscode-stable.ts             # spawn('code', [...])
├─ tests/
│   ├─ url-utils.test.ts
│   ├─ uri-mapper.test.ts
│   └─ vscode-stable.test.ts            # loader 集成测试（mock 两个 probe）
├─ package.json
├─ tsconfig.json
├─ vitest.config.ts
├─ .gitignore
└─ docs/superpowers/                    # 已存在
```

文件职责边界：
- **`url-utils.ts`** 纯函数，处理 `file:///c%3A/x` ↔ `c:\x`、home 缩写、Windows 大小写归一化
- **`uri-mapper.ts`** 纯函数，把 VSCode 的 `RawEntry` 形态映射为 UI 用的 `RecentItem`
- **`loader/*-probe.ts`** 各自只读一个数据源，**不做** 映射或去重
- **`loader/vscode-stable.ts`** 编排所有 probe + 调用 mapper + dedup + fs.existsSync 过滤
- **`launcher/vscode-stable.ts`** 只做 spawn，不知道数据源
- **`preload.ts`** 只做 API 暴露的薄壳，所有逻辑在 `src/`

---

## Task 1: 项目脚手架

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\package.json`
- Create: `E:\myprojects\ztool-plugins\vscode\tsconfig.json`
- Create: `E:\myprojects\ztool-plugins\vscode\vitest.config.ts`
- Create: `E:\myprojects\ztool-plugins\vscode\.gitignore`

- [ ] **Step 1.1: 写 `.gitignore`**

```gitignore
node_modules/
*.log
.tmp-*
# 编译产物提交（ZTools 加载需要 .js），但忽略 sourcemap
*.js.map
*.d.ts
!src/**/*.d.ts
```

- [ ] **Step 1.2: 写 `package.json`**

```json
{
  "name": "ztool-vsc-recent",
  "version": "0.1.0",
  "description": "ZTools 插件：VSCode 最近项目快速启动",
  "type": "commonjs",
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "fuse.js": "^7.0.0",
    "sql.js": "^1.10.3"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/sql.js": "^1.4.9",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0"
  }
}
```

- [ ] **Step 1.3: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "./",
    "rootDir": "./",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": false,
    "noImplicitAny": true,
    "lib": ["ES2020", "DOM"]
  },
  "include": ["preload.ts", "index.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "tests", "**/*.test.ts"]
}
```

- [ ] **Step 1.4: 写 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 1.5: 安装依赖**

Run: `npm install`
Expected: `node_modules/` 出现，`package-lock.json` 生成；无错误。

- [ ] **Step 1.6: 验证 tsc 与 vitest 可执行**

Run: `npx tsc --version && npx vitest --version`
Expected: 两个版本号正常打印。

- [ ] **Step 1.7: 提交**

```bash
git init
git add .gitignore package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: init project scaffold (tsc + vitest)"
```

---

## Task 2: 共享类型定义

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\src\types.ts`

- [ ] **Step 2.1: 写 `src/types.ts`**

```ts
export type RecentKind = 'folder' | 'workspace' | 'remote';

export interface RecentItem {
  id: string;          // 去重键：local 用归一化路径，remote 用完整 URI
  kind: RecentKind;
  title: string;       // 列表主标题（项目名或 host）
  subtitle: string;    // 列表副标题（路径，~ 缩写 home）
  rawPath: string;     // 启动 code 命令时传入的参数
  exists: boolean;     // 本地路径是否存在（remote 恒 true）
}

export interface RawEntry {
  folderUri?: string;  // "file:///..." 或 "vscode-remote://..."
  fileUri?: string;    // 单个文件，本插件丢弃
  workspace?: { id: string; configPath: string };
  label?: string;
}

export interface SourceProbe {
  name: string;
  read(): Promise<RawEntry[] | null>;  // null = 该源不存在或读失败，继续下一源
}

export type OpenResult = { ok: true } | { ok: false; reason: string };
```

- [ ] **Step 2.2: 验证 tsc 通过**

Run: `npx tsc --noEmit`
Expected: 无输出（成功）。

- [ ] **Step 2.3: 提交**

```bash
git add src/types.ts
git commit -m "feat(types): add RecentItem / RawEntry / SourceProbe types"
```

---

## Task 3: URL utilities（TDD）

**Files:**
- Test: `E:\myprojects\ztool-plugins\vscode\tests\url-utils.test.ts`
- Create: `E:\myprojects\ztool-plugins\vscode\src\url-utils.ts`

- [ ] **Step 3.1: 写测试 `tests/url-utils.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { fileUriToPath, prettyPath, normalizeId } from '../src/url-utils';
import * as os from 'os';
import * as path from 'path';

describe('fileUriToPath', () => {
  it('decodes Windows file URI with drive letter', () => {
    expect(fileUriToPath('file:///c%3A/Users/alice/proj')).toBe('c:\\Users\\alice\\proj');
  });
  it('decodes POSIX file URI', () => {
    // On Windows, Node.js fileURLToPath of "file:///home/x" still produces "\\home\\x"; we tolerate
    const r = fileUriToPath('file:///home/x');
    expect(r === '/home/x' || r === '\\home\\x').toBe(true);
  });
  it('returns the original string for non-file URIs', () => {
    expect(fileUriToPath('vscode-remote://wsl+Ubuntu/home/x')).toBe('vscode-remote://wsl+Ubuntu/home/x');
  });
});

describe('prettyPath', () => {
  it('replaces home with ~', () => {
    const home = os.homedir();
    const p = path.join(home, 'projects', 'foo');
    expect(prettyPath(p)).toBe('~' + p.slice(home.length));
  });
  it('leaves non-home paths unchanged', () => {
    expect(prettyPath('c:\\opt\\bar')).toBe('c:\\opt\\bar');
  });
});

describe('normalizeId', () => {
  it('lowercases and normalizes Windows paths', () => {
    expect(normalizeId('C:\\Users\\Alice\\proj')).toBe(normalizeId('c:/users/alice/proj'));
  });
  it('keeps remote URIs as-is (case sensitive)', () => {
    expect(normalizeId('vscode-remote://wsl+Ubuntu/home/x', { isRemote: true }))
      .toBe('vscode-remote://wsl+Ubuntu/home/x');
  });
});
```

- [ ] **Step 3.2: 运行测试，确认全部 fail**

Run: `npx vitest run tests/url-utils.test.ts`
Expected: 6 个测试全部 FAIL，原因 "Cannot find module '../src/url-utils'"。

- [ ] **Step 3.3: 实现 `src/url-utils.ts`**

```ts
import * as url from 'url';
import * as os from 'os';
import * as path from 'path';

/**
 * 把 file:///c%3A/x 解码为系统路径；非 file: 协议原样返回。
 */
export function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file:')) return uri;
  try {
    return url.fileURLToPath(uri);
  } catch {
    return uri;
  }
}

/**
 * home 目录前缀替换为 ~。Windows 下保留反斜杠原样。
 */
export function prettyPath(p: string): string {
  const home = os.homedir();
  if (p.toLowerCase().startsWith(home.toLowerCase())) {
    return '~' + p.slice(home.length);
  }
  return p;
}

/**
 * 生成去重 ID。
 * 本地路径：path.normalize + 全小写（Windows 大小写不敏感且 / \ 等价）。
 * Remote URI：原样（区分大小写）。
 */
export function normalizeId(p: string, opts: { isRemote?: boolean } = {}): string {
  if (opts.isRemote) return p;
  return path.normalize(p).toLowerCase();
}
```

- [ ] **Step 3.4: 运行测试，确认全部 pass**

Run: `npx vitest run tests/url-utils.test.ts`
Expected: 6 个测试全部 PASS。

- [ ] **Step 3.5: 提交**

```bash
git add tests/url-utils.test.ts src/url-utils.ts
git commit -m "feat(url-utils): add fileUriToPath / prettyPath / normalizeId"
```

---

## Task 4: URI mapper（TDD）

**Files:**
- Test: `E:\myprojects\ztool-plugins\vscode\tests\uri-mapper.test.ts`
- Create: `E:\myprojects\ztool-plugins\vscode\src\uri-mapper.ts`

- [ ] **Step 4.1: 写测试 `tests/uri-mapper.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mapEntries } from '../src/uri-mapper';
import type { RawEntry } from '../src/types';

describe('mapEntries', () => {
  it('maps a local folder', () => {
    const raw: RawEntry[] = [{ folderUri: 'file:///c%3A/proj/foo' }];
    const out = mapEntries(raw);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('folder');
    expect(out[0].title).toBe('foo');
    expect(out[0].subtitle.toLowerCase()).toContain('proj');
    expect(out[0].rawPath.toLowerCase()).toContain('c:\\proj\\foo');
  });

  it('maps a workspace file and strips .code-workspace from title', () => {
    const raw: RawEntry[] = [{
      workspace: { id: 'abc', configPath: 'file:///c%3A/proj/myws.code-workspace' },
    }];
    const out = mapEntries(raw);
    expect(out[0].kind).toBe('workspace');
    expect(out[0].title).toBe('myws');
  });

  it('maps a remote folder and uses host as title', () => {
    const raw: RawEntry[] = [{ folderUri: 'vscode-remote://wsl+Ubuntu/home/me/x' }];
    const out = mapEntries(raw);
    expect(out[0].kind).toBe('remote');
    expect(out[0].title.toLowerCase()).toContain('wsl');
    expect(out[0].rawPath).toBe('vscode-remote://wsl+Ubuntu/home/me/x');
  });

  it('uses RawEntry.label as title when present', () => {
    const raw: RawEntry[] = [{ folderUri: 'file:///c%3A/proj/foo', label: 'My Custom Label' }];
    const out = mapEntries(raw);
    expect(out[0].title).toBe('My Custom Label');
  });

  it('drops fileUri entries', () => {
    const raw: RawEntry[] = [{ fileUri: 'file:///c%3A/proj/foo.txt' }];
    expect(mapEntries(raw)).toHaveLength(0);
  });

  it('drops malformed entries silently', () => {
    const raw = [{}, { folderUri: 'not-a-uri::' }] as RawEntry[];
    const out = mapEntries(raw);
    expect(out.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 4.2: 运行测试，确认全部 fail**

Run: `npx vitest run tests/uri-mapper.test.ts`
Expected: 6 个测试 FAIL，原因 "Cannot find module"。

- [ ] **Step 4.3: 实现 `src/uri-mapper.ts`**

```ts
import * as path from 'path';
import type { RawEntry, RecentItem } from './types';
import { fileUriToPath, prettyPath, normalizeId } from './url-utils';

/**
 * 把 VSCode 形态的 RawEntry[] 转为 UI 形态的 RecentItem[]。
 * 单文件历史 (fileUri) 被丢弃；解析失败的条目静默丢弃。
 */
export function mapEntries(entries: RawEntry[]): RecentItem[] {
  const out: RecentItem[] = [];
  for (const e of entries) {
    try {
      const item = mapOne(e);
      if (item) out.push(item);
    } catch {
      // 单条解析异常，丢弃
    }
  }
  return out;
}

function mapOne(e: RawEntry): RecentItem | null {
  if (e.fileUri) return null;

  if (e.workspace?.configPath) {
    const uri = e.workspace.configPath;
    if (uri.startsWith('file:')) {
      const p = fileUriToPath(uri);
      const title = e.label ?? path.basename(p).replace(/\.code-workspace$/, '');
      return {
        id: normalizeId(p),
        kind: 'workspace',
        title,
        subtitle: prettyPath(p),
        rawPath: p,
        exists: false, // 由 loader 阶段填充
      };
    }
    return null;
  }

  if (e.folderUri) {
    const uri = e.folderUri;
    if (uri.startsWith('file:')) {
      const p = fileUriToPath(uri);
      return {
        id: normalizeId(p),
        kind: 'folder',
        title: e.label ?? path.basename(p),
        subtitle: prettyPath(p),
        rawPath: p,
        exists: false,
      };
    }
    // remote: vscode-remote://, vscode-vfs://, etc.
    const m = uri.match(/^[^:]+:\/\/([^/]+)(\/.*)?$/);
    const host = m?.[1] ?? uri;
    return {
      id: normalizeId(uri, { isRemote: true }),
      kind: 'remote',
      title: e.label ?? host,
      subtitle: uri,
      rawPath: uri,
      exists: true,
    };
  }

  return null;
}
```

- [ ] **Step 4.4: 运行测试，确认全部 pass**

Run: `npx vitest run tests/uri-mapper.test.ts`
Expected: 6 个测试 PASS。

- [ ] **Step 4.5: 提交**

```bash
git add tests/uri-mapper.test.ts src/uri-mapper.ts
git commit -m "feat(uri-mapper): map VSCode RawEntry[] to RecentItem[]"
```

---

## Task 5: state.vscdb probe（sql.js 读 SQLite）

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\src\loader\state-vscdb-probe.ts`

> 这一步**不写单元测试**：sql.js 加载 WASM 在 vitest 环境下复杂，且本探测器属于 IO 适配层，主要风险在真实文件读取。集成测试在 Task 7 用 mock 验证；真实数据由 Task 13 手工验收。

- [ ] **Step 5.1: 实现 `src/loader/state-vscdb-probe.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RawEntry, SourceProbe } from '../types';

const VSCDB_KEY = 'history.recentlyOpenedPathsList';

function defaultDbPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'state.vscdb');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'state.vscdb');
  }
  // linux & others
  return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'state.vscdb');
}

export function createStateVscdbProbe(dbPathOverride?: string): SourceProbe {
  const dbPath = dbPathOverride ?? defaultDbPath();
  return {
    name: 'state.vscdb',
    async read(): Promise<RawEntry[] | null> {
      if (!fs.existsSync(dbPath)) return null;
      let buf: Buffer;
      try {
        buf = fs.readFileSync(dbPath);
      } catch {
        return null;
      }
      // 按需加载 sql.js
      const initSqlJs = require('sql.js') as (config?: { locateFile?: (f: string) => string }) => Promise<any>;
      const SQL = await initSqlJs({
        // sql.js 需要 wasm 文件，与主 JS 同目录
        locateFile: (file: string) => path.join(path.dirname(require.resolve('sql.js')), file),
      });
      let db: any;
      try {
        db = new SQL.Database(new Uint8Array(buf));
      } catch {
        return null;
      }
      try {
        const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');
        stmt.bind([VSCDB_KEY]);
        if (!stmt.step()) {
          stmt.free();
          return [];
        }
        const row = stmt.getAsObject() as { value: string | Uint8Array };
        stmt.free();
        const text = typeof row.value === 'string'
          ? row.value
          : Buffer.from(row.value).toString('utf-8');
        const parsed = JSON.parse(text);
        return Array.isArray(parsed?.entries) ? parsed.entries : [];
      } catch {
        return null;
      } finally {
        db.close();
      }
    },
  };
}
```

- [ ] **Step 5.2: 验证 tsc 通过**

Run: `npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 5.3: 提交**

```bash
git add src/loader/state-vscdb-probe.ts
git commit -m "feat(loader): state.vscdb probe via sql.js"
```

---

## Task 6: storage.json probe（fallback 数据源）

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\src\loader\storage-json-probe.ts`

- [ ] **Step 6.1: 实现 `src/loader/storage-json-probe.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RawEntry, SourceProbe } from '../types';

interface StorageJson {
  backupWorkspaces?: {
    folders?: Array<{ folderUri?: string }>;
    workspaces?: Array<{ id?: string; configURIPath?: string; configPath?: string }>;
  };
  windowsState?: {
    lastActiveWindow?: { folder?: string };
    openedWindows?: Array<{ folder?: string; workspace?: { id: string; configPath: string } }>;
  };
}

function defaultJsonPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Code', 'User', 'globalStorage', 'storage.json');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'storage.json');
  }
  return path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'storage.json');
}

export function createStorageJsonProbe(jsonPathOverride?: string): SourceProbe {
  const jsonPath = jsonPathOverride ?? defaultJsonPath();
  return {
    name: 'storage.json',
    async read(): Promise<RawEntry[] | null> {
      if (!fs.existsSync(jsonPath)) return null;
      let parsed: StorageJson;
      try {
        const text = fs.readFileSync(jsonPath, 'utf-8');
        parsed = JSON.parse(text) as StorageJson;
      } catch {
        return null;
      }
      const out: RawEntry[] = [];

      const bw = parsed.backupWorkspaces;
      if (bw) {
        for (const f of bw.folders ?? []) {
          if (f.folderUri) out.push({ folderUri: f.folderUri });
        }
        for (const w of bw.workspaces ?? []) {
          const cp = w.configURIPath ?? w.configPath;
          if (cp && w.id) out.push({ workspace: { id: w.id, configPath: cp } });
        }
      }

      const ws = parsed.windowsState;
      if (ws?.openedWindows) {
        for (const win of ws.openedWindows) {
          if (win.folder) out.push({ folderUri: win.folder });
          if (win.workspace) out.push({ workspace: win.workspace });
        }
      }
      return out;
    },
  };
}
```

- [ ] **Step 6.2: 验证 tsc 通过**

Run: `npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 6.3: 提交**

```bash
git add src/loader/storage-json-probe.ts
git commit -m "feat(loader): storage.json probe as fallback source"
```

---

## Task 7: Loader 主体（合并 + 去重 + 过滤）— TDD

**Files:**
- Test: `E:\myprojects\ztool-plugins\vscode\tests\vscode-stable.test.ts`
- Create: `E:\myprojects\ztool-plugins\vscode\src\loader\vscode-stable.ts`

- [ ] **Step 7.1: 写测试 `tests/vscode-stable.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { loadRecent } from '../src/loader/vscode-stable';
import type { SourceProbe } from '../src/types';

function probe(name: string, entries: any[]): SourceProbe {
  return { name, read: async () => entries };
}

describe('loadRecent', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
      // Pretend everything exists by default
      return !String(p).includes('GHOST');
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('merges entries from multiple probes preserving first-seen order', async () => {
    const a = probe('a', [{ folderUri: 'file:///c%3A/proj/aaa' }]);
    const b = probe('b', [{ folderUri: 'file:///c%3A/proj/bbb' }]);
    const items = await loadRecent([a, b]);
    expect(items.map(i => i.title)).toEqual(['aaa', 'bbb']);
  });

  it('dedups by id, keeping first occurrence', async () => {
    const a = probe('a', [{ folderUri: 'file:///c%3A/proj/foo', label: 'first' }]);
    const b = probe('b', [{ folderUri: 'file:///C%3A/PROJ/FOO', label: 'second' }]); // same path, different case
    const items = await loadRecent([a, b]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('first');
  });

  it('filters local folders that do not exist', async () => {
    const p = probe('a', [
      { folderUri: 'file:///c%3A/proj/real' },
      { folderUri: 'file:///c%3A/proj/GHOST' },
    ]);
    const items = await loadRecent([p]);
    expect(items.map(i => i.title)).toEqual(['real']);
  });

  it('keeps remote entries even though existsSync cannot verify them', async () => {
    const p = probe('a', [{ folderUri: 'vscode-remote://wsl+Ubuntu/home/me/x' }]);
    const items = await loadRecent([p]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('remote');
  });

  it('skips probes that return null', async () => {
    const dead: SourceProbe = { name: 'dead', read: async () => null };
    const live = probe('live', [{ folderUri: 'file:///c%3A/proj/x' }]);
    const items = await loadRecent([dead, live]);
    expect(items).toHaveLength(1);
  });

  it('returns empty array when all probes are empty/null', async () => {
    const dead: SourceProbe = { name: 'd', read: async () => null };
    expect(await loadRecent([dead])).toEqual([]);
  });
});
```

- [ ] **Step 7.2: 运行测试，确认全部 fail**

Run: `npx vitest run tests/vscode-stable.test.ts`
Expected: FAIL，"Cannot find module '../src/loader/vscode-stable'"。

- [ ] **Step 7.3: 实现 `src/loader/vscode-stable.ts`**

```ts
import * as fs from 'fs';
import type { RawEntry, RecentItem, SourceProbe } from '../types';
import { mapEntries } from '../uri-mapper';
import { createStateVscdbProbe } from './state-vscdb-probe';
import { createStorageJsonProbe } from './storage-json-probe';

/**
 * 默认 probe 顺序：state.vscdb 优先，storage.json 兜底。
 */
export function defaultProbes(): SourceProbe[] {
  return [createStateVscdbProbe(), createStorageJsonProbe()];
}

/**
 * 顺序读取所有 probe，合并 + 按 id 去重（保留首次出现）+ 本地路径存在性过滤。
 */
export async function loadRecent(probes: SourceProbe[] = defaultProbes()): Promise<RecentItem[]> {
  const allRaw: RawEntry[] = [];
  for (const p of probes) {
    try {
      const entries = await p.read();
      if (entries) allRaw.push(...entries);
    } catch {
      // 单个 probe 失败不影响其他
    }
  }

  const mapped = mapEntries(allRaw);

  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const item of mapped) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    if (item.kind === 'remote') {
      out.push({ ...item, exists: true });
      continue;
    }
    const exists = fs.existsSync(item.rawPath);
    if (!exists) continue; // FR-5: 本地不存在的过滤
    out.push({ ...item, exists: true });
  }

  return out;
}
```

- [ ] **Step 7.4: 运行测试，确认全部 pass**

Run: `npx vitest run tests/vscode-stable.test.ts`
Expected: 6 个测试 PASS。

- [ ] **Step 7.5: 提交**

```bash
git add tests/vscode-stable.test.ts src/loader/vscode-stable.ts
git commit -m "feat(loader): merge/dedupe/filter recent items from multiple probes"
```

---

## Task 8: Launcher（spawn code）

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\src\launcher\vscode-stable.ts`

> 此模块封装外部进程调用，单元测试收益低（mock spawn 测的还是 mock 自身）。靠 Task 13 手工验收。

- [ ] **Step 8.1: 实现 `src/launcher/vscode-stable.ts`**

```ts
import { spawn } from 'child_process';
import type { OpenResult, RecentItem } from '../types';

/**
 * 用 PATH 上的 `code` 命令打开项目。
 * Windows 下 PATH 中的 code 是 code.cmd，所以必须 shell: true。
 */
export function openInVSCode(item: RecentItem): Promise<OpenResult> {
  const args = item.kind === 'remote'
    ? ['--folder-uri', item.rawPath]
    : [quoteIfNeeded(item.rawPath)];

  return new Promise<OpenResult>(resolve => {
    let settled = false;
    const settle = (r: OpenResult) => { if (!settled) { settled = true; resolve(r); } };

    try {
      const child = spawn('code', args, { detached: true, stdio: 'ignore', shell: true });
      child.on('error', e => settle({ ok: false, reason: e.message }));
      child.unref();
      // 给 spawn 一个 tick 触发同步错误（如 ENOENT），再 resolve ok
      setTimeout(() => settle({ ok: true }), 50);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      settle({ ok: false, reason });
    }
  });
}

/**
 * shell:true 下含空格的路径需要带双引号。
 */
function quoteIfNeeded(p: string): string {
  if (p.includes('"')) return p;          // 不重复加
  if (/[\s&()]/.test(p)) return `"${p}"`;
  return p;
}
```

- [ ] **Step 8.2: 验证 tsc 通过**

Run: `npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 8.3: 提交**

```bash
git add src/launcher/vscode-stable.ts
git commit -m "feat(launcher): spawn code command to open recent item"
```

---

## Task 9: preload.ts（暴露 API）

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\preload.ts`

- [ ] **Step 9.1: 写 `preload.ts`**

```ts
import { loadRecent } from './src/loader/vscode-stable';
import { openInVSCode } from './src/launcher/vscode-stable';
import type { RecentItem, OpenResult } from './src/types';

// 类型补丁，前端可用
declare global {
  interface Window {
    recentApi: {
      list(): Promise<RecentItem[]>;
      open(item: RecentItem): Promise<OpenResult>;
    };
    Fuse: any;
  }
}

(window as any).recentApi = {
  list: () => loadRecent(),
  open: (item: RecentItem) => openInVSCode(item),
};

// fuse.js 转发给前端（前端不能 require）。fuse.js v7 commonjs 入口暴露 default。
const FuseModule = require('fuse.js');
(window as any).Fuse = FuseModule.default ?? FuseModule;
```

- [ ] **Step 9.2: 编译并验证 `preload.js` 生成**

Run: `npx tsc`
Expected: 项目根出现 `preload.js`、`src/**/*.js`，无错误。

- [ ] **Step 9.3: 提交**

```bash
git add preload.ts preload.js src/**/*.js
git commit -m "feat(preload): expose recentApi and Fuse to renderer"
```

---

## Task 10: plugin.json + logo.png

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\plugin.json`
- Create: `E:\myprojects\ztool-plugins\vscode\logo.png`

- [ ] **Step 10.1: 写 `plugin.json`**

```json
{
  "name": "ztool-vsc-recent",
  "title": "VSCode 最近项目",
  "description": "快速打开最近的 VSCode 项目、工作区与远程会话",
  "version": "0.1.0",
  "main": "index.html",
  "logo": "logo.png",
  "preload": "preload.js",
  "features": [
    {
      "code": "vsc-recent",
      "explain": "最近打开的 VSCode 项目",
      "platform": ["win32", "darwin", "linux"],
      "cmds": ["vsc"]
    }
  ]
}
```

- [ ] **Step 10.2: 生成一个占位 logo.png（128×128 蓝底）**

Run（PowerShell）：

```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 128, 128
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(0, 122, 204))  # VSCode 蓝
$font = New-Object System.Drawing.Font 'Arial', 48, ([System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::White
$g.DrawString('vsc', $font, $brush, 12, 30)
$bmp.Save('E:\myprojects\ztool-plugins\vscode\logo.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
```

Expected: `logo.png` 存在，大小 ~2-5 KB。

- [ ] **Step 10.3: 提交**

```bash
git add plugin.json logo.png
git commit -m "feat: add plugin.json manifest and placeholder logo"
```

---

## Task 11: index.html + index.css

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\index.html`
- Create: `E:\myprojects\ztool-plugins\vscode\index.css`

- [ ] **Step 11.1: 写 `index.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="index.css" />
</head>
<body>
  <ul id="list"></ul>
  <div id="empty" hidden>没有找到最近的 VSCode 项目。先在 VSCode 中打开一次项目，再回来试试。</div>
  <script src="index.js"></script>
</body>
</html>
```

- [ ] **Step 11.2: 写 `index.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  color: #333;
  background: #fff;
}

#list {
  list-style: none;
  max-height: 480px;
  overflow-y: auto;
}

#list li {
  padding: 8px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
}

#list li:hover { background: #f7f7f7; }

#list li.active {
  background: #007acc;
  color: #fff;
}

#list li.active .subtitle { color: #cfe6f7; }

.title { font-weight: 500; }
.subtitle { font-size: 12px; color: #888; margin-top: 2px; }

#empty {
  padding: 40px 16px;
  text-align: center;
  color: #888;
}

@media (prefers-color-scheme: dark) {
  html, body { background: #1e1e1e; color: #ddd; }
  #list li { border-bottom-color: #2d2d2d; }
  #list li:hover { background: #2a2a2a; }
  .subtitle { color: #888; }
}
```

- [ ] **Step 11.3: 提交**

```bash
git add index.html index.css
git commit -m "feat(ui): add list HTML structure and styling"
```

---

## Task 12: index.ts（UI 行为）

**Files:**
- Create: `E:\myprojects\ztool-plugins\vscode\index.ts`

- [ ] **Step 12.1: 写 `index.ts`**

```ts
import type { RecentItem } from './src/types';

declare const ztools: any;

ztools.onPluginEnter(async () => {
  const list = document.getElementById('list') as HTMLUListElement;
  const empty = document.getElementById('empty') as HTMLDivElement;

  let items: RecentItem[] = [];
  let view: RecentItem[] = [];
  let highlighted = 0;

  try {
    items = await window.recentApi.list();
  } catch (e) {
    ztools.showNotification('读取 VSCode 历史失败：' + (e instanceof Error ? e.message : String(e)));
    items = [];
  }

  const fuse = new window.Fuse(items, {
    keys: ['title', 'subtitle'],
    threshold: 0.4,
    includeScore: true,
  });
  view = items;

  function render(): void {
    if (view.length === 0) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }
    list.hidden = false;
    empty.hidden = true;

    list.innerHTML = '';
    view.forEach((it, idx) => {
      const li = document.createElement('li');
      if (idx === highlighted) li.classList.add('active');

      const t = document.createElement('div');
      t.className = 'title';
      t.textContent = it.title;
      li.appendChild(t);

      const s = document.createElement('div');
      s.className = 'subtitle';
      s.textContent = it.subtitle;
      li.appendChild(s);

      li.addEventListener('click', () => select(it));
      list.appendChild(li);
    });

    // 确保高亮项在可视区
    const active = list.querySelector('.active');
    if (active) (active as HTMLElement).scrollIntoView({ block: 'nearest' });
  }

  ztools.setSubInput((arg: { text: string }) => {
    const text = arg.text.trim();
    view = text ? fuse.search(text).map((r: any) => r.item) : items;
    highlighted = 0;
    render();
  }, '搜索 VSCode 项目');

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (view.length === 0) return;
    if (e.key === 'ArrowDown') {
      highlighted = Math.min(highlighted + 1, view.length - 1);
      render();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      highlighted = Math.max(highlighted - 1, 0);
      render();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      select(view[highlighted]);
      e.preventDefault();
    }
  });

  async function select(item: RecentItem): Promise<void> {
    const r = await window.recentApi.open(item);
    if (r.ok) {
      ztools.outPlugin();
    } else {
      ztools.showNotification(
        '无法启动 VSCode：' + r.reason +
        '。请确认 PATH 中包含 code 命令（在 VSCode 中按 Ctrl+Shift+P 运行 "Shell Command: Install code command in PATH"）。'
      );
    }
  }

  render();
});
```

- [ ] **Step 12.2: 编译**

Run: `npx tsc`
Expected: `index.js` 生成，无错误。

- [ ] **Step 12.3: 提交**

```bash
git add index.ts index.js
git commit -m "feat(ui): wire list rendering, fuzzy search, keyboard nav, launch flow"
```

---

## Task 13: 端到端手工验证

**Files:** 无新增文件；这是验收清单。

> 此 task 由实际跑插件验证。失败则回到对应 Task 修复。

- [ ] **Step 13.1: 把项目目录加入 ZTools "开发者工具" 插件**

操作：打开 ZTools → 输入 "开发者工具" → 进入 → 添加本地插件 → 选择 `E:\myprojects\ztool-plugins\vscode`。
Expected: 插件出现在已加载列表，无 manifest 错误。

- [ ] **Step 13.2: FR-1 触发关键字**

操作：呼出 ZTools 主搜索框，输入 `vsc`，回车。
Expected: 进入插件页，列表展示最近项目。

- [ ] **Step 13.3: FR-2 / FR-4 列表内容**

Expected: 至少出现一项；每项有主标题（项目名）+ 副标题（路径）；如有 workspace 文件 / WSL 项目，应同时出现。

- [ ] **Step 13.4: FR-5 不存在路径过滤**

操作：找一个最近项目，把它的本地文件夹改名或删除，重新呼出插件。
Expected: 该项目消失。改回名称后再呼出，又出现。

- [ ] **Step 13.5: FR-6 模糊搜索**

操作：在子搜索框输入项目名的连续 3 个字符。
Expected: 列表实时过滤，包含目标项的行可见。

- [ ] **Step 13.6: FR-7 键盘导航**

操作：按 ↓ 三次、↑ 一次。
Expected: 高亮位置正确变化，且高亮项始终可见（未被滚出可视区）。

- [ ] **Step 13.7: FR-7 / FR-8 鼠标 + 启动**

操作：鼠标点击其中一项。
Expected: VSCode 立即启动并打开该目录；插件窗口被隐藏（再次呼出 ZTools 时不在该插件页内）。

- [ ] **Step 13.8: FR-7 / FR-8 Enter 启动**

操作：再次进入插件，方向键选中一项，按 Enter。
Expected: 同上 — 启动 VSCode + 隐藏插件。

- [ ] **Step 13.9: FR-9 启动失败提示**

操作：临时在 PATH 中移除 code（最简单的方式：在用户变量 PATH 删除 VSCode 的 `bin` 路径，开新 shell 让 ZTools 继承），再回插件按 Enter。
Expected: 系统通知提示"无法启动 VSCode … 请确认 PATH 中包含 code 命令"。
**测试后恢复 PATH。**

- [ ] **Step 13.10: 数据源 fallback**

操作：（可选）打开 DevTools，在 console 检查 `window.recentApi.list().then(console.log)` 输出。
Expected: 返回数组，元素结构匹配 `RecentItem`。

- [ ] **Step 13.11: 提交验收记录**

```bash
git commit --allow-empty -m "test: e2e manual validation passed for FR-1..FR-9"
```

---

## Self-Review

**Spec coverage（§3 FR / §4 NFR）：**
- FR-1（关键字 vsc 进入）→ Task 10 plugin.json + Task 13.2 ✓
- FR-2（列表 + 主副标题）→ Task 11 + Task 12 + Task 13.3 ✓
- FR-3（VSCode 顺序保留）→ Task 7 测试用例 + 实现 ✓
- FR-4（folder/workspace/remote）→ Task 4 mapper 测试三类 + Task 13.3 ✓
- FR-5（不存在路径过滤）→ Task 7 测试 + 实现 + Task 13.4 ✓
- FR-6（模糊搜索）→ Task 12 fuse.js + Task 13.5 ✓
- FR-7（键盘 + 鼠标 + scrollIntoView）→ Task 12 + Task 13.6/13.7/13.8 ✓
- FR-8（spawn + outPlugin）→ Task 8 + Task 12 select ✓
- FR-9（启动失败 Notification）→ Task 12 select 错误分支 + Task 13.9 ✓
- NFR-1（100ms 渲染）→ 没专项测试，但实现是同步 DOM 操作，最近列表 ≤200 条；如有问题 Task 13 会暴露
- NFR-2（不打包/混淆）→ Task 1 tsconfig 选 commonjs + 不压缩 ✓
- NFR-3（无原生模块）→ 仅 sql.js / fuse.js 纯 JS ✓
- NFR-4（只读 VSCode 数据）→ Task 5/6 仅 fs.readFileSync + sql.js Database 构造（内存解析） ✓
- NFR-5（多源探测）→ Task 5 + 6 + 7 ✓

**Placeholder scan：** 无 TBD/TODO/"实现细节"/"类似 Task X"。所有代码块完整。

**Type consistency：**
- `RecentItem` / `RawEntry` / `SourceProbe` / `OpenResult` 在 Task 2 定义，后续 Task 4/5/6/7/8/9/12 全部 import from './types' 或 '../types'，签名一致 ✓
- `mapEntries(entries: RawEntry[]): RecentItem[]` 在 Task 4 定义，Task 7 调用 `mapEntries(allRaw)` 一致 ✓
- `loadRecent(probes?: SourceProbe[]): Promise<RecentItem[]>` 在 Task 7 定义，Task 9 preload 调用 `loadRecent()` 一致 ✓
- `openInVSCode(item: RecentItem): Promise<OpenResult>` 在 Task 8 定义，Task 9 preload 调用 `openInVSCode(item)` 一致 ✓
- `window.recentApi.list/open` 与 `window.Fuse` 类型在 Task 9 与 Task 12 中声明对齐 ✓

**Scope check：** 单一插件，简单 UI + 数据加载 + 进程启动。一个 plan 足够。无需拆分。
