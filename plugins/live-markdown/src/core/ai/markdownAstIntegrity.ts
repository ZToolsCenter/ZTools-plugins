import { GFM, parser } from "@lezer/markdown";
import { validateMarkdownMutationPolicy, type MarkdownMutationPolicy } from "./markdownMutationPolicy";
import { MARKDOWN_AST_RESOURCE_BUDGET, markdownAstByteLength } from "./markdownAstResourceBudget";

const MAX_MARKDOWN_BYTES = MARKDOWN_AST_RESOURCE_BUDGET.maxDocumentBytes;
const MAX_AST_NODES = MARKDOWN_AST_RESOURCE_BUDGET.maxNodes;
const MAX_AST_DEPTH = MARKDOWN_AST_RESOURCE_BUDGET.maxDepth;
const markdownParser = parser.configure(GFM);
const protectedNodes = new Set(["FencedCode", "CodeBlock", "InlineCode", "Table", "LinkReference", "HTMLBlock", "HTMLTag"]);
const structuralNodes = new Set([
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2", "BulletList", "OrderedList", "ListItem", "Blockquote",
  "Paragraph", "Emphasis", "StrongEmphasis", "Strikethrough", "Link", "Image", "Task", "HorizontalRule", "HardBreak"
]);

interface AstNode {
  name: string;
  from: number;
  to: number;
  children: AstNode[];
}

function normalizeLineEndings(source: string): { text: string; toSourceOffset: (offset: number) => number } {
  if (!source.includes("\r")) return { text: source, toSourceOffset: (offset) => offset };
  let text = "";
  const crlfEnds: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r") {
      text += "\n";
      if (source[index + 1] === "\n") {
        index += 1;
        crlfEnds.push(text.length);
      }
    } else text += source[index];
  }
  const toSourceOffset = (offset: number) => {
    let low = 0;
    let high = crlfEnds.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (crlfEnds[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return offset + low;
  };
  return { text, toSourceOffset };
}

function parseTree(source: string): AstNode {
  const cursor = markdownParser.parse(normalizeLineEndings(source).text).cursor();
  let nodeCount = 0;
  const read = (depth = 0): AstNode => {
    nodeCount += 1;
    if (nodeCount > MAX_AST_NODES) reject("Markdown AST 节点数超过校验上限");
    if (depth > MAX_AST_DEPTH) reject("Markdown AST 嵌套超过校验上限");
    const node: AstNode = { name: cursor.name, from: cursor.from, to: cursor.to, children: [] };
    if (cursor.firstChild()) {
      do { node.children.push(read(depth + 1)); } while (cursor.nextSibling());
      cursor.parent();
    }
    return node;
  };
  return read();
}

function byteLength(text: string): number {
  return markdownAstByteLength(text);
}

function frontMatter(source: string): string | null {
  const opening = /^---[ \t]*(?:\r\n|\r|\n)/.exec(source);
  if (!opening) return null;
  let lineStart = opening[0].length;
  while (lineStart <= source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== "\r" && source[lineEnd] !== "\n") lineEnd += 1;
    if (/^---[ \t]*$/.test(source.slice(lineStart, lineEnd))) {
      let end = lineEnd;
      if (source[end] === "\r" && source[end + 1] === "\n") end += 2;
      else if (end < source.length) end += 1;
      return source.slice(0, end);
    }
    if (lineEnd === source.length) break;
    lineStart = source[lineEnd] === "\r" && source[lineEnd + 1] === "\n" ? lineEnd + 2 : lineEnd + 1;
  }
  return source;
}

function hasUnclosedFrontMatter(source: string): boolean {
  const opening = /^---[ \t]*(?:\r\n|\r|\n)/.exec(source);
  if (!opening) return false;
  let lineStart = opening[0].length;
  while (lineStart <= source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== "\r" && source[lineEnd] !== "\n") lineEnd += 1;
    if (/^---[ \t]*$/.test(source.slice(lineStart, lineEnd))) return false;
    if (lineEnd === source.length) return true;
    lineStart = source[lineEnd] === "\r" && source[lineEnd + 1] === "\n" ? lineEnd + 2 : lineEnd + 1;
  }
  return true;
}

