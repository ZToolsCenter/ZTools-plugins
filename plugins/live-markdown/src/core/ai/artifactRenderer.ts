import { getArtifactHeadings, type ArtifactField, type ArtifactHeading, type ArtifactSpec } from "./artifactSpec";
import { validateArtifactCandidate } from "./artifactValidation";

function usableField<T>(field: ArtifactField<T> | undefined): field is ArtifactField<T> {
  return field !== undefined;
}

function completeHeading(heading: ArtifactHeading | undefined): string | undefined {
  if (!heading || !heading.level || !heading.text) return undefined;
  const level = heading.level.value;
  const text = heading.text.value;
  if (!Number.isInteger(level) || level < 1 || level > 6 || !text.trim() || /[\r\n]/u.test(text)) return undefined;
  return `${"#".repeat(level)} ${escapeInline(text)}`;
}

function completeHeadings(spec: Extract<ArtifactSpec, { kind: "heading" }>): string | undefined {
  const headings = getArtifactHeadings(spec);
  if (!headings?.length || headings.some(heading => !heading.text)) return undefined;
  const rendered = headings.map(({ level, text }) => renderHeadingPayload(level?.value ?? 2, text!.value));
  return rendered.every((heading): heading is string => Boolean(heading)) ? rendered.join("\n\n") : undefined;
}

/** Renders one explicit heading value without attaching user-instruction evidence to it. */
export function renderHeadingPayload(level: number, text: string): string | undefined {
  if (!Number.isInteger(level) || level < 1 || level > 6 || !text.trim() || /[\r\n]/u.test(text)) return undefined;
  return `${"#".repeat(level)} ${escapeHeadingText(text)}`;
}

function escapeHeadingText(value: string): string {
  return value.replace(/[\\`*_\[\]<>#]/gu, "\\$&");
}

function escapeInline(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/gu, "\\$&");
}

function fenceFor(body: string): string {
  let longest = 0;
  for (const match of body.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}

function renderCode(spec: Extract<ArtifactSpec, { kind: "code" }>): string | undefined {
  if (spec.language && !/^[\p{L}\p{N}_+.#-]+$/u.test(spec.language.value.trim())) return undefined;
  const language = spec.language?.value.trim() ?? "";
  if (spec.language && !language) return undefined;

  const hasLiteral = usableField(spec.literalBody);
  const hasJson = usableField(spec.jsonBody);
  if (hasLiteral && hasJson) return undefined;

  let body: string;
  if (hasJson) {
    const serialized = serializeJson(spec.jsonBody.value);
    if (serialized === undefined || spec.heading || spec.functionName) return undefined;
    body = serialized;
  } else if (hasLiteral) {
    body = spec.literalBody.value;
    if (!body.trim()) {
      const heading = completeHeading(spec.heading);
      if (!heading) return undefined;
      body = heading;
    } else if (spec.heading && !headingMatches(body, spec.heading)) {
      return undefined;
    }
  } else {
    const heading = completeHeading(spec.heading);
    if (!heading) return undefined;
    body = heading;
  }

  return renderCodePayload(spec, body);
}

/** Wraps raw code data in the parameterized Markdown skeleton. */
export function renderCodePayload(spec: Extract<ArtifactSpec, { kind: "code" }>, body: string): string | undefined {
  if (!body.trim()) return undefined;
  if (spec.language && !/^[\p{L}\p{N}_+.#-]+$/u.test(spec.language.value.trim())) return undefined;
  if (spec.heading && !headingMatches(body, spec.heading)) return undefined;
  const language = spec.language?.value.trim() ?? "";
  if (spec.language && !language) return undefined;
  const fence = fenceFor(body);
  const heading = completeHeading(spec.prefixHeading);
  if (spec.prefixHeading && !heading) return undefined;
  // The last line break separates the payload from the closing fence. It must
  // not consume a line break that belongs to the user's literal payload.
  const block = `${fence}${language}\n${body}\n${fence}`;
  return heading ? `${heading}\n\n${block}` : block;
}

function headingMatches(body: string, heading: ArtifactHeading): boolean {
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  return lines.some((line) => {
    const match = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line);
    if (!match) return false;
    if (heading.level && match[1].length !== heading.level.value) return false;
    if (heading.text && unescapeInline(match[2]) !== heading.text.value) return false;
    return true;
  });
}

function unescapeInline(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]()<>#+\-.!|])/gu, "$1");
}

function serializeJson(value: unknown): string | undefined {
  const active = new Set<object>();
  let visited = 0;
  const isJsonValue = (current: unknown, depth: number): boolean => {
    visited += 1;
    if (visited > 50_000 || depth > 64) return false;
    if (current === null || typeof current === "string" || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current);
    if (!current || typeof current !== "object") return false;
    if (active.has(current)) return false;
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) return false;
    if (Object.getOwnPropertySymbols(current).length > 0) return false;
    active.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const valid = Array.isArray(current)
      ? Object.keys(descriptors).every((key) => key === "length" || /^\d+$/u.test(key) &&
        Boolean(descriptors[key].enumerable && "value" in descriptors[key] && isJsonValue(descriptors[key].value, depth + 1))) &&
        Object.keys(descriptors).filter((key) => /^\d+$/u.test(key)).length === current.length
      : Object.keys(descriptors).every((key) => Boolean(descriptors[key].enumerable && "value" in descriptors[key] &&
        isJsonValue(descriptors[key].value, depth + 1)));
    active.delete(current);
    return valid;
  };

  if (!isJsonValue(value, 0)) return undefined;
  try {
    const result = JSON.stringify(value, null, 2);
    return result === undefined ? undefined : result;
  } catch {
    return undefined;
  }
}

function escapeTableCell(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/[\\|*_[\]`!]/gu, "\\$&").replace(/\r\n|\r|\n/gu, "<br>");
}

