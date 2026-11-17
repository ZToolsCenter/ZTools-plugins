import { GFM, parser } from "@lezer/markdown";
import { decodeAiResponse } from "./aiResponseDecoder";
import { resolveGenerationRequirements } from "./generationRequirements";
import { readGroundedActionFacts } from "./groundedActions";
import { hasExplicitSourceReusePermission } from "./sourceReusePolicy";

export type AiOutputMode = "literal" | "answer" | "fragment" | "rewrite" | "summary" | "grounded_actions";
export type AiOutputFormat = "table" | "code" | "math" | "mermaid" | "markdown" | "none";

export interface AiOutputContractInput {
  mode: AiOutputMode;
  /** Full source or the exact source range this task was authorized to read. */
  source: string;
  raw: string;
  instruction: string;
  format: AiOutputFormat;
  /** Exact payload from the instruction for a programmatic literal operation. */
  literalSource?: string;
  /** Exact source strings selected by the summary fact ledger. */
  sourceFacts?: readonly string[];
  /** Keep a Markdown source fence when the user explicitly asked to see source. */
  displaySource?: boolean;
  /** Canonical plans may surface partial overlap for review; complete source copies remain blocked. */
  reviewPartialOverlap?: boolean;
  /** Only source-transform executors with validated fact receipts may authorize artifact-local reuse. */
  allowArtifactReuseFromFacts?: boolean;
}

export type AiOutputEvidence =
  | { kind: "literal_exact"; codeUnits: number }
  | { kind: "source_fact_validated"; count: number }
  | { kind: "outer_fence_unwrapped"; format: Exclude<AiOutputFormat, "markdown" | "none"> }
  | { kind: "source_fence_preserved"; format: Exclude<AiOutputFormat, "markdown" | "none"> }
  | { kind: "format_validated"; format: Exclude<AiOutputFormat, "markdown" | "none"> }
  | { kind: "markdown_complete" }
  | { kind: "source_overlap_review"; matchedSamples: number; totalSamples: number }
  | { kind: "source_echo_checked"; matchedSamples: number; totalSamples: number };

export type AiOutputContractErrorCode =
  | "literal_mismatch"
  | "output_too_large"
  | "invalid_summary_fact"
  | "invalid_grounded_action"
  | "source_echo"
  | "instruction_echo"
  | "internal_context_echo"
  | "incomplete_markdown"
  | "missing_table"
  | "missing_code_block"
  | "invalid_math"
  | "invalid_mermaid";

const MESSAGES: Record<AiOutputContractErrorCode, string> = {
  literal_mismatch: "原样插入内容与指令中的字面内容不一致，尚未修改文档。",
  output_too_large: "AI 输出超过结构校验上限，尚未修改文档。请缩小任务范围后重试。",
  invalid_summary_fact: "摘要引用的来源事实与当前文档不一致，尚未修改文档。",
  invalid_grounded_action: "行动建议必须只包含固定操作和可回溯原文，尚未修改文档。",
  source_echo: "新增内容或摘要重复了过多原文，尚未修改文档。请缩小引用范围或调整指令。",
  instruction_echo: "新增内容重复了用户指令，尚未修改文档。请直接描述要加入的内容。",
  internal_context_echo: "AI 输出泄漏了仅供理解的内部上下文标记，尚未修改文档。",
  incomplete_markdown: "AI 输出中的 Markdown 代码围栏或数学公式未闭合，尚未修改文档。",
  missing_table: "AI 输出没有形成有效的 Markdown 表格，尚未修改文档。",
  missing_code_block: "AI 输出没有形成完整的代码块，尚未修改文档。",
  invalid_math: "AI 输出没有形成完整的数学公式，尚未修改文档。",
  invalid_mermaid: "AI 输出没有形成完整且可识别的 Mermaid 图表，尚未修改文档。"
};

export class AiOutputContractError extends Error {
  constructor(readonly code: AiOutputContractErrorCode, readonly evidence?: Record<string, unknown>) {
    super(MESSAGES[code]);
    this.name = "AiOutputContractError";
  }
}

interface ParsedNode {
  name: string;
  from: number;
  to: number;
  parent: number;
}

interface ParsedMarkdown {
  source: string;
  nodes: ParsedNode[];
  children: Map<number, ParsedNode[]>;
}

interface SourceRange { from: number; to: number; }
interface ScanScore { matched: number; total: number; ratio: number; }

