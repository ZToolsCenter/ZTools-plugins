/**
 * hunk 模型单元测试（roadmap 任务 ENG-008）。
 *
 * 覆盖 `src/core/hunks.ts` 的 `buildHunks` 与 `src/core/diff.ts` 的接线：
 * - 单一变更 + 默认上下文 3：hunk 覆盖范围、@@ 头四个计数逐项断言、无折叠；
 * - 两处变更相距 > 2 * contextLines：两个 hunk + 一个 CollapseRange
 *   （beforeRow / count 按 types.ts 约定下标断言，并验证被折叠区段确为 equal）；
 * - 簇合并阈值边界：间隔恰为 2 * contextLines 合并单 hunk；间隔恰为
 *   2 * contextLines + 1 拆开（折叠区段恰为 1 行）；
 * - contextLines = 0 / 1 对照（0 时 hunk 紧贴变更行、间隔 equal 全折叠）；
 * - 边界：全 equal（不折叠全文件）、全变更（单 hunk 全覆盖）、空 rows；
 * - modify 行场景：rowsWithPairing 产物喂入 —— modify 行左右两侧同时计入
 *   oldLines / newLines，@@ 头正确；
 * - hunk.rows 与全量 rows 的切片一致性（引用相同 + 内容一致）；
 * - 结构不变量：collapses 升序、互不重叠、count > 0、折叠区段全 equal，
 *   hunk 覆盖区 ∪ 折叠区 ∪ 头尾未折叠 equal 区 = 全部 rows 下标（不重不漏）；
 * - compareFull 接线：hunks / collapses / stats.hunkCount 正确、contextLines
 *   默认 3 且第 4 参可调；compare()（无选项入口）保持空占位。
 */
import { describe, expect, it } from 'vitest'
import { buildHunks } from '../../src/core/hunks'
import { compare, compareFull, diffLinesCore } from '../../src/core/diff'
import { rowsWithPairing } from '../../src/core/pairing'
import { DEFAULT_OPTIONS } from '../../src/core/options'
import type { DiffRow } from '../../src/core/types'

/** 用真实行级 diff 构造带 1-based 行号的行骨架（测试输入统一入口）。 */
function makeRows(left: string, right: string): DiffRow[] {
  return diffLinesCore(left, right)
}

/** 生成 'l1'..'lN' 形式的 N 行文本。 */
function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `l${i + 1}`).join('\n')
}

/** 定位 hunk 在全量 rows 中的 0-based 起止下标（依赖切片共享行对象引用）。 */
function hunkRange(rows: DiffRow[], hunkRows: DiffRow[]): { start: number; end: number } {
  const start = rows.indexOf(hunkRows[0])
  const end = rows.indexOf(hunkRows[hunkRows.length - 1])
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThanOrEqual(start)
  expect(end - start + 1).toBe(hunkRows.length)
  return { start, end }
}

/* -------------------------------------------------------------------------- */
/* 单一变更 + 默认上下文                                                        */
/* -------------------------------------------------------------------------- */

describe('buildHunks：单一变更 + 默认上下文 3', () => {
  // 10 行文件第 5 行 e → X：rows = equal×4, del, add, equal×5（11 行），
  // 变更在下标 4、5，向两侧各扩 3 行 → hunk 覆盖下标 [1, 8]。
  const left = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj'
  const right = 'a\nb\nc\nd\nX\nf\ng\nh\ni\nj'

  it('hunk 覆盖变更 ± 3 行，rows 为连续切片', () => {
    const rows = makeRows(left, right)
    const { hunks, collapses } = buildHunks(rows)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].rows.map((r) => r.type)).toEqual([
      'equal', 'equal', 'equal', 'del', 'add', 'equal', 'equal', 'equal',
    ])
    expect(hunks[0].rows.map((r) => (r.left ?? r.right)!.text)).toEqual([
      'b', 'c', 'd', 'e', 'X', 'f', 'g', 'h',
    ])
    expect(collapses).toEqual([])
  })

  it('header 四个计数逐项正确（oldStart/newStart/oldLines/newLines）', () => {
    const rows = makeRows(left, right)
    const { hunks } = buildHunks(rows)
    // 切片 [1,8]：左侧行号 2..8 中 add 无 left → oldLines = 7；右侧 del 无
    // right → newLines = 7；首行 b 两侧都有 → oldStart = newStart = 2。
    expect(hunks[0].oldStart).toBe(2)
    expect(hunks[0].oldLines).toBe(7)
    expect(hunks[0].newStart).toBe(2)
    expect(hunks[0].newLines).toBe(7)
    expect(hunks[0].header).toBe('@@ -2,7 +2,7 @@')
  })

  it('文件开头变更：首行为 del 时 newStart 取 left.lineNo，区间夹到上边界 0', () => {
    const rows = makeRows('a\nb\nc', 'A\nb\nc')
    const { hunks, collapses } = buildHunks(rows)
    expect(hunks).toHaveLength(1)
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 0, end: 3 })
    // 首行 del a 无 right → newStart 取 left.lineNo = 1；oldLines = del+equal+equal = 3，
    // newLines = add+equal+equal = 3。
    expect(hunks[0].header).toBe('@@ -1,3 +1,3 @@')
    expect(collapses).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* 两处变更相距 > 2*context：两个 hunk + 一个 CollapseRange                     */
