'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createConfigManager } = require('../preload/configManager')

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-onboarding-'))
  const homeDir = path.join(root, 'home'); const dataDir = path.join(root, 'data'); const rules = path.join(root, 'rules.json')
  await fsp.mkdir(homeDir, { recursive: true }); await fsp.writeFile(rules, '{"version":"test","providers":[]}')
  return { root, homeDir, manager: createConfigManager({ homeDir, dataDir, bundledRulesPath: rules }) }
}

test('Claude onboarding 开关只增量维护根字段并生成备份', async (t) => {
  const { root, homeDir, manager } = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const target = path.join(homeDir, '.claude.json')
  await fsp.writeFile(target, JSON.stringify({ theme: 'dark', projects: { demo: {} }, hasCompletedOnboarding: false }))
  const enabled = await manager.setClaudeOnboardingSkip(true)
  assert.equal(enabled.changed, true); assert.equal(enabled.enabled, true)
  assert.deepEqual(JSON.parse(await fsp.readFile(target, 'utf8')), { theme: 'dark', projects: { demo: {} }, hasCompletedOnboarding: true })
  assert.deepEqual(JSON.parse(await fsp.readFile(`${target}.bak`, 'utf8')), { theme: 'dark', projects: { demo: {} }, hasCompletedOnboarding: false })
  assert.equal((await manager.getClaudeOnboardingStatus()).enabled, true)
  const disabled = await manager.setClaudeOnboardingSkip(false)
  assert.equal(disabled.changed, true)
  assert.deepEqual(JSON.parse(await fsp.readFile(target, 'utf8')), { theme: 'dark', projects: { demo: {} } })
})

test('Claude onboarding 重复操作幂等，非法根配置不会被覆盖', async (t) => {
  const { root, homeDir, manager } = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  assert.deepEqual(await manager.setClaudeOnboardingSkip(false), { enabled: false, changed: false, path: path.join(homeDir, '.claude.json') })
  await manager.setClaudeOnboardingSkip(true)
  assert.equal((await manager.setClaudeOnboardingSkip(true)).changed, false)
  await fsp.writeFile(path.join(homeDir, '.claude.json'), '[]')
  await assert.rejects(() => manager.setClaudeOnboardingSkip(true), /根必须是对象/)
  assert.equal(await fsp.readFile(path.join(homeDir, '.claude.json'), 'utf8'), '[]')
})

test('Claude VS Code 插件联动增量维护 primaryApiKey 并可恢复官方模式', async (t) => {
  const { root, homeDir, manager } = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const target = path.join(homeDir, '.claude', 'config.json')
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(target, JSON.stringify({ theme: 'dark', primaryApiKey: 'user-key', extra: { keep: true } }))
  const enabled = await manager.setClaudePluginIntegration(true)
  assert.equal(enabled.changed, true); assert.equal((await manager.getClaudePluginIntegrationStatus()).enabled, true)
  assert.deepEqual(JSON.parse(await fsp.readFile(target, 'utf8')), { theme: 'dark', primaryApiKey: 'any', extra: { keep: true } })
  assert.deepEqual(JSON.parse(await fsp.readFile(`${target}.bak`, 'utf8')), { theme: 'dark', primaryApiKey: 'user-key', extra: { keep: true } })
  await manager.setClaudePluginIntegration(false)
  assert.deepEqual(JSON.parse(await fsp.readFile(target, 'utf8')), { theme: 'dark', extra: { keep: true } })
})
