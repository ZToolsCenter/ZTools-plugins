import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { extractTextFromContent } from "@/components/editor/utils/content-text-extractor";

export type AiBlockScopeKind = "full_page" | "range";

export interface AiBlockScopeRange {
  kind: "range";
  startBlockId: string;
  endBlockId: string;
  rangeLabel: string;
  blockCount: number;
}

export type AiBlockScope =
  | { kind: "full_page" }
  | AiBlockScopeRange;

const CHINESE_NUMBER_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const FULL_PAGE_HINT_RE =
  /(整篇|整页|整个文档|全文|这页|这篇笔记|整理这篇|全部内容|整体)/;

const LEADING_N_RE =
  /(前面|开头|开始|最前面|顶部)\s*(\d+|[一二两三四五六七八九十])?\s*(行|条|段|块|节)/;

const TRAILING_N_RE =
  /(末尾|最后|后面|底部)\s*(\d+|[一二两三四五六七八九十])?\s*(行|条|段|块|节)/;

const HEADING_SCOPE_RE =
  /[「『"'《]([^」』"'》]+)[」』"'》].{0,4}(标题|这一节|章节|这段|下面|底下|下方)|((?:^|[，。！？\s])([一二三四五六七八九十0-9A-Za-z一-龥]{1,40}))\s*(?:这个)?(?:标题|章节|节)(?:下|下面|底下)?/;

function getBlocks(content: unknown): any[] {
  if (Array.isArray(content)) return content;
  if (content && typeof content === "object" && Array.isArray((content as any).content)) {
    return (content as any).content;
  }
  return [];
}

function normalizeChineseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const sum = trimmed
    .split("")
    .reduce<number | null>((acc, ch) => {
      const n = CHINESE_NUMBER_MAP[ch];
      if (n == null) return null;
      return (acc ?? 0) + n;
    }, null);
  return sum && sum > 0 ? sum : null;
}

function normalizeSemantic(value: string) {
  return value.replace(/\s+/g, "");
}

function getNonTitleBlocks(blocks: any[]) {
  if (!blocks.length) return [];
  const first = blocks[0];
  const isLevelOneHeading =
    first?.type === "heading" &&
    Number(first?.props?.level ?? first?.attrs?.level) === 1;
  return isLevelOneHeading ? blocks.slice(1) : blocks;
}

function findIndexInOriginalBlocks(blocks: any[], block: any) {
  return blocks.findIndex((item) => item === block);
}

function findHeadingScopeMatch(prompt: string): string | null {
  const match = prompt.match(HEADING_SCOPE_RE);
  if (!match) return null;
  const quoted = match[1];
  const bare = match[4];
  const candidate = (quoted || bare || "").trim();
  return candidate || null;
}

function findHeadingBlock(blocks: any[], headingText: string) {
  const normalizedTarget = normalizeSemantic(headingText).toLowerCase();
  if (!normalizedTarget) return null;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block?.type !== "heading") continue;
    const text = normalizeSemantic(extractTextFromContent(block)).toLowerCase();
    if (!text) continue;
    if (text === normalizedTarget || text.includes(normalizedTarget)) {
      return { block, index: i };
    }
  }
  return null;
}

function getRangeLabelBlockCount(start: number, end: number) {
  return Math.max(0, end - start + 1);
}

function blocksRangeToScope(
  blocks: any[],
  startIdx: number,
  endIdx: number,
  rangeLabel: string,
): AiBlockScope | null {
  if (startIdx < 0 || endIdx < startIdx || endIdx >= blocks.length) return null;
  const startBlock = blocks[startIdx];
  const endBlock = blocks[endIdx];
  const startId =
    typeof startBlock?.id === "string" ? startBlock.id : null;
  const endId = typeof endBlock?.id === "string" ? endBlock.id : null;
  if (!startId || !endId) return null;
  return {
    kind: "range",
    startBlockId: startId,
    endBlockId: endId,
    rangeLabel,
    blockCount: getRangeLabelBlockCount(startIdx, endIdx),
  } satisfies AiBlockScopeRange;
}

