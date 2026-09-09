/**
 * 大文本防护与分块计算单元测试（roadmap 任务 ENG-011）。
 *
 * 覆盖 `src/core/guards.ts` 与 `src/core/diff.ts` 的 ENG-011 出口：
 * - `DIFF_LIMITS` / `checkInputLimits` / `checkPairLimits`：字节（中文按
 *   UTF-8 3 字节/字）与行数两维超限、恰好等于阈值不超限（边界含）、
 *   自定义阈值、双侧先左后右；
 * - `compareFull` 大文本防护接线：超限 → ok:false too-large 且不进入规则
 *   编译（非法规则 + 超限输入仍返回 too-large，证明限制检查先行）；
 * - `compareIncremental` 与 `compareFull` 深度一致：固定用例（相同 / 纯增删 /
 *   交错 / 带选项 2^3 组合 / 带规则 / 非法规则 / 上下文行数 / 空输入 /
 *   CRLF）+ 裁剪路径（长公共前缀 / 后缀 / 已知 jsdiff 对齐歧义输入）+
 *   种子化确定性模糊测试；
 * - `compareIncremental` 进度上报：三阶段顺序、done 单调、最终 done=total、
 *   分片让出次数；超限短路无进度事件；
 * - `resolveScheduler` 调度器特性检测：注入优先、requestIdleCallback
 *   存在 / 不存在两分支（mock 全局验证）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  compareFull,
  compareIncremental,
  DEFAULT_CHUNK_LINES,
  resolveScheduler,
} from '../../src/core/diff'
import { DIFF_LIMITS, checkInputLimits, checkPairLimits } from '../../src/core/guards'
import { analyzeInputPair } from '../../src/core/normalize'
import type { DiffOptions, DiffResult, DiffResultOk } from '../../src/core/types'

/* -------------------------------------------------------------------------- */
/* 测试辅助                                                                    */
/* -------------------------------------------------------------------------- */

/** 三开关全关 + 无规则的基线选项（与引擎 DEFAULT_OPTIONS 同构）。 */
const baseOptions: DiffOptions = {
  ignoreWhitespace: false,
  ignoreCase: false,
  ignoreEmptyLines: false,
  ignoreRules: [],
}

/** 基线选项的部分覆盖（忽略规则用例等）。 */
function withOptions(overrides: Partial<DiffOptions>): DiffOptions {
  return { ...baseOptions, ...overrides }
}

/** 同步调度器：立即执行回调，让 compareIncremental 在微任务序列内完成。 */
const syncScheduler = (cb: () => void) => {
  cb()
}

/** 深度一致性断言：compareIncremental（chunkLines=1 最慢分片路径）与 compareFull 逐字段相等。 */
async function expectParityWithCompareFull(
  left: string,
  right: string,
  options: DiffOptions = baseOptions,
  contextLines = 3,
): Promise<void> {
  const expected = compareFull(left, right, options, contextLines)
  const actual = await compareIncremental(left, right, options, {
    scheduler: syncScheduler,
    chunkLines: 1,
    contextLines,
  })
  expect(actual).toEqual(expected)
}

/** 把结果收窄为成功分支（失败时让断言失败并带出错误信息）。 */
function expectOk(result: DiffResult): DiffResultOk {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`期望成功结果，实际错误：${JSON.stringify(result.error)}`)
  return result
}

/** 收集 onProgress 事件（含 phase / done / total）。 */
function captureProgress() {
  const events: Array<{ phase: 'diff' | 'rows' | 'hunks'; done: number; total: number }> = []
  return {
    events,
    onProgress: (p: { phase: 'diff' | 'rows' | 'hunks'; done: number; total: number }) => {
      events.push({ ...p })
    },
  }
}

/** Mulberry32 确定性伪随机数发生器（种子固定 → 模糊用例可复现）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 构造 n 行 `prefix-i` 文本。 */
function lines(prefix: string, n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i += 1) out.push(`${prefix}-${i}`)
  return out.join('\n')
}

/* -------------------------------------------------------------------------- */
/* DIFF_LIMITS 常量                                                            */
/* -------------------------------------------------------------------------- */

