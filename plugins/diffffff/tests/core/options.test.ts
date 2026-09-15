/**
 * 对比选项层单元测试（roadmap 任务 ENG-006）。
 *
 * 覆盖 `src/core/options.ts`、`src/core/diff.ts` 的 `compareWithOptions`、
 * `src/core/inline.ts` 的 options 扩展与 `src/core/precision.ts` 的选项
 * 正交组合：
 * - `normalizeForCompare`：行尾 / 行首空白、全空白行 → 空串、连续空白折叠、
 *   大小写、组合顺序（空白先、小写后）、双关全关恒等；
 * - `isEmptyish`：空串 / 纯空白行 vs 含内容行；
 * - `optionsKey`：固定字段顺序、缺省字段归一、不同开关不同键；
 * - `compareWithOptions`：三关 → 与 `diffLinesCore` 深度一致（电池）；
 *   忽略空白 / 忽略大小写 / 叠加 → 规范化等价行 type 'equal' 且原文保留；
 *   ignoreEmptyLines 过滤-投影 —— 空行永不 del/add、左右按位置两两配对、
 *   余量成单侧 equal 行；
 * - `computeSpans` 带 options：拼接恒等式组合电池（双粒度 × 四开关组合 ×
 *   多样本）、空白 token changed=false、大小写不标红、只标红真实差异；
 * - `applyInlineSpans` 带 options：透传与向后兼容；
 * - 精度 × 选项正交矩阵 smoke：4 精度 × 3 选项组合不抛错、行数与行骨架
 *   一致、type 序列一致（rowsWithPairing 的 modify 行不在本任务范围）；
 * - smart 降级路径正式生效：等价残差行带词级 spans 且 changed 标记出现；
 * - 缓存会话：同输入同选项命中、同输入不同选项分别计算（stats 断言）、
 *   `getDiffRows` 向后兼容（旧签名第 4 参传 session）。
 */
import { describe, expect, it } from 'vitest'
import {
  compareWithOptions,
  diffLinesCore,
  diffSmartPrecision,
  diffWordPrecision,
} from '../../src/core/diff'
import { applyInlineSpans, computeSpans } from '../../src/core/inline'
import { createDiffSession, getDiffRows } from '../../src/core/precision'
import {
  DEFAULT_OPTIONS,
  isEmptyish,
  normalizeForCompare,
  optionsKey,
  type CompareOptions,
} from '../../src/core/options'
import type { DiffOptions, DiffRowType } from '../../src/core/types'

/** 构造完整 DiffOptions：缺省字段用 DEFAULT_OPTIONS 兜底（三开关 false）。 */
function opts(partial: Partial<DiffOptions> = {}): DiffOptions {
  return { ...DEFAULT_OPTIONS, ...partial }
}

/* -------------------------------------------------------------------------- */
/* normalizeForCompare                                                         */
/* -------------------------------------------------------------------------- */

describe('normalizeForCompare', () => {
  const ws: CompareOptions = { ignoreWhitespace: true, ignoreCase: false }
  const cs: CompareOptions = { ignoreWhitespace: false, ignoreCase: true }

  it('ignoreWhitespace：削流行尾与行首空白', () => {
    expect(normalizeForCompare('abc   ', ws)).toBe('abc')
    expect(normalizeForCompare('\t abc', ws)).toBe('abc')
    expect(normalizeForCompare('abc', ws)).toBe('abc')
  })

  it('ignoreWhitespace：全空白行折叠为空串', () => {
    expect(normalizeForCompare('   ', ws)).toBe('')
    expect(normalizeForCompare(' \t \t ', ws)).toBe('')
    expect(normalizeForCompare('\t', ws)).toBe('')
  })

  it('ignoreWhitespace：连续空白折叠为单个空格', () => {
    expect(normalizeForCompare('a   b', ws)).toBe('a b')
    expect(normalizeForCompare('a \t b', ws)).toBe('a b')
  })

  it('ignoreCase：统一小写且不折叠空白', () => {
    expect(normalizeForCompare('Foo BAR', cs)).toBe('foo bar')
    // 只开大小写：空白原样保留（空白折叠只受 ignoreWhitespace 控制）。
    expect(normalizeForCompare('A  B', cs)).toBe('a  b')
  })

  it('组合：先折叠空白再小写（顺序固定，ignoreWhitespace 先行）', () => {
    expect(normalizeForCompare(' A \t B ', { ignoreWhitespace: true, ignoreCase: true })).toBe(
      'a b',
    )
  })

  it('双关全关：原样返回（恒等，缺省行为与严格比较一致）', () => {
    expect(normalizeForCompare(' X y ', { ignoreWhitespace: false, ignoreCase: false })).toBe(
      ' X y ',
    )
  })
})

