import {
  MAX_THEME_BACKGROUND_BYTES,
  isThemeImageDataUrl,
} from "../preload/window-theme-preferences";

export type ImageDimensions = Readonly<{ width: number; height: number }>;
export type ImageCrop = Readonly<{ x: number; y: number; width: number; height: number }>;
export type ImageRotation = 0 | 90 | 180 | 270;
export type ImageCropHandle = "nw" | "ne" | "sw" | "se";

const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 64_000_000;
const MAX_OUTPUT_DIMENSION = 4_096;
const MAX_OUTPUT_PIXELS = 16_000_000;
const PREVIEW_MAX_SIDE = 1_400;
const MIN_CROP_EDGE = 0.005;
const JPEG_EXPORT_QUALITIES = [0.92, 0.84, 0.76] as const;

function assertDimensions(size: ImageDimensions): void {
  if (
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width < 1 ||
    size.height < 1 ||
    size.width > MAX_IMAGE_DIMENSION ||
    size.height > MAX_IMAGE_DIMENSION ||
    size.width * size.height > MAX_IMAGE_PIXELS
  ) {
    throw new RangeError("图片尺寸无效或过大，请选择较小的图片");
  }
}

function assertRotation(rotation: number): asserts rotation is ImageRotation {
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new RangeError("图片旋转角度无效");
  }
}

function canvasFor(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: true });
  if (context === null) throw new Error("无法创建图片编辑画布");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

