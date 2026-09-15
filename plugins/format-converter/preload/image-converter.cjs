"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { escapeHtml } = require("./text-converter.cjs");
const { runtimeRequire, runtimePath } = require("./runtime-loader.cjs");

function imagePipeline(input, target, options = {}) {
  const sharp = runtimeRequire("sharp");
  let pipeline = sharp(input, { animated: true, limitInputPixels: options.maxImagePixels || 100_000_000 }).rotate();
  const quality = Math.min(Math.max(options.quality || 86, 20), 100);
  if (target === "png") pipeline = pipeline.png({ compressionLevel: 9, palette: false });
  else if (target === "jpeg") pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  else if (target === "webp") pipeline = pipeline.webp({ quality });
  else if (target === "avif") pipeline = pipeline.avif({ quality: Math.min(quality, 90), effort: 5 });
  else if (target === "tiff") pipeline = pipeline.tiff({ quality, compression: "lzw" });
  else if (target === "gif") pipeline = pipeline.gif({ effort: 5 });
  else throw new Error(`Unsupported image target: ${target}`);
  return options.preserveMetadata ? pipeline.keepMetadata() : pipeline;
}

async function convertImage(inputPath, outputPath, target, options) {
  await imagePipeline(inputPath, target, options).toFile(outputPath);
  return [outputPath];
}

async function imageToPdf(inputPaths, outputPath, options = {}) {
  const sharp = runtimeRequire("sharp");
  const { PDFDocument } = runtimeRequire("pdf-lib");
  const document = await PDFDocument.create();
  for (const input of inputPaths) {
    const normalized = await sharp(input, { limitInputPixels: options.maxImagePixels || 100_000_000 }).rotate().png().toBuffer();
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
    await imagePipeline(Buffer.from(svg), target, options).toFile(output);
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

module.exports = { imagePipeline, convertImage, imageToPdf, textToImages, ocrImages, wrapLines };
