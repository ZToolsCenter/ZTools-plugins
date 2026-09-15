/**
 * Build split plan for a PDF with pageCount pages.
 * cutAfterPages: page numbers after which a cut is placed (1-based, 1..pageCount-1).
 * Returns contiguous ranges [start, end] inclusive (1-based).
 */
export function rangesFromCutAfter(pageCount: number, cutAfterPages: Iterable<number>): Array<[number, number]> {
  const n = Math.max(0, Math.floor(pageCount))
  if (n <= 0) return []
  const cuts = new Set<number>()
  for (const c of cutAfterPages) {
    const p = Math.floor(Number(c))
    if (p >= 1 && p < n) cuts.add(p)
  }
  const sorted = Array.from(cuts).sort((a, b) => a - b)
  const ranges: Array<[number, number]> = []
  let start = 1
  for (const cut of sorted) {
    ranges.push([start, cut])
    start = cut + 1
  }
  ranges.push([start, n])
  return ranges
}

/**
 * Auto-split every `every` pages: cut after every, 2*every, ...
 * every=1 → cut after each page (each page its own file).
 */
export function cutAfterFromEvery(pageCount: number, every: number): number[] {
  const n = Math.max(0, Math.floor(pageCount))
  const step = Math.max(1, Math.floor(Number(every) || 1))
  if (n <= 1) return []
  const cuts: number[] = []
  for (let p = step; p < n; p += step) cuts.push(p)
  return cuts
}

/**
 * Convert cut-after pages to backend "split before" page numbers.
 * cut after 1 → split before 2.
 */
export function beforePagesFromCutAfter(cutAfterPages: Iterable<number>): number[] {
  const set = new Set<number>()
  for (const c of cutAfterPages) {
    const p = Math.floor(Number(c))
    if (p >= 1) set.add(p + 1)
  }
  return Array.from(set).sort((a, b) => a - b)
}

/** Format a range for display / filename helper. */
export function formatRangeLabel(start: number, end: number): string {
  return start === end ? String(start) : start + '-' + end
}

export type ParseSplitSpecResult =
  | { ok: true; cuts: number[]; ranges: Array<[number, number]>; mode: 'ranges' | 'cuts' }
  | { ok: false; error: string }

/**
 * Parse user split spec text.
 * - Range groups: "1-3,4-6,7-10" or "1-3; 4-6"
 * - Cut-after pages: "2,5,8" (single numbers only → cut after those pages)
 * Ranges must be ascending, non-overlapping, within 1..pageCount.
 * If ranges don't cover the whole document, uncovered pages are dropped from output
 * only when using explicit ranges mode; we still derive cuts between provided groups
 * and keep only the listed ranges as the plan (gaps become separate implicit skips).
 *
 * For UI scissors sync: returns cut-after pages between consecutive provided ranges
 * when they abut; for gaps, cuts at end of each range (next starts after gap start-1).
 * Simpler rule used by the app: explicit ranges become the exact output plan; cuts
 * are derived as each range end when end < pageCount and the next range starts at end+1.
 * If ranges have gaps, we still output only listed ranges via beforePages is wrong —
 * backend uses beforePages for contiguous full-doc splits. So for gapped ranges the
 * caller should use extract-per-range. Here we require non-overlapping ascending
 * ranges and return them; cuts are ends of all but last range when contiguous cover
 * from 1, otherwise cuts = each range's end (except if end==pageCount).
 */
