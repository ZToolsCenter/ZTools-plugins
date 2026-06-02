import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { PDFDocument } from "pdf-lib";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type {
  GifOptions,
  ImageFormat,
  ImageJobSettings,
  MergeImagesOptions,
  ProcessResult,
  WatermarkPosition
} from "../shared/types";
import { buildOutputPath, normalizeExtension } from "./paths";

const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "avif", "heif", "heic", "tif", "tiff", "gif"]);
const maxMergeGap = 2000;
const maxMergeDimension = 30000;
const maxMergePixels = 80_000_000;
const maxMergeSourcePixels = 60_000_000;
const maxMergePreparedBytes = 350 * 1024 * 1024;

function isSupportedImage(filePath: string): boolean {
  return imageExtensions.has(path.extname(filePath).slice(1).toLowerCase());
}

async function ensureDirectory(directory: string) {
  await fs.mkdir(directory, { recursive: true });
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function safeMergeGap(value: number): number {
  const gap = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (gap > maxMergeGap) {
    throw new Error(`拼图间距不能超过 ${maxMergeGap}px`);
  }
  return gap;
}

function safeMergeColumns(value: number | undefined, itemCount: number): number {
  const fallback = Math.ceil(Math.sqrt(itemCount));
  const columns = Number.isFinite(value) ? Math.max(1, Math.round(value as number)) : fallback;
  return Math.min(columns, itemCount);
}

function assertSafeMergeCanvas(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("拼图画布尺寸无效");
  }

  if (width > maxMergeDimension || height > maxMergeDimension || width * height > maxMergePixels) {
    throw new Error(
      `拼图画布过大：${Math.round(width)}×${Math.round(height)}，请减少图片数量、缩小尺寸或改用宫格布局`
    );
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function gravity(position: WatermarkPosition): sharp.Gravity {
  return position;
}

function formatFromPath(filePath: string): ImageFormat {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === "jpg") return "jpeg";
  if (ext === "tif") return "tiff";
  if (ext === "heic") return "heif";
  if (ext === "jpeg" || ext === "png" || ext === "webp" || ext === "avif" || ext === "heif" || ext === "tiff" || ext === "gif") {
    return ext;
  }
  return "png";
}

function outputFormat(settings: ImageJobSettings, inputPath: string): ImageFormat {
  return settings.format?.type ?? formatFromPath(inputPath);
}

function applyResize(image: Sharp, settings: ImageJobSettings, width?: number, height?: number): Sharp {
  const resize = settings.resize;
  if (!resize) return image;
  if (!resize.width && !resize.height) return image;

  const withoutEnlargement = resize.withoutEnlargement ?? true;
  if (resize.mode === "exact") {
    return image.resize({
      width: resize.width,
      height: resize.height,
      fit: "fill",
      withoutEnlargement
    });
  }

  if (resize.mode === "long-edge" || resize.mode === "short-edge") {
    const target = resize.width ?? resize.height;
    if (!target || !width || !height) return image;
    const isLandscape = width >= height;
    const useWidth =
      resize.mode === "long-edge" ? isLandscape : !isLandscape;
    return image.resize({
      width: useWidth ? target : undefined,
      height: useWidth ? undefined : target,
      fit: "inside",
      withoutEnlargement
    });
  }

  return image.resize({
    width: resize.width,
    height: resize.height,
    fit: resize.mode === "fit" ? "inside" : resize.mode,
    background: resize.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    withoutEnlargement
  });
}

function applyOutputFormat(image: Sharp, format: ImageFormat, settings: ImageJobSettings): Sharp {
  const quality = settings.compression?.quality ?? settings.format?.quality;
  const effort = settings.format?.effort;
  const lossless = settings.format?.lossless;

  switch (format) {
    case "jpeg":
      return image.flatten({ background: settings.resize?.background ?? "#ffffff" }).jpeg({
        quality: quality ?? 82,
        mozjpeg: true
      });
    case "png":
      return image.png({
        compressionLevel: 9,
        palette: Boolean(quality && quality < 100),
        quality: quality ?? 92
      });
    case "webp":
      return image.webp({ quality: quality ?? 82, effort: effort ?? 5, lossless });
    case "avif":
      return image.avif({ quality: quality ?? 58, effort: effort ?? 4, lossless });
    case "heif":
      return image.heif({ quality: quality ?? 72, effort: effort ?? 4, lossless, compression: "av1" });
    case "tiff":
      return image.tiff({ quality: quality ?? 90 });
    case "gif":
      return image.gif({ colours: 256, effort: 7 });
    default:
      return image.png();
  }
}

async function materializeRgba(image: Sharp): Promise<{ image: Sharp; width: number; height: number }> {
  // Sharp metadata reports input dimensions for pending resize/crop pipelines, so use raw output dimensions without PNG encode/decode.
  const { data, info } = await image
    .toColorspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    image: sharp(data, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels as 4
      }
    }),
    width: info.width,
    height: info.height
  };
}

