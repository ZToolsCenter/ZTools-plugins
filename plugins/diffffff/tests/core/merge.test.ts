/**
 * 合并更改单元测试（roadmap 任务 UI-012）。
 *
 * 覆盖 `src/core/merge.ts` 的 `applyHunk` 与 `applyHunkById`：
 * - 方向语义（与任务给定的公式逐字对齐）：l2r = 右侧区间被替换为 hunk.rows
 *   的左侧行文本序列（add 行从右侧消失 = revert、del 行把左文本带入右侧），
 *   r2l 镜像；
 * - 纯 add / 纯 del / 替换（del+add 相邻）hunk 的双向应用，结果与手工构造的
 *   目标文本逐字断言；
 * - 多 hunk 场景：应用中间 hunk 后前后 hunk 区域与上下文行逐字不受影响；
 * - idempotency 语义：应用后用 compareFull 重新 diff，该 hunk 消失
 *   （hunkCount 减少），其余 hunk 保留；
 * - CRLF 文本应用后行号不漂移（重 diff 全 equal、lineNo 逐行对齐）且输出
 *   保留 CRLF 风格；BOM 依据 compareFull 同口径剥除后对齐，输出按目标侧
 *   保真（无 BOM 不添、有 BOM 保留）；尾部换行有则保留、无则不添；
 * - modify 行（手工构造）按其 left.text / right.text 处理；
 * - 防御路径：输入与 rows 不同步仍按区间执行（不抛错）；不可变（入参不被
 *   修改、恒返回新对象）；空侧（纯新增文件 l2r 后目标侧变空串）；
 * - applyHunkById：合法下标与 applyHunk 等价；越界 / 负数 / 非整数返回 null
 *   （选择：不抛错，UI 侧 no-op，理由见 merge.ts 的 JSDoc）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareFull } from '../../src/core/diff'
import { applyHunk, applyHunkById } from '../../src/core/merge'
import type { MergeDirection } from '../../src/core/merge'
import { DEFAULT_OPTIONS } from '../../src/core/options'
import { isDiffError } from '../../src/core/types'
import type { DiffResultOk, DiffRow, Hunk } from '../../src/core/types'

/** 用真实引擎管线构造 hunk fixture（与 UI 消费形态一致：compareFull 产物）。 */
function okResult(left: string, right: string, contextLines = 3): DiffResultOk {
  const result = compareFull(left, right, DEFAULT_OPTIONS, contextLines)
  if (isDiffError(result)) throw new Error(`fixture compareFull 失败：${result.error.kind}`)
  return result
}

afterEach(() => {
  vi.restoreAllMocks()
})

/* -------------------------------------------------------------------------- */
/* 纯 add hunk：双向应用                                                        */
/* -------------------------------------------------------------------------- */

describe('applyHunk：纯 add hunk', () => {
  // right 在 b、c 之间多出 X、Y 两行：rows = eq a, eq b, add X, add Y, eq c；
  // contextLines = 0 → hunk 只含 [add X, add Y]（oldStart 回退为 X 的右侧行号）。
  const left = 'a\nb\nc'
  const right = 'a\nb\nX\nY\nc'

  function fixture(): DiffResultOk {
    const result = okResult(left, right, 0)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].oldLines).toBe(0)
    expect(result.hunks[0].newLines).toBe(2)
    return result
  }

  it('left-to-right：add 行从右侧消失（等价于 revert），left 原样', () => {
    const result = fixture()
    const next = applyHunk({ left, right }, result.rows, result.hunks[0], 'left-to-right')
    // 逐字断言：右侧区间 [X, Y] 被替换为空（hunk 无 left 行）。
    expect(next.right).toBe('a\nb\nc')
    expect(next.left).toBe(left)
  })

  it('right-to-left：左侧多出新增行（左侧区间后插入右侧行序列），right 原样', () => {
    const result = fixture()
    const next = applyHunk({ left, right }, result.rows, result.hunks[0], 'right-to-left')
    expect(next.left).toBe('a\nb\nX\nY\nc')
    expect(next.right).toBe(right)
  })
})

/* -------------------------------------------------------------------------- */
/* 纯 del hunk：双向应用                                                        */
/* -------------------------------------------------------------------------- */

