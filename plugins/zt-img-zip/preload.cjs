const IMAGE_ZIP_PRELOAD_VERSION = "0.1.2";

if (typeof window !== "undefined") {
  window.imageZipPreloadLoaded = true;
  window.imageZipPreloadVersion = IMAGE_ZIP_PRELOAD_VERSION;
}

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { ipcRenderer } = require("electron");
let sharpInstance = null;

function getSharp() {
  if (!sharpInstance) {
    sharpInstance = require("sharp");
  }
  return sharpInstance;
}

const supportedFormats = new Set(["jpeg", "jpg", "png", "webp", "avif", "tiff", "tif"]);
const outputFormats = new Set(["jpeg", "png", "webp", "avif", "tiff"]);

function normalizeFormat(format) {
  if (!format || format === "original") {
    return "original";
  }
  const normalized = String(format).toLowerCase();
  if (normalized === "jpg") {
    return "jpeg";
  }
  if (!outputFormats.has(normalized)) {
    throw new Error(`不支持的输出格式: ${format}`);
  }
  return normalized;
}

function normalizeInputFormat(format) {
  if (format === "jpg") {
    return "jpeg";
  }
  if (format === "tif") {
    return "tiff";
  }
  if (!format || !supportedFormats.has(format)) {
    throw new Error(`不支持的图片格式: ${format || "未知"}`);
  }
  return format;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function replaceExtension(filePath, format) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${format}`);
}

function getOutputPath(inputPath, outputDir, format, suffix, explicitOutputPath) {
  if (explicitOutputPath) {
    ensureParentDir(explicitOutputPath);
    return explicitOutputPath;
  }
  const parsed = path.parse(inputPath);
  const targetDir = outputDir || getDefaultOutputDir();
  fs.mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, `${parsed.name}${suffix}.${format}`);
}

function getOutputPathForName(inputName, outputDir, format, suffix, explicitOutputPath) {
  if (explicitOutputPath) {
    ensureParentDir(explicitOutputPath);
    return explicitOutputPath;
  }
  const parsed = path.parse(inputName || "pasted-image");
  const safeName = parsed.name || `pasted-image-${Date.now()}`;
  const targetDir = outputDir || getDefaultOutputDir();
  fs.mkdirSync(targetDir, { recursive: true });
  return path.join(targetDir, `${safeName}${suffix}.${format}`);
}

function applyFormatPipeline(pipeline, format, quality, pngPalette) {
  if (format === "jpeg") {
    return pipeline.jpeg({ quality, mozjpeg: true });
  }
  if (format === "png") {
    return pipeline.png({
      quality,
      compressionLevel: 9,
      palette: pngPalette,
    });
  }
  if (format === "webp") {
    return pipeline.webp({ quality, effort: 5 });
  }
  if (format === "avif") {
    return pipeline.avif({ quality, effort: 5 });
  }
  if (format === "tiff") {
    return pipeline.tiff({ quality, compression: "jpeg" });
  }
  return pipeline;
}

async function compressImage(filePath, options = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("缺少图片路径");
  }

  const metadata = await getSharp()(filePath, { animated: true, failOn: "none" }).metadata();
  const inputFormat = normalizeInputFormat(metadata.format);
  const targetFormat = normalizeFormat(options.format);
  const outputFormat = targetFormat === "original" ? inputFormat : targetFormat;
  const quality = Math.min(100, Math.max(1, Number(options.quality || 78)));
  const maxWidth = Number(options.maxWidth || 0);
  const maxHeight = Number(options.maxHeight || 0);
  const suffix = options.suffix || "-compressed";
  const overwriteOriginal = Boolean(options.overwriteOriginal);
  const outputPath = overwriteOriginal
    ? replaceExtension(filePath, outputFormat)
    : getOutputPath(filePath, options.outputDir, outputFormat, suffix, options.outputPath);
  const tempOutputPath = overwriteOriginal ? `${outputPath}.zt-img-zip-tmp-${Date.now()}` : outputPath;
  const originalSize = fs.statSync(filePath).size;

  let pipeline = getSharp()(filePath, {
    animated: true,
    failOn: "none",
  }).rotate();

  if (maxWidth > 0 || maxHeight > 0) {
    pipeline = pipeline.resize({
      width: maxWidth > 0 ? maxWidth : undefined,
      height: maxHeight > 0 ? maxHeight : undefined,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  try {
    await applyFormatPipeline(pipeline, outputFormat, quality, Boolean(options.pngPalette)).toFile(tempOutputPath);
    if (overwriteOriginal) {
      fs.renameSync(tempOutputPath, outputPath);
      if (path.resolve(outputPath) !== path.resolve(filePath) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (error) {
    if (overwriteOriginal && fs.existsSync(tempOutputPath)) {
      try {
        fs.unlinkSync(tempOutputPath);
      } catch (_) {
        // Ignore cleanup failures and surface the original compression error.
      }
    }
    throw error;
  }
  const outputSize = fs.statSync(outputPath).size;

  return {
    inputPath: filePath,
    outputPath,
    inputFormat,
    outputFormat,
    originalSize,
    outputSize,
    savedBytes: originalSize - outputSize,
    ratio: originalSize > 0 ? 1 - outputSize / originalSize : 0,
    overwroteOriginal: overwriteOriginal,
  };
}

async function compressImageBuffer(inputName, data, options = {}) {
  if (!data) {
    throw new Error("缺少图片数据");
  }

  const inputBuffer = Buffer.from(data);
  const metadata = await getSharp()(inputBuffer, { animated: true, failOn: "none" }).metadata();
  const inputFormat = normalizeInputFormat(metadata.format);

  const targetFormat = normalizeFormat(options.format);
  const outputFormat = targetFormat === "original" ? inputFormat : targetFormat;
  const quality = Math.min(100, Math.max(1, Number(options.quality || 78)));
  const maxWidth = Number(options.maxWidth || 0);
  const maxHeight = Number(options.maxHeight || 0);
  const suffix = options.suffix || "-compressed";
  const outputPath = getOutputPathForName(inputName, options.outputDir, outputFormat, suffix, options.outputPath);

  let pipeline = getSharp()(inputBuffer, {
    animated: true,
    failOn: "none",
  }).rotate();

  if (maxWidth > 0 || maxHeight > 0) {
    pipeline = pipeline.resize({
      width: maxWidth > 0 ? maxWidth : undefined,
      height: maxHeight > 0 ? maxHeight : undefined,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  await applyFormatPipeline(pipeline, outputFormat, quality, Boolean(options.pngPalette)).toFile(outputPath);
  const outputSize = fs.statSync(outputPath).size;

  return {
    inputPath: inputName || "clipboard-image",
    outputPath,
    inputFormat,
    outputFormat,
    originalSize: inputBuffer.length,
    outputSize,
    savedBytes: inputBuffer.length - outputSize,
    ratio: inputBuffer.length > 0 ? 1 - outputSize / inputBuffer.length : 0,
  };
}

async function compressImageBuffers(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("请选择或粘贴至少一张图片");
  }

  const results = [];
  for (const item of items) {
    try {
      results.push({
        ok: true,
        result: await compressImageBuffer(item.name, item.data, options),
      });
    } catch (error) {
      results.push({
        ok: false,
        inputPath: item.name || "clipboard-image",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function compressImages(filePaths, options = {}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("请选择至少一张图片");
  }

  const results = [];
  for (const filePath of filePaths) {
    try {
      results.push({
        ok: true,
        result: await compressImage(filePath, options),
      });
    } catch (error) {
      results.push({
        ok: false,
        inputPath: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

function getFileInfo(filePath) {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
  };
}

function getFileInfos(filePaths) {
  if (!Array.isArray(filePaths)) {
    return [];
  }
  return filePaths.map((filePath) => {
    try {
      return {
        ok: true,
        info: getFileInfo(filePath),
      };
    } catch (error) {
      return {
        ok: false,
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function saveOutputFile(sourcePath, outputPath) {
  if (!sourcePath || !outputPath) {
    throw new Error("缺少保存路径");
  }
  ensureParentDir(outputPath);
  fs.copyFileSync(sourcePath, outputPath);
  return {
    outputPath,
    outputSize: fs.statSync(outputPath).size,
    overwroteOriginal: false,
  };
}

function overwriteOutputFile(sourcePath, inputPath, outputFormat) {
  if (!sourcePath || !inputPath) {
    throw new Error("缺少覆盖路径");
  }
  const targetPath = replaceExtension(inputPath, normalizeFormat(outputFormat));
  ensureParentDir(targetPath);
  const tempTargetPath = `${targetPath}.zt-img-zip-tmp-${Date.now()}`;
  try {
    fs.copyFileSync(sourcePath, tempTargetPath);
    fs.renameSync(tempTargetPath, targetPath);
    if (path.resolve(targetPath) !== path.resolve(inputPath) && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }
  } catch (error) {
    if (fs.existsSync(tempTargetPath)) {
      try {
        fs.unlinkSync(tempTargetPath);
      } catch (_) {
        // Ignore cleanup failures and surface the original overwrite error.
      }
    }
    throw error;
  }
  return {
    outputPath: targetPath,
    outputSize: fs.statSync(targetPath).size,
    overwroteOriginal: true,
  };
}

function getDefaultSaveDir() {
  try {
    const downloadsDir = ipcRenderer?.sendSync?.("get-path", "downloads");
    if (downloadsDir) {
      return downloadsDir;
    }
  } catch (error) {
    console.warn("[zt-img-zip] failed to resolve downloads directory", error);
  }
  return path.join(os.homedir(), "Downloads");
}

function getDefaultOutputDir() {
  return path.join(os.tmpdir(), "zt-img-zip");
}

console.log(`[zt-img-zip] preload loaded ${IMAGE_ZIP_PRELOAD_VERSION}`);

window.imageZip = {
  compressImages,
  compressImageBuffers,
  saveOutputFile,
  overwriteOutputFile,
  getFileInfos,
  getDefaultSaveDir,
  getDefaultOutputDir,
  preloadVersion: IMAGE_ZIP_PRELOAD_VERSION,
  supportedInputFormats: Array.from(supportedFormats),
  supportedOutputFormats: Array.from(outputFormats),
};