/* -------------------------------------------------------------------------- */

describe('buildHunks：两处变更相距 > 2*contextLines', () => {
  // 20 行文件第 3、17 行被修改：rows（22 行）变更下标 2,3 与 17,18，
  // 间隔 13 > 6 → 两个簇。
  const left = numberedLines(20)
  const right = numberedLines(20)
    .replace('l3', 'L3-changed')
    .replace('l17', 'L17-changed')

  it('产出两个 hunk 与一个 CollapseRange', () => {
    const rows = makeRows(left, right)
    expect(rows).toHaveLength(22)
    const { hunks, collapses } = buildHunks(rows)
    expect(hunks).toHaveLength(2)
    expect(collapses).toHaveLength(1)
  })

  it('hunk 区间与 @@ 头正确（含文件边界的收缩）', () => {
    const rows = makeRows(left, right)
    const { hunks } = buildHunks(rows)
    // hunk 1：簇 [2,3] 向前扩 3 行被边界夹到 0，向后扩到 6。切片 7 行 =
    // l1,l2,l3(del),L3-changed(add),l4,l5,l6 → oldLines = 6（l1,l2,l3,l4,l5,l6）、
    // newLines = 6（l1,l2,L3-changed,l4,l5,l6）。
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 0, end: 6 })
    expect(hunks[0].header).toBe('@@ -1,6 +1,6 @@')
    // hunk 2：簇 [17,18] 向前扩到 14，向后扩 3 行被边界夹到 21。切片 8 行 =
    // l14,l15,l16,l17(del),L17-changed(add),l18,l19,l20 → oldLines = 7、
    // newLines = 7，首行 l14 的行号 14。
    expect(hunkRange(rows, hunks[1].rows)).toEqual({ start: 14, end: 21 })
    expect(hunks[1].header).toBe('@@ -14,7 +14,7 @@')
  })

  it('CollapseRange 下标符合 types.ts 约定，被折叠区段确为 equal 行', () => {
    const rows = makeRows(left, right)
    const { collapses } = buildHunks(rows)
    // 未入 hunk 的缝隙 = 下标 [7, 13]（l7..l13，7 行）：beforeRow = 缝隙之后
    // 第一行的下标 14，覆盖 rows[14 - 7, 14)。
    expect(collapses[0]).toEqual({ beforeRow: 14, count: 7 })
    for (let i = 14 - 7; i < 14; i += 1) {
      expect(rows[i].type).toBe('equal')
      expect((rows[i].left ?? rows[i].right)!.text).toBe(`l${i}`)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 簇合并阈值：间隔 ≤ 2*context 合并，> 2*context 拆开                          */
/* -------------------------------------------------------------------------- */

describe('buildHunks：簇合并阈值边界', () => {
  // 两个变更簇之间隔着恰 6 行 equal（= 2 * 3）→ 合并为一个 hunk。
  const mergeLeft = 'a1\na2\nx\na3\na4\na5\na6\na7\na8\ny\na9\na10'
  const mergeRight = 'a1\na2\nX\na3\na4\na5\na6\na7\na8\nY\na9\na10'
  // 隔着恰 7 行 equal（= 2 * 3 + 1）→ 拆开，缝隙恰为 1 行。
  const splitLeft = 'a1\na2\nx\na3\na4\na5\na6\na7\na8\na9\ny\na10\na11'
  const splitRight = 'a1\na2\nX\na3\na4\na5\na6\na7\na8\na9\nY\na10\na11'

  it('间隔恰为 2*contextLines → 合并为一个 hunk，无折叠', () => {
    const rows = makeRows(mergeLeft, mergeRight)
    const { hunks, collapses } = buildHunks(rows)
    expect(hunks).toHaveLength(1)
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 0, end: rows.length - 1 })
    // 左侧 12 行全在 hunk 内（x、y 计 old），右侧 12 行同（X、Y 计 new）。
    expect(hunks[0].header).toBe('@@ -1,12 +1,12 @@')
    expect(collapses).toEqual([])
  })

  it('间隔恰为 2*contextLines + 1 → 两个 hunk + 恰 1 行的 CollapseRange', () => {
    const rows = makeRows(splitLeft, splitRight)
    const { hunks, collapses } = buildHunks(rows)
    expect(hunks).toHaveLength(2)
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 0, end: 6 })
    expect(hunkRange(rows, hunks[1].rows)).toEqual({ start: 8, end: 14 })
    // 缝隙 = 下标 7（a6）单独一行：beforeRow = 8，count = 1。
    expect(collapses).toEqual([{ beforeRow: 8, count: 1 }])
    expect(rows[7].type).toBe('equal')
    // hunk 2 切片 7 行 = a7,a8,a9,y(del),Y(add),a10,a11。左文件中 x 占第 3
    // 行，故 a7 的 left.lineNo = 8 → oldStart = 8；oldLines = a7,a8,a9,y,
    // a10,a11 = 6、newLines = a7,a8,a9,Y,a10,a11 = 6。
    expect(hunks[1].header).toBe('@@ -8,6 +8,6 @@')
  })
})

