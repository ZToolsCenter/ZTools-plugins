/**
 * 自定义忽略规则单元测试（roadmap 任务 ENG-007）。
 *
 * 覆盖 `src/core/ignoreRules.ts`、`src/core/options.ts` 的规则接入、
 * `src/core/diff.ts` 的引擎接线与 `src/core/inline.ts` 的 token 粒度接入：
 * - `compileIgnoreRules`：合法规则（时间戳 / 构建号 / 会话 ID）、g 标志自动
 *   补上（已有 g / 缺省 / 部分标志 / 空串各形态）、disabled 规则不参与
 *   （非法的 disabled 规则也不报错）、非法 pattern → invalid-regex 且报第一个、
 *   空列表 / 全 disabled → ok；
 * - `normalizeWithRules`：单规则全量替换、多规则按序叠加、与
 *   compileIgnoreRules 产物配合；
 * - `normalizeForCompare` 规则接入：折叠顺序 = 规则（原始行）→ 空白 →
 *   大小写（构造「规则删除数字后留下的尾部空白被后续 trim 吸收」用例证明
 *   规则先行），慢路径兜底编译生效 / 编译失败跳过不抛；
 * - `compareWithOptions` 带规则：仅时间戳 / 构建号 / 会话 ID 不同的行 →
 *   equal 且原文保留、规则 × 空白 × 大小写组合、disabled 不生效、同一行
 *   多处命中、非法规则 → 抛 RuleError（error.kind / pattern 正确、多条规则
 *   报第一条非法）、空规则列表 = 无规则；
 * - `compareFull`：合法 → ok:true（rows / stats 正确；ENG-008 起 hunks /
 *   collapses 由 buildHunks 填充，hunks.test.ts 详测投影本身）、非法 →
 *   ok:false invalid-regex（不抛）、无规则无选项 → rows 与其余统计和
 *   compare 一致（电池）、带 ENG-006 开关正常、非 string 输入防御；
 * - `computeSpans` 带规则：拼接恒等式（规则 × 粒度 × 样本电池）、规则命中
 *   token 不标红而真实差异标红、预编译第 5 参与兜底路径结果一致、char 粒度
 *   生效、无规则时与不带 options 行为一致；
 * - `applyInlineSpans` / 精度链路：规则命中 token 不标红（手工骨架 +
 *   真实 del/add 对）、session 链路 word / char / smart 带规则贯通；
 * - 缓存与 optionsKey：无规则输出逐字节不变、不同启用规则不同键、
 *   id/label/disabled 差异不影响键、flags 参与且缺省归一、非法 pattern
 *   参与指纹、同输入不同规则 → 不同缓存条目（stats 断言）。
 */
import { describe, expect, it } from 'vitest'
import { compare, compareFull, compareWithOptions, diffLinesCore } from '../../src/core/diff'
import { applyInlineSpans, computeSpans } from '../../src/core/inline'
import { compileIgnoreRules, normalizeWithRules, RuleError } from '../../src/core/ignoreRules'
import { createDiffSession, getDiffRows } from '../../src/core/precision'
import { DEFAULT_OPTIONS, normalizeForCompare, optionsKey } from '../../src/core/options'
import type { DiffOptions, DiffRow, IgnoreRule } from '../../src/core/types'

/** 构造完整 DiffOptions：缺省字段用 DEFAULT_OPTIONS 兜底（三开关 false）。 */
function opts(partial: Partial<DiffOptions> = {}): DiffOptions {
  return { ...DEFAULT_OPTIONS, ...partial }
}

/** 构造 IgnoreRule：缺省启用，extra 可覆盖 enabled / flags / label。 */
function rule(
  id: string,
  pattern: string,
  extra: Partial<Omit<IgnoreRule, 'id' | 'pattern'>> = {},
): IgnoreRule {
  return { id, pattern, enabled: true, ...extra }
}

/** 捕获同步异常（返回 unknown，供 instanceof / error 属性断言）。 */
function catchError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

/* -------------------------------------------------------------------------- */
/* compileIgnoreRules                                                          */
/* -------------------------------------------------------------------------- */