function walk(node: AstNode, visit: (node: AstNode, ancestors: AstNode[]) => void, ancestors: AstNode[] = []): void {
  visit(node, ancestors);
  ancestors.push(node);
  for (const child of node.children) walk(child, visit, ancestors);
  ancestors.pop();
}

function semanticNodeName(name: string): string {
  return name.replace(/^(?:ATX|Setext)Heading([1-6])$/, "Heading$1");
}

function structure(node: AstNode, allowInlineStyleChanges = false): unknown[] {
  const result: unknown[] = [];
  for (const child of node.children) {
    const nested = structure(child, allowInlineStyleChanges);
    if (structuralNodes.has(child.name) && !(allowInlineStyleChanges && /^(?:Emphasis|StrongEmphasis)$/.test(child.name))) result.push([semanticNodeName(child.name), nested]);
    else result.push(...nested);
  }
  return result;
}

function relevantParentPath(ancestors: AstNode[], allowInlineStyleChanges = false): string[] {
  return ancestors.map((node) => node.name).filter((name) => structuralNodes.has(name) &&
    !(allowInlineStyleChanges && /^(?:Emphasis|StrongEmphasis)$/.test(name))).map(semanticNodeName);
}

function namedNodes(root: AstNode, pattern: RegExp): AstNode[] {
  const found: AstNode[] = [];
  walk(root, (node) => { if (pattern.test(node.name)) found.push(node); });
  return found;
}

function listTopology(root: AstNode, source: string): string[] {
  // Delimiters (-/+/* and ./)) are presentation; item numbers and nesting are data.
  const markerValue = (marker?: AstNode) => marker ? source.slice(marker.from, marker.to).match(/^\d+/)?.[0] ?? "bullet" : "missing";
  return namedNodes(root, /^(?:BulletList|OrderedList)$/).map((list) => {
    const items = list.children.filter((child) => child.name === "ListItem");
    const descendants = (item: AstNode): string[] => item.children
      .filter((child) => child.name === "BulletList" || child.name === "OrderedList")
      .map((child) => `${child.name}[${child.children.filter((part) => part.name === "ListItem").map((part) => {
        const marker = part.children.find((nested) => nested.name === "ListMark");
        const markText = markerValue(marker);
        return `${markText}{${descendants(part).join("/")}}`;
      }).join(",")}]`);
    const itemShape = items.map((item) => {
      const marker = item.children.find((child) => child.name === "ListMark");
      const markText = markerValue(marker);
      return `${markText}{${descendants(item).join("/")}}`;
    });
    return `${list.name}[${itemShape.join(";")}]`;
  });
}

function taskStates(root: AstNode, source: string): string[] {
  return namedNodes(root, /^Task$/).map((task) => source.slice(task.from, task.to).match(/\[([ xX])\]/)?.[1].toLowerCase() ?? "?");
}

interface ProtectedAstRecord { from: number; value: string; }

function protectedAstNodes(root: AstNode, source: string, toSourceOffset: (offset: number) => number, allowInlineStyleChanges = false): ProtectedAstRecord[] {
  const records: ProtectedAstRecord[] = [];
  walk(root, (node, ancestors) => {
    if (!protectedNodes.has(node.name) && node.name !== "URL" && node.name !== "LinkTitle") return;
    records.push({ from: node.from, value: JSON.stringify([
        node.name,
        source.slice(toSourceOffset(node.from), toSourceOffset(node.to)),
        relevantParentPath(ancestors, allowInlineStyleChanges)
      ]) });
  });
  return records;
}

function codeRanges(root: AstNode): Array<{ from: number; to: number }> {
  return namedNodes(root, /^(?:FencedCode|CodeBlock|InlineCode|Table|HTMLBlock|HTMLTag)$/).map(({ from, to }) => ({ from, to }));
}

function isInRanges(offset: number, ranges: Array<{ from: number; to: number }>): boolean {
  return ranges.some((range) => offset >= range.from && offset < range.to);
}

