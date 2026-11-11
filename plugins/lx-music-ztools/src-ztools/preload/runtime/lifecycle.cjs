/** Keep one service lifetime across entering, hiding and detaching. */
function createLifecycle(hooks) {
  let ready, stopping, stopped = false
  return {
    async enter(action) {
      if (stopped) throw Object.assign(new Error('插件已终止'), { code: 'DISPOSED' })
      ready ||= Promise.resolve().then(() => hooks.initialize())
      await ready
      if (!stopped) await hooks.onEnter?.(action)
    },
    async out(isKill) { if (isKill) await this.dispose(); else await hooks.onHide?.() },
    async detach() { if (!stopped) await hooks.onDetach?.() },
    async dispose() {
      if (stopping) return stopping
      stopped = true
      stopping = Promise.resolve(ready).catch(() => {}).then(() => hooks.dispose())
      return stopping
    },
  }
}
module.exports = { createLifecycle }