describe('compileIgnoreRules', () => {
  it('合法规则列表（时间戳 / 构建号 / 会话 ID）→ ok 且按序编译', () => {
    const result = compileIgnoreRules([
      rule('ts', '\\d{4}-\\d{2}-\\d{2}'),
      rule('build', 'build-\\d+'),
      rule('sess', 'sess_[a-z0-9]+'),
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.regexes).toHaveLength(3)
      expect(result.regexes.map((re) => re.source)).toEqual([
        '\\d{4}-\\d{2}-\\d{2}',
        'build-\\d+',
        'sess_[a-z0-9]+',
      ])
    }
  })

  it('全局标志 g 自动补上（缺省 / 部分标志 / 已含 g / 空串各形态）', () => {
    const result = compileIgnoreRules([
      rule('a', 'x'),
      rule('b', 'y', { flags: 'i' }),
      rule('c', 'z', { flags: 'g' }),
      rule('d', 'w', { flags: 'gi' }),
      rule('e', 'v', { flags: '' }),
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      // RegExp.prototype.flags 恒按字母序归一化返回（'i'+'g' → 'gi'）。
      expect(result.regexes.map((re) => re.flags)).toEqual(['g', 'gi', 'g', 'gi', 'g'])
    }
  })

  it('disabled 规则不参与编译（非法的 disabled 规则也不报错）', () => {
    const result = compileIgnoreRules([
      rule('off-bad', '([', { enabled: false }),
      rule('off-ok', '\\d+', { enabled: false }),
      rule('on', '\\d+'),
    ])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.regexes).toHaveLength(1)
  })

  it('非法 pattern → ok:false 且 error 为 invalid-regex 携带 pattern', () => {
    const result = compileIgnoreRules([rule('bad', '([')])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'invalid-regex', pattern: '([' })
    }
  })

  it('多条规则存在非法时报告第一个非法 pattern（fail-fast）', () => {
    const result = compileIgnoreRules([
      rule('r1', 'ok'),
      rule('r2', '('),
      rule('r3', '*'),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'invalid-regex', pattern: '(' })
    }
  })

  it('空列表 / 全 disabled → ok 且 regexes 为空', () => {
    expect(compileIgnoreRules([])).toEqual({ ok: true, regexes: [] })
    expect(compileIgnoreRules([rule('a', 'x', { enabled: false })])).toEqual({
      ok: true,
      regexes: [],
    })
  })
})

/* -------------------------------------------------------------------------- */
/* normalizeWithRules                                                          */
/* -------------------------------------------------------------------------- */

describe('normalizeWithRules', () => {
  it('单规则替换生效且同一文本内全量命中', () => {
    expect(normalizeWithRules('2024-01-02 deploy', [/\d{4}-\d{2}-\d{2}/g])).toBe(' deploy')
    expect(normalizeWithRules('v1 v22 v333', [/\d+/g])).toBe('v v v')
  })

  it('多规则按序叠加（前一条输出为后一条输入）', () => {
    expect(normalizeWithRules('2024-01-02 sess_abc end', [/\d{4}-\d{2}-\d{2}/g, /sess_[a-z0-9]+/g])).toBe(
      '  end',
    )
  })

  it('与 compileIgnoreRules 产物配合使用', () => {
    const compiled = compileIgnoreRules([rule('build', 'build-\\d+')])
    expect(compiled.ok).toBe(true)
    if (compiled.ok) {
      expect(normalizeWithRules('build-123 ok', compiled.regexes)).toBe(' ok')
    }
  })
})

/* -------------------------------------------------------------------------- */
/* normalizeForCompare 的规则接入与折叠顺序                                     */
/* -------------------------------------------------------------------------- */

