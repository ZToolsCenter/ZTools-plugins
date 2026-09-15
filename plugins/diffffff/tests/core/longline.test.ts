/**
 * 超长行标记单元测试（roadmap 任务 ENG-012）。
 *
 * 覆盖换行开关数据层的「超长行不截断」契约：
 * - `isLongLine`（./normalize.ts）：阈值边界 —— 恰好 10000 字符不算超长
 *   （严格大于口径）、10001 算超长；口径为 UTF-16 code unit 数（string.length）；
 * - `diffLinesCore`（./diff.ts）：超长 equal / add 行打 `longLine: true`，
 *   普通行不产生该键（`'longLine' in row === false`，行对象精简约定）；
 * - `compareWithOptions`（./diff.ts）：带选项（忽略空白）下标记不丢失，
 *   含「规范化等价、仅一侧超长」的任一侧判定；
 * - 两侧不同超长行（del + add）都标记；混合多行 diff 只标记超长行；
 * - compareIncremental（共享 expandRows 链路）标记一致；
 * - 投影空行（ignoreEmptyLines，纯空白超长行）经 buildEmptyRow 亦标记。
 */
import { describe, expect, it } from 'vitest'
import {
  compareIncremental,
  compareWithOptions,
  diffLinesCore,
} from '../../src/core/diff'
import { isLongLine, LONG_LINE_THRESHOLD } from '../../src/core/normalize'
import { DEFAULT_OPTIONS } from '../../src/core/options'

/** 生成指定字符数的行文本（UTF-16 code unit 口径，与 string.length 一致）。 */
function lineOf(n: number, ch = 'x'): string {
  return ch.repeat(n)
}

/* -------------------------------------------------------------------------- */
/* isLongLine 与阈值常量                                                        */
/* -------------------------------------------------------------------------- */

