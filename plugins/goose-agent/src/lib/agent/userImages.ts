/**
 * 用户附图：选图 / 粘贴 / 拖入后压缩为 base64，供 Composer 与会话 part 使用。
 * 输出无 data: 前缀；展示用 attachmentToDataUrl。
 */

export const USER_IMAGE_MAX_COUNT = 4;
/** 压缩后最长边（px） */
export const USER_IMAGE_MAX_EDGE = 1280;
/** 压缩后体积上限 */
export const USER_IMAGE_MAX_BYTES = 512 * 1024;
/** JPEG 质量 */
export const USER_IMAGE_JPEG_QUALITY = 0.8;

export const USER_IMAGE_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type UserImageAllowedMime = (typeof USER_IMAGE_ALLOWED_MIME)[number];

export interface UserImageAttachment {
  id: string;
  mediaType: string;
  /** 无 data: 前缀的 base64 */
  dataBase64: string;
  width?: number;
  height?: number;
}

export function createImageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `img-${globalThis.crypto.randomUUID()}`;
  }
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isAllowedImageMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const lower = mime.trim().toLowerCase();
  return (USER_IMAGE_ALLOWED_MIME as readonly string[]).includes(lower);
}

export function attachmentToDataUrl(a: UserImageAttachment): string {
  return `data:${a.mediaType};base64,${a.dataBase64}`;
}

function stripDataUrlBase64(dataUrl: string): {
  mediaType: string;
  dataBase64: string;
} {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (match?.[1] && match[2] != null) {
    return { mediaType: match[1], dataBase64: match[2] };
  }
  return { mediaType: "image/jpeg", dataBase64: dataUrl };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof quality === "number") {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), mimeType);
  });
}

function resolveTargetSize(
  origW: number,
  origH: number,
  maxEdge: number,
): { width: number; height: number } {
  if (Math.max(origW, origH) <= maxEdge) {
    return { width: origW, height: origH };
  }
  if (origW >= origH) {
    return {
      width: maxEdge,
      height: Math.max(1, Math.round((origH / origW) * maxEdge)),
    };
  }
  return {
    width: Math.max(1, Math.round((origW / origH) * maxEdge)),
    height: maxEdge,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("读取图片失败"));
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("当前环境不支持图片解码");
  }
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error("图片解码失败，请确认不是损坏文件");
  }
}

/**
 * 将 Blob/File 压成 JPEG，返回 UserImageAttachment。
 * 超边缩放；体积仍超限时降质量再试。
 */
export async function compressImageBlob(blob: Blob): Promise<UserImageAttachment> {
  if (!blob || blob.size === 0) {
    throw new Error("图片为空");
  }

  const declared = (blob.type || "").toLowerCase();
  if (declared && !isAllowedImageMime(declared) && !declared.startsWith("image/")) {
    throw new Error("仅支持图片文件");
  }

  const bitmap = await decodeBitmap(blob);
  const size = resolveTargetSize(
    bitmap.width,
    bitmap.height,
    USER_IMAGE_MAX_EDGE,
  );
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("无法创建画布，图片处理失败");
  }
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  let quality = USER_IMAGE_JPEG_QUALITY;
  let encoded: Blob | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    encoded = await canvasToBlob(canvas, "image/jpeg", quality);
    if (encoded && encoded.size > 0 && encoded.size <= USER_IMAGE_MAX_BYTES) {
      break;
    }
    quality = Math.max(0.45, quality - 0.15);
  }

  if (!encoded || encoded.size === 0) {
    throw new Error("图片压缩失败");
  }
  if (encoded.size > USER_IMAGE_MAX_BYTES) {
    throw new Error(
      `图片过大（约 ${(encoded.size / 1024).toFixed(0)}KB），请换一张较小的图`,
    );
  }

  const dataUrl = await blobToDataUrl(encoded);
  const { mediaType, dataBase64 } = stripDataUrlBase64(dataUrl);
  return {
    id: createImageId(),
    mediaType: mediaType || encoded.type || "image/jpeg",
    dataBase64,
    width: size.width,
    height: size.height,
  };
}

export async function compressImageFile(
  file: File,
): Promise<UserImageAttachment> {
  if (!file) throw new Error("未选择图片");
  if (
    file.type &&
    !file.type.startsWith("image/") &&
    file.type !== ""
  ) {
    throw new Error("仅支持图片文件");
  }
  return compressImageBlob(file);
}
