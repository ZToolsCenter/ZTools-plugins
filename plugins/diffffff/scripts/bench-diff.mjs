#!/usr/bin/env node
/**
 * ============================================================================
 * REL-002 性能基准（A 子项：10 万行对比 ≤2s）—— 真实可运行的引擎基准脚本
 * ============================================================================
 *
 * 运行命令：
 *   node scripts/bench-diff.mjs
 *   node --expose-gc scripts/bench-diff.mjs   （可选：每轮之间强制 GC，内存数字更准）
 *
 * 测量对象（引擎真实 UI 主路径，src/core/diff.ts）：
 * - compareFull：UI 唯一入口（stores/diff.ts run() 调用），同步全量计算；
 * - compareIncremental：ENG-011 分片异步入口（注入同步调度器 → 纯计算成本，
 *   无让出等待），作为参考数字。
 *
 * 场景（输入全部由脚本内确定性 PRNG 构造，无外部 fixture，可复现）：
 * - S1 散布修改：10 万行代码风格文本，每 20 行改 1 行（5000 处替换），
 *   同时验证「恰好 10 万行在上限内可通过 guards」（DIFF_LIMITS.maxLines =
 *   100_000，严格大于才超限）；
 * - S2 大块重排：10 万行文本，中段删除 8000 行连续块 + 另一处插入 10000 行
 *   连续新块（大块增删的 Myers 最坏情形代表）；
 * - S3 5MB 上限附近：约 4.7MB 双侧长行文本（40k 行 × ~118 字符，每 25 行改
 *   1 行），验证接近 maxBytes=5MB 时的吞吐；附 S3b 单侧 5MB vs 小文本
 *   （纯删除块）验证单侧大文本的线性路径。
 *
 * 输出：每组场景的输入体量（字节数/行数 vs 上限）、每次迭代耗时、中位数、
 * 堆内存增量（process.memoryUsage），全部为实跑数字。
 *
 * 实现说明（TS 导入）：项目为 "type": "module" 的纯 ESM，引擎源码是
 * TypeScript 且相对导入不带扩展名（`./hunks`）。Node ≥ 22.18 默认启用
 * type stripping（可直接执行 .ts），但 ESM 解析器不做扩展名补全 —— 本脚本
 * 注册一个同步 resolve 钩子（node:module registerHooks，≥22.15），对解析
 * 失败的无扩展名相对导入补 `.ts` 后缀重试。因此无需 tsx / ts-node / vitest，
 * 纯 node 即可跑（Node < 22.15 会给出明确报错）。
 * ============================================================================
 */
import { registerHooks } from 'node:module'

if (typeof registerHooks !== 'function') {
  console.error(`[bench-diff] 需要 Node >= 22.15（node:module registerHooks），当前 ${process.version}。`)
  process.exit(1)
}

/**
 * 同步 resolve 钩子：先走默认解析；无扩展名相对导入（引擎内部 ./hunks 等）
 * 在 ESM 下会失败，补 `.ts` 后缀重试一次。已带 .js/.ts/.mjs/.cjs 的导入不动。
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const looksRelative = specifier.startsWith('./') || specifier.startsWith('../')
      const hasModuleExt = /\.[cm]?[jt]s$/.test(specifier)
      if (looksRelative && !hasModuleExt) {
        return nextResolve(`${specifier}.ts`, context)
      }
      throw error
    }
  },
})

/* -------------------------------------------------------------------------- */
/* 引擎导入（type stripping：Node ≥ 22.18 默认开启）                              */
/* -------------------------------------------------------------------------- */

