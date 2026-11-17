import { GFM, parser } from "@lezer/markdown";

const MAX_MARKDOWN_BYTES = 1024 * 1024;
const MAX_AST_NODES = 50_000;
const MAX_AST_DEPTH = 128;
const MAX_CHANGES = 1_000;
const markdownParser = parser.configure(GFM);
const issuedPolicies = new WeakSet<object>();
const structuralNodes = new Set([
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2", "BulletList", "OrderedList", "ListItem", "Blockquote",
  "Paragraph", "Emphasis", "StrongEmphasis", "Strikethrough", "Link", "Image", "Task", "HorizontalRule", "HardBreak"
]);

export type MarkdownMutationKind = "fenced-code-body" | "table-cell" | "url-target" | "frontmatter-scalar" | "math-body";

export interface MarkdownMutationChange {
  from: number;
  to: number;
  matchedText: string;
  insertText: string;
}

export interface MarkdownMutationRequest {
  operation: string;
  contentMode: string;
  matchesBound: boolean;
  changes: readonly MarkdownMutationChange[];
}

interface MutationGrant extends MarkdownMutationChange {
  kind: MarkdownMutationKind;
  nodeName: string;
  nodeOrdinal: number;
  parentPath: string[];
  outputFrom: number;
  outputTo: number;
  lineIndex?: number;
  fieldKey?: string;
  delimiter?: string;
}

export interface MarkdownMutationPolicy {
  readonly source: string;
  readonly changes: readonly MutationGrant[];
}

interface AstNode { name: string; from: number; to: number; children: AstNode[]; }
interface ParsedMarkdown { root: AstNode; toSourceOffset: (offset: number) => number; }

function normalizeLineEndings(source: string): { text: string; toSourceOffset: (offset: number) => number } {
  if (!source.includes("\r")) return { text: source, toSourceOffset: (offset) => offset };
  let text = "";
  const crlfEnds: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      text += "\n";
      if (source[index + 1] === "\n") { index += 1; crlfEnds.push(text.length); }
    } else text += source[index];
  }
  return { text, toSourceOffset: (offset) => {
    let low = 0;
    let high = crlfEnds.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (crlfEnds[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return offset + low;
  } };
}

function reject(reason: string): never {
  throw new Error(`Markdown 精确修改能力校验失败（${reason}），未生成可应用的修改。`);
}

function parseMarkdown(source: string): ParsedMarkdown {
  const normalized = normalizeLineEndings(source);
  const cursor = markdownParser.parse(normalized.text).cursor();
  let count = 0;
  const read = (depth = 0): AstNode => {
    count += 1;
    if (count > MAX_AST_NODES) reject("AST 节点数超过校验上限");
    if (depth > MAX_AST_DEPTH) reject("AST 嵌套超过校验上限");
    const node: AstNode = { name: cursor.name, from: cursor.from, to: cursor.to, children: [] };
    if (cursor.firstChild()) {
      do { node.children.push(read(depth + 1)); } while (cursor.nextSibling());
      cursor.parent();
    }
    return node;
  };
  return { root: read(), toSourceOffset: normalized.toSourceOffset };
}

function walk(node: AstNode, visit: (node: AstNode, ancestors: AstNode[]) => void, ancestors: AstNode[] = []): void {
  visit(node, ancestors);
  ancestors.push(node);
  for (const child of node.children) walk(child, visit, ancestors);
  ancestors.pop();
}

function nodesNamed(root: AstNode, name: string): Array<{ node: AstNode; ancestors: AstNode[] }> {
  const found: Array<{ node: AstNode; ancestors: AstNode[] }> = [];
  walk(root, (node, ancestors) => { if (node.name === name) found.push({ node, ancestors: [...ancestors] }); });
  return found;
}

function parentPath(ancestors: AstNode[]): string[] {
  return ancestors.map((node) => node.name).filter((name) => name === "Document" || structuralNodes.has(name) || name.startsWith("Table"));
}

function nodeSourceRange(node: AstNode, toSourceOffset: (offset: number) => number): { from: number; to: number } {
  return { from: toSourceOffset(node.from), to: toSourceOffset(node.to) };
}

function safeBoundary(source: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  if (offset > 0 && offset < source.length && source[offset - 1] === "\r" && source[offset] === "\n") return false;
  if (offset > 0 && offset < source.length) {
    const before = source.charCodeAt(offset - 1);
    const after = source.charCodeAt(offset);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return false;
  }
  return true;
}

function linesInRange(source: string, from: number, to: number): Array<{ from: number; contentTo: number; to: number; text: string }> {
  const lines: Array<{ from: number; contentTo: number; to: number; text: string }> = [];
  let lineFrom = from;
  while (lineFrom <= to) {
    let contentTo = lineFrom;
    while (contentTo < to && source[contentTo] !== "\r" && source[contentTo] !== "\n") contentTo += 1;
    let lineTo = contentTo;
    if (source[lineTo] === "\r" && source[lineTo + 1] === "\n") lineTo += 2;
    else if (lineTo < to) lineTo += 1;
    lines.push({ from: lineFrom, contentTo, to: lineTo, text: source.slice(lineFrom, contentTo) });
    if (lineTo <= lineFrom || lineTo >= to) break;
    lineFrom = lineTo;
  }
  return lines;
}

function fencedCodeBody(source: string, node: AstNode, map: (offset: number) => number): { from: number; to: number } | null {
  const range = nodeSourceRange(node, map);
  const lines = linesInRange(source, range.from, range.to);
  const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]?.text ?? "");
  if (!opening || !lines[0]) return null;
  const marker = opening[1];
  const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
  const closingLine = lines.slice(1).find((line) => closing.test(line.text));
  if (!closingLine || lines[0].to === lines[0].contentTo) return null;
  return { from: lines[0].to, to: closingLine.from };
}

