export const maxMergeGap = 2000;
export const maxMergeDimension = 30000;
export const maxMergePixels = 80_000_000;
export const maxMergeSourcePixels = 60_000_000;
export const maxMergePreparedBytes = 350 * 1024 * 1024;

export const maxGifFrames = 200;
export const maxGifDimension = 4096;
export const maxGifPixels = 4_000_000;
export const maxGifTotalPixels = 80_000_000;

export const maxPdfFiles = 200;
export const maxPdfBytes = 500 * 1024 * 1024;

export const maxProcessSourcePixels = 60_000_000;
export const maxProcessOutputPixels = 80_000_000;
export const maxProcessDimension = 30000;

export function estimateRgbaBytes(width: number | undefined, height: number | undefined): number {
  if (!width || !height) return 0;
  return width * height * 4;
}

export function assertSafeGifRequest(frameCount: number, width: number, height: number): void {
  if (frameCount > maxGifFrames) {
    throw new Error(`GIF 帧数不能超过 ${maxGifFrames} 张`);
  }

  if (width > maxGifDimension || height > maxGifDimension || width * height > maxGifPixels) {
    throw new Error(`GIF 尺寸过大，请使用不超过 ${maxGifDimension}px 且总像素更小的画布`);
  }

  if (frameCount * width * height > maxGifTotalPixels) {
    throw new Error("GIF 总像素过大，请减少帧数或降低画布尺寸");
  }
}

export function assertSafePdfBatch(fileSizes: number[]): void {
  if (fileSizes.length > maxPdfFiles) {
    throw new Error(`PDF 文件数量不能超过 ${maxPdfFiles} 个`);
  }

  const totalBytes = fileSizes.reduce((sum, size) => sum + size, 0);
  if (totalBytes > maxPdfBytes) {
    throw new Error(`PDF 文件过大，请合并小于 ${Math.round(maxPdfBytes / 1024 / 1024)}MB 的文件`);
  }
}

export function assertSafeProcessSource(width: number | undefined, height: number | undefined): void {
  if (!width || !height) return;
  if (width > maxProcessDimension || height > maxProcessDimension || width * height > maxProcessSourcePixels) {
    throw new Error("图片尺寸过大，请先缩小图片后再处理");
  }
}

export function assertSafeProcessOutput(width: number, height: number): void {
  if (width > maxProcessDimension || height > maxProcessDimension || width * height > maxProcessOutputPixels) {
    throw new Error("输出图片尺寸过大，请降低尺寸或减少边框宽度");
  }
}
