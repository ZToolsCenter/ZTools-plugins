"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { buildRoute, formatById, TARGET_IDS } = require("./format-registry.cjs");
const { safeStem, stagedPath, publishStaged } = require("./engine-utils.cjs");
const { readSource, convertStructured, rowsToJson, serializeDelimited } = require("./text-converter.cjs");
const { convertImage, imageToPdf, textToImages, ocrImages } = require("./image-converter.cjs");
const { extractPdf, renderPdfPages } = require("./pdf-converter.cjs");
const { extractOfficeText, extractOfficeHtml, officeToPdf, officeToImages, generateOfficeFromText, imagesToOffice } = require("./office-converter.cjs");

function conversionError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function validateRequest(request) {
  if (!request || typeof request !== "object") throw conversionError("INVALID_REQUEST", "转换请求不能为空。");
  if (!TARGET_IDS.has(request.target)) throw conversionError("INVALID_TARGET", `不支持目标格式：${request.target}`);
  if (!["visual", "editable", "extract"].includes(request.profile)) throw conversionError("INVALID_PROFILE", "转换质量模式无效。");
  if (!["skip", "rename", "overwrite"].includes(request.collision)) throw conversionError("INVALID_COLLISION_POLICY", "同名文件处理策略无效。");
  const options = request.options || {};
  if (options.dpi != null && (!Number.isInteger(options.dpi) || options.dpi < 72 || options.dpi > 300)) throw conversionError("INVALID_DPI", "DPI 必须在 72—300 之间。");
  if (options.quality != null && (!Number.isInteger(options.quality) || options.quality < 20 || options.quality > 100)) throw conversionError("INVALID_QUALITY", "图片质量必须在 20—100 之间。");
  if (options.ocrLanguages && (!Array.isArray(options.ocrLanguages) || options.ocrLanguages.length > 2 || options.ocrLanguages.some(item => !["eng", "chi_sim"].includes(item)))) throw conversionError("INVALID_OCR_LANGUAGE", "OCR 当前仅支持 eng 和 chi_sim。");
}

function extensionFor(target) { return target === "jpeg" ? "jpg" : target; }

function proposedOutputs(input, route) {
  const stem = safeStem(input.name);
  const extension = extensionFor(route.target);
  return [route.multiOutput ? `${stem}-page-*.${extension}` : `${stem}.${extension}`];
}