export function renderTablePayload(columns: readonly string[], rows: readonly (readonly string[])[]): string | undefined {
  if (!columns.length || !rows.length) return undefined;
  const width = columns.length;
  if (columns.some(value => !value.trim()) ||
      rows.some(row => row.length !== width || row.some(value => !value.trim()))) return undefined;
  return [
    `| ${columns.map(value => escapeTableCell(value)).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map(row => `| ${row.map(value => escapeTableCell(value)).join(" | ")} |`)
  ].join("\n");
}

function renderTable(spec: Extract<ArtifactSpec, { kind: "table" }>): string | undefined {
  if (!spec.columns?.length || !spec.rows?.length) return undefined;
  return renderTablePayload(spec.columns.map(({ value }) => value), spec.rows.map(row => row.map(({ value }) => value)));
}

function renderList(spec: Extract<ArtifactSpec, { kind: "list" }>): string | undefined {
  if (!spec.items?.length || spec.items.some(({ value }) => !value.trim())) return undefined;
  if (spec.count && spec.count.value !== spec.items.length) return undefined;
  return spec.items.map(({ value }, index) => {
    const marker = spec.ordered ? `${index + 1}.` : "-";
    const item = escapeInline(value).replace(/\r\n|\r|\n/gu, "<br>");
    return `${marker} ${item}`;
  }).join("\n");
}

export function renderMathPayload(equationValue: string, display: boolean): string | undefined {
  if (!equationValue.trim()) return undefined;
  const equation = equationValue.trim();
  return display ? `$$\n${equation}\n$$` : `$${equation}$`;
}

function renderMath(spec: Extract<ArtifactSpec, { kind: "math" }>): string | undefined {
  return spec.equation ? renderMathPayload(spec.equation.value, spec.display) : undefined;
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"").replace(/[\r\n]/gu, " ");
}

export function renderMermaidPayload(
  direction: "LR" | "TD",
  nodes: readonly string[],
  edges: readonly { from: number; to: number }[]
): string | undefined {
  if (nodes.length < 2 || nodes.some(value => !value.trim()) || !edges.length) return undefined;
  if (new Set(nodes).size !== nodes.length) return undefined;
  if (edges.some(({ from, to }) => !Number.isInteger(from) || !Number.isInteger(to) ||
      from < 0 || to < 0 || from >= nodes.length || to >= nodes.length)) return undefined;

  const nodeIds = nodes.map((_node, index) => `Node${index + 1}`);
  const lines = [`graph ${direction}`,
    ...nodes.map((value, index) => `  ${nodeIds[index]}["${escapeMermaidLabel(value)}"]`),
    ...edges.map(({ from, to }) => `  ${nodeIds[from]} --> ${nodeIds[to]}`)];
  return `\`\`\`mermaid\n${lines.join("\n")}\n\`\`\``;
}

function renderMermaid(spec: Extract<ArtifactSpec, { kind: "mermaid" }>): string | undefined {
  const graph = spec.graph;
  return graph ? renderMermaidPayload(graph.direction,
    graph.nodes.map(({ value }) => value), graph.edges) : undefined;
}

/** Builds a complete artifact solely from fields already present in the resolved specification. */
export function renderArtifact(spec: ArtifactSpec): string | undefined {
  if (spec.sourceDependent || spec.issues.length > 0 || spec.composition === "partial") return undefined;
  let rendered: string | undefined;
  switch (spec.kind) {
    case "none":
    case "markdown":
      return undefined;
    case "heading":
      rendered = completeHeadings(spec);
      break;
    case "code":
      rendered = renderCode(spec);
      break;
    case "table":
      rendered = renderTable(spec);
      break;
    case "list":
      rendered = renderList(spec);
      break;
    case "math":
      rendered = renderMath(spec);
      break;
    case "mermaid":
      rendered = renderMermaid(spec);
      break;
  }
  if (rendered === undefined) return undefined;
  try { validateArtifactCandidate(spec, rendered); return rendered; }
  catch { return undefined; }
}
