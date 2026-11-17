import {
  chunkMarkdownForAi,
  estimateAiTokens,
  type MarkdownAiChunk,
  type MarkdownAiChunkOptions
} from "./markdownChunker";

const CONTEXT_LIMIT = 4096;
const MAX_OUTPUT_TOKENS = 2048;
const SAFETY_TOKENS = 160;
const MIN_OUTPUT_TOKENS = 384;
const CONTEXT_WINDOW_CHARS = 120;

export interface AiPlannedChunk extends MarkdownAiChunk {
  /** Exact original-source ownership, only present for unmasked plans. */
  ownedRange?: { from: number; to: number };
  contextRanges?: ReadonlyArray<{ from: number; to: number }>;
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  contextTokens: number;
  context: string;
}

export interface AiChunkPlanOptions extends Pick<MarkdownAiChunkOptions, "maxInputBytes" | "maxChunks" | "createMask"> {
  buildPrompt: (text: string, context: string, ownedRange?: { from: number; to: number }) => { prompt: string; systemPrompt: string };
  protectMarkdown: boolean;
  conservative: boolean;
  granularity?: "budget" | "paragraph";
}

export interface AiChunkPlan {
  chunks: AiPlannedChunk[];
  inputBytes: number;
  exceeded: "bytes" | "chunks" | null;
}

interface Piece { text: string; }
interface Heading { from: number; path: string; }

function cleanContext(text: string, mask: string): string {
  return text.replace(new RegExp(`${escapeRegExp(mask)}\\d+__`, "g"), "[受保护结构]").trim();
}

function markerEnd(source: string, from: number, mask: string): number {
  if (!source.startsWith(mask, from)) return -1;
  let cursor = from + mask.length;
  while (cursor < source.length && /\d/.test(source[cursor])) cursor += 1;
  return cursor > from + mask.length && source.slice(cursor, cursor + 2) === "__" ? cursor + 2 : -1;
}

function safeContextWindow(source: string, initialFrom: number, initialTo: number, mask: string): string {
  let from = initialFrom;
  let to = initialTo;
  const searchFrom = Math.max(0, from - mask.length - 16);
  const searchTo = Math.min(source.length, to + mask.length + 16);
  let markerFrom = source.indexOf(mask, searchFrom);
  while (markerFrom >= 0 && markerFrom < searchTo) {
    const markerTo = markerEnd(source, markerFrom, mask);
    if (markerTo > from && markerFrom < to && (markerFrom < from || markerTo > to)) {
      if (markerFrom < from && markerTo > to) return "[受保护结构]";
      if (markerFrom < from) from = markerTo;
      if (markerTo > to) to = markerFrom;
    }
    markerFrom = source.indexOf(mask, markerFrom + mask.length);
  }
  return to > from ? cleanContext(source.slice(from, to), mask) : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readHeadings(source: string, mask: string): Heading[] {
  const path: string[] = [];
  return [...source.matchAll(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/gm)]
    .map((match) => {
      const level = match[1].length;
      path.length = level - 1;
      let title = cleanContext(match[2].trim().slice(0, 80), mask);
      if (title.length && title.charCodeAt(title.length - 1) >= 0xd800 && title.charCodeAt(title.length - 1) <= 0xdbff) {
        title = title.slice(0, -1);
      }
      path.push(title);
      return { from: match.index ?? 0, path: path.join(" > ") };
    });
}

function headingContext(headings: Heading[], end: number): string {
  let low = 0;
  let high = headings.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (headings[middle].from <= end) low = middle + 1;
    else high = middle;
  }
  const current = headings[low - 1];
  return current ? `标题路径：${current.path}` : "";
}

function neighboringContext(source: string, headings: Heading[], from: number, to: number, mask: string): string {
  const previous = safeContextWindow(source, Math.max(0, from - CONTEXT_WINDOW_CHARS), from, mask);
  const next = safeContextWindow(source, to, Math.min(source.length, to + CONTEXT_WINDOW_CHARS), mask);
  const path = headingContext(headings, from);
  return [
    path,
    previous ? `前文语境（只读）：${previous}` : "",
    next ? `后文语境（只读）：${next}` : ""
  ].filter(Boolean).join("\n");
}