function createConversionEngine(options) {
  const pathPolicy = options.pathPolicy;
  let runtimes = options.runtimes || [];

  function setRuntimes(next) { runtimes = next; }

  function plan(request) {
    validateRequest(request);
    const inputGrant = pathPolicy.requireInputGrant(request.inputGrantId);
    pathPolicy.requireOutputGrant(request.outputGrantId);
    const items = inputGrant.files.map(input => {
      const route = buildRoute(input.format, request.target, request.profile, runtimes);
      if (!route) throw conversionError("ROUTE_NOT_SUPPORTED", `暂不支持 ${input.format} → ${request.target}。`, { input: input.path });
      return { input, route, proposedOutputs: proposedOutputs(input, route) };
    });
    const warnings = [...new Set(items.flatMap(item => item.route.warnings))];
    const unavailable = items.filter(item => !item.route.available);
    if (unavailable.length) warnings.unshift(`有 ${unavailable.length} 个文件缺少所需转换引擎。`);
    return { request, items, executable: unavailable.length === 0, warnings, estimatedOutputCount: items.reduce((count, item) => count + (item.route.multiOutput ? 2 : 1), 0) };
  }

  async function writeTextResult(tempDir, stem, target, content) {
    const output = path.join(tempDir, `${stem}.${extensionFor(target)}`);
    await fs.writeFile(output, content, "utf8");
    return [output];
  }

  async function convertTextOrData(input, request, tempDir, onProgress, signal) {
    const source = await readSource(input.path, input.format);
    onProgress(20);
    const targetDef = formatById(request.target);
    const stem = safeStem(input.name);
    if (["text", "data"].includes(targetDef.family)) {
      const content = convertStructured(source, input.format, request.target);
      onProgress(80);
      return writeTextResult(tempDir, stem, request.target, content);
    }
    if (targetDef.family === "image") return textToImages(source.text, path.join(tempDir, stem), request.target, request.options);
    if (request.target === "pdf") {
      const pages = await textToImages(source.text, path.join(tempDir, `${stem}-render`), "png", request.options);
      const output = path.join(tempDir, `${stem}.pdf`);
      await imageToPdf(pages, output, request.options);
      return [output];
    }
    if (targetDef.family === "office") {
      const output = path.join(tempDir, `${stem}.${request.target}`);
      return generateOfficeFromText(source.text, request.target, output, runtimes, tempDir, { ...request.options, rows: source.rows, signal });
    }
    throw conversionError("ROUTE_NOT_IMPLEMENTED", `尚未实现 ${input.format} → ${request.target}。`);
  }

  async function convertImageInput(input, request, tempDir, onProgress, signal) {
    const targetDef = formatById(request.target);
    const stem = safeStem(input.name);
    if (targetDef.family === "image") {
      const output = path.join(tempDir, `${stem}.${extensionFor(request.target)}`);
      await convertImage(input.path, output, request.target, { ...request.options, maxImagePixels: pathPolicy.limits.maxImagePixels });
      return [output];
    }
    if (request.target === "pdf") {
      const output = path.join(tempDir, `${stem}.pdf`);
      return imageToPdf([input.path], output, { ...request.options, maxImagePixels: pathPolicy.limits.maxImagePixels });
    }
    if (["text", "data"].includes(targetDef.family)) {
      const results = await ocrImages([input.path], request.options, progress => onProgress(Math.round(progress * 75)));
      const result = results[0];
      const source = { text: result.text, rows: result.text.split(/\r?\n/).filter(Boolean).map(line => [line]), json: [{ source: result.source, confidence: result.confidence, text: result.text }], html: null };
      return writeTextResult(tempDir, stem, request.target, convertStructured(source, "txt", request.target));
    }
    if (targetDef.family === "office") {
      const output = path.join(tempDir, `${stem}.${request.target}`);
      if (request.profile === "editable") {
        const [result] = await ocrImages([input.path], request.options, progress => onProgress(Math.round(progress * 70)));
        return generateOfficeFromText(result.text, request.target, output, runtimes, tempDir, { ...request.options, rows: result.text.split(/\r?\n/).filter(Boolean).map(line => [line]), signal });
      }
      return imagesToOffice([input.path], request.target, output, runtimes, tempDir, { ...request.options, signal });
    }
    throw conversionError("ROUTE_NOT_IMPLEMENTED", `尚未实现 ${input.format} → ${request.target}。`);
  }

  async function convertPdfInput(input, request, tempDir, onProgress, signal) {
    const targetDef = formatById(request.target);
    const stem = safeStem(input.name);
    const pdfOptions = { ...request.options, signal, maxPdfPages: pathPolicy.limits.maxPdfPages, maxPdfBytes: pathPolicy.limits.maxPdfBytes };
    if (targetDef.family === "image") return renderPdfPages(input.path, path.join(tempDir, stem), request.target, pdfOptions, progress => onProgress(Math.round(progress * 90)));
    if (["text", "data"].includes(targetDef.family)) {
      let extracted = await extractPdf(input.path, pdfOptions, progress => onProgress(Math.round(progress * 80)));
      if (!extracted.text.trim() && request.profile !== "extract") {
        const pages = await renderPdfPages(input.path, path.join(tempDir, `${stem}-ocr`), "png", pdfOptions, progress => onProgress(Math.round(progress * 45)));
        const ocr = await ocrImages(pages, request.options, progress => onProgress(45 + Math.round(progress * 45)));
        extracted = { pages: ocr.map((item, index) => ({ pageNumber: index + 1, rows: item.text.split(/\r?\n/).map(line => [line]), text: item.text })), text: ocr.map(item => item.text).join("\n\n") };
      }
      const rows = extracted.pages.flatMap(page => [[`Page ${page.pageNumber}`], ...page.rows, []]);
      let content;
      if (request.target === "json") content = JSON.stringify({ pages: extracted.pages }, null, 2);
      else if (request.target === "csv" || request.target === "tsv") content = serializeDelimited(rows, request.target === "csv" ? "," : "\t");
      else if (request.target === "html") content = `<pre>${extracted.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>`;
      else content = extracted.text;
      return writeTextResult(tempDir, stem, request.target, content);
    }
    if (targetDef.family === "office") {
      const output = path.join(tempDir, `${stem}.${request.target}`);
      if (request.profile === "visual") {
        const pages = await renderPdfPages(input.path, path.join(tempDir, `${stem}-page`), "png", pdfOptions, progress => onProgress(Math.round(progress * 65)));
        return imagesToOffice(pages, request.target, output, runtimes, tempDir, { ...request.options, signal });
      }
      const extracted = await extractPdf(input.path, pdfOptions, progress => onProgress(Math.round(progress * 65)));
      const rows = extracted.pages.flatMap(page => page.rows);
      return generateOfficeFromText(extracted.text, request.target, output, runtimes, tempDir, { ...request.options, rows, signal });
    }
    throw conversionError("ROUTE_NOT_IMPLEMENTED", `尚未实现 PDF → ${request.target}。`);
  }

  async function convertOfficeInput(input, request, tempDir, onProgress, signal) {
    const targetDef = formatById(request.target);
    const stem = safeStem(input.name);
    if (request.target === "html") {
      const output = path.join(tempDir, `${stem}.html`);
      await extractOfficeHtml(input.path, output, runtimes, { signal });
      return [output];
    }
    if (["text", "data"].includes(targetDef.family)) {
      const text = await extractOfficeText(input.path, runtimes, { signal });
      const source = { text, html: null, rows: text.split(/\r?\n/).map(line => line.split("\t")), json: null };
      return writeTextResult(tempDir, stem, request.target, convertStructured(source, "txt", request.target));
    }
    if (request.target === "pdf") {
      const output = path.join(tempDir, `${stem}.pdf`);
      return officeToPdf(input.path, output, runtimes, tempDir, { ...request.options, signal });
    }
    if (targetDef.family === "image") return officeToImages(input.path, path.join(tempDir, stem), request.target, runtimes, tempDir, { ...request.options, signal });
    if (targetDef.family === "office") {
      const text = await extractOfficeText(input.path, runtimes, { signal });
      const output = path.join(tempDir, `${stem}.${request.target}`);
      return generateOfficeFromText(text, request.target, output, runtimes, tempDir, { ...request.options, signal });
    }
    throw conversionError("ROUTE_NOT_IMPLEMENTED", `尚未实现 ${input.format} → ${request.target}。`);
  }

  async function convertItem(item, request, outputDirectory, context = {}) {
    await pathPolicy.assertInputFile(item.input);
    await pathPolicy.assertOutputDirectory(outputDirectory);
    const route = item.route || buildRoute(item.input.format, request.target, request.profile, runtimes);
    if (!route?.available) throw conversionError("ENGINE_UNAVAILABLE", "所需转换引擎不可用。", { engines: route?.engines });
    const tempDir = path.join(outputDirectory, `.format-converter-${context.jobId || crypto.randomUUID()}-${context.itemId || crypto.randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
    try {
      let stagedOutputs;
      const sourceDef = formatById(item.input.format);
      if (item.input.format === request.target) {
        const output = path.join(tempDir, `${safeStem(item.input.name)}.${extensionFor(request.target)}`);
        await fs.copyFile(item.input.path, output);
        stagedOutputs = [output];
      } else if (["text", "data"].includes(sourceDef.family)) stagedOutputs = await convertTextOrData(item.input, request, tempDir, context.onProgress || (() => {}), context.signal);
      else if (sourceDef.family === "image") stagedOutputs = await convertImageInput(item.input, request, tempDir, context.onProgress || (() => {}), context.signal);
      else if (sourceDef.family === "pdf") stagedOutputs = await convertPdfInput(item.input, request, tempDir, context.onProgress || (() => {}), context.signal);
      else if (sourceDef.family === "office") stagedOutputs = await convertOfficeInput(item.input, request, tempDir, context.onProgress || (() => {}), context.signal);
      else throw conversionError("ROUTE_NOT_IMPLEMENTED", "尚未实现该转换路线。");

      const published = [];
      let skipped = 0;
      for (const staged of stagedOutputs) {
        await pathPolicy.assertOutputDirectory(outputDirectory);
        const desired = path.join(outputDirectory, path.basename(staged));
        const finalPath = await publishStaged(staged, desired, request.target, request.collision);
        if (finalPath) published.push(finalPath); else skipped += 1;
      }
      return { outputs: published, skipped, warnings: route.warnings };
    } finally { await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined); }
  }

  return { setRuntimes, plan, convertItem, validateRequest };
}

module.exports = { conversionError, validateRequest, extensionFor, proposedOutputs, createConversionEngine };
