/**
 * 从 tool part 判断是否为 Artifact 类工具，以及输出形状。
 */

export const ARTIFACT_TOOL_NAMES = new Set([
  "showHtml",
  "showDiagram",
  "showSvg",
  "showTable",
  "showChart",
  "generateImage",
  "writeDocx",
  "writeXlsx",
  "writePptx",
  "parseOffice",
]);

export type ArtifactKind =
  | "html"
  | "diagram"
  | "svg"
  | "table"
  | "chart"
  | "image"
  | "office-docx"
  | "office-xlsx"
  | "office-pptx"
  | "office-parse"
  | "unknown";

export function toolTypeName(type: string): string {
  return type.startsWith("tool-") ? type.slice("tool-".length) : type;
}

export function isArtifactToolType(type: string): boolean {
  return ARTIFACT_TOOL_NAMES.has(toolTypeName(type));
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type ArtifactPayload = {
  kind: ArtifactKind;
  title?: string;
  filename?: string;
  mimeType?: string;
  html?: string;
  source?: string;
  language?: string;
  svg?: string;
  contentBase64?: string;
  url?: string;
  columns?: string[];
  rows?: string[][];
  chartType?: string;
  categories?: string[];
  series?: Array<{ name: string; data: number[] }>;
  text?: string;
  error?: string;
  savedPath?: string;
  saveError?: string;
  byteLength?: number;
  ok?: boolean;
};

export function parseArtifactPayload(
  toolType: string,
  output: unknown,
): ArtifactPayload | null {
  const name = toolTypeName(toolType);
  if (!ARTIFACT_TOOL_NAMES.has(name)) return null;

  const out = readObject(output);
  if (!out) {
    return { kind: "unknown", error: "无输出" };
  }

  const error = asString(out.error);
  if (out.ok === false || error) {
    return {
      kind: mapToolToKind(name, out),
      title: asString(out.title) || undefined,
      error: error || "失败",
      ok: false,
    };
  }

  const kind = mapToolToKind(name, out);
  const base: ArtifactPayload = {
    kind,
    title: asString(out.title) || undefined,
    filename: asString(out.filename) || undefined,
    mimeType: asString(out.mimeType) || undefined,
    contentBase64: asString(out.contentBase64) || undefined,
    url: asString(out.url) || undefined,
    html: asString(out.html) || asString(out.content) || undefined,
    source:
      asString(out.source) ||
      asString(out.mermaid) ||
      asString(out.code) ||
      undefined,
    language: asString(out.language) || undefined,
    svg: asString(out.svg) || undefined,
    text: asString(out.text) || undefined,
    savedPath: asString(out.savedPath) || undefined,
    saveError: asString(out.saveError) || undefined,
    byteLength:
      typeof out.byteLength === "number" ? out.byteLength : undefined,
    ok: true,
  };

  if (kind === "table") {
    base.columns = Array.isArray(out.columns)
      ? out.columns.map((c) => String(c ?? ""))
      : [];
    base.rows = Array.isArray(out.rows)
      ? out.rows.map((row) =>
          Array.isArray(row) ? row.map((c) => String(c ?? "")) : [],
        )
      : [];
  }

  if (kind === "chart") {
    base.chartType = asString(out.type) || "bar";
    base.categories = Array.isArray(out.categories)
      ? out.categories.map((c) => String(c ?? ""))
      : undefined;
    const seriesRaw = Array.isArray(out.series) ? out.series : [];
    base.series = seriesRaw.map((item) => {
      const rec = (item ?? {}) as Record<string, unknown>;
      const dataRaw = Array.isArray(rec.data) ? rec.data : [];
      return {
        name: asString(rec.name) || "系列",
        data: dataRaw.map((n) => (typeof n === "number" ? n : Number(n) || 0)),
      };
    });
  }

  return base;
}

function mapToolToKind(
  name: string,
  out: Record<string, unknown>,
): ArtifactKind {
  const k = asString(out.kind);
  if (k === "html") return "html";
  if (k === "diagram") return "diagram";
  if (k === "image") return "image";
  if (k === "office-docx") return "office-docx";
  if (k === "office-xlsx") return "office-xlsx";
  if (k === "office-pptx") return "office-pptx";
  if (k === "office-parse") return "office-parse";

  switch (name) {
    case "showHtml":
      return "html";
    case "showDiagram":
      return "diagram";
    case "showSvg":
      return "svg";
    case "showTable":
      return "table";
    case "showChart":
      return "chart";
    case "generateImage":
      return "image";
    case "writeDocx":
      return "office-docx";
    case "writeXlsx":
      return "office-xlsx";
    case "writePptx":
      return "office-pptx";
    case "parseOffice":
      return "office-parse";
    default:
      return "unknown";
  }
}

export function kindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "html":
      return "HTML";
    case "diagram":
      return "图表";
    case "svg":
      return "SVG";
    case "table":
      return "表格";
    case "chart":
      return "统计图";
    case "image":
      return "图片";
    case "office-docx":
      return "Word";
    case "office-xlsx":
      return "Excel";
    case "office-pptx":
      return "PPT";
    case "office-parse":
      return "文档解析";
    default:
      return "产物";
  }
}
