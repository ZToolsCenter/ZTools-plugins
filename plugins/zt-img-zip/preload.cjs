const IMAGE_ZIP_PRELOAD_VERSION = "0.1.3";

if (typeof window !== "undefined") {
  window.imageZipPreloadLoaded = true;
  window.imageZipPreloadVersion = IMAGE_ZIP_PRELOAD_VERSION;
}

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { ipcRenderer } = require("electron");

const supportedFormats = new Set(["jpeg", "jpg", "png", "webp", "avif"]);
const outputFormats = new Set(["jpeg", "png", "webp"]);
const mimeByFormat = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

function normalizeFormat(format) {
  if (!format || format === "original") {
    return "original";
  }
  const normalized = normalizeInputFormat(format);
  if (!outputFormats.has(normalized)) {
    throw new Error(`当前版本不支持输出 ${format}，请改用 JPEG、PNG 或 WebP`);
  }
  return normalized;
}

function normalizeInputFormat(format) {
  if (!format) {
    throw new Error("不支持的图片格式: 未知");
  }
  const normalized = String(format).toLowerCase();
  if (normalized === "jpg") {
    return "jpeg";
  }
  if (!supportedFormats.has(normalized)) {
    throw new Error(`不支持的图片格式: ${format}`);
  }
  return normalized;
}

function detectInputFormat(buffer, fileName) {
  if (buffer.length >= 12) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      return "jpeg";
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return "png";
    }
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
      return "webp";
    }
    if (buffer.toString("ascii", 4, 8) === "ftyp") {
      const brand = buffer.toString("ascii", 8, 16);
      if (/avif|avis|mif1|heic/.test(brand)) {
        return "avif";
      }
    }
  }

  const extension = path.extname(fileName || "").slice(1).toLowerCase();
  if (extension === "tif" || extension === "tiff") {
    throw new Error("当前版本不支持 TIFF，请先转换为 JPEG、PNG 或 WebP");
  }
  return normalizeInputFormat(extension);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function replaceExtension(filePath, format) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.${format}`);
}

function getDefaultOutputDir() {
  return path.join(os.tmpdir(), "zt-img-zip");
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

function resolveOutputFormat(targetFormat, inputFormat) {
  const outputFormat = targetFormat === "original" ? inputFormat : targetFormat;
  if (!outputFormats.has(outputFormat)) {
    throw new Error(`当前运行环境不支持输出 ${outputFormat}，请改用 JPEG、PNG 或 WebP`);
  }
  return outputFormat;
}

function getCanvasSize(width, height, maxWidth, maxHeight) {
  const widthLimit = Number(maxWidth || 0);
  const heightLimit = Number(maxHeight || 0);
  if (widthLimit <= 0 && heightLimit <= 0) {
    return { width, height };
  }

  const widthScale = widthLimit > 0 ? widthLimit / width : 1;
  const heightScale = heightLimit > 0 ? heightLimit / height : 1;
  const scale = Math.min(1, widthScale, heightScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function createCanvas(width, height) {
  if (typeof document === "undefined") {
    throw new Error("当前 ZTools 运行环境缺少 Canvas，无法处理图片");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function decodeImage(buffer, format) {
  const mimeType = mimeByFormat[format] || "application/octet-stream";
  const blob = new Blob([buffer], { type: mimeType });

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("当前 ZTools 运行环境缺少图片解码能力");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片解码失败"));
      element.src = objectUrl;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {},
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function canvasToBuffer(canvas, format, quality) {
  const mimeType = mimeByFormat[format];
  if (!mimeType) {
    throw new Error(`不支持的输出格式: ${format}`);
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error(`当前运行环境不支持输出 ${format}`));
        }
      },
      mimeType,
      format === "png" ? undefined : quality / 100,
    );
  });

  return Buffer.from(await blob.arrayBuffer());
}

async function renderImage(buffer, inputFormat, outputFormat, options) {
  const decoded = await decodeImage(buffer, inputFormat);
  try {
    const size = getCanvasSize(decoded.width, decoded.height, options.maxWidth, options.maxHeight);
    const canvas = createCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 初始化失败");
    }
    if (outputFormat === "jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
    }
    context.drawImage(decoded.image, 0, 0, size.width, size.height);
    return canvasToBuffer(canvas, outputFormat, options.quality);
  } finally {
    decoded.close();
  }
}

async function writeConvertedImage(inputName, buffer, options = {}) {
  const inputFormat = detectInputFormat(buffer, inputName);
  const targetFormat = normalizeFormat(options.format);
  const outputFormat = resolveOutputFormat(targetFormat, inputFormat);
  const quality = Math.min(100, Math.max(1, Number(options.quality || 78)));
  const outputBuffer = await renderImage(buffer, inputFormat, outputFormat, {
    quality,
    maxWidth: Number(options.maxWidth || 0),
    maxHeight: Number(options.maxHeight || 0),
  });

  return { inputFormat, outputFormat, outputBuffer };
}

async function compressImage(filePath, options = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("缺少图片路径");
  }

  const inputBuffer = fs.readFileSync(filePath);
  const { inputFormat, outputFormat, outputBuffer } = await writeConvertedImage(filePath, inputBuffer, options);
  const suffix = options.suffix || "-compressed";
  const overwriteOriginal = Boolean(options.overwriteOriginal);
  const outputPath = overwriteOriginal
    ? replaceExtension(filePath, outputFormat)
    : getOutputPath(filePath, options.outputDir, outputFormat, suffix, options.outputPath);
  const tempOutputPath = overwriteOriginal ? `${outputPath}.zt-img-zip-tmp-${Date.now()}` : outputPath;
  const originalSize = fs.statSync(filePath).size;

  try {
    ensureParentDir(tempOutputPath);
    fs.writeFileSync(tempOutputPath, outputBuffer);
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
  const { inputFormat, outputFormat, outputBuffer } = await writeConvertedImage(inputName, inputBuffer, options);
  const suffix = options.suffix || "-compressed";
  const outputPath = getOutputPathForName(inputName, options.outputDir, outputFormat, suffix, options.outputPath);
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, outputBuffer);
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
