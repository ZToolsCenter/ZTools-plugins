'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createProfileManager } = require('../preload/profileManager')

test('Profiles snapshot, autosave and apply only the selected scope', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-profiles-test-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const state = {
    active: { claude: 'p1', codex: 'c1' },
    mcp: [{ id: 'm1', apps: { claude: true } }, { id: 'm2', apps: { claude: false } }],
    skills: [{ directory: 's1', apps: { claude: true } }, { directory: 's2', apps: { claude: false } }],
    prompts: [{ id: 'pr1', apps: { claude: true } }]
  }
  const providerSwitches = []
  const routingDisabled = []
  const extensionManager = {
    listExtensions: async () => ({ mcpServers: state.mcp, prompts: state.prompts }),
    setMcpEnabled: async (id, app, enabled) => { state.mcp.find((item) => item.id === id).apps[app] = enabled },
    setPromptEnabled: async (id, app, enabled) => { state.prompts.find((item) => item.id === id).apps[app] = enabled }
  }
  const skillManager = {
    listSkills: async () => ({ skills: state.skills }),
    setSkillEnabled: async (id, app, enabled) => { state.skills.find((item) => item.directory === id).apps[app] = enabled }
  }
  const manager = createProfileManager({
    dataDir: path.join(root, 'data'),
    configManager: { listProviders: async () => ({ active: state.active }) }, extensionManager, skillManager,
    applyProvider: async (app, id) => { providerSwitches.push([app, id]); state.active[app] = id },
    disableRouting: async (app) => routingDisabled.push(app)
  })

  const work = await manager.createProfile('Work', 'claude')
  assert.equal(work.payload.providers.claude, 'p1')
  assert.deepEqual(work.payload.skills.claude, ['s1'])

  state.active.claude = 'p2'; state.mcp[0].apps.claude = false; state.mcp[1].apps.claude = true
  const personal = await manager.createProfile('Personal', 'claude')
  state.active.claude = 'p3'
  const applied = await manager.applyProfile(work.id, 'claude')
  assert.deepEqual(providerSwitches.at(-1), ['claude', 'p1'])
  assert.deepEqual(routingDisabled, ['claude'])
  assert.equal(state.mcp[0].apps.claude, true)
  assert.equal(state.mcp[1].apps.claude, false)
  assert.deepEqual(applied.warnings, [])

  const profiles = await manager.listProfiles()
  assert.equal(profiles.currentIds.claude, work.id)
  const autosaved = profiles.profiles.find((item) => item.id === personal.id)
  assert.equal(autosaved.payload.providers.claude, 'p3')
  assert.equal(profiles.currentIds.codex, null)
})

test('Profiles reject unsupported scopes and clear deleted current ids', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ztools-profiles-validation-test-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const manager = createProfileManager({
    dataDir: path.join(root, 'data'),
    configManager: { listProviders: async () => ({ active: {} }) },
    extensionManager: { listExtensions: async () => ({ mcpServers: [], prompts: [] }) },
    skillManager: { listSkills: async () => ({ skills: [] }) }, applyProvider: async () => {}
  })
  await assert.rejects(() => manager.createProfile('Gemini', 'gemini'), /不支持/)
  const profile = await manager.createProfile('Codex project', 'codex')
  const desktop = await manager.createProfile('Desktop project', 'claude-desktop')
  assert.equal((await manager.listProfiles()).currentIds['claude-desktop'], desktop.id)
  await manager.deleteProfile(profile.id)
  assert.equal((await manager.listProfiles()).currentIds.codex, null)
})