/**
 * 用启发式正则识别用户 prompt 里指定的块范围。
 * 命中返回具体范围；未命中返回 null（由调用方决定是否走 LLM fallback / 整页）。
 */
export function detectBlockScopeHeuristic(
  prompt: string,
  content: BlockNoteContent | unknown,
): AiBlockScope | null {
  const normalized = normalizeSemantic(prompt);
  if (!normalized) return null;

  const allBlocks = getBlocks(content);
  if (allBlocks.length === 0) return null;

  if (FULL_PAGE_HINT_RE.test(normalized)) {
    return { kind: "full_page" };
  }

  // 前 N
  const leading = normalized.match(LEADING_N_RE);
  if (leading) {
    const n = normalizeChineseNumber(leading[2]) ?? 3;
    const candidates = getNonTitleBlocks(allBlocks);
    if (candidates.length > 0) {
      const sliceEndIdxInCandidates = Math.min(n, candidates.length) - 1;
      const startBlock = candidates[0];
      const endBlock = candidates[sliceEndIdxInCandidates];
      const startIdx = findIndexInOriginalBlocks(allBlocks, startBlock);
      const endIdx = findIndexInOriginalBlocks(allBlocks, endBlock);
      const label = `前 ${sliceEndIdxInCandidates + 1} 块`;
      const scope = blocksRangeToScope(allBlocks, startIdx, endIdx, label);
      if (scope) return scope;
    }
  }

  // 末尾 N
  const trailing = normalized.match(TRAILING_N_RE);
  if (trailing) {
    const n = normalizeChineseNumber(trailing[2]) ?? 3;
    const candidates = getNonTitleBlocks(allBlocks);
    if (candidates.length > 0) {
      const sliceStart = Math.max(0, candidates.length - n);
      const startBlock = candidates[sliceStart];
      const endBlock = candidates[candidates.length - 1];
      const startIdx = findIndexInOriginalBlocks(allBlocks, startBlock);
      const endIdx = findIndexInOriginalBlocks(allBlocks, endBlock);
      const label = `末尾 ${candidates.length - sliceStart} 块`;
      const scope = blocksRangeToScope(allBlocks, startIdx, endIdx, label);
      if (scope) return scope;
    }
  }

  // 「X」标题下
  const headingText = findHeadingScopeMatch(prompt);
  if (headingText) {
    const found = findHeadingBlock(allBlocks, headingText);
    if (found) {
      const startIdx = found.index;
      const startLevel = Number(
        found.block?.props?.level ?? found.block?.attrs?.level ?? 6,
      );
      let endIdx = allBlocks.length - 1;
      for (let i = startIdx + 1; i < allBlocks.length; i += 1) {
        const candidate = allBlocks[i];
        if (candidate?.type !== "heading") continue;
        const level = Number(
          candidate?.props?.level ?? candidate?.attrs?.level ?? 6,
        );
        if (level <= startLevel) {
          endIdx = i - 1;
          break;
        }
      }
      const headingPlain = extractTextFromContent(found.block).trim();
      const label = `${headingPlain || "目标章节"} 章节`;
      const scope = blocksRangeToScope(allBlocks, startIdx, endIdx, label);
      if (scope) return scope;
    }
  }

  return null;
}

/**
 * 给定页面块数组与范围，提取仅在该范围内的 PartialBlock[]，用于 prompt 注入。
 */
export function extractBlocksInRange(
  blocks: any[],
  startBlockId: string,
  endBlockId: string,
): any[] | null {
  const startIdx = blocks.findIndex((b) => b?.id === startBlockId);
  const endIdx = blocks.findIndex((b) => b?.id === endBlockId);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return null;
  return blocks.slice(startIdx, endIdx + 1);
}