describe('applyHunk：纯 del hunk', () => {
  // left 比 right 多出 X、Y 两行：rows = eq a, eq b, del X, del Y, eq c；
  // contextLines = 0 → hunk 只含 [del X, del Y]（newStart 回退为 X 的左侧行号）。
  const left = 'a\nb\nX\nY\nc'
  const right = 'a\nb\nc'

  function fixture(): DiffResultOk {
    const result = okResult(left, right, 0)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].oldLines).toBe(2)
    expect(result.hunks[0].newLines).toBe(0)
    return result
  }

  it('left-to-right：右侧补回被删行（del 行把左文本带入右侧），left 原样', () => {
    const result = fixture()
    const next = applyHunk({ left, right }, result.rows, result.hunks[0], 'left-to-right')
    expect(next.right).toBe('a\nb\nX\nY\nc')
    expect(next.left).toBe(left)
  })

  it('right-to-left：左侧区间被替换为右侧行序列 → del 行被撤销（revert），right 原样', () => {
    const result = fixture()
    const next = applyHunk({ left, right }, result.rows, result.hunks[0], 'right-to-left')
    expect(next.left).toBe('a\nb\nc')
    expect(next.right).toBe(right)
  })
})

/* -------------------------------------------------------------------------- */
/* 替换 hunk（del+add 相邻）：双向应用                                          */
/* -------------------------------------------------------------------------- */

describe('applyHunk：替换 hunk（del+add 相邻）', () => {
  const left = 'a\nold1\nold2\nb'
  const right = 'a\nnew1\nnew2\nnew3\nb'

  function fixture(): DiffResultOk {
    const result = okResult(left, right, 0)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].rows.map((r) => r.type)).toEqual(['del', 'del', 'add', 'add', 'add'])
    return result
  }

  it('left-to-right：右侧区间被替换为左侧行序列，结果与 left 逐字一致', () => {
    const result = fixture()
    const next = applyHunk({ left, right }, result.rows, result.hunks[0], 'left-to-right')
    expect(next.right).toBe('a\nold1\nold2\nb')
    expect(next.left).toBe(left)
  })

  it('right-to-left：左侧区间被替换为右侧行序列，结果与 right 逐字一致', () => {
    const result = fixture()
    const next = applyHunk({ left, right }, result.rows, result.hunks[0], 'right-to-left')
    expect(next.left).toBe('a\nnew1\nnew2\nnew3\nb')
    expect(next.right).toBe(right)
  })
})

/* -------------------------------------------------------------------------- */
/* 多 hunk：应用中间 hunk（上下文行保留）                                       */
/* -------------------------------------------------------------------------- */

describe('applyHunk：多 hunk 中间 hunk 应用', () => {
  // 30 行文件三处变更（间隔 > 2*3 行，contextLines = 3 下为三个独立 hunk）：
  // A：第 3 行 3 → T3；B：在 15 之后插入 INS；C：第 25 行 25 → B25。
  const left = [
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  ].join('\n')
  const right = [
    '1', '2', 'T3', '4', '5', '6', '7', '8', '9', '10',
    '11', '12', '13', '14', '15', 'INS', '16', '17', '18', '19',
    '20', '21', '22', '23', '24', 'B25', '26', '27', '28', '29', '30',
  ].join('\n')

  function fixture(): DiffResultOk {
    const result = okResult(left, right, 3)
    expect(result.hunks).toHaveLength(3)
    // 中间 hunk（下标 1）= INS 插入 ± 3 行上下文：eq13,14,15, addINS, eq16,17,18。
    expect(result.hunks[1].rows.map((r) => r.type)).toEqual([
      'equal', 'equal', 'equal', 'add', 'equal', 'equal', 'equal',
    ])
    return result
  }

  it('left-to-right：撤销中间插入，前后 hunk 区域（T3 / B25）逐字不受影响', () => {
    const result = fixture()
    const next = applyHunk({ left, right }, result.rows, result.hunks[1], 'left-to-right')
    expect(next.left).toBe(left)
    // 手工构造的目标文本：INS 消失，T3 / B25 与全部上下文行原样保留。
    expect(next.right).toBe(
      [
        '1', '2', 'T3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
        '21', '22', '23', '24', 'B25', '26', '27', '28', '29', '30',
      ].join('\n'),
    )
  })

  it('right-to-left：把中间插入应用到左侧，上下文行各保留一份、right 原样', () => {
    const result = fixture()
    const next = applyHunk({ left, right }, result.rows, result.hunks[1], 'right-to-left')
    expect(next.right).toBe(right)
    // 手工构造的目标文本：left 在 15 之后多出 INS，其余逐字不变。
    expect(next.left).toBe(
      [
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
        '11', '12', '13', '14', '15', 'INS', '16', '17', '18', '19',
        '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
      ].join('\n'),
    )
  })

  it('应用后重新 diff：该 hunk 消失（hunkCount 3 → 2），前后 hunk 保留', () => {
    const result = fixture()
    const l2r = applyHunk({ left, right }, result.rows, result.hunks[1], 'left-to-right')
    const rediffL2r = okResult(l2r.left, l2r.right, 0)
    expect(rediffL2r.stats.hunkCount).toBe(2)
    expect(rediffL2r.hunks.map((h) => h.oldStart)).toEqual([3, 25])

    const r2l = applyHunk({ left, right }, result.rows, result.hunks[1], 'right-to-left')
    const rediffR2l = okResult(r2l.left, r2l.right, 0)
    expect(rediffR2l.stats.hunkCount).toBe(2)
    expect(rediffR2l.hunks.map((h) => h.oldStart)).toEqual([3, 26])
  })
})

