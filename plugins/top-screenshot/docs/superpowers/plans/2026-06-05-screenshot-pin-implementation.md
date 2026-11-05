# 截图置顶 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 TypeScript 编写的 ztools 插件，启动后立即截图，并把框选区域以多窗口形式原地置顶。

**Architecture:** 使用 Vue + Vite + TypeScript 渲染插件界面、截图覆盖层和置顶图片窗口。使用 ztools 的 `createBrowserWindow`、`desktopCaptureSources` 和显示器 API 创建全屏截图窗口与透明置顶窗口；用 localStorage 在同源窗口之间传递截图会话和置顶窗口状态。

**Tech Stack:** Vue 3、TypeScript、Vite、Vitest、ZTools 插件 API、Electron BrowserWindow 选项。

---

## Source Notes

ZTools 文档说明 `ztools.screenCapture(callback)` 只返回截图 Data URL，不返回截图区域坐标。为了满足“在图片对应位置原地置顶”，实现使用 `ztools.desktopCaptureSources(options)` 获取屏幕图像，用自定义全屏覆盖层记录选区 bounds，再用 `ztools.createBrowserWindow(url, options, callback)` 创建置顶图片窗口。

## File Structure

- `plugin.json` — ztools 插件元信息，定义入口、preload 和搜索命令。
- `package.json` — npm 脚本、Vue/Vite/TypeScript/Vitest 依赖。
- `index.html` — Vite HTML 入口。
- `vite.config.ts` — Vue 应用构建配置。
- `vite.preload.config.ts` — preload TypeScript 构建配置。
- `tsconfig.json` — TypeScript 配置。
- `.gitignore` — 忽略依赖、构建产物和可视化 brainstorming 临时文件。
- `assets/logo.png` — ztools 插件图标。
- `preload/index.ts` — preload 入口，保留 ztools 注入环境。
- `src/main.ts` — Vue 应用入口。
- `src/App.vue` — 根据 hash 路由渲染 launcher、capture、pin 三类视图。
- `src/styles.css` — 全局样式、透明窗口 body 样式。
- `src/types/ztools.ts` — 最小 ZTools API 类型声明。
- `src/core/geometry.ts` — 选区、窗口装饰、中心缩放、拖动 bounds 计算。
- `src/core/storage.ts` — 截图会话和置顶窗口状态的 localStorage 读写。
- `src/core/routes.ts` — hash 路由解析与同源窗口 URL 生成。
- `src/core/ztoolsBridge.ts` — ZTools API 包装、显示器截图源匹配、窗口创建。
- `src/core/crop.ts` — canvas 裁剪屏幕截图。
- `src/views/LauncherView.vue` — ztools 启动后创建截图会话和覆盖层窗口。
- `src/views/CaptureView.vue` — 显示全屏截图覆盖层，处理拖拽选区。
- `src/views/PinView.vue` — 渲染置顶截图，处理拖动、中心缩放和 Esc 关闭。
- `tests/geometry.test.ts` — 几何纯函数测试。
- `tests/storage.test.ts` — localStorage 状态测试。
- `tests/routes.test.ts` — hash 路由与 URL 生成测试。
- `tests/ztoolsBridge.test.ts` — 显示器截图源匹配测试。

---

### Task 1: Scaffold Vue + TypeScript plugin project

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vite.preload.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/styles.css`
- Create: `preload/index.ts`
- Create: `scripts/create-logo.mjs`
- Create: `plugin.json`
- Create: `tests/geometry.test.ts`

- [ ] **Step 1: Write a failing smoke test**

Create `tests/geometry.test.ts` with this content:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeRect } from '../src/core/geometry';

describe('normalizeRect', () => {
  it('normalizes a drag from bottom-right to top-left', () => {
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 15 })).toEqual({
      x: 10,
      y: 15,
      width: 20,
      height: 25,
    });
  });
});
```

- [ ] **Step 2: Add package and TypeScript/Vite config**

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.superpowers/
*.log
.DS_Store
```

Create `package.json`:

```json
{
  "name": "top-screenshot-ztools-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "vue-tsc --noEmit && vite build && vite build --config vite.preload.config.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "create:logo": "node scripts/create-logo.mjs"
  },
  "dependencies": {
    "@vitejs/plugin-vue": "latest",
    "@vue/test-utils": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest",
    "vue": "latest",
    "vue-tsc": "latest"
  },
  "devDependencies": {
    "@types/node": "latest"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals", "node"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.vue",
    "preload/**/*.ts",
    "tests/**/*.ts",
    "vite.config.ts",
    "vite.preload.config.ts"
  ]
}
```

Create `vite.config.ts`:

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

Create `vite.preload.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    outDir: 'dist',
    rollupOptions: {
      external: ['electron'],
    },
  },
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>截图置顶</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Create `preload/index.ts`:

```ts
export {};
```

Create `scripts/create-logo.mjs`:

```js
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('assets', { recursive: true });
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAfElEQVR4nO3QQQ0AIBDAMMC/5+ONAvZoFSzZnR1JkpyeA7g1wABggAHAAAOAAQYAAwwABhgADDAAGGAAAHAAMMAAYIABwAADgAEGAAcAAAwwABhgADDAAGGAAAHAAMMAAYIABwAADgAEGAAcAAAwwABhgADDAAGGAAcJ+UAQAA//YCrvCk7QAAAABJRU5ErkJggg==';
writeFileSync('assets/logo.png', Buffer.from(pngBase64, 'base64'));
```

