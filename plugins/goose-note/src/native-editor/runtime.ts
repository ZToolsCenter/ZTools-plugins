import type { EditorPlatform } from "@/components/editor/platform/types";
import type { FileAttachmentAttrs } from "@/types";
import {
  NativeLocalAssetBridge,
  NativeLocalResourceBridge,
  postToHost,
  createRequestID,
} from "./bridge";

export const nativeResourceBridge = new NativeLocalResourceBridge();
export const nativeAssetBridge = new NativeLocalAssetBridge();

function currentContext() {
  const context = window.__gooseBridgeContext;
  if (!context?.pageID) throw new Error("当前没有可用的 Markdown 文件上下文。");
  return context;
}

function extensionForMime(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized === "video/quicktime") return "mov";
  const subtype = normalized.split("/")[1]?.replace(/[^a-z0-9.+-]/g, "");
  return subtype?.split("+")[0] || "bin";
}

async function resolveLocalBlob(reference: string) {
  const url = await nativeResourceBridge.resolve(reference, currentContext());
  const response = await fetch(url);
  if (!response.ok) throw new Error(`资源读取失败（${response.status}）。`);
  return await response.blob();
}

async function saveBlob(blob: Blob, filename: string, mediaType: string) {
  return await nativeAssetBridge.save(
    blob,
    filename,
    mediaType,
    currentContext(),
  );
}

async function copyImage(dataURL: string) {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("当前系统不支持复制图片。");
  }
  const response = await fetch(dataURL);
  const blob = await response.blob();
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || "image/png"]: blob }),
  ]);
}

export const nativeEditorPlatform: EditorPlatform = {
  fs: {
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
  },
  shell: {
    openPath: async () => false,
    showItemInFolder: async () => false,
    openUrl: async (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return;
      }
      if (!new Set(["http:", "https:", "mailto:"]).has(url.protocol)) return;
      const context = currentContext();
      postToHost({
        version: 1,
        type: "openExternalLink",
        requestID: createRequestID(),
        pageID: context.pageID,
        revision: context.revision,
        url: url.href,
      });
    },
    showNotification: () => {},
    getDownloadsPath: async () => null,
  },
  imageStorage: {
    save: async (blob, mimeType) => {
      const type = mimeType || blob.type || "application/octet-stream";
      const name = `asset_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${extensionForMime(type)}`;
      return (await saveBlob(blob, name, type)).relativePath;
    },
    load: async (reference) => {
      try {
        return await resolveLocalBlob(reference);
      } catch {
        return null;
      }
    },
    delete: async () => {},
    resolveRefToUrl: async (reference) => {
      if (/^(?:data|blob):/i.test(reference)) return reference;
      if (/^https?:/i.test(reference)) {
        throw new Error("原生编辑器不读取远程媒体。");
      }
      return await nativeResourceBridge.resolve(reference, currentContext());
    },
  },
  dialog: {
    showSaveDialog: async () => null,
    showOpenDialog: async () => null,
    selectDirectory: async () => null,
    restoreLastDirectory: async () => null,
  },
  clipboard: {
    copyText: async (text) => navigator.clipboard?.writeText(text),
    copyImage,
    readText: async () => navigator.clipboard?.readText() ?? "",
  },
  ai: {},
};

export const nativeFileStorage = {
  async save(file: File): Promise<FileAttachmentAttrs> {
    const saved = await saveBlob(
      file,
      file.name || "附件",
      file.type || "application/octet-stream",
    );
    return {
      storageRef: saved.relativePath,
      fileName: file.name || "附件",
      mimeType: saved.mediaType,
      size: file.size,
      uploadedAt: Date.now(),
    };
  },
  async load(reference: string) {
    try {
      return await resolveLocalBlob(reference);
    } catch {
      return null;
    }
  },
  async open() {
    return { ok: false, error: "请使用附件块的下载按钮。" };
  },
  async delete() {},
};

export const nativeVideoStorage = {
  async save(file: File) {
    return (
      await saveBlob(file, file.name || "video.mp4", file.type || "video/mp4")
    ).relativePath;
  },
  async load(reference: string) {
    try {
      return await resolveLocalBlob(reference);
    } catch {
      return null;
    }
  },
  canHandle(reference: string) {
    return /\.(?:mp4|m4v|mov|webm|avi|mkv)$/i.test(reference);
  },
};
