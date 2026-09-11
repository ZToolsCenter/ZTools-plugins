"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { runProcess, fileUrl } = require("./engine-utils.cjs");
const { parseDelimited, jsonToRows } = require("./text-converter.cjs");
const { runtimeRequire } = require("./runtime-loader.cjs");

function runtimePath(runtimes, id) {
  return runtimes.find(item => item.id === id && item.available)?.path;
}

async function officeRun(runtimes, args, options = {}) {
  const binary = runtimePath(runtimes, "officecli");
  if (!binary) throw Object.assign(new Error("OfficeCLI 不可用，请先一键安装。"), { code: "OFFICECLI_NOT_FOUND" });
  return runProcess(binary, args, { timeoutMs: options.timeoutMs || 180000, signal: options.signal, maxOutputBytes: options.maxOutputBytes || 8 * 1024 ** 2, env: { ...process.env, OFFICECLI_NO_AUTO_RESIDENT: "1", OFFICECLI_SKIP_UPDATE: "1" } });
}

async function extractOfficeText(filePath, runtimes, options = {}) {
  const result = await officeRun(runtimes, ["view", filePath, "text", "--max-lines", "100000"], options);
  return result.stdout.trim();
}

async function extractOfficeHtml(filePath, outputPath, runtimes, options = {}) {
  await officeRun(runtimes, ["view", filePath, "html", "-o", outputPath], options);
  return outputPath;
}

async function officeToPdf(filePath, outputPath, runtimes, tempDir, options = {}) {
  try {
    await officeRun(runtimes, ["view", filePath, "pdf", "-o", outputPath], { ...options, timeoutMs: 240000 });
    if ((await fs.stat(outputPath).catch(() => null))?.size) return [outputPath];
  } catch { await fs.rm(outputPath, { force: true }); }

  const libreoffice = runtimePath(runtimes, "libreoffice");
  if (libreoffice) {
    const profileDir = path.join(tempDir, `lo-profile-${Date.now()}`);
    await fs.mkdir(profileDir, { recursive: true });
    try {
      await runProcess(libreoffice, [
        `-env:UserInstallation=${fileUrl(profileDir)}`,
        "--headless", "--nologo", "--nodefault", "--norestore", "--nolockcheck",
        "--convert-to", "pdf", "--outdir", tempDir, filePath
      ], { timeoutMs: 300000, signal: options.signal });
      const produced = path.join(tempDir, `${path.basename(filePath, path.extname(filePath))}.pdf`);
      if ((await fs.stat(produced).catch(() => null))?.size) { await fs.rename(produced, outputPath); return [outputPath]; }
    } catch { await fs.rm(outputPath, { force: true }); }
  }

  const browser = runtimePath(runtimes, "browser");
  if (!browser) throw Object.assign(new Error("Office → PDF 需要 OfficeCLI exporter、LibreOffice 或 Chrome/Edge/Chromium。"), { code: "RENDER_RUNTIME_MISSING" });
  const html = path.join(tempDir, `office-${Date.now()}.html`);
  await extractOfficeHtml(filePath, html, runtimes, options);
  await runProcess(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--allow-file-access-from-files", `--print-to-pdf=${outputPath}`, fileUrl(html)
  ], { timeoutMs: 240000, signal: options.signal });
  return [outputPath];
}

async function officeToImages(filePath, outputBase, target, runtimes, tempDir, options = {}) {
  if (!runtimePath(runtimes, "browser")) throw Object.assign(new Error("Office 分页图片需要 Chrome、Edge 或 Chromium。"), { code: "BROWSER_NOT_FOUND" });
  const pngBase = path.join(tempDir, `${path.basename(outputBase)}.png`);
  const result = await officeRun(runtimes, ["view", filePath, "screenshot", "-o", pngBase, "--screenshot-width", String(Math.round((options.dpi || 144) * 8.27)), "--screenshot-height", String(Math.round((options.dpi || 144) * 11.69))], { ...options, timeoutMs: 300000 });
  const reported = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map(line => line.trim()).filter(line => line && path.isAbsolute(line));
  const directoryEntries = await fs.readdir(tempDir);
  const stem = path.basename(pngBase, ".png");
  const discovered = directoryEntries.filter(name => name === `${stem}.png` || (name.startsWith(`${stem}-`) && name.endsWith(".png"))).map(name => path.join(tempDir, name));
  const pngs = [...new Set([...reported, ...discovered])].filter(candidate => candidate.endsWith(".png"));
  if (!pngs.length) throw Object.assign(new Error("OfficeCLI 未生成截图文件。"), { code: "SCREENSHOT_OUTPUT_MISSING" });
  const outputs = [];
  for (let index = 0; index < pngs.length; index += 1) {
    const suffix = pngs.length > 1 ? `-page-${String(index + 1).padStart(4, "0")}` : "";
    const extension = target === "jpeg" ? "jpg" : target;
    const output = `${outputBase}${suffix}.${extension}`;
    if (target === "png") await fs.copyFile(pngs[index], output);
    else {
      const sharp = runtimeRequire("sharp");
      let pipeline = sharp(pngs[index]);
      if (target === "jpeg") pipeline = pipeline.jpeg({ quality: options.quality || 88, mozjpeg: true });
      else if (target === "webp") pipeline = pipeline.webp({ quality: options.quality || 86 });
      else if (target === "avif") pipeline = pipeline.avif({ quality: options.quality || 75 });
      else if (target === "tiff") pipeline = pipeline.tiff({ compression: "lzw" });
      await pipeline.toFile(output);
    }
    outputs.push(output);
  }
  return outputs;
}