Create `plugin.json`:

```json
{
  "name": "top-screenshot",
  "title": "截图置顶",
  "description": "框选屏幕区域并原地置顶显示截图",
  "version": "0.1.0",
  "main": "dist/index.html",
  "logo": "assets/logo.png",
  "preload": "dist/preload.cjs",
  "features": [
    {
      "code": "capture-pin",
      "explain": "截图并置顶",
      "cmds": ["截图置顶", "截图", "置顶截图"]
    }
  ]
}
```

- [ ] **Step 3: Add temporary app shell**

Create `src/main.ts`:

```ts
import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');
```

Create `src/App.vue`:

```vue
<script setup lang="ts">
const message = '截图置顶插件正在加载';
</script>

<template>
  <main class="app-shell">{{ message }}</main>
</template>
```

Create `src/styles.css`:

```css
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  background: transparent;
}

.app-shell {
  display: grid;
  min-height: 100vh;
  place-items: center;
  color: #e5e7eb;
  background: #111827;
}
```

- [ ] **Step 4: Install dependencies and generate logo**

Run:

```bash
npm install
npm run create:logo
```

Expected: `node_modules` exists, `package-lock.json` exists, and `assets/logo.png` exists.

- [ ] **Step 5: Run test to verify it fails because geometry does not exist**

Run:

```bash
npm test -- tests/geometry.test.ts
```

Expected: FAIL with a module resolution error for `../src/core/geometry`.

- [ ] **Step 6: Commit scaffold**

```bash
git add .gitignore package.json package-lock.json tsconfig.json vite.config.ts vite.preload.config.ts index.html preload/index.ts scripts/create-logo.mjs plugin.json assets/logo.png src/main.ts src/App.vue src/styles.css tests/geometry.test.ts
git commit -m "chore: scaffold ztools screenshot plugin"
```

---

### Task 2: Implement geometry primitives with tests

**Files:**
- Create: `src/core/geometry.ts`
- Modify: `tests/geometry.test.ts`

- [ ] **Step 1: Replace geometry tests with full expected behavior**

Replace `tests/geometry.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  clampScale,
  imageBoundsForScale,
  isValidSelection,
  normalizeRect,
  outerBoundsForImage,
  scaleFromWheelDelta,
  translateRect,
} from '../src/core/geometry';

describe('geometry', () => {
  it('normalizes a drag from bottom-right to top-left', () => {
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 15 })).toEqual({
      x: 10,
      y: 15,
      width: 20,
      height: 25,
    });
  });

  it('rejects tiny selections', () => {
    expect(isValidSelection({ x: 0, y: 0, width: 7, height: 20 })).toBe(false);
    expect(isValidSelection({ x: 0, y: 0, width: 20, height: 7 })).toBe(false);
    expect(isValidSelection({ x: 0, y: 0, width: 8, height: 8 })).toBe(true);
  });

  it('adds frame space around an image window', () => {
    expect(outerBoundsForImage({ x: 100, y: 80, width: 200, height: 120 }, 6)).toEqual({
      x: 94,
      y: 74,
      width: 212,
      height: 132,
    });
  });

  it('scales around the current image center', () => {
    expect(imageBoundsForScale({ x: 100, y: 80, width: 200, height: 120 }, 1.5)).toEqual({
      x: 50,
      y: 50,
      width: 300,
      height: 180,
    });
  });

  it('clamps scale and applies wheel direction', () => {
    expect(clampScale(0.1)).toBe(0.3);
    expect(clampScale(4)).toBe(3);
    expect(scaleFromWheelDelta(1, -100)).toBe(1.1);
    expect(scaleFromWheelDelta(1, 100)).toBe(0.9);
  });

  it('translates a rectangle by a delta', () => {
    expect(translateRect({ x: 10, y: 20, width: 30, height: 40 }, 5, -8)).toEqual({
      x: 15,
      y: 12,
      width: 30,
      height: 40,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/geometry.test.ts
```

Expected: FAIL with missing exports from `src/core/geometry.ts`.

- [ ] **Step 3: Implement geometry**

Create `src/core/geometry.ts`:

```ts
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_SELECTION_SIZE = 8;
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 3;
export const SCALE_STEP = 0.1;

const round = (value: number) => Math.round(value * 100) / 100;

export function normalizeRect(start: Point, end: Point): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function isValidSelection(rect: Rect): boolean {
  return rect.width >= MIN_SELECTION_SIZE && rect.height >= MIN_SELECTION_SIZE;
}

export function outerBoundsForImage(imageBounds: Rect, frameSize: number): Rect {
  return {
    x: Math.round(imageBounds.x - frameSize),
    y: Math.round(imageBounds.y - frameSize),
    width: Math.round(imageBounds.width + frameSize * 2),
    height: Math.round(imageBounds.height + frameSize * 2),
  };
}

export function imageBoundsForScale(currentImageBounds: Rect, nextScale: number): Rect {
  const centerX = currentImageBounds.x + currentImageBounds.width / 2;
  const centerY = currentImageBounds.y + currentImageBounds.height / 2;
  const baseWidth = currentImageBounds.width;
  const baseHeight = currentImageBounds.height;
  const currentScale = Math.max(currentImageBounds.width / baseWidth, 1);
  const ratio = nextScale / currentScale;
  const width = round(currentImageBounds.width * ratio);
  const height = round(currentImageBounds.height * ratio);
  return {
    x: round(centerX - width / 2),
    y: round(centerY - height / 2),
    width,
    height,
  };
}

export function imageBoundsForOriginalSize(center: Point, originalSize: Pick<Rect, 'width' | 'height'>, scale: number): Rect {
  const width = round(originalSize.width * scale);
  const height = round(originalSize.height * scale);
  return {
    x: round(center.x - width / 2),
    y: round(center.y - height / 2),
    width,
    height,
  };
}

export function rectCenter(rect: Rect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function clampScale(scale: number): number {
  return round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)));
}

export function scaleFromWheelDelta(currentScale: number, deltaY: number): number {
  const direction = deltaY < 0 ? 1 : -1;
  return clampScale(currentScale + direction * SCALE_STEP);
}

export function translateRect(rect: Rect, deltaX: number, deltaY: number): Rect {
  return {
    x: round(rect.x + deltaX),
    y: round(rect.y + deltaY),
    width: rect.width,
    height: rect.height,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm test -- tests/geometry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit geometry**

```bash
git add src/core/geometry.ts tests/geometry.test.ts
git commit -m "test: add screenshot geometry primitives"
```

---

### Task 3: Implement routes and storage

**Files:**
- Create: `src/core/routes.ts`
- Create: `src/core/storage.ts`
- Create: `tests/routes.test.ts`
- Create: `tests/storage.test.ts`

- [ ] **Step 1: Write route tests**

Create `tests/routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPluginUrl, parseRoute } from '../src/core/routes';

