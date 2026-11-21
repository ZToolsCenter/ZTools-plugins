import { parser, GFM } from "@lezer/markdown";

export interface MarkdownAiChunk {
  index: number;
  text: string;
  mask: string;
  protectedValues: string[];
}

export interface MarkdownAiChunkResult {
  chunks: MarkdownAiChunk[];
  inputBytes: number;
  exceeded: "bytes" | "chunks" | null;
}

export interface MarkdownAiChunkOptions {
  maxChunkCharacters?: number;
  maxInputBytes?: number;
  maxChunks?: number;
  createMask?: () => string;
  protectMarkdown?: boolean;
}

interface SourceRange { from: number; to: number; }

const markdownParser = parser.configure(GFM);
const protectedNodeNames = new Set(["FencedCode", "CodeBlock", "Table", "LinkReference"]);

function collectParsedRanges(source: string): SourceRange[] {
  // Lezer's GFM table parser recognizes LF-delimited rows, but not CRLF/CR.
  // Parse a line-ending-compatible view and map ranges back to original offsets;
  // the original source is always used for masking and restoration.
  const normalized = normalizeLineEndingsForParser(source);
  const ranges: SourceRange[] = [];
  const cursor = markdownParser.parse(normalized.text).cursor();
  const walk = () => {
    if (protectedNodeNames.has(cursor.name) || cursor.name === "InlineCode" ||
      cursor.name === "URL" || cursor.name === "LinkTitle" || cursor.name === "LinkLabel") {
      if (cursor.to > cursor.from) {
        ranges.push({ from: normalized.toSourceOffset(cursor.from), to: normalized.toSourceOffset(cursor.to) });
      }
      if (protectedNodeNames.has(cursor.name) || cursor.name === "InlineCode" || cursor.name === "LinkReference") return;
    }
    if (cursor.firstChild()) {
      do { walk(); } while (cursor.nextSibling());
      cursor.parent();
    }
  };
  walk();
  return ranges;
}

function normalizeLineEndingsForParser(source: string): {
  text: string;
  toSourceOffset: (offset: number) => number;
} {
  if (!source.includes("\r")) return { text: source, toSourceOffset: (offset) => offset };
  let text = "";
  const crlfEnds: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\r") {
      text += "\n";
      if (source[index + 1] === "\n") {
        index += 1;
        crlfEnds.push(text.length);
      }
    } else text += character;
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

function collectFrontMatterRange(source: string): SourceRange[] {
  const opening = /^---[ \t]*(?:\r\n|\r|\n)/.exec(source);
  if (!opening) return [];
  let from = opening[0].length;
  while (from < source.length) {
    let contentTo = from;
    while (contentTo < source.length && source[contentTo] !== "\r" && source[contentTo] !== "\n") contentTo += 1;
    if (/^---[ \t]*$/.test(source.slice(from, contentTo))) {
      let to = contentTo;
      if (source[to] === "\r" && source[to + 1] === "\n") to += 2;
      else if (to < source.length) to += 1;
      return [{ from: 0, to }];
    }
    if (source[contentTo] === "\r" && source[contentTo + 1] === "\n") from = contentTo + 2;
    else from = contentTo < source.length ? contentTo + 1 : source.length;
  }
  return [{ from: 0, to: source.length }];
}

interface SourceLineRange { from: number; contentTo: number; to: number; }

function sourceLineRanges(source: string): SourceLineRange[] {
  const lines: SourceLineRange[] = [];
  let from = 0;
  while (from < source.length) {
    let contentTo = from;
    while (contentTo < source.length && source[contentTo] !== "\r" && source[contentTo] !== "\n") contentTo += 1;
    let to = contentTo;
    if (to < source.length) {
      if (source[to] === "\r" && source[to + 1] === "\n") to += 2;
      else to += 1;
    }
    lines.push({ from, contentTo, to });
    from = to;
  }
  return lines;
}