describe('DIFF_LIMITS', () => {
  it('默认阈值为 5MB（5 * 1024 * 1024 字节）/ 10 万行', () => {
    expect(DIFF_LIMITS.maxBytes).toBe(5 * 1024 * 1024)
    expect(DIFF_LIMITS.maxLines).toBe(100_000)
  })
})

/* -------------------------------------------------------------------------- */
/* checkInputLimits                                                            */
/* -------------------------------------------------------------------------- */

describe('checkInputLimits', () => {
  it('正常小文本 → null', () => {
    expect(checkInputLimits('a\nb\nc')).toBeNull()
  })

  it('空文本 → null（0 字节 0 行）', () => {
    expect(checkInputLimits('')).toBeNull()
  })

  it('BOM-only 文本 → null（3 字节、剥 BOM 后 0 行）', () => {
    expect(checkInputLimits('\uFEFF')).toBeNull()
  })

  it('字节超限（中文 3 字节/字）：180 万汉字 = 5.4MB > 5MB → too-large', () => {
    const text = '中'.repeat(1_800_000)
    const error = checkInputLimits(text)
    expect(error).not.toBeNull()
    if (error === null || error.kind !== 'too-large') return
    expect(error).toEqual({
      kind: 'too-large',
      limitBytes: 5 * 1024 * 1024,
      limitLines: 100_000,
      actualBytes: 5_400_000,
      actualLines: 1,
    })
  })

  it('行数超限：100001 行 → too-large（字节数未超限也报）', () => {
    const error = checkInputLimits('a\n'.repeat(100_001))
    expect(error).not.toBeNull()
    if (error === null || error.kind !== 'too-large') return
    expect(error.limitBytes).toBe(5 * 1024 * 1024)
    expect(error.limitLines).toBe(100_000)
    expect(error.actualLines).toBe(100_001)
    expect(error.actualBytes).toBe(200_002)
  })

  it('恰好等于字节阈值（5MB 单行）不超限 → null（边界含）', () => {
    expect(checkInputLimits('a'.repeat(5 * 1024 * 1024))).toBeNull()
  })

  it('恰好等于行数阈值（恰好 10 万行）不超限 → null（边界含）', () => {
    expect(checkInputLimits('a\n'.repeat(100_000))).toBeNull()
  })

  it('两个维度同时超限 → 错误对象同时携带两维 actual 值', () => {
    const error = checkInputLimits(('中'.repeat(60) + '\n').repeat(100_001))
    expect(error).not.toBeNull()
    if (error === null || error.kind !== 'too-large') return
    expect(error.actualLines).toBe(100_001)
    expect(error.actualBytes).toBe(100_001 * (60 * 3 + 1))
    expect(error.actualBytes).toBeGreaterThan(DIFF_LIMITS.maxBytes)
  })

  it('自定义 limits：小阈值同样生效，limit 字段回填自定义值', () => {
    const error = checkInputLimits('a\nb\nc', { maxBytes: 1024, maxLines: 2 })
    expect(error).not.toBeNull()
    if (error === null || error.kind !== 'too-large') return
    expect(error.limitBytes).toBe(1024)
    expect(error.limitLines).toBe(2)
    expect(error.actualLines).toBe(3)
    expect(error.actualBytes).toBe(5)
  })
})

/* -------------------------------------------------------------------------- */
/* checkPairLimits                                                             */
/* -------------------------------------------------------------------------- */

