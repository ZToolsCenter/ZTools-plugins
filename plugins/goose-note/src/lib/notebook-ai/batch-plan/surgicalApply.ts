/**
 * 外科式局部写入：Aider / Claude str_replace 风格 search_replace，
 * 仅对匹配命中的顶层块范围做 markdown 再解析，其余块原样保留（含 id / props）。
 */
import type { JSONContent } from "@/types";
import { jsonContentToMarkdown } from "@/lib/export/markdown/serialize";
import { importMarkdownFragment } from "@/lib/export/markdown/parse";
import { restoreBlockPropsMarkers } from "@/lib/export/markdown/blockPropsMarker";
import { normalizePageContent } from "@/components/editor/utils/blocknote-content";

const LIST_ITEM_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

export interface SurgicalSearchReplaceSuccess {
  ok: true;
  content: JSONContent;
  replacedCount: number;
  /** 被替换的顶层块数量（替换前累计） */
  touchedBlockCount: number;
}

export interface SurgicalSearchReplaceFailure {
  ok: false;
  error: string;
  currentMarkdownPreview?: string;
}

export type SurgicalSearchReplaceResult =
  | SurgicalSearchReplaceSuccess
  | SurgicalSearchReplaceFailure;

export interface FullEditMergeResult {
  content: JSONContent;
  preservedBlockCount: number;
  replacedBlockCount: number;
}

function getTopLevelBlocks(content: JSONContent): any[] {
  if (Array.isArray(content)) return content as any[];
  if (content && typeof content === "object") {
    const nested = (content as { content?: unknown }).content;
    if (Array.isArray(nested)) return nested as any[];
  }
  return [];
}

function cloneBlocks(blocks: any[]): any[] {
  if (typeof structuredClone === "function") return structuredClone(blocks);
  return JSON.parse(JSON.stringify(blocks)) as any[];
}

function stripBlockIds(blocks: any[]): any[] {
  return blocks.map((block) => {
    if (!block || typeof block !== "object") return block;
    const { id: _omit, ...rest } = block as Record<string, unknown>;
    return rest;
  });
}

/** 块级 markdown 指纹（与序列化一致，不含不可见 marker 特殊处理） */
function blockMarkdownFingerprint(block: any): string {
  return jsonContentToMarkdown([block] as any);
}

/**
 * 按 markdown 指纹做 LCS 对齐：匹配对保留 original 块对象，
 * 未匹配的 candidate 区间保留 candidate 块。
 * 公共前缀/后缀是 LCS 的退化情形。
 */
export function alignBlocksByMarkdownFingerprint(
  original: any[],
  candidate: any[],
): { merged: any[]; preservedCount: number; replacedCount: number } {
  const n = original.length;
  const m = candidate.length;
  if (m === 0) {
    return { merged: [], preservedCount: 0, replacedCount: 0 };
  }
  if (n === 0) {
    return {
      merged: candidate.slice(),
      preservedCount: 0,
      replacedCount: m,
    };
  }

  const a = original.map(blockMarkdownFingerprint);
  const b = candidate.map(blockMarkdownFingerprint);

  // dp[i][j] = LCS 长度（a[0..i), b[0..j)）
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // 回溯匹配对（0-based 下标），按 candidate 顺序
  const matches: Array<{ oi: number; ci: number }> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1] && dp[i]![j] === dp[i - 1]![j - 1]! + 1) {
      matches.push({ oi: i - 1, ci: j - 1 });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  matches.reverse();

  const merged: any[] = [];
  let prevCi = -1;
  for (const match of matches) {
    for (let k = prevCi + 1; k < match.ci; k += 1) {
      merged.push(candidate[k]);
    }
    // 保留原块对象（id / props / nesting）
    merged.push(original[match.oi]);
    prevCi = match.ci;
  }
  for (let k = prevCi + 1; k < m; k += 1) {
    merged.push(candidate[k]);
  }

  const preservedCount = matches.length;
  return {
    merged,
    preservedCount,
    replacedCount: m - preservedCount,
  };
}

/**
 * 与 serializeBlocks 对齐：连续列表项合并为一段，其余一块一段。
 */
function buildSegments(blocks: any[]): Array<{
  start: number;
  end: number;
  markdown: string;
}> {
  const segments: Array<{ start: number; end: number; markdown: string }> = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (!block || typeof block !== "object") {
      i += 1;
      continue;
    }
    if (LIST_ITEM_TYPES.has(block.type)) {
      const start = i;
      while (i < blocks.length && LIST_ITEM_TYPES.has(blocks[i]?.type)) {
        i += 1;
      }
      const markdown = jsonContentToMarkdown(blocks.slice(start, i) as any);
      if (markdown !== "") {
        segments.push({ start, end: i - 1, markdown });
      }
      continue;
    }
    const markdown = jsonContentToMarkdown([block] as any);
    if (markdown !== "") {
      segments.push({ start: i, end: i, markdown });
    }
    i += 1;
  }
  return segments;
}