function collectMathRanges(source: string, ignoredRanges: SourceRange[] = []): SourceRange[] {
  const ranges: SourceRange[] = [];
  let openDisplay: number | null = null;
  for (const line of sourceLineRanges(source)) {
    if (isOffsetCovered(line.from, ignoredRanges)) continue;
    const body = source.slice(line.from, line.contentTo);
    const sameLineDisplay = /\$\$[^\n]*?\$\$/g;
    let displayMatch: RegExpExecArray | null;
    while ((displayMatch = sameLineDisplay.exec(body))) {
      ranges.push({ from: line.from + displayMatch.index, to: line.from + displayMatch.index + displayMatch[0].length });
    }
    if (/^ {0,3}\$\$[^$]*$/.test(body)) {
      if (openDisplay === null) openDisplay = line.from;
      else {
        ranges.push({ from: openDisplay, to: line.to });
        openDisplay = null;
      }
    } else if (openDisplay === null) {
      const inline = /(^|[^\\])\$([^\n$]+?)\$(?!\$)/g;
      let match: RegExpExecArray | null;
      while ((match = inline.exec(body))) {
        const start = line.from + match.index + match[1].length;
        ranges.push({ from: start, to: start + match[0].length - match[1].length });
      }
    }
  }
  if (openDisplay !== null) ranges.push({ from: openDisplay, to: source.length });
  return ranges;
}

function isOffsetCovered(offset: number, ranges: SourceRange[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (offset < ranges[middle].from) high = middle - 1;
    else if (offset >= ranges[middle].to) low = middle + 1;
    else return true;
  }
  return false;
}

function collectUnclosedInlineCodeRanges(source: string, parsedRanges: SourceRange[]): SourceRange[] {
  const ranges: SourceRange[] = [];
  const tokens = /(`+)/g;
  let token: RegExpExecArray | null;
  while ((token = tokens.exec(source))) {
    const start = token.index;
    if (isOffsetCovered(start, parsedRanges) || isOffsetCovered(start, ranges)) continue;
    const delimiter = "`".repeat(token[0].length);
    let openingSlashes = 0;
    for (let index = start - 1; index >= 0 && source[index] === "\\"; index -= 1) openingSlashes += 1;
    if (openingSlashes % 2 === 1) continue;
    const close = new RegExp(`(?<!\\x60)${delimiter}(?!\\x60)`, "g");
    close.lastIndex = start + delimiter.length;
    let match: RegExpExecArray | null;
    let hasClosingDelimiter = false;
    while ((match = close.exec(source))) {
      let slashes = 0;
      for (let index = match.index - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
      if (slashes % 2 === 0) { hasClosingDelimiter = true; break; }
    }
    if (hasClosingDelimiter) continue;
    const previousLf = source.lastIndexOf("\n", start - 1);
    const previousCr = source.lastIndexOf("\r", start - 1);
    const nextLf = source.indexOf("\n", start);
    const nextCr = source.indexOf("\r", start);
    const lineStart = Math.max(previousLf, previousCr) + 1;
    const lineEnd = nextLf < 0 ? nextCr : nextCr < 0 ? nextLf : Math.min(nextLf, nextCr);
    const from = Math.max(lineStart, start);
    ranges.push({ from, to: lineEnd < 0 ? source.length : lineEnd });
  }
  return ranges;
}

function collectFootnoteRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const footnotes = /\[\^[^\]\r\n]+\]/g;
  let match: RegExpExecArray | null;
  while ((match = footnotes.exec(source))) ranges.push({ from: match.index, to: match.index + match[0].length });
  return ranges;
}

function mergeRanges(ranges: SourceRange[]): SourceRange[] {
  const ordered = ranges.filter((range) => range.to > range.from).sort((a, b) => a.from - b.from || b.to - a.to);
  const merged: SourceRange[] = [];
  for (const range of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from >= previous.to) merged.push({ ...range });
    else previous.to = Math.max(previous.to, range.to);
  }
  return merged;
}

