'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createOmoManager } = require('../preload/omoManager')

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-omo-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const homeDir = path.join(root, 'home')
  const dataDir = path.join(root, 'data')
  const opencodeDir = path.join(homeDir, '.config', 'opencode')
  await fsp.mkdir(opencodeDir, { recursive: true })
  return { root, homeDir, dataDir, opencodeDir, manager: createOmoManager({ homeDir, dataDir }) }
}

test('OMO 本地导入优先新文件名并保留 JSONC 未知字段', async (t) => {
  const { manager, opencodeDir } = await fixture(t)
  await fsp.writeFile(path.join(opencodeDir, 'oh-my-opencode.jsonc'), '{"agents":{"legacy":{"model":"old"}}}')
  await fsp.writeFile(path.join(opencodeDir, 'oh-my-openagent.jsonc'), `{
    // comments are valid
    "$schema": "https://example.com/schema.json",
    "agents": { "sisyphus": { "model": "claude//sonnet" } },
    "categories": { "deep": { "model": "gpt-5" } },
    "disabled_agents": ["oracle"],
  }`)
  await fsp.writeFile(path.join(opencodeDir, 'opencode.json'), JSON.stringify({ plugin: ['unrelated@1', 'oh-my-opencode@1', 'oh-my-opencode-slim@2'], keep: true }))

  const local = await manager.readLocal('standard')
  assert.match(local.filePath, /oh-my-openagent\.jsonc$/)
  assert.equal(local.agents.sisyphus.model, 'claude//sonnet')
  assert.deepEqual(local.otherFields.disabled_agents, ['oracle'])

  const imported = await manager.importLocal('standard')
  const state = await manager.listProfiles()
  assert.equal(state.current.standard, imported.id)
  assert.equal(state.profiles.length, 1)
  assert.equal(state.profiles[0].settingsConfig.otherFields.$schema, 'https://example.com/schema.json')

  const written = JSON.parse(await fsp.readFile(path.join(opencodeDir, 'oh-my-openagent.jsonc'), 'utf8'))
  assert.deepEqual(written.disabled_agents, ['oracle'])
  assert.equal(written.categories.deep.model, 'gpt-5')
  const opencode = JSON.parse(await fsp.readFile(path.join(opencodeDir, 'opencode.json'), 'utf8'))
  assert.deepEqual(opencode.plugin, ['unrelated@1', 'oh-my-openagent@latest'])
  assert.equal(opencode.keep, true)
})

test('OMO Slim Profile CRUD、激活更新和停用符合互斥插件语义', async (t) => {
  const { manager, opencodeDir } = await fixture(t)
  await fsp.writeFile(path.join(opencodeDir, 'opencode.json'), JSON.stringify({ plugin: ['oh-my-openagent@latest', 'keep-plugin'] }))
  const saved = await manager.saveProfile({
    variant: 'slim', name: 'Lean agents',
    settingsConfig: { agents: { orchestrator: { model: 'kimi-k2' } }, categories: { ignored: true }, otherFields: { disabled_agents: ['oracle'] } }
  })
  await manager.activateProfile(saved.id)
  const slimPath = path.join(opencodeDir, 'oh-my-opencode-slim.jsonc')
  let written = JSON.parse(await fsp.readFile(slimPath, 'utf8'))
  assert.equal(written.agents.orchestrator.model, 'kimi-k2')
  assert.equal(written.categories, undefined)
  assert.deepEqual(JSON.parse(await fsp.readFile(path.join(opencodeDir, 'opencode.json'), 'utf8')).plugin, ['keep-plugin', 'oh-my-opencode-slim@latest'])

  await manager.saveProfile({ ...saved, name: 'Lean agents v2', settingsConfig: { agents: { orchestrator: { model: 'gpt-5' } } } })
  written = JSON.parse(await fsp.readFile(slimPath, 'utf8'))
  assert.equal(written.agents.orchestrator.model, 'gpt-5')
  assert.equal(JSON.parse(await fsp.readFile(`${slimPath}.bak`, 'utf8')).agents.orchestrator.model, 'kimi-k2')

  await manager.disable('slim')
  await assert.rejects(fsp.access(slimPath))
  assert.equal(JSON.parse(await fsp.readFile(`${slimPath}.bak`, 'utf8')).agents.orchestrator.model, 'gpt-5')
  assert.deepEqual(JSON.parse(await fsp.readFile(path.join(opencodeDir, 'opencode.json'), 'utf8')).plugin, ['keep-plugin'])
  assert.equal((await manager.listProfiles()).current.slim, '')
})

test('删除当前 OMO Profile 会停用配置，路径与配置树校验阻止危险输入', async (t) => {
  const { manager, opencodeDir } = await fixture(t)
  const saved = await manager.saveProfile({ variant: 'standard', name: 'Safe', settingsConfig: { agents: { build: { model: 'gpt' } } } })
  await manager.activateProfile(saved.id)
  await manager.deleteProfile(saved.id)
  const state = await manager.listProfiles()
  assert.equal(state.profiles.length, 0)
  assert.equal(state.current.standard, '')
  await assert.rejects(fsp.access(path.join(opencodeDir, 'oh-my-openagent.jsonc')))
  await assert.rejects(manager.saveProfile({ variant: 'unknown', name: 'Bad', settingsConfig: {} }), /未知 OMO 类型/)

  const outside = path.join(path.dirname(opencodeDir), 'outside.json')
  await fsp.writeFile(outside, '{}')
  await fsp.symlink(outside, path.join(opencodeDir, 'oh-my-openagent.jsonc'))
  await assert.rejects(manager.readLocal('standard'), /拒绝访问非普通文件/)
})
