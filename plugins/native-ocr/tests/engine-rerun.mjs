// 引擎切换重跑纯逻辑回归测试 —— node tests/engine-rerun.mjs
// 覆盖 src/lib/engineRerun.js 的 planEngineSwitch / shouldFlushPendingRerun，
// 外加一条「切引擎（在途）→ loading 结束 → 补跑一次且不死循环」的端到端推演。
import assert from 'node:assert/strict'
import {
  planEngineSwitch,
  shouldFlushPendingRerun
} from '../src/lib/engineRerun.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`  ✗ ${name}\n    ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// planEngineSwitch
// ---------------------------------------------------------------------------
test('planEngineSwitch：loading=true + 有源 + ready → defer（排队，不立刻跑）', () => {
  assert.equal(planEngineSwitch({ loading: true, hasSource: true, ready: true }), 'defer')
})

test('planEngineSwitch：loading=true + 无源 → 仍是 defer（排队优先于"没源"判断）', () => {
  assert.equal(planEngineSwitch({ loading: true, hasSource: false, ready: true }), 'defer')
})

test('planEngineSwitch：loading=true + 新引擎未就绪 → 仍是 defer', () => {
  assert.equal(planEngineSwitch({ loading: true, hasSource: true, ready: false }), 'defer')
})

test('planEngineSwitch：loading=false + 有源 + ready → run', () => {
  assert.equal(planEngineSwitch({ loading: false, hasSource: true, ready: true }), 'run')
})

test('planEngineSwitch：loading=false + 无源 → skip', () => {
  assert.equal(planEngineSwitch({ loading: false, hasSource: false, ready: true }), 'skip')
})

test('planEngineSwitch：loading=false + 有源 + 未 ready → skip', () => {
  assert.equal(planEngineSwitch({ loading: false, hasSource: true, ready: false }), 'skip')
})

// ---------------------------------------------------------------------------
// shouldFlushPendingRerun
// ---------------------------------------------------------------------------
test('shouldFlushPendingRerun：pending + 有源 + ready → true', () => {
  assert.equal(shouldFlushPendingRerun({ pending: true, hasSource: true, ready: true }), true)
})

test('shouldFlushPendingRerun：未登记 pending → false（不做无谓重跑）', () => {
  assert.equal(shouldFlushPendingRerun({ pending: false, hasSource: true, ready: true }), false)
})

test('shouldFlushPendingRerun：pending 但已无图源 → false', () => {
  assert.equal(shouldFlushPendingRerun({ pending: true, hasSource: false, ready: true }), false)
})

test('shouldFlushPendingRerun：pending 但新引擎未就绪 → false', () => {
  assert.equal(shouldFlushPendingRerun({ pending: true, hasSource: true, ready: false }), false)
})

// ---------------------------------------------------------------------------
// 端到端推演：用最小状态机复刻 App.vue 的接线（watch(engine) + recognizeSource 的 finally）
// ---------------------------------------------------------------------------
function makeHarness() {
  const state = { loading: false, pending: false, runs: 0 }
  // 桩：模拟 recognizeSource —— 起始同步把 loading 置 true（与 App.vue:2146 一致）。
  function recognizeSource() {
    state.runs += 1
    state.loading = true
  }
  // 模拟 recognizeSource 的 finally 块。
  function finishRecognize() {
    state.loading = false
    if (shouldFlushPendingRerun({ pending: state.pending, hasSource: true, ready: true })) {
      state.pending = false // 先清标志，再补跑 → 防死循环
      recognizeSource()
    }
  }
  // 模拟 watch(engine) 的守卫。
  function switchEngine() {
    const plan = planEngineSwitch({ loading: state.loading, hasSource: true, ready: true })
    if (plan === 'run') recognizeSource()
    else if (plan === 'defer') state.pending = true
  }
  return { state, recognizeSource, finishRecognize, switchEngine }
}

test('端到端：切引擎（在途）→ loading 结束 → 恰好补跑一次，且第二次 flush 不再触发', () => {
  const h = makeHarness()

  h.recognizeSource() // 第一次识别开始（在途）
  assert.equal(h.state.runs, 1)
  assert.equal(h.state.loading, true)

  h.switchEngine() // 在途时切引擎
  assert.equal(h.state.pending, true, '应登记待跑')
  assert.equal(h.state.runs, 1, '在途时不得立刻重跑')

  h.finishRecognize() // 旧引擎的在途识别结束
  assert.equal(h.state.runs, 2, 'loading 结束后应恰好补跑一次')
  assert.equal(h.state.pending, false, '补跑前应清空 pending')
  assert.equal(h.state.loading, true, '补跑自身把 loading 置回 true')

  h.finishRecognize() // 补跑结束：不得再触发
  assert.equal(h.state.runs, 2, '第二次 flush 不得再次重跑（防死循环）')
  assert.equal(h.state.pending, false)
  assert.equal(h.state.loading, false, '所有退出路径都要复位 loading')
})

test('端到端：空闲时切引擎 → 立即 run，不登记 pending', () => {
  const h = makeHarness()

  h.recognizeSource()
  h.finishRecognize()
  assert.equal(h.state.runs, 1)
  assert.equal(h.state.loading, false)

  h.switchEngine()
  assert.equal(h.state.runs, 2, '空闲切引擎应立即重跑')
  assert.equal(h.state.pending, false, '立即跑的分支不该留下 pending')
})

test('端到端：连续两次切引擎（补跑期间再切）→ 每次切都最终补跑一次，不丢也不循环', () => {
  const h = makeHarness()

  h.recognizeSource() // 在途识别 A
  h.switchEngine() // 切 #1 → defer
  assert.equal(h.state.runs, 1)

  h.finishRecognize() // A 结束 → 补跑 B
  assert.equal(h.state.runs, 2)

  h.switchEngine() // B 在途时又切 #2 → defer
  assert.equal(h.state.pending, true)
  assert.equal(h.state.runs, 2)

  h.finishRecognize() // B 结束 → 补跑 C
  assert.equal(h.state.runs, 3)
  assert.equal(h.state.pending, false)

  h.finishRecognize() // C 结束 → 收敛，不再跑
  assert.equal(h.state.runs, 3)
})

// ---------------------------------------------------------------------------
console.log(`\n${passed} 通过 / ${failed} 失败`)
process.exit(failed ? 1 : 0)
