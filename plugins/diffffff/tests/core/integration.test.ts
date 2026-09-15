/**
 * 跨模块集成测试（roadmap 任务 ENG-013：单测整合审计的补缺面）。
 *
 * 职责说明：ENG-013 清单的各模块测试面（tokenizer / 四精度 / 选项组合 /
 * 忽略规则 / hunk 折叠 / 边界集 / 大文本防护）已由 tests/core/ 下 12 个
 * 模块级文件覆盖（见各文件头注释），本文件**不重复**既有断言，只补
 * 「跨模块组合场景」的整合缺口：
 *
 * 1. 端到端组合链：compareFull（ignoreWhitespace + ignoreCase + ignoreRules
 *    组合选项）→ buildHunks（contextLines = 2）→ computeStats →
 *    rowsWithPairing 后重新 stats（modifiedPairs > 0）全链路交叉断言；
 * 2. compareIncremental 与 compareFull 在「中文 + emoji + 制表符 +
 *    CRLF/LF/CR 混合 + BOM」大杂烩输入上的深度一致（guards.test.ts 的
 *    模糊测试字符集为纯 ASCII、不含 BOM，此处补齐多字节 / BOM 路径）；
 * 3. getDiffRows 四精度 × 三选项矩阵的行号双侧单调不变量与行内 spans
 *    拼接恒等式（options.test.ts 的正交矩阵只断言 type 序列，无行号断言）；
 * 4. 超长行（ENG-012）与 hunk / 折叠（ENG-008）共存：超长行落在折叠区段
 *    内 / hunk 上下文内 / 变更行本身超长，标记经投影保持（longline 与
 *    hunks 两个既有文件各自只测单边）；
 * 5. applyInlineSpans（ENG-003 位置配对）与 rowsWithPairing（ENG-005
 *    相似度配对）对同一替换区域的 spans 拼接恒等式（word 粒度，多行
 *    错位区域；pairing.test.ts 的共存用例只覆盖单行块）。
 */
import { describe, expect, it } from 'vitest'
import { compareFull, compareIncremental } from '../../src/core/diff'
import { buildHunks } from '../../src/core/hunks'
import { applyInlineSpans, computeSpans } from '../../src/core/inline'
import { DEFAULT_OPTIONS } from '../../src/core/options'
import { rowsWithPairing } from '../../src/core/pairing'
import { createDiffSession, getDiffRows } from '../../src/core/precision'
import { computeStats } from '../../src/core/stats'
import type { DiffOptions, DiffRow, IgnoreRule } from '../../src/core/types'

/* -------------------------------------------------------------------------- */
/* 测试辅助                                                                    */
/* -------------------------------------------------------------------------- */

/** 构造完整 DiffOptions：缺省字段用 DEFAULT_OPTIONS 兜底（三开关 false）。 */
function opts(partial: Partial<DiffOptions> = {}): DiffOptions {
  return { ...DEFAULT_OPTIONS, ...partial }
}

/** 同步调度器：compareIncremental 注入后整链在微任务序列内完成（确定性）。 */
const syncScheduler = (cb: () => void): void => cb()

/** 数字忽略规则（A 组合链与大杂烩选项复用）：吸收构建号 / 端口等数字差异。 */
const DIGIT_RULE: IgnoreRule = { id: 'digits', pattern: '\\d+', flags: 'g', enabled: true }

/**
 * 断言单行的 spans 拼接恒等式（types.ts WordDiffSpan 契约）：任一侧存在
 * `words` 时，`spans.map(s => s.text).join('')` 必须恒等于该侧 `text`。
 */
function expectSpansJoinIdentity(row: DiffRow): void {
  if (row.left?.words !== undefined) {
    expect(row.left.words.map((s) => s.text).join('')).toBe(row.left.text)
  }
  if (row.right?.words !== undefined) {
    expect(row.right.words.map((s) => s.text).join('')).toBe(row.right.text)
  }
}