function joinSegments(segments: Array<{ markdown: string }>): string {
  return segments.map((s) => s.markdown).join("\n\n");
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const positions: number[] = [];
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    positions.push(idx);
    from = idx + Math.max(needle.length, 1);
  }
  return positions;
}

/**
 * 折叠水平空白（空格/Tab）后的定位，并映射回原文区间。
 * 换行保留，避免跨段误匹配。
 */
function findWhitespaceFlexible(
  haystack: string,
  needle: string,
): { index: number; matchedLength: number } | null {
  const normalize = (s: string) => {
    const norm: string[] = [];
    const map: number[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i]!;
      if (ch === " " || ch === "\t") {
        if (norm[norm.length - 1] !== " ") {
          norm.push(" ");
          map.push(i);
        }
        continue;
      }
      norm.push(ch);
      map.push(i);
    }
    return { text: norm.join(""), map };
  };

  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n.text) return null;
  const nIdx = h.text.indexOf(n.text);
  if (nIdx < 0) return null;

  const startOrig = h.map[nIdx];
  if (startOrig == null) return null;
  const endNorm = nIdx + n.text.length - 1;
  const endOrig = h.map[endNorm];
  if (endOrig == null) return null;
  return { index: startOrig, matchedLength: endOrig - startOrig + 1 };
}

function mapCharRangeToBlocks(
  segments: Array<{ start: number; end: number; markdown: string }>,
  matchStart: number,
  matchEnd: number,
): { startBlock: number; endBlock: number } | null {
  if (segments.length === 0) return null;
  let cursor = 0;
  let startBlock: number | null = null;
  let endBlock: number | null = null;

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const segStart = cursor;
    const segEnd = cursor + seg.markdown.length;
    if (matchEnd > segStart && matchStart < segEnd) {
      if (startBlock == null) startBlock = seg.start;
      endBlock = seg.end;
    }
    cursor = segEnd + (i < segments.length - 1 ? 2 : 0);
  }

  if (startBlock == null || endBlock == null) return null;
  return { startBlock, endBlock };
}

function parseFragment(markdown: string): any[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [];
  const fragment = importMarkdownFragment(trimmed);
  if (!fragment || !Array.isArray(fragment) || fragment.length === 0) {
    return [];
  }
  // 顺序：import → 恢复 props 标记 → 去掉 id（避免与原页冲突）
  const restored = restoreBlockPropsMarkers(fragment as any);
  return stripBlockIds(restored as any[]);
}

/**
 * normalizePageContent / normalizeBlock 会丢掉 id。
 * 按块 markdown 指纹 LCS 对齐，把原块 id 写回未改动块。
 */
function reattachPreservedBlockIds(source: any[], normalized: any[]): any[] {
  if (!Array.isArray(normalized) || normalized.length === 0) return normalized;
  const n = source.length;
  const m = normalized.length;
  if (n === 0) return normalized;

  const a = source.map(blockMarkdownFingerprint);
  const b = normalized.map(blockMarkdownFingerprint);

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const matches: Array<{ oi: number; ci: number }> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1] && dp[i]![j] === dp[i - 1]![j - 1]! + 1) {
      matches.push({ oi: i - 1, ci: j - 1 });
      i -= 1;
      j -= 1;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  const out = normalized.map((b) =>
    b && typeof b === "object" ? { ...b } : b,
  );
  for (const match of matches) {
    const srcId = source[match.oi]?.id;
    if (srcId != null && out[match.ci] && out[match.ci].id == null) {
      out[match.ci] = { ...out[match.ci], id: srcId };
    }
  }
  return out;
}

function locateInRegion(
  regionMd: string,
  find: string,
): { localStart: number; localLen: number } | null {
  const exact = regionMd.indexOf(find);
  if (exact >= 0) return { localStart: exact, localLen: find.length };
  const flex = findWhitespaceFlexible(regionMd, find);
  if (!flex) return null;
  return { localStart: flex.index, localLen: flex.matchedLength };
}

function applyOneMatch(
  blocks: any[],
  find: string,
  newString: string,
  matchStart: number,
  matchLength: number,
): { touched: number } | null {
  const segments = buildSegments(blocks);
  const range = mapCharRangeToBlocks(
    segments,
    matchStart,
    matchStart + matchLength,
  );
  if (!range) return null;

  const { startBlock, endBlock } = range;
  const regionBlocks = blocks.slice(startBlock, endBlock + 1);
  const regionMd = jsonContentToMarkdown(regionBlocks as any);
  if (!regionMd) return null;

  const located = locateInRegion(regionMd, find);
  if (!located) return null;

  const nextRegionMd =
    regionMd.slice(0, located.localStart) +
    newString +
    regionMd.slice(located.localStart + located.localLen);

  const replacement = parseFragment(nextRegionMd);
  const beforeCount = endBlock - startBlock + 1;
  blocks.splice(startBlock, beforeCount, ...replacement);
  return { touched: beforeCount };
}

/**
 * 在页面内容上应用 search/replace，仅重解析被命中的块范围。
 */
