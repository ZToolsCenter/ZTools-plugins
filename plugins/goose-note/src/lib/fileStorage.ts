import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { UToolsAdapter } from "@/lib/utools";
import { fs } from "@/lib/utools/fs";
import type { FileAttachmentAttrs } from "@/types";

export const MAX_FILE_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const FILE_ATTACHMENT_PREFIX = "att-file:";
const FILE_ID_PREFIX = "goose-file/";
const TEMP_ATTACHMENT_PREFIX = "goose-note/attachments";
const DEFAULT_MIME_TYPE = "application/octet-stream";

let tempCleanupPromise: Promise<void> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const normalized = trimmed.length > 0 ? trimmed : "attachment";
  // eslint-disable-next-line no-control-regex -- 有意匹配控制字符以清洗文件名
  return normalized.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180);
}

function getAttachmentId(storageRef: string): string {
  return storageRef.replace(FILE_ATTACHMENT_PREFIX, "");
}

function resolveCurrentNotebookSource(): "default" | "local-folder" | "unknown" {
  const { activePageId, pages } = usePages.getState();
  const pageWorkspaceId = activePageId ? pages[activePageId]?.workspaceId : null;
  const notebookId = pageWorkspaceId ?? useNotebooks.getState().activeNotebookId;

  if (!notebookId) return "unknown";
  const notebook = useNotebooks.getState().notebooks[notebookId];
  return notebook?.source === "local-folder" ? "local-folder" : "default";
}

export function getFileUploadAvailability(): {
  enabled: boolean;
  reason?: string;
} {
  if (resolveCurrentNotebookSource() === "local-folder") {
    return {
      enabled: false,
      reason: "本地文件夹记事本暂不支持附件上传",
    };
  }

  return { enabled: true };
}

export function formatAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "--";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function getAttachmentBadgeLabel(fileName: string, mimeType: string): string {
  const extension = fileName.split(".").pop()?.trim();
  if (extension && extension !== fileName) {
    return extension.toUpperCase();
  }

  if (mimeType.includes("/")) {
    return mimeType.split("/")[1].toUpperCase();
  }

  return "FILE";
}

async function ensureTempCleanup(): Promise<void> {
  if (tempCleanupPromise) {
    return tempCleanupPromise;
  }

  tempCleanupPromise = (async () => {
    try {
      await fs.cleanupTempFiles(TEMP_ATTACHMENT_PREFIX, 24 * 60 * 60 * 1000);
    } catch (error) {
      console.error("[fileStorage] cleanup temp files failed", error);
    }
  })().finally(() => {
    tempCleanupPromise = null;
  });

  return tempCleanupPromise;
}

export const fileStorage = {
  async save(file: File): Promise<FileAttachmentAttrs> {
    if (file.size === 0) {
      throw new Error("不能上传空文件");
    }

    if (file.size > MAX_FILE_ATTACHMENT_SIZE) {
      throw new Error("文件不能超过 10MB");
    }

    const attachmentId = `${FILE_ID_PREFIX}${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const mimeType = file.type || DEFAULT_MIME_TYPE;
    const buffer = new Uint8Array(await file.arrayBuffer());
    const result = UToolsAdapter.db.postAttachment(attachmentId, buffer, mimeType);

    if (!result || result.ok === false) {
      throw new Error("附件上传失败，请稍后重试");
    }

    return {
      storageRef: `${FILE_ATTACHMENT_PREFIX}${attachmentId}`,
      fileName: sanitizeFileName(file.name),
      mimeType,
      size: file.size,
      uploadedAt: Date.now(),
    };
  },

  async load(storageRef: string): Promise<Blob | null> {
    const attachmentId = getAttachmentId(storageRef);
    const data = UToolsAdapter.db.getAttachment(attachmentId);
    if (!data) return null;

    const mimeType = UToolsAdapter.db.getAttachmentType(attachmentId) || DEFAULT_MIME_TYPE;
    return new Blob([data.slice()], {
      type: mimeType,
    });
  },

  async open(
    storageRef: string,
    meta: { fileName: string; size: number },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!fs.isAvailable()) {
      return { ok: false, error: "uTools 文件桥接未就绪，无法打开附件" };
    }

    await ensureTempCleanup();

    const blob = await this.load(storageRef);
    if (!blob) {
      return { ok: false, error: "附件不存在或尚未同步完成" };
    }

    const attachmentId = getAttachmentId(storageRef).replace(/[\\/]/g, "_");
    const safeFileName = sanitizeFileName(meta.fileName);
    const base64 = arrayBufferToBase64(await blob.arrayBuffer());
    const tempFilePath = await fs.writeTempFile(
      `${TEMP_ATTACHMENT_PREFIX}/${attachmentId}/${safeFileName}`,
      base64,
    );

    if (!tempFilePath) {
      return { ok: false, error: "临时文件写入失败" };
    }

    const opened = await UToolsAdapter.openPath(tempFilePath);
    if (!opened) {
      return { ok: false, error: "系统默认应用打开失败" };
    }

    return { ok: true };
  },

  async delete(storageRef: string): Promise<void> {
    const attachmentId = getAttachmentId(storageRef);
    UToolsAdapter.db.remove(attachmentId);
  },
};