const MAX_DOCUMENT_BYTES = 1024 * 1024;
const markdownParser = parser.configure(GFM);
const CODE_NODES = new Set(["FencedCode", "CodeBlock", "InlineCode"]);
const INTERNAL_CONTEXT_MARKER = /(?:【相邻语境[^】]{0,40}】|标题路径[:：]|只读相邻语境[:：]|【当前分块】|【当前正文(?:段落|块)】)/gu;

function fail(code: AiOutputContractErrorCode, evidence?: Record<string, unknown>): never {
  throw new AiOutputContractError(code, evidence);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

function parseMarkdown(source: string): ParsedMarkdown {
  const normalized = normalizeLineEndings(source);
  const cursor = markdownParser.parse(normalized).cursor();
  const nodes: ParsedNode[] = [];
  const visit = (parent: number, depth = 0): void => {
    const index = nodes.length;
    nodes.push({ name: cursor.name, from: cursor.from, to: cursor.to, parent });
    if (nodes.length > 50_000 || depth > 128) fail("output_too_large");
    if (cursor.firstChild()) {
      do { visit(index, depth + 1); } while (cursor.nextSibling());
      cursor.parent();
    }
  };
  visit(-1);
  const children = new Map<number, ParsedNode[]>();
  nodes.forEach((node) => {
    if (node.parent < 0) return;
    const siblings = children.get(node.parent) ?? [];
    siblings.push(node);
    children.set(node.parent, siblings);
  });
  return { source: normalized, nodes, children };
}

function codeRanges(tree: ParsedMarkdown): SourceRange[] {
  return tree.nodes.filter(({ name }) => CODE_NODES.has(name)).map(({ from, to }) => ({ from, to }));
}

function covered(offset: number, ranges: SourceRange[], rangeIndex: { value: number }): boolean {
  while (rangeIndex.value < ranges.length && ranges[rangeIndex.value].to <= offset) rangeIndex.value += 1;
  const range = ranges[rangeIndex.value];
  return Boolean(range && offset >= range.from && offset < range.to);
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function delimiterTokens(source: string, ranges: SourceRange[], delimiter: "$$" | "$"): number[] {
  const positions: number[] = [];
  const rangeIndex = { value: 0 };
  for (let index = 0; index < source.length;) {
    if (covered(index, ranges, rangeIndex) || isEscaped(source, index)) { index += 1; continue; }
    if (delimiter === "$$") {
      if (source.startsWith("$$", index)) { positions.push(index); index += 2; }
      else index += 1;
      continue;
    }
    if (source[index] !== "$" || source[index - 1] === "$" || source[index + 1] === "$") {
      index += 1;
      continue;
    }
    positions.push(index);
    index += 1;
  }
  return positions;
}

function isCompleteMarkdown(tree: ParsedMarkdown): boolean {
  const unclosedFence = tree.nodes.some((node, index) => node.name === "FencedCode" &&
    (tree.children.get(index) ?? []).filter((child) => child.name === "CodeMark").length < 2);
  if (unclosedFence) return false;
  const display = delimiterTokens(tree.source, codeRanges(tree), "$$");
  return display.length % 2 === 0;
}

function formulaCount(tree: ParsedMarkdown): { count: number; complete: boolean } {
  const ranges = codeRanges(tree);
  const display = delimiterTokens(tree.source, ranges, "$$");
  if (display.length % 2 !== 0) return { count: 0, complete: false };
  let count = 0;
  for (let index = 0; index < display.length; index += 2) {
    if (!tree.source.slice(display[index] + 2, display[index + 1]).trim()) return { count: 0, complete: false };
    count += 1;
  }
  const inline = delimiterTokens(tree.source, ranges, "$");
  for (let index = 0; index < inline.length; index += 1) {
    const open = inline[index];
    let closeIndex = index + 1;
    while (closeIndex < inline.length && tree.source.slice(open, inline[closeIndex]).includes("\n")) closeIndex += 1;
    if (closeIndex >= inline.length) return { count, complete: false };
    if (tree.source.slice(open + 1, inline[closeIndex]).trim()) {
      count += 1;
    } else return { count, complete: false };
    index = closeIndex;
  }
  return { count, complete: true };
}

function fencedCodeNodes(tree: ParsedMarkdown): Array<{ node: ParsedNode; language: string; body: string; closed: boolean }> {
  return tree.nodes.flatMap((node, index) => {
    if (node.name !== "FencedCode") return [];
    const children = tree.children.get(index) ?? [];
    const info = children.find(({ name }) => name === "CodeInfo");
    const body = children.find(({ name }) => name === "CodeText");
    const markers = children.filter(({ name }) => name === "CodeMark");
    return [{
      node,
      language: info ? tree.source.slice(info.from, info.to).trim().toLowerCase().split(/\s+/u)[0] : "",
      body: body ? tree.source.slice(body.from, body.to) : "",
      closed: markers.length >= 2
    }];
  });
}

function tableRanges(tree: ParsedMarkdown): SourceRange[] {
  return tree.nodes.flatMap((node, index) => {
    if (node.name !== "Table") return [];
    const childNames = (tree.children.get(index) ?? []).map(({ name }) => name);
    return childNames.includes("TableHeader") && childNames.includes("TableDelimiter") && childNames.includes("TableRow")
      ? [{ from: node.from, to: node.to }]
      : [];
  });
}

function validTable(tree: ParsedMarkdown): boolean {
  return tableRanges(tree).length > 0;
}

function validCode(tree: ParsedMarkdown): boolean {
  return fencedCodeNodes(tree).some(({ body, closed }) => Boolean(body.trim() && closed));
}

function validMermaidBlock({ language, body, closed }: { language: string; body: string; closed: boolean }): boolean {
  if (language !== "mermaid" || !closed) return false;
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  if (lines.length < 2) return false;
  const header = lines[0];
  const bodyLines = lines.slice(1);
  if (/^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i.test(header)) {
    return bodyLines.some((line) => /^[\p{L}\p{N}_-]+(?:\[[^\]\n]*\]|\([^\)\n]*\)|\{[^}\n]*\})?\s*(?:<[-=]+|[-=]+>|-\.+>|--+o|--+x).*[\p{L}\p{N}_-]+/u.test(line));
  }
  if (/^sequenceDiagram\b/i.test(header)) {
    return bodyLines.some((line) => /^[\w\p{L}-]+\s*(?:--?>|--?>>|->>|-->>|-[.-]>)[\w\p{L}-]+\s*:/u.test(line));
  }
  if (/^classDiagram(?:-v2)?\b/i.test(header)) {
    return bodyLines.some((line) => /(?:<\|--|\*--|o--|-->|\.\.\.|--\|>)/u.test(line));
  }
  if (/^stateDiagram(?:-v2)?\b/i.test(header)) {
    return bodyLines.some((line) => /(?:\[\*\]|[\p{L}\p{N}_-]+)\s*--?>\s*(?:\[\*\]|[\p{L}\p{N}_-]+)/u.test(line));
  }
  if (/^erDiagram\b/i.test(header)) return bodyLines.some((line) => /\b\w+\s+(?:\|\|\|?|\}\|o?|o\{)---?(?:\|\|\|?|\}o?|o\{)\s+\w+\b/u.test(line));
  if (/^pie\b/i.test(header)) return bodyLines.some((line) => /^"[^"\n]+"\s*:\s*\d+(?:\.\d+)?/u.test(line));
  if (/^gantt\b/i.test(header)) return bodyLines.some((line) => /^(?:section\s+.+|[^:]+:\s*(?:done|active|crit|milestone|after\s+.+)?\s*,?\s*.+)/iu.test(line));
  if (/^(?:mindmap|timeline|journey|quadrantChart|xychart-beta|sankey-beta|block-beta|architecture-beta)\b/i.test(header)) return bodyLines.length >= 2;
  return false;
}