function defaultMask(): string {
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)), (part) => part.toString(36)).join("")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `LOCAL_AI_${random}_`;
}

function protectMarkdown(text: string, mask: string): { text: string; values: string[] } {
  const values: string[] = [];
  const parsedRanges = collectParsedRanges(text);
  const frontMatterRanges = collectFrontMatterRange(text);
  const ignoredRanges = mergeRanges([...parsedRanges, ...frontMatterRanges]);
  const ranges = mergeRanges([
    ...ignoredRanges,
    ...collectMathRanges(text, ignoredRanges),
    ...collectFootnoteRanges(text),
    ...collectUnclosedInlineCodeRanges(text, ignoredRanges)
  ]);
  let cursor = 0;
  let protectedText = "";
  for (const range of ranges) {
    protectedText += text.slice(cursor, range.from);
    values.push(text.slice(range.from, range.to));
    protectedText += `${mask}${values.length - 1}__`;
    cursor = range.to;
  }
  protectedText += text.slice(cursor);
  return { text: protectedText, values };
}

function splitAtParagraphs(text: string, maxCharacters: number, mask: string): string[] {
  const paragraphs = text.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [text];
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  const appendBounded = (paragraph: string) => {
    if (paragraph.length <= maxCharacters) {
      current += paragraph;
      return;
    }

    flush();
    let offset = 0;
    while (offset < paragraph.length) {
      let end = Math.min(offset + maxCharacters, paragraph.length);
      if (end < paragraph.length) {
        const nextSpace = paragraph.lastIndexOf(" ", end);
        const nextSentence = Math.max(
          paragraph.lastIndexOf("。", end),
          paragraph.lastIndexOf("！", end),
          paragraph.lastIndexOf("？", end),
          paragraph.lastIndexOf(".", end)
        ) + 1;
        const candidate = Math.max(nextSpace, nextSentence);
        if (candidate > offset + Math.floor(maxCharacters * 0.6)) end = candidate;
      }
      if (end < paragraph.length && paragraph.charCodeAt(end - 1) >= 0xd800 && paragraph.charCodeAt(end - 1) <= 0xdbff &&
        paragraph.charCodeAt(end) >= 0xdc00 && paragraph.charCodeAt(end) <= 0xdfff) {
        if (end > offset + 1) end -= 1;
        else end += 1;
      }
      const markerStart = paragraph.lastIndexOf(mask, end - 1);
      if (markerStart >= offset) {
        const digitsStart = markerStart + mask.length;
        let tokenEnd = digitsStart;
        while (tokenEnd < paragraph.length && /\d/.test(paragraph[tokenEnd])) tokenEnd += 1;
        if (tokenEnd > digitsStart && paragraph.slice(tokenEnd, tokenEnd + 2) === "__" && end > markerStart && end < tokenEnd + 2) {
          end = markerStart > offset ? markerStart : tokenEnd + 2;
        }
      }
      chunks.push(paragraph.slice(offset, end));
      offset = end;
    }
  };

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      if (current.length + paragraph.length > maxCharacters) flush();
      current += paragraph;
      continue;
    }
    if (current && current.length + paragraph.length > maxCharacters) flush();
    appendBounded(paragraph);
  }
  flush();
  return chunks;
}

function restoreProtected(text: string, mask: string, values: string[]): string {
  const escapedMask = mask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`${escapedMask}(\\d+)__`, "g");
  const parts: string[] = [];
  let cursor = 0;
  let expectedIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    const index = Number(match[1]);
    if (index !== expectedIndex || index >= values.length) {
      throw new Error("AI 输出修改了受保护的 Markdown 结构，请缩小范围后重试。");
    }
    let before = text.slice(cursor, match.index);
    let next = marker.lastIndex;
    const leadingTicks = before.match(/`+$/)?.[0];
    const trailingTicks = text.slice(next).match(/^`+/)?.[0];
    if (leadingTicks && leadingTicks === trailingTicks) {
      before = before.slice(0, -leadingTicks.length);
      next += trailingTicks.length;
    }
    parts.push(before, values[index]);
    cursor = next;
    expectedIndex += 1;
  }
  if (expectedIndex !== values.length) {
    throw new Error("AI 输出修改了受保护的 Markdown 结构，请缩小范围后重试。");
  }
  parts.push(text.slice(cursor));
  const restored = parts.join("");
  if (restored.includes(mask)) {
    throw new Error("AI 输出包含无效的受保护区域标记，请重试。");
  }
  return restored;
}