async function writeBatch(filePath, commands, tempDir, runtimes, options = {}) {
  const commandFile = path.join(tempDir, `office-batch-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(commandFile, JSON.stringify(commands), { encoding: "utf8", mode: 0o600 });
  try { await officeRun(runtimes, ["batch", filePath, "--input", commandFile, "--json"], { ...options, timeoutMs: 300000 }); }
  finally { await fs.rm(commandFile, { force: true }); }
}

function textSlides(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const slides = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading || !current) {
      if (current) slides.push(current);
      current = { title: heading ? heading[1] : line, body: [] };
    } else current.body.push(line.replace(/^[-*+]\s+/, ""));
    if (current.body.length >= 7) { slides.push(current); current = null; }
  }
  if (current) slides.push(current);
  return slides.slice(0, 200);
}

async function generateOfficeFromText(text, target, outputPath, runtimes, tempDir, options = {}) {
  if (target === "xlsx") {
    const ExcelJS = runtimeRequire("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("转换结果");
    const rows = options.rows || text.split(/\r?\n/).map(line => [line]);
    rows.slice(0, 100000).forEach(row => sheet.addRow(row));
    if (rows.length && rows[0].length) { sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: "frozen", ySplit: 1 }]; }
    sheet.columns.forEach(column => { column.width = Math.min(60, Math.max(10, ...(column.values || []).map(value => String(value ?? "").length + 2))); });
    await workbook.xlsx.writeFile(outputPath);
    return [outputPath];
  }
  await officeRun(runtimes, ["create", outputPath], options);
  if (target === "docx") {
    const paragraphs = String(text).replace(/\r\n?/g, "\n").split("\n").slice(0, 10000);
    const commands = paragraphs.map(line => {
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      return { op: "add", parent: "/body", type: "paragraph", props: { text: heading ? heading[2] : line, ...(heading ? { style: `Heading${heading[1].length}` } : {}) } };
    });
    await writeBatch(outputPath, commands, tempDir, runtimes, options);
  } else if (target === "pptx") {
    const slides = textSlides(text);
    const commands = [];
    slides.forEach((slide, index) => {
      commands.push({ op: "add", parent: "/", type: "slide", props: { title: slide.title, background: "F7F9FC" } });
      if (slide.body.length) commands.push({ op: "add", parent: `/slide[${index + 1}]`, type: "shape", props: { text: slide.body.map(item => `• ${item}`).join("\n"), x: "1.1in", y: "1.65in", width: "11.1in", height: "4.8in", size: "22", color: "253550" } });
    });
    await writeBatch(outputPath, commands, tempDir, runtimes, options);
  }
  await officeRun(runtimes, ["validate", outputPath, "--json"], { ...options, timeoutMs: 120000 });
  return [outputPath];
}

async function imagesToOffice(imagePaths, target, outputPath, runtimes, tempDir, options = {}) {
  if (target === "xlsx") {
    const ExcelJS = runtimeRequire("exceljs");
    const sharp = runtimeRequire("sharp");
    const workbook = new ExcelJS.Workbook();
    for (let index = 0; index < imagePaths.length; index += 1) {
      const sheet = workbook.addWorksheet(`Page ${index + 1}`);
      const png = await sharp(imagePaths[index]).png().toBuffer();
      const imageId = workbook.addImage({ buffer: png, extension: "png" });
      const metadata = await sharp(png).metadata();
      const scale = Math.min(1, 900 / (metadata.width || 900));
      sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: (metadata.width || 900) * scale, height: (metadata.height || 1200) * scale } });
    }
    await workbook.xlsx.writeFile(outputPath);
    return [outputPath];
  }
  await officeRun(runtimes, ["create", outputPath], options);
  const commands = [];
  if (target === "docx") {
    imagePaths.slice(0, 1000).forEach((image, index) => {
      commands.push({ op: "add", parent: "/body", type: "paragraph", props: { text: "" } });
      commands.push({ op: "add", parent: `/body/p[${index + 1}]`, type: "picture", props: { src: image, width: "6.4in", alt: `Converted page ${index + 1}` } });
    });
  } else if (target === "pptx") {
    imagePaths.slice(0, 1000).forEach((image, index) => {
      commands.push({ op: "add", parent: "/", type: "slide", props: { background: "FFFFFF" } });
      commands.push({ op: "add", parent: `/slide[${index + 1}]`, type: "picture", props: { src: image, x: "0in", y: "0in", width: "13.333in", height: "7.5in", alt: `Converted page ${index + 1}` } });
    });
  }
  await writeBatch(outputPath, commands, tempDir, runtimes, options);
  await officeRun(runtimes, ["validate", outputPath, "--json"], { ...options, timeoutMs: 120000 });
  return [outputPath];
}

async function rowsFromTextSource(text, sourceFormat) {
  if (sourceFormat === "csv") return parseDelimited(text, ",");
  if (sourceFormat === "tsv") return parseDelimited(text, "\t");
  if (sourceFormat === "json") return jsonToRows(JSON.parse(text));
  return text.split(/\r?\n/).map(line => [line]);
}

module.exports = { officeRun, extractOfficeText, extractOfficeHtml, officeToPdf, officeToImages, generateOfficeFromText, imagesToOffice, rowsFromTextSource, textSlides };
