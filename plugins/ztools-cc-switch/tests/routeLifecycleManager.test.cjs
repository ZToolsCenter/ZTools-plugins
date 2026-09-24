const test = require('node:test')
const assert = require('node:assert/strict')
const { createRouteLifecycleManager } = require('../preload/routeLifecycleManager')

function setup(routes = {}, running = false) {
  const calls = []
  let status = { running, url: 'http://127.0.0.1:15721', config: { routes: { ...routes } } }
  const routerManager = {
    status: async () => structuredClone(status),
    start: async () => { calls.push('start'); status.running = true; return structuredClone(status) },
    stop: async () => { calls.push('stop'); status.running = false; return structuredClone(status) },
    saveConfig: async ({ routes: patch }) => { calls.push(`save:${JSON.stringify(patch)}`); status.config.routes = { ...status.config.routes, ...patch }; return structuredClone(status.config) }
  }
  const configManager = { setClientRouting: async (client, enabled) => { calls.push(`client:${client}:${enabled}`) } }
  return { manager: createRouteLifecycleManager({ routerManager, configManager }), calls, status, routerManager, configManager }
}

test('开启第一条路由自动启动引擎，后续路由复用同一服务', async () => {
  const ctx = setup()
  const first = await ctx.manager.setRoute('claude', true)
  const second = await ctx.manager.setRoute('codex', true)
  assert.equal(first.autoStarted, true)
  assert.equal(second.autoStarted, false)
  assert.equal(ctx.calls.filter((item) => item === 'start').length, 1)
  assert.deepEqual(ctx.status.config.routes, { claude: true, codex: true })
})

test('关闭单条路由不影响其他客户端，关闭最后一条后自动停止', async () => {
  const ctx = setup({ claude: true, codex: true }, true)
  const first = await ctx.manager.setRoute('claude', false)
  assert.equal(first.autoStopped, false)
  assert.equal(ctx.status.running, true)
  const last = await ctx.manager.setRoute('codex', false)
  assert.equal(last.autoStopped, true)
  assert.equal(ctx.status.running, false)
  assert.equal(ctx.calls.filter((item) => item === 'stop').length, 1)
})

test('保存失败时回滚客户端接管并停止本次自动启动的引擎', async () => {
  const ctx = setup()
  ctx.routerManager.saveConfig = async () => { ctx.calls.push('save:failed'); throw new Error('disk full') }
  await assert.rejects(() => ctx.manager.setRoute('gemini', true), /disk full/)
  assert.deepEqual(ctx.calls, ['start', 'client:gemini:true', 'save:failed', 'client:gemini:false', 'stop'])
  assert.equal(ctx.status.running, false)
})

test('并发切换按调用顺序串行执行', async () => {
  const ctx = setup()
  await Promise.all([ctx.manager.setRoute('claude', true), ctx.manager.setRoute('codex', true)])
  assert.deepEqual(ctx.calls.slice(0, 5), ['start', 'client:claude:true', 'save:{"claude":true}', 'client:codex:true', 'save:{"codex":true}'])
})

test('停止全部路由时只清除成功恢复项，失败项保持路由且引擎继续运行', async () => {
  const ctx = setup({ claude: true, codex: true }, true)
  ctx.configManager.setClientRouting = async (client, enabled) => {
    ctx.calls.push(`client:${client}:${enabled}`)
    if (client === 'codex' && !enabled) throw new Error('config locked')
  }
  const manager = createRouteLifecycleManager({ routerManager: ctx.routerManager, configManager: ctx.configManager })
  await assert.rejects(() => manager.stopAll(), (error) => error.failures?.[0]?.client === 'codex')
  assert.deepEqual(ctx.status.config.routes, { claude: false, codex: true })
  assert.equal(ctx.status.running, true)
  assert.equal(ctx.calls.includes('stop'), false)
})

test('全部客户端恢复成功后清空路由并停止共享引擎', async () => {
  const ctx = setup({ claude: true, codex: true }, true)
  const result = await ctx.manager.stopAll()
  assert.equal(result.running, false)
  assert.deepEqual(ctx.status.config.routes, { claude: false, codex: false })
  assert.deepEqual(result.restoredClients.sort(), ['claude', 'codex'])
})

test('关闭标记保存失败时不修改客户端配置并保留原路由状态', async () => {
  const ctx = setup({ codex: true }, true)
  const originalSave = ctx.routerManager.saveConfig
  ctx.routerManager.saveConfig = async ({ routes }) => {
    if (routes.codex === false) { ctx.calls.push('save:failed'); throw new Error('disk full') }
    return originalSave({ routes })
  }
  await assert.rejects(() => ctx.manager.stopAll(), /保存路由状态失败|disk full/)
  assert.equal(ctx.status.config.routes.codex, true)
  assert.equal(ctx.calls.some((item) => item.startsWith('client:codex')), false)
  assert.equal(ctx.status.running, true)
})