function outputReserve(promptTokens: number, replacement: boolean): number {
  if (!replacement) return Math.min(768, MAX_OUTPUT_TOKENS);
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.ceil(promptTokens * 0.8) + 192));
}

function buildPlannedChunk(
  text: string,
  index: number,
  source: string,
  headings: Heading[],
  from: number,
  to: number,
  base: MarkdownAiChunk,
  options: AiChunkPlanOptions
): AiPlannedChunk {
  const context = options.granularity === "paragraph"
    ? ""
    : neighboringContext(source, headings, from, to, base.mask);
  const built = options.buildPrompt(text, context, options.protectMarkdown ? undefined : { from, to });
  const maxTokens = outputReserve(estimateAiTokens(built.prompt), options.protectMarkdown);
  const contextTokens = estimateAiTokens(built.prompt) + estimateAiTokens(built.systemPrompt) + maxTokens + SAFETY_TOKENS;
  const sourceRanges = options.protectMarkdown ? {} : {
    ownedRange: { from, to },
    contextRanges: options.granularity === "paragraph" ? [] : [
      { from: safeCut(source, Math.max(0, from - CONTEXT_WINDOW_CHARS), base.mask), to: from },
      { from: to, to: safeCut(source, Math.min(source.length, to + CONTEXT_WINDOW_CHARS), base.mask) }
    ].filter((range) => range.from < range.to)
  };
  return { ...base, ...sourceRanges, index, text, prompt: built.prompt, systemPrompt: built.systemPrompt, maxTokens, contextTokens, context };
}

function fits(chunk: AiPlannedChunk, limit = CONTEXT_LIMIT): boolean { return chunk.contextTokens <= limit; }

function semanticPieces(source: string): Piece[] {
  const pieces: Piece[] = [];
  const lines: string[] = [];
  let lineStart = 0;
  while (lineStart < source.length) {
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== "\r" && source[lineEnd] !== "\n") lineEnd += 1;
    if (lineEnd < source.length) {
      if (source[lineEnd] === "\r" && source[lineEnd + 1] === "\n") lineEnd += 2;
      else lineEnd += 1;
    }
    lines.push(source.slice(lineStart, lineEnd));
    lineStart = lineEnd;
  }
  const blank = (line: string) => /^\s*(?:(?:\r\n)|\r|\n)?$/.test(line);
  const heading = (line: string) => /^ {0,3}#{1,6}[ \t]+/.test(line) || /^ {0,3}(?:[-*_][ \t]*){3,}(?:(?:\r\n)|\r|\n)?$/.test(line);
  const listItem = (line: string) => /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line);
  const appendTrailingBlankLines = (end: number) => {
    let next = end;
    while (next < lines.length && blank(lines[next])) next += 1;
    return next;
  };
  let index = 0;
  while (index < lines.length) {
    if (blank(lines[index])) {
      if (pieces.length) pieces[pieces.length - 1].text += lines[index];
      else pieces.push({ text: lines[index] });
      index += 1;
      continue;
    }

    const start = index;
    if (heading(lines[index]) || listItem(lines[index])) {
      const isList = listItem(lines[index]);
      index += 1;
      while (index < lines.length) {
        if (blank(lines[index])) {
          let next = index;
          while (next < lines.length && blank(lines[next])) next += 1;
          if (isList && next < lines.length && listItem(lines[next])) { index = next + 1; continue; }
          break;
        }
        if (isList ? listItem(lines[index]) || /^(?: {2,}|\t)\S/.test(lines[index]) : false) {
          index += 1;
          continue;
        }
        break;
      }
    } else {
      index += 1;
      while (index < lines.length && !blank(lines[index]) && !heading(lines[index]) && !listItem(lines[index])) index += 1;
    }
    const end = appendTrailingBlankLines(index);
    const block = lines.slice(start, end).join("");
    pieces.push({ text: block });
    index = end;
  }
  return pieces.length ? pieces : [{ text: source }];
}

