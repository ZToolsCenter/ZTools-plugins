"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { runtimeRequire, runtimeResolve } = require("./runtime-loader.cjs");

let nativeCanvas;
function ensureNativeCanvas() {
  if (nativeCanvas || typeof document !== "undefined") return nativeCanvas;
  nativeCanvas = runtimeRequire("@napi-rs/canvas");
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = nativeCanvas.DOMMatrix;
  if (!globalThis.ImageData) globalThis.ImageData = nativeCanvas.ImageData;
  if (!globalThis.Path2D) globalThis.Path2D = nativeCanvas.Path2D;
  return nativeCanvas;
}
function createRuntimeCanvas(width, height) {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  return ensureNativeCanvas().createCanvas(width, height);
}
function pdfRuntime() {
  ensureNativeCanvas();
  const pdfjs = runtimeRequire("pdfjs-dist/legacy/build/pdf.js");
  const packagePath = runtimeResolve("pdfjs-dist/package.json");
  return { pdfjs, standardFontDataUrl: `${path.join(path.dirname(packagePath), "standard_fonts")}${path.sep}` };
}

class CanvasFactory {
  create(width, height) {
    const canvas = createRuntimeCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function openPdf(filePath, options = {}) {
  const { pdfjs, standardFontDataUrl } = pdfRuntime();
  const stat = await fs.stat(filePath);
  if (stat.size > (options.maxPdfBytes || 128 * 1024 ** 2)) throw Object.assign(new Error("PDF 文件超过安全内存上限。"), { code: "PDF_SIZE_LIMIT" });
  const bytes = await fs.readFile(filePath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl,
    disableAutoFetch: false,
    stopAtErrors: false,
    password: options.password
  });
  const document = await loadingTask.promise;
  const limit = options.maxPdfPages || 1000;
  if (document.numPages > limit) {
    await document.destroy();
    const error = new Error(`PDF 页数 ${document.numPages} 超过上限 ${limit}。`);
    error.code = "PDF_PAGE_LIMIT";
    throw error;
  }
  return document;
}

function textRows(items) {
  const rows = [];
  for (const item of items.filter(entry => entry.str && entry.str.trim())) {
    const x = Number(item.transform?.[4] || 0);
    const y = Number(item.transform?.[5] || 0);
    let row = rows.find(candidate => Math.abs(candidate.y - y) <= 3);
    if (!row) { row = { y, cells: [] }; rows.push(row); }
    row.cells.push({ x, text: item.str });
  }
  return rows.sort((a, b) => b.y - a.y).map(row => row.cells.sort((a, b) => a.x - b.x).map(cell => cell.text));
}

async function extractPdf(filePath, options = {}, onProgress) {
  const document = await openPdf(filePath, options);
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (options.signal?.aborted) throw Object.assign(new Error("转换已取消。"), { code: "JOB_CANCELLED" });
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const rows = textRows(content.items);
      pages.push({ pageNumber, rows, text: rows.map(row => row.join("\t")).join("\n") });
      onProgress?.(pageNumber / document.numPages);
      page.cleanup();
    }
  } finally { await document.destroy(); }
  return { pages, text: pages.map(page => page.text).join("\n\n") };
}

async function renderPdfPages(filePath, outputBase, target = "png", options = {}, onProgress) {
  const document = await openPdf(filePath, options);
  const outputs = [];
  const scale = Math.min(Math.max(options.dpi || 144, 72), 300) / 72;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (options.signal?.aborted) throw Object.assign(new Error("转换已取消。"), { code: "JOB_CANCELLED" });
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const factory = new CanvasFactory();
      const pair = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: pair.context, viewport, canvasFactory: factory, background: "white" }).promise;
      const png = typeof pair.canvas.toBuffer === "function"
        ? pair.canvas.toBuffer("image/png")
        : Buffer.from(pair.canvas.toDataURL("image/png").split(",", 2)[1], "base64");
      const suffix = `-page-${String(pageNumber).padStart(4, "0")}`;
      const extension = target === "jpeg" ? "jpg" : target;
      const output = `${outputBase}${suffix}.${extension}`;
      if (target === "png") await fs.writeFile(output, png);
      else {
        const sharp = runtimeRequire("sharp");
        let pipeline = sharp(png);
        if (target === "jpeg") pipeline = pipeline.jpeg({ quality: options.quality || 88, mozjpeg: true });
        else if (target === "webp") pipeline = pipeline.webp({ quality: options.quality || 86 });
        else if (target === "avif") pipeline = pipeline.avif({ quality: options.quality || 75 });
        else if (target === "tiff") pipeline = pipeline.tiff({ compression: "lzw" });
        else throw new Error(`Unsupported PDF image target: ${target}`);
        await pipeline.toFile(output);
      }
      outputs.push(output);
      factory.destroy(pair);
      page.cleanup();
      onProgress?.(pageNumber / document.numPages);
    }
  } finally { await document.destroy(); }
  return outputs;
}

async function mergePdfs(inputPaths, outputPath, options = {}) {
  const { PDFDocument } = runtimeRequire("pdf-lib");
  const destination = await PDFDocument.create();
  for (const input of inputPaths) {
    if (options.signal?.aborted) throw Object.assign(new Error("转换已取消。"), { code: "JOB_CANCELLED" });
    const source = await PDFDocument.load(await fs.readFile(input), { ignoreEncryption: false, throwOnInvalidObject: false });
    const pages = await destination.copyPages(source, source.getPageIndices());
    for (const page of pages) destination.addPage(page);
  }
  await fs.writeFile(outputPath, await destination.save({ useObjectStreams: true }));
  return [outputPath];
}

async function splitPdf(inputPath, outputBase, options = {}) {
  const { PDFDocument } = runtimeRequire("pdf-lib");
  const source = await PDFDocument.load(await fs.readFile(inputPath), { ignoreEncryption: false, throwOnInvalidObject: false });
  if (source.getPageCount() > (options.maxPdfPages || 1000)) throw Object.assign(new Error("PDF 页数超过安全限制。"), { code: "PDF_PAGE_LIMIT" });
  const outputs = [];
  for (let index = 0; index < source.getPageCount(); index += 1) {
    const destination = await PDFDocument.create();
    const [page] = await destination.copyPages(source, [index]);
    destination.addPage(page);
    const output = `${outputBase}-page-${String(index + 1).padStart(4, "0")}.pdf`;
    await fs.writeFile(output, await destination.save());
    outputs.push(output);
  }
  return outputs;
}

module.exports = { CanvasFactory, openPdf, textRows, extractPdf, renderPdfPages, mergePdfs, splitPdf };
