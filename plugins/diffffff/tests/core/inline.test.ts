/**
 * 词级 / 字符级行内 diff 单元测试（roadmap 任务 ENG-003）。
 *
 * 覆盖 `src/core/inline.ts` 与 `src/core/diff.ts` 追加的两个精度出口：
 * - `computeSpans`：拼接恒等式（中/英/混合/空串/纯空白/emoji，双粒度）、
 *   CJK 逐字定位能力（只有变化的字 changed）、拉丁词级定位（只有变化的
 *   词 changed）、字符级定位、changed 标记只来源于 removed/added 块；
 * - `applyInlineSpans`：del/add 块等长配对、不等长尾部弃配、纯 add /
 *   纯 del 无区域、全部 equal 无 spans、多区域交错，以及不可变风格
 *   （原 rows 与行对象不被修改）；
 * - `diffWordPrecision` / `diffCharPrecision`：端到端与 ENG-001 骨架
 *   逐行一致（type / lineNo / text）、差异行带 words、词级 vs 字符级
 *   定位粒度对照、空侧边界。
 */
import { describe, expect, it } from 'vitest'
import { applyInlineSpans, computeSpans } from '../../src/core/inline'
import { diffCharPrecision, diffLinesCore, diffWordPrecision } from '../../src/core/diff'
import type { DiffRow, WordDiffSpan } from '../../src/core/types'

/* -------------------------------------------------------------------------- */
/* computeSpans：拼接恒等式（spans 拼接恒等于该侧文本）                           */
/* -------------------------------------------------------------------------- */

describe('computeSpans 拼接恒等式', () => {
  // [用例标签, 左侧文本, 右侧文本]；标签仅用于测试名可读。
  const samples: Array<[string, string, string]> = [
    ['纯中文', '你好世界', '你好地球'],
    ['英文语句', 'const x = 1;', 'const x = 2;'],
    ['中英混合', '中文 English v1.2.3！', '中文 English v1.2.4！'],
    ['空串 vs 空串', '', ''],
    ['空串 vs 非空', '', 'abc'],
    ['非空 vs 空串', 'abc', ''],
    ['纯空白两侧', '   \t ', ' \t\t '],
    ['emoji 与 BMP 外字符', 'a🎉b', 'a🎉c𠀀'],
  ]

  for (const granularity of ['word', 'char'] as const) {
    for (const [label, leftText, rightText] of samples) {
      it(`[${granularity}] ${label}：left/right spans 拼接还原原文`, () => {
        const { left, right } = computeSpans(leftText, rightText, granularity)
        expect(left.map((s) => s.text).join('')).toBe(leftText)
        expect(right.map((s) => s.text).join('')).toBe(rightText)
      })
    }
  }
})

/* -------------------------------------------------------------------------- */
/* computeSpans：CJK 定位能力（tokenizer 存在的意义）                            */
/* -------------------------------------------------------------------------- */