describe('normalizeForCompare 的规则接入与折叠顺序', () => {
  it('规则先行：删除数字留下的尾部空白被后续空白折叠吸收（顺序证明）', () => {
    // 顺序证明：规则先在原始行上删除 '1' 得 'v '，再由 ignoreWhitespace
    // trim 得 'v'。若空白折叠先于规则执行，则得 'v ' ≠ 'v'（规则删除后
    // 不再 trim），本断言即失败。
    expect(normalizeForCompare('v 1', { ignoreWhitespace: true }, [/\d+/g])).toBe('v')
  })

  it('规则 + 忽略大小写：先删数字再整体小写', () => {
    expect(normalizeForCompare('V1', { ignoreWhitespace: false, ignoreCase: true }, [/\d+/g])).toBe('v')
  })

  it('规则 × 空白 × 大小写全开组合', () => {
    // 'V 1 x' → 规则删 '1' → 'V  x' → 空白折叠 → 'V x' → 小写 → 'v x'。
    expect(
      normalizeForCompare('V 1 x', { ignoreWhitespace: true, ignoreCase: true }, [/\d+/g]),
    ).toBe('v x')
  })

  it('无规则时行为与 ENG-006 时代逐字节一致', () => {
    expect(normalizeForCompare('A b', { ignoreWhitespace: false, ignoreCase: false })).toBe('A b')
    expect(normalizeForCompare('a  b ', { ignoreWhitespace: true, ignoreCase: false })).toBe('a b')
    expect(normalizeForCompare('AbC', { ignoreWhitespace: false, ignoreCase: true })).toBe('abc')
  })

  it('慢路径：不传 regexes 时按 options.ignoreRules 兜底编译', () => {
    expect(normalizeForCompare('v1', opts({ ignoreRules: [rule('d', '\\d+')] }))).toBe('v')
  })

  it('慢路径编译失败：跳过规则不抛错（错误通道在入口层）', () => {
    expect(normalizeForCompare('v1', opts({ ignoreRules: [rule('bad', '([')] }))).toBe('v1')
  })
})

/* -------------------------------------------------------------------------- */
/* compareWithOptions 带忽略规则                                               */
/* -------------------------------------------------------------------------- */

describe('compareWithOptions 带忽略规则', () => {
  it('仅时间戳不同的行 → equal 且两侧原文保留', () => {
    const rows = compareWithOptions(
      '2024-01-02 deploy ok\nkeep',
      '2025-06-07 deploy ok\nkeep',
      opts({ ignoreRules: [rule('ts', '\\d{4}-\\d{2}-\\d{2}')] }),
    )
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal'])
    expect(rows[0].left).toEqual({ lineNo: 1, text: '2024-01-02 deploy ok' })
    expect(rows[0].right).toEqual({ lineNo: 1, text: '2025-06-07 deploy ok' })
    expect(rows[1].left).toEqual({ lineNo: 2, text: 'keep' })
    expect(rows[1].right).toEqual({ lineNo: 2, text: 'keep' })
  })

  it('构建号 / 会话 ID 规则同样判等', () => {
    const build = compareWithOptions(
      'build-123 done',
      'build-456 done',
      opts({ ignoreRules: [rule('b', 'build-\\d+')] }),
    )
    expect(build.map((r) => r.type)).toEqual(['equal'])
    const sess = compareWithOptions(
      'sess_abc123 done',
      'sess_zz9 done',
      opts({ ignoreRules: [rule('s', 'sess_[a-z0-9]+')] }),
    )
    expect(sess.map((r) => r.type)).toEqual(['equal'])
  })

  it('规则 × ignoreWhitespace × ignoreCase 组合（行级顺序证明）', () => {
    // 'v 1' 规则删 '1' 得 'v '，尾部空白由 ignoreWhitespace 吸收 → 与
    // 'v999'（规则删 '999' 得 'v'）等价；'END' 与 'end' 经 ignoreCase 等价。
    const rows = compareWithOptions(
      'v 1\nEND',
      'v999\nend',
      opts({
        ignoreWhitespace: true,
        ignoreCase: true,
        ignoreRules: [rule('d', '\\d+')],
      }),
    )
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal'])
    expect(rows[0].left!.text).toBe('v 1')
    expect(rows[0].right!.text).toBe('v999')
  })

  it('同一行多处命中：全部片段都被规则吸收', () => {
    const rows = compareWithOptions(
      'a 1 b 2\nc 3',
      'a 9 b 9\nc 8',
      opts({ ignoreRules: [rule('d', '\\d+')] }),
    )
    expect(rows.map((r) => r.type)).toEqual(['equal', 'equal'])
  })

  it('disabled 规则不参与比较', () => {
    const rows = compareWithOptions(
      'v1',
      'v2',
      opts({ ignoreRules: [rule('d', '\\d+', { enabled: false })] }),
    )
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
  })

  it('非法规则 → 抛 RuleError 且 error.kind / pattern 正确', () => {
    const attempt = () =>
      compareWithOptions('a', 'b', opts({ ignoreRules: [rule('bad', '([')] }))
    expect(attempt).toThrow(RuleError)
    const caught = catchError(attempt)
    expect(caught).toBeInstanceOf(RuleError)
    expect((caught as RuleError).error).toEqual({ kind: 'invalid-regex', pattern: '([' })
  })

  it('多条规则中第二条非法 → pattern 报第二条', () => {
    const caught = catchError(() =>
      compareWithOptions('a', 'b', opts({ ignoreRules: [rule('r1', '\\d+'), rule('r2', '*')] })),
    )
    expect(caught).toBeInstanceOf(RuleError)
    expect((caught as RuleError).error).toEqual({ kind: 'invalid-regex', pattern: '*' })
  })

  it('空规则列表 = 无规则（与 diffLinesCore 深度一致）', () => {
    expect(compareWithOptions('a\nb', 'a\nc', opts({ ignoreRules: [] }))).toEqual(
      diffLinesCore('a\nb', 'a\nc'),
    )
  })
})

