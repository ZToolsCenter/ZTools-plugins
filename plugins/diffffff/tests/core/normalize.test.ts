/**
 * 输入规范化与边界元数据单元测试（roadmap 任务 ENG-010）。
 *
 * 覆盖 `src/core/normalize.ts` 的三个导出与引擎接线后的边界行为：
 * - `analyzeInput`：BOM 有无、尾部换行有无、CRLF/LF/CR 风格混用判定、
 *   0 字节空文本、byteLength（中文 3 字节 / emoji 4 字节）、以及
 *   `lines` 与引擎 `splitLines(normalizeText(...))` 契约一致性；
 * - `normalizeText`：剥开头单个 BOM、无 BOM 原样、中间 U+FEFF 不剥；
 * - 引擎边界集（经 `diffLinesCore` / `compareFull`）：单侧为空、两侧相同
 *   （含 2000 行大文本 smoke）、CRLF/LF/CR 两侧混用、尾部换行归一化为等价
 *   （策略定稿断言）、BOM 单侧 / 双侧无差异；
 * - `analyzeInputPair`：trailingNewlineDiffers 的成立与不成立边界。
 */
import { describe, expect, it } from 'vitest'
import { compareFull, diffLinesCore, splitLines } from '../../src/core/diff'
import { analyzeInput, analyzeInputPair, normalizeText } from '../../src/core/normalize'
import { DEFAULT_OPTIONS } from '../../src/core/options'

/* -------------------------------------------------------------------------- */
/* analyzeInput                                                                */
/* -------------------------------------------------------------------------- */

describe('analyzeInput', () => {
  it('BOM：无 BOM → hadBom false；有 BOM → true 且行内容不含 BOM 字符', () => {
    const noBom = analyzeInput('a\nb')
    expect(noBom.hadBom).toBe(false)
    expect(noBom.lines).toEqual(['a', 'b'])

    const withBom = analyzeInput('\uFEFFa\nb')
    expect(withBom.hadBom).toBe(true)
    // 首行是 'a' 而非 '\uFEFFa'：BOM 已剥除。
    expect(withBom.lines).toEqual(['a', 'b'])
  })

  it('尾部换行：\\n / \\r\\n / \\r 结尾都算，无换行结尾不算', () => {
    expect(analyzeInput('a').endsWithNewline).toBe(false)
    expect(analyzeInput('a\n').endsWithNewline).toBe(true)
    expect(analyzeInput('a\r\n').endsWithNewline).toBe(true) // CRLF 也算
    expect(analyzeInput('a\r').endsWithNewline).toBe(true)
    expect(analyzeInput('').endsWithNewline).toBe(false)
  })

  it('行尾风格混用："a\\r\\nb\\nc" 混用（CRLF + 孤立 LF），"a\\r\\nb\\r\\n" 纯 CRLF 不混用', () => {
    expect(analyzeInput('a\r\nb\nc').hasMixedLineEndings).toBe(true)
    expect(analyzeInput('a\r\nb\r\n').hasMixedLineEndings).toBe(false)
  })

  it('行尾风格混用：纯 LF / 纯 CR / 纯 CRLF / 单行 / 空文本均不混用', () => {
    expect(analyzeInput('a\nb\nc').hasMixedLineEndings).toBe(false)
    expect(analyzeInput('a\rb\rc').hasMixedLineEndings).toBe(false)
    expect(analyzeInput('a\r\nb\r\nc\r\n').hasMixedLineEndings).toBe(false)
    expect(analyzeInput('abc').hasMixedLineEndings).toBe(false)
    expect(analyzeInput('').hasMixedLineEndings).toBe(false)
  })

  it('行尾风格混用：三种风格全混（CRLF + 孤立 LF + 孤立 CR）', () => {
    expect(analyzeInput('a\r\nb\rc\nd').hasMixedLineEndings).toBe(true)
    expect(analyzeInput('a\r\nb\rc').hasMixedLineEndings).toBe(true) // CRLF + 孤立 CR
  })

  it('0 字节：空串 → 0 行、isEmpty、其余元数据全否', () => {
    expect(analyzeInput('')).toEqual({
      lines: [],
      hadBom: false,
      endsWithNewline: false,
      hasMixedLineEndings: false,
      isEmpty: true,
      byteLength: 0,
    })
  })

  it('BOM-only（\\uFEFF）：原文非空（isEmpty false，文档化边界）但剥 BOM 后 0 行', () => {
    const analyzed = analyzeInput('\uFEFF')
    expect(analyzed.isEmpty).toBe(false)
    expect(analyzed.lines).toEqual([])
    expect(analyzed.hadBom).toBe(true)
    expect(analyzed.byteLength).toBe(3) // EF BB BF
  })

  it('byteLength：中文 3 字节、emoji 4 字节、ASCII 1 字节，按原文计（含 BOM）', () => {
    expect(analyzeInput('a').byteLength).toBe(1)
    expect(analyzeInput('中').byteLength).toBe(3)
    expect(analyzeInput('😀').byteLength).toBe(4)
    expect(analyzeInput('a中😀').byteLength).toBe(8)
    expect(analyzeInput('\uFEFFa').byteLength).toBe(4) // BOM 3 字节 + 'a' 1 字节
  })

  it('lines 切分契约与引擎一致：analyzeInput(x).lines 恒等于 splitLines(normalizeText(x))', () => {
    // 锁定 normalize.ts 本地切分实现与 diff.ts splitLines 的契约一致性
    // （叶子模块避免循环依赖的副本实现，见 normalize.ts 文件头）。
    const samples = [
      '',
      'a',
      'a\n',
      'a\r\n',
      'a\r',
      'a\r\nb\nc\rd',
      'a\n\nb\r\n',
      '\n\n',
      '\uFEFF',
      '\uFEFFa\nb',
      '\uFEFFa\r\nb\nc',
    ]
    for (const sample of samples) {
      expect(analyzeInput(sample).lines).toEqual(splitLines(normalizeText(sample)))
    }
  })
})