function assertCompleteMarkdown(source: string, label = "模型输出", parsedRoot = parseTree(source)): void {
  const normalized = normalizeLineEndings(source);
  const root = parsedRoot;
  const fenced = namedNodes(root, /^FencedCode$/);
  if (fenced.some((node) => namedNodes(node, /^CodeMark$/).length < 2)) {
    throw new Error(`${label}在代码块中途结束，结果不可应用，请修改指令或缩小范围。`);
  }

  const ranges = codeRanges(root);
  let delimiters = 0;
  const tokens = /\$\$/g;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(normalized.text))) {
    let slashes = 0;
    for (let index = token.index - 1; index >= 0 && normalized.text[index] === "\\"; index -= 1) slashes += 1;
    if (slashes % 2 === 1 || isInRanges(token.index, ranges)) continue;
    delimiters += 1;
  }
  if (delimiters % 2 !== 0) {
    throw new Error(`${label}在数学公式块中途结束，结果不可应用，请修改指令或缩小范围。`);
  }
}

function projectThrough(node: AstNode, end: number): AstNode {
  return {
    ...node,
    to: Math.min(node.to, end),
    children: node.children.filter((child) => child.from < end).map((child) => projectThrough(child, end))
  };
}

function footnoteTokens(source: string): string[] {
  return source.match(/\[\^[^\]\r\n]+\]/g) ?? [];
}

function isOrderedSubsequence<T>(expected: T[], received: T[]): boolean {
  let index = 0;
  for (const value of received) {
    if (value === expected[index]) index += 1;
  }
  return index === expected.length;
}

function mathExpressions(source: string): string[] {
  return source.match(/(?<!\\)\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)[^\r\n$]+(?<!\\)\$(?!\$)|(?<!\\)\\\([\s\S]*?\\\)|(?<!\\)\\\[[\s\S]*?\\\]/g) ?? [];
}

function reject(reason: string): never {
  throw new Error(`AI 输出未通过 Markdown AST 结构校验（${reason}），未生成可应用的修改。`);
}

/**
 * Compares Markdown syntax topology while allowing prose and heading wording to change.
 * Protected literal structures remain byte-for-byte stable in conservative and custom edits.
 */
export function validateMarkdownAstIntegrity(source: string, output: string, conservative: boolean, policy?: MarkdownMutationPolicy,
  options: { allowInlineStyleChanges?: boolean } = {}): { inlineStyleChanged: boolean } {
  let inlineStyleChanged = false;
  if (byteLength(source) > MAX_MARKDOWN_BYTES || byteLength(output) > MAX_MARKDOWN_BYTES) {
    reject("文档超过 1 MiB 校验上限");
  }
  if (policy) {
    validateMarkdownMutationPolicy(source, output, policy);
    return { inlineStyleChanged };
  }

  const before = parseTree(source);
  const after = parseTree(output);
  assertCompleteMarkdown(output, "模型输出", after);
  const sourceOffsets = normalizeLineEndings(source);
  const outputOffsets = normalizeLineEndings(output);
  const beforeMeta = frontMatter(source);
  const afterMeta = frontMatter(output);
  if (beforeMeta === null ? afterMeta !== null : afterMeta === null ||
    normalizeLineEndings(beforeMeta).text !== normalizeLineEndings(afterMeta).text) {
    reject("文档头部 frontmatter 被修改或遗漏");
  }

  const beforeProtected = protectedAstNodes(before, source, sourceOffsets.toSourceOffset, options.allowInlineStyleChanges);
  const afterProtected = protectedAstNodes(after, output, outputOffsets.toSourceOffset, options.allowInlineStyleChanges);
  if (!isOrderedSubsequence(beforeProtected.map(({ value }) => value), afterProtected.map(({ value }) => value))) {
    reject("代码、表格、HTML、链接目标或其所在结构被修改");
  }
  if (conservative && JSON.stringify(beforeProtected.map(({ value }) => value)) !==
    JSON.stringify(afterProtected.map(({ value }) => value))) {
    reject("保守修改新增、删除或重排了受保护的代码、表格、HTML 或链接目标");
  }
  if (!isOrderedSubsequence(footnoteTokens(source), footnoteTokens(output))) {
    reject("脚注标记被修改或遗漏");
  }
  if (!isOrderedSubsequence(mathExpressions(source), mathExpressions(output))) {
    reject("数学公式被修改或遗漏");
  }
  if (conservative) {
    const beforeHeadings = namedNodes(before, /^(?:ATXHeading[1-6]|SetextHeading[12])$/);
    const afterHeadings = namedNodes(after, /^(?:ATXHeading[1-6]|SetextHeading[12])$/);
    if (afterHeadings.length > beforeHeadings.length) {
      throw new Error("AI 输出新增了原文没有的标题，未生成可应用的修改。");
    }
    if (JSON.stringify(beforeHeadings.map((node) => semanticNodeName(node.name))) !== JSON.stringify(afterHeadings.map((node) => semanticNodeName(node.name)))) {
      reject("标题层级或顺序发生变化");
    }
    const beforeLists = listTopology(before, normalizeLineEndings(source).text);
    const afterLists = listTopology(after, normalizeLineEndings(output).text);
    if (JSON.stringify(beforeLists) !== JSON.stringify(afterLists)) {
      throw new Error("AI 输出似乎遗漏了原文列表结构，未生成可应用的修改。");
    }
    if (!isOrderedSubsequence(taskStates(before, normalizeLineEndings(source).text), taskStates(after, normalizeLineEndings(output).text))) {
      throw new Error("AI 输出改动了任务清单的完成状态，未生成可应用的修改。");
    }
    if (namedNodes(after, /^Blockquote$/).length !== namedNodes(before, /^Blockquote$/).length) {
      reject("引用层级或顺序发生变化");
    }
    if (namedNodes(after, /^Paragraph$/).length < namedNodes(before, /^Paragraph$/).length) {
      throw new Error("AI 输出似乎遗漏了原文段落，未生成可应用的修改。");
    }
    if (JSON.stringify(structure(before)) !== JSON.stringify(structure(after))) {
      if (!options.allowInlineStyleChanges || JSON.stringify(structure(before, true)) !== JSON.stringify(structure(after, true))) {
        reject("段落、引用或行内格式语义发生变化");
      }
      inlineStyleChanged = true;
    }
  }
  return { inlineStyleChanged };
}