let diffModule
try {
  diffModule = await import('../src/core/diff.ts')
} catch (error) {
  console.error('[bench-diff] 导入引擎 TS 源码失败：', error?.message ?? error)
  console.error('若为语法/类型剥离问题，请使用 Node >= 22.18（默认 type stripping）')
  console.error('或显式运行：node --experimental-strip-types scripts/bench-diff.mjs')
  process.exit(1)
}
const { compareFull, compareIncremental } = diffModule
const guardsModule = await import('../src/core/guards.ts')
const { checkPairLimits, DIFF_LIMITS } = guardsModule
const optionsModule = await import('../src/core/options.ts')
const { normalizeForCompare, DEFAULT_OPTIONS } = optionsModule
const { diffArrays } = await import('diff')

/* -------------------------------------------------------------------------- */
/* 确定性输入构造                                                               */
/* -------------------------------------------------------------------------- */

/** mulberry32 PRNG（确定性，种子固定 → 输入可复现）。 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** S1：10 万行代码风格文本（每行 30~34 字符，总量约 3.4MB，确保低于 5MB 上限）。 */
function buildScatteredLines(lineCount) {
  const rnd = mulberry32(20260830)
  const lines = new Array(lineCount)
  for (let i = 0; i < lineCount; i += 1) {
    const value = Math.floor(rnd() * 1_000_000)
    lines[i] = `let v${i} = ${value}; // item ${i} init`
  }
  return lines
}

/** S1 的右侧：每 20 行改 1 行（i % 20 === 7），行数不变。 */
function patchEveryNth(lines, step, offset) {
  const patched = lines.slice()
  let changed = 0
  for (let i = offset; i < lines.length; i += step) {
    patched[i] = `${lines[i]} patched@${i}`
    changed += 1
  }
  return { lines: patched, changed }
}

/** S2：大块重排（删 [40000,48000) 块，另处插入 1 万行新块）。基准行数取 98000，
 * 使右侧 = 98000 − 8000 + 10000 = 恰好 100000 行（行数上限内，guards 放行）。 */
function buildBlockRearrange(lineCount) {
  const base = new Array(lineCount)
  for (let i = 0; i < lineCount; i += 1) {
    base[i] = `row ${i} lorem ipsum dolor sit`
  }
  const rnd = mulberry32(20260831)
  const inserted = new Array(10_000)
  for (let i = 0; i < inserted.length; i += 1) {
    inserted[i] = `NEW inserted block line ${i} ${Math.floor(rnd() * 1e6)}`
  }
  const DELETE_START = 40_000
  const DELETE_END = 48_000
  const INSERT_AT = 70_000 // 指右侧切片下标（已先删 8000 行的序列内）
  const right = [
    ...base.slice(0, DELETE_START),
    ...base.slice(DELETE_END, INSERT_AT),
    ...inserted,
    ...base.slice(INSERT_AT),
  ]
  return { left: base, right }
}

/** S3：约 4.7MB 的长行文本（5 位行号下每行 ~117 字符），两侧接近 5MB 上限。 */
function buildLongLinePair(lineCount) {
  const leftLines = new Array(lineCount)
  for (let i = 0; i < lineCount; i += 1) {
    leftLines[i] =
      `const cfg${i} = { id: "${i}", url: "https://example.com/api/v1/res/${i}?token=abc123", ` +
      `retries: 3, enabled: true };`
  }
  const rightLines = leftLines.slice()
  let changed = 0
  for (let i = 3; i < lineCount; i += 25) {
    rightLines[i] = leftLines[i].replace('retries: 3', 'retries: 5')
    changed += 1
  }
  return { leftLines, rightLines, changed }
}

/* -------------------------------------------------------------------------- */
/* 测量辅助                                                                     */
/* -------------------------------------------------------------------------- */

const encoder = new TextEncoder()
const MB = 1024 * 1024

/** 输入体量摘要（UTF-8 字节 + 行数），并标注是否在上限内。 */
function sizeSummary(left, right) {
  const rows = [
    { side: 'left', text: left },
    { side: 'right', text: right },
  ].map(({ side, text }) => {
    const bytes = encoder.encode(text).length
    const lines = text === '' ? 0 : text.split('\n').length
    const overBytes = bytes > DIFF_LIMITS.maxBytes
    const overLines = lines > DIFF_LIMITS.maxLines
    return {
      side,
      bytes,
      lines,
      within: !overBytes && !overLines,
      detail: `${(bytes / MB).toFixed(2)}MB/${lines}行${overBytes ? ' [超字节上限]' : ''}${overLines ? ' [超行数上限]' : ''}`,
    }
  })
  return rows
}

