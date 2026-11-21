/**
 * Live Markdown - High Performance Line & Inline Diff Engine
 * Computes line-by-line and character-level differences between two document snapshots
 * supporting both Side-by-Side and Unified Diff views with syntax highlight hints.
 */

export type DiffChangeType = "added" | "deleted" | "unchanged";

export interface InlineToken {
  type: DiffChangeType;
  text: string;
}

export interface DiffLine {
  type: DiffChangeType;
  oldLineNo?: number;
  newLineNo?: number;
  content: string;
  inlineTokens?: InlineToken[];
}

export interface SideBySideRow {
  left?: {
    lineNo: number;
    content: string;
    type: "deleted" | "unchanged";
    inlineTokens?: InlineToken[];
  };
  right?: {
    lineNo: number;
    content: string;
    type: "added" | "unchanged";
    inlineTokens?: InlineToken[];
  };
}

export interface DiffStats {
  addedLines: number;
  deletedLines: number;
  unchangedLines: number;
  addedChars: number;
  deletedChars: number;
}

export interface DiffResult {
  lines: DiffLine[];
  sideBySideRows: SideBySideRow[];
  stats: DiffStats;
  lineEndingsOnly?: boolean;
}

/**
 * Standard Longest Common Subsequence (LCS) for string arrays (lines or words)
 */
