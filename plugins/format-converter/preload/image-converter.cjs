"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { escapeHtml } = require("./text-converter.cjs");
const { runtimeRequire, runtimePath } = require("./runtime-loader.cjs");

function isHeicBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString("latin1") !== "ftyp") return false;
  const brand = buffer.subarray(8, 12).toString("latin1").toLowerCase();
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand);
}

async function prepareImageInput(input) {
  let buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (typeof input === "string") {
    const ext = path.extname(input).toLowerCase();
    if (ext === ".heic" || ext === ".heif") {
      buffer = await fs.readFile(input);
    } else {
      const fd = await fs.open(input, "r");
      try {
        const header = Buffer.alloc(16);
        const { bytesRead } = await fd.read(header, 0, 16, 0);
        if (bytesRead >= 12 && isHeicBuffer(header)) {
          buffer = await fs.readFile(input);
        }
      } finally {
        await fd.close();
      }
    }
  }

  if (buffer && isHeicBuffer(buffer)) {
    let decodeHeic;
    try {
      decodeHeic = runtimeRequire("heic-decode");
    } catch {
      decodeHeic = require("heic-decode");
    }
    const { data, width, height } = await decodeHeic({ buffer });
    return {
      input: Buffer.from(data),
      options: {
        raw: {
          width,
          height,
          channels: 4
        }
      }
    };
  }

  return { input, options: {} };
}

function applyImageTarget(pipeline, target, options = {}) {
  const quality = Math.min(Math.max(options.quality || 86, 20), 100);
  if (target === "png") return pipeline.png({ compressionLevel: 9, palette: false });
  if (target === "jpeg") return pipeline.jpeg({ quality, mozjpeg: true });
  if (target === "webp") return pipeline.webp({ quality });
  if (target === "avif") return pipeline.avif({ quality: Math.min(quality, 90), effort: 5 });
  if (target === "tiff") return pipeline.tiff({ quality, compression: "lzw" });
  if (target === "gif") return pipeline.gif({ effort: 5 });
  throw new Error(`Unsupported image target: ${target}`);
}

async function imagePipeline(input, target, options = {}) {
  const sharp = runtimeRequire("sharp");
  const prepared = await prepareImageInput(input);
  let pipeline = sharp(prepared.input, {
    ...prepared.options,
    animated: !prepared.options.raw,
    limitInputPixels: options.maxImagePixels || 100_000_000
  });
  if (!prepared.options.raw) pipeline = pipeline.rotate();
  pipeline = applyImageTarget(pipeline, target, options);
  return options.preserveMetadata ? pipeline.keepMetadata() : pipeline;
}

async function convertImage(inputPath, outputPath, target, options) {
  const pipeline = await imagePipeline(inputPath, target, options);
  await pipeline.toFile(outputPath);
  return [outputPath];
}

async function imageToPdf(inputPaths, outputPath, options = {}) {
  const sharp = runtimeRequire("sharp");
  const { PDFDocument } = runtimeRequire("pdf-lib");
  const document = await PDFDocument.create();
  for (const input of inputPaths) {
    const prepared = await prepareImageInput(input);
    let pipeline = sharp(prepared.input, {
      ...prepared.options,
      limitInputPixels: options.maxImagePixels || 100_000_000
    });
    if (!prepared.options.raw) pipeline = pipeline.rotate();
    const normalized = await pipeline.png().toBuffer();
    const image = await document.embedPng(normalized);
    const width = image.width;
    const height = image.height;
    const maxWidth = 595.28, maxHeight = 841.89;
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    const page = document.addPage([Math.max(72, width * scale), Math.max(72, height * scale)]);
    page.drawImage(image, { x: 0, y: 0, width: width * scale, height: height * scale });
  }
  await fs.writeFile(outputPath, await document.save());
  return [outputPath];
}

function wrapLines(text, maxChars = 62) {
  const result = [];
  for (const paragraph of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph) { result.push(""); continue; }
    let line = "";
    for (const char of paragraph) {
      const width = /[\u2e80-\uffff]/.test(char) ? 2 : 1;
      const lineWidth = [...line].reduce((sum, item) => sum + (/[\u2e80-\uffff]/.test(item) ? 2 : 1), 0);
      if (lineWidth + width > maxChars && line) { result.push(line); line = char; }
      else line += char;
    }
    result.push(line);
  }
  return result;
}

async function textToImages(text, outputBase, target, options = {}) {
  const lines = wrapLines(text);
  const linesPerPage = 42;
  const pages = [];
  for (let pageIndex = 0; pageIndex < Math.max(1, Math.ceil(lines.length / linesPerPage)); pageIndex += 1) {
    const pageLines = lines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage);
    const body = pageLines.map((line, index) => `<text x="96" y="${132 + index * 34}" font-size="23" fill="#172234">${escapeHtml(line)}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754"><rect width="1240" height="1754" fill="#fff"/><g font-family="Arial, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif">${body}</g><text x="1144" y="1688" text-anchor="end" font-family="Arial,sans-serif" font-size="16" fill="#8490a4">${pageIndex + 1}</text></svg>`;
    const suffix = Math.ceil(lines.length / linesPerPage) > 1 ? `-page-${String(pageIndex + 1).padStart(4, "0")}` : "";
    const output = `${outputBase}${suffix}.${target === "jpeg" ? "jpg" : target}`;
    await (await imagePipeline(Buffer.from(svg), target, options)).toFile(output);
    pages.push(output);
  }
  return pages;
}

async function ocrImages(inputPaths, options = {}, onProgress) {
  const cancelled = () => Object.assign(new Error("转换已取消。"), { code: "JOB_CANCELLED" });
  const abortable = (promise, onAbort) => {
    if (!options.signal) return promise;
    if (options.signal.aborted) { onAbort?.(); return Promise.reject(cancelled()); }
    return new Promise((resolve, reject) => {
      const abort = () => { onAbort?.(); reject(cancelled()); };
      options.signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => options.signal.removeEventListener("abort", abort));
    });
  };
  const language = (options.ocrLanguages?.length ? options.ocrLanguages : ["eng", "chi_sim"]).join("+");
  const workerFactory = options.workerFactory || runtimeRequire("tesseract.js").createWorker;
  const workerPromise = workerFactory(language, undefined, {
    ...(runtimePath("tessdata", "4.0.0") ? { langPath: runtimePath("tessdata", "4.0.0"), gzip: true } : {}),
    logger(message) { if (message.status === "recognizing text" && onProgress) onProgress(message.progress || 0); }
  });
  let worker;
  try {
    worker = await abortable(workerPromise, () => { void workerPromise.then(value => value.terminate()).catch(() => undefined); });
    const outputs = [];
    for (let index = 0; index < inputPaths.length; index += 1) {
      const result = await abortable(worker.recognize(inputPaths[index]), () => { void worker.terminate().catch(() => undefined); });
      outputs.push({ text: result.data.text.trim(), confidence: result.data.confidence, source: path.basename(inputPaths[index]) });
    }
    return outputs;
  } finally { if (worker) await worker.terminate().catch(() => undefined); }
}

module.exports = { imagePipeline, convertImage, imageToPdf, textToImages, ocrImages, wrapLines, isHeicBuffer, prepareImageInput };