describe('checkPairLimits', () => {
  it('两侧都正常 → null', () => {
    expect(checkPairLimits('a\nb', 'b\nc')).toBeNull()
  })

  it('仅左侧超限 → 返回错误，actualBytes 为左侧字节数', () => {
    const left = '中'.repeat(1_800_000)
    const error = checkPairLimits(left, 'small')
    expect(error).not.toBeNull()
    if (error === null || error.kind !== 'too-large') return
    expect(error.actualBytes).toBe(5_400_000)
    expect(error.actualLines).toBe(1)
  })

  it('仅右侧超限 → 返回错误，actualBytes 为右侧字节数', () => {
    const right = '中'.repeat(1_800_000)
    const error = checkPairLimits('small', right)
    expect(error).not.toBeNull()
    if (error === null || error.kind !== 'too-large') return
    expect(error.actualBytes).toBe(5_400_000)
  })

  it('两侧都超限 → 先左后右，返回左侧命中（fail-fast）', () => {
    const error = checkPairLimits('中'.repeat(1_800_000), '中'.repeat(2_000_000))
    expect(error).not.toBeNull()
    if (error === null || error.kind !== 'too-large') return
    expect(error.actualBytes).toBe(5_400_000)
  })

  it('DiffError 无侧别字段：调用方可用 analyzeInputPair 比对 actual 定位侧别', () => {
    const left = 'small'
    const right = '中'.repeat(1_800_000)
    const error = checkPairLimits(left, right)
    expect(error).not.toBeNull()
    if (error === null || error.kind !== 'too-large') return
    expect(error.actualBytes).toBe(5_400_000)
    // 侧别定位约定（./guards.ts 模块头「侧别定位说明」）：对两侧各做一次
    // 元数据分析，比对 actualBytes / actualLines 落在哪一侧。
    const pair = analyzeInputPair(left, right)
    expect(pair.left.byteLength).toBeLessThan(DIFF_LIMITS.maxBytes)
    expect(pair.right.byteLength).toBe(error.actualBytes)
  })
})

/* -------------------------------------------------------------------------- */
/* compareFull 大文本防护接线                                                   */
/* -------------------------------------------------------------------------- */

