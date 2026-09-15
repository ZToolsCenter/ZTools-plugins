/**
 * visual 工具：原样透传参数给 UI 层渲染卡片。
 */

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : String(item)));
}

export async function executeShowTable(
  input: Record<string, unknown>,
): Promise<unknown> {
  const columns = asStringArray(input.columns);
  const rowsRaw = Array.isArray(input.rows) ? input.rows : [];
  const rows = rowsRaw.map((row) =>
    Array.isArray(row)
      ? row.map((cell) => (typeof cell === "string" ? cell : String(cell ?? "")))
      : [],
  );
  return {
    ok: true,
    kind: "table" as const,
    title: input.title != null ? asString(input.title) : undefined,
    columns,
    rows,
  };
}

const CHART_TYPE_LABEL: Record<string, string> = {
  bar: "柱状图",
  line: "折线图",
  pie: "饼图",
};

export async function executeShowChart(
  input: Record<string, unknown>,
): Promise<unknown> {
  const typeRaw = asString(input.type, "bar");
  const type =
    typeRaw === "line" || typeRaw === "pie" || typeRaw === "bar"
      ? typeRaw
      : "bar";
  const categories = input.categories
    ? asStringArray(input.categories)
    : undefined;
  const seriesRaw = Array.isArray(input.series) ? input.series : [];
  const series = seriesRaw.map((item) => {
    const rec = (item ?? {}) as Record<string, unknown>;
    const dataRaw = Array.isArray(rec.data) ? rec.data : [];
    return {
      name: asString(rec.name, "系列"),
      data: dataRaw.map((n) => (typeof n === "number" ? n : Number(n) || 0)),
    };
  });
  return {
    ok: true,
    kind: "chart" as const,
    type,
    typeLabel: CHART_TYPE_LABEL[type] ?? "柱状图",
    title: input.title != null ? asString(input.title) : undefined,
    categories,
    series,
  };
}

export async function executeShowDiagram(
  input: Record<string, unknown>,
): Promise<unknown> {
  // 兼容 source / mermaid / code 三别名（与 toolSchemas / tools registry 对齐）
  const { executeShowDiagramNormalized } = await import("./artifactVisual");
  return executeShowDiagramNormalized(input);
}

export async function executeShowSvg(
  input: Record<string, unknown>,
): Promise<unknown> {
  const svg =
    asString(input.svg).trim() ||
    asString(input.content).trim() ||
    asString(input.source).trim();
  if (!svg) {
    return {
      ok: false,
      kind: "svg" as const,
      error: "请提供 svg 内容（或 content / source）",
    };
  }
  // 基础健全性：明显非 SVG 标记时仍透传，由 UI 包裹；空标签拒绝
  if (svg.length < 4) {
    return {
      ok: false,
      kind: "svg" as const,
      error: "SVG 内容过短，请检查是否完整",
    };
  }
  return {
    ok: true,
    kind: "svg" as const,
    title: input.title != null ? asString(input.title) : undefined,
    svg,
  };
}