/* -------------------------------------------------------------------------- */
/* normalizeText                                                               */
/* -------------------------------------------------------------------------- */

describe('normalizeText', () => {
  it('剥除开头单个 BOM', () => {
    expect(normalizeText('\uFEFFabc')).toBe('abc')
  })

  it('无 BOM 原样返回（含空串）', () => {
    expect(normalizeText('abc')).toBe('abc')
    expect(normalizeText('')).toBe('')
  })

  it('仅剥一个：连续两个开头 BOM 只剥第一个', () => {
    expect(normalizeText('\uFEFF\uFEFFabc')).toBe('\uFEFFabc')
  })

  it('文本中间 / 末尾的 U+FEFF 不剥', () => {
    expect(normalizeText('a\uFEFFb')).toBe('a\uFEFFb')
    expect(normalizeText('ab\uFEFF')).toBe('ab\uFEFF')
  })

  it('BOM-only 文本剥成空串', () => {
    expect(normalizeText('\uFEFF')).toBe('')
  })
})

/* -------------------------------------------------------------------------- */
/* 引擎边界集（ENG-010 规范化接线后）                                            */
/* -------------------------------------------------------------------------- */

describe('引擎边界（规范化接线后）', () => {
  it('单侧为空："" vs "x" → 纯增', () => {
    expect(diffLinesCore('', 'x')).toEqual([{ type: 'add', right: { lineNo: 1, text: 'x' } }])
  })

  it('单侧为空："x" vs "" → 纯删', () => {
    expect(diffLinesCore('x', '')).toEqual([{ type: 'del', left: { lineNo: 1, text: 'x' } }])
  })

  it('两侧都空："" vs "" → 0 行（diffLinesCore 与 compareFull 一致）', () => {
    expect(diffLinesCore('', '')).toEqual([])

    const result = compareFull('', '', DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual([])
    expect(result.hunks).toEqual([])
    expect(result.collapses).toEqual([])
    expect(result.stats).toEqual({
      addedLines: 0,
      removedLines: 0,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 0,
    })
  })

  it('两侧相同（大文本 smoke，2000 行）→ 全 equal、无 hunk、统计干净', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `line-${i}`).join('\n')
    const result = compareFull(text, text, DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stats).toEqual({
      addedLines: 0,
      removedLines: 0,
      modifiedPairs: 0,
      hunkCount: 0,
      totalRows: 2000,
    })
    expect(result.hunks).toEqual([])
    expect(result.collapses).toEqual([])
    for (const row of result.rows) expect(row.type).toBe('equal')
  })

  it('CRLF / LF / CR 混用两侧 → 切分后行相等，全 equal 无差异', () => {
    expect(diffLinesCore('a\r\nb\nc\rd', 'a\nb\r\nc\nd')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
      { type: 'equal', left: { lineNo: 3, text: 'c' }, right: { lineNo: 3, text: 'c' } },
      { type: 'equal', left: { lineNo: 4, text: 'd' }, right: { lineNo: 4, text: 'd' } },
    ])
  })

  it('尾部换行（策略定稿断言）："a\\n" vs "a" → equal，反向亦 equal，统计无增删', () => {
    const expected = [
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
    ]
    expect(diffLinesCore('a\n', 'a')).toEqual(expected)
    expect(diffLinesCore('a', 'a\n')).toEqual(expected)

    const result = compareFull('a\n', 'a', DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stats.addedLines).toBe(0)
    expect(result.stats.removedLines).toBe(0)
    expect(result.stats.totalRows).toBe(1)
  })

  it('BOM 单侧 → 无差异（走 compareFull），且首行 text 不含 BOM 字符', () => {
    const rows = diffLinesCore('\uFEFFa\nb', 'a\nb')
    expect(rows).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
    ])
    expect(rows[0].left!.text.includes('\uFEFF')).toBe(false)

    // compareFull 通道：覆盖 compareWithOptions 的入口接线。
    const result = compareFull('\uFEFFa\nb', 'a\nb', DEFAULT_OPTIONS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.hunks).toEqual([])
    expect(result.stats.addedLines).toBe(0)
    expect(result.stats.removedLines).toBe(0)
    expect(result.stats.totalRows).toBe(2)
  })

  it('BOM 双侧 → 无差异', () => {
    expect(diffLinesCore('\uFEFFa\nb', '\uFEFFa\nb')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
    ])
  })

  it('规范化叠加：BOM + CRLF + 尾部换行同时不同仍无差异', () => {
    expect(diffLinesCore('\uFEFFa\r\nb\r\n', 'a\nb')).toEqual([
      { type: 'equal', left: { lineNo: 1, text: 'a' }, right: { lineNo: 1, text: 'a' } },
      { type: 'equal', left: { lineNo: 2, text: 'b' }, right: { lineNo: 2, text: 'b' } },
    ])
  })
})

