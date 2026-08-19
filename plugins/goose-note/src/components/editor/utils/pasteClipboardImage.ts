const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|avi|mkv|flv|wmv)$/i;

/** 剪贴板 file item 是否应按图片块粘贴（含 Mac 空 file.type、靠 item.type/扩展名判断） */
export function isPasteableClipboardImageFile(
  file: File,
  itemType: string,
): boolean {
  if (itemType.startsWith("image/")) return true;
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name);
}

/** 剪贴板是否含可粘贴的图片文件（Mac 截图/复制图常同时带 text/html，需优先走 Files 上传路径） */
export function clipboardHasPasteableImage(
  data: DataTransfer | null | undefined,
): boolean {
  if (!data?.items?.length) return false;
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    if (isPasteableClipboardImageFile(file, item.type)) return true;
  }
  return false;
}

/**
 * 可测的剪贴板/拖放数据形状（避免单测 mock 完整 DataTransfer）。
 * 与 DataTransfer 兼容：优先 items（Mac 截图常 files 为空），再扫 files。
 */
export type ClipboardImageSource = {
  items?: ArrayLike<{
    kind: string;
    type: string;
    getAsFile: () => File | null;
  }> | null;
  files?: ArrayLike<File> | null;
};

/**
 * 从剪贴板/拖放数据提取图片 File。
 * Mac 截图/复制图常只有 items（files 为空）；item.type 有 image/* 而 file.type 可能为空。
 * 空 type 会按 item.type / 扩展名归一，便于下游 isImageUploadFile 通过。
 */
export function extractClipboardImageFiles(
  data: ClipboardImageSource | null | undefined,
): File[] {
  if (!data) return [];

  const fromItems: File[] = [];
  const items = data.items;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (!isPasteableClipboardImageFile(file, item.type)) continue;
      const mime =
        (file.type.startsWith("image/") && file.type) ||
        (item.type.startsWith("image/") && item.type) ||
        resolveImageMimeForUpload(file);
      fromItems.push(
        file.type === mime
          ? file
          : new File([file], file.name || `paste-${Date.now()}.png`, {
              type: mime,
              lastModified: file.lastModified,
            }),
      );
    }
  }
  if (fromItems.length > 0) return fromItems;

  const fromFiles: File[] = [];
  const files = data.files;
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (isImageUploadFile(file)) fromFiles.push(file);
    }
  }
  return fromFiles;
}

export function isPasteableClipboardVideoFile(
  file: File,
  itemType: string,
): boolean {
  return (
    itemType.startsWith("video/") ||
    file.type.startsWith("video/") ||
    VIDEO_EXT.test(file.name)
  );
}

export function clipboardHasPasteableMedia(
  data: DataTransfer | null | undefined,
): boolean {
  if (!data?.items?.length) return false;
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    const file = item.kind === "file" ? item.getAsFile() : null;
    if (
      file &&
      (isPasteableClipboardImageFile(file, item.type) ||
        isPasteableClipboardVideoFile(file, item.type))
    )
      return true;
  }
  return false;
}

/** 上传路径是否应按图片走 imageStorage（含剪贴板 type 为空的 Mac 截图，需有图片扩展名） */
export function isImageUploadFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name);
}

export function shouldUploadViaImageStorage(
  file: File,
  blockId: string | undefined,
  getBlock: ((id: string) => { type?: string } | undefined) | null | undefined,
): boolean {
  if (isImageUploadFile(file)) return true;
  if (!blockId || !getBlock) return false;
  const block = getBlock(blockId);
  return block?.type === "image" || block?.type === "imageResize";
}

/** 为 imageStorage.save 解析 MIME；仅应在 shouldUploadViaImageStorage 为 true 时调用 */
export function resolveImageMimeForUpload(file: File): string {
  if (file.type.startsWith("image/")) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    heic: "image/heic",
    heif: "image/heif",
    tif: "image/tiff",
    tiff: "image/tiff",
  };
  if (ext && map[ext]) return map[ext];
  // Mac 截图粘贴：空 type + 无扩展名，但目标块已是 image
  return "image/png";
}
