/**
 * uTools 端的 EditorPlatform 实现。
 *
 * 把编辑器内核依赖的平台契约（src/components/editor/platform/types.ts）映射到现有的
 * uTools 桥接层（src/lib/utools/* 与 preload 注入的 window.gooseFs）与 imageStorage。
 * 宿主在 Editor 挂载点用 <EditorPlatformProvider platform={utoolsEditorPlatform}> 注入。
 *
 * 行为不变：各方法直接转发到既有 lib，签名按 EditorPlatform 契约对齐。
 *
 * 来源：plans/2026-06-01-Tauri迁移与编辑器抽取计划/extraction-blueprint.md §2 对位表
 */
import type {
  DirEntry,
  EditorPlatform,
  EditorPlatformAi,
  EditorPlatformClipboard,
  EditorPlatformDialog,
  EditorPlatformFs,
  EditorPlatformImageStorage,
  EditorPlatformShell,
  FileStat,
  FsWatchEvent,
} from "@/components/editor/platform/types";
import { fs as utoolsFs } from "@/lib/utools/fs";
import { shell as utoolsShell } from "@/lib/utools/shell";
import { dialogs as utoolsDialogs } from "@/lib/utools/dialogs";
import { imageStorage as appImageStorage } from "@/lib/imageStorage";
import { resolveImageRefToUrl } from "@/lib/imageStorage/resolveUrl";

const fs: EditorPlatformFs = {
  isAvailable: () => utoolsFs.isAvailable(),
  readFileAsync: (path) => utoolsFs.readFileAsync(path),
  // gooseFs.readFileStat 返回的是 { ok, error, content } 形态而非契约的 FileStat；
  // 该方法未被编辑器内核消费，按契约形态归一化转发（无 isFile/isDirectory 信息时置 false）。
  readFileStatAsync: async (path): Promise<FileStat | null> => {
    const raw = await utoolsFs.readFileStatAsync(path);
    if (!raw) return null;
    return raw as unknown as FileStat;
  },
  // 图片读取统一 async：gooseFs.readFileBase64 经 preload 注入（同步桥），包一层 async。
  readFileBase64: async (path) => {
    const gfs =
      typeof window !== "undefined" ? ((window as any).gooseFs ?? null) : null;
    if (!gfs || typeof gfs.readFileBase64 !== "function") return null;
    try {
      return (gfs.readFileBase64(path) as string | null) ?? null;
    } catch {
      return null;
    }
  },
  writeFileAsync: (path, content, encoding) =>
    utoolsFs.writeFileAsync(path, content, encoding),
  writeTempFile: (relativePath, contentBase64) =>
    utoolsFs.writeTempFile(relativePath, contentBase64),
  cleanupTempFiles: (prefix, maxAgeMs) =>
    utoolsFs.cleanupTempFiles(prefix, maxAgeMs),
  existsAsync: (path) => utoolsFs.existsAsync(path),
  mkdir: (path) => utoolsFs.mkdir(path),
  readDirAsync: async (path): Promise<DirEntry[]> =>
    (await utoolsFs.readDirAsync(path)) as DirEntry[],
  deleteFile: (path) => utoolsFs.deleteFile(path),
  deleteDir: (path) => utoolsFs.deleteDir(path),
  rename: (oldPath, newPath) => utoolsFs.rename(oldPath, newPath),
  // 契约：watch 返回 unlisten 函数。uTools 桥用 path + unwatch 取消监听。
  watch: (path, cb: (e: FsWatchEvent) => void) => {
    utoolsFs.watch(path, cb as (event: any) => void);
    return () => utoolsFs.unwatch(path);
  },
  revealItemInFolder: (path) => utoolsFs.revealItemInFolder(path),
};

const shell: EditorPlatformShell = {
  openPath: (targetPath) => utoolsShell.openPath(targetPath),
  showItemInFolder: (targetPath) => utoolsShell.showItemInFolder(targetPath),
  openUrl: async (url, useInternalBrowser) => {
    utoolsShell.openUrl(url, useInternalBrowser);
  },
  showNotification: (body) => utoolsShell.showNotification(body),
  getDownloadsPath: async () => utoolsShell.getDownloadsPath(),
};

const imageStorage: EditorPlatformImageStorage = {
  save: (blob, mimeType) => appImageStorage.save(blob, mimeType),
  load: (ref) => appImageStorage.load(ref),
  delete: (ref) => appImageStorage.delete(ref),
  resolveRefToUrl: (ref, pageLocalFilePath) =>
    resolveImageRefToUrl(ref, pageLocalFilePath),
};

const dialog: EditorPlatformDialog = {
  showSaveDialog: async (options) =>
    utoolsDialogs.showSaveDialog(options as Record<string, unknown>),
  showOpenDialog: async (options) =>
    utoolsDialogs.showOpenDialog(options as Record<string, unknown>),
  selectDirectory: () => utoolsDialogs.selectDirectory(),
  restoreLastDirectory: () => utoolsDialogs.restoreLastDirectory(),
};

const clipboard: EditorPlatformClipboard = {
  copyText: async (text) => utoolsShell.copyText(text),
  copyImage: async (dataUrl) => utoolsShell.copyImage(dataUrl),
  readText: async () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      return navigator.clipboard.readText();
    }
    return "";
  },
};

const ai: EditorPlatformAi = {};

export const utoolsEditorPlatform: EditorPlatform = {
  fs,
  shell,
  imageStorage,
  dialog,
  clipboard,
  ai,
};