function validMermaid(tree: ParsedMarkdown): boolean {
  return fencedCodeNodes(tree).some(validMermaidBlock);
}

function formatIsValid(format: AiOutputFormat, tree: ParsedMarkdown): boolean {
  if (format === "none" || format === "markdown") return true;
  if (format === "table") return validTable(tree);
  if (format === "code") return validCode(tree);
  if (format === "mermaid") return validMermaid(tree);
  const formulas = formulaCount(tree);
  return formulas.complete && formulas.count > 0;
}

function mathRanges(tree: ParsedMarkdown): SourceRange[] {
  const code = codeRanges(tree);
  const ranges: SourceRange[] = [];
  const display = delimiterTokens(tree.source, code, "$$");
  for (let index = 0; index + 1 < display.length; index += 2) {
    ranges.push({ from: display[index], to: display[index + 1] + 2 });
  }
  const inline = delimiterTokens(tree.source, code, "$");
  for (let index = 0; index < inline.length; index += 1) {
    const open = inline[index];
    let close = index + 1;
    while (close < inline.length && tree.source.slice(open, inline[close]).includes("\n")) close += 1;
    if (close >= inline.length) break;
    ranges.push({ from: open, to: inline[close] + 1 });
    index = close;
  }
  return ranges;
}

function reusableArtifactRanges(format: AiOutputFormat, tree: ParsedMarkdown): SourceRange[] {
  if (format === "table") return tableRanges(tree);
  if (format === "math") return mathRanges(tree);
  if (format === "code") {
    return fencedCodeNodes(tree)
      .filter(({ language, body, closed }) => Boolean(language && body.trim() && closed))
      .map(({ node }) => ({ from: node.from, to: node.to }));
  }
  if (format === "mermaid") {
    return fencedCodeNodes(tree)
      .filter(validMermaidBlock)
      .map(({ node }) => ({ from: node.from, to: node.to }));
  }
  return [];
}