/* -------------------------------------------------------------------------- */
/* contextLines = 0 与 1 对照                                                  */
/* -------------------------------------------------------------------------- */

describe('buildHunks：contextLines 调节', () => {
  const left = 'a\nb\nc'
  const right = 'a\nB\nc'
  // rows：equal a(下标 0)、del b(1)、add B(2)、equal c(3)。

  it('contextLines = 0：hunk 紧贴变更行，计数为 1 时仍保留 ",1"', () => {
    const rows = makeRows(left, right)
    const { hunks, collapses } = buildHunks(rows, 0)
    expect(hunks).toHaveLength(1)
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 1, end: 2 })
    // 首行 del b：oldStart = left.lineNo = 2；add B 无 left → newStart = right.lineNo = 2；
    // git 惯例单行计数可省略为 `@@ -2 +2 @@`，本实现统一保留 ",1"（已知差异）。
    expect(hunks[0].header).toBe('@@ -2,1 +2,1 @@')
    expect(collapses).toEqual([])
  })

  it('contextLines = 1：上下文各 1 行', () => {
    const rows = makeRows(left, right)
    const { hunks } = buildHunks(rows, 1)
    expect(hunks).toHaveLength(1)
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 0, end: 3 })
    expect(hunks[0].header).toBe('@@ -1,3 +1,3 @@')
  })

  it('contextLines = 0 时两处变更之间的 equal 行全部折叠', () => {
    // rows：eq a, del x, add X, eq b, del y, add Y, eq c（变更 1,2 与 4,5，
    // 间隔 1 行 > 0 → 拆开，缝隙恰 1 行）。
    const rows = makeRows('a\nx\nb\ny\nc', 'a\nX\nb\nY\nc')
    const { hunks, collapses } = buildHunks(rows, 0)
    expect(hunks).toHaveLength(2)
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 1, end: 2 })
    expect(hunkRange(rows, hunks[1].rows)).toEqual({ start: 4, end: 5 })
    expect(collapses).toEqual([{ beforeRow: 4, count: 1 }])
  })
})

/* -------------------------------------------------------------------------- */
/* 边界：全 equal / 全变更 / 空 rows                                            */
/* -------------------------------------------------------------------------- */

describe('buildHunks：边界行为', () => {
  it('全部行 equal → 无 hunk 且不折叠全文件', () => {
    const rows = makeRows('a\nb\nc', 'a\nb\nc')
    expect(buildHunks(rows)).toEqual({ hunks: [], collapses: [] })
    expect(buildHunks(rows, 0)).toEqual({ hunks: [], collapses: [] })
  })

  it('全部行变更 → 单 hunk 覆盖全部行、无折叠', () => {
    const rows = makeRows('a\nb', 'x\ny')
    const { hunks, collapses } = buildHunks(rows)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].rows).toHaveLength(rows.length)
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 0, end: rows.length - 1 })
    expect(hunks[0].header).toBe('@@ -1,2 +1,2 @@')
    expect(collapses).toEqual([])
  })

  it('空 rows → 空 hunks 与空 collapses（任意 contextLines）', () => {
    expect(buildHunks([])).toEqual({ hunks: [], collapses: [] })
    expect(buildHunks([], 0)).toEqual({ hunks: [], collapses: [] })
    expect(buildHunks([], 5)).toEqual({ hunks: [], collapses: [] })
  })
})