export function applySearchReplacePreservingBlocks(
  content: JSONContent,
  oldString: string,
  newString: string,
  options?: { replaceAll?: boolean },
): SurgicalSearchReplaceResult {
  const find = oldString;
  if (!find) {
    return { ok: false, error: "search_replace 的 oldString 不能为空" };
  }

  const blocks = cloneBlocks(getTopLevelBlocks(content));
  if (blocks.length === 0) {
    return { ok: false, error: "页面为空，无法局部替换" };
  }

  const replaceAll = options?.replaceAll === true;
  let replacedCount = 0;
  let touchedBlockCount = 0;

  const previewOf = (md: string) =>
    md.length > 400 ? `${md.slice(0, 400)}…` : md;

  // 多轮：每轮基于当前 blocks 重建 markdown，从后往前应用本轮全部匹配，避免下标错乱。
  let guard = 0;
  while (guard < 64) {
    guard += 1;
    const segments = buildSegments(blocks);
    const fullMd = joinSegments(segments);

    const exactPositions = findAllOccurrences(fullMd, find);
    let matches: Array<{ start: number; length: number }>;
    if (exactPositions.length > 0) {
      matches = exactPositions.map((start) => ({
        start,
        length: find.length,
      }));
    } else {
      const flex = findWhitespaceFlexible(fullMd, find);
      if (!flex) {
        if (replacedCount === 0) {
          return {
            ok: false,
            error:
              "未在页面中找到 oldString 的精确匹配。请先 readPage，复制原文片段作为 oldString。",
            currentMarkdownPreview: previewOf(fullMd),
          };
        }
        break;
      }
      matches = [{ start: flex.index, length: flex.matchedLength }];
    }

    if (!replaceAll) {
      matches = [matches[0]!];
    }

    // 从后往前，同一全文布局下下标稳定
    matches.sort((a, b) => b.start - a.start);
    let appliedThisRound = 0;
    for (const match of matches) {
      // 注意：同轮多次 splice 后，后续 match 的 char 下标仍对「本轮开始」有效，
      // 但 blocks 已变。因此同轮只安全处理「从后往前」且每次重新 buildSegments 会漂移。
      // 正确做法：同轮只 apply 一处（最后一处），然后 while 重建。
      const result = applyOneMatch(
        blocks,
        find,
        newString,
        match.start,
        match.length,
      );
      if (!result) continue;
      replacedCount += 1;
      touchedBlockCount += result.touched;
      appliedThisRound += 1;
      // 每成功一处就重建全文，防止同轮多处错位
      break;
    }

    if (appliedThisRound === 0) {
      if (replacedCount === 0) {
        return {
          ok: false,
          error:
            "未能将 oldString 映射到可替换的块范围。请缩小片段或重新 readPage 后重试。",
          currentMarkdownPreview: previewOf(fullMd),
        };
      }
      break;
    }

    if (!replaceAll) break;
  }

  if (replacedCount === 0) {
    const fullMd = joinSegments(buildSegments(blocks));
    return {
      ok: false,
      error:
        "未能将 oldString 映射到可替换的块范围。请缩小片段或重新 readPage 后重试。",
      currentMarkdownPreview: previewOf(fullMd),
    };
  }

  const normalized = normalizePageContent(blocks as any, {
    ensureFirstTitle: false,
  }) as any[];
  const nextContent = reattachPreservedBlockIds(
    blocks,
    getTopLevelBlocks(normalized),
  ) as JSONContent;

  return {
    ok: true,
    content: nextContent,
    replacedCount,
    touchedBlockCount,
  };
}

/**
 * 全量 edit 兜底：按块 markdown 指纹 LCS 对齐，保留未改动原块（id/props/nesting），
 * 仅对未匹配区间使用重解析结果。前缀/后缀对齐是 LCS 退化情形。
 */
export function mergeFullEditPreservingUnchangedBlocks(
  originalContent: JSONContent,
  newMarkdown: string,
  options?: { ensureFirstTitle?: boolean },
): FullEditMergeResult {
  const before = getTopLevelBlocks(originalContent);
  const parsed = parseFragment(newMarkdown);
  const ensureFirstTitle = options?.ensureFirstTitle !== false;

  if (before.length === 0 || parsed.length === 0) {
    const content = normalizePageContent(
      parsed.length ? (parsed as any) : (before as any),
      { ensureFirstTitle },
    ) as JSONContent;
    return {
      content,
      preservedBlockCount: 0,
      replacedBlockCount: getTopLevelBlocks(content).length,
    };
  }

  const { merged, preservedCount, replacedCount } =
    alignBlocksByMarkdownFingerprint(before, parsed);

  const normalized = normalizePageContent(merged as any, {
    ensureFirstTitle,
  }) as any[];
  const content = reattachPreservedBlockIds(
    merged,
    getTopLevelBlocks(normalized),
  ) as JSONContent;

  return {
    content,
    preservedBlockCount: preservedCount,
    replacedBlockCount: replacedCount,
  };
}