async function applyRounded(image: Sharp, radius: number, background?: string): Promise<Sharp> {
  const base = await materializeRgba(image);
  const { width, height } = base;
  const safeRadius = clampInteger(radius, 0, Math.min(width, height) / 2);
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${safeRadius}" ry="${safeRadius}" fill="#fff"/></svg>`
  );

  let rounded = base.image.composite([{ input: mask, blend: "dest-in" }]);
  if (background) {
    rounded = rounded.flatten({ background });
  }
  return rounded;
}

async function applyWatermark(image: Sharp, settings: ImageJobSettings): Promise<Sharp> {
  const watermark = settings.watermark;
  if (!watermark?.enabled) return image;

  const base = await materializeRgba(image);
  const { width, height } = base;
  const opacity = Math.max(0, Math.min(1, watermark.opacity));
  const margin = Math.max(0, watermark.margin);

  if (watermark.kind === "image" && watermark.imagePath) {
    const maxOverlayWidth = Math.max(24, Math.round(width * 0.35));
    const overlayBase = await sharp(watermark.imagePath)
      .resize({ width: maxOverlayWidth, withoutEnlargement: true })
      .toColorspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const overlayPixels = Buffer.from(overlayBase.data);
    for (let index = 3; index < overlayPixels.length; index += 4) {
      overlayPixels[index] = Math.round(overlayPixels[index] * opacity);
    }
    let overlay = sharp(overlayPixels, {
      raw: {
        width: overlayBase.info.width,
        height: overlayBase.info.height,
        channels: overlayBase.info.channels
      }
    });
    if (watermark.rotation) {
      overlay = overlay.rotate(watermark.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    }
    const overlayOutput = await overlay.toColorspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const placement = overlayPlacement(watermark.position, width, height, overlayOutput.info.width, overlayOutput.info.height, margin);
    return base.image.composite([
      {
        input: overlayOutput.data,
        raw: {
          width: overlayOutput.info.width,
          height: overlayOutput.info.height,
          channels: overlayOutput.info.channels as 4
        },
        left: placement.left,
        top: placement.top
      }
    ]);
  }

  const fontSize = Math.max(8, watermark.fontSize);
  const text = escapeXml(watermark.text || "Watermark");
  const overlay = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <g opacity="${opacity}" transform="rotate(${watermark.rotation} ${width / 2} ${height / 2})">
        <text x="${positionX(watermark.position, width, margin)}" y="${positionY(watermark.position, height, margin)}"
          text-anchor="${textAnchor(watermark.position)}" dominant-baseline="${dominantBaseline(watermark.position)}"
          fill="${watermark.color}" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
          font-size="${fontSize}" font-weight="700">${text}</text>
      </g>
    </svg>
  `);
  return base.image.composite([{ input: overlay, blend: "over" }]);
}

function textAnchor(position: WatermarkPosition): "start" | "middle" | "end" {
  if (position.endsWith("west") || position === "west") return "start";
  if (position.endsWith("east") || position === "east") return "end";
  return "middle";
}

function dominantBaseline(position: WatermarkPosition): "hanging" | "middle" | "auto" {
  if (position.startsWith("north") || position === "north") return "hanging";
  if (position.startsWith("south") || position === "south") return "auto";
  return "middle";
}

function positionX(position: WatermarkPosition, width: number, margin: number): number {
  if (position.endsWith("west") || position === "west") return margin;
  if (position.endsWith("east") || position === "east") return width - margin;
  return width / 2;
}

function positionY(position: WatermarkPosition, height: number, margin: number): number {
  if (position.startsWith("north") || position === "north") return margin;
  if (position.startsWith("south") || position === "south") return height - margin;
  return height / 2;
}

function overlayPlacement(
  position: WatermarkPosition,
  canvasWidth: number,
  canvasHeight: number,
  overlayWidth: number,
  overlayHeight: number,
  margin: number
) {
  const left =
    position.endsWith("west") || position === "west"
      ? margin
      : position.endsWith("east") || position === "east"
        ? canvasWidth - overlayWidth - margin
        : Math.round((canvasWidth - overlayWidth) / 2);
  const top =
    position.startsWith("north") || position === "north"
      ? margin
      : position.startsWith("south") || position === "south"
        ? canvasHeight - overlayHeight - margin
        : Math.round((canvasHeight - overlayHeight) / 2);
  return {
    left: clampInteger(left, 0, Math.max(0, canvasWidth - overlayWidth)),
    top: clampInteger(top, 0, Math.max(0, canvasHeight - overlayHeight))
  };
}

async function processOne(
  inputPath: string,
  index: number,
  settings: ImageJobSettings,
  existingPaths: Set<string>
): Promise<ProcessResult> {
  try {
    if (!isSupportedImage(inputPath)) {
      throw new Error("Unsupported image type");
    }

    await ensureDirectory(settings.output.directory);
    const initialMetadata = await sharp(inputPath).metadata();
    let image = sharp(inputPath, { animated: false }).rotate();

    if (settings.flip === "horizontal" || settings.flip === "both") image = image.flop();
    if (settings.flip === "vertical" || settings.flip === "both") image = image.flip();
    if (settings.rotate) {
      image = image.rotate(settings.rotate, {
        background: settings.resize?.background ?? { r: 0, g: 0, b: 0, alpha: 0 }
      });
    }

    image = applyResize(image, settings, initialMetadata.width, initialMetadata.height);

    if (settings.crop) {
      image = image.extract({
        left: clampInteger(settings.crop.left, 0, 100000),
        top: clampInteger(settings.crop.top, 0, 100000),
        width: Math.max(1, Math.round(settings.crop.width)),
        height: Math.max(1, Math.round(settings.crop.height))
      });
    }

    if (settings.border?.enabled && settings.border.width > 0) {
      if (settings.crop) {
        image = (await materializeRgba(image)).image;
      }
      const borderWidth = Math.round(settings.border.width);
      image = image.extend({
        top: borderWidth,
        right: borderWidth,
        bottom: borderWidth,
        left: borderWidth,
        background: settings.border.color
      });
    }

    if (settings.rounded?.enabled && settings.rounded.radius > 0) {
      image = await applyRounded(image, settings.rounded.radius, settings.rounded.background);
    }

    image = await applyWatermark(image, settings);

    if (settings.format?.keepMetadata || settings.compression?.keepMetadata) {
      image = image.withMetadata();
    }

    const format = outputFormat(settings, inputPath);
    image = applyOutputFormat(image, format, settings);
    const { data: outputBuffer, info: outMetadata } = await image.toBuffer({ resolveWithObject: true });
    const outputPath = buildOutputPath({
      inputPath,
      outputDirectory: settings.output.directory,
      targetFormat: format,
      namingPattern: settings.output.namingPattern,
      index,
      width: outMetadata.width,
      height: outMetadata.height,
      existingPaths
    });

    if (!settings.output.overwrite) {
      await ensureUniqueForFilesystem(outputPath);
    }
    await fs.writeFile(outputPath, outputBuffer);
    const [inputStat, outputStat] = await Promise.all([fs.stat(inputPath), fs.stat(outputPath)]);
    return {
      inputPath,
      outputPath,
      ok: true,
      width: outMetadata.width,
      height: outMetadata.height,
      inputBytes: inputStat.size,
      outputBytes: outputStat.size
    };
  } catch (error) {
    return {
      inputPath,
      outputPath: "",
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function ensureUniqueForFilesystem(filePath: string) {
  try {
    await fs.access(filePath);
  } catch {
    return;
  }
  throw new Error(`Output file already exists: ${filePath}`);
}

export async function processImages(
  inputPaths: string[],
  settings: ImageJobSettings,
  onProgress?: (completed: number, total: number, result: ProcessResult) => void
): Promise<ProcessResult[]> {
  const existingPaths = new Set<string>();
  const results: ProcessResult[] = [];
  for (const [index, inputPath] of inputPaths.entries()) {
    const result = await processOne(inputPath, index + 1, settings, existingPaths);
    results.push(result);
    onProgress?.(results.length, inputPaths.length, result);
  }
  return results;
}

export async function mergePdfs(inputPaths: string[], outputPath: string): Promise<string> {
  if (inputPaths.length === 0) throw new Error("No PDF files selected");
  await ensureDirectory(path.dirname(outputPath));
  const merged = await PDFDocument.create();
  for (const inputPath of inputPaths) {
    const doc = await PDFDocument.load(await fs.readFile(inputPath));
    const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of copiedPages) {
      merged.addPage(page);
    }
  }
  await fs.writeFile(outputPath, await merged.save());
  return outputPath;
}

export async function mergeImages(
  inputPaths: string[],
  outputPath: string,
  options: MergeImagesOptions
): Promise<string> {
  if (inputPaths.length === 0) throw new Error("No images selected");
  await ensureDirectory(path.dirname(outputPath));

  const prepared: Array<{ inputPath: string; buffer: Buffer; width: number; height: number }> = [];
  let preparedBytes = 0;
  for (const inputPath of inputPaths) {
    const image = await sharp(inputPath, {
      animated: false,
      limitInputPixels: maxMergeSourcePixels
    })
      .rotate()
      .png({ compressionLevel: 0 })
      .toBuffer({ resolveWithObject: true });
    preparedBytes += image.data.byteLength;
    if (preparedBytes > maxMergePreparedBytes) {
      throw new Error("拼图输入图片过大，请减少图片数量、先压缩图片或改用更小尺寸");
    }
    prepared.push({
      inputPath,
      buffer: image.data,
      width: image.info.width,
      height: image.info.height
    });
  }

  const gap = safeMergeGap(options.gap);
  let width = 1;
  let height = 1;
  const composites: sharp.OverlayOptions[] = [];

  if (options.layout === "horizontal") {
    width = prepared.reduce((sum, item) => sum + item.width, 0) + gap * (prepared.length - 1);
    height = Math.max(...prepared.map((item) => item.height));
    let left = 0;
    for (const item of prepared) {
      composites.push({ input: item.buffer, left, top: Math.round((height - item.height) / 2) });
      left += item.width + gap;
    }
  } else if (options.layout === "grid") {
    const columns = safeMergeColumns(options.columns, prepared.length);
    const cellWidth = Math.max(...prepared.map((item) => item.width));
    const cellHeight = Math.max(...prepared.map((item) => item.height));
    const rows = Math.ceil(prepared.length / columns);
    width = columns * cellWidth + gap * (columns - 1);
    height = rows * cellHeight + gap * (rows - 1);
    for (const [index, item] of prepared.entries()) {
      const col = index % columns;
      const row = Math.floor(index / columns);
      composites.push({
        input: item.buffer,
        left: col * (cellWidth + gap) + Math.round((cellWidth - item.width) / 2),
        top: row * (cellHeight + gap) + Math.round((cellHeight - item.height) / 2)
      });
    }
  } else {
    width = Math.max(...prepared.map((item) => item.width));
    height = prepared.reduce((sum, item) => sum + item.height, 0) + gap * (prepared.length - 1);
    let top = 0;
    for (const item of prepared) {
      composites.push({ input: item.buffer, left: Math.round((width - item.width) / 2), top });
      top += item.height + gap;
    }
  }

  assertSafeMergeCanvas(width, height);

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: options.background || "#ffffff"
    }
  })
    .composite(composites)
    .png()
    .toFile(outputPath);

  return outputPath;
}

export async function createGif(
  inputPaths: string[],
  outputPath: string,
  options: GifOptions
): Promise<string> {
  if (inputPaths.length === 0) throw new Error("No GIF frames selected");
  await ensureDirectory(path.dirname(outputPath));
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const encoder = GIFEncoder();

  for (const [index, inputPath] of inputPaths.entries()) {
    const rgba = await sharp(inputPath)
      .rotate()
      .resize({
        width,
        height,
        fit: "contain",
        background: options.background ?? { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const pixels = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const palette = quantize(pixels, 256, { format: "rgba4444", oneBitAlpha: 127 });
    const indexed = applyPalette(pixels, palette, "rgba4444");
    const transparentIndex = palette.findIndex((color) => color[3] <= 127);
    const hasTransparency = transparentIndex >= 0;
    encoder.writeFrame(indexed, width, height, {
      palette,
      delay: options.delayMs,
      repeat: index === 0 ? options.loop : -1,
      transparent: hasTransparency,
      transparentIndex,
      dispose: hasTransparency ? 2 : 0
    });
  }

  encoder.finish();
  await fs.writeFile(outputPath, Buffer.from(encoder.bytes()));
  return outputPath;
}

export function supportedOutputFormats(): ImageFormat[] {
  return ["jpeg", "png", "webp", "avif", "heif", "tiff", "gif"];
}

export function extensionForFormat(format: ImageFormat): string {
  return normalizeExtension(format);
}
