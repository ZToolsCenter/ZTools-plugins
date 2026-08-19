/**
 * dev-only e2e harness — activated when:
 *   import.meta.env.DEV && location.search contains "e2eLocalMock"
 *
 * Sets up a fully in-memory window.gooseFs mock, exposes window.__gooseTest
 * handles, and installs fixture files under /mock-notes/.
 *
 * Production builds tree-shake this file entirely (conditional dynamic import
 * in main.tsx).
 */

// ---------------------------------------------------------------------------
// Fixture files
// ---------------------------------------------------------------------------

const FIXTURES: Record<string, string> = {
  // P0 trial stone: plain paragraph, no H1 — used to detect spurious writes
  "/mock-notes/plain.md": `This is a plain paragraph with no heading.

Another paragraph here with **bold** and _italic_ text.
`,

  // H1 title different from filename
  "/mock-notes/has-title.md": `# My Custom Title

Content beneath the heading. The file is called \`has-title.md\` but the
H1 says "My Custom Title".
`,

  // YAML frontmatter
  "/mock-notes/frontmatter.md": `---
title: Frontmatter Page
tags: [test, mock]
created: 2024-01-01
---

Body text after frontmatter. The frontmatter should be preserved across
open → save cycles.
`,

  // Rich content: nested lists, <details>, video, image with attrs, underline,
  // coloured span, multi-line blockquote
  "/mock-notes/rich.md": `# Rich Content

## Nested lists

- Item A
  - Sub A1
  - Sub A2
    - Deep A2a
- Item B

1. First
2. Second
   1. Second-A
   2. Second-B

## Details block

<details>
<summary>Click to expand</summary>

Hidden content inside details.

</details>

## Video & image

https://www.youtube.com/watch?v=dQw4w9WgXcQ

![Alt text](x.png){width=300 align=center}

## Inline decoration

<u>Underlined text</u>

<span style="color:red">Red coloured text</span>

## Multi-line blockquote

> Line one of the quote.
> Line two continues.
> And a third line.
`,

  // Sub-directory file
  "/mock-notes/sub/nested.md": `# Nested Page

This file lives in a sub-directory \`sub/\` inside the mock notes root.
`,

  // Non-whitelisted raw HTML blocks — covers the decode path that moved from
  // main.tsx's write wrapper into write.ts after the guard cleanup.
  // 期望：打开零写盘；编辑正文保存后，原始 HTML 原样保留在磁盘，
  // 绝不能出现 \`\`\`goose-raw-block 围栏泄漏到文件里。
  "/mock-notes/raw-html.md": `# Raw HTML Page

Intro paragraph before the raw HTML blocks.

<table>
<tr><td>Cell A1</td><td>Cell A2</td></tr>
<tr><td>Cell B1</td><td>Cell B2</td></tr>
</table>

A paragraph between the two raw blocks.

<div class="custom">
Custom div content that is not on the editor whitelist.
</div>

Closing paragraph after the raw HTML.
`,
};

// ---------------------------------------------------------------------------
// In-memory filesystem
// ---------------------------------------------------------------------------

type WriteLogEntry = {
  op: "writeFile" | "writeFileAsync" | "rename" | "deleteFile" | "deleteDir" | "mkdir";
  path: string;
  content?: string;
  ts: number;
};

let memFs: Record<string, string> = {};
let writeLog: WriteLogEntry[] = [];

// useLocalFolderWatch 注册的被 watch 目录。watch 本身仍是 no-op（不回调），
// 仅记录目录，供 simulateExternal* 计算事件的 dirPath（对齐真实 preload：
// 事件 detail.dirPath 是被 watch 的根目录，filename 是相对路径）。
const watchedDirs = new Set<string>();

function initMemFs() {
  memFs = { ...FIXTURES };
}

function recordWrite(entry: WriteLogEntry) {
  writeLog.push(entry);
  (window as any).__gooseFsLog = writeLog;
}

// ---------------------------------------------------------------------------
// Private in-memory fs primitives
//
// 保真度关键：公开 mock 方法之间绝不通过 this.xxx 互调。main.tsx 的
// setupMarkdownOpenWriteGuard 会 monkey-patch gooseFs.readFile/readFileAsync/
// writeFile/writeFileAsync（包装层剥 frontmatter、记快照）。真实 uTools 里
// readFileStatAsync 等是独立原生方法、不经过包装；mock 若经 this.readFile
// 委托，会让 scanner 经 readFileStatAsync 读到被包装层污染的内容。
// 所以全部公开方法只调用以下私有实现。
// ---------------------------------------------------------------------------