interface ScalarRange { from: number; to: number; lineIndex: number; fieldKey: string; }

function frontmatterScalars(source: string): ScalarRange[] {
  const lines = linesInRange(source, 0, source.length);
  if (!/^---[ \t]*$/.test(lines[0]?.text ?? "")) return [];
  const closing = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line.text));
  if (closing < 0) return [];
  const fields: ScalarRange[] = [];
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index];
    const match = /^([A-Za-z0-9_-]+:[ \t]*)(.*)$/.exec(line.text);
    if (!match) continue;
    const raw = match[2];
    const commentAt = /[ \t]+#/.exec(raw)?.index ?? raw.length;
    const value = raw.slice(0, commentAt).replace(/[ \t]+$/u, "");
    const trimmed = value.trim();
    if (!trimmed || trimmed !== value || /[\r\n\t:#\[\]{}&*!|>'"%@`]/u.test(trimmed)) continue;
    if (/^[?,:]/u.test(trimmed)) continue;
    fields.push({ from: line.from + match[1].length, to: line.from + match[1].length + value.length, lineIndex: index, fieldKey: match[1].split(":", 1)[0] });
  }
  return fields;
}

interface MathRange { from: number; to: number; delimiter: string; }

function mathRanges(source: string): MathRange[] {
  const pattern = /(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$(?!\$)[^\r\n$]+?(?<!\\)\$(?!\$)/gu;
  const ranges: MathRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const delimiter = match[0].startsWith("$$") ? "$$" : "$";
    ranges.push({ from: match.index + delimiter.length, to: match.index + match[0].length - delimiter.length, delimiter });
  }
  return ranges;
}

function lineBreakCount(value: string): number { return (value.match(/\r\n|\r|\n/gu) ?? []).length; }

function isAllowedUrlTarget(target: string): boolean {
  if (!target || /[\s\u0000-\u001f<>()[\]\\]/u.test(target)) return false;
  try {
    const parsed = new URL(target, "https://markdown-mutation.invalid/");
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target)) return ["http:", "https:", "mailto:", "tel:", "ftp:"].includes(parsed.protocol);
    return true;
  } catch { return false; }
}