/** Splits a full Markdown buffer into bounded, ordered requests without sending protected syntax. */
export function chunkMarkdownForAi(
  source: string,
  options: MarkdownAiChunkOptions = {}
): MarkdownAiChunkResult {
  const maxChunkCharacters = options.maxChunkCharacters ?? 2400;
  const maxInputBytes = options.maxInputBytes ?? 1_048_576;
  const maxChunks = options.maxChunks ?? 50;
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(source).byteLength;
  if (inputBytes > maxInputBytes) return { chunks: [], inputBytes, exceeded: "bytes" };
  if (!source.trim()) return { chunks: [], inputBytes, exceeded: null };

  const mask = options.createMask?.() ?? defaultMask();
  const protectedSource = options.protectMarkdown === false
    ? { text: source, values: [] }
    : protectMarkdown(source, mask);
  const pieces = splitAtParagraphs(protectedSource.text, maxChunkCharacters, mask);
  if (pieces.length > maxChunks) return { chunks: [], inputBytes, exceeded: "chunks" };

  const chunks = pieces.map((text, index) => ({
    index,
    text,
    mask,
    protectedValues: protectedSource.values
  }));
  return { chunks, inputBytes, exceeded: null };
}

/** Restores protected source only after every unique placeholder survives exactly once. */
export function restoreMarkdownAfterAi(
  text: string,
  chunks: MarkdownAiChunk[]
): string {
  if (chunks.length === 0) return text;
  const first = chunks[0];
  return restoreProtected(text, first.mask, first.protectedValues);
}

/** Display complete original values, never the internal markers or an unfinished marker. */
export function previewMarkdownAiStream(text: string, chunk?: MarkdownAiChunk): string {
  if (!chunk?.protectedValues.length) return text;
  const escaped = chunk.mask.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let preview = text.replace(new RegExp(`${escaped}(\\d+)__`, "g"), (_token, index: string) => chunk.protectedValues[Number(index)] ?? "…");
  const pending = preview.indexOf(chunk.mask);
  if (pending >= 0) return preview.slice(0, pending) + "…";
  for (let length = Math.min(chunk.mask.length - 1, preview.length); length > 0; length--) {
    if (preview.endsWith(chunk.mask.slice(0, length))) return preview.slice(0, -length) + "…";
  }
  return preview;
}

/** A model often drops trailing newlines. Preserve the original chunk boundaries. */
export function combineMarkdownAiChunks(outputs: string[], chunks: MarkdownAiChunk[]): string {
  if (outputs.length !== chunks.length) throw new Error("内容分段未全部完成，无法合并修改。");
  return outputs.map((output, index) => {
    const source = chunks[index].text;
    const leading = source.match(/^\s*/)?.[0] ?? "";
    const trailing = source.slice(leading.length).match(/\s*$/)?.[0] ?? "";
    if (leading.length + trailing.length >= source.length) return source;
    return leading + output.trim() + trailing;
  }).join("");
}

export function estimateAiTokens(text: string): number {
  // Deliberately conservative heuristic, not a model tokenizer. Avoid Array.from's
  // per-code-point allocation for large documents on the editor's main thread.
  let estimate = 0;
  for (const char of text) {
    if (char.codePointAt(0)! > 0x7f) estimate += 1.5;
    else if (/\s/.test(char)) estimate += 0.25;
    else if (/[A-Za-z0-9]/.test(char)) estimate += 0.45;
    else estimate += 0.75;
  }
  return Math.ceil(estimate);
}