interface ParagraphUnit { text: string; from: number; headingLength: number; }

/** Coalesce headings with their following body while retaining every source character. */
function paragraphUnits(source: string, pieces: Piece[]): ParagraphUnit[] {
  const units: ParagraphUnit[] = [];
  let pendingHeading = "";
  let pendingFrom = 0;
  let offset = 0;
  for (const piece of pieces) {
    if (!piece.text.trim()) {
      if (!units.length || pendingHeading) {
        if (!pendingHeading) pendingFrom = offset;
        pendingHeading += piece.text;
      } else units[units.length - 1].text += piece.text;
      offset += piece.text.length;
      continue;
    }
    const firstLine = piece.text.match(/^(?:\s*\r?\n)*([^\r\n]*(?:\r\n|\r|\n|$))/)?.[1] ?? piece.text;
    if (/^ {0,3}#{1,6}[ \t]+/.test(firstLine)) {
      if (!pendingHeading) pendingFrom = offset;
      pendingHeading += piece.text;
    } else {
      const from = pendingHeading ? pendingFrom : offset;
      const headingLength = pendingHeading.length;
      units.push({ text: pendingHeading + piece.text, from, headingLength });
      pendingHeading = "";
    }
    offset += piece.text.length;
  }
  if (pendingHeading) {
    const previous = units[units.length - 1];
    if (previous) previous.text += pendingHeading;
    else units.push({ text: pendingHeading, from: pendingFrom, headingLength: pendingHeading.length });
  }
  // Empty input is handled before this function; this fallback protects unusual parser output.
  if (!units.length && source) units.push({ text: source, from: 0, headingLength: 0 });
  return units;
}

function tokenCost(codePoint: string): number {
  const code = codePoint.codePointAt(0)!;
  if (code > 0x7f) return 1.5;
  if (/\s/.test(codePoint)) return 0.25;
  if (/[A-Za-z0-9]/.test(codePoint)) return 0.45;
  return 0.75;
}

/** Select a source-safe sentence-sized body slice without repeatedly estimating prefixes. */
function paragraphBodyCut(text: string, from: number, mask: string): number {
  const budget = 384;
  let cursor = from;
  let cost = 0;
  let preferred = 0;
  let preferredCost = 0;
  while (cursor < text.length) {
    if (text.startsWith(mask, cursor)) {
      const markerEndAt = markerEnd(text, cursor, mask);
      if (markerEndAt > cursor) {
        const markerCost = estimateAiTokens(text.slice(cursor, markerEndAt));
        if (cost + markerCost > budget && cursor > from) break;
        cost += markerCost;
        cursor = markerEndAt;
        continue;
      }
    }
    const codePoint = String.fromCodePoint(text.codePointAt(cursor)!);
    const nextCost = cost + tokenCost(codePoint);
    if (Math.ceil(nextCost) > budget && cursor > from) break;
    cost = nextCost;
    cursor += codePoint.length;
    if (/[。！？.!?\r\n]/.test(codePoint)) { preferred = cursor; preferredCost = cost; }
    else if (/\s/.test(codePoint) && !preferred) { preferred = cursor; preferredCost = cost; }
  }
  if (cursor >= text.length) return cursor;
  if (preferred > from && preferredCost >= budget * 0.65) return preferred;
  return cursor > from ? safeCut(text, cursor, mask) : safeCut(text, from + 1, mask);
}

function safeCut(text: string, at: number, mask: string): number {
  let cut = Math.min(at, text.length);
  if (cut > 0 && cut < text.length) {
    const left = text.charCodeAt(cut - 1);
    const right = text.charCodeAt(cut);
    if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) cut -= 1;
  }
  if (text[cut - 1] === "\r" && text[cut] === "\n") cut -= 1;
  const markerStart = text.lastIndexOf(mask, cut - 1);
  if (markerStart >= 0) {
    const close = text.indexOf("__", markerStart + mask.length);
    if (close >= cut) cut = markerStart;
  }
  return cut;
}

