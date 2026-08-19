import type { EditorPlatform } from "@/components/editor/platform/types";
import { blobToBase64, convertImageBlobToPng } from "@/lib/imageProcessor";

export type ImageAlignment = "left" | "center" | "right";

export async function resolveImageSrc(
  src: string,
  platform: EditorPlatform,
  pageLocalFilePath?: string | null,
): Promise<string> {
  if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("blob:")) {
    return src;
  }
  return platform.imageStorage.resolveRefToUrl(src, pageLocalFilePath);
}

/**
 * 将编辑器图片引用复制为真正的位图数据。
 * 剪贴板统一写入 PNG，避免内部 att:/uuid: 引用或 WebP 被外部应用误当成文本。
 */
export async function copyImageSrcToClipboard(
  src: string,
  platform: EditorPlatform,
  pageLocalFilePath?: string | null,
): Promise<void> {
  let resolvedObjectUrl: string | null = null;
  try {
    const resolvedSrc = await resolveImageSrc(src, platform, pageLocalFilePath);
    if (resolvedSrc.startsWith("blob:") && resolvedSrc !== src) {
      resolvedObjectUrl = resolvedSrc;
    }
    const response = await fetch(resolvedSrc);
    if (!response.ok) {
      throw new Error(`图片读取失败（${response.status}）`);
    }
    const sourceBlob = await response.blob();
    const pngBlob = await convertImageBlobToPng(sourceBlob);
    await platform.clipboard.copyImage(await blobToBase64(pngBlob));
  } finally {
    if (resolvedObjectUrl) URL.revokeObjectURL(resolvedObjectUrl);
  }
}

export function getImageElements(container: HTMLElement): HTMLImageElement[] {
  return Array.from(container.querySelectorAll<HTMLImageElement>(
    '.bn-block-content[data-content-type="image"] img, .bn-block-content[data-content-type="imageResize"] img'
  ));
}

export function getImageBlockElement(img: HTMLImageElement, container: HTMLElement): HTMLElement | null {
  let element: HTMLElement | null = img;
  while (element && element !== container) {
    if (element.classList.contains("bn-block-outer")) return element;
    element = element.parentElement;
  }
  return img.closest<HTMLElement>(".bn-block-outer");
}

export function getBlockIdFromImage(img: HTMLImageElement, container: HTMLElement): string | null {
  const candidates: HTMLElement[] = [];
  let element: HTMLElement | null = img;
  while (element && element !== container) {
    candidates.push(element);
    element = element.parentElement;
  }

  for (const candidate of candidates) {
    const id =
      candidate.dataset.id ||
      candidate.dataset.blockId ||
      candidate.getAttribute("data-id") ||
      candidate.getAttribute("data-block-id");
    if (id) return id;
  }

  return null;
}

export function getImageSrc(img: HTMLImageElement): string {
  return img.currentSrc || img.src || img.getAttribute("src") || "";
}

export function getImageBlockIdByIndex(blocks: any[], imageIndex: number): string | null {
  let currentIndex = -1;
  let result: string | null = null;

  const visit = (items: any[]) => {
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "image" || item.type === "imageResize") {
        currentIndex += 1;
        if (currentIndex === imageIndex) {
          result = item.id ?? null;
          return;
        }
      }
      if (Array.isArray(item.children)) visit(item.children);
      if (result) return;
    }
  };

  const docBlocks = Array.isArray(blocks) ? blocks : (blocks as any)?.content || [];
  visit(docBlocks);
  return result;
}

export function getImageAlignmentFromBlock(block: any): ImageAlignment {
  const value = block?.props?.textAlignment || block?.props?.alignment;
  return value === "center" || value === "right" ? value : "left";
}

export function getImageExtension(blob: Blob): string {
  if (blob.type === "image/png") return "png";
  if (blob.type === "image/jpeg" || blob.type === "image/jpg") return "jpg";
  if (blob.type === "image/gif") return "gif";
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/svg+xml") return "svg";
  return "png";
}