/* -------------------------------------------------------------------------- */
/* compareFull                                                                 */
/* -------------------------------------------------------------------------- */

describe('compareFull', () => {
  it('合法规则 → ok:true，rows 与统计正确（ENG-008 起 hunks 已接线，全文件单 hunk 无折叠）', () => {
    const result = compareFull(
      '2024-01-02 deploy\nnew',
      '2025-06-07 deploy\nnew\nextra',
      opts({ ignoreRules: [rule('ts', '\\d{4}-\\d{2}-\\d{2}')] }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows.map((r) => r.type)).toEqual(['equal', 'equal', 'add'])
      expect(result.rows[0].left!.text).toBe('2024-01-02 deploy')
      expect(result.rows[0].right!.text).toBe('2025-06-07 deploy')
      // 唯一变更（add）向两侧扩 3 行上下文即覆盖全部 3 行 → 单 hunk、无折叠。
      expect(result.stats).toEqual({
        addedLines: 1,
        removedLines: 0,
        modifiedPairs: 0,
        hunkCount: 1,
        totalRows: 3,
      })
      expect(result.hunks).toHaveLength(1)
      expect(result.hunks[0]).toMatchObject({
        header: '@@ -1,2 +1,3 @@',
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
      })
      expect(result.hunks[0].rows).toEqual(result.rows)
      expect(result.collapses).toEqual([])
    }
  })

  it('del / add 统计正确（无规则）', () => {
    const result = compareFull('a\nb\n', 'a\nc\n', DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows.map((r) => r.type)).toEqual(['equal', 'del', 'add'])
      // 变更簇 + 3 行上下文覆盖全部 3 行 → hunkCount = 1（ENG-008 接线）。
      expect(result.stats).toEqual({
        addedLines: 1,
        removedLines: 1,
        modifiedPairs: 0,
        hunkCount: 1,
        totalRows: 3,
      })
    }
  })

  it('非法规则 → ok:false invalid-regex（不抛异常）', () => {
    const result = compareFull('a', 'b', opts({ ignoreRules: [rule('bad', '([')] }))
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-regex', pattern: '([' } })
  })

  it('无规则无选项 → rows 与其余统计和 compare 深度一致（电池）', () => {
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
      const full = compareFull(left, right, DEFAULT_OPTIONS)
      const plain = compare(left, right)
      expect(full.ok).toBe(true)
      expect(plain.ok).toBe(true)
      if (full.ok && plain.ok) {
        // ENG-008 起 compareFull 额外接线 hunks / collapses（compare 仍为
        // 空占位），两者的一致面收敛到 rows 与除 hunkCount 外的统计字段。
        expect(full.rows).toEqual(plain.rows)
        const { hunkCount: _fullHunks, ...fullStats } = full.stats
        const { hunkCount: _plainHunks, ...plainStats } = plain.stats
        expect(fullStats).toEqual(plainStats)
      }
    }
  })

  it('带 ENG-006 开关正常工作（rows 与 compareWithOptions 一致）', () => {
    const options = opts({ ignoreWhitespace: true })
    const result = compareFull('foo \nbar', 'foo\nbar', options)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows).toEqual(compareWithOptions('foo \nbar', 'foo\nbar', options))
      expect(result.rows.map((r) => r.type)).toEqual(['equal', 'equal'])
    }
  })

  it('输入非 string → internal 错误（对齐 compare 防御约定）', () => {
    const result = compareFull(null as unknown as string, 'b', DEFAULT_OPTIONS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('internal')
  })
})