function memReadFile(path: string): string | null {
  return Object.prototype.hasOwnProperty.call(memFs, path) ? memFs[path] : null;
}

function memReadDir(
  dir: string,
): { name: string; isFile: boolean; isDirectory: boolean; path: string }[] {
  const prefix = dir.endsWith("/") ? dir : dir + "/";
  const seen = new Set<string>();
  const entries: { name: string; isFile: boolean; isDirectory: boolean; path: string }[] = [];

  for (const fullPath of Object.keys(memFs)) {
    if (!fullPath.startsWith(prefix)) continue;
    const rest = fullPath.slice(prefix.length);
    const parts = rest.split("/");
    const name = parts[0];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const isFile = parts.length === 1;
    const isDirectory = parts.length > 1;
    entries.push({ name, isFile, isDirectory, path: prefix + name });
  }

  return entries;
}

function memReadFileStat(path: string): {
  ok: boolean;
  error: string | null;
  content: string | null;
} {
  const content = memReadFile(path);
  if (content === null) {
    return { ok: false, error: "ENOENT: file not found", content: null };
  }
  return { ok: true, error: null, content };
}

function memExists(path: string): boolean {
  if (Object.prototype.hasOwnProperty.call(memFs, path)) return true;
  // check if path is a directory prefix
  const prefix = path.endsWith("/") ? path : path + "/";
  return Object.keys(memFs).some((k) => k.startsWith(prefix));
}

function memWriteFile(
  op: "writeFile" | "writeFileAsync",
  path: string,
  content: string,
  _encoding?: string,
): boolean {
  recordWrite({ op, path, content, ts: Date.now() });
  // base64/binary blobs stored as-is (opaque)
  memFs[path] = content;
  return true;
}

function memMkdir(dir: string): boolean {
  recordWrite({ op: "mkdir", path: dir, ts: Date.now() });
  // directories are implicit in our flat map; just no-op
  return true;
}

function memDeleteFile(path: string): boolean {
  recordWrite({ op: "deleteFile", path, ts: Date.now() });
  delete memFs[path];
  return true;
}

function memDeleteDir(path: string): boolean {
  recordWrite({ op: "deleteDir", path, ts: Date.now() });
  const prefix = path.endsWith("/") ? path : path + "/";
  for (const k of Object.keys(memFs)) {
    if (k === path || k.startsWith(prefix)) delete memFs[k];
  }
  return true;
}

