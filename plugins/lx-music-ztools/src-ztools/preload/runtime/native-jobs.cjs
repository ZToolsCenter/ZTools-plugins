/** CPU-heavy trusted metadata work runs in a separate host-owned renderer process.
 * Electron's plugin renderer does not support node:worker_threads. No user source
 * code or network document is ever loaded by this runner.
 */
function createNativeJobs({ ztools, files, timeout = 120000 }) {
  const active = new Set()
  let closed = false
  return {
    async run(data) {
      if (closed) throw new Error('标签任务服务已关闭')
      const filePath = files.scope.authorize(data.filePath)
      const window = ztools.createBrowserWindow('native-jobs.html', { show: false, width: 1, height: 1,
        skipTaskbar: true, webPreferences: { preload: 'preload/native-jobs.cjs' } })
      if (!window?.webContents?.executeJavaScript || typeof window.destroy !== 'function') throw new Error('ZTools 无法创建标签任务窗口')
      let timer, rejectJob
      const cancelled = new Promise((_resolve, reject) => { rejectJob = reject })
      const cancel = () => { rejectJob(new Error('标签任务服务已关闭')); try { window.destroy() } catch {} }
      active.add(cancel)
      try {
        timer = setTimeout(() => rejectJob(new Error('标签任务执行超时')), timeout)
        const payload = JSON.stringify({ ...data, filePath, cover: data.cover && { ...data.cover, data: Array.from(data.cover.data) } })
        const result = await Promise.race([cancelled, window.webContents.executeJavaScript(`(async () => {
          const deadline = Date.now() + 15000;
          while (!window.lxNativeJobs) {
            if (Date.now() > deadline) throw new Error('标签任务窗口初始化失败');
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          return window.lxNativeJobs.write(${payload});
        })()` )])
        if (result?.error) { const error = new Error(String(result.error)); if (result.stack) error.stack = result.stack; throw error }
        return result
      } finally { clearTimeout(timer); active.delete(cancel); try { window.destroy() } catch {} }
    },
    async dispose() { closed = true; for (const cancel of active) cancel(); active.clear() },
  }
}
module.exports = { createNativeJobs }