describe('compareFull 大文本防护（ENG-011 接线）', () => {
  it('字节超限 → ok:false too-large，limit / actual 字段正确', () => {
    const big = '中'.repeat(1_800_000)
    const result = compareFull(big, big, baseOptions)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      kind: 'too-large',
      limitBytes: 5 * 1024 * 1024,
      limitLines: 100_000,
      actualBytes: 5_400_000,
      actualLines: 1,
    })
  })

  it('行数超限 → too-large，actualLines 为实际行数', () => {
    const result = compareFull('a\n'.repeat(100_001), 'a', baseOptions)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('too-large')
    if (result.error.kind === 'too-large') {
      expect(result.error.actualLines).toBe(100_001)
      expect(result.error.limitLines).toBe(100_000)
    }
  })

  it('超限 + 非法规则 → 仍返回 too-large（限制检查先行于规则编译）', () => {
    const big = '中'.repeat(1_800_000)
    const options = withOptions({ ignoreRules: [{ id: 'bad', pattern: '(', enabled: true }] })
    const result = compareFull(big, big, options)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // 若限制检查不在规则编译之前，这里会是 invalid-regex。
    expect(result.error.kind).toBe('too-large')
  })

  it('未超限 + 非法规则 → 既有 invalid-regex 通道不受影响', () => {
    const options = withOptions({ ignoreRules: [{ id: 'bad', pattern: '(', enabled: true }] })
    const result = compareFull('a\nb', 'a\nc', options)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('invalid-regex')
  })

  it('恰好等于字节阈值（5MB 单行全等输入）不超限 → 正常产出 1 行 equal', () => {
    const text = 'a'.repeat(DIFF_LIMITS.maxBytes)
    const result = compareFull(text, text, baseOptions)
    const ok = expectOk(result)
    expect(ok.rows.length).toBe(1)
    expect(ok.rows[0].type).toBe('equal')
    expect(ok.stats.totalRows).toBe(1)
  })

  it('恰好等于行数阈值（10 万行全等输入）不超限 → 正常产出全部 equal 行', () => {
    const text = 'line\n'.repeat(DIFF_LIMITS.maxLines)
    const result = compareFull(text, text, baseOptions)
    const ok = expectOk(result)
    expect(ok.stats.totalRows).toBe(DIFF_LIMITS.maxLines)
    expect(ok.stats.hunkCount).toBe(0)
  })

  it('仅一侧超限（左 / 右）→ actual 字段对应超限侧', () => {
    const big = '中'.repeat(1_800_000)
    const leftOver = compareFull(big, 'small', baseOptions)
    expect(leftOver.ok).toBe(false)
    if (!leftOver.ok && leftOver.error.kind === 'too-large') {
      expect(leftOver.error.actualBytes).toBe(5_400_000)
    }
    const rightOver = compareFull('small', big, baseOptions)
    expect(rightOver.ok).toBe(false)
    if (!rightOver.ok && rightOver.error.kind === 'too-large') {
      expect(rightOver.error.actualBytes).toBe(5_400_000)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* compareIncremental 与 compareFull 深度一致                                   */
/* -------------------------------------------------------------------------- */

describe('compareIncremental 与 compareFull 深度一致', () => {
  it('相同输入 → 全 equal，深度一致', async () => {
    await expectParityWithCompareFull('a\nb\nc', 'a\nb\nc')
  })

  it('纯增（尾部 / 头部 / 中间插入）→ 深度一致', async () => {
    await expectParityWithCompareFull('a\nb', 'a\nb\nc')
    await expectParityWithCompareFull('a\nb', 'z\na\nb')
    await expectParityWithCompareFull('a\nb\nd', 'a\nb\nc\nd')
  })

  it('纯删（尾部 / 头部 / 中间删除）→ 深度一致', async () => {
    await expectParityWithCompareFull('a\nb\nc', 'a\nb')
    await expectParityWithCompareFull('z\na\nb', 'a\nb')
    await expectParityWithCompareFull('a\nb\nc\nd', 'a\nb\nd')
  })

  it('替换与多块增删交错 → 深度一致', async () => {
    await expectParityWithCompareFull('a\nb\nc', 'a\nx\nc')
    await expectParityWithCompareFull('a\nb\nc\nd\ne\nf', 'a\nX\nY\nd\nZ\nf')
    await expectParityWithCompareFull('1\n2\n3\n4\n5', '2\n3\n4\n5\n6')
  })

  it('长公共前缀 + 中间差异（前缀裁剪路径）→ 深度一致且行号体系不变', async () => {
    const prefix = lines('common', 2000)
    const suffix = lines('tail', 2000)
    const left = `${prefix}\nold-1\nold-2\n${suffix}`
    const right = `${prefix}\nnew-1\nnew-2\nnew-3\n${suffix}`
    await expectParityWithCompareFull(left, right)

    // 裁剪只动「进 differ 的行集」，行号仍是全量 1-based 行号体系。
    const ok = expectOk(
      await compareIncremental(left, right, baseOptions, { scheduler: syncScheduler }),
    )
    expect(ok.rows[0]).toEqual({
      type: 'equal',
      left: { lineNo: 1, text: 'common-0' },
      right: { lineNo: 1, text: 'common-0' },
    })
    expect(ok.rows[ok.rows.length - 1]).toEqual({
      type: 'equal',
      left: { lineNo: 4002, text: 'tail-1999' },
      right: { lineNo: 4003, text: 'tail-1999' },
    })
  })

  it('长公共后缀（前缀完全不同）→ 深度一致', async () => {
    const suffix = lines('tail', 1500)
    await expectParityWithCompareFull(`only-left-a\nonly-left-b\n${suffix}`, `only-right\n${suffix}`)
  })

  it('完全相同的长输入（前缀 + 后缀覆盖全部行 → 全 equal 组装）', async () => {
    const text = lines('same', 1000)
    await expectParityWithCompareFull(text, text)
    const ok = expectOk(
      await compareIncremental(text, text, baseOptions, { scheduler: syncScheduler }),
    )
    expect(ok.stats.addedLines).toBe(0)
    expect(ok.stats.removedLines).toBe(0)
    expect(ok.stats.hunkCount).toBe(0)
    expect(ok.rows.every((row) => row.type === 'equal')).toBe(true)
  })

  it('一侧为另一侧子集（裁剪后中间单侧为空 → 纯增 / 纯删合成）', async () => {
    const base = lines('same', 800)
    await expectParityWithCompareFull(base, `${base}\nextra-1\nextra-2`)
    await expectParityWithCompareFull(`${base}\nextra-1\nextra-2`, base)
  })

  it('已知 jsdiff 对齐歧义输入（后缀行与中间行等价，后缀裁剪被安全条件放弃）仍一致', async () => {
    // 以下用例在「无脑裁后缀」时会与全量 diff 的行序列不同（jsdiff 可能把
    // 后缀行的等价配对放在对齐序列中部）；suffixTrimSafe 放弃后缀裁剪后，
    // compareIncremental 必须仍与 compareFull 逐字段一致。
    await expectParityWithCompareFull('\n\n\n', 'b\nc\n\n') // ['','',''] vs ['b','c','']
    await expectParityWithCompareFull('a\nb', 'b\na\na\n\nb\nb')
    await expectParityWithCompareFull('a\nc\nc\nc', 'b\nc')
    await expectParityWithCompareFull('c\nb', 'a\na\n\nb\nb')
    await expectParityWithCompareFull('a\nb\na', 'a') // 前缀裁剪 + 中间单侧为空
    await expectParityWithCompareFull('b\na', 'a') // 后缀与中间交叉
  })

  it('忽略选项 2^3 全组合（含空行 / 空白 / 大小写交叠场景）→ 深度一致', async () => {
    const left = 'Hello World\nfoo bar\n\n  spaced  \nlast'
    const right = 'hello world\nfoo  bar\n\n\nspaced\nLAST\nextra'
    for (const ignoreWhitespace of [false, true]) {
      for (const ignoreCase of [false, true]) {
        for (const ignoreEmptyLines of [false, true]) {
          await expectParityWithCompareFull(
            left,
            right,
            withOptions({ ignoreWhitespace, ignoreCase, ignoreEmptyLines }),
          )
        }
      }
    }
  })

  it('带合法忽略规则 → 深度一致（规则在 token 化前对行做归一化替换）', async () => {
    const options = withOptions({
      ignoreRules: [{ id: 'digits', pattern: '\\d+', flags: 'g', enabled: true }],
    })
    await expectParityWithCompareFull('v1\nkeep\nv22', 'v2\nkeep\nv99', options)
    await expectParityWithCompareFull('a1\nb2\nc3', 'a9\nb2\nc7', options)
  })

  it('非法规则 → 与 compareFull 一致返回 invalid-regex（不抛异常）', async () => {
    const options = withOptions({ ignoreRules: [{ id: 'bad', pattern: '(', enabled: true }] })
    const expected = compareFull('a\nb', 'a\nc', options)
    const actual = await compareIncremental('a\nb', 'a\nc', options, { scheduler: syncScheduler })
    expect(actual).toEqual(expected)
    expect(actual.ok).toBe(false)
    if (!actual.ok) expect(actual.error.kind).toBe('invalid-regex')
  })

  it('上下文行数 0 / 5 → hunks / collapses 与 compareFull 一致', async () => {
    const left = 'a\nb\nc\nd\ne\nf\ng'
    const right = 'a\nX\nc\nd\ne\nY\ng'
    await expectParityWithCompareFull(left, right, baseOptions, 0)
    await expectParityWithCompareFull(left, right, baseOptions, 5)
  })

  it("空输入边界（'' vs '' / 空 vs 非空 / CRLF 与尾部换行）→ 深度一致", async () => {
    await expectParityWithCompareFull('', '')
    await expectParityWithCompareFull('', 'a\nb')
    await expectParityWithCompareFull('a\nb', '')
    await expectParityWithCompareFull('a\r\nb\r\nc\n', 'a\nb\nc')
    await expectParityWithCompareFull('\n\n', '\n') // 空行数量差异
  })

  it('缺省 chunkLines（DEFAULT_CHUNK_LINES）与 chunkLines=1 结果一致', async () => {
    const left = 'a\nb\nc\nd\ne\nf\ng\nh'
    const right = 'a\nX\nc\nd\ne\nY\ng\nZ'
    const byDefault = await compareIncremental(left, right, baseOptions, {
      scheduler: syncScheduler,
    })
    const byOne = await compareIncremental(left, right, baseOptions, {
      scheduler: syncScheduler,
      chunkLines: 1,
    })
    expect(byDefault).toEqual(byOne)
    expect(byDefault).toEqual(compareFull(left, right, baseOptions))
  })

  it('确定性模糊：随机小输入（含空行）× 随机选项 × 随机上下文，240 轮逐字段一致', async () => {
    const rand = mulberry32(0x011)
    const alphabet = ['a', 'b', 'c', '']
    const mkText = () =>
      Array.from({ length: Math.floor(rand() * 7) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('\n')
    for (let i = 0; i < 240; i += 1) {
      const left = mkText()
      const right = mkText()
      const options = withOptions({
        ignoreWhitespace: rand() < 0.5,
        ignoreCase: rand() < 0.5,
        ignoreEmptyLines: rand() < 0.5,
      })
      const contextLines = Math.floor(rand() * 5)
      const expected = compareFull(left, right, options, contextLines)
      const actual = await compareIncremental(left, right, options, {
        scheduler: syncScheduler,
        chunkLines: 1,
        contextLines,
      })
      expect(actual).toEqual(expected)
    }
  })

  it('确定性模糊（带规则 + 大小写敏感字符集）：120 轮逐字段一致', async () => {
    const rand = mulberry32(0x022)
    const alphabet = ['v1', 'v2', 'A', 'b', '']
    const options = withOptions({
      ignoreRules: [{ id: 'ver', pattern: 'v\\d+', flags: 'g', enabled: true }],
      ignoreWhitespace: rand() < 0.5,
    })
    const mkText = () =>
      Array.from({ length: Math.floor(rand() * 6) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('\n')
    for (let i = 0; i < 120; i += 1) {
      const left = mkText()
      const right = mkText()
      const expected = compareFull(left, right, options)
      const actual = await compareIncremental(left, right, options, {
        scheduler: syncScheduler,
        chunkLines: 1,
      })
      expect(actual).toEqual(expected)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* compareIncremental 进度上报与分片让出                                        */
/* -------------------------------------------------------------------------- */

describe('compareIncremental 进度上报（onProgress）', () => {
  it('三阶段顺序 diff → rows → hunks，done 单调不减，每阶段最终 done === total', async () => {
    const { events, onProgress } = captureProgress()
    const left = lines('l', 40)
    const right = lines('l', 20) + '\nr-mid\n' + lines('l', 19)
    const result = await compareIncremental(left, right, baseOptions, {
      scheduler: syncScheduler,
      chunkLines: 7,
      onProgress,
    })
    expectOk(result)

    expect(events.length).toBeGreaterThan(0)
    expect(events[0].phase).toBe('diff')
    expect(events[events.length - 1].phase).toBe('hunks')
    expect(events.map((e) => e.phase)).toContain('rows')

    // 同阶段内 done 单调不减；切换阶段时重新从起点开始。
    let lastPhase = ''
    let lastDone = -1
    for (const event of events) {
      if (event.phase !== lastPhase) {
        lastPhase = event.phase
        lastDone = -1
      }
      expect(event.done).toBeGreaterThanOrEqual(lastDone)
      expect(event.total).toBeGreaterThanOrEqual(event.done)
      lastDone = event.done
    }
    // 每阶段最终事件 done === total。
    for (const phase of ['diff', 'rows', 'hunks'] as const) {
      const phaseEvents = events.filter((e) => e.phase === phase)
      expect(phaseEvents.length).toBeGreaterThan(0)
      const finalEvent = phaseEvents[phaseEvents.length - 1]
      expect(finalEvent.done).toBe(finalEvent.total)
    }
    // rows 阶段 total（按行）=== 结果行数。
    const rowsPhase = events.filter((e) => e.phase === 'rows')
    expect(rowsPhase[0].total).toBe(expectOk(result).rows.length)
  })

  it('chunkLines 小于总行数时多次让出（注入 scheduler 被多次调用）', async () => {
    let yields = 0
    const result = await compareIncremental('a\nb\nc\nd\ne', 'a\nX\nc\nd\nY', baseOptions, {
      scheduler: (cb) => {
        yields += 1
        cb()
      },
      chunkLines: 2,
    })
    expectOk(result)
    // 入口 + diff 起点/终点之间 + rows 分片（5 行 / 2 = 2 次片间让出）+ hunks。
    expect(yields).toBeGreaterThanOrEqual(3)
  })

  it('超限输入 → too-large 短路返回，不产生任何进度事件', async () => {
    const { events, onProgress } = captureProgress()
    const big = '中'.repeat(1_800_000)
    const result = await compareIncremental(big, big, baseOptions, {
      scheduler: syncScheduler,
      onProgress,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('too-large')
    expect(events).toEqual([])
  })

  it('空输入：三阶段各报一次 0 行事件，结果为空且统计全 0', async () => {
    const { events, onProgress } = captureProgress()
    const result = await compareIncremental('', '', baseOptions, {
      scheduler: syncScheduler,
      onProgress,
    })
    const ok = expectOk(result)
    expect(ok.rows).toEqual([])
    expect(ok.stats.totalRows).toBe(0)
    expect(events.map((e) => e.phase)).toEqual(['diff', 'rows', 'hunks'])
    for (const event of events) expect(event.total).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* compareIncremental 边界与错误通道                                            */
/* -------------------------------------------------------------------------- */

describe('compareIncremental 边界与错误通道', () => {
  it('字节超限 → too-large（不抛、不做任何 diff 计算）', async () => {
    const big = '中'.repeat(1_800_000)
    const result = await compareIncremental(big, big, baseOptions, { scheduler: syncScheduler })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('too-large')
      if (result.error.kind === 'too-large') {
        expect(result.error.actualBytes).toBe(5_400_000)
        expect(result.error.limitBytes).toBe(DIFF_LIMITS.maxBytes)
      }
    }
  })

  it('行数超限 → too-large', async () => {
    const result = await compareIncremental('a\n'.repeat(100_001), 'a', baseOptions, {
      scheduler: syncScheduler,
    })
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.kind === 'too-large') {
      expect(result.error.actualLines).toBe(100_001)
    }
  })

  it('非 string 输入 → 防御式 internal 错误（不抛异常）', async () => {
    const bad = await compareIncremental(undefined as unknown as string, 'a')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error.kind).toBe('internal')
      expect(bad.error.message).toContain('left: undefined')
    }
  })

  it('缺省 options / 缺省 opts（走默认调度器 setTimeout 分支）可正常完成', async () => {
    // Node 测试环境无 requestIdleCallback → resolveScheduler 走 setTimeout
    // 兜底分支；不注入 scheduler 时整条链路经真实宏任务让出后完成。
    const result = await compareIncremental('a\nb\nc', 'a\nX\nc')
    const ok = expectOk(result)
    expect(ok.stats.addedLines).toBe(1)
    expect(ok.stats.removedLines).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/* resolveScheduler 调度器特性检测                                              */
/* -------------------------------------------------------------------------- */

/** requestIdleCallback 的全局 mock 句柄（beforeEach 式的手动安装 / 清理）。 */
interface RicGlobal {
  requestIdleCallback?: (cb: () => void) => number
}
const ricGlobal = globalThis as unknown as RicGlobal

afterEach(() => {
  // 清理 mock，避免影响其他用例的分支选择。
  delete ricGlobal.requestIdleCallback
})

describe('resolveScheduler 调度器特性检测', () => {
  it('注入优先：传入了 injected 时原样返回同一函数', () => {
    const injected = (cb: () => void) => {
      cb()
    }
    expect(resolveScheduler(injected)).toBe(injected)
  })

  it('全局存在 requestIdleCallback → 走空闲回调分支（cb 经其执行）', async () => {
    const ricCallbacks: Array<() => void> = []
    ricGlobal.requestIdleCallback = (cb: () => void) => {
      ricCallbacks.push(cb)
      cb()
    }
    const scheduler = resolveScheduler()
    let ran = false
    await scheduler(() => {
      ran = true
    })
    expect(ricCallbacks.length).toBe(1)
    expect(ran).toBe(true)
  })

  it('全局不存在 requestIdleCallback → 回退 setTimeout 分支（异步执行）', async () => {
    delete ricGlobal.requestIdleCallback
    const scheduler = resolveScheduler()
    let ran = false
    scheduler(() => {
      ran = true
    })
    expect(ran).toBe(false) // setTimeout 尚未触发
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ran).toBe(true)
  })
})
