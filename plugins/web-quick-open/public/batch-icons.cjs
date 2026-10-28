function createBatchIcons({ read, write, fetchIcon, compress, sync, trace = () => {} }) {
  let task = null
  let sequence = 0

  const status = () => (task ? { ...task.state } : null)
  const eligible = (entry) => !entry.icon || entry.iconSource === 'auto'
  const key = (entry) => new URL(entry.url.replace('{q}', 'test')).href

  function cancel(id) {
    if (!task || task.state.id !== id || task.state.status !== 'running') return status()
    task.state.status = 'cancelling'
    task.controller.abort()
    return status()
  }

  function start() {
    if (task && ['running', 'cancelling'].includes(task.state.status)) {
      return { success: false, error: '已有图标获取任务正在运行' }
    }
    const entries = read()
    const candidates = entries.filter(eligible)
    if (!candidates.length)
      return { success: false, error: '没有可获取图标的入口，已有手动或未知来源图标将被跳过' }
    const current = (task = {
      startedAt: Date.now(),
      controller: new AbortController(),
      state: {
        id: ++sequence,
        status: 'running',
        total: entries.length,
        processed: entries.length - candidates.length,
        updated: 0,
        failed: 0,
        skipped: entries.length - candidates.length,
        error: '',
        revision: 0
      }
    })
    const jobs = new Map()
    for (const entry of candidates) {
      let url
      try {
        url = key(entry)
      } catch {
        url = entry.url
      }
      if (!jobs.has(url)) jobs.set(url, [])
      jobs.get(url).push({ ...entry })
    }
    trace('start', {
      taskId: current.state.id,
      totalCount: entries.length,
      candidateCount: candidates.length
    })
    void run(current, [...jobs.values()])
    return { success: true, data: status() }
  }

  async function run(current, jobs) {
    let cursor = 0
    let pending = []
    let flushTimer
    let storageFailed = false
    const active = () => task === current && !storageFailed
    const flush = () => {
      clearTimeout(flushTimer)
      flushTimer = null
      if (!pending.length || !active()) return
      const results = pending.splice(0, 10)
      try {
        // Read and write synchronously so edits made during network waits are preserved
        const latest = read()
        const byId = new Map(latest.map((entry) => [entry.id, entry]))
        const changed = []
        let skipped = 0
        for (const { snapshot, icon } of results) {
          const entry = byId.get(snapshot.id)
          if (
            !entry ||
            entry.url !== snapshot.url ||
            entry.icon !== snapshot.icon ||
            entry.iconSource !== snapshot.iconSource ||
            !eligible(entry)
          ) {
            skipped++
            continue
          }
          entry.icon = icon
          entry.iconSource = 'auto'
          changed.push(entry)
        }
        if (changed.length) write(latest)
        current.state.updated += changed.length
        current.state.skipped += skipped
        current.state.processed += results.length
        if (changed.length) current.state.revision++
        // A feature registration failure must not undo successfully saved icons
        for (const entry of changed) {
          try {
            sync(entry)
          } catch {
            trace('featureFailed', { taskId: current.state.id })
          }
        }
        trace('batch', {
          taskId: current.state.id,
          elapsedMs: Date.now() - current.startedAt,
          ...current.state
        })
        if (pending.length) flushTimer = setTimeout(flush, pending.length >= 10 ? 0 : 500)
      } catch {
        storageFailed = true
        current.state.failed += results.length
        current.state.processed += results.length
        current.state.error = '保存图标失败，任务已停止'
        current.controller.abort()
        trace('storageFailed', { taskId: current.state.id })
      }
    }
    const worker = async () => {
      while (active() && !current.controller.signal.aborted && cursor < jobs.length) {
        const entries = jobs[cursor++]
        try {
          const icon = await fetchIcon(entries[0].url, current.controller.signal)
          const compressed = await compress(icon)
          if (!active() || current.controller.signal.aborted) break
          pending.push(...entries.map((snapshot) => ({ snapshot, icon: compressed })))
          if (pending.length >= 10) flush()
          else if (!flushTimer) flushTimer = setTimeout(flush, 500)
        } catch {
          if (!active() || current.controller.signal.aborted) break
          current.state.failed += entries.length
          current.state.processed += entries.length
        }
        // Avoid monopolizing the plugin thread when cached or failed results settle immediately
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker))
      while (pending.length && active()) {
        flush()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      clearTimeout(flushTimer)
      current.controller.abort()
      const remaining = current.state.total - current.state.processed
      current.state.skipped += remaining
      current.state.processed += remaining
      current.state.status = storageFailed
        ? 'failed'
        : current.state.status === 'cancelling'
          ? 'cancelled'
          : 'completed'
      trace('complete', {
        taskId: current.state.id,
        elapsedMs: Date.now() - current.startedAt,
        status: current.state.status,
        totalCount: current.state.total,
        updatedCount: current.state.updated,
        failedCount: current.state.failed,
        skippedCount: current.state.skipped
      })
    }
  }

  return { start, status, cancel }
}

module.exports = { createBatchIcons }
