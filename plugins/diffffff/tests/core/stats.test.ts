/**
 * 统计与导航单元测试（roadmap 任务 ENG-009）。
 *
 * 覆盖 `src/core/stats.ts` 的三个出口与 `src/core/diff.ts` compareFull 的
 * stats 接线：
 * - `computeStats`：纯增 / 纯删 / 混合 / 含 modify（rowsWithPairing 产物，
 *   验证「修改对计 1 且不计入 added/removed」的口径）/ 全 equal / 空 rows /
 *   hunkCount 传参；
 * - compareFull 统计：+N −M 与 hunkCount 正确、modifiedPairs 语义（当前
 *   行级骨架不产 modify 行故恒为 0，UI-006 接线 rowsWithPairing 后非零）、
 *   与 `computeStats(rows, hunks.length)` 逐字段一致；compare() 占位不变；
 * - `nextHunkIndex`：空列表、单 hunk 回绕到自身、多 hunk 循环回绕、
 *   direction = -1、current = -1（未定位）、越界与非整数防御、真实 hunks
 *   （buildHunks 产物）上的连续遍历；
 * - `hunkAnchorRows`：单 / 多 hunk 定位与 buildHunks 切片范围一致、modify
 *   行场景、首行 / 末行变更边界、纯增 / 纯删（header 行号回退场景）、四级
 *   定位策略逐级回退（引用 → 内容+行号 → 首尾文本 → 首行行号）、未命中
 *   返回 {-1, -1}、跨 contextLines 的不变量电池；
 * - `sideChangedChars`：纯增 / 纯删 / 混合（equal 不计入）/ 含 modify
 *   （rowsWithPairing 产物：modify 两侧不计入）/ 空 rows。
 */
import { describe, expect, it } from 'vitest'
import { computeStats, hunkAnchorRows, nextHunkIndex, sideChangedChars } from '../../src/core/stats'
import { buildHunks } from '../../src/core/hunks'
import { compare, compareFull, diffLinesCore } from '../../src/core/diff'
import { rowsWithPairing } from '../../src/core/pairing'
import { DEFAULT_OPTIONS } from '../../src/core/options'
import type { DiffRow, Hunk } from '../../src/core/types'

/** 用真实行级 diff 构造带 1-based 行号的行骨架（测试输入统一入口）。 */
function makeRows(left: string, right: string): DiffRow[] {
  return diffLinesCore(left, right)
}

/** 生成 'l1'..'lN' 形式的 N 行文本。 */
function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `l${i + 1}`).join('\n')
}

/** 构造 only-导航 测试用的最小 Hunk（rows 内容对 nextHunkIndex 无关）。 */
function makeHunks(count: number): Hunk[] {
  return Array.from({ length: count }, (_, i) => ({
    header: `@@ -${i + 1},1 +${i + 1},1 @@`,
    rows: [],
    oldStart: i + 1,
    oldLines: 1,
    newStart: i + 1,
    newLines: 1,
  }))
}

/** 20 行文件第 3、17 行被修改：两个相距足够远的变更簇。 */
const TWO_CHANGES_LEFT = numberedLines(20)
const TWO_CHANGES_RIGHT = numberedLines(20)
  .replace('l3', 'L3-changed')
  .replace('l17', 'L17-changed')

/** 定位 hunk 在全量 rows 中的 0-based 起止下标（依赖切片共享行对象引用）。 */
function refRange(rows: DiffRow[], hunkRows: DiffRow[]): { start: number; end: number } {
  const start = rows.indexOf(hunkRows[0])
  const end = rows.indexOf(hunkRows[hunkRows.length - 1])
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThanOrEqual(start)
  expect(end - start + 1).toBe(hunkRows.length)
  return { start, end }
}

/* -------------------------------------------------------------------------- */
/* computeStats                                                                */
/* -------------------------------------------------------------------------- */

