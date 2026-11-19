const { performance } = require('node:perf_hooks')

function aborted() { const error = new Error('查询已被更新或取消'); error.name = 'AbortError'; return error }
function checkAbort(signal) { if (signal?.aborted) throw aborted() }

/** 最多一个执行任务与一个最新待执行任务。过期任务读完再启动新任务，避免断开连接后引擎仍计算导致并发膨胀。 */
function createLatest(run) {
  let active = null, pending = null
  function pump() {
    if (active || !pending) return
    const item = pending; pending = null; active = item
    Promise.resolve().then(() => run(item.value, { signal: item.controller.signal, queueMs: performance.now() - item.created, isCurrent: () => !item.obsolete })).then(
      value => item.obsolete ? item.reject(aborted()) : item.resolve(value),
      error => item.reject(item.obsolete ? aborted() : error)
    ).finally(() => { if (active === item) active = null; pump() })
  }
  function invalidate() {
    if (active) active.obsolete = true
    if (pending) { pending.reject(aborted()); pending = null }
  }
  return {
    submit(value) {
      invalidate()
      return new Promise((resolve, reject) => {
        pending = { value, resolve, reject, controller: new AbortController(), created: performance.now(), obsolete: false }
        pump()
      })
    },
    invalidate,
    dispose() { invalidate(); active?.controller.abort() }
  }
}
module.exports = { createLatest, aborted, checkAbort }