/* -------------------------------------------------------------------------- */
/* 一、端到端组合链：compareFull → buildHunks → computeStats → rowsWithPairing  */
/* -------------------------------------------------------------------------- */

describe('端到端组合链：compareFull → buildHunks → computeStats → rowsWithPairing', () => {
  // 组合选项设计：三处差异分别由 ignoreCase（Version/version）、
  // ignoreWhitespace（#  project CONFIG）、ignoreRules（build/port/ttl 的
  // 数字）吸收；两处真实差异（mode、log.level）构成 del/add 配对区域。
  // 变更行间隔 8 行 equal > 2*contextLines(2)，产出两个 hunk + 一个折叠段。
  const LEFT = [
    '# Project Config',
    'build: 2024-01-15',
    'Version: 1.2.3',
    'mode: debug',
    'feature_alpha = on',
    'feature_beta = off',
    'feature_gamma = on',
    'feature_delta = off',
    'server.host = localhost',
    'server.port = 8080',
    'cache.enabled = true',
    'cache.ttl = 3600',
    'log.level = info',
    'locale = zh_CN',
    'theme = dark',
    'editor = vim',
    'shell = zsh',
    'END OF CONFIG',
  ].join('\n')
  const RIGHT = [
    '#  project CONFIG',
    'build: 2024-02-20',
    'version: 1.2.3',
    'mode: release',
    'feature_alpha = on',
    'feature_beta = off',
    'feature_gamma = on',
    'feature_delta = off',
    'server.host = localhost',
    'server.port = 9090',
    'cache.enabled = true',
    'cache.ttl = 7200',
    'log.level = warn',
    'locale = zh_CN',
    'theme = dark',
    'editor = vim',
    'shell = zsh',
    'END OF CONFIG',
  ].join('\n')
  const COMBINED = opts({
    ignoreWhitespace: true,
    ignoreCase: true,
    ignoreRules: [DIGIT_RULE],
  })

  it('compareFull(组合选项, contextLines=2) 的 hunks/collapses 与独立 buildHunks 深度一致，stats 与 computeStats 交叉一致', () => {
    const result = compareFull(LEFT, RIGHT, COMBINED, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 交叉验证一：compareFull 内部投影 ≡ 对同一 rows 独立调用 buildHunks。
    const independent = buildHunks(result.rows, 2)
    expect(result.hunks).toEqual(independent.hunks)
    expect(result.collapses).toEqual(independent.collapses)

    // 交叉验证二：stats ≡ computeStats(rows, hunks.length)（ENG-009 接线）。
    expect(result.stats).toEqual(computeStats(result.rows, result.hunks.length))
    // 确定性数值：2 处替换各产 1 del + 1 add，两个 hunk，一个折叠段。
    expect(result.stats).toEqual({
      addedLines: 2,
      removedLines: 2,
      modifiedPairs: 0,
      hunkCount: 2,
      totalRows: 20,
    })
    // hunk1 = rows[1,6]（del+add 双行变更簇 ±2），hunk2 = rows[11,16]，
    // 中缝 rows[7,10] 共 4 行 equal 折叠。
    expect(result.collapses).toEqual([{ beforeRow: 11, count: 4 }])
  })

  it('组合选项语义：规范化等价行 equal 且原文保留（case / 空白 / 规则三个来源各至少一行）', () => {
    const result = compareFull(LEFT, RIGHT, COMBINED, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const rows = result.rows
    const equalDiffText = rows.filter(
      (r) => r.type === 'equal' && r.left!.text !== r.right!.text,
    )
    // 五行仅「被忽略维度」不同：# 标题（空白+大小写）、build/Version/port/ttl。
    expect(equalDiffText.length).toBeGreaterThanOrEqual(5)
    const texts = equalDiffText.map((r) => [r.left!.text, r.right!.text])
    expect(texts).toContainEqual(['# Project Config', '#  project CONFIG']) // 空白 + 大小写
    expect(texts).toContainEqual(['Version: 1.2.3', 'version: 1.2.3']) // 大小写
    expect(texts).toContainEqual(['build: 2024-01-15', 'build: 2024-02-20']) // 忽略规则
    expect(texts).toContainEqual(['server.port = 8080', 'server.port = 9090'])
    // 展示文本恒为原文：del/add 只来自 mode 与 log.level 两处真实差异。
    expect(rows.filter((r) => r.type === 'del').map((r) => r.left!.text)).toEqual([
      'mode: debug',
      'log.level = info',
    ])
    expect(rows.filter((r) => r.type === 'add').map((r) => r.right!.text)).toEqual([
      'mode: release',
      'log.level = warn',
    ])
  })

  it('rowsWithPairing 后重新 stats：modifiedPairs > 0，added/removed 归零，totalRows 收缩，行号双侧单调保持', () => {
    const result = compareFull(LEFT, RIGHT, COMBINED, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const paired = rowsWithPairing(result.rows)
    // mode（2/3 token 相同）与 log.level（4/5）都达到阈值 0.5 → 两对 modify。
    const reStats = computeStats(paired, 0)
    expect(reStats.modifiedPairs).toBe(2)
    expect(reStats.modifiedPairs).toBeGreaterThan(0)
    // 配对行不再重复计入 added / removed（DiffStats 契约）。
    expect(reStats.addedLines).toBe(0)
    expect(reStats.removedLines).toBe(0)
    expect(reStats.totalRows).toBe(18) // 20 行骨架合并 2 对 → 18

    // 行号双侧单调不变量在配对后仍成立（modify.left/right 各取原 del/add 行号）。
    let lastLeft = 0
    let lastRight = 0
    for (const row of paired) {
      expect(row.left !== undefined || row.right !== undefined).toBe(true)
      if (row.left !== undefined) {
        expect(row.left.lineNo).toBeGreaterThan(lastLeft)
        lastLeft = row.left.lineNo
      }
      if (row.right !== undefined) {
        expect(row.right.lineNo).toBeGreaterThan(lastRight)
        lastRight = row.right.lineNo
      }
    }
  })

  it('配对行 spans 拼接恒等式 + 配对后重建 hunks 仍合法（modify 计入双侧、折叠语义保持）', () => {
    const result = compareFull(LEFT, RIGHT, COMBINED, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const paired = rowsWithPairing(result.rows)
    const modifies = paired.filter((r) => r.type === 'modify')
    expect(modifies).toHaveLength(2)
    for (const row of modifies) expectSpansJoinIdentity(row)
    // modify 行的词级 spans 只把真实变化定位到词。
    expect(modifies[0].left!.text).toBe('mode: debug')
    expect(modifies[0].left!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual([
      'debug',
    ])
    expect(modifies[0].right!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual([
      'release',
    ])

    // 配对后的 rows 重新过 buildHunks：modify 行同时计入 oldLines / newLines，
    // hunk 数与折叠段数不变（变更簇位置与配对前一致）。
    const rebuilt = buildHunks(paired, 2)
    expect(rebuilt.hunks).toHaveLength(2)
    expect(rebuilt.collapses).toEqual([{ beforeRow: 10, count: 4 }])
    for (const hunk of rebuilt.hunks) {
      expect(hunk.oldLines).toBe(hunk.newLines) // 本例变更全为 modify（双侧各计一次）
    }
    expect(computeStats(paired, rebuilt.hunks.length).hunkCount).toBe(2)
  })
})

/* -------------------------------------------------------------------------- */
/* 二、compareIncremental 与 compareFull：大杂烩输入深度一致                     */
/* -------------------------------------------------------------------------- */

describe('compareIncremental 与 compareFull：中文+emoji+制表符+CRLF 混合+BOM 大杂烩', () => {
  // 同一组语义行，左右两侧行尾符刻意混用（CRLF / 裸 CR / LF），左侧带 BOM。
  const lines = [
    '第一行：中文内容',
    'English line with words',
    'Mixed 中英 mixed',
    'emoji 🎉 line',
    'tab\there',
    'spaced   line',
    '尾行',
  ]
  const KITCHEN_LEFT =
    '\uFEFF' +
    [
      lines[0] + '\r\n',
      lines[1] + '\r', // 裸 CR（旧 Mac）
      lines[2] + '\n',
      lines[3] + '\r\n',
      lines[4] + '\n',
      lines[5] + '\r\n',
      lines[6],
    ].join('')
  const KITCHEN_RIGHT =
    [
      lines[0],
      lines[1] + '!',
      'Mixed 中英混合',
      'emoji 🎊🎊 line',
      lines[4],
      'spaced line',
      lines[6],
    ].join('\n') + '\n' // 右侧多一个尾部换行（ENG-010 归一化为等价噪声外，其余行为差异照常）

  it('2^3 忽略选项全组合：compareIncremental 与 compareFull 逐字段深度一致', async () => {
    for (const ignoreWhitespace of [false, true]) {
      for (const ignoreCase of [false, true]) {
        for (const ignoreEmptyLines of [false, true]) {
          const options = opts({ ignoreWhitespace, ignoreCase, ignoreEmptyLines })
          const expected = compareFull(KITCHEN_LEFT, KITCHEN_RIGHT, options, 2)
          const actual = await compareIncremental(KITCHEN_LEFT, KITCHEN_RIGHT, options, {
            scheduler: syncScheduler,
            chunkLines: 3,
            contextLines: 2,
          })
          expect(actual).toEqual(expected)
          expect(actual.ok).toBe(true)
        }
      }
    }
  })

  it('组合选项下 chunkLines = 1 / 缺省 / 超大分片三档都与 compareFull 一致', async () => {
    const options = opts({ ignoreWhitespace: true, ignoreCase: true, ignoreRules: [DIGIT_RULE] })
    const expected = compareFull(KITCHEN_LEFT, KITCHEN_RIGHT, options, 3)
    for (const chunkLines of [1, undefined, 9999]) {
      const actual = await compareIncremental(KITCHEN_LEFT, KITCHEN_RIGHT, options, {
        scheduler: syncScheduler,
        ...(chunkLines === undefined ? {} : { chunkLines }),
        contextLines: 3,
      })
      expect(actual).toEqual(expected)
    }
  })

  it('大杂烩语义 sanity：仅 BOM 差异 / 仅行尾符差异 → 全 equal 无 hunk，首行不含 BOM', () => {
    const plainLf = lines.join('\n')

    // 仅 BOM 差异：带 BOM 的混合行尾版 vs 纯 LF 版 → 切分后行内容相同，全 equal。
    const byBom = compareFull(KITCHEN_LEFT, plainLf, opts(), 3)
    expect(byBom.ok).toBe(true)
    if (!byBom.ok) return
    expect(byBom.rows.every((r) => r.type === 'equal')).toBe(true)
    expect(byBom.hunks).toEqual([])
    expect(byBom.stats.addedLines).toBe(0)
    expect(byBom.stats.removedLines).toBe(0)
    // BOM 剥除：首行 text 不含 U+FEFF，行号从 1 起。
    expect(byBom.rows[0].left!.text).toBe(lines[0])
    expect(byBom.rows[0].left!.text).not.toContain('\uFEFF')

    // 仅行尾符差异：无 BOM 混合行尾版 vs 纯 LF 版 → 同样全 equal。
    const byEol = compareFull(KITCHEN_LEFT.slice(1), plainLf, opts(), 3)
    expect(byEol.ok).toBe(true)
    if (!byEol.ok) return
    expect(byEol.rows.every((r) => r.type === 'equal')).toBe(true)
    expect(byEol.collapses).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* 三、getDiffRows 四精度 × 三选项：行号与 spans 不变量                          */
/* -------------------------------------------------------------------------- */

describe('getDiffRows 四精度 × 三选项：行号双侧单调 + spans 拼接恒等', () => {
  // 多行混合输入：大小写 / 空白 / 中文 / emoji / 制表符 / 空行差异齐备。
  const LEFT = 'Header Line\nfoo  bar\n中文 标题\nv1 🎉\nA\tB\n\nEND'
  const RIGHT = 'header line\nfoo bar\n中文 标题二\nv2 🎊\nA\tB\n \nend'
  const OPTION_BATTERY: Array<[string, DiffOptions]> = [
    ['ignoreWhitespace', opts({ ignoreWhitespace: true })],
    ['ignoreCase', opts({ ignoreCase: true })],
    ['ignoreEmptyLines', opts({ ignoreEmptyLines: true })],
  ]
  const PRECISIONS = ['smart', 'line', 'word', 'char'] as const

  /**
   * 行号双侧单调不变量：任一侧 lineNo 按行序严格递增（左右两列各自独立
   * 计数；含 ignoreEmptyLines 投影空行的单侧 equal 行）。
   */
  function expectLineNoMonotonic(rows: DiffRow[]): void {
    let lastLeft = 0
    let lastRight = 0
    for (const row of rows) {
      expect(row.left !== undefined || row.right !== undefined).toBe(true)
      if (row.left !== undefined) {
        expect(row.left.lineNo).toBeGreaterThan(lastLeft)
        lastLeft = row.left.lineNo
      }
      if (row.right !== undefined) {
        expect(row.right.lineNo).toBeGreaterThan(lastRight)
        lastRight = row.right.lineNo
      }
    }
  }

  it('12 组合（4 精度 × 3 选项）不抛错且行号双侧严格单调、每行至少一侧存在', () => {
    for (const [optionLabel, optionSet] of OPTION_BATTERY) {
      for (const precision of PRECISIONS) {
        const rows = getDiffRows(LEFT, RIGHT, precision, optionSet, createDiffSession())
        expectLineNoMonotonic(rows)
      }
      // 同一选项下四精度共享行级骨架：行数与 type 序列一致（投影不改骨架）。
      const lineRows = getDiffRows(LEFT, RIGHT, 'line', optionSet, createDiffSession())
      for (const precision of ['smart', 'word', 'char'] as const) {
        const rows = getDiffRows(LEFT, RIGHT, precision, optionSet, createDiffSession())
        expect(rows.map((r) => r.type)).toEqual(lineRows.map((r) => r.type))
      }
      void optionLabel
    }
  })

  it('12 组合中 word/char/smart 产出的行内 spans 拼接恒等于该侧原文（两侧逐行）', () => {
    for (const [, optionSet] of OPTION_BATTERY) {
      for (const precision of ['smart', 'word', 'char'] as const) {
        const rows = getDiffRows(LEFT, RIGHT, precision, optionSet, createDiffSession())
        for (const row of rows) expectSpansJoinIdentity(row)
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 四、超长行 × hunk / 折叠共存（ENG-012 × ENG-008）                             */
/* -------------------------------------------------------------------------- */

describe('超长行与 hunk/折叠共存：标记经 buildHunks 投影保持', () => {
  // 布局（30 行）：p1..p12 equal → anchor 替换 → m1..m12 equal（含超长 mid）→
  // tail anchor 替换为超长 addLong → 超长 ctx equal → q1..q3 equal。
  // contextLines = 2 时：hunk1 覆盖 [10,15]，hunk2 覆盖 [24,29]，
  // 折叠段为下标 [16,23) 共 8 行 —— 超长 mid（下标 19）落在折叠段内，
  // 超长 ctx（下标 28）与超长 addLong（下标 27）落在 hunk2 内。
  const MID = 'MID-' + 'x'.repeat(10_000) // 10004 字符 > LONG_LINE_THRESHOLD
  const CTX = 'CTX-' + 'y'.repeat(10_000)
  const ADD_LONG = 'ADD-' + 'z'.repeat(10_000)
  const L = [
    ...Array.from({ length: 12 }, (_, i) => `p${i + 1}`),
    'anchor one',
    ...Array.from({ length: 12 }, (_, i) => (i === 5 ? MID : `m${i + 1}`)),
    'tail anchor',
    CTX,
    'q1',
    'q2',
    'q3',
  ].join('\n')
  const R = [
    ...Array.from({ length: 12 }, (_, i) => `p${i + 1}`),
    'anchor one!',
    ...Array.from({ length: 12 }, (_, i) => (i === 5 ? MID : `m${i + 1}`)),
    ADD_LONG,
    CTX,
    'q1',
    'q2',
    'q3',
  ].join('\n')

  function kitchenResult() {
    const result = compareFull(L, R, opts(), 2)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('compareFull 应成功')
    return result
  }

  it('折叠区段内的超长 equal 行：longLine 标记保持、整段全 equal、不落入任何 hunk', () => {
    const { rows, hunks, collapses } = kitchenResult()
    expect(hunks).toHaveLength(2)
    expect(collapses).toEqual([{ beforeRow: 24, count: 8 }])

    const midRow = rows[19]
    expect(midRow.type).toBe('equal')
    expect(midRow.left!.text).toBe(MID)
    expect(midRow.longLine).toBe(true)

    // 折叠区段 rows[beforeRow-count, beforeRow) 引用完整保留（含超长行）。
    const collapsed = rows.slice(24 - 8, 24)
    expect(collapsed.every((r) => r.type === 'equal')).toBe(true)
    expect(collapsed.includes(midRow)).toBe(true)

    // 超长行属于「未更改且远离变更」内容：不出现在任何 hunk 切片中。
    const hunkRowRefs = new Set(hunks.flatMap((h) => h.rows))
    expect(hunkRowRefs.has(midRow)).toBe(false)
  })

  it('hunk 上下文内的超长 equal 行：hunk.rows 共享行对象引用，longLine 标记保持', () => {
    const { rows, hunks } = kitchenResult()
    const ctxRow = rows[28]
    expect(ctxRow.type).toBe('equal')
    expect(ctxRow.longLine).toBe(true)

    // buildHunks 的 hunk.rows 是 rows 的连续切片（共享行对象引用，types.ts 契约）。
    const allRows = new Set(rows)
    const ctxHunk = hunks.find((h) => h.rows.includes(ctxRow))
    expect(ctxHunk).toBeDefined()
    for (const hunk of hunks) {
      for (const row of hunk.rows) expect(allRows.has(row)).toBe(true)
    }
  })

  it('超长变更行（add）在 hunk 内标记保持；短 del 行不产生 longLine 键', () => {
    const { rows, hunks } = kitchenResult()
    const addRow = rows[27]
    expect(addRow.type).toBe('add')
    expect(addRow.right!.text).toBe(ADD_LONG)
    expect(addRow.right!.text.length).toBe(10_004)
    expect(addRow.longLine).toBe(true)
    expect(hunks[1].rows.includes(addRow)).toBe(true)

    // 配对位置的短 del 行未超阈值：按契约不产生 longLine 键。
    const delRow = rows[26]
    expect(delRow.type).toBe('del')
    expect('longLine' in delRow).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* 五、applyInlineSpans 与 rowsWithPairing：同区域 spans 恒等式（word 粒度）      */
/* -------------------------------------------------------------------------- */

describe('applyInlineSpans 与 rowsWithPairing 对同区域的 spans 恒等式（word）', () => {
  it('拉丁 3×3 错位区域：两路径各自拼接恒等，共同配对行 spans 与 computeSpans 逐字节一致', () => {
    // 位置配对（ENG-003）会凑出 (gamma 3, delta 4) 这对不相似行，
    // 相似度配对（ENG-005）只保留 (alpha 1, alpha 2) 与 (beta 2, beta 3)。
    const rows = [
      { type: 'equal', left: { lineNo: 1, text: 'x' }, right: { lineNo: 1, text: 'x' } },
      { type: 'del', left: { lineNo: 2, text: 'alpha 1' } },
      { type: 'del', left: { lineNo: 3, text: 'beta 2' } },
      { type: 'del', left: { lineNo: 4, text: 'gamma 3' } },
      { type: 'add', right: { lineNo: 2, text: 'alpha 2' } },
      { type: 'add', right: { lineNo: 3, text: 'beta 3' } },
      { type: 'add', right: { lineNo: 4, text: 'delta 4' } },
      { type: 'equal', left: { lineNo: 5, text: 'y' }, right: { lineNo: 5, text: 'y' } },
    ] as DiffRow[]

    const inline = applyInlineSpans(rows, 'word')
    const paired = rowsWithPairing(rows)

    // 恒等式一：两路径产出的每一行（含位置配对凑出的低相似对）spans 拼接都还原原文。
    for (const row of [...inline, ...paired]) expectSpansJoinIdentity(row)

    // 恒等式二：两路径共同覆盖的行对，spans 与 computeSpans（word）逐字节一致 ——
    // 同一 (delText, addText) 输入下，ENG-003 与 ENG-005 是同一计算的两个出口。
    for (const [delText, addText] of [
      ['alpha 1', 'alpha 2'],
      ['beta 2', 'beta 3'],
    ] as const) {
      const spans = computeSpans(delText, addText, 'word')
      const inlinePair = inline.filter(
        (r) => r.left?.text === delText || r.right?.text === addText,
      )
      expect(inlinePair).toHaveLength(2) // del 行 + 配位 add 行
      expect(inlinePair.find((r) => r.left?.text === delText)!.left!.words).toEqual(spans.left)
      expect(inlinePair.find((r) => r.right?.text === addText)!.right!.words).toEqual(spans.right)
      const modify = paired.find((r) => r.type === 'modify' && r.left?.text === delText)
      expect(modify).toBeDefined()
      expect(modify!.left!.words).toEqual(spans.left)
      expect(modify!.right!.words).toEqual(spans.right)
    }

    // 相似度配对不产 modify 的 (gamma 3, delta 4)：paired 中保持 del/add 原样。
    expect(paired.some((r) => r.type === 'del' && r.left?.text === 'gamma 3')).toBe(true)
    expect(paired.some((r) => r.type === 'add' && r.right?.text === 'delta 4')).toBe(true)
  })

  it('CJK 2×2 区域：modify 行 spans 与 applyInlineSpans 行 spans 深度一致（同一行对）', () => {
    const rows = [
      { type: 'equal', left: { lineNo: 1, text: '标题' }, right: { lineNo: 1, text: '标题' } },
      { type: 'del', left: { lineNo: 2, text: '你好世界' } },
      { type: 'del', left: { lineNo: 3, text: '版本甲' } },
      { type: 'add', right: { lineNo: 2, text: '你好地球' } },
      { type: 'add', right: { lineNo: 3, text: '版本乙' } },
      { type: 'equal', left: { lineNo: 4, text: '尾' }, right: { lineNo: 4, text: '尾' } },
    ] as DiffRow[]

    const inline = applyInlineSpans(rows, 'word')
    const paired = rowsWithPairing(rows)

    // CJK 逐字 token 下两对都达阈值（0.5 与 0.667）→ 全部配为 modify。
    expect(paired.map((r) => r.type)).toEqual(['equal', 'modify', 'modify', 'equal'])
    for (const row of [...inline, ...paired]) expectSpansJoinIdentity(row)

    // 同一行对（你好世界 → 你好地球）两路径 spans 完全一致：只有变化的字标红。
    const spans = computeSpans('你好世界', '你好地球', 'word')
    const inlineDel = inline.find((r) => r.left?.text === '你好世界')!
    const modify = paired.find((r) => r.type === 'modify' && r.left?.text === '你好世界')!
    expect(inlineDel.left!.words).toEqual(spans.left)
    expect(modify.left!.words).toEqual(spans.left)
    expect(modify.right!.words).toEqual(spans.right)
    // 相邻同类 token 合并为一个 span：变化区「世界 / 地球」各成一段。
    expect(modify.left!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual(['世界'])
    expect(modify.right!.words!.filter((s) => s.changed).map((s) => s.text)).toEqual(['地球'])
  })
})