/** Rejects appended text that closes or changes source structure, or leaves new fences/math open. */
export function validateMarkdownAppendIntegrity(source: string, appendedText: string): void {
  if (byteLength(source) + byteLength(appendedText) > MAX_MARKDOWN_BYTES) {
    reject("文档超过 1 MiB 校验上限");
  }
  if (hasUnclosedFrontMatter(source)) reject("原文末尾仍在未闭合 frontmatter 中，追加内容会被当作文档头部数据");
  assertCompleteMarkdown(source, "原文末尾");
  assertCompleteMarkdown(appendedText, "追加内容");

  const combined = `${source}${appendedText}`;
  const before = parseTree(source);
  const after = parseTree(combined);
  const sourceBoundary = normalizeLineEndings(source).text.length;
  let appendedNodeInheritedParent = false;
  walk(after, (node, ancestors) => {
    if (node.from < sourceBoundary) return;
    if (ancestors.some((ancestor) => ancestor.from < sourceBoundary &&
      (ancestor.name === "ListItem" || ancestor.name === "BulletList" || ancestor.name === "OrderedList" || ancestor.name === "Blockquote"))) {
      appendedNodeInheritedParent = true;
    }
  });
  if (appendedNodeInheritedParent) reject("追加内容进入了原文末尾的列表或引用结构");
  if (JSON.stringify(structure(before)) !== JSON.stringify(structure(projectThrough(after, sourceBoundary)))) {
    reject("追加内容与原文末尾的 Markdown 结构发生合并");
  }

  const beforeProtected = protectedAstNodes(before, source, normalizeLineEndings(source).toSourceOffset).map(({ value }) => value);
  const afterProtected = protectedAstNodes(after, combined, normalizeLineEndings(combined).toSourceOffset)
    .filter(({ from }) => from < sourceBoundary)
    .map(({ value }) => value);
  if (JSON.stringify(beforeProtected) !== JSON.stringify(afterProtected)) reject("原文中的受保护结构被追加内容改变");
  assertCompleteMarkdown(combined, "追加后的文档", after);
}

/** AST-backed completeness check for a standalone generated fragment. */
export function validateMarkdownFragmentCompleteness(text: string): void {
  if (byteLength(text) > MAX_MARKDOWN_BYTES) reject("文档超过 1 MiB 校验上限");
  assertCompleteMarkdown(text);
}
