/**
 * noopPlatform —— 纯浏览器/测试兜底实现。
 *
 * 无 EditorPlatformProvider 时 `useEditorPlatform()` 返回此实现，保证编辑器内核
 * 在无宿主注入时仍能 build 且不崩。能用 Web API 表达的（下载用 a.click、剪贴板用
 * navigator.clipboard）就地实现，其余无对等 Web API 的能力 no-op 或抛"未实现"。
 *
 * 真实平台能力由各宿主注入对应实现。
 *
 * 来源：plans/2026-06-01-Tauri迁移与编辑器抽取计划/extraction-blueprint.md §1 / §4 Step 4
 */
import type {
  EditorPlatform,
  EditorPlatformAi,
  EditorPlatformClipboard,
  EditorPlatformDialog,
  EditorPlatformFs,
  EditorPlatformImageStorage,
  EditorPlatformShell,
} from "./types";

function notImplemented(method: string): never {
  throw new Error(`[EditorPlatform] ${method} 未实现（noopPlatform）`);
}

const fs: EditorPlatformFs = {
  isAvailable: () => false,
  readFileAsync: async () => null,
  readFileStatAsync: async () => null,
  readFileBase64: async () => null,
  writeFileAsync: async () => false,
  writeTempFile: async () => null,
  cleanupTempFiles: async () => {},
  existsAsync: async () => false,
  mkdir: async () => false,
  readDirAsync: async () => [],
  deleteFile: async () => false,
  deleteDir: async () => false,
  rename: async () => false,
  watch: () => () => {},
  revealItemInFolder: async () => false,
};

const shell: EditorPlatformShell = {
  openPath: async () => false,
  showItemInFolder: async () => false,
  openUrl: async (url) => {
    if (typeof window !== "undefined" && url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
  showNotification: () => {},
  getDownloadsPath: async () => null,
};

const imageStorage: EditorPlatformImageStorage = {
  save: () => notImplemented("imageStorage.save"),
  load: async () => null,
  delete: async () => {},
  // 浏览器兜底：仅原样返回可直接渲染的引用（http/data/blob）
  resolveRefToUrl: async (ref) => ref,
};

const dialog: EditorPlatformDialog = {
  showSaveDialog: async () => null,
  showOpenDialog: async () => null,
  selectDirectory: async () => null,
  restoreLastDirectory: async () => null,
};

const clipboard: EditorPlatformClipboard = {
  copyText: async (text) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  },
  copyImage: async (dataUrl) => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard ||
      typeof ClipboardItem === "undefined"
    ) {
      return;
    }
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  },
  readText: async () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      return navigator.clipboard.readText();
    }
    return "";
  },
};

const ai: EditorPlatformAi = {};

export const noopPlatform: EditorPlatform = {
  fs,
  shell,
  imageStorage,
  dialog,
  clipboard,
  ai,
};