/* -------------------------------------------------------------------------- */
/* idempotency：应用后该 hunk 消失（compareFull 验证）                           */
/* -------------------------------------------------------------------------- */

describe('applyHunk：idempotency 语义', () => {
  it('纯 add revert 后重新对比：hunkCount 归零、统计归零', () => {
    const result = okResult('a\nb\nc', 'a\nb\nX\nY\nc', 0)
    const next = applyHunk(
      { left: 'a\nb\nc', right: 'a\nb\nX\nY\nc' },
      result.rows,
      result.hunks[0],
      'left-to-right',
    )
    const rediff = okResult(next.left, next.right, 0)
    expect(rediff.hunks).toHaveLength(0)
    expect(rediff.stats.hunkCount).toBe(0)
    expect(rediff.stats.addedLines).toBe(0)
    expect(rediff.stats.removedLines).toBe(0)
    expect(rediff.stats.totalRows).toBe(3)
  })
})

/* -------------------------------------------------------------------------- */
/* CRLF / BOM / 尾部换行                                                        */
/* -------------------------------------------------------------------------- */

describe('applyHunk：CRLF / BOM / 尾部换行', () => {
  it('CRLF 文本：应用后行号不漂移（重 diff 全 equal、lineNo 逐行对齐），输出保留 CRLF', () => {
    const left = 'a\r\nb\r\nc\r\nd\r\ne'
    const right = 'a\r\nb\r\nX\r\nd\r\ne'
    const result = okResult(left, right, 0)
    expect(result.hunks).toHaveLength(1)
    const next = applyHunk({ left, right }, result.rows, result.hunks[0], 'left-to-right')
    // 输出保留目标侧的 CRLF 行尾风格，且与 left 逐字一致。
    expect(next.right).toBe('a\r\nb\r\nc\r\nd\r\ne')
    // 重 diff：无差异、两侧行号 1..5 逐行对齐（行号不漂移）。
    const rediff = okResult(next.left, next.right, 0)
    expect(rediff.hunks).toHaveLength(0)
    expect(rediff.rows).toHaveLength(5)
    rediff.rows.forEach((row, i) => {
      expect(row.left !== undefined ? row.left.lineNo : -1).toBe(i + 1)
      expect(row.right !== undefined ? row.right.lineNo : -1).toBe(i + 1)
    })
  })

  it('BOM：剥除后行号对齐；输出按目标侧保真（无 BOM 不添、有 BOM 保留）', () => {
    const left = '\uFEFFa\nb\nc'
    const right = 'a\nb\nX\nc'
    const result = okResult(left, right, 0)
    // hunk [add X]：oldStart 回退为 X 的右侧行号 3（BOM 已在引擎入口剥除）。
    expect(result.hunks[0].newStart).toBe(3)
    const l2r = applyHunk({ left, right }, result.rows, result.hunks[0], 'left-to-right')
    // 目标侧（right）原本无 BOM → 输出无 BOM。
    expect(l2r.right).toBe('a\nb\nc')
    expect(l2r.left).toBe(left)
    const r2l = applyHunk({ left, right }, result.rows, result.hunks[0], 'right-to-left')
    // 目标侧（left）原本有 BOM → 输出保留 BOM。
    expect(r2l.left).toBe('\uFEFFa\nb\nX\nc')
    expect(r2l.right).toBe(right)
    // 重新对比：BOM 差异不产生幻影 hunk。
    const rediff = okResult(l2r.left, l2r.right, 0)
    expect(rediff.hunks).toHaveLength(0)
  })

  it('尾部换行：目标侧原文有则保留、无则不添加', () => {
    const withNl = okResult('a\nb\n', 'a\nb\nX\n', 0)
    const next1 = applyHunk(
      { left: 'a\nb\n', right: 'a\nb\nX\n' },
      withNl.rows,
      withNl.hunks[0],
      'left-to-right',
    )
    expect(next1.right).toBe('a\nb\n')

    const noNl = okResult('a\nb', 'a\nb\nX', 0)
    const next2 = applyHunk(
      { left: 'a\nb', right: 'a\nb\nX' },
      noNl.rows,
      noNl.hunks[0],
      'left-to-right',
    )
    expect(next2.right).toBe('a\nb')
  })
})

/* -------------------------------------------------------------------------- */
/* modify 行与防御路径                                                          */
/* -------------------------------------------------------------------------- */

