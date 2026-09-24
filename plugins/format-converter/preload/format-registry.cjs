"use strict";

const path = require("node:path");

const FORMAT_DEFINITIONS = Object.freeze([
  { id: "docx", label: "Word", family: "office", extensions: ["docx"], color: "#2f6bff" },
  { id: "xlsx", label: "Excel", family: "office", extensions: ["xlsx"], color: "#159665" },
  { id: "pptx", label: "PowerPoint", family: "office", extensions: ["pptx"], color: "#df6f38" },
  { id: "pdf", label: "PDF", family: "pdf", extensions: ["pdf"], color: "#dd4050" },
  { id: "png", label: "PNG", family: "image", extensions: ["png"], color: "#7758d8" },
  { id: "jpeg", label: "JPEG", family: "image", extensions: ["jpg", "jpeg"], color: "#8b5d35" },
  { id: "webp", label: "WebP", family: "image", extensions: ["webp"], color: "#6d48b8" },
  { id: "avif", label: "AVIF", family: "image", extensions: ["avif"], color: "#3750a5" },
  { id: "tiff", label: "TIFF", family: "image", extensions: ["tif", "tiff"], color: "#4d6674" },
  { id: "gif", label: "GIF", family: "image", extensions: ["gif"], color: "#8d4b9d" },
  { id: "bmp", label: "BMP", family: "image", extensions: ["bmp"], color: "#596a7d" },
  { id: "txt", label: "纯文本", family: "text", extensions: ["txt"], color: "#53606e" },
  { id: "md", label: "Markdown", family: "text", extensions: ["md"], color: "#202b36" },
  { id: "html", label: "HTML", family: "text", extensions: ["html", "htm"], color: "#e35c30" },
  { id: "csv", label: "CSV", family: "data", extensions: ["csv"], color: "#168a60" },
  { id: "tsv", label: "TSV", family: "data", extensions: ["tsv"], color: "#32846c" },
  { id: "json", label: "JSON", family: "data", extensions: ["json"], color: "#8c741c" }
]);

const TARGET_IDS = new Set(FORMAT_DEFINITIONS.map(item => item.id).filter(id => id !== "bmp"));
const EXTENSION_MAP = new Map();
for (const definition of FORMAT_DEFINITIONS) {
  for (const extension of definition.extensions) EXTENSION_MAP.set(extension, definition.id);
}

function formatById(id) {
  return FORMAT_DEFINITIONS.find(item => item.id === id);
}

function normalizeFormat(value) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/^\./, "");
  if (normalized === "jpg") return "jpeg";
  if (normalized === "tif") return "tiff";
  if (normalized === "htm") return "html";
  return TARGET_IDS.has(normalized) ? normalized : EXTENSION_MAP.get(normalized) || null;
}

function detectFormatByPath(filePath) {
  return normalizeFormat(path.extname(filePath));
}

function sniffMagic(buffer, expected) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return expected && ["txt", "md", "csv", "tsv", "json", "html"].includes(expected) ? expected : null;
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.subarray(0, 4).toString("ascii") === "GIF8") return "gif";
  if (buffer.subarray(0, 4).toString("hex") === "49492a00" || buffer.subarray(0, 4).toString("hex") === "4d4d002a") return "tiff";
  if (buffer.subarray(0, 2).toString("ascii") === "BM") return "bmp";
  if (buffer.subarray(4, 12).toString("ascii").includes("ftypavif")) return "avif";
  if (buffer.subarray(0, 4).toString("hex") === "504b0304" && ["docx", "xlsx", "pptx"].includes(expected)) return expected;
  if (["txt", "md", "csv", "tsv", "json", "html"].includes(expected)) {
    const nulCount = buffer.subarray(0, Math.min(buffer.length, 4096)).reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
    return nulCount > 4 ? null : expected;
  }
  return null;
}