function maskRanges(source: string, ranges: SourceRange[]): string {
  if (!ranges.length) return source;
  const chars = source.split("");
  for (const { from, to } of ranges) {
    for (let index = from; index < to; index += 1) {
      if (chars[index] !== "\n" && chars[index] !== "\r") chars[index] = " ";
    }
  }
  return chars.join("");
}

function normalizeForEcho(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function echoScore(needle: string, candidate: string, minimum = 32): ScanScore {
  if (candidate.length < minimum) return { matched: 0, total: 0, ratio: 0 };
  const window = Math.min(48, Math.max(24, Math.floor(candidate.length / 8)));
  const step = Math.max(16, Math.floor(window / 2));
  const lastOffset = candidate.length - window;
  const total = Math.min(128, Math.floor(lastOffset / step) + 1);
  let matched = 0;
  for (let index = 0; index < total; index += 1) {
    const offset = total === 1 ? 0 : Math.floor(index * lastOffset / (total - 1));
    if (needle.includes(candidate.slice(offset, offset + window))) matched += 1;
  }
  if (!total) return { matched: 0, total: 0, ratio: 0 };
  return { matched, total, ratio: matched / total };
}

function removeAllowedFacts(candidate: string, facts: readonly string[]): string {
  let masked = candidate;
  for (const fact of facts) {
    const normalized = normalizeForEcho(fact);
    if (normalized) masked = masked.replaceAll(normalized, " ".repeat(normalized.length));
  }
  return masked;
}

function markerCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(INTERNAL_CONTEXT_MARKER)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  return counts;
}

function assertNoInternalContextLeak(source: string, raw: string): void {
  const sourceCounts = markerCounts(source);
  for (const [marker, count] of markerCounts(raw)) {
    if (count > (sourceCounts.get(marker) ?? 0)) fail("internal_context_echo");
  }
}

function validateSourceFacts(source: string, facts: readonly string[]): AiOutputEvidence[] {
  if (!facts.length) return [];
  for (const [index, fact] of facts.entries()) {
    if (!fact || !source.includes(fact)) fail("invalid_summary_fact", { factIndex: index });
  }
  return [{ kind: "source_fact_validated", count: facts.length }];
}

function checkLongEcho(mode: AiOutputMode, source: string, raw: string, instruction: string, facts: readonly string[], reviewPartial = false): AiOutputEvidence[] {
  const evidence: AiOutputEvidence[] = [];
  const sourceText = normalizeForEcho(source);
  const outputText = normalizeForEcho(raw);

  if (mode === "fragment") {
    if (sourceText.length >= 24 && outputText.includes(sourceText)) {
      fail("source_echo", { reason: "complete_source_copy" });
    }
    const score = echoScore(sourceText, outputText, 96);
    if (outputText.length >= 96 && score.total > 0 && score.ratio >= 0.72) {
      if (reviewPartial) evidence.push({ kind: "source_overlap_review", matchedSamples: score.matched, totalSamples: score.total });
      else fail("source_echo", { matchedSamples: score.matched, totalSamples: score.total });
    }
    if (outputText.length >= 40) {
      const instructionText = normalizeForEcho(instruction);
      if (instructionText.length >= 40 && (outputText.includes(instructionText) || echoScore(instructionText, outputText, 64).ratio >= 0.72)) {
        fail("instruction_echo");
      }
    }
    if (score.total > 0) evidence.push({ kind: "source_echo_checked", matchedSamples: score.matched, totalSamples: score.total });
  } else if (mode === "grounded_actions") {
    // The action contract already verifies fixed checklist templates and short citations. Only the
    // output itself can be a source echo; selecting all source facts as evidence is not a copy.
    if (sourceText.length >= 24 && (raw.includes(source.trim()) || outputText.includes(sourceText))) {
      fail("source_echo", { reason: "complete_source_copy" });
    }
  } else if (mode === "summary") {
    // An allowed fact ledger is not permission to copy the entire original paragraph/document.
    const normalizedSource = normalizeLineEndings(source).trim();
    if (sourceText.length >= 24 && raw.includes(normalizedSource)) fail("source_echo", { reason: "complete_source_copy" });
    if (sourceText.length >= 24 && outputText.includes(sourceText) && removeAllowedFacts(outputText, facts).trim().length > 0) {
      fail("source_echo", { reason: "complete_source_copy" });
    }
    if (sourceText.length >= 64) {
      const candidate = removeAllowedFacts(outputText, facts);
      const completeCopy = candidate.includes(sourceText) || sourceText.includes(candidate) && candidate.length >= sourceText.length * 0.88;
      const score = echoScore(sourceText, candidate, Math.max(96, Math.floor(sourceText.length * 0.68)));
      const nearCompleteCopy = candidate.length >= sourceText.length * 0.68 && score.total > 0 && score.ratio >= 0.82;
      if (completeCopy || nearCompleteCopy) fail("source_echo", { matchedSamples: score.matched, totalSamples: score.total });
      if (facts.length && score.total > 0) evidence.push({ kind: "source_echo_checked", matchedSamples: score.matched, totalSamples: score.total });
    }
  }
  return evidence;
}