/** 单次计时执行（毫秒；fn 可为同步或返回 Promise，await 统一计时）。 */
async function timeOnce(fn) {
  const t0 = process.hrtime.bigint()
  const out = await fn()
  const t1 = process.hrtime.bigint()
  return { ms: Number(t1 - t0) / 1e6, out }
}

/** 中位数。 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 场景测量：1 次预热（结果兼做正确性断言）+ 最多 iterations 次正式测量。
 * 单次超过 slowCapMs（默认 10s）时停止后续迭代（避免极端场景拖死脚本），
 * 内存取每轮前后的 heapUsed 差（global.gc 可用时先强制 GC 再计时）。
 */
function measureScenario(name, runFn, { iterations = 3, slowCapMs = 10_000 } = {}) {
  return (async () => {
    // 预热 + 正确性
    const warm = await timeOnce(runFn)
    const result = warm.out
    if (!result || result.ok !== true) {
      const error = result && result.error ? JSON.stringify(result.error) : String(result)
      throw new Error(`${name} 引擎返回失败：${error}`)
    }

    const times = []
    let heapDeltaBytes = 0
    for (let i = 0; i < iterations; i += 1) {
      if (typeof globalThis.gc === 'function') globalThis.gc()
      const mem0 = process.memoryUsage()
      const { ms } = await timeOnce(runFn)
      const mem1 = process.memoryUsage()
      times.push(ms)
      heapDeltaBytes = Math.max(heapDeltaBytes, mem1.heapUsed - mem0.heapUsed)
      if (ms > slowCapMs) {
        console.log(`    （第 ${i + 1} 轮 ${Math.round(ms)}ms 超过 ${slowCapMs}ms 上限，停止该场景后续迭代）`)
        break
      }
    }
    return { result, times, heapDeltaBytes }
  })()
}

/** 统计断言（对不上说明输入构造与预期不符，直接失败）。 */
function assertStats(result, name, expect) {
  const stats = result.stats
  for (const [key, expected] of Object.entries(expect)) {
    if (stats[key] !== expected) {
      throw new Error(`${name} 统计断言失败：${key} = ${stats[key]}，预期 ${expected}`)
    }
  }
}

/** 打印一行耗时（含所有迭代与中位数）。 */
function printTimes(label, times, heapDeltaBytes) {
  const medianMs = median(times)
  const heapMB = (heapDeltaBytes / MB).toFixed(1)
  const list = times.map((ms) => (ms >= 100 ? Math.round(ms) : ms.toFixed(1))).join(', ')
  const pass = medianMs <= 2000 ? '≤2s 达标' : '超 2s'
  console.log(
    `  ${label.padEnd(26)} 中位 ${String(Math.round(medianMs)).padStart(6)}ms  ` +
      `[${list}]  堆增量~${heapMB}MB  ${pass}`,
  )
  return medianMs
}

/* -------------------------------------------------------------------------- */
/* 场景执行                                                                     */
/* -------------------------------------------------------------------------- */

const ITERATIONS = 3
const summary = []

function record(name, detail, medianFullMs, medianIncrMs, ok) {
  summary.push({ name, detail, medianFullMs, medianIncrMs, ok })
}

console.log('==============================================================================')
console.log(`REL-002 基准（A 子项：10 万行对比 ≤2s）  Node ${process.version}  ${process.platform} ${process.arch}`)
console.log(`引擎入口：compareFull（UI 主路径）/ compareIncremental（注入同步调度器）`)
console.log(`迭代：预热 1 次 + 正式 ${ITERATIONS} 次（取中位数）；gc ${typeof globalThis.gc === 'function' ? '可用（--expose-gc）' : '未启用（内存数字偏高，可用 node --expose-gc 重跑）'}`)
console.log('==============================================================================')

