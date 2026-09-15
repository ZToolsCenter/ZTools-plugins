/**
 * 浏览器预览用 gooseFs mock（File System Access API）。
 * 真机以 preload 注入为准；web 无 API 时仅 console 降级提示。
 */

type DirHandle = FileSystemDirectoryHandle;
type FileHandle = FileSystemFileHandle;
type AnyHandle = DirHandle | FileHandle;

interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
}

const mounts = new Map<string, DirHandle>();

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "") || "/";
}

function findMount(absPath: string): {
  basePath: string;
  handle: DirHandle;
  relPath: string;
} | null {
  const norm = normalizePath(absPath);
  for (const [base, handle] of mounts) {
    if (norm === base) return { basePath: base, handle, relPath: "" };
    const baseWithSep = base.endsWith("/") ? base : `${base}/`;
    if (norm.startsWith(baseWithSep)) {
      return {
        basePath: base,
        handle,
        relPath: norm.slice(baseWithSep.length),
      };
    }
  }
  return null;
}

function splitRelative(relPath: string): string[] {
  return relPath.split("/").filter(Boolean);
}

async function getDirHandle(
  root: DirHandle,
  parts: string[],
  options: { create?: boolean } = {},
): Promise<DirHandle | null> {
  let cur: DirHandle = root;
  for (const part of parts) {
    try {
      cur = await cur.getDirectoryHandle(part, { create: !!options.create });
    } catch {
      return null;
    }
  }
  return cur;
}

async function getFileHandle(
  root: DirHandle,
  parts: string[],
  options: { create?: boolean } = {},
): Promise<FileHandle | null> {
  if (parts.length === 0) return null;
  const parentParts = parts.slice(0, -1);
  const fileName = parts[parts.length - 1];
  if (!fileName) return null;
  const parent = await getDirHandle(root, parentParts, {
    create: options.create,
  });
  if (!parent) return null;
  try {
    return await parent.getFileHandle(fileName, { create: !!options.create });
  } catch {
    return null;
  }
}

async function resolveHandle(absPath: string): Promise<AnyHandle | null> {
  const mount = findMount(absPath);
  if (!mount) return null;
  const parts = splitRelative(mount.relPath);
  if (parts.length === 0) return mount.handle;
  const fh = await getFileHandle(mount.handle, parts);
  if (fh) return fh;
  return getDirHandle(mount.handle, parts);
}

