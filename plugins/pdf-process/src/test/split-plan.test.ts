import { describe, it, expect } from 'vitest'
import {
  rangesFromCutAfter,
  cutAfterFromEvery,
  beforePagesFromCutAfter,
  formatRangeLabel,
  parseSplitSpec,
  formatPlanAsSpec,
  pagesToRanges,
  buildSplitInvocation,
} from '../utils/splitPlan'

describe('rangesFromCutAfter', () => {
  it('no cuts → single full range', () => {
    expect(rangesFromCutAfter(5, [])).toEqual([[1, 5]])
  })

  it('cut after each page → single-page ranges', () => {
    expect(rangesFromCutAfter(3, [1, 2])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ])
  })

  it('cut after 2 on 6 pages', () => {
    expect(rangesFromCutAfter(6, [2])).toEqual([
      [1, 2],
      [3, 6],
    ])
  })

  it('ignores invalid cuts', () => {
    expect(rangesFromCutAfter(4, [0, 4, 99, 2])).toEqual([
      [1, 2],
      [3, 4],
    ])
  })
})

describe('cutAfterFromEvery', () => {
  it('every 1 on 4 pages', () => {
    expect(cutAfterFromEvery(4, 1)).toEqual([1, 2, 3])
  })

  it('every 2 on 5 pages', () => {
    expect(cutAfterFromEvery(5, 2)).toEqual([2, 4])
  })

  it('every 3 on 10 pages', () => {
    expect(cutAfterFromEvery(10, 3)).toEqual([3, 6, 9])
  })
})

describe('beforePagesFromCutAfter', () => {
  it('maps cut-after to split-before', () => {
    expect(beforePagesFromCutAfter([1, 3])).toEqual([2, 4])
  })
})

describe('formatRangeLabel', () => {
  it('formats single and multi', () => {
    expect(formatRangeLabel(3, 3)).toBe('3')
    expect(formatRangeLabel(1, 4)).toBe('1-4')
  })
})

describe('parseSplitSpec', () => {
  it('empty → full document', () => {
    const r = parseSplitSpec('', 10)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mode).toBe('cuts')
      expect(r.cuts).toEqual([])
      expect(r.ranges).toEqual([[1, 10]])
    }
  })

  it('cut-after list', () => {
    const r = parseSplitSpec('2,5', 10)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mode).toBe('cuts')
      expect(r.cuts).toEqual([2, 5])
      expect(r.ranges).toEqual([
        [1, 2],
        [3, 5],
        [6, 10],
      ])
    }
  })

  it('rejects cut on last page', () => {
    const r = parseSplitSpec('10', 10)
    expect(r.ok).toBe(false)
  })

  it('contiguous ranges', () => {
    const r = parseSplitSpec('1-3,4-6,7-10', 10)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mode).toBe('ranges')
      expect(r.ranges).toEqual([
        [1, 3],
        [4, 6],
        [7, 10],
      ])
      expect(r.cuts).toEqual([3, 6])
    }
  })

  it('gapped ranges keep listed only', () => {
    const r = parseSplitSpec('1-2,5-6', 10)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.mode).toBe('ranges')
      expect(r.ranges).toEqual([
        [1, 2],
        [5, 6],
      ])
      expect(r.cuts).toEqual([2, 6])
    }
  })

  it('single pages mixed with ranges', () => {
    const r = parseSplitSpec('1,3-4,6', 6)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ranges).toEqual([
        [1, 1],
        [3, 4],
        [6, 6],
      ])
    }
  })

  it('rejects overlap', () => {
    const r = parseSplitSpec('1-4,3-5', 10)
    expect(r.ok).toBe(false)
  })

  it('accepts chinese comma and tilde', () => {
    const r = parseSplitSpec('1～3，4-6', 6)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ranges).toEqual([
        [1, 3],
        [4, 6],
      ])
    }
  })
})

describe('formatPlanAsSpec', () => {
  it('joins range labels', () => {
    expect(formatPlanAsSpec([
      [1, 2],
      [3, 3],
      [4, 6],
    ])).toBe('1-2,3,4-6')
  })
})

describe('pagesToRanges', () => {
  it('collapses contiguous pages', () => {
    expect(pagesToRanges([1, 2, 3, 5, 8, 9])).toEqual([
      [1, 3],
      [5, 5],
      [8, 9],
    ])
  })

  it('empty → empty', () => {
    expect(pagesToRanges([])).toEqual([])
  })
})

describe('buildSplitInvocation', () => {
  it('extract merges ranges into one PDF', () => {
    expect(
      buildSplitInvocation({ mode: 'extract', ranges: [[15, 20]] }),
    ).toEqual({ pageRanges: [[15, 20]], mergeRanges: true })
  })

  it('cut auto span', () => {
    expect(buildSplitInvocation({ mode: 'cut', kind: 'span', span: 2 })).toEqual({
      span: 2,
    })
  })

  it('cut scissors beforePages', () => {
    expect(
      buildSplitInvocation({ mode: 'cut', kind: 'before', beforePages: [3, 6] }),
    ).toEqual({ beforePages: [3, 6] })
  })

  it('cut gapped ranges → one file per range', () => {
    expect(
      buildSplitInvocation({
        mode: 'cut',
        kind: 'ranges',
        ranges: [
          [1, 2],
          [5, 6],
        ],
        mergeRanges: false,
      }),
    ).toEqual({
      pageRanges: [
        [1, 2],
        [5, 6],
      ],
      mergeRanges: false,
    })
  })
})