function largestFittingPrefix(
  text: string,
  index: number,
  source: string,
  headings: Heading[],
  sourceOffset: number,
  base: MarkdownAiChunk,
  options: AiChunkPlanOptions,
  contextLimit: number
): number {
  let low = 1;
  let high = text.length;
  let best = 0;
  while (low <= high) {
    const middle = safeCut(text, Math.ceil((low + high) / 2), base.mask);
    if (!middle) { low = Math.ceil((low + high) / 2) + 1; continue; }
    const chunk = buildPlannedChunk(text.slice(0, middle), index, source, headings, sourceOffset, sourceOffset + middle, base, options);
    if (fits(chunk, contextLimit)) { best = middle; low = middle + 1; }
    else high = middle - 1;
  }
  if (!best) return 0;

  // Prefer a sentence, line, or word boundary when it stays close to the budget.
  const candidate = text.slice(0, best);
  const punctuation = Math.max(candidate.lastIndexOf("。"), candidate.lastIndexOf("！"), candidate.lastIndexOf("？"), candidate.lastIndexOf("."), candidate.lastIndexOf("!"), candidate.lastIndexOf("?")) + 1;
  const line = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf("\r")) + 1;
  const space = candidate.lastIndexOf(" ") + 1;
  const preferred = Math.max(punctuation, line, space);
  return preferred >= best * 0.65 ? safeCut(text, preferred, base.mask) : best;
}

function throwFixedPromptBudget(): never {
  throw new Error("系统提示或固定指令已占满本地模型上下文预算，请缩短助手设置或技能模板后重试。");
}

