export { nativeFileStorage as fileStorage } from "./runtime";

export const MAX_FILE_ATTACHMENT_SIZE = 8 * 1024 * 1024;

export function getFileUploadAvailability() {
  return { enabled: true };
}

export function sanitizeFileName(fileName: string) {
  return (fileName.trim() || "附件").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 180);
}

export function formatAttachmentSize(size: number) {
  if (!Number.isFinite(size) || size < 0) return "--";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function getAttachmentBadgeLabel(fileName: string, mimeType: string) {
  const extension = fileName.split(".").pop()?.trim();
  if (extension && extension !== fileName) return extension.toUpperCase();
  return mimeType.includes("/") ? mimeType.split("/")[1].toUpperCase() : "FILE";
}
