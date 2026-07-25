'use strict'

function createFailoverManager(options = {}) {
  const configManager = options.configManager
  const routerManager = options.routerManager
  if (!configManager || !routerManager) throw new Error('Failover Manager 缺少依赖')

  async function getEnabled(clientInput) {
    const client = String(clientInput || '')
    return Boolean((await routerManager.status()).config.failover?.enabled?.[client])
  }

  async function setEnabled(clientInput, enabledInput) {
    const client = String(clientInput || '')
    const enabled = Boolean(enabledInput)
    const currentStatus = await routerManager.status()
    if (enabled && (!currentStatus.running || !currentStatus.config.routes?.[client])) {
      throw new Error('需要先启动本地路由并启用该应用的路由接管')
    }
    let queue = await configManager.getFailoverQueue(client)
    let autoAdded = null
    if (enabled && !queue.length) {
      const active = await configManager.getActiveProvider(client)
      if (!active) throw new Error('故障转移队列为空，且未设置当前 Provider')
      queue = await configManager.addToFailoverQueue(client, active.id)
      autoAdded = active.id
    }
    try {
      if (enabled && queue[0]) await configManager.activateProvider(client, queue[0].providerId)
      const config = await routerManager.saveConfig({ failover: { enabled: { [client]: enabled } } })
      return { client, enabled, queue, config }
    } catch (error) {
      if (autoAdded) await configManager.removeFromFailoverQueue(client, autoAdded).catch(() => {})
      throw error
    }
  }

  return { getEnabled, setEnabled }
}

module.exports = { createFailoverManager }