/** Plans semantic Markdown requests against the actual prompt and 4k managed context ceiling. */
export function planMarkdownAiRequests(source: string, options: AiChunkPlanOptions): AiChunkPlan {
  const inputBytes = new TextEncoder().encode(source).byteLength;
  if (inputBytes > (options.maxInputBytes ?? 1_048_576)) return { chunks: [], inputBytes, exceeded: "bytes" };
  if (!source.trim()) return { chunks: [], inputBytes, exceeded: null };

  const basePlan = chunkMarkdownForAi(source, {
    maxChunkCharacters: Number.MAX_SAFE_INTEGER,
    maxInputBytes: options.maxInputBytes,
    maxChunks: Number.MAX_SAFE_INTEGER,
    createMask: options.createMask,
    protectMarkdown: options.protectMarkdown
  });
  if (basePlan.exceeded) return { chunks: [], inputBytes, exceeded: basePlan.exceeded };
  const base = basePlan.chunks[0];
  const protectedSource = basePlan.chunks.map((chunk) => chunk.text).join("");
  const headings = options.granularity === "paragraph" ? [] : readHeadings(protectedSource, base.mask);
  const contextLimit = CONTEXT_LIMIT;
  const emptyRequest = options.buildPrompt("", "");
  const fixedSystemTokens = estimateAiTokens(emptyRequest.systemPrompt);
  if (estimateAiTokens(emptyRequest.prompt) + fixedSystemTokens + MIN_OUTPUT_TOKENS + SAFETY_TOKENS > contextLimit) {
    throwFixedPromptBudget();
  }
  const pieces = semanticPieces(protectedSource);
  const planned: AiPlannedChunk[] = [];
  const maxChunks = options.maxChunks ?? 50;
  let currentParts: string[] = [];
  let currentTokenCost = 0;
  let currentFrom = 0;
  let offset = 0;

  const emit = (text: string, from: number) => {
    let remainder = text;
    let remainderOffset = from;
    while (remainder) {
      if (planned.length >= maxChunks) return false;
      const complete = buildPlannedChunk(remainder, planned.length, protectedSource, headings, remainderOffset, remainderOffset + remainder.length, base, options);
      if (fits(complete, contextLimit)) {
        planned.push(complete);
        return true;
      }
      const end = largestFittingPrefix(remainder, planned.length, protectedSource, headings, remainderOffset, base, options, contextLimit);
      if (!end) throwFixedPromptBudget();
      const selected = remainder.slice(0, end);
      planned.push(buildPlannedChunk(selected, planned.length, protectedSource, headings, remainderOffset, remainderOffset + end, base, options));
      remainder = remainder.slice(end);
      remainderOffset += end;
    }
    return true;
  };

  if (options.granularity === "paragraph") {
    for (const unit of paragraphUnits(protectedSource, pieces)) {
      const bodyStart = unit.headingLength;
      let bodyOffset = 0;
      while (bodyOffset < unit.text.length - bodyStart) {
        const remainder = unit.text.slice(bodyStart + bodyOffset);
        const cut = paragraphBodyCut(unit.text, bodyStart + bodyOffset, base.mask) - (bodyStart + bodyOffset);
        if (!cut) throwFixedPromptBudget();
        const text = (bodyOffset === 0 ? unit.text.slice(0, bodyStart) : "") + remainder.slice(0, cut);
        if (!emit(text, unit.from + (bodyOffset === 0 ? 0 : bodyStart + bodyOffset))) {
          return { chunks: [], inputBytes, exceeded: "chunks" };
        }
        bodyOffset += cut;
      }
      if (bodyStart === unit.text.length) {
        // A terminal heading has no editable body; preserve it with the preceding request where possible.
        if (planned.length) {
          const previous = planned[planned.length - 1];
          const joined = previous.text + unit.text;
          planned[planned.length - 1] = buildPlannedChunk(joined, previous.index, protectedSource, headings,
            unit.from - previous.text.length, unit.from + unit.text.length, base, options);
          if (!fits(planned[planned.length - 1], contextLimit)) throwFixedPromptBudget();
        } else if (!emit(unit.text, unit.from)) return { chunks: [], inputBytes, exceeded: "chunks" };
      }
    }
    return { chunks: planned, inputBytes, exceeded: null };
  }

  const flush = () => {
    if (!currentParts.length) return true;
    const current = currentParts.join("");
    const completed = emit(current, currentFrom);
    currentParts = [];
    currentTokenCost = 0;
    return completed;
  };

  for (const piece of pieces) {
    const from = currentParts.length ? currentFrom : offset;
    const to = offset + piece.text.length;
    const context = neighboringContext(protectedSource, headings, from, to, base.mask);
    const emptyWithContext = options.buildPrompt("", context);
    const estimatedPromptTokens = estimateAiTokens(emptyWithContext.prompt) + currentTokenCost + estimateAiTokens(piece.text) + 64;
    // System instructions are stable across chunks; only estimate their potentially large string once.
    const estimatedSystemTokens = fixedSystemTokens;
    const estimatedMaxTokens = outputReserve(estimatedPromptTokens, options.protectMarkdown);
    const fitsEstimate = estimatedPromptTokens + estimatedSystemTokens + estimatedMaxTokens + SAFETY_TOKENS <= contextLimit;
    if (fitsEstimate) {
      if (!currentParts.length) currentFrom = offset;
      currentParts.push(piece.text);
      currentTokenCost += estimateAiTokens(piece.text);
      offset += piece.text.length;
      continue;
    }

    if (!flush()) return { chunks: [], inputBytes, exceeded: "chunks" };
    if (!emit(piece.text, offset)) return { chunks: [], inputBytes, exceeded: "chunks" };
    offset += piece.text.length;
  }
  if (!flush()) return { chunks: [], inputBytes, exceeded: "chunks" };

  if (planned.length > maxChunks) return { chunks: [], inputBytes, exceeded: "chunks" };
  return { chunks: planned, inputBytes, exceeded: null };
}