function memRename(oldPath: string, newPath: string): boolean {
  recordWrite({ op: "rename", path: oldPath, ts: Date.now() });
  if (Object.prototype.hasOwnProperty.call(memFs, oldPath)) {
    memFs[newPath] = memFs[oldPath];
    delete memFs[oldPath];
  } else {
    // directory rename
    const prefix = oldPath.endsWith("/") ? oldPath : oldPath + "/";
    const newPrefix = newPath.endsWith("/") ? newPath : newPath + "/";
    for (const k of Object.keys(memFs)) {
      if (k.startsWith(prefix)) {
        memFs[newPrefix + k.slice(prefix.length)] = memFs[k];
        delete memFs[k];
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// External change simulation
//
// 真实 preload（preload/preload.cjs）用 fs.watch(dirPath, { recursive: true })
// 监听目录，回调里派发：
//   new CustomEvent("goose-note:file-changed", {
//     detail: { eventType, filename, dirPath },
//   })
// 其中 eventType 为 Node 语义："change"（内容修改）| "rename"（新建/删除/改名），
// filename 是相对 dirPath 的路径（recursive watch 下可含子目录段），
// dirPath 是被 watch 的根目录。useLocalFolderWatch 用
// `${dirPath}/${filename}` 还原全路径并要求 notebook.localPath === dirPath。
//
// 外部写入不记入 writeLog——writeLog 专门用于断言「应用自身的写盘」，
// 外部变更混入会污染"打开零写盘"的判定。
// ---------------------------------------------------------------------------

type FileChangedDetail = {
  eventType: "change" | "rename";
  filename: string;
  dirPath: string;
};

function resolveWatchRoot(fullPath: string): string {
  // 优先匹配已注册 watch 的目录（最长前缀），对齐真实 preload 只对被 watch
  // 目录派发事件的行为；harness 兜底到 /mock-notes，保证 watch 未注册时
  // simulate 依然可用（验证脚本可能在页面挂载前调用）。
  let best: string | null = null;
  for (const dir of watchedDirs) {
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    if ((fullPath === dir || fullPath.startsWith(prefix)) &&
        (!best || dir.length > best.length)) {
      best = dir;
    }
  }
  if (best) return best;
  if (fullPath.startsWith("/mock-notes/")) return "/mock-notes";
  // 最后兜底：父目录
  return fullPath.replace(/\/[^/]*$/, "") || "/";
}

function dispatchFileChanged(
  eventType: "change" | "rename",
  fullPath: string,
): FileChangedDetail {
  const dirPath = resolveWatchRoot(fullPath);
  const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  const filename = fullPath.startsWith(prefix)
    ? fullPath.slice(prefix.length)
    : fullPath.replace(/^.*[\\/]/, "");
  const detail: FileChangedDetail = { eventType, filename, dirPath };
  window.dispatchEvent(
    new CustomEvent("goose-note:file-changed", { detail }),
  );
  return detail;
}

function simulateExternalChangeImpl(
  path: string,
  newContent: string,
): FileChangedDetail {
  // 先更新内存 fs 再派发事件：handler 里的 reload/exists 检查要读到新状态。
  memFs[path] = newContent;
  return dispatchFileChanged("change", path);
}

function simulateExternalDeleteImpl(path: string): FileChangedDetail {
  // 文件或目录删除（目录则连带子项），Node 语义下删除是 "rename" 事件。
  if (Object.prototype.hasOwnProperty.call(memFs, path)) {
    delete memFs[path];
  } else {
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const k of Object.keys(memFs)) {
      if (k.startsWith(prefix)) delete memFs[k];
    }
  }
  return dispatchFileChanged("rename", path);
}

function simulateExternalCreateImpl(
  path: string,
  content: string,
): FileChangedDetail {
  // 新文件出现，Node 语义下新建也是 "rename" 事件。
  memFs[path] = content;
  return dispatchFileChanged("rename", path);
}

// ---------------------------------------------------------------------------
// GooseFs mock — every public method delegates straight to the private impls
// above, never to another public method（被 monkey-patch 也互不影响）。
// ---------------------------------------------------------------------------

function buildMockGooseFs(): GooseFs {
  return {
    // --- read ---

    readDir(dir: string) {
      return memReadDir(dir);
    },

    async readDirAsync(dir: string) {
      return Promise.resolve(memReadDir(dir));
    },

    readFile(path: string): string | null {
      return memReadFile(path);
    },

    async readFileAsync(path: string): Promise<string | null> {
      return Promise.resolve(memReadFile(path));
    },

    readFileStat(path: string) {
      return memReadFileStat(path);
    },

    async readFileStatAsync(path: string) {
      return Promise.resolve(memReadFileStat(path));
    },

    // --- existence ---

    exists(path: string): boolean {
      return memExists(path);
    },

    async existsAsync(path: string): Promise<boolean> {
      return Promise.resolve(memExists(path));
    },

    // --- write (all logged) ---

    writeFile(path: string, content: string, encoding?: string): boolean {
      return memWriteFile("writeFile", path, content, encoding);
    },

    async writeFileAsync(path: string, content: string, encoding?: string): Promise<boolean> {
      return Promise.resolve(memWriteFile("writeFileAsync", path, content, encoding));
    },

    // --- directory ---

    mkdir(dir: string): boolean {
      return memMkdir(dir);
    },

    // --- delete ---

    deleteFile(path: string): boolean {
      return memDeleteFile(path);
    },

    deleteDir(path: string): boolean {
      return memDeleteDir(path);
    },

    // --- rename ---

    rename(oldPath: string, newPath: string): boolean {
      return memRename(oldPath, newPath);
    },

    // --- watch ---
    // 不产生回调（事件由 simulateExternal* 直接派发），但记录被 watch 的目录，
    // 供 simulate 计算 detail.dirPath。useLocalFolderWatch 不依赖 watch 返回值
    // 挂监听（"goose-note:file-changed" 监听在独立 effect 中无条件注册），
    // 返回 undefined 不会让监听短路。

    watch(dir: string, _cb: any): any {
      watchedDirs.add(dir);
      return undefined;
    },

    unwatch(dir: string): void {
      watchedDirs.delete(dir);
    },

    // --- optional helpers ---

    readFileBase64(path: string): string | null {
      const c = memReadFile(path);
      return c !== null ? btoa(c) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// __gooseTest handles
// ---------------------------------------------------------------------------

type PageInfo = { id: string; title: string; localFilePath: string };

type GooseTestHandle = {
  setupMockNotebook(): Promise<{ notebookId: string; pages: PageInfo[] }>;
  getWriteLog(): WriteLogEntry[];
  resetWriteLog(): void;
  readMockFile(path: string): string | null;
  /** 静默改盘：只更新内存 fs，不派发任何事件、不记 writeLog。模拟 watch 不在场期间（窗口隐藏/插件退出）的外部修改，供新鲜度检查测试用。 */
  setMockFile(path: string, content: string): void;
  /** 模拟外部进程修改文件内容：更新内存 fs（不记 writeLog）+ 派发 change 事件。返回派发的 detail。 */
  simulateExternalChange(path: string, newContent: string): FileChangedDetail;
  /** 模拟外部进程删除文件/目录：内存 fs 移除 + 派发 rename 事件（Node 删除语义）。 */
  simulateExternalDelete(path: string): FileChangedDetail;
  /** 模拟外部进程新建文件：内存 fs 写入（不记 writeLog）+ 派发 rename 事件（Node 新建语义）。 */
  simulateExternalCreate(path: string, content: string): FileChangedDetail;
  stores: {
    usePages: typeof import("@/stores/usePages").usePages;
    useNotebooks: typeof import("@/stores/useNotebooks").useNotebooks;
    useTabs: typeof import("@/stores/useTabs").useTabs;
  };
};

// ---------------------------------------------------------------------------
// Main activation
// ---------------------------------------------------------------------------

export async function installE2ELocalMock(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (!location.search.includes("e2eLocalMock")) return;

  console.log(
    "%c[e2eLocalMock] 🟢 DEV harness ACTIVE — window.gooseFs is mocked, window.__gooseTest is available",
    "background:#1a1a2e;color:#00ff88;font-weight:bold;padding:4px 8px;border-radius:4px",
  );

  initMemFs();

  // Install mock gooseFs **before** setupMarkdownOpenWriteGuard runs so the
  // guard wraps the mock methods (exactly as it would wrap real uTools methods).
  window.gooseFs = buildMockGooseFs();

  // Initialise the write log on window for external inspection
  (window as any).__gooseFsLog = writeLog;

  // Lazy-import stores (they are already loaded by the time this settles, but
  // using dynamic import keeps the DEV-only code path tree-shakeable and avoids
  // circular dep issues at module evaluation time).
  const [{ usePages }, { useNotebooks }, { useTabs }] = await Promise.all([
    import("@/stores/usePages"),
    import("@/stores/useNotebooks"),
    import("@/stores/useTabs"),
  ]);

  const handle: GooseTestHandle = {
    async setupMockNotebook() {
      // 1. Create local-folder notebook pointing at /mock-notes
      const notebookId = useNotebooks.getState().createLocalFolderNotebook(
        "Mock Notes",
        "/mock-notes",
      );

      // 2. Switch to the notebook so the UI follows
      useNotebooks.setState({ activeNotebookId: notebookId });

      // 3. Load pages via the real store action
      await usePages.getState().loadLocalFolderPages(notebookId, "/mock-notes");

      // 4. Collect loaded pages for the caller
      const pages: PageInfo[] = Object.values(usePages.getState().pages)
        .filter((p) => p.workspaceId === notebookId && !p.isFolder)
        .map((p) => ({
          id: p.id,
          title:
            typeof p.localFilePath === "string"
              ? p.localFilePath.replace(/^.*[\\/]/, "").replace(/\.(md|markdown)$/i, "")
              : p.id,
          localFilePath: p.localFilePath ?? "",
        }));

      return { notebookId, pages };
    },

    getWriteLog() {
      return [...writeLog];
    },

    resetWriteLog() {
      writeLog.length = 0;
      (window as any).__gooseFsLog = writeLog;
    },

    readMockFile(path: string) {
      return Object.prototype.hasOwnProperty.call(memFs, path) ? memFs[path] : null;
    },

    setMockFile(path: string, content: string) {
      memFs[path] = content;
    },

    simulateExternalChange(path: string, newContent: string) {
      return simulateExternalChangeImpl(path, newContent);
    },

    simulateExternalDelete(path: string) {
      return simulateExternalDeleteImpl(path);
    },

    simulateExternalCreate(path: string, content: string) {
      return simulateExternalCreateImpl(path, content);
    },

    stores: { usePages, useNotebooks, useTabs },
  };

  (window as any).__gooseTest = handle;
}
