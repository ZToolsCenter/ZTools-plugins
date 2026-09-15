import type { ConversionProfile, FormatDefinition, FormatId } from "../types";

export const FORMAT_DEFINITIONS: FormatDefinition[] = [
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
];

export const TARGET_GROUPS = [
  { label: "办公文档", ids: ["docx", "xlsx", "pptx", "pdf"] as FormatId[] },
  { label: "图片", ids: ["png", "jpeg", "webp", "avif", "tiff", "gif"] as FormatId[] },
  { label: "文本与数据", ids: ["txt", "md", "html", "csv", "tsv", "json"] as FormatId[] }
];

export const PROFILE_COPY: Record<ConversionProfile, { label: string; short: string; description: string }> = {
  visual: { label: "视觉保真", short: "外观优先", description: "优先保持页面外观；转回 Office 时内容可能以整页图片呈现。" },
  editable: { label: "可编辑重建", short: "结构优先", description: "重建文本、表格和页面结构；复杂版式可能发生变化。" },
  extract: { label: "内容提取", short: "内容优先", description: "只提取正文、表格或图片，不承诺原始版式。" }
};

export function formatDefinition(id: FormatId) {
  return FORMAT_DEFINITIONS.find(item => item.id === id)!;
}

export function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