/* -------------------------------------------------------------------------- */
/* modify 行（rowsWithPairing 产物）                                            */
/* -------------------------------------------------------------------------- */

describe('buildHunks：modify 行场景', () => {
  // 第 2 行 'const x = 1;' → 'const x = 2;' 相似度 ≥ 0.5，被 rowsWithPairing
  // 配成 modify 行（left / right 同时存在）。
  const left = 'p\nconst x = 1;\nq'
  const right = 'p\nconst x = 2;\nq'

  function pairedRows(): DiffRow[] {
    const paired = rowsWithPairing(makeRows(left, right))
    // 守卫：确认配对确实发生了，否则本组断言退化为 del/add 场景。
    expect(paired.map((r) => r.type)).toEqual(['equal', 'modify', 'equal'])
    return paired
  }

  it('modify 行同时计入 oldLines 与 newLines，header 正确', () => {
    const rows = pairedRows()
    const { hunks, collapses } = buildHunks(rows)
    expect(hunks).toHaveLength(1)
    expect(hunkRange(rows, hunks[0].rows)).toEqual({ start: 0, end: 2 })
    // 左侧：p、modify.left、q = 3 行；右侧：p、modify.right、q = 3 行。
    expect(hunks[0].header).toBe('@@ -1,3 +1,3 @@')
    expect(hunks[0].oldLines).toBe(3)
    expect(hunks[0].newLines).toBe(3)
    expect(collapses).toEqual([])
  })

  it('contextLines = 0：hunk 只含 modify 行，oldStart/newStart 各取双侧行号', () => {
    const rows = pairedRows()
    const { hunks } = buildHunks(rows, 0)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].rows).toHaveLength(1)
    expect(hunks[0].rows[0].type).toBe('modify')
    // modify 行 left.lineNo 与 right.lineNo 均为 2（左右两列各自独立计数）。
    expect(hunks[0].oldStart).toBe(2)
    expect(hunks[0].newStart).toBe(2)
    expect(hunks[0].header).toBe('@@ -2,1 +2,1 @@')
  })
})

/* -------------------------------------------------------------------------- */
/* 切片一致性与结构不变量                                                       */
/* -------------------------------------------------------------------------- */

