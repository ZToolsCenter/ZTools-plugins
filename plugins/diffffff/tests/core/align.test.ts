import { describe, expect, it } from 'vitest'
import { alignRowsByLineNo, zipUnpairedRows } from '../../src/core/align'
import { diffLinesCore } from '../../src/core/diff'
import { rowsWithPairing } from '../../src/core/pairing'
import type { DiffRow, DiffRowSide } from '../../src/core/types'

const fmt = (rows: DiffRow[]): string[] =>
  rows.map((row) => `${row.type}:${row.left?.lineNo ?? '-'}:${row.right?.lineNo ?? '-'}`)

const side = (lineNo: number, text: string): DiffRowSide => ({ lineNo, text })

describe('alignRowsByLineNo', () => {
  it('slides the user example to zero drift', () => {
    const rows = diffLinesCore('11\n22', '22\n22')
    expect(fmt(rows)).toEqual(['del:1:-', 'equal:2:1', 'add:-:2'])
    const aligned = alignRowsByLineNo(rows)
    expect(fmt(aligned)).toEqual(['del:1:-', 'add:-:1', 'equal:2:2'])
    const drift = aligned
      .filter((row) => row.type === 'equal')
      .reduce((sum, row) => sum + Math.abs(row.right!.lineNo - row.left!.lineNo), 0)
    expect(drift).toBe(0)
  })

  it('preserves countsand per-side line numbers', () => {
    const rows = diffLinesCore('11\n22', '22\n22')
    const aligned = alignRowsByLineNo(rows)
    expect(aligned.length).toBe(rows.length)
    expect(new Set(aligned.map((row) => row.left?.lineNo)).size).toBe(3)
    expect(new Set(aligned.filter((r) => r.left !== undefined).map((row) => row.left!.lineNo)).size).toBe(2)
  })
})

describe('zipUnpairedRows', () => {
  it('merges remaining del/add into alignOnly modify rows', () => {
    const rows: DiffRow[] = [
      { type: 'del', left: side(1, 'a') },
      { type: 'add', right: side(1, 'b') },
    ]
    const zipped = zipUnpairedRows(rows)
    expect(zipped.length).toBe(1)
    expect(zipped[0].type).toBe('modify')
    expect(zipped[0].alignOnly).toBe(true)
    expect('words' in zipped[0].left!).toBe(false)
  })
})

describe('pipeline', () => {
  it('user example renders both rows two-sided', () => {
    const rows = zipUnpairedRows(
      rowsWithPairing(
        alignRowsByLineNo(diffLinesCore('11\n22', '22\n22')),
      ),
    )
    expect(fmt(rows)).toEqual(['modify:1:1', 'equal:2:2'])
    expect(rows[0].alignOnly).toBe(true)
    expect(rows[1].left!.text).toBe('22')
    expect(rows[1].right!.text).toBe('22')
  })
})