/* -------------------------------------------------------------------------- */
/* isEmptyish                                                                  */
/* -------------------------------------------------------------------------- */

describe('isEmptyish', () => {
  it('空串与纯空白行 → true', () => {
    expect(isEmptyish('')).toBe(true)
    expect(isEmptyish('   ')).toBe(true)
    expect(isEmptyish('\t')).toBe(true)
  })

  it('含非空白字符 → false（前后空白不影响）', () => {
    expect(isEmptyish('a')).toBe(false)
    expect(isEmptyish(' a ')).toBe(false)
    expect(isEmptyish('。')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* optionsKey                                                                  */
/* -------------------------------------------------------------------------- */

describe('optionsKey', () => {
  it('DEFAULT_OPTIONS 生成固定字段顺序的键', () => {
    expect(optionsKey(DEFAULT_OPTIONS)).toBe(
      '{"ignoreWhitespace":false,"ignoreCase":false,"ignoreEmptyLines":false}',
    )
  })

  it('字段声明顺序不同 / 缺省字段 → 同一键（稳定键片段）', () => {
    expect(optionsKey({ ignoreCase: false, ignoreWhitespace: false, ignoreRules: [] })).toBe(
      optionsKey(DEFAULT_OPTIONS),
    )
    expect(optionsKey({ ignoreWhitespace: true, ignoreCase: false, ignoreRules: [] })).toBe(
      optionsKey({
        ignoreWhitespace: true,
        ignoreCase: false,
        ignoreEmptyLines: undefined,
        ignoreRules: [],
      }),
    )
  })

  it('不同开关组合 → 不同键', () => {
    const keys = new Set([
      optionsKey(DEFAULT_OPTIONS),
      optionsKey(opts({ ignoreWhitespace: true })),
      optionsKey(opts({ ignoreCase: true })),
      optionsKey(opts({ ignoreEmptyLines: true })),
      optionsKey(opts({ ignoreWhitespace: true, ignoreCase: true, ignoreEmptyLines: true })),
    ])
    expect(keys.size).toBe(5)
  })

  it('键不含 NUL 分隔符，可与 precision 的 NUL 分隔键安全拼接', () => {
    for (const key of [
      optionsKey(DEFAULT_OPTIONS),
      optionsKey(opts({ ignoreWhitespace: true, ignoreCase: true })),
    ]) {
      expect(key).not.toContain('\u0000')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* compareWithOptions：三开关全关 → 与 diffLinesCore 深度一致                    */
/* -------------------------------------------------------------------------- */

describe('compareWithOptions 三开关全关', () => {
  const battery: Array<[string, string]> = [
    ['a\nb\nc\nd\ne\nf', 'a\nX\nY\nd\nZ\nf'],
    ['', 'a\nb'],
    ['a\nb', ''],
    ['', ''],
    ['a\n', 'a'],
    ['a\r\nb', 'a\nb'],
    ['中文\n第二行', '中文\n第二行改'],
    ['a\n\nb', 'a\n\n\nb'],
  ]

  for (const [left, right] of battery) {
    it(`与 diffLinesCore 深度一致：${JSON.stringify(left)} vs ${JSON.stringify(right)}`, () => {
      expect(compareWithOptions(left, right, DEFAULT_OPTIONS)).toEqual(diffLinesCore(left, right))
    })
  }

  it('显式三关（ignoreEmptyLines: false）同样与 diffLinesCore 一致', () => {
    const left = 'a\n\nb\nc'
    const right = 'a\nb\n\nc'
    expect(
      compareWithOptions(
        left,
        right,
        opts({ ignoreWhitespace: false, ignoreCase: false, ignoreEmptyLines: false }),
      ),
    ).toEqual(diffLinesCore(left, right))
  })
})

/* -------------------------------------------------------------------------- */
/* compareWithOptions：ignoreWhitespace / ignoreCase / 叠加                     */
/* -------------------------------------------------------------------------- */

describe('compareWithOptions 忽略空白与大小写', () => {
  it('ignoreWhitespace：仅空白差异（行中 / 行尾）→ 全 equal 且原文保留', () => {
    const rows = compareWithOptions('foo \nbar\t\nbaz', 'foo\nbar\nbaz  ', opts({ ignoreWhitespace: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal'])
    expect(rows[0].left).toEqual({ lineNo: 1, text: 'foo ' })
    expect(rows[0].right).toEqual({ lineNo: 1, text: 'foo' })
    expect(rows[1].left).toEqual({ lineNo: 2, text: 'bar\t' })
    expect(rows[1].right).toEqual({ lineNo: 2, text: 'bar' })
    expect(rows[2].left).toEqual({ lineNo: 3, text: 'baz' })
    expect(rows[2].right).toEqual({ lineNo: 3, text: 'baz  ' })
  })

  it("ignoreWhitespace：'a  b' vs 'a b'（连续空白折叠）→ equal", () => {
    const rows = compareWithOptions('a  b', 'a b', opts({ ignoreWhitespace: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal'])
    expect(rows[0].left!.text).toBe('a  b')
    expect(rows[0].right!.text).toBe('a b')
  })

  it('ignoreWhitespace：非空白差异仍产出 del/add（del 在前）', () => {
    const rows = compareWithOptions('foo bar', 'foo baz', opts({ ignoreWhitespace: true }))
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
  })

  it("ignoreCase：'Foo' vs 'foo' → 规范化等价行 type 'equal' 但 text 不同", () => {
    const rows = compareWithOptions('Foo', 'foo', opts({ ignoreCase: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal'])
    expect(rows[0].left).toEqual({ lineNo: 1, text: 'Foo' })
    expect(rows[0].right).toEqual({ lineNo: 1, text: 'foo' })
    expect(rows[0].left!.text).not.toBe(rows[0].right!.text)
  })

  it('ignoreCase：大小写之外的真实差异仍产出 del/add', () => {
    const rows = compareWithOptions('ABC\nxi', 'abc\nxj', opts({ ignoreCase: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'del', 'add'])
  })

  it('两者叠加：空白 + 大小写同时忽略 → equal 且原文保留', () => {
    const rows = compareWithOptions(
      'FOO  Bar',
      'foo bar',
      opts({ ignoreWhitespace: true, ignoreCase: true }),
    )
    expect(rows.map((r) => r.type)).toEqual(['equal'])
    expect(rows[0].left!.text).toBe('FOO  Bar')
    expect(rows[0].right!.text).toBe('foo bar')
  })

  it('两者叠加但内容不同 → del/add', () => {
    const rows = compareWithOptions(
      'FOO  Bar',
      'foo baz',
      opts({ ignoreWhitespace: true, ignoreCase: true }),
    )
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
  })
})

/* -------------------------------------------------------------------------- */
/* compareWithOptions：ignoreEmptyLines（过滤-投影）                            */
/* -------------------------------------------------------------------------- */

describe('compareWithOptions 忽略空行变化', () => {
  it('单侧删除空行：无 del/add，空行以左单侧 equal 行出现', () => {
    const rows = compareWithOptions('a\n\nb', 'a\nb', opts({ ignoreEmptyLines: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal'])
    expect(rows[0]).toEqual({
      type: 'equal',
      left: { lineNo: 1, text: 'a' },
      right: { lineNo: 1, text: 'a' },
    })
    expect(rows[1]).toEqual({ type: 'equal', left: { lineNo: 2, text: '' } })
    expect(rows[2]).toEqual({
      type: 'equal',
      left: { lineNo: 3, text: 'b' },
      right: { lineNo: 2, text: 'b' },
    })
  })

  it('单侧新增空行：无 del/add，空行以右单侧 equal 行出现', () => {
    const rows = compareWithOptions('a\nb', 'a\n\nb', opts({ ignoreEmptyLines: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal'])
    expect(rows[1]).toEqual({ type: 'equal', right: { lineNo: 2, text: '' } })
    expect(rows[2]).toEqual({
      type: 'equal',
      left: { lineNo: 2, text: 'b' },
      right: { lineNo: 3, text: 'b' },
    })
  })

  it('双侧空行按位置顺序两两配对，余量成单侧 equal 行', () => {
    // left 两个空行、right 一个：第 1 对配成双侧 equal，第 2 个左空行成单侧。
    const rows = compareWithOptions('a\n\n\nb', 'a\n\nb', opts({ ignoreEmptyLines: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal', 'equal'])
    expect(rows[1]).toEqual({
      type: 'equal',
      left: { lineNo: 2, text: '' },
      right: { lineNo: 2, text: '' },
    })
    expect(rows[2]).toEqual({ type: 'equal', left: { lineNo: 3, text: '' } })
    expect(rows[3]).toEqual({
      type: 'equal',
      left: { lineNo: 4, text: 'b' },
      right: { lineNo: 3, text: 'b' },
    })
  })

  it('纯空白行也按空行对待（判据 isEmptyish，不依赖 ignoreWhitespace）', () => {
    const rows = compareWithOptions('a\n   \nb', 'a\nb', opts({ ignoreEmptyLines: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal'])
    expect(rows[1]).toEqual({ type: 'equal', left: { lineNo: 2, text: '   ' } })
  })

  it('空行不参与变更判定：真实差异照常 del/add，空行永不 del/add', () => {
    const rows = compareWithOptions('a\n\nX', 'a\nY', opts({ ignoreEmptyLines: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'del', 'add'])
    expect(rows[1]).toEqual({ type: 'equal', left: { lineNo: 2, text: '' } })
    expect(rows[2].left).toEqual({ lineNo: 3, text: 'X' })
    expect(rows[2].right).toBeUndefined()
    expect(rows[3].right).toEqual({ lineNo: 2, text: 'Y' })
    expect(rows[3].left).toBeUndefined()
  })

  it('一侧全为空行：空行 equal 单侧行 + 另一侧真实 add（空行仍不 del/add）', () => {
    const rows = compareWithOptions('\n\n', 'x', opts({ ignoreEmptyLines: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'add'])
    expect(rows[0]).toEqual({ type: 'equal', left: { lineNo: 1, text: '' } })
    expect(rows[1]).toEqual({ type: 'equal', left: { lineNo: 2, text: '' } })
    expect(rows[2]).toEqual({ type: 'add', right: { lineNo: 1, text: 'x' } })
  })

  it('与 ignoreWhitespace 叠加：行尾空白行 + 空行同时忽略', () => {
    const rows = compareWithOptions(
      'a \n\nb',
      'a\nb',
      opts({ ignoreWhitespace: true, ignoreEmptyLines: true }),
    )
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal'])
    expect(rows[0].left!.text).toBe('a ')
    expect(rows[1]).toEqual({ type: 'equal', left: { lineNo: 2, text: '' } })
    expect(rows[2]).toEqual({
      type: 'equal',
      left: { lineNo: 3, text: 'b' },
      right: { lineNo: 2, text: 'b' },
    })
  })

  it('关闭 ignoreEmptyLines（缺省）：空行照常参与 diff，多出的空行是 add', () => {
    const rows = compareWithOptions('a\n\nb', 'a\n\n\nb', DEFAULT_OPTIONS)
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'add', 'equal'])
  })
})

/* -------------------------------------------------------------------------- */
/* computeSpans 带 options：拼接恒等式组合电池                                   */
/* -------------------------------------------------------------------------- */

describe('computeSpans 带 options 拼接恒等式', () => {
  const samples: Array<[string, string, string]> = [
    ['大小写差异', 'Foo Bar', 'foo bar'],
    ['空白差异', 'a  b', 'a b'],
    ['大小写+空白', 'A  B', 'a b'],
    ['空白 token 对照', ' \t ', '   '],
    ['Hello 追加 world', 'Hello', 'heLLo world'],
    ['中英混合', '中文 English v1.2.3！', '中文 English V1.2.4！'],
    ['空串 vs 空串', '', ''],
    ['空串 vs 非空', '', 'abc'],
    ['纯空白 vs 空串', '   ', ''],
  ]
  const optionBattery: Array<[string, CompareOptions]> = [
    ['双关全关', { ignoreWhitespace: false, ignoreCase: false }],
    ['仅忽略空白', { ignoreWhitespace: true, ignoreCase: false }],
    ['仅忽略大小写', { ignoreWhitespace: false, ignoreCase: true }],
    ['全开', { ignoreWhitespace: true, ignoreCase: true }],
  ]

  for (const granularity of ['word', 'char'] as const) {
    for (const [optionLabel, optionSet] of optionBattery) {
      it(`[${granularity}] ${optionLabel}：全部样本 left/right spans 拼接还原原文`, () => {
        for (const [label, leftText, rightText] of samples) {
          const { left, right } = computeSpans(leftText, rightText, granularity, optionSet)
          expect(left.map((s) => s.text).join(''), `[${label}] left`).toBe(leftText)
          expect(right.map((s) => s.text).join(''), `[${label}] right`).toBe(rightText)
        }
      })
    }
  }
})

/* -------------------------------------------------------------------------- */
/* computeSpans 带 options：定位行为                                            */
/* -------------------------------------------------------------------------- */

describe('computeSpans 带 options 定位行为', () => {
  it('ignoreWhitespace：空白 token 保留原文且 changed=false（空白差异不标红）', () => {
    expect(
      computeSpans(' ', '\t', 'word', { ignoreWhitespace: true, ignoreCase: false }),
    ).toEqual({
      left: [{ text: ' ', changed: false }],
      right: [{ text: '\t', changed: false }],
    })
  })

  it('ignoreWhitespace：空白差异不打断 token 对齐，只标红真正变化的词', () => {
    // 'a b c' vs 'a\tb x'：空白 token 视为相等 → 前缀对齐，空白落在 equal
    // span 内 changed=false，只有 c / x 标红。
    const { left, right } = computeSpans('a b c', 'a\tb x', 'word', {
      ignoreWhitespace: true,
      ignoreCase: false,
    })
    expect(left).toEqual([{ text: 'a b ', changed: false }, { text: 'c', changed: true }])
    expect(right).toEqual([{ text: 'a\tb ', changed: false }, { text: 'x', changed: true }])
  })

  it("ignoreCase：word 粒度 'Hello' vs 'hello' 不标红", () => {
    expect(
      computeSpans('Hello', 'hello', 'word', { ignoreWhitespace: false, ignoreCase: true }),
    ).toEqual({
      left: [{ text: 'Hello', changed: false }],
      right: [{ text: 'hello', changed: false }],
    })
  })

  it('ignoreCase：char 粒度同样不标红（原文保留 + 拼接恒等）', () => {
    const { left, right } = computeSpans('Hello', 'hello', 'char', {
      ignoreWhitespace: false,
      ignoreCase: true,
    })
    expect(left.every((s) => !s.changed)).toBe(true)
    expect(right.every((s) => !s.changed)).toBe(true)
    expect(left.map((s) => s.text).join('')).toBe('Hello')
    expect(right.map((s) => s.text).join('')).toBe('hello')
  })

  it("ignoreCase：'Hello' vs 'heLLo world' 只 ' world' 标红（heLLo 不标红）", () => {
    const { left, right } = computeSpans('Hello', 'heLLo world', 'word', {
      ignoreWhitespace: false,
      ignoreCase: true,
    })
    expect(left).toEqual([{ text: 'Hello', changed: false }])
    expect(right).toEqual([
      { text: 'heLLo', changed: false },
      { text: ' world', changed: true },
    ])
  })

  it('组合：忽略空白 + 大小写，A  B vs a b 全部不标红', () => {
    const { left, right } = computeSpans('A  B', 'a b', 'word', {
      ignoreWhitespace: true,
      ignoreCase: true,
    })
    expect(left).toEqual([{ text: 'A  B', changed: false }])
    expect(right).toEqual([{ text: 'a b', changed: false }])
  })

  it('不带 options：严格比较（向后兼容，Hello vs hello 整词标红）', () => {
    expect(computeSpans('Hello', 'hello', 'word')).toEqual({
      left: [{ text: 'Hello', changed: true }],
      right: [{ text: 'hello', changed: true }],
    })
  })
})

/* -------------------------------------------------------------------------- */
/* applyInlineSpans 带 options                                                  */
/* -------------------------------------------------------------------------- */

describe('applyInlineSpans 带 options', () => {
  it('options 透传 computeSpans：忽略大小写下 del/add 行内只标红真实差异', () => {
    // 'Hello' vs 'hello world'：行级（ignoreCase）不等价（多出 world）→
    // del/add；行内投影（ignoreCase）里 Hello~hello 等价不标红。
    const skeleton = compareWithOptions('Hello\nx', 'hello world\nx', opts({ ignoreCase: true }))
    expect(skeleton.map((r) => r.type)).toEqual(['del', 'add', 'equal'])

    const result = applyInlineSpans(skeleton, 'word', { ignoreWhitespace: false, ignoreCase: true })
    expect(result[0].left!.words).toEqual([{ text: 'Hello', changed: false }])
    expect(result[1].right!.words).toEqual([
      { text: 'hello', changed: false },
      { text: ' world', changed: true },
    ])
    // 拼接恒等式在行对象上成立。
    expect(result[0].left!.words!.map((s) => s.text).join('')).toBe('Hello')
    expect(result[1].right!.words!.map((s) => s.text).join('')).toBe('hello world')
    // equal 行不填。
    expect(result[2].left!.words).toBeUndefined()
  })

  it('缺省 options：与不带参调用行为完全一致（向后兼容）', () => {
    const rows = diffLinesCore('a\nb\nc', 'a\nx\nc')
    expect(applyInlineSpans(rows, 'word', DEFAULT_OPTIONS)).toEqual(applyInlineSpans(rows, 'word'))
  })
})

/* -------------------------------------------------------------------------- */
/* 精度 × 选项正交矩阵 smoke                                                     */
/* -------------------------------------------------------------------------- */

describe('精度 × 选项正交矩阵 smoke', () => {
  const left = 'Foo Bar\nhello  world\nX\n\ntail'
  const right = 'foo bar\nhello world\nY\n\ntail'
  // 每个选项组合的行级 type 序列（同时验证选项确实生效于各自维度）：
  // - 仅忽略空白：Foo Bar / foo bar 是大小写差异 → del/add；hello  world /
  //   hello world 是空白差异 → equal；
  // - 仅忽略大小写：反之；
  // - 全开：两类差异都忽略，只剩 X ↔ Y 的真实替换。
  const optionBattery: Array<[string, DiffOptions, DiffRowType[]]> = [
    [
      'ignoreWhitespace',
      opts({ ignoreWhitespace: true }),
      ['del', 'add', 'equal', 'del', 'add', 'equal', 'equal'],
    ],
    [
      'ignoreCase',
      opts({ ignoreCase: true }),
      // jsdiff 把两组替换（hello  world→hello world 与 X→Y）合并为一个
      // del(2)+add(2) 区域输出（同为最小编辑脚本，分块取其一种对齐）。
      ['equal', 'del', 'del', 'add', 'add', 'equal', 'equal'],
    ],
    [
      'ignoreWhitespace+ignoreCase',
      opts({ ignoreWhitespace: true, ignoreCase: true }),
      ['equal', 'equal', 'del', 'add', 'equal', 'equal'],
    ],
  ]

  for (const [label, optionSet, expectedTypes] of optionBattery) {
    it(`${label}：4 精度不抛错，word/char/smart 行数与 type 序列同 line 骨架`, () => {
      const session = createDiffSession()
      const lineRows = getDiffRows(left, right, 'line', optionSet, session)
      expect(lineRows.map((r) => r.type)).toEqual(expectedTypes)

      for (const precision of ['word', 'char', 'smart'] as const) {
        const rows = getDiffRows(left, right, precision, optionSet, session)
        // 骨架行数不变量：行内投影 / smart 策略不改行序与行数。
        expect(rows).toHaveLength(lineRows.length)
        expect(rows.map((r) => r.type)).toEqual(lineRows.map((r) => r.type))
      }

      // 共享契约不变量：每行至少一侧存在。
      for (const row of lineRows) {
        expect(row.left !== undefined || row.right !== undefined).toBe(true)
      }
    })
  }
})

/* -------------------------------------------------------------------------- */
/* smart 降级路径（ENG-006 正式生效）                                            */
/* -------------------------------------------------------------------------- */

describe('smart 降级路径正式生效', () => {
  it("options.ignoreCase 下 'Foo Bar' vs 'foo bar' → equal 行带 words 且 changed 标记出现", () => {
    const rows = diffSmartPrecision('Foo Bar', 'foo bar', opts({ ignoreCase: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal'])
    const row = rows[0]
    expect(row.left!.text).toBe('Foo Bar')
    expect(row.right!.text).toBe('foo bar')
    // 词级 spans 把被忽略维度内的原文残差定位到词：Foo/foo、Bar/bar 标红，
    // 中间空格保持 false —— 「整行等价但词不同」因此可见。
    expect(row.left!.words).toEqual([
      { text: 'Foo', changed: true },
      { text: ' ', changed: false },
      { text: 'Bar', changed: true },
    ])
    expect(row.right!.words).toEqual([
      { text: 'foo', changed: true },
      { text: ' ', changed: false },
      { text: 'bar', changed: true },
    ])
    expect(row.left!.words!.map((s) => s.text).join('')).toBe('Foo Bar')
    expect(row.right!.words!.map((s) => s.text).join('')).toBe('foo bar')
  })

  it("options.ignoreWhitespace 下 'a  b' vs 'a b' → equal 行带 words（空白残差可见）", () => {
    const rows = diffSmartPrecision('a  b', 'a b', opts({ ignoreWhitespace: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal'])
    expect(rows[0].left!.words).toEqual([
      { text: 'a', changed: false },
      { text: '  ', changed: true },
      { text: 'b', changed: false },
    ])
    expect(rows[0].right!.words).toEqual([
      { text: 'a', changed: false },
      { text: ' ', changed: true },
      { text: 'b', changed: false },
    ])
  })

  it('降级不误伤：text 完全相同的 equal 行不填 words，仅等价残差行填', () => {
    const rows = diffSmartPrecision('same\nFoo', 'same\nfoo', opts({ ignoreCase: true }))
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal'])
    expect(rows[0].left!.words).toBeUndefined()
    expect(rows[0].right!.words).toBeUndefined()
    expect(rows[1].left!.words).toBeDefined()
    expect(rows[1].right!.words).toBeDefined()
  })

  it('无选项时降级路径不触发（既有行为不变）：equal 行 text 相同无 words', () => {
    const rows = diffSmartPrecision('a\n', 'a')
    expect(rows.map((r) => r.type)).toEqual(['equal'])
    expect(rows[0].left!.words).toBeUndefined()
    expect(rows[0].right!.words).toBeUndefined()
    expect(rows).toEqual(diffWordPrecision('a\n', 'a'))
  })

  it('getDiffRows 经缓存会话同样生效', () => {
    const rows = getDiffRows('Foo Bar', 'foo bar', 'smart', opts({ ignoreCase: true }), createDiffSession())
    expect(rows[0].type).toBe('equal')
    expect(rows[0].left!.words!.some((s) => s.changed)).toBe(true)
    expect(rows[0].right!.words!.some((s) => s.changed)).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* 缓存会话：选项维度                                                           */
/* -------------------------------------------------------------------------- */

describe('缓存会话的选项维度', () => {
  const left = 'a\nb'
  const right = 'a\nB'
  const ws = opts({ ignoreWhitespace: true })
  const cs = opts({ ignoreCase: true })

  it('同输入同选项命中缓存：computations 不增、cacheHits 增加', () => {
    const session = createDiffSession()
    session.get(left, right, 'line', ws)
    expect(session.stats().computations).toBe(1)
    session.get(left, right, 'line', ws)
    expect(session.stats().computations).toBe(1)
    expect(session.stats().cacheHits).toBe(1)
  })

  it('同输入不同选项分别计算：不同缓存条目互不串用（stats 断言）', () => {
    const session = createDiffSession()
    session.get(left, right, 'line', ws)
    expect(session.stats()).toEqual({ computations: 1, cacheHits: 0, cacheSize: 1 })
    session.get(left, right, 'line', cs)
    expect(session.stats()).toEqual({ computations: 2, cacheHits: 0, cacheSize: 2 })
    // 回到原选项：命中，不重算。
    session.get(left, right, 'line', ws)
    expect(session.stats().computations).toBe(2)
    expect(session.stats().cacheHits).toBe(1)
  })

  it('不传 options 与显式 DEFAULT_OPTIONS 落同一槽位（键一致）', () => {
    const session = createDiffSession()
    session.get(left, right, 'line')
    session.get(left, right, 'line', DEFAULT_OPTIONS)
    expect(session.stats().computations).toBe(1)
    expect(session.stats().cacheHits).toBe(1)
  })

  it('同选项下四种精度各算一次：computations=4，cacheHits 递增 0→1→2→3', () => {
    const session = createDiffSession()
    const hits: number[] = []
    for (const precision of ['line', 'word', 'char', 'smart'] as const) {
      session.get(left, right, precision, cs)
      hits.push(session.stats().cacheHits)
    }
    expect(session.stats().computations).toBe(4)
    expect(session.stats().cacheSize).toBe(1)
    expect(hits).toEqual([0, 1, 2, 3])
  })
})

/* -------------------------------------------------------------------------- */
/* getDiffRows：options 分发与向后兼容                                          */
/* -------------------------------------------------------------------------- */

describe('getDiffRows options 分发与向后兼容', () => {
  const left = 'a\nb\nc'
  const right = 'a\nX\nc'

  it("precision 'line' 带 options 与 compareWithOptions 深度相等", () => {
    const optionSet = opts({ ignoreCase: true })
    expect(getDiffRows(left, right, 'line', optionSet, createDiffSession())).toEqual(
      compareWithOptions(left, right, optionSet),
    )
  })

  it("precision 'smart' 带 options 与 diffSmartPrecision 深度相等", () => {
    const optionSet = opts({ ignoreCase: true })
    expect(getDiffRows(left, right, 'smart', optionSet, createDiffSession())).toEqual(
      diffSmartPrecision(left, right, optionSet),
    )
  })

  it('ignoreEmptyLines 经 getDiffRows 正确传递', () => {
    const rows = getDiffRows(
      'a\n\nb',
      'a\nb',
      'line',
      opts({ ignoreEmptyLines: true }),
      createDiffSession(),
    )
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal', 'equal'])
    expect(rows[1].right).toBeUndefined()
  })

  it('向后兼容：第 4 参传 session（ENG-004 旧签名）仍按旧语义工作', () => {
    expect(getDiffRows(left, right, 'line', createDiffSession())).toEqual(diffLinesCore(left, right))
    expect(getDiffRows(left, right, 'word', createDiffSession())).toEqual(
      diffWordPrecision(left, right),
    )
    expect(getDiffRows(left, right, 'smart', createDiffSession())).toEqual(
      diffSmartPrecision(left, right),
    )
  })
})