function computeLCS<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): number[][] {
  const m = a.length;
  const n = b.length;
  // Use flat typed arrays or matrix for memory efficiency
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (equals(a[i - 1], b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

const MAX_LCS_CELLS = 400_000;
const MAX_DOCUMENT_INLINE_CELLS = 500_000;
const MAX_SINGLE_INLINE_CELLS = 80_000;

function previousCodePointStart(text: string, end: number): number {
  const last = text.charCodeAt(end - 1);
  return last >= 0xdc00 && last <= 0xdfff && end > 1 ? end - 2 : end - 1;
}

function sharedEdges(oldText: string, newText: string): { prefix: number; suffix: number } {
  let prefix = 0;
  while (prefix < oldText.length && prefix < newText.length) {
    const oldPoint = oldText.codePointAt(prefix);
    const newPoint = newText.codePointAt(prefix);
    if (oldPoint !== newPoint) break;
    const width = oldPoint !== undefined && oldPoint > 0xffff ? 2 : 1;
    prefix += width;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > prefix && newEnd > prefix) {
    const oldStart = previousCodePointStart(oldText, oldEnd);
    const newStart = previousCodePointStart(newText, newEnd);
    if (oldText.codePointAt(oldStart) !== newText.codePointAt(newStart)) break;
    oldEnd = oldStart;
    newEnd = newStart;
  }
  return { prefix, suffix: oldText.length - oldEnd };
}

function tokenizeInline(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  const flushLatin = () => { if (latin) tokens.push(latin); latin = ""; };
  for (const char of text) {
    if (/^[a-zA-Z0-9_]$/.test(char)) latin += char;
    else {
      flushLatin();
      if (/^\s$/u.test(char) && tokens.length && /^\s+$/u.test(tokens[tokens.length - 1])) tokens[tokens.length - 1] += char;
      else tokens.push(char);
    }
  }
  flushLatin();
  return tokens;
}

/**
 * Character-level inline diff between two single lines
 */
function mergeTokens(tokens: InlineToken[]): InlineToken[] {
  const merged: InlineToken[] = [];
  for (const token of tokens) {
    if (!token.text) continue;
    const last = merged[merged.length - 1];
    if (last?.type === token.type) last.text += token.text;
    else merged.push({ ...token });
  }
  return merged;
}

function computeInlineDiffWithBudget(oldLine: string, newLine: string, maxCells: number): {
  oldTokens: InlineToken[];
  newTokens: InlineToken[];
  cellsUsed: number;
} {
  if (oldLine === newLine) {
    return {
      oldTokens: [{ type: "unchanged", text: oldLine }],
      newTokens: [{ type: "unchanged", text: newLine }],
      cellsUsed: 0
    };
  }

  const edges = sharedEdges(oldLine, newLine);
  const oldEnd = oldLine.length - edges.suffix;
  const newEnd = newLine.length - edges.suffix;
  const oldMiddleText = oldLine.slice(edges.prefix, oldEnd);
  const newMiddleText = newLine.slice(edges.prefix, newEnd);
  const fallback = (cellsUsed = 0) => ({
    oldTokens: mergeTokens([
      { type: "unchanged" as const, text: oldLine.slice(0, edges.prefix) },
      { type: "deleted" as const, text: oldMiddleText },
      { type: "unchanged" as const, text: oldLine.slice(oldEnd) }
    ]),
    newTokens: mergeTokens([
      { type: "unchanged" as const, text: newLine.slice(0, edges.prefix) },
      { type: "added" as const, text: newMiddleText },
      { type: "unchanged" as const, text: newLine.slice(newEnd) }
    ]),
    cellsUsed
  });
  if (!oldMiddleText || !newMiddleText) return fallback();
  // Large middles still get exact common-edge highlighting without allocating token arrays.
  if (oldMiddleText.length + newMiddleText.length > 20_000) return fallback();
  const a = tokenizeInline(oldMiddleText);
  const b = tokenizeInline(newMiddleText);
  const cells = (a.length + 1) * (b.length + 1);
  if (cells > maxCells) return fallback();

  const dp = computeLCS(a, b, (x, y) => x === y);

  let i = a.length;
  let j = b.length;

  const rawOld: InlineToken[] = [];
  const rawNew: InlineToken[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rawOld.push({ type: "unchanged", text: a[i - 1] });
      rawNew.push({ type: "unchanged", text: b[j - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawNew.push({ type: "added", text: b[j - 1] });
      j -= 1;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawOld.push({ type: "deleted", text: a[i - 1] });
      i -= 1;
    }
  }

  const unchangedPrefix = { type: "unchanged" as const, text: oldLine.slice(0, edges.prefix) };
  const unchangedSuffixOld = { type: "unchanged" as const, text: oldLine.slice(oldEnd) };
  const unchangedSuffixNew = { type: "unchanged" as const, text: newLine.slice(newEnd) };
  return {
    oldTokens: mergeTokens([unchangedPrefix, ...rawOld.reverse(), unchangedSuffixOld]),
    newTokens: mergeTokens([{ ...unchangedPrefix, text: newLine.slice(0, edges.prefix) }, ...rawNew.reverse(), unchangedSuffixNew]),
    cellsUsed: cells
  };
}

export function computeInlineDiff(oldLine: string, newLine: string): { oldTokens: InlineToken[]; newTokens: InlineToken[] } {
  const { oldTokens, newTokens } = computeInlineDiffWithBudget(oldLine, newLine, MAX_SINGLE_INLINE_CELLS);
  return { oldTokens, newTokens };
}

/**
 * Main Diff function: computes unified DiffLine[] and SideBySideRow[]
 */
export function computeDocumentDiff(oldContent: string, newContent: string): DiffResult {
  type RawItem =
    | { type: "unchanged"; oldIdx: number; newIdx: number; text: string }
    | { type: "deleted"; oldIdx: number; text: string }
    | { type: "added"; newIdx: number; text: string };

  const oldLines = oldContent.replace(/\r\n|\r/g, "\n").split("\n");
  const newLines = newContent.replace(/\r\n|\r/g, "\n").split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const bounded = (oldMiddle.length + 1) * (newMiddle.length + 1) <= MAX_LCS_CELLS;
  const rawChanges: RawItem[] = [];
  for (let k = 0; k < prefix; k += 1) rawChanges.push({ type: "unchanged", oldIdx: k, newIdx: k, text: oldLines[k] });
  if (bounded) {
    const dp = computeLCS(oldMiddle, newMiddle, (x, y) => x === y);
    let i = oldMiddle.length; let j = newMiddle.length;
    const reverse: RawItem[] = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldMiddle[i - 1] === newMiddle[j - 1]) {
        reverse.push({ type: "unchanged", oldIdx: prefix + i - 1, newIdx: prefix + j - 1, text: oldMiddle[i - 1] });
        i -= 1; j -= 1;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        reverse.push({ type: "added", newIdx: prefix + j - 1, text: newMiddle[j - 1] }); j -= 1;
      } else {
        reverse.push({ type: "deleted", oldIdx: prefix + i - 1, text: oldMiddle[i - 1] }); i -= 1;
      }
    }
    rawChanges.push(...reverse.reverse());
  } else {
    // A bounded conservative hunk preserves every source line without quadratic work.
    for (let k = 0; k < oldMiddle.length; k += 1) rawChanges.push({ type: "deleted", oldIdx: prefix + k, text: oldMiddle[k] });
    for (let k = 0; k < newMiddle.length; k += 1) rawChanges.push({ type: "added", newIdx: prefix + k, text: newMiddle[k] });
  }
  for (let k = 0; k < suffix; k += 1) {
    const oldIdx = oldLines.length - suffix + k;
    rawChanges.push({ type: "unchanged", oldIdx, newIdx: newLines.length - suffix + k, text: oldLines[oldIdx] });
  }

  // Construct Unified diff lines
  const unifiedLines: DiffLine[] = [];
  let stats: DiffStats = {
    addedLines: 0,
    deletedLines: 0,
    unchangedLines: 0,
    addedChars: 0,
    deletedChars: 0
  };

  const pairedInline = new Map<RawItem, InlineToken[]>();
  const oldInlineByLine = new Map<number, InlineToken[]>();
  const newInlineByLine = new Map<number, InlineToken[]>();
  let inlineCellsRemaining = MAX_DOCUMENT_INLINE_CELLS;
  for (let k = 0; k < rawChanges.length;) {
    if (rawChanges[k].type === "unchanged") { k += 1; continue; }
    const deleted: Extract<RawItem, { type: "deleted" }>[] = [];
    const added: Extract<RawItem, { type: "added" }>[] = [];
    while (k < rawChanges.length && rawChanges[k].type !== "unchanged") {
      const item = rawChanges[k++];
      if (item.type === "deleted") deleted.push(item);
      else if (item.type === "added") added.push(item);
    }
    for (let i = 0; i < Math.min(deleted.length, added.length); i += 1) {
      const inline = computeInlineDiffWithBudget(deleted[i].text, added[i].text, inlineCellsRemaining);
      inlineCellsRemaining = Math.max(0, inlineCellsRemaining - inline.cellsUsed);
      pairedInline.set(deleted[i], inline.oldTokens); pairedInline.set(added[i], inline.newTokens);
      oldInlineByLine.set(deleted[i].oldIdx, inline.oldTokens);
      newInlineByLine.set(added[i].newIdx, inline.newTokens);
    }
  }
  for (const item of rawChanges) {
    if (item.type === "unchanged") {
      unifiedLines.push({
        type: "unchanged",
        oldLineNo: item.oldIdx + 1,
        newLineNo: item.newIdx + 1,
        content: item.text,
        inlineTokens: pairedInline.get(item)
      });
      stats.unchangedLines += 1;
    } else if (item.type === "deleted") {
      unifiedLines.push({
        type: "deleted",
        oldLineNo: item.oldIdx + 1,
        content: item.text,
        inlineTokens: pairedInline.get(item)
      });
      stats.deletedLines += 1;
      stats.deletedChars += item.text.length;
    } else if (item.type === "added") {
      unifiedLines.push({
        type: "added",
        newLineNo: item.newIdx + 1,
        content: item.text,
        inlineTokens: pairedInline.get(item)
      });
      stats.addedLines += 1;
      stats.addedChars += item.text.length;
    }
  }

  // Construct Side-by-side rows with contiguous deleted/added pairing for inline highlight
  const sideBySideRows: SideBySideRow[] = [];
  let rIdx = 0;

  while (rIdx < rawChanges.length) {
    const cur = rawChanges[rIdx];

    if (cur.type === "unchanged") {
      sideBySideRows.push({
        left: {
          lineNo: cur.oldIdx + 1,
          content: cur.text,
          type: "unchanged"
        },
        right: {
          lineNo: cur.newIdx + 1,
          content: cur.text,
          type: "unchanged"
        }
      });
      rIdx += 1;
      continue;
    }

    // Collect contiguous deleted and added blocks
    const deletedGroup: { oldIdx: number; text: string }[] = [];
    const addedGroup: { newIdx: number; text: string }[] = [];

    while (rIdx < rawChanges.length && rawChanges[rIdx].type !== "unchanged") {
      const item = rawChanges[rIdx];
      if (item.type === "deleted") {
        deletedGroup.push({ oldIdx: item.oldIdx, text: item.text });
      } else if (item.type === "added") {
        addedGroup.push({ newIdx: item.newIdx, text: item.text });
      }
      rIdx += 1;
    }

    const maxCount = Math.max(deletedGroup.length, addedGroup.length);
    for (let k = 0; k < maxCount; k += 1) {
      const del = deletedGroup[k];
      const add = addedGroup[k];

      let oldTokens: InlineToken[] | undefined;
      let newTokens: InlineToken[] | undefined;

      // When a single line was replaced or modified, compute inline char diff
      if (del && add) {
        oldTokens = oldInlineByLine.get(del.oldIdx);
        newTokens = newInlineByLine.get(add.newIdx);
      }

      sideBySideRows.push({
        left: del
          ? {
              lineNo: del.oldIdx + 1,
              content: del.text,
              type: "deleted",
              inlineTokens: oldTokens
            }
          : undefined,
        right: add
          ? {
              lineNo: add.newIdx + 1,
              content: add.text,
              type: "added",
              inlineTokens: newTokens
            }
          : undefined
      });
    }
  }

  return {
    lines: unifiedLines,
    sideBySideRows,
    stats,
    lineEndingsOnly: stats.addedLines === 0 && stats.deletedLines === 0 && oldContent !== newContent
  };
}
