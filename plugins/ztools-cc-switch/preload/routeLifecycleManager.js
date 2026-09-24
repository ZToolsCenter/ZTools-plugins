'use strict'

function createRouteLifecycleManager({ routerManager, configManager }) {
  if (!routerManager || !configManager) throw new Error('路由生命周期管理器缺少依赖')
  let queue = Promise.resolve()

  function hasEnabledRoute(config) {
    return Object.values(config?.routes || {}).some(Boolean)
  }

  async function apply(clientInput, enabledInput) {
    const client = String(clientInput || '')
    const enabled = Boolean(enabledInput)
    let status = await routerManager.status()
    let autoStarted = false
    let clientChanged = false

    if (enabled && !status.running) {
      status = await routerManager.start()
      autoStarted = true
    }

    try {
      await configManager.setClientRouting(client, enabled, status.url)
      clientChanged = true
      const config = await routerManager.saveConfig({ routes: { [client]: enabled } })
      let autoStopped = false
      if (!enabled && status.running && !hasEnabledRoute(config)) {
        status = await routerManager.stop()
        autoStopped = true
      } else status = await routerManager.status()
      return { client, enabled, autoStarted, autoStopped, status: { ...status, config } }
    } catch (error) {
      // 跨配置文件与监听服务的多步操作失败时，尽量回到操作前状态。
      if (clientChanged) await configManager.setClientRouting(client, !enabled, status.url).catch(() => {})
      if (autoStarted) {
        const latest = await routerManager.status().catch(() => null)
        if (latest?.running && !hasEnabledRoute(latest.config)) await routerManager.stop().catch(() => {})
      }
      throw error
    }
  }

  async function stopAllAndRestore() {
    const status = await routerManager.status()
    const succeeded = []
    const errors = []
    for (const [client, enabled] of Object.entries(status.config?.routes || {})) {
      if (!enabled) continue
      if (client === 'claude-desktop') {
        try { await routerManager.saveConfig({ routes: { [client]: false } }); succeeded.push(client) }
        catch (error) { errors.push({ client, message: `保存路由状态失败: ${error.message}` }) }
        continue
      }
      try {
        // 先落盘关闭标记；若客户端恢复失败，再把该标记补偿回开启状态。
        await routerManager.saveConfig({ routes: { [client]: false } })
        await configManager.setClientRouting(client, false, status.url)
        succeeded.push(client)
      } catch (error) {
        let rollbackMessage = ''
        try { await routerManager.saveConfig({ routes: { [client]: true } }) }
        catch (rollbackError) { rollbackMessage = `；路由状态回滚失败: ${rollbackError.message}` }
        errors.push({ client, message: `${error.message}${rollbackMessage}` })
      }
    }
    if (errors.length) {
      const error = new Error(`部分客户端配置恢复失败，路由引擎保持运行：${errors.map((item) => `${item.client}: ${item.message}`).join('；')}`)
      error.failures = errors
      throw error
    }
    const config = (await routerManager.status()).config
    const next = Object.values(config.routes || {}).some(Boolean) ? await routerManager.status() : await routerManager.stop()
    return { ...next, restoredClients: succeeded }
  }

  function setRoute(client, enabled) {
    const task = queue.then(() => apply(client, enabled))
    queue = task.catch(() => {})
    return task
  }

  function stopAll() {
    const task = queue.then(() => stopAllAndRestore())
    queue = task.catch(() => {})
    return task
  }

  return { setRoute, stopAll }
}

module.exports = { createRouteLifecycleManager }