async function readFileImpl(absPath: string): Promise<string | null> {
  const handle = await resolveHandle(absPath);
  if (!handle || handle.kind !== "file") return null;
  try {
    const file = await (handle as FileHandle).getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function readDirImpl(absPath: string): Promise<DirEntry[]> {
  const handle = await resolveHandle(absPath);
  if (!handle || handle.kind !== "directory") return [];
  const base = normalizePath(absPath);
  const out: DirEntry[] = [];
  const dir = handle as DirHandle & {
    entries?: () => AsyncIterableIterator<[string, AnyHandle]>;
  };
  if (!dir.entries) return [];
  for await (const [name, entry] of dir.entries()) {
    const isDir = entry.kind === "directory";
    out.push({
      name,
      isFile: !isDir,
      isDirectory: isDir,
      path: `${base === "/" ? "" : base}/${name}`,
    });
  }
  return out;
}

async function writeFileImpl(
  absPath: string,
  content: string,
  encoding?: string,
): Promise<boolean> {
  const mount = findMount(absPath);
  if (!mount) return false;
  const parts = splitRelative(mount.relPath);
  const fh = await getFileHandle(mount.handle, parts, { create: true });
  if (!fh) return false;
  try {
    const writable = await (
      fh as FileSystemFileHandle & {
        createWritable: () => Promise<FileSystemWritableFileStream>;
      }
    ).createWritable();
    if (encoding === "base64") {
      const bin = atob(content);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      await writable.write(buf);
    } else {
      await writable.write(content);
    }
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

async function existsImpl(absPath: string): Promise<boolean> {
  const mount = findMount(absPath);
  if (!mount) return false;
  const parts = splitRelative(mount.relPath);
  if (parts.length === 0) return true;
  if (await getFileHandle(mount.handle, parts)) return true;
  return !!(await getDirHandle(mount.handle, parts));
}

async function deleteEntryImpl(
  absPath: string,
  recursive: boolean,
): Promise<boolean> {
  const mount = findMount(absPath);
  if (!mount) return false;
  const parts = splitRelative(mount.relPath);
  if (parts.length === 0) return false;
  const parent = await getDirHandle(mount.handle, parts.slice(0, -1));
  if (!parent) return false;
  const name = parts[parts.length - 1];
  if (!name) return false;
  try {
    await (
      parent as DirHandle & {
        removeEntry: (
          n: string,
          opts?: { recursive?: boolean },
        ) => Promise<void>;
      }
    ).removeEntry(name, { recursive });
    return true;
  } catch {
    return false;
  }
}

async function renameImpl(oldPath: string, newPath: string): Promise<boolean> {
  const content = await readFileImpl(oldPath);
  if (content == null) return false;
  if (!(await writeFileImpl(newPath, content))) return false;
  return deleteEntryImpl(oldPath, false);
}

async function mkdirImpl(absPath: string): Promise<boolean> {
  const mount = findMount(absPath);
  if (!mount) return false;
  const parts = splitRelative(mount.relPath);
  if (parts.length === 0) return true;
  return !!(await getDirHandle(mount.handle, parts, { create: true }));
}

async function pickAndMount(): Promise<string | null> {
  const w = window as Window & {
    showDirectoryPicker?: (opts?: {
      mode?: "read" | "readwrite";
    }) => Promise<DirHandle>;
  };
  if (typeof w.showDirectoryPicker !== "function") {
    console.warn(
      "[goose-agent/web-fs] 当前浏览器不支持 showDirectoryPicker，无法选目录",
    );
    return null;
  }
  try {
    const handle = await w.showDirectoryPicker({ mode: "readwrite" });
    const name = handle.name || "本地文件夹";
    let basePath = `/${name}`;
    let i = 2;
    while (mounts.has(basePath)) {
      basePath = `/${name}-${i++}`;
    }
    mounts.set(basePath, handle);
    return basePath;
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") return null;
    console.error("[goose-agent/web-fs] showDirectoryPicker failed:", err);
    return null;
  }
}

const webGooseFs: GooseFs = {
  readDir: () => [],
  readDirAsync: async (p) => readDirImpl(p),
  readFile: () => null,
  readFileAsync: async (p) => readFileImpl(p),
  readFileStat: () => ({
    ok: false,
    error: "web mock 请使用 async",
    content: null,
  }),
  readFileStatAsync: async (p) => {
    const content = await readFileImpl(p);
    if (content === null) {
      return { ok: false, error: "文件读取失败或不存在", content: null };
    }
    return { ok: true, content };
  },
  writeFile: () => false,
  writeFileAsync: async (p, content, encoding) =>
    writeFileImpl(p, content, encoding),
  exists: () => false,
  existsAsync: async (p) => existsImpl(p),
  realpathAsync: async (p) => p,
  mkdir: async (p) => mkdirImpl(p),
  deleteFile: async (p) => deleteEntryImpl(p, false),
  deleteDir: async (p) => deleteEntryImpl(p, true),
  rename: async (a, b) => renameImpl(a, b),
  selectDirectory: pickAndMount,
};

/**
 * 在无 preload gooseFs 时安装 web mock。
 * @returns 是否成功安装
 */
export function installWebGooseFs(): boolean {
  if (typeof window === "undefined") return false;
  if (window.gooseFs) return false;
  if (window.utools || window.gooseAgent) return false;

  if (!("showDirectoryPicker" in window)) {
    console.warn(
      "[goose-agent/web-fs] 无 File System Access API；FS 操作将降级为空实现（真机以 gooseFs 为准）",
    );
    // 仍注入空实现，避免调用方判空分叉过多
    window.gooseFs = {
      readDir: () => [],
      readDirAsync: async () => [],
      readFile: () => null,
      readFileAsync: async () => null,
      writeFile: () => false,
      writeFileAsync: async () => false,
      exists: () => false,
      existsAsync: async () => false,
      mkdir: () => false,
      deleteFile: async () => false,
      deleteDir: async () => false,
      rename: () => false,
      selectDirectory: async () => {
        console.warn("[goose-agent/web-fs] 选目录不可用（需 Chromium + secure context）");
        return null;
      },
    };
    return true;
  }

  window.gooseFs = webGooseFs;
  return true;
}
