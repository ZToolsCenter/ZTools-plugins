import { getArtifactHeadings, type ArtifactHeading, type ArtifactSpec } from "./artifactSpec";
import { hasCodeFunctionDefinition } from "./codeArtifactIdentifiers";
import { decodeMarkdownInlineText as decodeInline, headingSequenceFailure, headingsIn, type HeadingRecord } from "./artifactHeadingValidation";

export type ArtifactValidationCode =
  | "invalid_spec" | "missing_code_block" | "language_mismatch" | "literal_body_mismatch" | "json_body_mismatch"
  | "missing_heading" | "heading_level_mismatch" | "heading_text_mismatch" | "heading_order_mismatch" | "function_name_mismatch"
  | "prefix_heading_position_mismatch"
  | "missing_table" | "table_column_mismatch" | "table_row_count_mismatch" | "table_cell_mismatch"
  | "missing_list" | "list_order_mismatch" | "list_count_mismatch" | "list_item_mismatch"
  | "invalid_math" | "math_display_mismatch" | "math_equation_mismatch"
  | "invalid_mermaid" | "mermaid_direction_mismatch" | "mermaid_node_mismatch" | "mermaid_edge_mismatch";

export class ArtifactValidationError extends Error {
  constructor(
    readonly code: ArtifactValidationCode,
    message: string,
    readonly actual?: unknown,
    readonly required?: unknown
  ) {
    const describe = (value: unknown) => {
      if (value === undefined) return "未提供";
      try { const text = JSON.stringify(value); return text && text.length > 160 ? `${text.slice(0, 160)}…` : text; }
      catch { return String(value).slice(0, 160); }
    };
    super(`产物校验失败（${code}）：${message}；实际=${describe(actual)}；要求=${describe(required)}`);
    this.name = "ArtifactValidationError";
  }
}

function fail(code: ArtifactValidationCode, message: string, actual?: unknown, required?: unknown): never {
  throw new ArtifactValidationError(code, message, actual, required);
}

interface FenceBlock { language: string; body: string; startLine: number; endLine: number; closed: boolean; }
function linesOf(text: string): string[] { return text.replace(/\r\n?/gu, "\n").split("\n"); }