describe('LONG_LINE_THRESHOLD / isLongLine（./normalize.ts）', () => {
  it('阈值为 10000（字符数，UTF-16 code unit 口径）', () => {
    expect(LONG_LINE_THRESHOLD).toBe(10_000)
  })

  it('边界：恰好 10000 字符 → false（不大于阈值）；10001 → true', () => {
    expect(isLongLine(lineOf(10_000))).toBe(false)
    expect(isLongLine(lineOf(10_001))).toBe(true)
  })

  it('口径：长度按 string.length（UTF-16 code unit），多字节字符同口径计数', () => {
    // 5001 个中文字符 = 5001 个 code unit（BMP 内），不足阈值。
    expect(isLongLine('中'.repeat(5001))).toBe(false)
    expect(isLongLine('中'.repeat(10_000))).toBe(false)
    expect(isLongLine('中'.repeat(10_001))).toBe(true)
  })

  it('普通短行 / 空串 → false', () => {
    expect(isLongLine('')).toBe(false)
    expect(isLongLine('hello')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* diffLinesCore：行级骨架的超长标记                                             */
/* -------------------------------------------------------------------------- */

describe('diffLinesCore：超长行标记（ENG-012）', () => {
  it('equal 行两侧都超长但相同 → longLine: true', () => {
    const long = lineOf(10_001)
    const rows = diffLinesCore(long, long)
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('equal')
    expect(rows[0].longLine).toBe(true)
  })

  it('超长 add 行 → longLine: true（配对的普通 del 行不受影响）', () => {
    const rows = diffLinesCore('normal', lineOf(10_001))
    // 两行内容不同 → jsdiff 产出 del + add 块对。
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
    expect('longLine' in rows[0]).toBe(false)
    expect(rows[1].type).toBe('add')
    expect(rows[1].right!.text).toBe(lineOf(10_001))
    expect(rows[1].longLine).toBe(true)
  })

  it('超长 del 行 → longLine: true（配对的普通 add 行不受影响）', () => {
    const rows = diffLinesCore(lineOf(10_001), 'normal')
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
    expect(rows[0].type).toBe('del')
    expect(rows[0].left!.text).toBe(lineOf(10_001))
    expect(rows[0].longLine).toBe(true)
    expect('longLine' in rows[1]).toBe(false)
  })

  it('普通行：不产生 longLine 键（\'longLine\' in row === false）', () => {
    const rows = diffLinesCore('same\nleft-only\n', 'same\nright-only\n')
    expect(rows.map((r) => r.type)).toEqual(['equal', 'del', 'add'])
    for (const row of rows) {
      expect('longLine' in row).toBe(false)
      expect(row.longLine).toBeUndefined()
    }
  })

  it('恰好阈值（10000 字符）的行不算超长：不产生 longLine 键', () => {
    const rows = diffLinesCore('normal', lineOf(10_000))
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
    expect('longLine' in rows[0]).toBe(false)
    expect(rows[1].type).toBe('add')
    expect(rows[1].right!.text).toBe(lineOf(10_000))
    expect('longLine' in rows[1]).toBe(false)
    expect(rows[1].longLine).toBeUndefined()
  })
})

/* -------------------------------------------------------------------------- */
/* compareWithOptions：带选项路径（expandRows 共享链路）                          */
/* -------------------------------------------------------------------------- */

describe('compareWithOptions：忽略空白下超长行标记不丢失', () => {
  it('ignoreWhitespace：两侧超长且规范化等价 → equal 行 longLine: true，各侧 text 保留原文', () => {
    const long = lineOf(10_001)
    const rows = compareWithOptions(long, `${long}   `, {
      ...DEFAULT_OPTIONS,
      ignoreWhitespace: true,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('equal')
    expect(rows[0].longLine).toBe(true)
    expect(rows[0].left!.text).toBe(long)
    expect(rows[0].right!.text).toBe(`${long}   `)
  })

  it('ignoreWhitespace：规范化等价且仅一侧超长（行尾空白推过阈值）→ 任一侧超长即标记', () => {
    // 左侧 10000 字符（不超长），右侧追加了 1 个行尾空白（10001 字符，超长），
    // 忽略空白下行尾空白削平、规范化等价 → equal 行，右侧超长即标记。
    const rows = compareWithOptions(lineOf(10_000), `${lineOf(10_000)} `, {
      ...DEFAULT_OPTIONS,
      ignoreWhitespace: true,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('equal')
    expect(rows[0].longLine).toBe(true)
    expect(rows[0].left!.text).toBe(lineOf(10_000))
  })

  it('默认选项下 compareWithOptions 与 diffLinesCore 的标记一致（超长 add 行）', () => {
    const long = lineOf(10_001)
    const rows = compareWithOptions('normal', long, DEFAULT_OPTIONS)
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
    expect('longLine' in rows[0]).toBe(false)
    expect(rows[1].type).toBe('add')
    expect(rows[1].right!.text).toBe(long)
    expect(rows[1].longLine).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* 多行 / 混合场景                                                              */
/* -------------------------------------------------------------------------- */

describe('混合多行 diff：只有超长行标记', () => {
  it('普通 equal + 超长 add：仅超长行标记，普通行无该键', () => {
    const rows = diffLinesCore('same\nA\n', `same\n${lineOf(10_001)}\n`)
    // 'A' 与超长行内容不同 → del + add 块对。
    expect(rows.map((r) => r.type)).toEqual(['equal', 'del', 'add'])
    expect('longLine' in rows[0]).toBe(false)
    expect('longLine' in rows[1]).toBe(false)
    expect(rows[2].type).toBe('add')
    expect(rows[2].right!.text).toBe(lineOf(10_001))
    expect(rows[2].longLine).toBe(true)
  })

  it('普通 equal + 超长 del + 普通 add：仅超长 del 行标记', () => {
    const rows = diffLinesCore(`same\n${lineOf(10_001)}\nB\n`, 'same\nC\n')
    // del 块含超长行与 'B' 两行，后接 add 块 'C'。
    expect(rows.map((r) => r.type)).toEqual(['equal', 'del', 'del', 'add'])
    expect('longLine' in rows[0]).toBe(false)
    expect(rows[1].type).toBe('del')
    expect(rows[1].left!.text).toBe(lineOf(10_001))
    expect(rows[1].longLine).toBe(true)
    expect('longLine' in rows[2]).toBe(false)
    expect('longLine' in rows[3]).toBe(false)
  })

  it('两侧不同的超长行（del + add）都标记', () => {
    const rows = diffLinesCore(lineOf(10_001, 'x'), lineOf(10_001, 'y'))
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
    expect(rows[0].type).toBe('del')
    expect(rows[0].left!.text).toBe(lineOf(10_001, 'x'))
    expect(rows[0].longLine).toBe(true)
    expect(rows[1].type).toBe('add')
    expect(rows[1].right!.text).toBe(lineOf(10_001, 'y'))
    expect(rows[1].longLine).toBe(true)
  })

  it('多行混合（3 行 diff）：恰好阈值行不标记，超长行标记', () => {
    const rows = diffLinesCore(
      `${lineOf(10_000)}\n${lineOf(10_001)}\ntail\n`,
      `${lineOf(10_000)}\n${lineOf(10_001)}\ntail\n`,
    )
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal'])
    expect('longLine' in rows[0]).toBe(false) // 10000 字符：恰好阈值，不标记
    expect(rows[1].longLine).toBe(true) // 10001 字符：超长
    expect('longLine' in rows[2]).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* compareIncremental（共享 expandRows 链路）与投影空行                           */
/* -------------------------------------------------------------------------- */

describe('compareIncremental：超长行标记与同步链路一致', () => {
  it('分片异步链路产出的超长 add 行同样标记（注入同步调度器）', async () => {
    const result = await compareIncremental('normal', lineOf(10_001), DEFAULT_OPTIONS, {
      scheduler: (cb) => cb(),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows.map((r) => r.type)).toEqual(['del', 'add'])
    expect('longLine' in result.rows[0]).toBe(false)
    expect(result.rows[1].type).toBe('add')
    expect(result.rows[1].right!.text).toBe(lineOf(10_001))
    expect(result.rows[1].longLine).toBe(true)
  })
})

describe('ignoreEmptyLines：投影空行的超长标记（buildEmptyRow）', () => {
  it('纯空白超长行被忽略空行投影回补时，仍按超长标记', () => {
    const whitespaceLong = ' '.repeat(10_001)
    const rows = compareWithOptions(`a\n${whitespaceLong}\nb\n`, 'a\nb\n', {
      ...DEFAULT_OPTIONS,
      ignoreEmptyLines: true,
    })
    // 纯空白行被剔除出 diff 输入，投影回补为单侧 'equal' 行。
    const projected = rows.find((r) => r.left?.text === whitespaceLong || r.right?.text === whitespaceLong)
    expect(projected).toBeDefined()
    expect(projected!.type).toBe('equal')
    expect(projected!.longLine).toBe(true)
  })
})