describe('computeSpans CJK 定位能力', () => {
  it('word 粒度：「你好世界」vs「你好地球」只有变化的字 changed: true', () => {
    // tokenizeWords 对 CJK 逐字成 token：equal 块 [你,好] 归并为一个 span，
    // removed [世,界] / added [地,球] 各归并为一个 changed span。
    expect(computeSpans('你好世界', '你好地球', 'word')).toEqual({
      left: [
        { text: '你好', changed: false },
        { text: '世界', changed: true },
      ],
      right: [
        { text: '你好', changed: false },
        { text: '地球', changed: true },
      ],
    })
  })

  it('char 粒度同样逐字定位，未变字符两侧均 changed: false', () => {
    expect(computeSpans('你好世界', '你好地球', 'char')).toEqual({
      left: [
        { text: '你好', changed: false },
        { text: '世界', changed: true },
      ],
      right: [
        { text: '你好', changed: false },
        { text: '地球', changed: true },
      ],
    })
  })

  it('中英混合：整词替换（world → worlds）只有变化的词 changed，中文不受牵连', () => {
    // 「worlds」是单个拉丁词 token（tokenizeWords 不按字符拆词），
    // 因此词级 diff 把 world / worlds 各自整体标红，「你好」保持 false。
    const { left, right } = computeSpans('你好world', '你好worlds', 'word')
    expect(left).toEqual([
      { text: '你好', changed: false },
      { text: 'world', changed: true },
    ])
    expect(right).toEqual([
      { text: '你好', changed: false },
      { text: 'worlds', changed: true },
    ])
  })

  it('changed 标记只来源于 removed/added 块：左侧多余 token 标红时右侧无 changed span', () => {
    // 「中文注」vs「中文」：equal [中,文] + removed [注]，右侧没有 added 块。
    const { left, right } = computeSpans('中文注', '中文', 'word')
    expect(left).toEqual([
      { text: '中文', changed: false },
      { text: '注', changed: true },
    ])
    expect(right).toEqual([{ text: '中文', changed: false }])
    expect(right.some((s) => s.changed)).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* computeSpans：拉丁词级与字符级定位                                            */
/* -------------------------------------------------------------------------- */

describe('computeSpans 拉丁词级定位', () => {
  it('「const x = 1;」vs「const x = 2;」只有 1 / 2 changed，其余片段两侧均 false', () => {
    expect(computeSpans('const x = 1;', 'const x = 2;', 'word')).toEqual({
      left: [
        { text: 'const x = ', changed: false },
        { text: '1', changed: true },
        { text: ';', changed: false },
      ],
      right: [
        { text: 'const x = ', changed: false },
        { text: '2', changed: true },
        { text: ';', changed: false },
      ],
    })
  })
})

describe('computeSpans 字符级定位', () => {
  it('「abc」vs「abd」只有 c / d changed', () => {
    expect(computeSpans('abc', 'abd', 'char')).toEqual({
      left: [
        { text: 'ab', changed: false },
        { text: 'c', changed: true },
      ],
      right: [
        { text: 'ab', changed: false },
        { text: 'd', changed: true },
      ],
    })
  })

  it('两侧相同文本 → 全部 span changed: false 且左右结构一致', () => {
    const { left, right } = computeSpans('same text', 'same text', 'char')
    expect(left).toEqual(right)
    expect(left.every((s) => !s.changed)).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* applyInlineSpans：区域定位与位置配对                                          */
/* -------------------------------------------------------------------------- */

describe('applyInlineSpans 区域定位与位置配对', () => {
  it('del 块与 add 块等长：逐对填 words，equal 行不填', () => {
    const rows = diffLinesCore('a\nb\nc', 'a\nx\nc')
    const result = applyInlineSpans(rows, 'word')

    expect(result.map((r) => r.type)).toEqual(['equal', 'del', 'add', 'equal'])
    expect(result[1].left!.words).toEqual([{ text: 'b', changed: true }])
    expect(result[2].right!.words).toEqual([{ text: 'x', changed: true }])
    expect(result[0].left!.words).toBeUndefined()
    expect(result[3].left!.words).toBeUndefined()
  })

  it('del 块比 add 块长：第 1 对配对填 words，del 尾部行不配对不填', () => {
    // left : b1 b2 b3 → right: x1；del 块 3 行 + add 块 1 行。
    const rows = diffLinesCore('b1\nb2\nb3', 'x1')
    expect(rows.map((r) => r.type)).toEqual(['del', 'del', 'del', 'add'])

    const result = applyInlineSpans(rows, 'word')
    // 第 1 个 del（b1）与第 1 个 add（x1）配对。
    expect(result[0].left!.words).toEqual([
      { text: 'b', changed: true },
      { text: '1', changed: false },
    ])
    expect(result[3].right!.words).toEqual([
      { text: 'x', changed: true },
      { text: '1', changed: false },
    ])
    // 尾部剩余的 del 行（b2 / b3）保持原样不填 spans。
    expect(result[1].left!.words).toBeUndefined()
    expect(result[2].left!.words).toBeUndefined()
    // 行骨架不变。
    expect(result.map((r) => r.type)).toEqual(['del', 'del', 'del', 'add'])
    expect(result.map((r) => r.left?.text ?? r.right?.text)).toEqual(['b1', 'b2', 'b3', 'x1'])
  })

  it('add 块比 del 块长：第 1 对配对填 words，add 尾部行不配对不填', () => {
    const rows = diffLinesCore('x1', 'b1\nb2\nb3')
    const result = applyInlineSpans(rows, 'word')

    expect(result.map((r) => r.type)).toEqual(['del', 'add', 'add', 'add'])
    expect(result[0].left!.words).toBeDefined()
    expect(result[1].right!.words).toBeDefined()
    expect(result[2].right!.words).toBeUndefined()
    expect(result[3].right!.words).toBeUndefined()
  })

  it('纯 add / 纯 del（无配对区域）：所有行不填 words', () => {
    const pureAdd = applyInlineSpans(diffLinesCore('', 'a\nb'), 'word')
    expect(pureAdd.map((r) => r.type)).toEqual(['add', 'add'])
    for (const row of pureAdd) expect(row.right!.words).toBeUndefined()

    const pureDel = applyInlineSpans(diffLinesCore('a\nb', ''), 'char')
    expect(pureDel.map((r) => r.type)).toEqual(['del', 'del'])
    for (const row of pureDel) expect(row.left!.words).toBeUndefined()
  })

  it('全部 equal：不填任何 words', () => {
    const result = applyInlineSpans(diffLinesCore('a\nb', 'a\nb'), 'word')
    expect(result.map((r) => r.type)).toEqual(['equal', 'equal'])
    for (const row of result) {
      expect(row.left!.words).toBeUndefined()
      expect(row.right!.words).toBeUndefined()
    }
  })

  it('多区域交错：每个区域独立配对，区域外的 equal 行不填', () => {
    // left : a b c d e f → right: a X Y d Z f（两个替换区域）。
    const rows = diffLinesCore('a\nb\nc\nd\ne\nf', 'a\nX\nY\nd\nZ\nf')
    const result = applyInlineSpans(rows, 'word')

    expect(result.map((r) => r.type)).toEqual([
      'equal', 'del', 'del', 'add', 'add', 'equal', 'del', 'add', 'equal',
    ])
    // 区域 1：b↔X、c↔Y；区域 2：e↔Z。
    expect(result[1].left!.words).toEqual([{ text: 'b', changed: true }])
    expect(result[2].left!.words).toEqual([{ text: 'c', changed: true }])
    expect(result[3].right!.words).toEqual([{ text: 'X', changed: true }])
    expect(result[4].right!.words).toEqual([{ text: 'Y', changed: true }])
    expect(result[6].left!.words).toEqual([{ text: 'e', changed: true }])
    expect(result[7].right!.words).toEqual([{ text: 'Z', changed: true }])
    // 区域外的 equal 行不填。
    for (const idx of [0, 5, 8]) {
      expect(result[idx].left!.words).toBeUndefined()
      expect(result[idx].right!.words).toBeUndefined()
    }
  })
})

/* -------------------------------------------------------------------------- */
/* applyInlineSpans：不可变风格                                                  */
/* -------------------------------------------------------------------------- */

describe('applyInlineSpans 不可变风格', () => {
  it('返回新数组新对象，原 rows 与其行对象（含 words 字段）完全不被修改', () => {
    const rows = diffLinesCore('a\nb\nc', 'a\nx\nc')
    const before = structuredClone(rows)
    const delRowBefore = rows[1]
    const addRowBefore = rows[2]

    const result = applyInlineSpans(rows, 'word')

    // 原数组内容逐元素深度不变（deep 断言）。
    expect(rows).toEqual(before)
    // 原行对象的 words 仍为 undefined。
    expect(delRowBefore.left!.words).toBeUndefined()
    expect(addRowBefore.right!.words).toBeUndefined()
    // 新数组新对象：所有结果行都不是原行对象；被填 words 的行连 side 对象
    // 也是新建的。
    expect(result).not.toBe(rows)
    result.forEach((row, idx) => expect(row).not.toBe(rows[idx]))
    expect(result[1].left).not.toBe(rows[1].left)
    expect(result[2].right).not.toBe(rows[2].right)
    // 新对象携带 words，且内容正确。
    expect(result[1].left!.words).toEqual([{ text: 'b', changed: true }])
    expect(result[2].right!.words).toEqual([{ text: 'x', changed: true }])
  })
})

/* -------------------------------------------------------------------------- */
/* diffWordPrecision / diffCharPrecision：端到端                                 */
/* -------------------------------------------------------------------------- */

/** 断言 precision 结果与 ENG-001 行级骨架逐行一致（type / 双侧 lineNo / text）。 */
function expectSameSkeleton(actual: DiffRow[], left: string, right: string) {
  const skeleton = diffLinesCore(left, right)
  expect(actual).toHaveLength(skeleton.length)
  actual.forEach((row, idx) => {
    expect(row.type).toBe(skeleton[idx].type)
    expect(row.left?.lineNo).toBe(skeleton[idx].left?.lineNo)
    expect(row.left?.text).toBe(skeleton[idx].left?.text)
    expect(row.right?.lineNo).toBe(skeleton[idx].right?.lineNo)
    expect(row.right?.text).toBe(skeleton[idx].right?.text)
  })
}

describe('diffWordPrecision / diffCharPrecision 端到端', () => {
  const left = 'a\nb\nc\nd\ne\nf'
  const right = 'a\nX\nY\nd\nZ\nf'

  it('word 精度：行骨架与 ENG-001 完全一致（type 分布 / 行号 / 文本）', () => {
    const rows = diffWordPrecision(left, right)
    expectSameSkeleton(rows, left, right)
    expect(rows.map((r) => r.type)).toEqual([
      'equal', 'del', 'del', 'add', 'add', 'equal', 'del', 'add', 'equal',
    ])
  })

  it('char 精度：行骨架与 ENG-001 完全一致', () => {
    expectSameSkeleton(diffCharPrecision(left, right), left, right)
  })

  it('有差异的行带 words，equal 行不带', () => {
    const rows = diffWordPrecision(left, right)
    // 变化区域内的行带 words。
    expect(rows[1].left!.words).toEqual([{ text: 'b', changed: true }])
    expect(rows[3].right!.words).toEqual([{ text: 'X', changed: true }])
    // equal 行不带。
    expect(rows[0].left!.words).toBeUndefined()
    expect(rows[5].right!.words).toBeUndefined()
  })

  it('CJK 词级端到端：「你好世界」vs「你好地球」只有变化的字被标红', () => {
    const rows = diffWordPrecision('你好世界', '你好地球')
    expect(rows).toEqual([
      {
        type: 'del',
        left: {
          lineNo: 1,
          text: '你好世界',
          words: [
            { text: '你好', changed: false },
            { text: '世界', changed: true },
          ],
        },
      },
      {
        type: 'add',
        right: {
          lineNo: 1,
          text: '你好地球',
          words: [
            { text: '你好', changed: false },
            { text: '地球', changed: true },
          ],
        },
      },
    ] satisfies DiffRow[])
  })

  it('词级 vs 字符级对照：「hello」→「hexlo」词级整词标红，字符级只标 1 个字符', () => {
    const wordRows = diffWordPrecision('hello', 'hexlo')
    expect(wordRows[0].left!.words).toEqual([{ text: 'hello', changed: true }])
    expect(wordRows[1].right!.words).toEqual([{ text: 'hexlo', changed: true }])

    const charRows = diffCharPrecision('hello', 'hexlo')
    const leftChanged = charRows[0].left!.words!.filter((s: WordDiffSpan) => s.changed)
    const rightChanged = charRows[1].right!.words!.filter((s: WordDiffSpan) => s.changed)
    expect(leftChanged).toEqual([{ text: 'l', changed: true }])
    expect(rightChanged).toEqual([{ text: 'x', changed: true }])
    // 字符级拼接恒等式在行对象上同样成立。
    expect(charRows[0].left!.words!.map((s) => s.text).join('')).toBe('hello')
    expect(charRows[1].right!.words!.map((s) => s.text).join('')).toBe('hexlo')
  })

  it('空侧边界：纯 add / 纯 del 不带 words，两侧都空返回 []', () => {
    expect(diffWordPrecision('', 'a\nb')).toEqual([
      { type: 'add', right: { lineNo: 1, text: 'a' } },
      { type: 'add', right: { lineNo: 2, text: 'b' } },
    ])
    expect(diffCharPrecision('a\nb', '')).toEqual([
      { type: 'del', left: { lineNo: 1, text: 'a' } },
      { type: 'del', left: { lineNo: 2, text: 'b' } },
    ])
    expect(diffWordPrecision('', '')).toEqual([])
    expect(diffCharPrecision('', '')).toEqual([])
  })
})