function rejectOversizedPngBeforeDecode(dataUrl: string): void {
  if (!/^data:image\/png;base64,/i.test(dataUrl)) return;
  const headerStart = dataUrl.indexOf(",") + 1;
  try {
    const header = atob(dataUrl.slice(headerStart, headerStart + 32));
    if (
      header.length < 24 ||
      header.slice(0, 8) !== "\x89PNG\r\n\x1a\n" ||
      header.slice(12, 16) !== "IHDR"
    ) return;
    const bytes = Uint8Array.from(header, (character) => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    assertDimensions({ width: view.getUint32(16), height: view.getUint32(20) });
  } catch (error) {
    if (error instanceof RangeError) throw error;
    // Let the image decoder report malformed or unsupported image data.
  }
}

function assertCrop(crop: ImageCrop): void {
  if (
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !Number.isFinite(crop.width) ||
    !Number.isFinite(crop.height) ||
    crop.width <= 0 ||
    crop.height <= 0
  ) {
    throw new RangeError("裁切区域无效");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function loadEditableImage(dataUrl: string): Promise<HTMLImageElement> {
  if (!isThemeImageDataUrl(dataUrl)) {
    throw new TypeError("图片格式无效，仅支持 PNG、JPEG 和 WebP");
  }
  const headerEnd = dataUrl.indexOf(",");
  const payload = dataUrl.slice(headerEnd + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor(payload.length * 3 / 4) - padding;
  if (byteLength > MAX_THEME_BACKGROUND_BYTES) {
    throw new RangeError("图片不能超过 8 MB");
  }
  rejectOversizedPngBeforeDecode(dataUrl);

  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    throw new TypeError("无法解码这张图片，请重新选择");
  }
  assertDimensions({ width: image.naturalWidth, height: image.naturalHeight });
  return image;
}

export function rotatedImageSize(
  size: ImageDimensions,
  rotation: ImageRotation,
): ImageDimensions {
  assertDimensions(size);
  assertRotation(rotation);
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : size;
}

export function fitImageCrop(size: ImageDimensions, aspectRatio?: number): ImageCrop {
  assertDimensions(size);
  if (aspectRatio === undefined) return { x: 0, y: 0, width: 1, height: 1 };
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError("裁切比例必须是大于 0 的数字");
  }

  const imageRatio = size.width / size.height;
  if (imageRatio > aspectRatio) {
    const width = aspectRatio / imageRatio;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = imageRatio / aspectRatio;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function constrainImageCrop(crop: ImageCrop): ImageCrop {
  assertCrop(crop);
  const x = clamp(crop.x, 0, 1);
  const y = clamp(crop.y, 0, 1);
  const width = clamp(crop.width, 0, 1 - x);
  const height = clamp(crop.height, 0, 1 - y);
  if (width <= 0 || height <= 0) throw new RangeError("裁切区域超出图片边界");
  return { x, y, width, height };
}

export function resizeImageCrop(
  crop: ImageCrop,
  handle: ImageCropHandle,
  delta: Readonly<{ x: number; y: number }>,
  size: ImageDimensions,
  aspectRatio?: number,
): ImageCrop {
  assertDimensions(size);
  const current = constrainImageCrop(crop);
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    throw new RangeError("裁切移动距离无效");
  }
  if (aspectRatio !== undefined && (!Number.isFinite(aspectRatio) || aspectRatio <= 0)) {
    throw new RangeError("裁切比例必须是大于 0 的数字");
  }

  const west = handle.includes("w");
  const north = handle.includes("n");
  const fixedX = west ? current.x + current.width : current.x;
  const fixedY = north ? current.y + current.height : current.y;
  const movingX = west ? current.x : current.x + current.width;
  const movingY = north ? current.y : current.y + current.height;
  const signX = west ? -1 : 1;
  const signY = north ? -1 : 1;
  let width = Math.max(MIN_CROP_EDGE, signX * (movingX + delta.x - fixedX));
  let height = Math.max(MIN_CROP_EDGE, signY * (movingY + delta.y - fixedY));

  if (aspectRatio !== undefined) {
    const normalizedRatio = aspectRatio * size.height / size.width;
    if (Math.abs(delta.x) >= Math.abs(delta.y) * normalizedRatio) {
      height = width / normalizedRatio;
    } else {
      width = height * normalizedRatio;
    }
  }

  const maxWidth = signX < 0 ? fixedX : 1 - fixedX;
  const maxHeight = signY < 0 ? fixedY : 1 - fixedY;
  if (aspectRatio === undefined) {
    width = clamp(width, Math.min(MIN_CROP_EDGE, maxWidth), maxWidth);
    height = clamp(height, Math.min(MIN_CROP_EDGE, maxHeight), maxHeight);
  } else {
    const normalizedRatio = aspectRatio * size.height / size.width;
    const boundedWidth = Math.min(maxWidth, maxHeight * normalizedRatio);
    width = clamp(width, Math.min(MIN_CROP_EDGE, boundedWidth), boundedWidth);
    height = width / normalizedRatio;
  }

  const x = west ? fixedX - width : fixedX;
  const y = north ? fixedY - height : fixedY;
  return { x, y, width, height };
}

export function renderImagePreview(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  rotation: ImageRotation,
): void {
  const source = { width: image.naturalWidth, height: image.naturalHeight };
  const rotated = rotatedImageSize(source, rotation);
  const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(rotated.width, rotated.height));
  canvas.width = Math.max(1, Math.round(rotated.width * scale));
  canvas.height = Math.max(1, Math.round(rotated.height * scale));
  const context = contextFor(canvas);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(rotation * Math.PI / 180);
  context.drawImage(
    image,
    -source.width * scale / 2,
    -source.height * scale / 2,
    source.width * scale,
    source.height * scale,
  );
}

export async function exportEditedImage(
  image: HTMLImageElement,
  edit: Readonly<{
    rotation: ImageRotation;
    crop: ImageCrop;
    width: number;
    height: number;
  }>,
): Promise<string> {
  const source = { width: image.naturalWidth, height: image.naturalHeight };
  const rotated = rotatedImageSize(source, edit.rotation);
  const crop = constrainImageCrop(edit.crop);
  if (
    !Number.isInteger(edit.width) ||
    !Number.isInteger(edit.height) ||
    edit.width < 1 ||
    edit.height < 1 ||
    edit.width > MAX_OUTPUT_DIMENSION ||
    edit.height > MAX_OUTPUT_DIMENSION ||
    edit.width * edit.height > MAX_OUTPUT_PIXELS
  ) {
    throw new RangeError("导出尺寸无效或过大，请缩小图片尺寸");
  }
  const cropRatio = rotated.width * crop.width / (rotated.height * crop.height);
  const widthRoundingError = Math.abs(edit.width - edit.height * cropRatio);
  const heightRoundingError = Math.abs(edit.height - edit.width / cropRatio);
  if (widthRoundingError > 0.5 && heightRoundingError > 0.5) {
    throw new RangeError("输出宽高比例必须与裁切区域一致");
  }

  const canvas = canvasFor(edit.width, edit.height);
  const context = contextFor(canvas);
  context.scale(
    edit.width / (rotated.width * crop.width),
    edit.height / (rotated.height * crop.height),
  );
  context.translate(-rotated.width * crop.x, -rotated.height * crop.y);
  context.translate(rotated.width / 2, rotated.height / 2);
  context.rotate(edit.rotation * Math.PI / 180);
  context.drawImage(image, -source.width / 2, -source.height / 2);

  const isJpeg = /^data:image\/jpe?g;/i.test(image.src);
  const qualities: readonly (number | undefined)[] = isJpeg
    ? JPEG_EXPORT_QUALITIES
    : [undefined];
  let lastResult: string | undefined;
  try {
    for (const quality of qualities) {
      lastResult = quality === undefined
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", quality);
      const headerEnd = lastResult.indexOf(",");
      const payload = lastResult.slice(headerEnd + 1);
      const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
      const byteLength = headerEnd < 0
        ? Number.POSITIVE_INFINITY
        : Math.floor(payload.length * 3 / 4) - padding;
      if (byteLength <= MAX_THEME_BACKGROUND_BYTES) return lastResult;
    }
  } catch {
    throw new Error("图片导出失败，请尝试缩小输出尺寸");
  }
  if (lastResult === undefined) throw new Error("图片导出失败，请尝试缩小输出尺寸");
  throw new RangeError("裁切后的图片仍超过 8 MB，请缩小输出尺寸");
}