export function parseSplitSpec(text: string, pageCount: number): ParseSplitSpecResult {
  const n = Math.max(0, Math.floor(pageCount))
  if (n <= 0) return { ok: false, error: '无效页数' }
  const raw = String(text || '').trim()
  if (!raw) return { ok: true, cuts: [], ranges: [[1, n]], mode: 'cuts' }

  const parts = raw
    .split(/[,;，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return { ok: true, cuts: [], ranges: [[1, n]], mode: 'cuts' }

  const hasRangeToken = parts.some((p) => /[-~～—–]/.test(p))

  if (!hasRangeToken) {
    // cut-after list
    const cuts: number[] = []
    for (const p of parts) {
      if (!/^\d+$/.test(p)) return { ok: false, error: '无法解析：' + p }
      const v = parseInt(p, 10)
      if (v < 1 || v >= n) return { ok: false, error: '切割页须在 1～' + (n - 1) + '：' + v }
      cuts.push(v)
    }
    const uniq = Array.from(new Set(cuts)).sort((a, b) => a - b)
    return { ok: true, cuts: uniq, ranges: rangesFromCutAfter(n, uniq), mode: 'cuts' }
  }

  const ranges: Array<[number, number]> = []
  for (const p of parts) {
    const m = /^(\d+)\s*[-~～—–]\s*(\d+)$/.exec(p)
    if (m) {
      const a = parseInt(m[1], 10)
      const b = parseInt(m[2], 10)
      if (a < 1 || b < 1 || a > n || b > n) return { ok: false, error: '页码超出范围：' + p }
      if (a > b) return { ok: false, error: '起始页不能大于结束页：' + p }
      ranges.push([a, b])
      continue
    }
    if (/^\d+$/.test(p)) {
      const v = parseInt(p, 10)
      if (v < 1 || v > n) return { ok: false, error: '页码超出范围：' + p }
      ranges.push([v, v])
      continue
    }
    return { ok: false, error: '无法解析：' + p }
  }

  ranges.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] <= ranges[i - 1][1]) {
      return { ok: false, error: '页码范围不能重叠' }
    }
  }

  // Derive cut-after for contiguous coverage; for UI highlight, cut after each range end
  // when there is a following page that starts a new group or gap.
  const cuts: number[] = []
  for (let i = 0; i < ranges.length; i++) {
    const end = ranges[i][1]
    if (end < n) cuts.push(end)
  }

  // If ranges fully cover 1..n contiguously, cuts are just boundaries
  const coversAll =
    ranges.length > 0 &&
    ranges[0][0] === 1 &&
    ranges[ranges.length - 1][1] === n &&
    ranges.every((r, i) => i === 0 || r[0] === ranges[i - 1][1] + 1)

  if (coversAll) {
    const boundaryCuts = ranges.slice(0, -1).map((r) => r[1])
    return { ok: true, cuts: boundaryCuts, ranges, mode: 'ranges' }
  }

  return { ok: true, cuts, ranges, mode: 'ranges' }
}

/** Serialize cut-after set to a compact ranges string for the input box. */
export function formatPlanAsSpec(ranges: Array<[number, number]>): string {
  return ranges.map(([a, b]) => formatRangeLabel(a, b)).join(',')
}

/** Collapse sorted 1-based page numbers into contiguous [start,end] ranges. */
export function pagesToRanges(pages: Iterable<number>): Array<[number, number]> {
  const sorted = Array.from(new Set(Array.from(pages).map((n) => Math.floor(Number(n)))))
    .filter((n) => n >= 1)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const ranges: Array<[number, number]> = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i]
      continue
    }
    ranges.push([start, prev])
    start = sorted[i]
    prev = sorted[i]
  }
  ranges.push([start, prev])
  return ranges
}

export type SplitMode = 'extract' | 'cut'

export type SplitIntent =
  | { mode: 'extract'; ranges: Array<[number, number]> }
  | { mode: 'cut'; kind: 'span'; span: number }
  | { mode: 'cut'; kind: 'before'; beforePages: number[] }
  | { mode: 'cut'; kind: 'ranges'; ranges: Array<[number, number]>; mergeRanges: false }
  | { mode: 'cut'; kind: 'whole'; pageCount: number }

export type SplitPdfArgs =
  | { span: number }
  | { beforePages: number[] }
  | { pageRanges: Array<[number, number]>; mergeRanges: boolean }

/**
 * Map UI split intent → window.services.splitPdf options.
 * Keeps backend option shapes out of React.
 */
export function buildSplitInvocation(intent: SplitIntent): SplitPdfArgs {
  if (intent.mode === 'extract') {
    if (!intent.ranges.length) throw new Error('没有有效的页码范围')
    return { pageRanges: intent.ranges, mergeRanges: true }
  }
  switch (intent.kind) {
    case 'span':
      return { span: Math.max(1, Math.floor(intent.span) || 1) }
    case 'before':
      return { beforePages: intent.beforePages }
    case 'ranges':
      return { pageRanges: intent.ranges, mergeRanges: false }
    case 'whole':
      return { span: Math.max(1, Math.floor(intent.pageCount) || 1) }
    default: {
      const _x: never = intent
      return _x
    }
  }
}