describe('computeStats：基础口径', () => {
  it('空 rows → 全零（hunkCount 缺省 0）', () => {
    expect(computeStats([])).toEqual({
      addedLines: 0,
      removedLines: 0,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 0,
    })
  })

  it('全 equal → 变更计数全零，totalRows 计入 equal 行', () => {
    const rows = makeRows('a\nb\nc', 'a\nb\nc')
    expect(computeStats(rows)).toEqual({
      addedLines: 0,
      removedLines: 0,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 3,
    })
  })

  it('纯增：addedLines = add 行数，其余为零', () => {
    const rows = makeRows('', 'a\nb\nc')
    expect(rows.map((r) => r.type)).toEqual(['add', 'add', 'add'])
    expect(computeStats(rows)).toEqual({
      addedLines: 3,
      removedLines: 0,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 3,
    })
  })

  it('纯删：removedLines = del 行数，其余为零', () => {
    const rows = makeRows('a\nb', '')
    expect(rows.map((r) => r.type)).toEqual(['del', 'del'])
    expect(computeStats(rows)).toEqual({
      addedLines: 0,
      removedLines: 2,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 2,
    })
  })

  it('混合：add / del / equal 各归各位', () => {
    // left [a,b,c] vs right [a,X,d,e]：equal a、del b、del c、add X、add d、add e。
    const rows = makeRows('a\nb\nc', 'a\nX\nd\ne')
    expect(rows.map((r) => r.type)).toEqual(['equal', 'del', 'del', 'add', 'add', 'add'])
    expect(computeStats(rows)).toEqual({
      addedLines: 3,
      removedLines: 2,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 6,
    })
  })

  it('hunkCount 由调用方传入，其余字段不受影响', () => {
    const rows = makeRows('a\nb\nc', 'a\nX\nc')
    const base = computeStats(rows)
    const withHunks = computeStats(rows, 7)
    expect(withHunks).toEqual({ ...base, hunkCount: 7 })
    expect(withHunks.hunkCount).toBe(7)
  })
})

describe('computeStats：modify 行（rowsWithPairing 产物）', () => {
  it('单一修改对：modifiedPairs 计 1，不计入 added / removed', () => {
    // 'const x = 1;' → 'const x = 2;' 相似度 ≥ 0.5，被配成 modify 行。
    const paired = rowsWithPairing(makeRows('p\nconst x = 1;\nq', 'p\nconst x = 2;\nq'))
    expect(paired.map((r) => r.type)).toEqual(['equal', 'modify', 'equal'])
    expect(computeStats(paired)).toEqual({
      addedLines: 0,
      removedLines: 0,
      modifiedPairs: 1,
      hunkCount: 0,
      totalRows: 3,
    })
  })

  it('修改对 + 未配对余量：modify 计 1，左右两侧不重复计入 added/removed', () => {
    // del 块 [common line one, zzz] vs add 块 [common line one v2, qqq]：
    // 仅 (D0, A0) 相似度达标配对，zzz / qqq 保持 del / add。
    const paired = rowsWithPairing(
      makeRows('a\ncommon line one\nzzz\nb', 'a\ncommon line one v2\nqqq\nb'),
    )
    expect(paired.map((r) => r.type)).toEqual(['equal', 'modify', 'del', 'add', 'equal'])
    const stats = computeStats(paired)
    // 修改对计 1 且其左右两侧不计入 added / removed：若重复计数，added /
    // removed 会各为 2。
    expect(stats.modifiedPairs).toBe(1)
    expect(stats.addedLines).toBe(1)
    expect(stats.removedLines).toBe(1)
    expect(stats.totalRows).toBe(5)
  })
})

/* -------------------------------------------------------------------------- */
/* compareFull 统计接线（ENG-009）                                              */
/* -------------------------------------------------------------------------- */