describe('applyHunk：modify 行与防御路径', () => {
  it('modify 行（配对后 rows）：l2r 按 left.text、r2l 按 right.text 处理', () => {
    const rows: DiffRow[] = [
      { type: 'equal', left: { lineNo: 1, text: 'x' }, right: { lineNo: 1, text: 'x' } },
      { type: 'modify', left: { lineNo: 2, text: 'old line' }, right: { lineNo: 2, text: 'new line' } },
      { type: 'equal', left: { lineNo: 3, text: 'y' }, right: { lineNo: 3, text: 'y' } },
    ]
    const hunk: Hunk = {
      header: '@@ -1,3 +1,3 @@',
      rows,
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
    }
    const texts = { left: 'x\nold line\ny', right: 'x\nnew line\ny' }
    const l2r = applyHunk(texts, rows, hunk, 'left-to-right')
    expect(l2r.right).toBe('x\nold line\ny')
    expect(l2r.left).toBe(texts.left)
    const r2l = applyHunk(texts, rows, hunk, 'right-to-left')
    expect(r2l.left).toBe('x\nnew line\ny')
    expect(r2l.right).toBe(texts.right)
  })

  it('输入与 rows 不同步：仍按区间执行（调用方契约）、不抛错', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    // hunk 来自 'a\nb\nc' vs 'a\nX\nc'（[del b, add X]），但传入完全不同的文本。
    const result = okResult('a\nb\nc', 'a\nX\nc', 0)
    const next = applyHunk(
      { left: 'p\nq\nr', right: 'p\nq\nr' },
      result.rows,
      result.hunks[0],
      'left-to-right',
    )
    // 区间下标来自 hunk 计数（oldStart=2/oldLines=1、newStart=2/newLines=1）：
    // 右侧区间 [1,2) 被 hunk.rows 的左侧行文本 ['b'] 替换，左侧不变。
    expect(next.left).toBe('p\nq\nr')
    expect(next.right).toBe('p\nb\nr')
    expect(debugSpy).toHaveBeenCalled()
  })

  it('不可变：入参 texts / rows / hunk 不被修改，恒返回新对象', () => {
    const result = okResult('a\nb\nc', 'a\nb\nX\nc', 0)
    const texts = { left: 'a\nb\nc', right: 'a\nb\nX\nc' }
    const textsSnapshot = JSON.parse(JSON.stringify(texts))
    const rowsSnapshot = JSON.parse(JSON.stringify(result.rows))
    const hunkSnapshot = JSON.parse(JSON.stringify(result.hunks[0]))
    const next = applyHunk(texts, result.rows, result.hunks[0], 'right-to-left')
    expect(next).not.toBe(texts)
    expect(texts).toEqual(textsSnapshot)
    expect(result.rows).toEqual(rowsSnapshot)
    expect(result.hunks[0]).toEqual(hunkSnapshot)
  })

  it('空侧：left 为空（整侧纯新增）时 l2r 撤销全部新增，right 变空串', () => {
    const result = okResult('', 'x\ny', 0)
    expect(result.rows.map((r) => r.type)).toEqual(['add', 'add'])
    const next = applyHunk({ left: '', right: 'x\ny' }, result.rows, result.hunks[0], 'left-to-right')
    expect(next.left).toBe('')
    expect(next.right).toBe('')
  })
})

/* -------------------------------------------------------------------------- */
/* applyHunkById                                                               */
/* -------------------------------------------------------------------------- */

describe('applyHunkById', () => {
  const left = 'a\nb\nc'
  const right = 'a\nb\nX\nc'

  it('合法下标：与 applyHunk(hunks[i]) 结果一致', () => {
    const result = okResult(left, right, 0)
    const texts = { left, right }
    expect(applyHunkById(texts, result.rows, result.hunks, 0, 'right-to-left')).toEqual(
      applyHunk(texts, result.rows, result.hunks[0], 'right-to-left'),
    )
  })

  it('越界 / 负数 / 非整数下标返回 null（选择：不抛错，UI 侧 no-op）', () => {
    const result = okResult(left, right, 0)
    const texts = { left, right }
    expect(applyHunkById(texts, result.rows, result.hunks, -1, 'left-to-right')).toBeNull()
    expect(applyHunkById(texts, result.rows, result.hunks, 1, 'left-to-right')).toBeNull()
    expect(applyHunkById(texts, result.rows, result.hunks, 0.5, 'left-to-right')).toBeNull()
    expect(applyHunkById(texts, result.rows, [], 0, 'left-to-right')).toBeNull()
  })

  it('direction 字面量约束：仅接受两个方向的联合类型（编译期契约）', () => {
    const result = okResult(left, right, 0)
    const directions: MergeDirection[] = ['left-to-right', 'right-to-left']
    for (const direction of directions) {
      const next = applyHunk({ left, right }, result.rows, result.hunks[0], direction)
      expect(typeof next.left).toBe('string')
      expect(typeof next.right).toBe('string')
    }
  })
})