/* -------------------------------- S1 -------------------------------------- */
{
  const LINE_COUNT = 100_000 // 恰好等于 maxLines（严格大于才超限 → 应通过）
  const leftLines = buildScatteredLines(LINE_COUNT)
  const { lines: rightLines, changed } = patchEveryNth(leftLines, 20, 7)
  const left = leftLines.join('\n')
  const right = rightLines.join('\n')

  console.log(`\n[S1] 散布修改 10 万行（每 20 行改 1 行，${changed} 处替换，行数恰等于上限 100_000）`)
  for (const row of sizeSummary(left, right)) {
    console.log(`  ${row.side}: ${row.detail}  ${row.within ? '（上限内，guards 应放行）' : '（超限！输入构造错误）'}`)
  }
  const limitError = checkPairLimits(left, right)
  if (limitError !== null) throw new Error(`S1 guards 拒绝了恰在上限内的输入：${JSON.stringify(limitError)}`)

  const { result, times, heapDeltaBytes } = await measureScenario(
    'S1 compareFull',
    () => compareFull(left, right, DEFAULT_OPTIONS),
    { iterations: ITERATIONS },
  )
  // 95000 equal + 5000 del + 5000 add（就地替换一行 = 1 del + 1 add）= 105000 行
  assertStats(result, 'S1', { addedLines: changed, removedLines: changed, totalRows: 105_000 })
  console.log(`  正确性：ok=true，rows=${result.stats.totalRows}，+${result.stats.addedLines}/-${result.stats.removedLines}，hunks=${result.stats.hunkCount}`)
  const medFull = printTimes('compareFull', times, heapDeltaBytes)

  const incr = await measureScenario(
    'S1 compareIncremental',
    () =>
      compareIncremental(left, right, DEFAULT_OPTIONS, {
        scheduler: (cb) => cb(), // 同步调度：测纯计算成本（与 compareFull 可比）
      }),
    { iterations: ITERATIONS },
  )
  const medIncr = printTimes('compareIncremental(同步)', incr.times, incr.heapDeltaBytes)
  record('S1 散布修改 10 万行（5000 处替换）', '10万行/约3.4MB', medFull, medIncr, medFull <= 2000)
}

/* -------------------------------- S2 -------------------------------------- */
{
  const { left: leftLines, right: rightLines } = buildBlockRearrange(98_000)
  const left = leftLines.join('\n')
  const right = rightLines.join('\n')

  console.log(`\n[S2] 大块重排（基准 9.8 万行：中段删 8000 行连续块 + 另处插 10000 行连续新块，右侧恰 10 万行）`)
  for (const row of sizeSummary(left, right)) {
    console.log(`  ${row.side}: ${row.detail}  ${row.within ? '（上限内）' : '（超限！输入构造错误）'}`)
  }
  const { result, times, heapDeltaBytes } = await measureScenario(
    'S2 compareFull',
    () => compareFull(left, right, DEFAULT_OPTIONS),
    { iterations: ITERATIONS },
  )
  // equal = 90000（9.8万 − 删除的 8000）+ del 8000 + add 10000 = 108000 行
  assertStats(result, 'S2', { addedLines: 10_000, removedLines: 8_000, totalRows: 108_000 })
  console.log(`  正确性：ok=true，rows=${result.stats.totalRows}，+${result.stats.addedLines}/-${result.stats.removedLines}，hunks=${result.stats.hunkCount}`)
  const medFull = printTimes('compareFull', times, heapDeltaBytes)

  const incr = await measureScenario(
    'S2 compareIncremental',
    () => compareIncremental(left, right, DEFAULT_OPTIONS, { scheduler: (cb) => cb() }),
    { iterations: ITERATIONS },
  )
  const medIncr = printTimes('compareIncremental(同步)', incr.times, incr.heapDeltaBytes)
  record('S2 大块重排 10 万行（删8k/插10k）', '10万行/约2.5MB', medFull, medIncr, medFull <= 2000)
}

