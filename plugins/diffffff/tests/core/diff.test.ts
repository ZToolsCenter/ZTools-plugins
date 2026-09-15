/**
 * diff 引擎单元测试（roadmap 任务 ENG-001：行级 diff）。
 *
 * 覆盖 `src/core/diff.ts` 的三个导出：
 * - `splitLines`：三种换行符切分、空串、尾部换行；
 * - `diffLinesCore`：相同 / 纯增 / 纯删 / 中间插入 / 中间删除 / 替换 /
 *   多块增删交错，以及空侧、CRLF-LF 混合、中文与 tab 内容；
 * - `compare`：统计数字、hunks/collapses 占位、防御式 internal 错误。
 *
 * 多块混合用例对每一行的 type / lineNo / text 做逐行精确断言。
 */
import { describe, expect, it } from 'vitest'
import { compare, diffLinesCore, splitLines } from '../../src/core/diff'

/* -------------------------------------------------------------------------- */
/* splitLines                                                                  */
/* -------------------------------------------------------------------------- */

describe('splitLines', () => {
  it('空字符串返回 []（0 行）', () => {
    expect(splitLines('')).toEqual([])
  })

  it('无换行符的非空文本返回单元素数组', () => {
    expect(splitLines('a')).toEqual(['a'])
  })

  it('尾部换行不产生多余的空行："a\\n" 与 "a" 等价', () => {
    expect(splitLines('a\n')).toEqual(['a'])
    expect(splitLines('a')).toEqual(['a'])
  })

  it('按 LF 切分且不保留行尾符', () => {
    expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  it('按 CRLF 切分', () => {
    expect(splitLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c'])
  })

  it('按裸 CR 切分', () => {
    expect(splitLines('a\rb\rc')).toEqual(['a', 'b', 'c'])
  })

  it('CRLF / LF / CR 混合文本按行正确切分', () => {
    expect(splitLines('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('保留中间的空行', () => {
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b'])
  })
})

/* -------------------------------------------------------------------------- */
/* diffLinesCore                                                               */
/* -------------------------------------------------------------------------- */

describe('diffLinesCore', () => {
  it('两侧相同 → 全 equal，行号对齐且 text 相同', () => {
    expect(diffLinesCore('a\nb\nc', 'a\nb\nc')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
      { type: 'equal', left: { lineNo: 3, text: 'c' }, right: { lineNo: 3, text: 'c' } },
    ])
  })

  it('"a\\n" 与 "a" 视为相同（尾部换行差异暂不区分，ENG-010 统一处理）', () => {
    expect(diffLinesCore('a\n', 'a')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
    ])
  })

  it('纯新增（尾部加一行）', () => {
    expect(diffLinesCore('a\nb', 'a\nb\nc')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
      { type: 'add', right: { lineNo: 3, text: 'c' } },
    ])
  })

  it('纯删除（尾部删一行）', () => {
    expect(diffLinesCore('a\nb\nc', 'a\nb')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
      { type: 'del', left: { lineNo: 3, text: 'c' } },
    ])
  })

  it('中间插入', () => {
    expect(diffLinesCore('a\nb\nd', 'a\nb\nc\nd')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
      { type: 'add', right: { lineNo: 3, text: 'c' } },
      { type: 'equal', left: { lineNo: 3, text: 'd' }, right: { lineNo: 4, text: 'd' } },
    ])
  })

  it('中间删除', () => {
    expect(diffLinesCore('a\nb\nc\nd', 'a\nb\nd')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
      { type: 'del', left: { lineNo: 3, text: 'c' } },
      { type: 'equal', left: { lineNo: 4, text: 'd' }, right: { lineNo: 3, text: 'd' } },
    ])
  })

  it('替换 → del 与 add 相邻（del 在前）', () => {
    expect(diffLinesCore('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'del', left: { lineNo: 2, text: 'b' } },
      { type: 'add', right: { lineNo: 2, text: 'x' } },
      { type: 'equal', left: { lineNo: 3, text: 'c' }, right: { lineNo: 3, text: 'c' } },
    ])
  })

  it('多块混合（增删交错）：顺序与每行 type/lineNo/text 逐行断言', () => {
    // left : a  b  c  d  e  f
    // right: a  X  Y  d  Z  f
    // 变化块 1：b、c 被替换为 X、Y（del 块在前，add 块在后）
    // 变化块 2：e 被替换为 Z
    expect(diffLinesCore('a\nb\nc\nd\ne\nf', 'a\nX\nY\nd\nZ\nf')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'del', left: { lineNo: 2, text: 'b' } },
      { type: 'del', left: { lineNo: 3, text: 'c' } },
      { type: 'add', right: { lineNo: 2, text: 'X' } },
      { type: 'add', right: { lineNo: 3, text: 'Y' } },
      { type: 'equal', left: { lineNo: 4, text: 'd' }, right: { lineNo: 4, text: 'd' } },
      { type: 'del', left: { lineNo: 5, text: 'e' } },
      { type: 'add', right: { lineNo: 5, text: 'Z' } },
      { type: 'equal', left: { lineNo: 6, text: 'f' }, right: { lineNo: 6, text: 'f' } },
    ])
  })

  it('一侧为空（0 行）→ 纯 add，无幻影空行', () => {
    expect(diffLinesCore('', 'a\nb')).toEqual([
      { type: 'add', right: { lineNo: 1, text: 'a' } },
      { type: 'add', right: { lineNo: 2, text: 'b' } },
    ])
  })

  it('另一侧为空（0 行）→ 纯 del，无幻影空行', () => {
    expect(diffLinesCore('a\nb', '')).toEqual([
      { type: 'del', left: { lineNo: 1, text: 'a' } },
      { type: 'del', left: { lineNo: 2, text: 'b' } },
    ])
  })

  it('两侧都空 → 0 行', () => {
    expect(diffLinesCore('', '')).toEqual([])
  })

  it('CRLF 与 LF 混合行尾：切分后相同内容判定为 equal（行尾差异 ENG-010 统一规范化）', () => {
    expect(diffLinesCore('a\r\nb', 'a\nb')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
    ])
  })

  it('行内容含中文与 tab：正常参与 diff', () => {
    expect(diffLinesCore('中文\t缩进\n第二行', '中文\t缩进\n第二行改')).toEqual([
      {
        type: 'equal',
        left: { lineNo: 1, text: '中文\t缩进' },
        right: { lineNo: 1, text: '中文\t缩进' },
      },
      { type: 'del', left: { lineNo: 2, text: '第二行' } },
      { type: 'add', right: { lineNo: 2, text: '第二行改' } },
    ])
  })

  it('不变量：del 行无 right、add 行无 left、每行至少一侧存在', () => {
    const rows = diffLinesCore('a\nb\nc\nd\ne\nf', 'a\nX\nY\nd\nZ\nf')
    for (const row of rows) {
      if (row.type === 'del') {
        expect(row.right).toBeUndefined()
        expect(row.left).toBeDefined()
      } else if (row.type === 'add') {
        expect(row.left).toBeUndefined()
        expect(row.right).toBeDefined()
      } else {
        expect(row.left).toBeDefined()
        expect(row.right).toBeDefined()
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* compare                                                                     */
/* -------------------------------------------------------------------------- */

describe('compare', () => {
  it('返回 ok: true，rows 与 diffLinesCore 一致，统计正确', () => {
    const result = compare('a\nb\nc\nd\ne\nf', 'a\nX\nY\nd\nZ\nf')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual(diffLinesCore('a\nb\nc\nd\ne\nf', 'a\nX\nY\nd\nZ\nf'))
    expect(result.stats).toEqual({
      addedLines: 3, // X、Y、Z
      removedLines: 3, // b、c、e
      modifiedPairs: 0, // ENG-005 填充
      hunkCount: 0, // ENG-008 填充
      totalRows: 9,
    })
    // ENG-008 填充前为空数组占位
    expect(result.hunks).toEqual([])
    expect(result.collapses).toEqual([])
  })

  it('两侧都空 → ok: true，0 行且统计全 0', () => {
    const result = compare('', '')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual([])
    expect(result.stats).toEqual({
      addedLines: 0,
      removedLines: 0,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 0,
    })
  })

  it('空 vs 非空 → 全部计为新增', () => {
    const result = compare('', 'a\nb')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stats.addedLines).toBe(2)
    expect(result.stats.removedLines).toBe(0)
    expect(result.stats.totalRows).toBe(2)
  })

  it('非 string 输入 → 防御式 internal 错误（不抛异常）', () => {
    const badLeft = compare(undefined as unknown as string, 'a')
    expect(badLeft.ok).toBe(false)
    if (badLeft.ok) return
    expect(badLeft.error.kind).toBe('internal')
    expect(badLeft.error.message).toContain('left: undefined')

    const badRight = compare('a', null as unknown as string)
    expect(badRight.ok).toBe(false)
    if (badRight.ok) return
    expect(badRight.error.kind).toBe('internal')
    expect(badRight.error.message).toContain('right: object') // typeof null === 'object'
  })

  it('结果满足共享契约不变量：每行至少一侧存在', () => {
    const result = compare('a\nb\nc', 'a\nc')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const row of result.rows) {
      expect(row.left !== undefined || row.right !== undefined).toBe(true)
    }
  })
})