function assertComplete(tree: ParsedMarkdown): void {
  if (!isCompleteMarkdown(tree)) fail("incomplete_markdown");
}

function assertFormat(format: AiOutputFormat, tree: ParsedMarkdown): void {
  if (formatIsValid(format, tree)) return;
  if (format === "table") fail("missing_table");
  if (format === "code") fail("missing_code_block");
  if (format === "math") fail("invalid_math");
  if (format === "mermaid") fail("invalid_mermaid");
}

/** Shape-only check for user-owned literal code; semantic echo/leak checks belong to model output. */
export function validateCodeArtifactShape(raw: string): void {
  if (byteLength(raw) > MAX_DOCUMENT_BYTES) fail("output_too_large");
  const tree = parseMarkdown(raw);
  assertComplete(tree);
  assertFormat("code", tree);
}

/** Validates task output without rewriting content; only one verified Markdown wrapper may be removed. */
export function validateTaskCandidate(input: AiOutputContractInput): { text: string; evidence: AiOutputEvidence[] } {
  if (input.mode === "literal") {
    if (input.literalSource !== undefined && input.raw !== input.literalSource) fail("literal_mismatch");
    return { text: input.raw, evidence: [{ kind: "literal_exact", codeUnits: input.raw.length }] };
  }
  if (byteLength(input.raw) > MAX_DOCUMENT_BYTES || byteLength(input.source) > MAX_DOCUMENT_BYTES) fail("output_too_large");
  assertNoInternalContextLeak(input.source, input.raw);
  const groundedActionFacts = input.mode === "grounded_actions" ? readGroundedActionFacts(input.raw, input.sourceFacts ?? []) : null;
  if (input.mode === "grounded_actions" && !groundedActionFacts) fail("invalid_grounded_action");
  const sourceFacts = input.sourceFacts ?? [];
  const factEvidence = validateSourceFacts(input.source, sourceFacts);

  let decoded: ReturnType<typeof decodeAiResponse>;
  try { decoded = decodeAiResponse(input.raw, input.format, input.displaySource); }
  catch { fail("incomplete_markdown"); }
  const text = decoded.text;
  const tree = parseMarkdown(decoded.content);
  assertComplete(tree);
  assertFormat(input.format, tree);

  const reuseRanges = hasExplicitSourceReusePermission(input.instruction) || input.allowArtifactReuseFromFacts === true && sourceFacts.length > 0
    ? reusableArtifactRanges(input.format, tree)
    : [];
  const echoContent = maskRanges(tree.source, reuseRanges);
  const echoEvidence = checkLongEcho(input.mode, input.source, echoContent, input.instruction, sourceFacts, input.reviewPartialOverlap);
  const evidence = [...factEvidence, ...echoEvidence];
  if (decoded.wrapped && input.format !== "none" && input.format !== "markdown") {
    evidence.push({ kind: input.displaySource ? "source_fence_preserved" : "outer_fence_unwrapped", format: input.format });
  }

  evidence.push({ kind: "markdown_complete" });
  if (input.format !== "none" && input.format !== "markdown") evidence.push({ kind: "format_validated", format: input.format });
  return { text, evidence };
}

/** Only explicit requested output types add a format requirement; source content is never scanned. */
export function requestedOutputFormat(instruction: string, semanticAction?: string): AiOutputFormat {
  const artifact = resolveGenerationRequirements(instruction).artifact;
  if (artifact.state === "conflict") throw new Error("本次指令包含不兼容的输出格式，请明确一种产物后发送。");
  if (artifact.state === "explicit") return artifact.value;
  return semanticAction === "diagram" ? "mermaid" : "none";
}