function routeRequirements(source, target, profile) {
  const sourceDef = formatById(source);
  const targetDef = formatById(target);
  if (!sourceDef || !targetDef) return null;
  if (source === target) return { engines: ["filesystem"], quality: "lossless", multiOutput: false, description: "验证后复制文件", warnings: [] };

  if (sourceDef.family === "image" && targetDef.family === "image") {
    return { engines: ["sharp"], quality: "semantic", multiOutput: false, description: `重新编码为 ${targetDef.label}`, warnings: ["动画、HDR、ICC 或 EXIF 可能因目标格式能力而变化。"] };
  }
  if (sourceDef.family === "image" && target === "pdf") {
    return { engines: ["sharp", "pdf"], quality: "visual", multiOutput: false, description: "按原始比例嵌入 PDF 页面", warnings: [] };
  }
  if (sourceDef.family === "image" && ["txt", "md", "html", "json", "csv", "tsv"].includes(target)) {
    return { engines: ["ocr"], quality: "ocr", multiOutput: false, description: "OCR 识别后输出文本或结构化数据", warnings: ["OCR 结果需要人工复核，复杂表格和手写内容可能识别不完整。"] };
  }
  if (sourceDef.family === "image" && targetDef.family === "office") {
    const officeEngine = target === "xlsx" ? "excel" : "officecli";
    return { engines: profile === "editable" ? ["sharp", "ocr", officeEngine] : ["sharp", officeEngine], quality: profile === "editable" ? "ocr" : "visual", multiOutput: false, description: profile === "editable" ? "OCR 后重建可编辑 Office 内容" : "将图片作为可视页面嵌入 Office", warnings: profile === "editable" ? ["可编辑重建不会保留原始排版。"] : [] };
  }

  if (source === "pdf" && targetDef.family === "image") {
    return { engines: target === "png" ? ["pdf"] : ["pdf", "sharp"], quality: "visual", multiOutput: true, description: `逐页渲染为 ${targetDef.label}`, warnings: [] };
  }
  if (source === "pdf" && ["txt", "md", "html", "json", "csv", "tsv"].includes(target)) {
    return { engines: profile === "editable" ? ["pdf", "ocr"] : ["pdf"], quality: profile === "editable" ? "ocr" : "semantic", multiOutput: false, description: "提取 PDF 文本层，扫描页按需 OCR", warnings: ["阅读顺序和复杂表格可能需要人工校正。"] };
  }
  if (source === "pdf" && targetDef.family === "office") {
    const officeEngine = target === "xlsx" ? "excel" : "officecli";
    const visualEngines = target === "xlsx" ? ["pdf", "sharp", officeEngine] : ["pdf", officeEngine];
    return { engines: profile === "visual" ? visualEngines : ["pdf", "ocr", officeEngine], quality: profile === "visual" ? "visual" : "semantic", multiOutput: false, description: profile === "visual" ? "将 PDF 页面作为视觉页面写入 Office" : "提取内容后重建可编辑 Office 文档", warnings: profile === "visual" ? ["视觉模式中的页面内容不可直接编辑。"] : ["版式、表格、公式和字体可能变化。"] };
  }

  if (sourceDef.family === "office" && ["txt", "md", "html", "json", "csv", "tsv"].includes(target)) {
    return { engines: ["officecli"], quality: "semantic", multiOutput: false, description: `提取 ${sourceDef.label} 内容并输出 ${targetDef.label}`, warnings: targetDef.family === "data" ? ["仅表格或按行内容适合结构化输出。"] : [] };
  }
  if (sourceDef.family === "office" && target === "pdf") {
    return { engines: ["officecli", "render"], quality: "visual", multiOutput: false, description: "通过可用的 Office 导出或浏览器渲染生成 PDF", warnings: ["缺失字体可能导致跨平台分页差异。"] };
  }
  if (sourceDef.family === "office" && targetDef.family === "image") {
    return { engines: ["officecli", "browser"], quality: "visual", multiOutput: true, description: `逐页渲染为 ${targetDef.label}`, warnings: ["需要 Chrome、Edge 或 Chromium。"] };
  }
  if (sourceDef.family === "office" && targetDef.family === "office") {
    return { engines: target === "xlsx" ? ["officecli", "excel"] : ["officecli"], quality: "semantic", multiOutput: false, description: `提取结构后重建为 ${targetDef.label}`, warnings: ["Office 跨类型转换属于语义重建，不保留完整原始版式。"] };
  }

  if (["text", "data"].includes(sourceDef.family) && ["text", "data"].includes(targetDef.family)) {
    return { engines: ["text"], quality: sourceDef.family === targetDef.family ? "lossless" : "semantic", multiOutput: false, description: `解析并输出 ${targetDef.label}`, warnings: sourceDef.family !== targetDef.family ? ["非结构化文本转表格时默认一行一条记录。"] : [] };
  }
  if (["text", "data"].includes(sourceDef.family) && targetDef.family === "image") {
    return { engines: ["sharp"], quality: "visual", multiOutput: true, description: `排版并渲染为 ${targetDef.label}`, warnings: ["分页和字体取决于本机可用字体。"] };
  }
  if (["text", "data"].includes(sourceDef.family) && target === "pdf") {
    return { engines: ["sharp", "pdf"], quality: "visual", multiOutput: false, description: "排版为分页图片并封装 PDF", warnings: ["分页和字体取决于本机可用字体。"] };
  }
  if (["text", "data"].includes(sourceDef.family) && targetDef.family === "office") {
    return { engines: [target === "xlsx" ? "excel" : "officecli"], quality: "semantic", multiOutput: false, description: `按模板生成 ${targetDef.label}`, warnings: ["纯文本缺少版式语义，将使用插件默认模板。"] };
  }
  return null;
}

function engineAvailable(engine, runtimeMap) {
  if (["filesystem", "text"].includes(engine)) return true;
  if (engine === "render") return Boolean(runtimeMap.officecli && (runtimeMap.libreoffice || runtimeMap.browser));
  return Boolean(runtimeMap[engine]);
}

function buildRoute(source, target, profile, runtimes) {
  const requirement = routeRequirements(source, target, profile);
  if (!requirement) return null;
  const runtimeMap = Object.fromEntries(runtimes.map(item => [item.id, item.available]));
  return {
    source,
    target,
    profile,
    ...requirement,
    available: requirement.engines.every(engine => engineAvailable(engine, runtimeMap))
  };
}

function buildAllRoutes(runtimes) {
  const profiles = ["visual", "editable", "extract"];
  const routes = [];
  for (const source of FORMAT_DEFINITIONS.map(item => item.id)) {
    for (const target of TARGET_IDS) {
      for (const profile of profiles) {
        const route = buildRoute(source, target, profile, runtimes);
        if (route) routes.push(route);
      }
    }
  }
  return routes;
}

module.exports = { FORMAT_DEFINITIONS, TARGET_IDS, formatById, normalizeFormat, detectFormatByPath, sniffMagic, buildRoute, buildAllRoutes };