describe('routes', () => {
  it('parses launcher route by default', () => {
    expect(parseRoute('')).toEqual({ view: 'launcher', params: new URLSearchParams() });
  });

  it('parses capture route params', () => {
    const route = parseRoute('#/capture?sessionId=s1&displayId=d1');
    expect(route.view).toBe('capture');
    expect(route.params.get('sessionId')).toBe('s1');
    expect(route.params.get('displayId')).toBe('d1');
  });

  it('builds same-origin plugin URLs', () => {
    const url = buildPluginUrl('pin', { id: 'abc 123' }, 'file:///D:/plugin/dist/index.html');
    expect(url).toBe('file:///D:/plugin/dist/index.html#/pin?id=abc+123');
  });
});
```

Create `tests/storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CaptureSession, PinWindowState } from '../src/core/storage';
import {
  loadCaptureSession,
  loadPinWindow,
  markCaptureSessionCompleted,
  saveCaptureSession,
  savePinWindow,
} from '../src/core/storage';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('storage', () => {
  it('saves and loads capture sessions', () => {
    const storage = createMemoryStorage();
    const session: CaptureSession = {
      id: 'session-1',
      createdAt: 10,
      completed: false,
      displays: [
        {
          displayId: '1',
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          imageDataUrl: 'data:image/png;base64,aaa',
          scaleFactor: 1,
        },
      ],
    };

    saveCaptureSession(storage, session);
    expect(loadCaptureSession(storage, 'session-1')).toEqual(session);

    markCaptureSessionCompleted(storage, 'session-1');
    expect(loadCaptureSession(storage, 'session-1')?.completed).toBe(true);
  });

  it('saves and loads pin windows', () => {
    const storage = createMemoryStorage();
    const state: PinWindowState = {
      id: 'pin-1',
      imageDataUrl: 'data:image/png;base64,bbb',
      originalBounds: { x: 10, y: 20, width: 100, height: 80 },
      currentBounds: { x: 10, y: 20, width: 100, height: 80 },
      scale: 1,
      createdAt: 100,
      lastActiveAt: 100,
    };

    savePinWindow(storage, state);
    expect(loadPinWindow(storage, 'pin-1')).toEqual(state);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/routes.test.ts tests/storage.test.ts
```

Expected: FAIL with missing modules for routes and storage.

- [ ] **Step 3: Implement routes**

Create `src/core/routes.ts`:

```ts
export type AppView = 'launcher' | 'capture' | 'pin';

export interface AppRoute {
  view: AppView;
  params: URLSearchParams;
}

export function parseRoute(hash: string = window.location.hash): AppRoute {
  const cleanHash = hash.replace(/^#\/?/, '');
  const [viewName, query = ''] = cleanHash.split('?');

  if (viewName === 'capture' || viewName === 'pin') {
    return { view: viewName, params: new URLSearchParams(query) };
  }

  return { view: 'launcher', params: new URLSearchParams() };
}

export function buildPluginUrl(view: AppView, params: Record<string, string>, baseUrl = window.location.href.split('#')[0]): string {
  const query = new URLSearchParams(params).toString();
  return `${baseUrl}#/${view}${query ? `?${query}` : ''}`;
}
```

- [ ] **Step 4: Implement storage**

Create `src/core/storage.ts`:

```ts
import type { Rect } from './geometry';

export interface DisplaySnapshot {
  displayId: string;
  bounds: Rect;
  imageDataUrl: string;
  scaleFactor: number;
}

export interface CaptureSession {
  id: string;
  createdAt: number;
  completed: boolean;
  displays: DisplaySnapshot[];
}

export interface PinWindowState {
  id: string;
  imageDataUrl: string;
  originalBounds: Rect;
  currentBounds: Rect;
  scale: number;
  createdAt: number;
  lastActiveAt: number;
}

const CAPTURE_SESSION_PREFIX = 'top-screenshot:capture-session:';
const PIN_WINDOW_PREFIX = 'top-screenshot:pin-window:';

function readJson<T>(storage: Storage, key: string): T | null {
  const raw = storage.getItem(key);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as T;
}

function writeJson<T>(storage: Storage, key: string, value: T): void {
  storage.setItem(key, JSON.stringify(value));
}

export function captureSessionKey(id: string): string {
  return `${CAPTURE_SESSION_PREFIX}${id}`;
}

export function pinWindowKey(id: string): string {
  return `${PIN_WINDOW_PREFIX}${id}`;
}

export function saveCaptureSession(storage: Storage, session: CaptureSession): void {
  writeJson(storage, captureSessionKey(session.id), session);
}

export function loadCaptureSession(storage: Storage, id: string): CaptureSession | null {
  return readJson<CaptureSession>(storage, captureSessionKey(id));
}

export function markCaptureSessionCompleted(storage: Storage, id: string): void {
  const session = loadCaptureSession(storage, id);
  if (!session) {
    return;
  }
  saveCaptureSession(storage, { ...session, completed: true });
}

export function savePinWindow(storage: Storage, state: PinWindowState): void {
  writeJson(storage, pinWindowKey(state.id), state);
}

export function loadPinWindow(storage: Storage, id: string): PinWindowState | null {
  return readJson<PinWindowState>(storage, pinWindowKey(id));
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
npm test -- tests/routes.test.ts tests/storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit routes and storage**

```bash
git add src/core/routes.ts src/core/storage.ts tests/routes.test.ts tests/storage.test.ts
git commit -m "test: add screenshot route and storage state"
```

---

### Task 4: Implement ZTools bridge

**Files:**
- Create: `src/types/ztools.ts`
- Create: `src/core/ztoolsBridge.ts`
- Create: `tests/ztoolsBridge.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write bridge tests**

Create `tests/ztoolsBridge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findSourceForDisplay, mapDisplaysToSnapshots } from '../src/core/ztoolsBridge';
import type { DesktopCaptureSource, ZToolsDisplay } from '../src/types/ztools';

function source(displayId: string, dataUrl: string): DesktopCaptureSource {
  return {
    id: `screen:${displayId}`,
    name: `Screen ${displayId}`,
    display_id: displayId,
    thumbnail: {
      toDataURL: () => dataUrl,
    },
  };
}

describe('ztoolsBridge', () => {
  it('finds a desktop source by display id', () => {
    expect(findSourceForDisplay({ id: 2, bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleFactor: 1 }, [source('1', 'a'), source('2', 'b')])?.thumbnail.toDataURL()).toBe('b');
  });

  it('maps displays to snapshots', () => {
    const displays: ZToolsDisplay[] = [
      { id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 },
    ];
    const snapshots = mapDisplaysToSnapshots(displays, [source('1', 'data:image/png;base64,screen')]);
    expect(snapshots).toEqual([
      {
        displayId: '1',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        imageDataUrl: 'data:image/png;base64,screen',
        scaleFactor: 1,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/ztoolsBridge.test.ts
```

Expected: FAIL with missing module errors.

- [ ] **Step 3: Add ZTools types**

Create `src/types/ztools.ts`:

```ts
import type { Rect } from '../core/geometry';

export interface ZToolsDisplay {
  id: number | string;
  bounds: Rect;
  scaleFactor?: number;
}

export interface DesktopCaptureSource {
  id: string;
  name: string;
  display_id?: string;
  thumbnail: {
    toDataURL(): string;
  };
}

export interface BrowserWindowProxy {
  close(): void;
  focus?(): void;
  show?(): void;
}

export interface BrowserWindowOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  frame?: boolean;
  transparent?: boolean;
  alwaysOnTop?: boolean;
  skipTaskbar?: boolean;
  resizable?: boolean;
  movable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  fullscreenable?: boolean;
  hasShadow?: boolean;
  backgroundColor?: string;
}

export interface ZToolsApi {
  onPluginEnter?(callback: () => void): void;
  onPluginReady?(callback: () => void): void;
  hideMainWindow?(isRestorePreWindow?: boolean): void;
  outPlugin?(isKill?: boolean): void;
  getAllDisplays(): ZToolsDisplay[];
  desktopCaptureSources(options: {
    types: Array<'screen' | 'window'>;
    thumbnailSize?: { width: number; height: number };
  }): Promise<DesktopCaptureSource[]> | DesktopCaptureSource[];
  createBrowserWindow(url: string, options: BrowserWindowOptions, callback?: () => void): BrowserWindowProxy | null;
}

declare global {
  interface Window {
    ztools?: ZToolsApi;
  }
}
```

- [ ] **Step 4: Implement bridge**

Create `src/core/ztoolsBridge.ts`:

```ts
import type { DisplaySnapshot } from './storage';
import type { BrowserWindowOptions, DesktopCaptureSource, ZToolsApi, ZToolsDisplay } from '../types/ztools';

export function getZTools(): ZToolsApi | null {
  return window.ztools ?? null;
}

export function requireZTools(): ZToolsApi {
  const api = getZTools();
  if (!api) {
    throw new Error('ZTools API is not available in this window.');
  }
  return api;
}

export function findSourceForDisplay(display: ZToolsDisplay, sources: DesktopCaptureSource[]): DesktopCaptureSource | null {
  const displayId = String(display.id);
  return sources.find((source) => source.display_id === displayId) ?? sources.find((source) => source.id.includes(displayId)) ?? null;
}

export function mapDisplaysToSnapshots(displays: ZToolsDisplay[], sources: DesktopCaptureSource[]): DisplaySnapshot[] {
  return displays.flatMap((display) => {
    const source = findSourceForDisplay(display, sources);
    if (!source) {
      return [];
    }

    return [
      {
        displayId: String(display.id),
        bounds: display.bounds,
        imageDataUrl: source.thumbnail.toDataURL(),
        scaleFactor: display.scaleFactor ?? 1,
      },
    ];
  });
}

export async function getDisplaySnapshots(api: ZToolsApi): Promise<DisplaySnapshot[]> {
  const displays = api.getAllDisplays();
  const maxWidth = Math.max(...displays.map((display) => Math.ceil(display.bounds.width * (display.scaleFactor ?? 1))));
  const maxHeight = Math.max(...displays.map((display) => Math.ceil(display.bounds.height * (display.scaleFactor ?? 1))));
  const sources = await api.desktopCaptureSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
  });
  return mapDisplaysToSnapshots(displays, sources);
}

export function createPluginWindow(api: ZToolsApi, url: string, options: BrowserWindowOptions): void {
  api.createBrowserWindow(url, options);
}
```

- [ ] **Step 5: Import types once**

Modify `src/main.ts`:

```ts
import './types/ztools';
import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');
```

- [ ] **Step 6: Run tests to verify pass**

Run:

```bash
npm test -- tests/ztoolsBridge.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit ZTools bridge**

```bash
git add src/types/ztools.ts src/core/ztoolsBridge.ts tests/ztoolsBridge.test.ts src/main.ts
git commit -m "test: add typed ztools bridge"
```

---

### Task 5: Implement screenshot capture overlay

**Files:**
- Create: `src/core/crop.ts`
- Create: `src/views/CaptureView.vue`
- Modify: `src/styles.css`

- [ ] **Step 1: Add image crop helper**

Create `src/core/crop.ts`:

```ts
import type { Rect } from './geometry';

export async function cropImageDataUrl(sourceDataUrl: string, selection: Rect, scaleFactor: number): Promise<string> {
  const image = await loadImage(sourceDataUrl);
  const canvas = document.createElement('canvas');
  const pixelX = Math.round(selection.x * scaleFactor);
  const pixelY = Math.round(selection.y * scaleFactor);
  const pixelWidth = Math.round(selection.width * scaleFactor);
  const pixelHeight = Math.round(selection.height * scaleFactor);

  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is not available.');
  }

  context.drawImage(image, pixelX, pixelY, pixelWidth, pixelHeight, 0, 0, pixelWidth, pixelHeight);
  return canvas.toDataURL('image/png');
}

function loadImage(sourceDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load screenshot image.'));
    image.src = sourceDataUrl;
  });
}
```

- [ ] **Step 2: Add capture view**

Create `src/views/CaptureView.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { cropImageDataUrl } from '../core/crop';
import { isValidSelection, normalizeRect, outerBoundsForImage, type Point, type Rect } from '../core/geometry';
import { buildPluginUrl } from '../core/routes';
import {
  loadCaptureSession,
  markCaptureSessionCompleted,
  savePinWindow,
  type DisplaySnapshot,
  type PinWindowState,
} from '../core/storage';
import { requireZTools } from '../core/ztoolsBridge';

const FRAME_SIZE = 6;

const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
const sessionId = params.get('sessionId') ?? '';
const displayId = params.get('displayId') ?? '';
const session = loadCaptureSession(window.localStorage, sessionId);
const snapshot = session?.displays.find((display) => display.displayId === displayId) ?? null;

const dragStart = ref<Point | null>(null);
const dragEnd = ref<Point | null>(null);
const isCapturing = ref(false);

const selection = computed<Rect | null>(() => {
  if (!dragStart.value || !dragEnd.value) {
    return null;
  }
  return normalizeRect(dragStart.value, dragEnd.value);
});

function pointFromMouse(event: MouseEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

function onMouseDown(event: MouseEvent): void {
  dragStart.value = pointFromMouse(event);
  dragEnd.value = pointFromMouse(event);
}

function onMouseMove(event: MouseEvent): void {
  if (!dragStart.value) {
    return;
  }
  dragEnd.value = pointFromMouse(event);
}

async function onMouseUp(): Promise<void> {
  if (!snapshot || !selection.value || !isValidSelection(selection.value) || isCapturing.value) {
    closeCaptureWindow();
    return;
  }

  isCapturing.value = true;
  const imageDataUrl = await cropImageDataUrl(snapshot.imageDataUrl, selection.value, snapshot.scaleFactor);
  const imageBounds = {
    x: snapshot.bounds.x + selection.value.x,
    y: snapshot.bounds.y + selection.value.y,
    width: selection.value.width,
    height: selection.value.height,
  };
  const id = `pin-${Date.now()}`;
  const now = Date.now();
  const pinState: PinWindowState = {
    id,
    imageDataUrl,
    originalBounds: imageBounds,
    currentBounds: imageBounds,
    scale: 1,
    createdAt: now,
    lastActiveAt: now,
  };

  savePinWindow(window.localStorage, pinState);
  markCaptureSessionCompleted(window.localStorage, sessionId);
  openPinWindow(snapshot, pinState);
  closeCaptureWindow();
}

function openPinWindow(display: DisplaySnapshot, pinState: PinWindowState): void {
  const api = requireZTools();
  const outerBounds = outerBoundsForImage(pinState.currentBounds, FRAME_SIZE);
  api.createBrowserWindow(buildPluginUrl('pin', { id: pinState.id }), {
    x: outerBounds.x,
    y: outerBounds.y,
    width: outerBounds.width,
    height: outerBounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
  });
}

function closeCaptureWindow(): void {
  window.close();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeCaptureWindow();
  }
}

window.addEventListener('keydown', onKeyDown);
</script>

<template>
  <main
    class="capture-view"
    tabindex="0"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <img v-if="snapshot" class="capture-image" :src="snapshot.imageDataUrl" alt="屏幕截图" draggable="false" />
    <div v-if="selection" class="selection-box" :style="{
      left: `${selection.x}px`,
      top: `${selection.y}px`,
      width: `${selection.width}px`,
      height: `${selection.height}px`,
    }" />
    <p v-if="!snapshot" class="capture-error">没有找到当前显示器截图。</p>
  </main>
</template>
```

- [ ] **Step 3: Add capture styles**

Append to `src/styles.css`:

```css
.capture-view {
  position: relative;
  width: 100vw;
  height: 100vh;
  cursor: crosshair;
  user-select: none;
  background: rgba(0, 0, 0, 0.2);
}

.capture-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

.selection-box {
  position: absolute;
  border: 2px solid #38bdf8;
  background: rgba(56, 189, 248, 0.16);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
}

.capture-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #f9fafb;
  background: #111827;
}
```

- [ ] **Step 4: Run tests and type check**

Run:

```bash
npm test
npm run build
```

Expected: tests PASS and build PASS.

- [ ] **Step 5: Commit capture overlay**

```bash
git add src/core/crop.ts src/views/CaptureView.vue src/styles.css
git commit -m "feat: add screenshot capture overlay"
```

---

### Task 6: Implement pin window rendering, drag, zoom, and Esc close

**Files:**
- Create: `src/views/PinView.vue`
- Modify: `src/styles.css`
- Modify: `src/core/storage.ts`
- Modify: `tests/storage.test.ts`

- [ ] **Step 1: Extend storage tests for active pin updates**

Append this test to the `describe('storage', () => { ... })` block in `tests/storage.test.ts`:

```ts
  it('updates pin activity and current bounds', () => {
    const storage = createMemoryStorage();
    const state: PinWindowState = {
      id: 'pin-2',
      imageDataUrl: 'data:image/png;base64,ccc',
      originalBounds: { x: 10, y: 20, width: 100, height: 80 },
      currentBounds: { x: 10, y: 20, width: 100, height: 80 },
      scale: 1,
      createdAt: 100,
      lastActiveAt: 100,
    };

    savePinWindow(storage, state);
    savePinWindow(storage, {
      ...state,
      currentBounds: { x: 20, y: 30, width: 150, height: 120 },
      scale: 1.5,
      lastActiveAt: 200,
    });

    expect(loadPinWindow(storage, 'pin-2')).toEqual({
      ...state,
      currentBounds: { x: 20, y: 30, width: 150, height: 120 },
      scale: 1.5,
      lastActiveAt: 200,
    });
  });
```

- [ ] **Step 2: Run storage tests**

Run:

```bash
npm test -- tests/storage.test.ts
```

Expected: PASS because `savePinWindow` already replaces the state atomically.

- [ ] **Step 3: Add pin view**

Create `src/views/PinView.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  imageBoundsForOriginalSize,
  outerBoundsForImage,
  rectCenter,
  scaleFromWheelDelta,
  translateRect,
  type Point,
  type Rect,
} from '../core/geometry';
import { loadPinWindow, savePinWindow, type PinWindowState } from '../core/storage';

const FRAME_SIZE = 6;

const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
const pinId = params.get('id') ?? '';
const loaded = loadPinWindow(window.localStorage, pinId);
const pinState = ref<PinWindowState | null>(loaded);
const dragStart = ref<Point | null>(null);
const dragStartBounds = ref<Rect | null>(null);

const imageStyle = computed(() => {
  if (!pinState.value) {
    return {};
  }
  return {
    width: `${pinState.value.currentBounds.width}px`,
    height: `${pinState.value.currentBounds.height}px`,
  };
});

function persist(nextState: PinWindowState): void {
  pinState.value = nextState;
  savePinWindow(window.localStorage, nextState);
}

function applyWindowBounds(imageBounds: Rect): void {
  const outerBounds = outerBoundsForImage(imageBounds, FRAME_SIZE);
  window.moveTo(outerBounds.x, outerBounds.y);
  window.resizeTo(outerBounds.width, outerBounds.height);
}

function activate(): void {
  if (!pinState.value) {
    return;
  }
  persist({ ...pinState.value, lastActiveAt: Date.now() });
}

function onWheel(event: WheelEvent): void {
  if (!pinState.value) {
    return;
  }

  event.preventDefault();
  const nextScale = scaleFromWheelDelta(pinState.value.scale, event.deltaY);
  if (nextScale === pinState.value.scale) {
    return;
  }

  const center = rectCenter(pinState.value.currentBounds);
  const nextImageBounds = imageBoundsForOriginalSize(center, pinState.value.originalBounds, nextScale);
  const nextState = {
    ...pinState.value,
    currentBounds: nextImageBounds,
    scale: nextScale,
    lastActiveAt: Date.now(),
  };

  persist(nextState);
  applyWindowBounds(nextImageBounds);
}

function onMouseDown(event: MouseEvent): void {
  if (!pinState.value || event.button !== 0) {
    return;
  }
  dragStart.value = { x: event.screenX, y: event.screenY };
  dragStartBounds.value = pinState.value.currentBounds;
  activate();
}

function onMouseMove(event: MouseEvent): void {
  if (!pinState.value || !dragStart.value || !dragStartBounds.value) {
    return;
  }

  const deltaX = event.screenX - dragStart.value.x;
  const deltaY = event.screenY - dragStart.value.y;
  const nextImageBounds = translateRect(dragStartBounds.value, deltaX, deltaY);
  const nextState = {
    ...pinState.value,
    currentBounds: nextImageBounds,
    lastActiveAt: Date.now(),
  };

  persist(nextState);
  applyWindowBounds(nextImageBounds);
}

function onMouseUp(): void {
  dragStart.value = null;
  dragStartBounds.value = null;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    window.close();
  }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('blur', onMouseUp);
</script>

<template>
  <main
    v-if="pinState"
    class="pin-window"
    tabindex="0"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @wheel="onWheel"
  >
    <img class="pin-image" :src="pinState.imageDataUrl" :style="imageStyle" alt="置顶截图" draggable="false" />
  </main>
  <main v-else class="pin-window pin-window-empty">截图数据不存在</main>
</template>
```

- [ ] **Step 4: Add pin styles**

Append to `src/styles.css`:

```css
.pin-window {
  display: inline-flex;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  padding: 6px;
  align-items: center;
  justify-content: center;
  user-select: none;
  background: transparent;
}

.pin-image {
  display: block;
  box-sizing: border-box;
  border: 2px solid #38bdf8;
  border-radius: 8px;
  box-shadow:
    0 0 0 1px rgba(56, 189, 248, 0.35),
    0 10px 28px rgba(56, 189, 248, 0.22),
    0 16px 36px rgba(0, 0, 0, 0.3);
  cursor: grab;
  object-fit: fill;
}

.pin-window:active .pin-image {
  cursor: grabbing;
}

.pin-window-empty {
  display: grid;
  place-items: center;
  color: #f9fafb;
  background: rgba(17, 24, 39, 0.92);
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: tests PASS and build PASS.

- [ ] **Step 6: Commit pin window**

```bash
git add src/views/PinView.vue src/styles.css tests/storage.test.ts
git commit -m "feat: add draggable zoomable pin windows"
```

---

### Task 7: Implement launcher orchestration and route rendering

**Files:**
- Create: `src/views/LauncherView.vue`
- Modify: `src/App.vue`
- Modify: `src/styles.css`

- [ ] **Step 1: Add launcher view**

Create `src/views/LauncherView.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { outerBoundsForImage } from '../core/geometry';
import { buildPluginUrl } from '../core/routes';
import { saveCaptureSession, type CaptureSession, type DisplaySnapshot } from '../core/storage';
import { getDisplaySnapshots, requireZTools } from '../core/ztoolsBridge';

const status = ref('正在准备截图...');
const isStarting = ref(false);

function createSession(displays: DisplaySnapshot[]): CaptureSession {
  return {
    id: `capture-${Date.now()}`,
    createdAt: Date.now(),
    completed: false,
    displays,
  };
}

function openCaptureWindow(session: CaptureSession, snapshot: DisplaySnapshot): void {
  const api = requireZTools();
  api.createBrowserWindow(buildPluginUrl('capture', { sessionId: session.id, displayId: snapshot.displayId }), {
    x: snapshot.bounds.x,
    y: snapshot.bounds.y,
    width: snapshot.bounds.width,
    height: snapshot.bounds.height,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#111827',
  });
}

async function startCapture(): Promise<void> {
  if (isStarting.value) {
    return;
  }

  isStarting.value = true;
  status.value = '正在读取屏幕...';

  try {
    const api = requireZTools();
    const snapshots = await getDisplaySnapshots(api);

    if (snapshots.length === 0) {
      status.value = '没有获取到屏幕截图源';
      isStarting.value = false;
      return;
    }

    const session = createSession(snapshots);
    saveCaptureSession(window.localStorage, session);
    snapshots.forEach((snapshot) => openCaptureWindow(session, snapshot));
    api.hideMainWindow?.(false);
    status.value = '请拖拽选择截图区域';
  } catch (error) {
    status.value = error instanceof Error ? error.message : '截图启动失败';
    isStarting.value = false;
  }
}

onMounted(() => {
  const api = window.ztools;
  api?.onPluginEnter?.(() => {
    void startCapture();
  });
  api?.onPluginReady?.(() => {
    void startCapture();
  });
  void startCapture();
});
</script>

<template>
  <main class="launcher-view">
    <div class="launcher-card">
      <h1>截图置顶</h1>
      <p>{{ status }}</p>
      <button type="button" @click="startCapture">重新开始截图</button>
    </div>
  </main>
</template>
```

- [ ] **Step 2: Remove unused import from launcher**

Replace the imports at the top of `src/views/LauncherView.vue` with:

```ts
import { onMounted, ref } from 'vue';
import { buildPluginUrl } from '../core/routes';
import { saveCaptureSession, type CaptureSession, type DisplaySnapshot } from '../core/storage';
import { getDisplaySnapshots, requireZTools } from '../core/ztoolsBridge';
```

- [ ] **Step 3: Render views by route**

Replace `src/App.vue` with:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { parseRoute } from './core/routes';
import CaptureView from './views/CaptureView.vue';
import LauncherView from './views/LauncherView.vue';
import PinView from './views/PinView.vue';

const route = computed(() => parseRoute());
</script>

<template>
  <CaptureView v-if="route.view === 'capture'" />
  <PinView v-else-if="route.view === 'pin'" />
  <LauncherView v-else />
</template>
```

- [ ] **Step 4: Add launcher styles**

Append to `src/styles.css`:

```css
.launcher-view {
  display: grid;
  min-height: 100vh;
  place-items: center;
  color: #e5e7eb;
  background: #111827;
}

.launcher-card {
  width: min(360px, calc(100vw - 32px));
  padding: 24px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.92);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
  text-align: center;
}

.launcher-card h1 {
  margin: 0 0 8px;
  font-size: 24px;
}

.launcher-card p {
  margin: 0 0 20px;
  color: #cbd5e1;
}

.launcher-card button {
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  color: #082f49;
  background: #38bdf8;
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test
npm run build
```

Expected: tests PASS and build PASS.

- [ ] **Step 6: Commit launcher orchestration**

```bash
git add src/views/LauncherView.vue src/App.vue src/styles.css
git commit -m "feat: launch screenshot capture from ztools entry"
```

---

### Task 8: Manual verification in ZTools

**Files:**
- Modify only files required by observed failures.

- [ ] **Step 1: Build the plugin**

Run:

```bash
npm run build
```

Expected: `dist/index.html` and `dist/preload.cjs` exist.

- [ ] **Step 2: Load plugin in ZTools**

Use ZTools local plugin loading with this project root:

```text
d:/code/vue/top_screenshot
```

Expected: ZTools recognizes `plugin.json` and shows the plugin title “截图置顶”.

- [ ] **Step 3: Verify launch-to-capture**

In ZTools, search and run:

```text
截图置顶
```

Expected: the plugin immediately opens screenshot selection coverage on the available displays.

- [ ] **Step 4: Verify pin creation**

Drag a rectangle on the capture overlay.

Expected: a transparent always-on-top pin window appears near the selected region. The image content keeps the selected width and height, with blue border, small radius, and glow shadow.

- [ ] **Step 5: Verify multiple pins**

Run “截图置顶” again and create a second pin.

Expected: the first pin remains open and the second pin appears as a separate always-on-top window.

- [ ] **Step 6: Verify drag, zoom, and close**

Drag a pin window, scroll the mouse wheel over it, and press Esc while the pin is focused.

Expected: drag moves the whole pin, wheel zooms around the image center between 30% and 300%, and Esc closes the focused pin.

- [ ] **Step 7: Fix observed ZTools integration mismatch**

If ZTools reports a missing entry, change `plugin.json` paths so `main` points to the built HTML file and `preload` points to the built preload file. If display screenshots do not match display IDs, adjust `findSourceForDisplay` in `src/core/ztoolsBridge.ts` to match the actual `DesktopCaptureSource` fields printed by ZTools.

- [ ] **Step 8: Re-run automated checks**

Run:

```bash
npm test
npm run build
```

Expected: tests PASS and build PASS.

- [ ] **Step 9: Commit verified plugin**

```bash
git add plugin.json src/core/ztoolsBridge.ts src/views/LauncherView.vue src/views/CaptureView.vue src/views/PinView.vue src/styles.css
git commit -m "fix: verify ztools screenshot pin integration"
```

---

## Self-Review

- Spec coverage: startup-to-screenshot is covered by Task 7; custom screenshot bounds are covered by Task 5; multi-window pin creation is covered by Tasks 5 and 7; visual border/radius/shadow is covered by Task 6; drag, center zoom, and Esc close are covered by Task 6; TypeScript and ztools project creation are covered by Task 1.
- Placeholder scan: this plan has no TBD markers, no TODO markers, and no undefined implementation steps.
- Type consistency: `Rect`, `DisplaySnapshot`, `CaptureSession`, `PinWindowState`, `AppView`, and ZTools bridge types are introduced before later tasks use them.
