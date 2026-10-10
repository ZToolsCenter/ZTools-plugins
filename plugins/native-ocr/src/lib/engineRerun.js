// 引擎切换重跑的纯判定逻辑 —— 抽成无副作用函数以便单测
// （App.vue 依赖浏览器环境，无法在 node 里直接挂载）。
//
// 背景：watch(engine) 会在切引擎后用新引擎自动重识别当前图片。若切换时正有一次识别在途
// （loading=true），在途请求仍用旧引擎跑，而 UI 页签已经切到新引擎；旧实现的守卫是
// `!loading.value`，于是重跑被静默跳过、且没有任何补偿重试 —— 用户看到「新引擎页签 + 旧引擎结果」。
// 修法：在途时先「登记排队」（defer），等 loading 结束（recognizeSource 的 finally）再补跑。

/**
 * 切引擎瞬间的决策。
 *
 * - `loading === true` → `'defer'`：正在识别，绝不能立刻重跑（会与在途请求抢同一份结果状态），
 *   先登记排队，等 loading 结束再判断。**该分支优先于 hasSource / ready**：即使此刻没有图源、
 *   或新引擎尚未就绪，也照样排队，因为 loading 结束后这两个条件都可能已经变化
 *   （例如模型刚下载完成、或用户已换图）。
 * - `loading === false` → 有图源且新引擎就绪则 `'run'`，否则 `'skip'`
 *   （未就绪时遮罩会引导用户下载，不该静默失败）。
 *
 * @param {{ loading: boolean, hasSource: boolean, ready: boolean }} state
 * @returns {'run'|'defer'|'skip'}
 */
export function planEngineSwitch({ loading, hasSource, ready }) {
  if (loading) return 'defer'
  return hasSource && ready ? 'run' : 'skip'
}

/**
 * loading 结束时，是否该把之前登记的重跑补上。
 * 三项全部满足才补跑：登记过、仍有图源、新引擎已就绪。
 *
 * 防死循环的关键不在这里，而在调用方：补跑前必须**先清空 pending 标志**，
 * 这样同一次补跑（无论成功、失败还是再次进入 finally）都不会把自己重新排进队列。
 *
 * @param {{ pending: boolean, hasSource: boolean, ready: boolean }} state
 * @returns {boolean}
 */
export function shouldFlushPendingRerun({ pending, hasSource, ready }) {
  return pending === true && hasSource === true && ready === true
}