/* -------------------------------- S3 -------------------------------------- */
{
  const { leftLines, rightLines, changed } = buildLongLinePair(40_000)
  const left = leftLines.join('\n')
  const right = rightLines.join('\n')

  console.log(`\n[S3] 5MB 上限附近：4 万行长行（~118 字符/行，每 25 行改 1 行，${changed} 处替换）`)
  for (const row of sizeSummary(left, right)) {
    console.log(`  ${row.side}: ${row.detail}  ${row.within ? '（上限内，接近 5MB）' : '（超限！输入构造错误）'}`)
  }
  const { result, times, heapDeltaBytes } = await measureScenario(
    'S3 compareFull',
    () => compareFull(left, right, DEFAULT_OPTIONS),
    { iterations: ITERATIONS },
  )
  assertStats(result, 'S3', { addedLines: changed, removedLines: changed })
  console.log(`  正确性：ok=true，rows=${result.stats.totalRows}，+${result.stats.addedLines}/-${result.stats.removedLines}`)
  const medFull = printTimes('compareFull', times, heapDeltaBytes)

  const incr = await measureScenario(
    'S3 compareIncremental',
    () => compareIncremental(left, right, DEFAULT_OPTIONS, { scheduler: (cb) => cb() }),
    { iterations: ITERATIONS },
  )
  const medIncr = printTimes('compareIncremental(同步)', incr.times, incr.heapDeltaBytes)
  record('S3 5MB 附近长行 4 万行', '双侧约4.7MB', medFull, medIncr, medFull <= 2000)

  // S3b：单侧 5MB vs 小文本（纯删除块 → O(N) 线性路径）。
  const small = leftLines.slice(0, 500).join('\n')
  console.log(`  [S3b] 单侧 4.7MB vs 500 行小文本（纯删除）`)
  const s3b = await measureScenario('S3b compareFull', () => compareFull(left, small, DEFAULT_OPTIONS), {
    iterations: ITERATIONS,
  })
  assertStats(s3b.result, 'S3b', { removedLines: 39_500 })
  const medS3b = printTimes('compareFull', s3b.times, s3b.heapDeltaBytes)
  record('S3b 单侧 5MB vs 500 行（纯删）', '左4.7MB/右小', medS3b, null, medS3b <= 2000)
}

/* -------------------------------- S1w ------------------------------------- */
/* S1 输入 + ignoreWhitespace 开启：comparator 走 normalizeForCompare 的空白折叠
 * 正则路径 —— 量化「逐比较重复规范化」的真实代价（修复前后对比的主证据）。 */
{
  const leftLines = buildScatteredLines(100_000)
  const { lines: rightLines } = patchEveryNth(leftLines, 20, 7)
  const left = leftLines.join('\n')
  const right = rightLines.join('\n')
  const optsW = { ...DEFAULT_OPTIONS, ignoreWhitespace: true }

  console.log(`\n[S1w] S1 输入 + ignoreWhitespace=true（comparator 带空白折叠正则）`)
  const s1w = await measureScenario('S1w compareFull', () => compareFull(left, right, optsW), {
    iterations: ITERATIONS,
    slowCapMs: 30_000,
  })
  assertStats(s1w.result, 'S1w', { addedLines: 5000, removedLines: 5000 })
  const medS1w = printTimes('compareFull(ignoreWhitespace)', s1w.times, s1w.heapDeltaBytes)
  record('S1w ignoreWhitespace=true', '10万行/约3.8MB', medS1w, null, medS1w <= 2000)
}