/* -------------------------------------------------------------------------- */
/* computeSpans 带忽略规则                                                     */
/* -------------------------------------------------------------------------- */

describe('computeSpans 带忽略规则', () => {
  // 规则电池：单数字 / 时间戳 / 多规则叠加 / 永不命中 / 空。
  const rulesBattery: IgnoreRule[][] = [
    [rule('d', '\\d+')],
    [rule('ts', '\\d{4}-\\d{2}-\\d{2}')],
    [rule('w', 'error'), rule('d', '\\d+')],
    [rule('never', 'zzz-never-match')],
    [],
  ]
  const granularities = ['word', 'char'] as const
  const samples: Array<[string, string]> = [
    ['v1', 'v2'],
    ['build-123 ok', 'build-456 ok'],
    ['2024-01-02 deploy', '2025-06-07 deploy'],
    ['error ok', 'error fail'],
    ['版本v1发布', '版本v22发布'],
    ['a  b \tc', 'a b  c\t'],
    ['', ''],
    ['x', ''],
    ['', 'y'],
  ]

  it('拼接恒等式电池（规则 × 粒度 × 样本）', () => {
    for (const rules of rulesBattery) {
      for (const granularity of granularities) {
        for (const [leftText, rightText] of samples) {
          const spans = computeSpans(leftText, rightText, granularity, opts({ ignoreRules: rules }))
          // 原文 token 保留在 spans 中：拼接恒等于各自侧原文。
          expect(spans.left.map((s) => s.text).join('')).toBe(leftText)
          expect(spans.right.map((s) => s.text).join('')).toBe(rightText)
        }
      }
    }
  })

  it('规则命中 token 不标红，真实差异仍标红', () => {
    const spans = computeSpans(
      'error ok',
      'error fail',
      'word',
      opts({ ignoreRules: [rule('w', 'error')] }),
    )
    // 'error' token 经规则删除后两侧同为空串 → 等价 → 不标红。
    const leftError = spans.left.find((s) => s.text.includes('error'))!
    const rightError = spans.right.find((s) => s.text.includes('error'))!
    expect(leftError.changed).toBe(false)
    expect(rightError.changed).toBe(false)
    // 真实差异（ok / fail）仍标红。
    expect(spans.left.find((s) => s.text === 'ok')!.changed).toBe(true)
    expect(spans.right.find((s) => s.text === 'fail')!.changed).toBe(true)
  })

  it('数字 token 规则：v1 vs v2 全等价（无任何标红）', () => {
    // tokenizer 铁律：'v1' → ['v', '1']；规则删数字后两侧 token 全等价。
    const spans = computeSpans('v1', 'v2', 'word', opts({ ignoreRules: [rule('d', '\\d+')] }))
    expect(spans.left.every((s) => !s.changed)).toBe(true)
    expect(spans.right.every((s) => !s.changed)).toBe(true)
    expect(spans.left.map((s) => s.text).join('')).toBe('v1')
    expect(spans.right.map((s) => s.text).join('')).toBe('v2')
  })

  it('char 粒度同样生效', () => {
    const spans = computeSpans('a1b', 'a2b', 'char', opts({ ignoreRules: [rule('d', '\\d+')] }))
    expect(spans.left.every((s) => !s.changed)).toBe(true)
    expect(spans.right.every((s) => !s.changed)).toBe(true)
    expect(spans.left.map((s) => s.text).join('')).toBe('a1b')
    expect(spans.right.map((s) => s.text).join('')).toBe('a2b')
  })

  it('预编译第 5 参与经 options 兜底路径结果一致', () => {
    const compiled = compileIgnoreRules([rule('d', '\\d+')])
    expect(compiled.ok).toBe(true)
    const regexes = compiled.ok ? compiled.regexes : []
    const options = opts({ ignoreRules: [rule('d', '\\d+')] })
    expect(computeSpans('v1 x', 'v2 x', 'word', options, regexes)).toEqual(
      computeSpans('v1 x', 'v2 x', 'word', options),
    )
  })

  it('无规则时与不带 options 的行为一致（向后兼容）', () => {
    expect(computeSpans('Hello world', 'hello there', 'word', opts())).toEqual(
      computeSpans('Hello world', 'hello there', 'word'),
    )
  })
})

