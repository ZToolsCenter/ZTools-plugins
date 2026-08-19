/**
 * Web 端的 File System Access API 适配层。把 `showDirectoryPicker` 返回的
 * `FileSystemDirectoryHandle` 包成与 uTools 的 `window.gooseFs` 同构的接口，
 * 让 scanner / saveLocalPageContent / rename 等已有逻辑不用区分宿主就能跑。
 *
 * 局限：
 * - 浏览器要求 secure context（https 或 localhost）才能调 showDirectoryPicker。
 * - Handle 只在当前 session 有效；刷新页面后需重新选择文件夹。
 * - 不支持 watch / unwatch（浏览器没有等价 API）。
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
      return { basePath: base, handle, relPath: norm.slice(baseWithSep.length) };
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
  const parent = await getDirHandle(root, parentParts, { create: options.create });
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
  // 先按文件试，再按目录试
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
  // FileSystemDirectoryHandle 的迭代器在 TS 默认 lib 里类型可能不完整
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
    const writable = await (fh as FileSystemFileHandle & {
      createWritable: (opts?: { keepExistingData?: boolean }) => Promise<
        FileSystemWritableFileStream
      >;
    }).createWritable();
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
  const fh = await getFileHandle(mount.handle, parts);
  if (fh) return true;
  const dh = await getDirHandle(mount.handle, parts);
  return !!dh;
}

async function deleteEntryImpl(absPath: string, recursive: boolean): Promise<boolean> {
  const mount = findMount(absPath);
  if (!mount) return false;
  const parts = splitRelative(mount.relPath);
  if (parts.length === 0) return false;
  const parent = await getDirHandle(mount.handle, parts.slice(0, -1));
  if (!parent) return false;
  try {
    await (parent as DirHandle & {
      removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
    }).removeEntry(parts[parts.length - 1], { recursive });
    return true;
  } catch {
    return false;
  }
}

async function renameImpl(oldPath: string, newPath: string): Promise<boolean> {
  const oldMount = findMount(oldPath);
  const newMount = findMount(newPath);
  if (!oldMount || !newMount) return false;
  // 浏览器没有原子 rename：先 copy 再 delete。
  const content = await readFileImpl(oldPath);
  if (content == null) return false;
  const written = await writeFileImpl(newPath, content);
  if (!written) return false;
  return deleteEntryImpl(oldPath, false);
}

async function mkdirImpl(absPath: string): Promise<boolean> {
  const mount = findMount(absPath);
  if (!mount) return false;
  const parts = splitRelative(mount.relPath);
  if (parts.length === 0) return true;
  const dh = await getDirHandle(mount.handle, parts, { create: true });
  return !!dh;
}

async function pickAndMount(): Promise<string | null> {
  const w = window as Window & {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<DirHandle>;
  };
  if (typeof w.showDirectoryPicker !== "function") return null;
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
    console.error("[web-fs] showDirectoryPicker failed:", err);
    return null;
  }
}

export const webGooseFs: GooseFs = {
  readDir: () => {
    // 同步版本在浏览器里不可行，强制 caller 走 async。
    return [];
  },
  readDirAsync: async (path: string) => readDirImpl(path),
  readFile: () => null,
  readFileAsync: async (path: string) => readFileImpl(path),
  readFileStat: undefined as unknown as GooseFs["readFileStat"],
  readFileStatAsync: async (path: string) => {
    const content = await readFileImpl(path);
    if (content === null) {
      return { ok: false, error: "文件读取失败或不存在", content: null };
    }
    return { ok: true, content };
  },
  writeFile: () => false,
  writeFileAsync: async (path: string, content: string, encoding?: string) =>
    writeFileImpl(path, content, encoding),
  exists: () => {
    // 浏览器没有同步 exists；保守返回 false，调用方应使用 existsAsync。
    return false;
  },
  existsAsync: async (path: string) => existsImpl(path),
  watch: () => null,
  unwatch: () => {},
  mkdir: async (path: string) => mkdirImpl(path),
  deleteFile: async (path: string) => deleteEntryImpl(path, false),
  deleteDir: async (path: string) => deleteEntryImpl(path, true),
  rename: async (oldPath: string, newPath: string) => renameImpl(oldPath, newPath),
  selectDirectory: pickAndMount,
} as unknown as GooseFs;

export function installWebGooseFs(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window;
  if (w.gooseFs) return false;
  if ((w as Window & { utools?: unknown }).utools) return false;
  if (!("showDirectoryPicker" in w)) {
    console.warn(
      "[web-fs] 当前浏览器不支持 File System Access API，无法启用本地文件夹模式",
    );
    return false;
  }
  w.gooseFs = webGooseFs;
  return true;
}