describe('compareFull 统计（computeStats 接线）', () => {
  it('+N −M 与 hunkCount 正确（两处变更 → +2 −2、2 个 hunk）', () => {
    const result = compareFull(TWO_CHANGES_LEFT, TWO_CHANGES_RIGHT, DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // rows（22 行）= equal×18 + del l3/l17 + add L3-changed/L17-changed。
    expect(result.stats).toEqual({
      addedLines: 2,
      removedLines: 2,
      modifiedPairs: 0,
      hunkCount: 2,
      totalRows: 22,
    })
    expect(result.stats.hunkCount).toBe(result.hunks.length)
  })

  it('modifiedPairs 语义：当前行级骨架不产 modify 行故恒为 0（UI-006 接线 rowsWithPairing 后非零）', () => {
    const result = compareFull('a\nb\nc', 'a\nX\nc', DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // del b + add X 均未配对（骨架无配对接线），语义预留位恒为 0。
    expect(result.stats.modifiedPairs).toBe(0)
    expect(result.stats.addedLines).toBe(1)
    expect(result.stats.removedLines).toBe(1)
    expect(result.stats.totalRows).toBe(4)
  })

  it('stats 与 computeStats(rows, hunks.length) 逐字段一致', () => {
    const result = compareFull(TWO_CHANGES_LEFT, TWO_CHANGES_RIGHT, DEFAULT_OPTIONS, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stats).toEqual(computeStats(result.rows, result.hunks.length))
  })

  it('compare()（无选项入口）统计行为不变：hunkCount 恒 0 占位', () => {
    const result = compare('a\nb', 'a\nX\nb')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // jsdiff 把该输入判为纯插入：rows = [eq a, add X, eq b]（无 del 行）。
    expect(result.rows.map((r) => r.type)).toEqual(['equal', 'add', 'equal'])
    expect(result.hunks).toEqual([])
    expect(result.stats).toEqual({
      addedLines: 1,
      removedLines: 0,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 3,
    })
  })
})

/* -------------------------------------------------------------------------- */
/* nextHunkIndex                                                               */
/* -------------------------------------------------------------------------- */

describe('nextHunkIndex：循环跳转', () => {
  it('空列表 → 恒为 -1（任意 current / direction）', () => {
    expect(nextHunkIndex([], 0, 1)).toBe(-1)
    expect(nextHunkIndex([], -1, 1)).toBe(-1)
    expect(nextHunkIndex([], -1, -1)).toBe(-1)
    expect(nextHunkIndex([], 5, 1)).toBe(-1)
  })

  it('单 hunk：前进 / 后退都回绕到自身', () => {
    const hunks = makeHunks(1)
    expect(nextHunkIndex(hunks, 0, 1)).toBe(0)
    expect(nextHunkIndex(hunks, 0, -1)).toBe(0)
  })

  it('多 hunk：双向循环回绕', () => {
    const hunks = makeHunks(3)
    // 正向：0 → 1 → 2 → 0（回绕）。
    expect(nextHunkIndex(hunks, 0, 1)).toBe(1)
    expect(nextHunkIndex(hunks, 1, 1)).toBe(2)
    expect(nextHunkIndex(hunks, 2, 1)).toBe(0)
    // 反向：2 → 1 → 0 → 2（回绕）。
    expect(nextHunkIndex(hunks, 2, -1)).toBe(1)
    expect(nextHunkIndex(hunks, 1, -1)).toBe(0)
    expect(nextHunkIndex(hunks, 0, -1)).toBe(2)
  })

  it('current = -1（未定位）：正向去第一个、反向去最后一个', () => {
    const hunks = makeHunks(3)
    expect(nextHunkIndex(hunks, -1, 1)).toBe(0)
    expect(nextHunkIndex(hunks, -1, -1)).toBe(2)
  })

  it('current 越界（含负数与非整数）按 -1 处理', () => {
    const hunks = makeHunks(3)
    expect(nextHunkIndex(hunks, 3, 1)).toBe(0)
    expect(nextHunkIndex(hunks, 3, -1)).toBe(2)
    expect(nextHunkIndex(hunks, 100, 1)).toBe(0)
    expect(nextHunkIndex(hunks, 100, -1)).toBe(2)
    expect(nextHunkIndex(hunks, -7, 1)).toBe(0)
    expect(nextHunkIndex(hunks, -7, -1)).toBe(2)
    expect(nextHunkIndex(hunks, 1.5, 1)).toBe(0)
    expect(nextHunkIndex(hunks, 1.5, -1)).toBe(2)
  })

  it('真实 hunks（buildHunks 产物）上连续遍历覆盖全部 hunk', () => {
    const rows = makeRows(TWO_CHANGES_LEFT, TWO_CHANGES_RIGHT)
    const { hunks } = buildHunks(rows)
    expect(hunks).toHaveLength(2)
    // 从未定位开始正向走：0 → 1 → 回绕 0 → 1。
    let current = -1
    const walked: number[] = []
    for (let step = 0; step < 4; step += 1) {
      current = nextHunkIndex(hunks, current, 1)
      walked.push(current)
    }
    expect(walked).toEqual([0, 1, 0, 1])
    // 从未定位反向走：先到末 hunk。
    expect(nextHunkIndex(hunks, -1, -1)).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/* hunkAnchorRows                                                              */
/* -------------------------------------------------------------------------- */

describe('hunkAnchorRows：引用主路径（buildHunks 产物 × 同一 rows）', () => {
  it('单 hunk：定位与 buildHunks 切片范围一致', () => {
    const rows = makeRows('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'a\nb\nc\nd\nX\nf\ng\nh\ni\nj')
    const { hunks } = buildHunks(rows)
    expect(hunks).toHaveLength(1)
    const anchor = hunkAnchorRows(hunks[0], rows)
    expect(anchor).toEqual(refRange(rows, hunks[0].rows))
    expect(anchor).toEqual({ start: 1, end: 8 })
    expect(rows.slice(anchor.start, anchor.end + 1)).toEqual(hunks[0].rows)
  })

  it('多 hunk：各自定位正确', () => {
    const rows = makeRows(TWO_CHANGES_LEFT, TWO_CHANGES_RIGHT)
    const { hunks } = buildHunks(rows)
    expect(hunks).toHaveLength(2)
    expect(hunkAnchorRows(hunks[0], rows)).toEqual(refRange(rows, hunks[0].rows))
    expect(hunkAnchorRows(hunks[0], rows)).toEqual({ start: 0, end: 6 })
    expect(hunkAnchorRows(hunks[1], rows)).toEqual(refRange(rows, hunks[1].rows))
    expect(hunkAnchorRows(hunks[1], rows)).toEqual({ start: 14, end: 21 })
  })

  it('modify 行场景：rowsWithPairing 产物喂 buildHunks 后定位正确', () => {
    const paired = rowsWithPairing(makeRows('p\nconst x = 1;\nq', 'p\nconst x = 2;\nq'))
    const { hunks } = buildHunks(paired)
    expect(hunks).toHaveLength(1)
    expect(hunkAnchorRows(hunks[0], paired)).toEqual(refRange(paired, hunks[0].rows))
    expect(hunkAnchorRows(hunks[0], paired)).toEqual({ start: 0, end: 2 })

    const { hunks: tight } = buildHunks(paired, 0)
    expect(tight[0].rows).toHaveLength(1)
    expect(hunkAnchorRows(tight[0], paired)).toEqual({ start: 1, end: 1 })
  })

  it('边界：首行变更（区间夹到 0）', () => {
    const rows = makeRows('a\nb\nc', 'A\nb\nc')
    const { hunks } = buildHunks(rows)
    expect(hunkAnchorRows(hunks[0], rows)).toEqual(refRange(rows, hunks[0].rows))
    expect(hunkAnchorRows(hunks[0], rows)).toEqual({ start: 0, end: 3 })
  })

  it('边界：末行变更（区间夹到末尾，contextLines = 0 时紧贴变更行）', () => {
    const rows = makeRows('a\nb\nc', 'a\nb\nC')
    const { hunks } = buildHunks(rows)
    expect(hunkAnchorRows(hunks[0], rows)).toEqual({ start: 0, end: 3 })
    const { hunks: tight } = buildHunks(rows, 0)
    expect(hunkAnchorRows(tight[0], rows)).toEqual({ start: 2, end: 3 })
  })

  it('纯新增 / 纯删除文件（header 行号回退场景）：全文件单 hunk', () => {
    const addedRows = makeRows('', 'x\ny\nz')
    const { hunks: addHunks } = buildHunks(addedRows)
    expect(hunkAnchorRows(addHunks[0], addedRows)).toEqual({ start: 0, end: 2 })

    const delRows = makeRows('x\ny\nz', '')
    const { hunks: delHunks } = buildHunks(delRows)
    expect(hunkAnchorRows(delHunks[0], delRows)).toEqual({ start: 0, end: 2 })
  })
})

describe('hunkAnchorRows：回退策略（rows 与 hunk 非同源时尽力定位）', () => {
  /** 深拷贝 rows：引用全变，type / lineNo / text 不变。 */
  function cloneRows(rows: DiffRow[]): DiffRow[] {
    return JSON.parse(JSON.stringify(rows)) as DiffRow[]
  }

  it('策略 2：rows 重建（引用不同、内容+行号相同）→ 精确命中', () => {
    const rows = makeRows(TWO_CHANGES_LEFT, TWO_CHANGES_RIGHT)
    const cloned = cloneRows(rows)
    const { hunks } = buildHunks(cloned, 1)
    expect(hunks).toHaveLength(2)
    // 对克隆 rows 建 hunk、对原始 rows 定位：引用不匹配，退化为内容+行号匹配。
    expect(hunkAnchorRows(hunks[0], rows)).toEqual({ start: 1, end: 4 })
    expect(hunkAnchorRows(hunks[1], rows)).toEqual({ start: 16, end: 19 })
    // 对同一克隆 rows 定位仍走引用主路径，结果一致。
    expect(hunkAnchorRows(hunks[0], cloned)).toEqual({ start: 1, end: 4 })
  })

  it('策略 3：行号体系不同（整体重编号）→ 按首尾文本尽力命中', () => {
    const rows = makeRows(TWO_CHANGES_LEFT, TWO_CHANGES_RIGHT)
    const renumbered = rows.map((row) => ({
      ...row,
      ...(row.left !== undefined
        ? { left: { ...row.left, lineNo: row.left.lineNo + 1000 } }
        : {}),
      ...(row.right !== undefined
        ? { right: { ...row.right, lineNo: row.right.lineNo + 1000 } }
        : {}),
    }))
    const { hunks } = buildHunks(rows, 0)
    expect(hunks).toHaveLength(2)
    // 行号 +1000 后内容+行号匹配与首行行号匹配都失效，只剩首尾文本匹配。
    expect(hunkAnchorRows(hunks[0], renumbered)).toEqual({ start: 2, end: 3 })
    expect(hunkAnchorRows(hunks[1], renumbered)).toEqual({ start: 17, end: 18 })
  })

  it('策略 4：行号可对上但内容已变 → 仅作滚动锚点（尽力近似）', () => {
    // hunkA：rows [del b(2), add X(2)]；rowsB 行号体系相同但 X 处文本已不同。
    const hunkA = buildHunks(makeRows('a\nb\nc', 'a\nX\nc'), 0).hunks[0]
    const rowsB = makeRows('q\nb\nc', 'q\nY\nc')
    // 引用 / 内容+行号 / 首尾文本（X ≠ Y）均不命中，退为首行行号（2）锚点。
    expect(hunkAnchorRows(hunkA, rowsB)).toEqual({ start: 1, end: 2 })
  })

  it('未命中：返回 {-1, -1}（行号与内容都无法定位）', () => {
    const rows = makeRows('a\nb', 'a\nb')
    // 手工构造幻影 hunk：首行为 add 行（无 left），right.lineNo = 50 在 rows
    // 中不存在，文本 'phantom' 也唯一。
    const phantom: Hunk = {
      header: '@@ -50,1 +50,1 @@',
      rows: [{ type: 'add', right: { lineNo: 50, text: 'phantom' } }],
      oldStart: 50,
      oldLines: 1,
      newStart: 50,
      newLines: 1,
    }
    expect(hunkAnchorRows(phantom, rows)).toEqual({ start: -1, end: -1 })
  })

  it('未命中：hunk 比 rows 还长（无法容纳完整窗口）', () => {
    const bigRows = makeRows('a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nd\ne\nf\nG')
    const bigHunk = buildHunks(bigRows, 3).hunks[0]
    expect(bigHunk.rows.length).toBeGreaterThan(2)
    const smallRows = makeRows('x', 'y')
    expect(hunkAnchorRows(bigHunk, smallRows)).toEqual({ start: -1, end: -1 })
  })

  it('边界：空 hunk.rows / 空 rows → {-1, -1}', () => {
    const emptyHunk: Hunk = {
      header: '@@ -1,0 +1,0 @@',
      rows: [],
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 0,
    }
    expect(hunkAnchorRows(emptyHunk, makeRows('a', 'a'))).toEqual({ start: -1, end: -1 })
    const { hunks } = buildHunks(makeRows('a\nb', 'a\nX\nb'))
    expect(hunkAnchorRows(hunks[0], [])).toEqual({ start: -1, end: -1 })
  })
})

describe('hunkAnchorRows：跨 contextLines 不变量电池', () => {
  const batteries: Array<{ name: string; rows: DiffRow[] }> = [
    { name: '20 行两处变更', rows: makeRows(TWO_CHANGES_LEFT, TWO_CHANGES_RIGHT) },
    { name: '三处变更', rows: makeRows('h1\nh2\nc1\nh3\nh4\nc2\nh5\nh6\nc3\nh7', 'h1\nh2\nC1\nh3\nh4\nC2\nh5\nh6\nC3\nh7') },
    { name: '含 modify 行', rows: rowsWithPairing(makeRows('a\nconst x = 1;\nkeep\nconst y = 2;\nb', 'a\nconst x = 2;\nkeep\nconst y = 3;\nb')) },
    { name: '纯新增', rows: makeRows('', 'a\nb\nc') },
    { name: '纯删除', rows: makeRows('a\nb\nc', '') },
    { name: '全 equal', rows: makeRows('a\nb\nc', 'a\nb\nc') },
    { name: '全变更', rows: makeRows('a\nb', 'x\ny') },
  ]

  for (const battery of batteries) {
    for (const contextLines of [0, 1, 2, 3, 5, 8]) {
      it(`${battery.name} × contextLines=${contextLines}：锚点与切片范围一致且窗口合法`, () => {
        const { hunks } = buildHunks(battery.rows, contextLines)
        for (const hunk of hunks) {
          const anchor = hunkAnchorRows(hunk, battery.rows)
          expect(anchor).toEqual(refRange(battery.rows, hunk.rows))
          // 窗口合法性：end = start + len - 1，且完整落在 rows 内。
          expect(anchor.end).toBe(anchor.start + hunk.rows.length - 1)
          expect(anchor.start).toBeGreaterThanOrEqual(0)
          expect(anchor.end).toBeLessThan(battery.rows.length)
          expect(battery.rows.slice(anchor.start, anchor.end + 1)).toEqual(hunk.rows)
        }
      })
    }
  }
})

describe('sideChangedChars：单侧变更字符数（UI-017）', () => {
  it('纯删除：左侧计删除行文本长度、右侧无对应行计 0', () => {
    const rows = makeRows('aa\nbbb\ncccc', 'x')
    expect(sideChangedChars(rows, 'left')).toBe(2 + 3 + 4)
    expect(sideChangedChars(rows, 'right')).toBe(1)
  })

  it('混合 equal：equal 行不计入，只计 del / add 行', () => {
    const rows = makeRows('a\nb\nc\nd', 'a\nX\nc\nY')
    expect(sideChangedChars(rows, 'left')).toBe(2)
    expect(sideChangedChars(rows, 'right')).toBe(2)
  })

  it('含 modify（rowsWithPairing 产物）：modify 两侧不计入', () => {
    const rows = rowsWithPairing(makeRows('const x =  1;\nkeep', 'const x =  2;\nkeep'))
    expect(rows.some((row) => row.type === 'modify')).toBe(true)
    expect(sideChangedChars(rows, 'left')).toBe(0)
    expect(sideChangedChars(rows, 'right')).toBe(0)
  })

  it('边界：空 rows / 全 equal →  0', () => {
    expect(sideChangedChars([], 'left')).toBe(0)
    expect(sideChangedChars([], 'right')).toBe(0)
    const rows = makeRows('a\nb\nc', 'a\nb\nc')
    expect(sideChangedChars(rows, 'left')).toBe(0)
    expect(sideChangedChars(rows, 'right')).toBe(0)
  })
})