function grantForChange(source: string, parsed: ParsedMarkdown, change: MarkdownMutationChange): MutationGrant | null {
  const { from, to, insertText } = change;
  const candidates: Array<{ kind: MarkdownMutationKind; nodeName: string; nodeOrdinal: number; parentPath: string[]; delimiter?: string; lineIndex?: number; fieldKey?: string }> = [];
  const fenced = nodesNamed(parsed.root, "FencedCode");
  fenced.forEach(({ node, ancestors }, index) => {
    const body = fencedCodeBody(source, node, parsed.toSourceOffset);
    if (body && from >= body.from && to <= body.to && lineBreakCount(insertText) <= lineBreakCount(change.matchedText)) {
      candidates.push({ kind: "fenced-code-body", nodeName: node.name, nodeOrdinal: index, parentPath: parentPath(ancestors) });
    }
  });
  const cells = nodesNamed(parsed.root, "TableCell");
  cells.forEach(({ node, ancestors }, index) => {
    const range = nodeSourceRange(node, parsed.toSourceOffset);
    if (from >= range.from && to <= range.to && !/[|\r\n]/u.test(insertText)) {
      candidates.push({ kind: "table-cell", nodeName: node.name, nodeOrdinal: index, parentPath: parentPath(ancestors) });
    }
  });
  const urls = nodesNamed(parsed.root, "URL");
  urls.forEach(({ node, ancestors }, index) => {
    const range = nodeSourceRange(node, parsed.toSourceOffset);
    if (from >= range.from && to <= range.to) {
      const target = source.slice(range.from, from) + insertText + source.slice(to, range.to);
      if (isAllowedUrlTarget(target)) candidates.push({ kind: "url-target", nodeName: node.name, nodeOrdinal: index, parentPath: parentPath(ancestors) });
    }
  });
  frontmatterScalars(source).forEach((field) => {
    if (from >= field.from && to <= field.to && !/[\r\n]/u.test(insertText)) {
      const value = source.slice(field.from, from) + insertText + source.slice(to, field.to);
      if (value.trim() === value && value.length > 0 && !/[\r\n\t:#\[\]{}&*!|>'"%@`]/u.test(value)) {
        candidates.push({ kind: "frontmatter-scalar", nodeName: "FrontmatterScalar", nodeOrdinal: field.lineIndex, parentPath: ["Frontmatter"], lineIndex: field.lineIndex, fieldKey: field.fieldKey });
      }
    }
  });
  mathRanges(source).forEach((range, index) => {
    if (from >= range.from && to <= range.to && !/[\r\n$]/u.test(insertText)) {
      candidates.push({ kind: "math-body", nodeName: "MathExpression", nodeOrdinal: index, parentPath: [], delimiter: range.delimiter });
    }
  });
  if (candidates.length !== 1) return null;
  return { ...change, ...candidates[0], outputFrom: from, outputTo: from + insertText.length };
}

function transformChanges(source: string, changes: readonly MutationGrant[]): string {
  let output = "";
  let cursor = 0;
  for (const change of changes) {
    output += source.slice(cursor, change.from) + change.insertText;
    cursor = change.to;
  }
  return output + source.slice(cursor);
}

function nodeShape(node: AstNode): unknown[] { return [node.name, node.children.map(nodeShape)]; }

function documentStructure(node: AstNode): unknown[] {
  const output: unknown[] = [];
  for (const child of node.children) {
    const nested = documentStructure(child);
    if (structuralNodes.has(child.name)) output.push([child.name, nested]);
    else output.push(...nested);
  }
  return output;
}

function tableTopology(root: AstNode): number[] {
  return nodesNamed(root, "Table").map(({ node }) => nodesNamed(node, "TableCell").length);
}

function getIndexedNode(parsed: ParsedMarkdown, name: string, ordinal: number): { node: AstNode; ancestors: AstNode[] } | null {
  return nodesNamed(parsed.root, name)[ordinal] ?? null;
}

function mappedOffset(offset: number, changes: readonly MutationGrant[]): number {
  return offset + changes.filter((change) => change.to <= offset).reduce((delta, change) => delta + change.insertText.length - (change.to - change.from), 0);
}

function verifyGrantIdentity(source: string, output: string, before: ParsedMarkdown, after: ParsedMarkdown, grant: MutationGrant, changes: readonly MutationGrant[]): void {
  if (grant.kind === "frontmatter-scalar") {
    const beforeField = frontmatterScalars(source).find(({ lineIndex, fieldKey }) => lineIndex === grant.lineIndex && fieldKey === grant.fieldKey);
    const afterField = frontmatterScalars(output).find(({ lineIndex, fieldKey }) => lineIndex === grant.lineIndex && fieldKey === grant.fieldKey);
    if (!beforeField || !afterField || grant.from < beforeField.from || grant.to > beforeField.to || grant.outputFrom < afterField.from || grant.outputTo > afterField.to) reject("frontmatter 字段、key 或单行标量身份发生变化");
    return;
  }
  if (grant.kind === "math-body") {
    const beforeMath = mathRanges(source)[grant.nodeOrdinal];
    const afterMath = mathRanges(output)[grant.nodeOrdinal];
    if (!beforeMath || !afterMath || beforeMath.delimiter !== grant.delimiter || afterMath.delimiter !== grant.delimiter ||
      grant.from < beforeMath.from || grant.to > beforeMath.to || grant.outputFrom < afterMath.from || grant.outputTo > afterMath.to) reject("公式边界或数学节点身份发生变化");
    return;
  }
  const original = getIndexedNode(before, grant.nodeName, grant.nodeOrdinal);
  const candidate = getIndexedNode(after, grant.nodeName, grant.nodeOrdinal);
  if (!original || !candidate || JSON.stringify(parentPath(original.ancestors)) !== JSON.stringify(parentPath(candidate.ancestors))) reject("AST 节点类型、顺序或父结构发生变化");
  const oldRange = nodeSourceRange(original.node, before.toSourceOffset);
  const newRange = nodeSourceRange(candidate.node, after.toSourceOffset);
  const expectedFrom = mappedOffset(grant.from, changes);
  const expectedTo = mappedOffset(grant.to, changes);
  if (grant.from < oldRange.from || grant.to > oldRange.to || expectedFrom < newRange.from || expectedTo > newRange.to) reject("改动离开已授权的 AST 节点内部");
  if (grant.kind === "fenced-code-body") {
    const oldBody = fencedCodeBody(source, original.node, before.toSourceOffset);
    const newBody = fencedCodeBody(output, candidate.node, after.toSourceOffset);
    if (!oldBody || !newBody || grant.from < oldBody.from || grant.to > oldBody.to || expectedFrom < newBody.from || expectedTo > newBody.to ||
      JSON.stringify(nodeShape(original.node)) !== JSON.stringify(nodeShape(candidate.node))) reject("代码围栏、语言、代码块节点结构或正文范围发生变化");
  }
  if (grant.kind === "table-cell" && (JSON.stringify(tableTopology(before.root)) !== JSON.stringify(tableTopology(after.root)) ||
    JSON.stringify(nodeShape(original.node)) !== JSON.stringify(nodeShape(candidate.node)))) reject("表格行列或单元格 AST 结构发生变化");
}

function assertComplete(source: string, root: AstNode): void {
  const fenced = nodesNamed(root, "FencedCode");
  for (const { node } of fenced) {
    if (nodesNamed(node, "CodeMark").length < 2) reject("代码围栏未闭合");
  }
  const normalized = normalizeLineEndings(source).text;
  const codeRanges = ["FencedCode", "CodeBlock", "InlineCode", "Table", "HTMLBlock", "HTMLTag"]
    .flatMap((name) => nodesNamed(root, name).map(({ node }) => ({ from: node.from, to: node.to })));
  let count = 0;
  for (const match of normalized.matchAll(/\$\$/gu)) {
    let slashes = 0;
    for (let index = match.index! - 1; index >= 0 && normalized[index] === "\\"; index -= 1) slashes += 1;
    if (slashes % 2 || codeRanges.some((range) => match.index! >= range.from && match.index! < range.to)) continue;
    count += 1;
  }
  if (count % 2) reject("块级数学公式未闭合");
}

/** Creates a capability only for previously-bound, exact literal replacement ranges. */
export function deriveMarkdownMutationPolicy(source: string, request: MarkdownMutationRequest): MarkdownMutationPolicy | null {
  if (request.operation !== "replace_exact" || request.contentMode !== "literal" || request.matchesBound !== true ||
    !Array.isArray(request.changes) || request.changes.length === 0 || request.changes.length > MAX_CHANGES ||
    new TextEncoder().encode(source).length > MAX_MARKDOWN_BYTES) return null;
  const sorted = [...request.changes].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = -1;
  for (const change of sorted) {
    if (!Number.isInteger(change.from) || !Number.isInteger(change.to) || change.from < 0 || change.to <= change.from || change.to > source.length ||
      !safeBoundary(source, change.from) || !safeBoundary(source, change.to) || source.slice(change.from, change.to) !== change.matchedText ||
      !change.matchedText || change.matchedText === change.insertText || typeof change.insertText !== "string" || change.from < previousTo) return null;
    previousTo = change.to;
  }
  try {
    const parsed = parseMarkdown(source);
    const grants: MutationGrant[] = [];
    for (const change of sorted) {
      const grant = grantForChange(source, parsed, change);
      if (!grant) return null;
      grants.push(grant);
    }
    let delta = 0;
    for (const grant of grants) {
      grant.outputFrom = grant.from + delta;
      grant.outputTo = grant.outputFrom + grant.insertText.length;
      delta += grant.insertText.length - (grant.to - grant.from);
    }
    const frozenChanges = grants.map((grant) => Object.freeze({
      ...grant,
      parentPath: Object.freeze([...grant.parentPath]) as unknown as string[]
    }));
    const policy: MarkdownMutationPolicy = Object.freeze({ source, changes: Object.freeze(frozenChanges) });
    issuedPolicies.add(policy);
    const expected = transformChanges(source, grants);
    try { validateMarkdownMutationPolicy(source, expected, policy); }
    catch (error) { issuedPolicies.delete(policy); throw error; }
    return policy;
  } catch { return null; }
}

/** Validates a full-document candidate against one exact, node-scoped literal capability. */
export function validateMarkdownMutationPolicy(source: string, output: string, policy: MarkdownMutationPolicy): void {
  if (!issuedPolicies.has(policy)) reject("MutationPolicy 不是由精确替换授权器签发");
  if (policy.source !== source) reject("策略绑定的原文与当前文档不一致");
  if (new TextEncoder().encode(source).length > MAX_MARKDOWN_BYTES || new TextEncoder().encode(output).length > MAX_MARKDOWN_BYTES) reject("文档超过 1 MiB 校验上限");
  const changes = [...policy.changes].sort((left, right) => left.from - right.from || left.to - right.to);
  if (!changes.length || changes.length > MAX_CHANGES || changes.some((change) => source.slice(change.from, change.to) !== change.matchedText)) reject("策略中的精确匹配证据无效");
  if (transformChanges(source, changes) !== output) reject("候选内容超出已绑定的精确替换范围");
  const before = parseMarkdown(source);
  const after = parseMarkdown(output);
  assertComplete(output, after.root);
  if (JSON.stringify(documentStructure(before.root)) !== JSON.stringify(documentStructure(after.root))) reject("Markdown AST 节点类型或父结构发生变化");
  for (const grant of changes) verifyGrantIdentity(source, output, before, after, grant, changes);
}