/* -------------------------------------------------------------------------- */
/* analyzeInputPair                                                            */
/* -------------------------------------------------------------------------- */

describe('analyzeInputPair', () => {
  it('"a\\n" vs "a" → trailingNewlineDiffers true（唯一差异是尾部换行）', () => {
    expect(analyzeInputPair('a\n', 'a').trailingNewlineDiffers).toBe(true)
  })

  it('"a" vs "b" → false（可见行不同，非尾部换行差异）', () => {
    expect(analyzeInputPair('a', 'b').trailingNewlineDiffers).toBe(false)
  })

  it('"a\\r\\n" vs "a" → true（CRLF 尾部换行同样判定）', () => {
    expect(analyzeInputPair('a\r\n', 'a').trailingNewlineDiffers).toBe(true)
  })

  it('"" vs "" → false（两侧都无尾部换行，谈不上不同）', () => {
    expect(analyzeInputPair('', '').trailingNewlineDiffers).toBe(false)
  })

  it('多行："x\\ny" vs "x\\ny\\n" → true；行内容不同则 false', () => {
    expect(analyzeInputPair('x\ny', 'x\ny\n').trailingNewlineDiffers).toBe(true)
    expect(analyzeInputPair('a\n', 'b\n').trailingNewlineDiffers).toBe(false)
  })

  it('BOM 单侧不阻断判定：可见行全等即按尾部换行判定', () => {
    expect(analyzeInputPair('\uFEFFa\n', 'a').trailingNewlineDiffers).toBe(true)
  })

  it('返回两侧完整元数据（lines / endsWithNewline / isEmpty）', () => {
    const pair = analyzeInputPair('a\n', '')
    expect(pair.left.lines).toEqual(['a'])
    expect(pair.left.endsWithNewline).toBe(true)
    expect(pair.left.hadBom).toBe(false)
    expect(pair.right.isEmpty).toBe(true)
    expect(pair.right.lines).toEqual([])
    // 行数不同（1 行 vs 0 行），不属于「唯一差异是尾部换行」。
    expect(pair.trailingNewlineDiffers).toBe(false)
  })
})