/* -------------------------------------------------------------------------- */
/* applyInlineSpans 与精度链路的规则贯通                                        */
/* -------------------------------------------------------------------------- */

describe('applyInlineSpans 与精度链路的规则贯通', () => {
  it('手工骨架带规则：规则命中 token 不标红，原文拼接恒等', () => {
    const skeleton: DiffRow[] = [
      { type: 'del', left: { lineNo: 1, text: 'error ok' } },
      { type: 'add', right: { lineNo: 1, text: 'error fail' } },
    ]
    const out = applyInlineSpans(skeleton, 'word', opts({ ignoreRules: [rule('w', 'error')] }))
    const leftWords = out[0].left!.words!
    const rightWords = out[1].right!.words!
    expect(leftWords.map((s) => s.text).join('')).toBe('error ok')
    expect(rightWords.map((s) => s.text).join('')).toBe('error fail')
    expect(leftWords.find((s) => s.text.includes('error'))!.changed).toBe(false)
    expect(rightWords.find((s) => s.text.includes('error'))!.changed).toBe(false)
    expect(leftWords.find((s) => s.text === 'ok')!.changed).toBe(true)
    expect(rightWords.find((s) => s.text === 'fail')!.changed).toBe(true)
  })

  it('真实 del/add 对：行级不等但 token 级规则命中的片段不标红', () => {
    // 'ax a' vs 'ax b'：行级不等（无规则）；带规则 /x/g 后 token 'ax' → 'a'
    // 两侧等价不标红，只有真实差异 'a' / 'b' 标红。
    const rows = applyInlineSpans(
      diffLinesCore('ax a', 'ax b'),
      'word',
      opts({ ignoreRules: [rule('x', 'x')] }),
    )
    expect(rows.map((r) => r.type)).toEqual(['del', 'add'])
    // 'ax' token 与相邻空格 token 同属 equal 块，合并为一个 changed:false 的 span。
    expect(rows[0].left!.words!.find((s) => s.text.includes('ax'))!.changed).toBe(false)
    expect(rows[1].right!.words!.find((s) => s.text.includes('ax'))!.changed).toBe(false)
    expect(rows[0].left!.words!.find((s) => s.text === 'a')!.changed).toBe(true)
    expect(rows[1].right!.words!.find((s) => s.text === 'b')!.changed).toBe(true)
  })

  it('session 链路贯通：line / word / char / smart 带规则的 options 均生效', () => {
    const session = createDiffSession()
    const options = opts({ ignoreRules: [rule('d', '\\d+')] })
    const left = 'v1 end\nkeep'
    const right = 'v2 end\nkeep'
    for (const precision of ['line', 'word', 'char', 'smart'] as const) {
      const rows = session.get(left, right, precision, options)
      // 行级规则判等：四种精度下行骨架全 equal（规则在整个链路生效）。
      expect(rows.map((r) => r.type)).toEqual(['equal', 'equal'])
    }
    // smart 的等价残差行带词级 spans（严格比较定位原文差异），拼接恒等式仍成立。
    for (const row of session.get(left, right, 'smart', options)) {
      if (row.left?.words !== undefined) {
        expect(row.left.words.map((s) => s.text).join('')).toBe(row.left.text)
      }
      if (row.right?.words !== undefined) {
        expect(row.right.words.map((s) => s.text).join('')).toBe(row.right.text)
      }
    }
  })

  it('getDiffRows 带规则（显式会话）与 session.get 一致', () => {
    const session = createDiffSession()
    const options = opts({ ignoreRules: [rule('d', '\\d+')] })
    expect(getDiffRows('v1\n', 'v2\n', 'word', options, session).map((r) => r.type)).toEqual([
      'equal',
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* 缓存与 optionsKey 的规则维度                                                 */
/* -------------------------------------------------------------------------- */

describe('缓存与 optionsKey 的规则维度', () => {
  it('optionsKey：无规则 options 输出与 ENG-006 时代逐字节一致', () => {
    expect(optionsKey(DEFAULT_OPTIONS)).toBe(
      '{"ignoreWhitespace":false,"ignoreCase":false,"ignoreEmptyLines":false}',
    )
    expect(optionsKey({ ignoreWhitespace: true, ignoreCase: false, ignoreRules: [] })).toBe(
      '{"ignoreWhitespace":true,"ignoreCase":false,"ignoreEmptyLines":false}',
    )
  })

  it('不同启用规则 → 不同键；同规则不同 id / label → 同键', () => {
    const digits = optionsKey(opts({ ignoreRules: [rule('a', '\\d+')] }))
    expect(optionsKey(opts({ ignoreRules: [rule('a', 'sess_\\w+')] }))).not.toBe(digits)
    expect(optionsKey(opts({ ignoreRules: [rule('other-id', '\\d+', { label: '备注' })] }))).toBe(
      digits,
    )
  })

  it('disabled 规则差异不影响键（不影响比较结果）', () => {
    const digits = optionsKey(opts({ ignoreRules: [rule('a', '\\d+')] }))
    expect(
      optionsKey(opts({ ignoreRules: [rule('a', '\\d+'), rule('off', 'zzz', { enabled: false })] })),
    ).toBe(digits)
    expect(optionsKey(opts({ ignoreRules: [rule('off', 'zzz', { enabled: false })] }))).toBe(
      optionsKey(DEFAULT_OPTIONS),
    )
  })

  it('flags 参与指纹且缺省归一为空串（与编译语义一致）', () => {
    const plain = optionsKey(opts({ ignoreRules: [rule('a', '\\d+')] }))
    expect(optionsKey(opts({ ignoreRules: [rule('a', '\\d+', { flags: '' })] }))).toBe(plain)
    expect(optionsKey(opts({ ignoreRules: [rule('a', '\\d+', { flags: 'i' })] }))).not.toBe(plain)
  })

  it('非法 pattern 也参与指纹（编译失败的 options 不与合法 / 无规则撞键）', () => {
    const bad = optionsKey(opts({ ignoreRules: [rule('bad', '([')] }))
    expect(bad).not.toBe(optionsKey(DEFAULT_OPTIONS))
    expect(bad).not.toBe(optionsKey(opts({ ignoreRules: [rule('good', '\\d+')] })))
  })

  it('缓存会话：同输入同规则命中，不同规则 → 不同缓存条目（stats 断言）', () => {
    const session = createDiffSession()
    const left = 'v1 x'
    const right = 'v2 x'
    const digits = opts({ ignoreRules: [rule('a', '\\d+')] })

    session.get(left, right, 'line', digits)
    expect(session.stats()).toEqual({ computations: 1, cacheHits: 0, cacheSize: 1 })

    // 同输入同规则 → 命中缓存。
    session.get(left, right, 'line', digits)
    expect(session.stats()).toEqual({ computations: 1, cacheHits: 1, cacheSize: 1 })

    // 同输入不同规则 → 新缓存条目（optionsKey 指纹生效）。
    session.get(left, right, 'line', opts({ ignoreRules: [rule('a', 'sess_\\w+')] }))
    expect(session.stats()).toEqual({ computations: 2, cacheHits: 1, cacheSize: 2 })
  })

  it('缓存结果随规则不同而不同（不串用槽位）', () => {
    const session = createDiffSession()
    const withRule = session.get('v1\n', 'v2\n', 'line', opts({
      ignoreRules: [rule('d', '\\d+')],
    }))
    const noRule = session.get('v1\n', 'v2\n', 'line', DEFAULT_OPTIONS)
    expect(withRule.map((r) => r.type)).toEqual(['equal'])
    expect(noRule.map((r) => r.type)).toEqual(['del', 'add'])
  })
})