/* -------------------------------------------------------------------------- */
/* 编辑密度扫描（瓶颈定性）：D ≈ 5k / 10k / 20k 的 compareFull 耗时曲线           */
/* -------------------------------------------------------------------------- */
/* jsdiff diffArrays 为 Myers O(D²) 探索（D = 编辑距离 = del+add 行数）。本节用
 * 同一 10 万行输入、三种编辑密度（每 40 / 20 / 10 行改 1 行 → D ≈ 5k / 10k /
 * 20k）实测耗时，验证 D² 墙的位置与「≤2s 达标包络」。 */
{
  console.log('\n[扫描] 编辑密度 → compareFull 耗时（10 万行，每 step 行改 1 行）')
  const leftLines = buildScatteredLines(100_000)
  for (const step of [40, 20, 10]) {
    const { lines: rightLines, changed } = patchEveryNth(leftLines, step, 7)
    const left = leftLines.join('\n')
    const right = rightLines.join('\n')
    const { result, times } = await measureScenario(
      `扫描 step=${step}`,
      () => compareFull(left, right, DEFAULT_OPTIONS),
      { iterations: 2, slowCapMs: 15_000 },
    )
    const d = result.stats.addedLines + result.stats.removedLines
    printTimes(`每 ${String(step).padStart(2)} 行改 1 行（${changed} 处，D≈${d}）`, times, 0)
  }
}

/* -------------------------------------------------------------------------- */
/* 低效点量化（分析用）：comparator 包装开销 A/B                                  */
/* -------------------------------------------------------------------------- */
/* compareWithOptions 恒向 jsdiff 注入 normalizeForCompare 包装 comparator（即使
 * 选项全关、无规则 —— 规范形此时为恒等映射）。下面用 S1 的行数组直接测
 * diffArrays：无 comparator（=== 快路径）vs 引擎 comparator，量化包装开销，
 * 为「是否需要 comparator 快路径修复」提供数字依据。仅 1 次预热 + 2 次测量。 */
{
  const leftLines = buildScatteredLines(100_000)
  const { lines: rightLines } = patchEveryNth(leftLines, 20, 7)

  console.log('\n[A/B] jsdiff diffArrays comparator 开销量化（S1 的 10 万行数组，不含展开/组装）')
  const engineComparator = (a, b) =>
    normalizeForCompare(a, DEFAULT_OPTIONS, []) === normalizeForCompare(b, DEFAULT_OPTIONS, [])

  // A/B 直接计时（diffArrays 返回块数组而非 DiffResult，不走 measureScenario）：
  // 1 次预热 + 2 次正式，比较块数一致性作为等价性检查。
  async function benchRaw(label, fn) {
    await fn()
    const times = []
    let blocks = 0
    for (let i = 0; i < 2; i += 1) {
      if (typeof globalThis.gc === 'function') globalThis.gc()
      const { ms, out } = await timeOnce(fn)
      times.push(ms)
      blocks = out.length
    }
    printTimes(label, times, 0)
    return { medianMs: median(times), blocks }
  }

  const raw = await benchRaw('diffArrays 无 comparator(===)', () => diffArrays(leftLines, rightLines))
  const wrapped = await benchRaw('diffArrays 引擎 comparator', () =>
    diffArrays(leftLines, rightLines, { comparator: engineComparator }),
  )
  console.log(
    `  → comparator 包装开销倍数：${(wrapped.medianMs / raw.medianMs).toFixed(2)}x` +
      `（两路径产出的块数一致：${raw.blocks} vs ${wrapped.blocks}）`,
  )
}

/* -------------------------------------------------------------------------- */
/* 汇总                                                                         */
/* -------------------------------------------------------------------------- */

console.log('\n==============================================================================')
console.log('汇总（compareFull 中位数，达标线 2000ms）')
console.log('------------------------------------------------------------------------------')
for (const row of summary) {
  const verdict = row.ok ? '达标' : '超时'
  console.log(
    `  ${row.name.padEnd(34)} ${String(Math.round(row.medianFullMs)).padStart(6)}ms  ${verdict}`,
  )
}
console.log('==============================================================================')