describe('buildHunks：切片与结构不变量', () => {
  /** 结构不变量：hunk 与 collapse 按位置严格交替（hunk[0], collapse[0],
   *  hunk[1], …，折叠区恰为相邻 hunk 之间的无缝缝隙）；hunk 区间连续、
   *  collapse 区段全 equal 且 count > 0；hunk 覆盖区 ∪ 折叠区 ∪ 头尾未覆盖
   *  = 全部 rows 下标（未覆盖者必为 equal，即文件头尾外侧不折叠的 equal 行）。 */
  function checkInvariants(rows: DiffRow[], contextLines: number) {
    const { hunks, collapses } = buildHunks(rows, contextLines)
    expect(collapses).toHaveLength(Math.max(0, hunks.length - 1))
    const covered = new Array<boolean>(rows.length).fill(false)
    let lastEnd = -1

    for (let k = 0; k < hunks.length; k += 1) {
      const { start, end } = hunkRange(rows, hunks[k].rows)
      // 首 hunk 之前是不折叠的文件头 equal 区（可留白）；其余 hunk 与前一个
      // 折叠区无缝相接。
      if (k === 0) expect(start).toBeGreaterThanOrEqual(lastEnd + 1)
      else expect(start).toBe(lastEnd + 1)
      for (let i = start; i <= end; i += 1) {
        expect(covered[i]).toBe(false)
        covered[i] = true
      }
      lastEnd = end

      if (k < collapses.length) {
        const collapse = collapses[k]
        expect(collapse.count).toBeGreaterThan(0)
        const collapseStart = collapse.beforeRow - collapse.count
        expect(collapseStart).toBeGreaterThanOrEqual(0)
        expect(collapse.beforeRow).toBeLessThanOrEqual(rows.length)
        // 折叠区紧跟当前 hunk 的末行，结束于下一 hunk 的首行之前。
        expect(collapseStart).toBe(lastEnd + 1)
        for (let i = collapseStart; i < collapse.beforeRow; i += 1) {
          expect(rows[i].type).toBe('equal')
          expect(covered[i]).toBe(false)
          covered[i] = true
        }
        lastEnd = collapse.beforeRow - 1
      }
    }

    for (let i = 0; i < rows.length; i += 1) {
      if (!covered[i]) expect(rows[i].type).toBe('equal')
    }
  }

  /** 切片一致性：hunk.rows 与全量 rows 对应下标的行是同一对象（引用相同），
   *  内容也随之逐项一致。 */
  function checkSliceIdentity(rows: DiffRow[], contextLines: number) {
    const { hunks } = buildHunks(rows, contextLines)
    for (const hunk of hunks) {
      const { start } = hunkRange(rows, hunk.rows)
      hunk.rows.forEach((row, i) => {
        expect(row).toBe(rows[start + i])
      })
      expect(hunk.rows).toEqual(rows.slice(start, start + hunk.rows.length))
    }
  }

  const batteries: Array<{ name: string; rows: DiffRow[] }> = [
    { name: '20 行两处变更', rows: makeRows(numberedLines(20), numberedLines(20).replace('l3', 'L3x').replace('l17', 'L17x')) },
    { name: '三处变更', rows: makeRows('h1\nh2\nc1\nh3\nh4\nc2\nh5\nh6\nc3\nh7', 'h1\nh2\nC1\nh3\nh4\nC2\nh5\nh6\nC3\nh7') },
    { name: '单一变更', rows: makeRows('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'a\nb\nc\nd\nX\nf\ng\nh\ni\nj') },
    { name: '纯新增', rows: makeRows('', 'a\nb\nc') },
    { name: '纯删除', rows: makeRows('a\nb\nc', '') },
    { name: '全 equal', rows: makeRows('a\nb\nc', 'a\nb\nc') },
    { name: '全变更', rows: makeRows('a\nb', 'x\ny') },
  ]

  for (const battery of batteries) {
    for (const contextLines of [0, 1, 2, 3, 5, 8]) {
      it(`${battery.name} × contextLines=${contextLines}：不变量与切片引用成立`, () => {
        checkInvariants(battery.rows, contextLines)
        checkSliceIdentity(battery.rows, contextLines)
      })
    }
  }
})

/* -------------------------------------------------------------------------- */
/* compareFull 接线                                                            */
/* -------------------------------------------------------------------------- */

describe('compareFull 接线（ENG-008）', () => {
  const left = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj'
  const right = 'a\nb\nc\nd\nX\nf\ng\nh\ni\nj'

  it('默认 contextLines = 3：hunks / collapses / hunkCount 正确', () => {
    const result = compareFull(left, right, DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.hunks).toHaveLength(1)
    expect(result.collapses).toEqual([])
    expect(result.hunks[0].header).toBe('@@ -2,7 +2,7 @@')
    expect(result.stats.hunkCount).toBe(1)
    expect(result.stats.hunkCount).toBe(result.hunks.length)
  })

  it('默认值与显式 buildHunks(rows, 3) 投影一致', () => {
    const result = compareFull(left, right, DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const expected = buildHunks(result.rows, 3)
    expect(result.hunks).toEqual(expected.hunks)
    expect(result.collapses).toEqual(expected.collapses)
  })

  it('第 4 参可调：contextLines = 1 / 0 的 hunk 覆盖随之收缩', () => {
    const result1 = compareFull(left, right, DEFAULT_OPTIONS, 1)
    expect(result1.ok).toBe(true)
    if (!result1.ok) return
    expect(result1.hunks).toEqual(buildHunks(result1.rows, 1).hunks)
    // 上下文各 1 行：切片 [3, 6] = d, e(del), X(add), f。
    expect(result1.hunks[0].header).toBe('@@ -4,3 +4,3 @@')

    const result0 = compareFull(left, right, DEFAULT_OPTIONS, 0)
    expect(result0.ok).toBe(true)
    if (!result0.ok) return
    // 紧贴变更行：切片 [4, 5] = e(del), X(add)。
    expect(result0.hunks[0].header).toBe('@@ -5,1 +5,1 @@')
    expect(result0.stats.hunkCount).toBe(result0.hunks.length)
  })

  it('compare()（无选项入口）保持空占位，注释指向 compareFull', () => {
    const result = compare(left, right)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.hunks).toEqual([])
    expect(result.collapses).toEqual([])
    expect(result.stats.hunkCount).toBe(0)
  })
})