function parseFences(text: string): FenceBlock[] {
  const lines = linesOf(text);
  const blocks: FenceBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(lines[index]);
    if (!opening) continue;
    const marker = opening[1];
    const character = marker[0];
    const info = opening[2].trim();
    const language = info.split(/[\t ]+/u, 1)[0]?.toLowerCase() ?? "";
    let close = index + 1;
    for (; close < lines.length; close += 1) {
      const closing = /^ {0,3}(`+|~+)[\t ]*$/u.exec(lines[close]);
      if (closing && closing[1][0] === character && closing[1].length >= marker.length) break;
    }
    const closed = close < lines.length;
    blocks.push({ language, body: lines.slice(index + 1, closed ? close : lines.length).join("\n"),
      startLine: index, endLine: closed ? close : lines.length - 1, closed });
    index = closed ? close : lines.length;
  }
  return blocks;
}

function maskFencedLines(text: string): string {
  const lines = linesOf(text);
  for (const block of parseFences(text)) {
    for (let index = block.startLine; index <= block.endLine; index += 1) lines[index] = "";
  }
  return lines.join("\n");
}

const LANGUAGE_FAMILIES = [
  ["js", "javascript", "node", "nodejs", "mjs", "cjs", "jsx"],
  ["ts", "typescript", "tsx", "mts", "cts"], ["py", "python", "py3"], ["md", "markdown"],
  ["json", "jsonc"], ["sh", "shell", "bash", "zsh"], ["html", "htm"], ["yml", "yaml"],
  ["rb", "ruby"], ["rs", "rust"], ["go", "golang"], ["kt", "kotlin", "kts"],
  ["cpp", "c++", "cxx"], ["cs", "csharp", "c#"], ["mmd", "mermaid"]
];
function sameLanguage(expected: string, actual: string): boolean {
  const left = expected.trim().toLowerCase();
  const right = actual.trim().toLowerCase();
  if (!left || !right) return left === right;
  const family = LANGUAGE_FAMILIES.find((items) => items.includes(left));
  return family ? family.includes(right) : left === right;
}

function normalizeLineEndings(value: string): string { return value.replace(/\r\n?/gu, "\n"); }

function checkHeading(heading: ArtifactHeading, candidates: readonly HeadingRecord[]): void {
  if (!candidates.length) fail("missing_heading", "缺少 Markdown 标题", [], heading);
  const textMatches = heading.text ? candidates.filter(({ text }) => text === heading.text!.value) : candidates;
  if (heading.text && !textMatches.length) fail("heading_text_mismatch", "标题文字与规格不一致", candidates.map(({ text }) => text), heading.text.value);
  if (heading.level && !textMatches.some(({ level }) => level === heading.level!.value)) {
    fail("heading_level_mismatch", "标题级别与规格不一致", textMatches.map(({ level }) => level), heading.level.value);
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null || typeof left !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  }
  const a = Object.keys(left as object).sort();
  const b = Object.keys(right as object).sort();
  return a.length === b.length && a.every((key, index) => key === b[index] &&
    jsonEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function isIdentifier(value: string): boolean { return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(value); }

function validateCode(spec: Extract<ArtifactSpec, { kind: "code" }>, text: string): void {
  const blocks = parseFences(text).filter(({ closed }) => closed);
  if (!blocks.length) fail("missing_code_block", "缺少闭合代码围栏", text, "闭合代码块");
  const eligible = spec.language ? blocks.filter(({ language }) => sameLanguage(spec.language!.value, language)) : blocks;
  if (spec.language && !eligible.length) fail("language_mismatch", "代码语言标签不匹配", blocks.map(({ language }) => language), spec.language.value);
  if (spec.prefixHeading) {
    checkHeading(spec.prefixHeading, headingsIn(maskFencedLines(text)));
    const beforeFirstMatchingFence = linesOf(maskFencedLines(text)).slice(0, eligible[0].startLine).join("\n");
    try { checkHeading(spec.prefixHeading, headingsIn(beforeFirstMatchingFence)); }
    catch { fail("prefix_heading_position_mismatch", "外部标题应位于首个匹配语言代码块之前", eligible[0].startLine, spec.prefixHeading); }
  }
  let lastError: unknown;
  for (const block of eligible) {
    if (!block.body.trim()) { lastError = new ArtifactValidationError("missing_code_block", "代码块内容为空", block.body, "非空代码"); continue; }
    try {
      if (spec.literalBody && block.body !== spec.literalBody.value.replace(/\r\n?/gu, "\n")) {
        fail("literal_body_mismatch", "代码正文与明确给出的内容不一致", block.body, spec.literalBody.value);
      }
      if (spec.jsonBody) {
        let actual: unknown;
        try { actual = JSON.parse(block.body); }
        catch { fail("json_body_mismatch", "代码块不是完整 JSON", block.body, spec.jsonBody.value); }
        if (!jsonEqual(actual, spec.jsonBody.value)) fail("json_body_mismatch", "JSON 结构与明确给出的数据不一致", actual, spec.jsonBody.value);
      }
      if (spec.heading) checkHeading(spec.heading, headingsIn(block.body));
      if (spec.functionName && !isIdentifier(spec.functionName.value)) fail("invalid_spec", "functionName 必须是一个标识符", spec.functionName.value, "有效标识符");
      if (spec.functionName && !hasCodeFunctionDefinition(block.body, spec.functionName.value, block.language)) {
        fail("function_name_mismatch", "代码块没有定义指定函数", block.body, spec.functionName.value);
      }
      return;
    } catch (error) { lastError = error; }
  }
  if (lastError !== undefined) throw lastError;
  fail("missing_code_block", "没有符合规格的代码块", blocks.map(({ language }) => language), spec.language?.value);
}

function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && unescapedAt(source, source.length - 1)) source = source.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of source) {
    if (escaped) { current += `\\${char}`; escaped = false; }
    else if (char === "\\") escaped = true;
    else if (char === "|") { cells.push(current.trim()); current = ""; }
    else current += char;
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

interface TableRecord { columns: string[]; rows: string[][]; }
function tablesIn(text: string): TableRecord[] {
  const lines = linesOf(maskFencedLines(text));
  const tables: TableRecord[] = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!lines[index].includes("|") || !lines[index + 1].includes("|")) continue;
    const columns = splitTableRow(lines[index]);
    const separators = splitTableRow(lines[index + 1]);
    if (!columns.length || columns.length !== separators.length || separators.some((cell) => !/^:?-{3,}:?$/u.test(cell))) continue;
    const rows: string[][] = [];
    let next = index + 2;
    let malformed = false;
    while (next < lines.length && lines[next].trim() && lines[next].includes("|")) {
      const row = splitTableRow(lines[next]);
      if (row.length !== columns.length) { malformed = true; break; }
      rows.push(row);
      next += 1;
    }
    if (rows.length && !malformed) tables.push({ columns: columns.map(decodeInline), rows: rows.map((row) => row.map(decodeInline)) });
  }
  return tables;
}

function validateTable(spec: Extract<ArtifactSpec, { kind: "table" }>, text: string): void {
  const tables = tablesIn(text);
  if (!tables.length) fail("missing_table", "缺少含表头、分隔线和数据行的 Markdown 表格", text, "Markdown 表格");
  for (const table of tables) {
    if (spec.columns && (table.columns.length !== spec.columns.length ||
        !spec.columns.every(({ value }, index) => table.columns[index] === value))) continue;
    if (spec.rows && (table.rows.length !== spec.rows.length || spec.rows.some((row, index) =>
        row.length !== table.columns.length || row.some(({ value }, column) => table.rows[index]?.[column] !== normalizeLineEndings(value))))) continue;
    return;
  }
  const table = tables[0];
  if (spec.columns && (table.columns.length !== spec.columns.length || spec.columns.some(({ value }, index) => table.columns[index] !== value))) {
    fail("table_column_mismatch", "表格列名或顺序与规格不一致", table.columns, spec.columns.map(({ value }) => value));
  }
  if (spec.rows && table.rows.length !== spec.rows.length) {
    fail("table_row_count_mismatch", "表格行数与规格不一致", table.rows.length, spec.rows.length);
  }
  if (spec.rows) {
    for (const [rowIndex, row] of spec.rows.entries()) {
      for (const [columnIndex, cell] of row.entries()) {
        if (table.rows[rowIndex]?.[columnIndex] !== normalizeLineEndings(cell.value)) {
          fail("table_cell_mismatch", "表格单元格与规格不一致", table.rows[rowIndex]?.[columnIndex], normalizeLineEndings(cell.value));
        }
      }
    }
  }
}

interface ListRecord { ordered: boolean; numbers: number[]; items: string[]; }
function listMarker(line: string): { ordered: boolean; number?: number; text: string } | undefined {
  const ordered = /^ {0,3}(\d+)[.)][\t ]+(.+?)\s*$/u.exec(line);
  if (ordered) return { ordered: true, number: Number(ordered[1]), text: decodeInline(ordered[2]) };
  const bullet = /^ {0,3}[-+*][\t ]+(.+?)\s*$/u.exec(line);
  return bullet ? { ordered: false, text: decodeInline(bullet[1]) } : undefined;
}

function listsIn(text: string): ListRecord[] {
  const lines = linesOf(maskFencedLines(text));
  const lists: ListRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const first = listMarker(lines[index]);
    if (!first) continue;
    const list: ListRecord = { ordered: first.ordered, numbers: [], items: [] };
    let current: ReturnType<typeof listMarker> = first;
    while (current) {
      if (current.ordered !== list.ordered) break;
      list.items.push(current.text);
      if (current.number !== undefined) list.numbers.push(current.number);
      index += 1;
      current = index < lines.length ? listMarker(lines[index]) : undefined;
    }
    index -= 1;
    lists.push(list);
  }
  return lists;
}

function validateList(spec: Extract<ArtifactSpec, { kind: "list" }>, text: string): void {
  if (spec.count && spec.items && spec.count.value !== spec.items.length) fail("invalid_spec", "列表 count 与明确条目数冲突", spec.count.value, spec.items.length);
  const lists = listsIn(text);
  if (!lists.length) fail("missing_list", "缺少 Markdown 列表", text, spec.ordered ? "有序列表" : "无序列表");
  const matching = lists.find(({ ordered }) => ordered === spec.ordered);
  if (!matching) fail("list_order_mismatch", "列表有序或无序形式与规格不一致", lists[0].ordered ? "ordered" : "unordered", spec.ordered ? "ordered" : "unordered");
  if (spec.count && matching.items.length !== spec.count.value) fail("list_count_mismatch", "列表条目数与规格不一致", matching.items.length, spec.count.value);
  if (matching.ordered && matching.numbers.some((number, index) => index > 0 && number !== matching.numbers[index - 1] + 1)) {
    fail("list_order_mismatch", "有序列表编号没有按顺序递增", matching.numbers, "连续递增编号");
  }
  if (spec.items && (matching.items.length !== spec.items.length || spec.items.some(({ value }, index) => matching.items[index] !== normalizeLineEndings(value)))) {
    fail("list_item_mismatch", "列表条目文字或顺序与规格不一致", matching.items, spec.items.map(({ value }) => normalizeLineEndings(value)));
  }
}

interface MathRecord { display: boolean; equation: string; }
function unescapedAt(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 0;
}

function formulasIn(text: string): { formulas: MathRecord[]; unclosedDisplay: boolean; unclosedInline: boolean } {
  const lines = linesOf(text);
  const fenced = parseFences(text);
  const masked = lines.map((line, index) => fenced.some(({ startLine, endLine }) => index >= startLine && index <= endLine) ? " ".repeat(line.length) : line).join("\n");
  const displayPositions: number[] = [];
  for (let index = 0; index < masked.length - 1; index += 1) {
    if (masked.slice(index, index + 2) === "$$" && unescapedAt(masked, index)) { displayPositions.push(index); index += 1; }
  }
  const formulas: MathRecord[] = [];
  for (let index = 0; index + 1 < displayPositions.length; index += 2) {
    const open = displayPositions[index];
    const close = displayPositions[index + 1];
    formulas.push({ display: true, equation: masked.slice(open + 2, close).trim() });
  }
  const unclosedDisplay = displayPositions.length % 2 === 1;
  const withoutDisplay = masked.split("");
  for (let index = 0; index < displayPositions.length; index += 1) {
    const from = displayPositions[index];
    const to = displayPositions[index + 1] === undefined ? from + 2 : displayPositions[index + 1] + 2;
    for (let cursor = from; cursor < to; cursor += 1) if (withoutDisplay[cursor] !== "\n") withoutDisplay[cursor] = " ";
    if (displayPositions[index + 1] !== undefined) index += 1;
  }
  const inlineSource = withoutDisplay.join("");
  const inlinePositions: number[] = [];
  for (let index = 0; index < inlineSource.length; index += 1) {
    if (inlineSource[index] === "$" && unescapedAt(inlineSource, index)) inlinePositions.push(index);
  }
  let unclosedInline = false;
  for (let index = 0; index + 1 < inlinePositions.length; index += 2) {
    const open = inlinePositions[index];
    const close = inlinePositions[index + 1];
    const equation = inlineSource.slice(open + 1, close);
    if (!equation.includes("\n")) formulas.push({ display: false, equation: equation.trim() });
    else unclosedInline = true;
  }
  if (inlinePositions.length % 2) unclosedInline = true;
  return { formulas, unclosedDisplay, unclosedInline };
}

function validateMath(spec: Extract<ArtifactSpec, { kind: "math" }>, text: string): void {
  const result = formulasIn(text);
  if (result.unclosedDisplay || result.unclosedInline) fail("invalid_math", "数学公式定界符没有成对闭合", text, "闭合的 $$ 或 $...$ 公式");
  const matchingType = result.formulas.filter(({ display }) => display === spec.display);
  if (!matchingType.length && result.formulas.length) fail("math_display_mismatch", "公式显示方式与规格不一致", result.formulas.map(({ display }) => display ? "display" : "inline"), spec.display ? "display" : "inline");
  if (!matchingType.length) fail("invalid_math", "没有找到显式数学公式定界符", text, spec.display ? "$$...$$" : "$...$");
  if (spec.equation && !matchingType.some(({ equation }) => equation === normalizeLineEndings(spec.equation!.value).trim())) {
    fail("math_equation_mismatch", "公式内容与明确给出的公式不一致", matchingType.map(({ equation }) => equation), spec.equation.value);
  }
}

interface FlowNode { id: string; label: string; hasLabel: boolean; }
interface FlowEdge { from: string; to: string; }
interface FlowGraph { direction: "LR" | "TD"; nodes: FlowNode[]; edges: FlowEdge[]; }
function parseFlowToken(raw: string): FlowNode | undefined {
  const token = raw.trim().replace(/^\|[^|]*\|[\t ]*/u, "");
  const match = /^([\p{L}\p{N}_][\p{L}\p{N}_.-]*)(?:\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\})?$/u.exec(token);
  if (!match) return undefined;
  const label = (match[2] ?? match[3] ?? match[4] ?? match[1]).trim().replace(/^["']|["']$/gu, "")
    .replace(/\\([\\"])/gu, "$1");
  return { id: match[1], label, hasLabel: match[2] !== undefined || match[3] !== undefined || match[4] !== undefined };
}

function parseFlowGraph(block: FenceBlock): FlowGraph | undefined {
  const lines = block.body.split("\n").map((line) => line.trim().replace(/;\s*$/u, "")).filter((line) => line && !line.startsWith("%%"));
  const header = /^(?:graph|flowchart)\s+(LR|TD|TB)\b/iu.exec(lines[0] ?? "");
  if (!header) return undefined;
  const graph: FlowGraph = { direction: header[1].toUpperCase() === "LR" ? "LR" : "TD", nodes: [], edges: [] };
  const nodes = new Map<string, FlowNode>();
  const putNode = (node: FlowNode) => {
    const previous = nodes.get(node.id);
    if (!previous || node.hasLabel) nodes.set(node.id, node);
  };
  for (const line of lines.slice(1)) {
    const connectors = [...line.matchAll(/-->|-\.->|==>|->/gu)];
    if (!connectors.length) {
      const node = parseFlowToken(line);
      if (node) putNode(node);
      continue;
    }
    const tokens: string[] = [];
    let from = 0;
    for (const connector of connectors) {
      tokens.push(line.slice(from, connector.index));
      from = (connector.index ?? 0) + connector[0].length;
    }
    tokens.push(line.slice(from));
    const parsed = tokens.map(parseFlowToken);
    if (parsed.some((node) => !node)) continue;
    for (const node of parsed as FlowNode[]) putNode(node);
    for (let index = 0; index + 1 < (parsed as FlowNode[]).length; index += 1) {
      graph.edges.push({ from: (parsed as FlowNode[])[index].id, to: (parsed as FlowNode[])[index + 1].id });
    }
  }
  graph.nodes = [...nodes.values()];
  return graph.edges.length && graph.nodes.length >= 2 ? graph : undefined;
}

function mermaidShapeSupported(block: FenceBlock): boolean {
  const lines = block.body.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  if (lines.length < 2) return false;
  const [header, ...body] = lines;
  if (/^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/iu.test(header)) {
    return body.some((line) => /^[\p{L}\p{N}_-]+(?:\[[^\]\n]*\]|\([^\)\n]*\)|\{[^}\n]*\})?\s*(?:<[-=]+|[-=]+>|-\.+>|--+o|--+x).*?[\p{L}\p{N}_-]+/u.test(line));
  }
  if (/^sequenceDiagram\b/iu.test(header)) return body.some((line) => /^[\w\p{L}-]+\s*(?:--?>|--?>>|->>|-->>|-[.-]>)[\w\p{L}-]+\s*:/u.test(line));
  if (/^classDiagram(?:-v2)?\b/iu.test(header)) return body.some((line) => /(?:<\|--|\*--|o--|-->|\.\.\.|--\|>)/u.test(line));
  if (/^stateDiagram(?:-v2)?\b/iu.test(header)) return body.some((line) => /(?:\[\*\]|[\p{L}\p{N}_-]+)\s*--?>\s*(?:\[\*\]|[\p{L}\p{N}_-]+)/u.test(line));
  if (/^erDiagram\b/iu.test(header)) return body.some((line) => /\b\w+\s+(?:\|\|\|?|\}\|o?|o\{)---?(?:\|\|\|?|\}o?|o\{)\s+\w+\b/u.test(line));
  if (/^pie\b/iu.test(header)) return body.some((line) => /^"[^"\n]+"\s*:\s*\d+(?:\.\d+)?/u.test(line));
  if (/^gantt\b/iu.test(header)) return body.some((line) => /^(?:section\s+.+|[^:]+:\s*(?:done|active|crit|milestone|after\s+.+)?\s*,?\s*.+)/iu.test(line));
  return /^(?:mindmap|timeline|journey|quadrantChart|xychart-beta|sankey-beta|block-beta|architecture-beta)\b/iu.test(header) && body.length >= 2;
}

function mermaidBlocks(text: string): FenceBlock[] {
  const found: FenceBlock[] = [];
  for (const block of parseFences(text)) {
    if (sameLanguage("mermaid", block.language)) found.push(block);
    else if (sameLanguage("markdown", block.language) || block.language === "md") {
      found.push(...parseFences(block.body).filter(({ language }) => sameLanguage("mermaid", language)));
    }
  }
  return found;
}

function validateMermaid(spec: Extract<ArtifactSpec, { kind: "mermaid" }>, text: string): void {
  const blocks = mermaidBlocks(text).filter(({ closed }) => closed);
  const graphs = blocks.map(parseFlowGraph).filter((graph): graph is FlowGraph => Boolean(graph));
  const hasComplexShape = blocks.some((block) => !parseFlowGraph(block) && mermaidShapeSupported(block));
  if (!graphs.length && !hasComplexShape) fail("invalid_mermaid", "需要闭合 mermaid 围栏、受支持图形和至少一条图关系", text, "```mermaid\ngraph LR|TD\nA --> B\n```");
  const requirement = spec.graph;
  if (!graphs.length && requirement) fail("mermaid_edge_mismatch", "返回图类型不能验证指定的流程节点与边", text, requirement);
  if (!requirement) return;
  if (requirement.edges.some(({ from, to }) => from < 0 || to < 0 || from >= requirement.nodes.length || to >= requirement.nodes.length) ||
      new Set(requirement.nodes.map(({ value }) => value)).size !== requirement.nodes.length) {
    fail("invalid_spec", "Mermaid 节点索引越界或节点标识重复", requirement, "有效且唯一的节点及边索引");
  }
  for (const graph of graphs) {
    if (graph.direction !== requirement.direction) continue;
    const mapped = requirement.nodes.map(({ value }) => {
      const expected = parseFlowToken(value);
      const matches = graph.nodes.filter((node) => node.id === (expected?.id ?? value) || node.label === (expected?.label ?? value) || `${node.id}[${node.label}]` === value);
      return matches[0];
    });
    if (mapped.some((node) => !node)) continue;
    const actualEdges = new Set(graph.edges.map(({ from, to }) => `${from}\0${to}`));
    if (requirement.edges.every(({ from, to }) => actualEdges.has(`${mapped[from]!.id}\0${mapped[to]!.id}`))) return;
    continue;
  }
  const directionMatches = graphs.filter(({ direction }) => direction === requirement.direction);
  if (!directionMatches.length) fail("mermaid_direction_mismatch", "图方向与规格不一致", graphs.map(({ direction }) => direction), requirement.direction);
  const graph = directionMatches[0];
  for (const { value } of requirement.nodes) {
    const expected = parseFlowToken(value);
    if (!graph.nodes.some((node) => node.id === (expected?.id ?? value) || node.label === (expected?.label ?? value) || `${node.id}[${node.label}]` === value)) {
      fail("mermaid_node_mismatch", "图中缺少明确要求的节点", graph.nodes, value);
    }
  }
  const mapped = requirement.nodes.map(({ value }) => {
    const expected = parseFlowToken(value);
    return graph.nodes.find((node) => node.id === (expected?.id ?? value) || node.label === (expected?.label ?? value) || `${node.id}[${node.label}]` === value);
  });
  const expectedEdges = requirement.edges.map(({ from, to }) => ({ from: mapped[from]?.id, to: mapped[to]?.id }));
  fail("mermaid_edge_mismatch", "图中缺少明确要求的节点关系", graph.edges, expectedEdges);
}

/** Checks only the artifact kind and fields explicitly carried by its specification. */
export function validateArtifactCandidate(spec: ArtifactSpec, text: string): void {
  switch (spec.kind) {
    case "none":
    case "markdown":
      break;
    case "heading":
      {
        const expected = getArtifactHeadings(spec);
        if (!expected) fail("invalid_spec", "标题集合为空、过长或首项与兼容字段不一致", spec.headings, spec.heading);
        if (expected.length === 1) checkHeading(spec.heading, headingsIn(text));
        else {
          const failure = headingSequenceFailure(expected, headingsIn(text));
          if (failure) fail(failure.code, failure.message, failure.actual, failure.required);
        }
      }
      break;
    case "code":
      validateCode(spec, text);
      break;
    case "table":
      validateTable(spec, text);
      break;
    case "list":
      validateList(spec, text);
      break;
    case "math":
      validateMath(spec, text);
      break;
    case "mermaid":
      validateMermaid(spec, text);
      break;
  }
  if (spec.issues.length) fail("invalid_spec", "规格包含未解决的问题", spec.issues, "无 issues");
}
