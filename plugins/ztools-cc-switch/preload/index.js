'use strict'

/**
 * ZTools Preload 能力桥。
 * 前端只拿到经过校验的业务方法，不直接暴露 fs/path 等 Node.js 原语。
 */

const path = require('node:path')
const fs = require('node:fs')
const { createConfigManager } = require('./configManager')
const { createSidecarClient } = require('./sidecarClient')
const { createSkillManager } = require('./skillManager')
const { createActivityStore } = require('./activityStore')
const { createRouterManager } = require('./routerManager')
const { createExtensionManager } = require('./extensionManager')
const { createBackupManager } = require('./backupManager')
const { createWebdavSyncManager, createMemoryStorage } = require('./webdavSyncManager')
const { createAuthManager } = require('./authManager')
const { createS3SyncManager } = require('./s3SyncManager')
const { createSubscriptionManager } = require('./subscriptionManager')
const { createSessionManager } = require('./sessionManager')
const { createWorkspaceManager } = require('./workspaceManager')
const { createEnvManager } = require('./envManager')
const { createUsageImportManager } = require('./usageImportManager')
const { createProfileManager } = require('./profileManager')
const { createOutboundProxyManager } = require('./outboundProxyManager')
const { createAgentConfigManager } = require('./agentConfigManager')
const { createHermesRuntimeManager } = require('./hermesRuntimeManager')
const { createDeepLinkManager } = require('./deepLinkManager')
const { createConnectivityCheckManager } = require('./connectivityCheckManager')
const { createModelFetchManager } = require('./modelFetchManager')
const { createOmoManager } = require('./omoManager')
const { createCodingPlanManager } = require('./codingPlanManager')
const { createToolRuntimeManager } = require('./toolRuntimeManager')
const { createProviderTerminalManager } = require('./providerTerminalManager')
const { createUniversalProviderManager } = require('./universalProviderManager')
const { createClaudeDesktopManager } = require('./claudeDesktopManager')
const { createBalanceManager } = require('./balanceManager')
const { createHostStartupManager } = require('./hostStartupManager')
const { createCodexHistoryManager } = require('./codexHistoryManager')
const { createUsageScriptManager } = require('./usageScriptManager')
const { createLogManager } = require('./logManager')
const { createFailoverManager } = require('./failoverManager')
const { createClientVisibilityManager } = require('./clientVisibility')
const { createRouteLifecycleManager } = require('./routeLifecycleManager')

function resolveDataDir() {
  try {
    const configured = window.ztools?.dbStorage?.getItem?.('cc-switch:app-config-dir-override')
    if (typeof configured === 'string' && configured.trim()) {
      const resolved = fs.realpathSync(configured.trim())
      if (fs.statSync(resolved).isDirectory()) return resolved
    }
    if (window.ztools && typeof window.ztools.getPath === 'function') {
      return path.join(window.ztools.getPath('userData'), 'ztools-cc-switch')
    }
  } catch (error) {
    console.warn('[cc-switch] 无法读取 ZTools userData，使用 Home 目录降级:', error.message)
  }
  const home = process.env.HOME || process.env.USERPROFILE
  if (!home) throw new Error('无法确定插件数据目录')
  return path.join(home, '.ztools', 'cc-switch')
}

const dataDir = resolveDataDir()
function getDefaultDataDir() {
  if (window.ztools && typeof window.ztools.getPath === 'function') return path.join(window.ztools.getPath('userData'), 'ztools-cc-switch')
  return path.join(process.env.HOME || process.env.USERPROFILE, '.ztools', 'cc-switch')
}
const bundledRulesPath = path.join(__dirname, '..', 'default-rules.json')
const sidecar = createSidecarClient()
let authManager = null
function createZtoolsStorage() {
  const candidate = window.ztools && window.ztools.dbStorage
  if (!candidate || typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function') return createMemoryStorage()
  return { getItem: (key) => candidate.getItem(key), setItem: (key, value) => candidate.setItem(key, value), removeItem: (key) => candidate.removeItem(key) }
}
function createSecretCodec() {
  try {
    const { safeStorage } = require('electron')
    if (safeStorage && safeStorage.isEncryptionAvailable()) return { secure: true, encode: (value) => safeStorage.encryptString(value).toString('base64'), decode: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')) }
  } catch (error) { console.warn('[cc-switch] 系统安全存储不可用:', error.message) }
  return { secure: false, encode: (value) => Buffer.from(value).toString('base64'), decode: (value) => Buffer.from(value, 'base64').toString('utf8') }
}
const ztoolsStorage = createZtoolsStorage()
const clientVisibilityManager = createClientVisibilityManager({ storage: ztoolsStorage })
const secretCodec = createSecretCodec()
const logManager = createLogManager({ dataDir })
logManager.install()
logManager.maintain().catch((error) => console.warn('[cc-switch] 日志维护失败:', error.message))
const logMaintenanceTimer = setInterval(() => logManager.maintain().catch((error) => console.warn('[cc-switch] 日志维护失败:', error.message)), 6 * 60 * 60 * 1000)
logMaintenanceTimer.unref?.()
const outboundProxyManager = createOutboundProxyManager({ storage: ztoolsStorage, secretCodec })
const outboundFetch = (input, init) => outboundProxyManager.fetch(input, init)
let routerManager = null
const claudeDesktopManager = createClaudeDesktopManager({ dataDir, storage: ztoolsStorage, secretCodec })
const configManager = createConfigManager({
  dataDir,
  bundledRulesPath,
  sidecar,
  fetchImpl: outboundFetch,
  claudeDesktopManager,
  getRouterStatus: () => routerManager ? routerManager.status() : Promise.resolve({ running: false, url: '' }),
  resolveProviderAuth: (provider) => authManager?.getValidToken(provider.authProvider, provider.authAccountId)
})
const skillManager = createSkillManager({
  dataDir,
  homeDir: configManager.getHomeDir(),
  fetch: outboundFetch
})
const activityStore = createActivityStore({ dataDir })
const agentConfigManager = createAgentConfigManager({ homeDir: configManager.getHomeDir(), hermesHome: process.env.HERMES_HOME })
const hermesRuntimeManager = createHermesRuntimeManager({
  openExternal: async (url) => {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('只允许打开本机 Hermes Web UI')
    if (window.ztools && typeof window.ztools.shellOpenExternal === 'function') return window.ztools.shellOpenExternal(parsed.href)
    const { shell } = require('electron')
    return shell.openExternal(parsed.href)
  }
})
const omoManager = createOmoManager({ homeDir: configManager.getHomeDir(), dataDir })
const extensionManager = createExtensionManager({ dataDir, homeDir: configManager.getHomeDir() })
const backupManager = createBackupManager({ dataDir })
backupManager.periodicLocalBackupIfNeeded().catch((error) => console.warn('[cc-switch] 自动数据快照失败:', error.message))
const webdavSync = createWebdavSyncManager({ backupManager, storage: ztoolsStorage, secretCodec, fetchImpl: outboundFetch })
const s3Sync = createS3SyncManager({ backupManager, storage: ztoolsStorage, secretCodec, fetchImpl: outboundFetch })
authManager = createAuthManager({ storage: ztoolsStorage, secretCodec, fetchImpl: outboundFetch })
const balanceManager = createBalanceManager({ fetchImpl: outboundFetch, resolveAuth: async (provider) => provider.authProvider ? authManager.getValidToken(provider.authProvider, provider.authAccountId) : ({ token: provider.apiKey }) })
const subscriptionManager = createSubscriptionManager({ homeDir: configManager.getHomeDir(), authManager, fetchImpl: outboundFetch })
const sessionManager = createSessionManager({ homeDir: configManager.getHomeDir(), dataDir })
const codexHistoryManager = createCodexHistoryManager({ homeDir: configManager.getHomeDir(), dataDir, sidecar })
const workspaceManager = createWorkspaceManager({ homeDir: configManager.getHomeDir(), dataDir })
const envManager = createEnvManager({ homeDir: configManager.getHomeDir(), dataDir })
const usageImportManager = createUsageImportManager({ homeDir: configManager.getHomeDir(), dataDir, activityStore })
routerManager = createRouterManager({
  dataDir,
  activityStore,
  fetchImpl: outboundFetch,
  getActiveProvider: (client) => configManager.getActiveProvider(client),
  getProviderCandidates: (client) => configManager.getProviderCandidates(client),
  getClaudeDesktopContext: async () => ({
    provider: await configManager.getActiveProvider('claude-desktop'),
    gatewayToken: await claudeDesktopManager.getGatewayToken()
  }),
  resolveProviderAuth: (provider) => provider.authProvider
    ? authManager.getValidToken(provider.authProvider, provider.authAccountId)
    : null
})
const failoverManager = createFailoverManager({ configManager, routerManager })
const routeLifecycleManager = createRouteLifecycleManager({ configManager, routerManager })
const profileManager = createProfileManager({
  dataDir, configManager, extensionManager, skillManager,
  applyProvider: (client, providerId) => switchProviderWithManagedAuth(client, providerId),
  disableRouting: async (client) => {
    const status = await routerManager.status()
    if (!status.config.routes?.[client]) return
    if (client === 'claude-desktop') { await routerManager.saveConfig({ routes: { 'claude-desktop': false } }); return }
    await configManager.setClientRouting(client, false, status.url)
    await routerManager.saveConfig({ routes: { [client]: false } })
  }
})
const usageScriptManager = createUsageScriptManager({ configManager, storage: ztoolsStorage, secretCodec, fetchImpl: outboundFetch })
const deepLinkManager = createDeepLinkManager({ configManager, extensionManager, skillManager })
const connectivityCheckManager = createConnectivityCheckManager({ dataDir, configManager, fetchImpl: outboundFetch })
const modelFetchManager = createModelFetchManager({ fetchImpl: outboundFetch, clientVersion: require('../plugin.json').version, resolveAuth: (provider, account) => authManager.getValidToken(provider, account) })
const codingPlanManager = createCodingPlanManager({
  fetchImpl: outboundFetch, storage: ztoolsStorage, secretCodec,
  getProvider: (providerId) => configManager.getProvider(providerId),
  listProviders: () => configManager.listProviders()
})
const toolRuntimeManager = createToolRuntimeManager({ homeDir: configManager.getHomeDir(), fetchImpl: outboundFetch })
const providerTerminalManager = createProviderTerminalManager({ homeDir: configManager.getHomeDir() })
const universalProviderManager = createUniversalProviderManager({ dataDir, configManager, storage: ztoolsStorage, secretCodec })
const hostStartupManager = createHostStartupManager({ storage: ztoolsStorage, getRouterStatus: () => routerManager.status(), startRouter: () => routerManager.start() })

function findDeepLink(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return null
  if (typeof value === 'string') {
    const match = value.match(/ccswitch:\/\/v1\/import\?[^\s]+/i)
    return match ? match[0] : null
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = findDeepLink(item, depth + 1); if (found) return found }
    return null
  }
  if (typeof value === 'object') {
    for (const key of ['payload', 'text', 'content', 'data', 'value', 'query']) {
      const found = findDeepLink(value[key], depth + 1); if (found) return found
    }
  }
  return null
}

async function stopRouterAndRestore() {
  const status = await routerManager.status()
  if (status.config.routes?.['claude-desktop']) {
    const desktopProvider = await configManager.getActiveProvider('claude-desktop')
    if (desktopProvider?.claudeDesktopMode === 'proxy') throw new Error('Claude Desktop 正在使用 Local Gateway；请先切换到 Direct Provider 或官方模式')
  }
  return routeLifecycleManager.stopAll()
}
async function openDirectoryWithHost(targetInput) {
  const target = path.resolve(String(targetInput || ''))
  fs.mkdirSync(target, { recursive: true, mode: 0o700 })
  if (window.ztools && typeof window.ztools.shellOpenPath === 'function') {
    const result = await window.ztools.shellOpenPath(target)
    if (typeof result === 'string' && result) throw new Error(result)
    return true
  }
  const { shell } = require('electron')
  const error = await shell.openPath(target)
  if (error) throw new Error(error)
  return true
}
async function switchProviderWithManagedAuth(client, providerId) {
  const provider = await configManager.getProvider(providerId)
  if (client === 'claude-desktop') {
    if (!provider) throw new Error('Provider 不存在')
    if (provider.authProvider) await authManager.getValidToken(provider.authProvider, provider.authAccountId)
    if (provider.claudeDesktopMode === 'proxy') {
      await routerManager.start()
      await routerManager.saveConfig({ routes: { 'claude-desktop': true } })
    } else await routerManager.saveConfig({ routes: { 'claude-desktop': false } })
    return configManager.switchProvider(client, providerId)
  }
  if (!provider?.authProvider) return configManager.switchProvider(client, providerId)
  if (!['claude', 'codex', 'gemini', 'grokbuild'].includes(client)) throw new Error('订阅账号 Provider 目前需通过 Claude、Codex、Gemini 或 GrokBuild 本地路由使用')
  await authManager.getValidToken(provider.authProvider, provider.authAccountId)
  const started = await routerManager.start()
  await configManager.activateProvider(client, providerId)
  await routerManager.saveConfig({ routes: { [client]: true } })
  await configManager.setClientRouting(client, true, started.url)
  return { client, providerId, providerName: provider.name, managedAuth: true, routed: true, routerUrl: started.url }
}
window.ccSwitch = Object.freeze({
  getThemePreference: () => {
    const value = ztoolsStorage.getItem('cc-switch:theme-v1')
    return ['light', 'system', 'dark'].includes(value) ? value : 'light'
  },
  setThemePreference: (valueInput) => {
    const value = String(valueInput || '')
    if (!['light', 'system', 'dark'].includes(value)) throw new Error('主题设置无效')
    ztoolsStorage.setItem('cc-switch:theme-v1', value)
    return value
  },
  getVisibleClients: () => clientVisibilityManager.getVisibleClients(),
  setVisibleClients: (ids) => clientVisibilityManager.setVisibleClients(ids),
  listProviders: () => configManager.listProviders(),
  saveProvider: (provider) => configManager.saveProvider(provider),
  updateProviderSortOrder: (client, ids) => configManager.updateProviderSortOrder(String(client || ''), Array.isArray(ids) ? ids : []),
  deleteProvider: async (providerId) => { const id = String(providerId || ''); const result = await configManager.deleteProvider(id); usageScriptManager.clearSecrets(id); return result },
  listUniversalProviders: () => universalProviderManager.list(),
  getUniversalProvider: (id) => universalProviderManager.get(String(id || '')),
  saveUniversalProvider: (provider) => universalProviderManager.upsert(provider || {}),
  syncUniversalProvider: (id) => universalProviderManager.sync(String(id || '')),
  deleteUniversalProvider: (id) => universalProviderManager.remove(String(id || '')),
  importLiveProviders: () => configManager.importLiveProviders(),
  listLiveProviderIds: (client) => configManager.listLiveProviderIds(String(client || '')),
  getLiveProviderFragment: (client, id) => configManager.getLiveProviderFragment(String(client || ''), String(id || '')),
  removeProviderFromLiveConfig: (client, id) => configManager.removeProviderFromLiveConfig(String(client || ''), String(id || '')),
  getFailoverQueue: (client) => configManager.getFailoverQueue(String(client || '')),
  getAvailableProvidersForFailover: (client) => configManager.getAvailableProvidersForFailover(String(client || '')),
  addToFailoverQueue: (client, providerId) => configManager.addToFailoverQueue(String(client || ''), String(providerId || '')),
  removeFromFailoverQueue: (client, providerId) => configManager.removeFromFailoverQueue(String(client || ''), String(providerId || '')),
  getAutoFailoverEnabled: (client) => failoverManager.getEnabled(String(client || '')),
  setAutoFailoverEnabled: (client, enabled) => failoverManager.setEnabled(String(client || ''), Boolean(enabled)),
  importClaudeDesktopProvidersFromClaude: () => configManager.importClaudeDesktopProvidersFromClaude(),
  getAppConfigDirOverride: () => ({ path: ztoolsStorage.getItem('cc-switch:app-config-dir-override') || '', activePath: dataDir, defaultPath: getDefaultDataDir(), restartRequired: false }),
  chooseAppConfigDirectory: async () => {
    if (!window.ztools || typeof window.ztools.showOpenDialog !== 'function') return null
    const result = await window.ztools.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (Array.isArray(result)) return result[0] || null
    if (result?.canceled) return null
    return result?.filePaths?.[0] || null
  },
  setAppConfigDirOverride: (selectedPath) => {
    const raw = String(selectedPath || '').trim()
    if (!raw) { ztoolsStorage.removeItem('cc-switch:app-config-dir-override'); return { path: '', activePath: dataDir, defaultPath: getDefaultDataDir(), restartRequired: path.resolve(dataDir) !== path.resolve(getDefaultDataDir()) } }
    const resolved = fs.realpathSync(raw)
    if (!fs.statSync(resolved).isDirectory()) throw new Error('所选路径不是目录')
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK)
    ztoolsStorage.setItem('cc-switch:app-config-dir-override', resolved)
    return { path: resolved, activePath: dataDir, defaultPath: getDefaultDataDir(), restartRequired: path.resolve(resolved) !== path.resolve(dataDir) }
  },
  getLocalBackupSettings: () => backupManager.getLocalBackupSettings(),
  saveLocalBackupSettings: (settings) => backupManager.saveLocalBackupSettings(settings || {}),
  listLocalBackups: () => backupManager.listLocalBackups(),
  createLocalBackup: () => backupManager.createLocalBackup(),
  restoreLocalBackup: (filename) => backupManager.restoreLocalBackup(String(filename || '')),
  renameLocalBackup: (filename, name) => backupManager.renameLocalBackup(String(filename || ''), String(name || '')),
  deleteLocalBackup: (filename) => backupManager.deleteLocalBackup(String(filename || '')),
  switchProvider: (client, providerId) => switchProviderWithManagedAuth(String(client || ''), String(providerId || '')),
  testProvider: (providerId, client) => configManager.testProvider(providerId, client),
  getClientStatus: () => configManager.getClientStatus(),
  openClientConfigDirectory: async (client) => openDirectoryWithHost((await configManager.getClientConfigDirectoryInfo(String(client || ''))).path),
  openAppDataDirectory: () => openDirectoryWithHost(dataDir),
  getClaudeOnboardingStatus: () => configManager.getClaudeOnboardingStatus(),
  setClaudeOnboardingSkip: (enabled) => configManager.setClaudeOnboardingSkip(Boolean(enabled)),
  getClaudePluginIntegrationStatus: () => configManager.getClaudePluginIntegrationStatus(),
  setClaudePluginIntegration: (enabled) => configManager.setClaudePluginIntegration(Boolean(enabled)),
  getClaudeDesktopStatus: async () => claudeDesktopManager.getStatus(await routerManager.status()),
  getClaudeDesktopDefaultRoutes: () => claudeDesktopManager.getDefaultRoutes(),
  openClaudeDesktopConfigLibrary: async () => {
    const target = claudeDesktopManager.getPaths().configLibraryPath
    if (!target) throw new Error('当前平台不支持 Claude Desktop 配置库')
    fs.mkdirSync(target, { recursive: true, mode: 0o700 })
    if (window.ztools && typeof window.ztools.shellOpenPath === 'function') return window.ztools.shellOpenPath(target)
    const { shell } = require('electron'); const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return true
  },
  getCommonConfigSnippet: (client) => configManager.getCommonConfigSnippet(String(client || '')),
  setCommonConfigSnippet: (client, snippet) => configManager.setCommonConfigSnippet(String(client || ''), String(snippet || '')),
  extractCommonConfigSnippet: (client) => configManager.extractCommonConfigSnippet(String(client || '')),
  listSkills: () => skillManager.listSkills(),
  selectSkillDirectory: async () => {
    if (!window.ztools || typeof window.ztools.showOpenDialog !== 'function') return null
    const result = await window.ztools.showOpenDialog({ properties: ['openDirectory'] })
    if (Array.isArray(result)) return result[0] || null
    if (result?.canceled) return null
    return result?.filePaths?.[0] || null
  },
  importSkill: (sourcePath, directory) => skillManager.importSkill(sourcePath, directory),
  installSkillsFromZip: async (client) => {
    const clientId = String(client || '')
    if (!window.ztools || typeof window.ztools.showOpenDialog !== 'function') throw new Error('当前 ZTools 版本不支持文件选择器')
    const result = await window.ztools.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Skills ZIP', extensions: ['zip'] }] })
    const selected = Array.isArray(result) ? result[0] : result?.canceled ? null : result?.filePaths?.[0]
    if (!selected) return null
    return skillManager.installSkillsFromZip(selected, clientId)
  },
  setSkillEnabled: (directory, client, enabled) => skillManager.setSkillEnabled(directory, client, Boolean(enabled)),
  removeSkill: (directory) => skillManager.removeSkill(directory),
  updateSkillSettings: (patch) => skillManager.updateSettings(patch || {}),
  listSkillBackups: () => skillManager.listSkillBackups(),
  restoreSkillBackup: (backupId, client) => skillManager.restoreSkillBackup(String(backupId || ''), String(client || '')),
  deleteSkillBackup: (backupId) => skillManager.deleteSkillBackup(String(backupId || '')),
  listSkillRepos: () => skillManager.listSkillRepos(),
  addSkillRepo: (repo) => skillManager.addSkillRepo(repo || {}),
  removeSkillRepo: (owner, name) => skillManager.removeSkillRepo(String(owner || ''), String(name || '')),
  discoverSkills: () => skillManager.discoverSkills(),
  installDiscoveredSkill: (skill, client) => skillManager.installDiscoveredSkill(skill || {}, String(client || 'claude')),
  checkSkillUpdates: () => skillManager.checkSkillUpdates(),
  updateSkill: (directory) => skillManager.updateSkill(String(directory || '')),
  scanUnmanagedSkills: () => skillManager.scanUnmanagedSkills(),
  importUnmanagedSkills: (selections) => skillManager.importUnmanagedSkills(Array.isArray(selections) ? selections : []),
  searchSkillsSh: (query, limit, offset) => skillManager.searchSkillsSh(String(query || ''), limit, offset),
  getSkillUiPreferences: () => {
    const value = ztoolsStorage.getItem('cc-switch:skills-ui-v1')
    return value && typeof value === 'object' ? value : {}
  },
  listProfiles: () => profileManager.listProfiles(),
  createProfile: (name, scope) => profileManager.createProfile(String(name || ''), String(scope || '')),
  updateProfile: (id, patch) => profileManager.updateProfile(String(id || ''), patch || {}),
  deleteProfile: (id) => profileManager.deleteProfile(String(id || '')),
  applyProfile: (id, scope) => profileManager.applyProfile(String(id || ''), String(scope || '')),
  clearCurrentProfile: (scope) => profileManager.clearCurrentProfile(String(scope || '')),
  getOpenClawDefaultModel: () => agentConfigManager.getOpenClawDefaultModel(),
  setOpenClawDefaultModel: (model) => agentConfigManager.setOpenClawDefaultModel(model || {}),
  getOpenClawModelCatalog: () => agentConfigManager.getOpenClawModelCatalog(),
  setOpenClawModelCatalog: (catalog) => agentConfigManager.setOpenClawModelCatalog(catalog || {}),
  getOpenClawAgentsDefaults: () => agentConfigManager.getOpenClawAgentsDefaults(),
  setOpenClawAgentsDefaults: (defaults) => agentConfigManager.setOpenClawAgentsDefaults(defaults || {}),
  getOpenClawEnv: () => agentConfigManager.getOpenClawEnv(),
  setOpenClawEnv: (env) => agentConfigManager.setOpenClawEnv(env || {}),
  getOpenClawTools: () => agentConfigManager.getOpenClawTools(),
  setOpenClawTools: (tools) => agentConfigManager.setOpenClawTools(tools || {}),
  scanOpenClawHealth: () => agentConfigManager.scanOpenClawHealth(),
  getHermesModelConfig: () => agentConfigManager.getHermesModelConfig(),
  probeHermesWebUi: () => hermesRuntimeManager.probeWebUi(),
  openHermesWebUi: (path) => hermesRuntimeManager.openWebUi(String(path || '/')),
  launchHermesDashboard: () => hermesRuntimeManager.launchDashboard(),
  getHermesMemory: (kind) => agentConfigManager.getHermesMemory(String(kind || '')),
  setHermesMemory: (kind, content) => agentConfigManager.setHermesMemory(String(kind || ''), content),
  getHermesMemoryLimits: () => agentConfigManager.getHermesMemoryLimits(),
  setHermesMemoryEnabled: (kind, enabled) => agentConfigManager.setHermesMemoryEnabled(String(kind || ''), Boolean(enabled)),
  listOmoProfiles: () => omoManager.listProfiles(),
  readOmoLocalFile: (variant) => omoManager.readLocal(String(variant || '')),
  saveOmoProfile: (profile) => omoManager.saveProfile(profile || {}),
  activateOmoProfile: (profileId) => omoManager.activateProfile(String(profileId || '')),
  disableOmo: (variant) => omoManager.disable(String(variant || '')),
  importOmoLocal: (variant) => omoManager.importLocal(String(variant || '')),
  deleteOmoProfile: (profileId) => omoManager.deleteProfile(String(profileId || '')),
  openOmoDirectory: async () => {
    const fs = require('node:fs/promises')
    const target = omoManager.getDirectory()
    await fs.mkdir(target, { recursive: true, mode: 0o700 })
    if (window.ztools && typeof window.ztools.shellOpenPath === 'function') return window.ztools.shellOpenPath(target)
    const { shell } = require('electron')
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return true
  },
  setSkillUiPreferences: (patch) => {
    const allowed = {}
    if (['installed', 'discover', 'backups'].includes(patch?.tab)) allowed.tab = patch.tab
    if (typeof patch?.query === 'string') allowed.query = patch.query.slice(0, 100)
    const current = ztoolsStorage.getItem('cc-switch:skills-ui-v1') || {}
    ztoolsStorage.setItem('cc-switch:skills-ui-v1', { ...current, ...allowed })
    return { ...current, ...allowed }
  },
  listExtensions: () => extensionManager.listExtensions(),
  importMcpFromApps: () => extensionManager.importMcpFromApps(),
  getClaudeMcpStatus: () => extensionManager.getClaudeMcpStatus(),
  readClaudeMcpConfig: () => extensionManager.readClaudeMcpConfig(),
  validateMcpCommand: (command) => extensionManager.validateMcpCommand(String(command || '')),
  saveMcp: (item) => extensionManager.saveMcp(item || {}),
  savePrompt: (item) => extensionManager.savePrompt(item || {}),
  getCurrentPromptFileContent: (client) => extensionManager.getCurrentPromptFileContent(String(client || '')),
  importPromptFromFile: (client) => extensionManager.importPromptFromFile(String(client || '')),
  setMcpEnabled: (id, client, enabled) => extensionManager.setMcpEnabled(id, client, Boolean(enabled)),
  setPromptEnabled: (id, client, enabled) => extensionManager.setPromptEnabled(id, client, Boolean(enabled)),
  removeMcp: (id) => extensionManager.removeMcp(id),
  removePrompt: (id) => extensionManager.removePrompt(id),
  chooseBackupExportPath: async () => {
    if (!window.ztools || typeof window.ztools.showSaveDialog !== 'function') return null
    const result = await window.ztools.showSaveDialog({ defaultPath: `ai-provider-switch-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON Backup', extensions: ['json'] }] })
    return result?.canceled ? null : (result?.filePath || result || null)
  },
  chooseBackupImportPath: async () => {
    if (!window.ztools || typeof window.ztools.showOpenDialog !== 'function') return null
    const result = await window.ztools.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON Backup', extensions: ['json'] }] })
    if (Array.isArray(result)) return result[0] || null
    return result?.canceled ? null : result?.filePaths?.[0] || null
  },
  exportBackup: (destination, options) => backupManager.exportBackup(destination, options || {}),
  importBackup: (source) => backupManager.importBackup(source),
  getWebdavConfig: () => webdavSync.getConfig(),
  saveWebdavConfig: (patch) => webdavSync.saveConfig(patch || {}),
  getWebdavStatus: () => webdavSync.getStatus(),
  onWebdavStatus: (listener) => webdavSync.subscribe(listener),
  syncWebdav: (options) => webdavSync.sync(options || {}),
  uploadWebdav: (options) => webdavSync.upload(options || {}),
  downloadWebdav: () => webdavSync.download(),
  getS3Config: () => s3Sync.getConfig(),
  saveS3Config: (patch) => s3Sync.saveConfig(patch || {}),
  getS3Status: () => s3Sync.getStatus(),
  onS3Status: (listener) => s3Sync.subscribe(listener),
  testS3Connection: (patch) => s3Sync.checkConnection(patch || {}),
  getS3RemoteInfo: () => s3Sync.fetchRemoteInfo(),
  syncS3: (options) => s3Sync.sync(options || {}),
  uploadS3: (options) => s3Sync.upload(options || {}),
  downloadS3: () => s3Sync.download(),
  getSubscriptionQuota: (tool, options) => subscriptionManager.queryQuota(String(tool || ''), options || {}),
  getAllSubscriptionQuotas: (options) => subscriptionManager.queryAll(options || {}),
  testEndpoints: (urls, timeoutSeconds) => subscriptionManager.testEndpoints(urls, timeoutSeconds),
  listBalanceProviders: async () => balanceManager.listCandidates((await configManager.listProviders()).providers),
  queryProviderBalance: async (providerId) => {
    const provider = await configManager.getProvider(String(providerId || ''))
    if (!provider) throw new Error('Provider 不存在')
    return balanceManager.queryProvider(provider)
  },
  getCustomEndpoints: (client, providerId) => configManager.getCustomEndpoints(String(client || ''), String(providerId || '')),
  addCustomEndpoint: (client, providerId, url) => configManager.addCustomEndpoint(String(client || ''), String(providerId || ''), String(url || '')),
  removeCustomEndpoint: (client, providerId, url) => configManager.removeCustomEndpoint(String(client || ''), String(providerId || ''), String(url || '')),
  selectCustomEndpoint: (client, providerId, url) => configManager.selectCustomEndpoint(String(client || ''), String(providerId || ''), String(url || '')),
  getConnectivityCheckConfig: () => connectivityCheckManager.getConfig(),
  saveConnectivityCheckConfig: (config) => connectivityCheckManager.saveConfig(config || {}),
  checkProviderReachability: (client, providerId) => connectivityCheckManager.checkProvider(String(client || ''), String(providerId || '')),
  checkAllProviderReachability: (client, proxyTargetsOnly) => connectivityCheckManager.checkAll(String(client || ''), Boolean(proxyTargetsOnly)),
  getConnectivityCheckLogs: (limit) => connectivityCheckManager.listLogs(limit),
  fetchModelsForConfig: (config) => modelFetchManager.fetchModels(config || {}),
  fetchModelsForProvider: async (providerId) => {
    const provider = await configManager.getProvider(String(providerId || ''))
    if (!provider) throw new Error('Provider 不存在')
    return provider.authProvider
      ? modelFetchManager.fetchManaged(provider.authProvider, provider.authAccountId, provider.baseUrl)
      : modelFetchManager.fetchModels(provider)
  },
  fetchManagedModels: (authProvider, accountId, baseUrl) => modelFetchManager.fetchManaged(String(authProvider || ''), String(accountId || ''), String(baseUrl || '')),
  listCodingPlanProviders: () => codingPlanManager.listCandidates(),
  queryCodingPlanQuota: (providerId) => codingPlanManager.queryProvider(String(providerId || '')),
  saveCodingPlanCredentials: (providerId, patch) => codingPlanManager.saveCredentials(String(providerId || ''), patch || {}),
  getToolVersions: (tools) => toolRuntimeManager.getToolVersions(Array.isArray(tools) ? tools : undefined),
  probeToolInstallations: (tools) => toolRuntimeManager.probeInstallations(Array.isArray(tools) ? tools : []),
  runToolLifecycleAction: (tools, action) => toolRuntimeManager.runLifecycle(Array.isArray(tools) ? tools : [], String(action || '')),
  chooseProviderTerminalDirectory: async () => {
    if (!window.ztools || typeof window.ztools.showOpenDialog !== 'function') return null
    const result = await window.ztools.showOpenDialog({ properties: ['openDirectory'] })
    if (Array.isArray(result)) return result[0] || null
    return result?.canceled ? null : result?.filePaths?.[0] || null
  },
  openProviderTerminal: async (client, providerId, cwd) => {
    const clientId = String(client || ''); const provider = await configManager.getProvider(String(providerId || ''))
    if (!provider || !provider.clients.includes(clientId)) throw new Error('Provider 不存在或不适用于该客户端')
    return providerTerminalManager.launch(clientId, provider, cwd || configManager.getHomeDir())
  },
  listSessions: () => sessionManager.listSessions(),
  getSessionMessages: (providerId, sourcePath) => sessionManager.getSessionMessages(String(providerId || ''), String(sourcePath || '')),
  deleteSession: (providerId, sessionId, sourcePath) => sessionManager.deleteSession(String(providerId || ''), String(sessionId || ''), String(sourcePath || '')),
  deleteSessions: (items) => sessionManager.deleteSessions(items || []),
  launchSession: (providerId, sessionId, sourcePath) => sessionManager.launchSession(String(providerId || ''), String(sessionId || ''), String(sourcePath || '')),
  listSessionTrash: () => sessionManager.listTrash(),
  restoreSessionTrash: (trashId) => sessionManager.restoreTrash(String(trashId || '')),
  getCodexHistoryUnifyStatus: () => codexHistoryManager.getStatus(),
  enableCodexHistoryUnify: (options) => codexHistoryManager.enable(options || {}),
  disableCodexHistoryUnify: (options) => codexHistoryManager.disable(options || {}),
  listWorkspaceFiles: () => workspaceManager.listWorkspaceFiles(),
  readWorkspaceFile: (filename) => workspaceManager.readWorkspaceFile(String(filename || '')),
  writeWorkspaceFile: (filename, content) => workspaceManager.writeWorkspaceFile(String(filename || ''), content),
  listDailyMemoryFiles: () => workspaceManager.listDailyMemoryFiles(),
  readDailyMemoryFile: (filename) => workspaceManager.readDailyMemoryFile(String(filename || '')),
  writeDailyMemoryFile: (filename, content) => workspaceManager.writeDailyMemoryFile(String(filename || ''), content),
  searchDailyMemoryFiles: (query) => workspaceManager.searchDailyMemoryFiles(String(query || '')),
  deleteDailyMemoryFile: (filename) => workspaceManager.deleteDailyMemoryFile(String(filename || '')),
  listDailyMemoryTrash: () => workspaceManager.listTrash(),
  restoreDailyMemoryTrash: (trashId) => workspaceManager.restoreTrash(String(trashId || '')),
  openWorkspaceDirectory: async (subdir) => {
    const paths = workspaceManager.getPaths()
    const target = subdir === 'memory' ? paths.memoryDir : paths.workspaceDir
    const fs = require('node:fs/promises')
    await fs.mkdir(target, { recursive: true, mode: 0o700 })
    if (window.ztools && typeof window.ztools.shellOpenPath === 'function') return window.ztools.shellOpenPath(target)
    const { shell } = require('electron')
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return true
  },
  scanEnvConflicts: (app) => envManager.scan(String(app || '')),
  fixEnvConflicts: (app, ids) => envManager.fix(String(app || ''), ids || []),
  listEnvBackups: () => envManager.listBackups(),
  restoreEnvBackup: (backupId) => envManager.restore(String(backupId || '')),
  listAuthProviders: () => authManager.listProviders(),
  getAuthStatus: (providerId) => authManager.getStatus(String(providerId || '')),
  startAuthLogin: (providerId, options) => authManager.startLogin(String(providerId || ''), options || {}),
  pollAuthLogin: (flowId) => authManager.pollLogin(String(flowId || '')),
  setDefaultAuthAccount: (providerId, accountId) => authManager.setDefault(String(providerId || ''), String(accountId || '')),
  removeAuthAccount: (providerId, accountId) => authManager.removeAccount(String(providerId || ''), String(accountId || '')),
  openExternal: async (url) => {
    const parsed = new URL(String(url || ''))
    if (parsed.protocol !== 'https:') throw new Error('只允许打开 HTTPS 链接')
    if (window.ztools && typeof window.ztools.shellOpenExternal === 'function') return window.ztools.shellOpenExternal(parsed.href)
    const { shell } = require('electron')
    return shell.openExternal(parsed.href)
  },
  copyText: async (value) => {
    const text = String(value ?? '')
    if (!text || text.length > 100000) throw new Error('复制内容为空或过长')
    if (window.ztools && typeof window.ztools.copyText === 'function') {
      await window.ztools.copyText(text)
      return true
    }
    const { clipboard } = require('electron')
    clipboard.writeText(text)
    return true
  },
  getRouterStatus: () => routerManager.status(),
  stopRouter: () => stopRouterAndRestore(),
  setRouterRoute: (client, enabled) => routeLifecycleManager.setRoute(String(client || ''), Boolean(enabled)),
  saveRouterConfig: (patch) => routerManager.saveConfig(patch || {}),
  getCircuitBreakerStats: (client, providerId) => routerManager.getCircuitBreakerStats(String(client || ''), String(providerId || '')),
  resetCircuitBreaker: (client, providerId) => routerManager.resetCircuitBreaker(String(client || ''), String(providerId || '')),
  getUsageSummary: (filters) => activityStore.summary(filters || {}),
  getRequestLogs: (filters) => activityStore.query(filters || {}),
  getPaginatedRequestLogs: (filters, page, pageSize) => activityStore.paginated(filters || {}, page, pageSize),
  getUsageSummaryByApp: (filters) => activityStore.summaryByApp(filters || {}),
  getUsageTrends: (filters) => activityStore.trends(filters || {}),
  getProviderStats: (filters) => activityStore.providerStats(filters || {}),
  getModelStats: (filters) => activityStore.modelStats(filters || {}),
  getRequestDetail: (requestId) => activityStore.detail(String(requestId || '')),
  checkProviderLimits: async (providerId) => activityStore.checkProviderLimits(await configManager.getProvider(String(providerId || ''))),
  getUsageScriptTemplates: () => usageScriptManager.getTemplates(),
  getProviderUsageScript: (providerId) => usageScriptManager.getConfig(String(providerId || '')),
  saveProviderUsageScript: (providerId, config) => usageScriptManager.saveConfig(String(providerId || ''), config || {}),
  testProviderUsageScript: (providerId, config) => usageScriptManager.test(String(providerId || ''), config || {}),
  queryProviderUsage: (providerId) => usageScriptManager.query(String(providerId || '')),
  listConfiguredUsageScripts: () => usageScriptManager.listConfigured(),
  getModelPricing: () => activityStore.listPricing(),
  getBillingDefaults: () => activityStore.getBillingDefaults(),
  saveBillingDefaults: (defaults) => activityStore.saveBillingDefaults(defaults || {}),
  updateModelPricing: (pricing) => activityStore.updatePricing(pricing || {}),
  deleteModelPricing: (modelId) => activityStore.deletePricing(String(modelId || '')),
  clearRequestLogs: () => activityStore.clear(),
  getLogConfig: () => logManager.getConfig(),
  saveLogConfig: (config) => logManager.saveConfig(config || {}),
  maintainLogs: () => logManager.maintain(),
  listLogFiles: () => logManager.listFiles(),
  clearAllLogs: () => logManager.clearLogs(),
  openLogDirectory: async () => {
    fs.mkdirSync(logManager.getDataDir(), { recursive: true, mode: 0o700 })
    if (window.ztools && typeof window.ztools.shellOpenPath === 'function') return window.ztools.shellOpenPath(logManager.getDataDir())
    const { shell } = require('electron'); const error = await shell.openPath(logManager.getDataDir()); if (error) throw new Error(error); return true
  },
  syncSessionUsage: (options) => usageImportManager.sync(options || {}),
  // 宿主确认框只暴露这一项固定的破坏性操作，不允许 Webview 自定义标题或按钮。
  confirmCodexUsageRebuild: async () => {
    if (!window.ztools || typeof window.ztools.showMessageBox !== 'function') return null
    const result = await window.ztools.showMessageBox({
      type: 'warning',
      title: '重建 Codex 用量',
      message: '只重建 Codex Session 用量记录',
      detail: '操作前会创建可恢复备份；本地路由、Claude、Gemini 与 OpenCode 等其他来源不会受影响。',
      buttons: ['取消', '创建备份并重建'],
      defaultId: 1,
      cancelId: 0,
      noLink: true
    })
    const response = typeof result === 'number' ? result : result?.response
    return response === 1
  },
  rebuildCodexUsage: async () => {
    const { backupPath, stateBackupPath, ...result } = await usageImportManager.rebuildCodex()
    // Webview 只需要结果摘要；本机绝对路径留在 Preload 宿主侧。
    return { ...result, backupsCreated: Number(Boolean(backupPath)) + Number(Boolean(stateBackupPath)) }
  },
  getUsageImportStatus: () => usageImportManager.status(),
  confirmDeepLinkImport: (pendingId) => deepLinkManager.confirm(String(pendingId || '')),
  cancelDeepLinkImport: (pendingId) => deepLinkManager.cancel(String(pendingId || '')),
  getOutboundProxyConfig: () => outboundProxyManager.getConfig(),
  saveOutboundProxyConfig: (patch) => outboundProxyManager.saveConfig(patch || {}),
  testOutboundProxy: (patch) => outboundProxyManager.testProxy(patch || {}),
  scanLocalProxies: () => outboundProxyManager.scanLocalProxies(),
  getRuntimeInfo: async () => ({
    dataDir,
    homeDir: configManager.getHomeDir(),
    sidecar: await sidecar.getStatus()
  }),
  getHostStartupSettings: () => hostStartupManager.getSettings(),
  saveHostStartupSettings: (patch) => hostStartupManager.saveSettings(patch || {})
})

if (window.ztools && typeof window.ztools.onPluginEnter === 'function') {
  window.ztools.onPluginEnter((action) => {
    window.dispatchEvent(new CustomEvent('cc-switch:enter', { detail: action }))
    const deepLink = findDeepLink(action)
    if (deepLink) {
      deepLinkManager.prepare(deepLink)
        .then((detail) => window.dispatchEvent(new CustomEvent('cc-switch:deeplink', { detail })))
        .catch((error) => window.dispatchEvent(new CustomEvent('cc-switch:deeplink-error', { detail: { message: error.message } })))
    }
    const config = webdavSync.getConfig()
    if (config.autoSync && config.hasPassword && config.url) webdavSync.sync().catch(() => {})
    const s3Config = s3Sync.getConfig()
    if (s3Config.enabled && s3Config.autoSync && s3Config.hasSecretAccessKey) s3Sync.sync().catch(() => {})
    if (hostStartupManager.getSettings().restoreOnPluginEnter) hostStartupManager.restoreRouter().catch((error) => console.warn('[cc-switch] ZTools 进入时恢复路由失败:', error.message))
  })
}

// 会话用量采用文件签名增量同步；延后执行，不阻塞插件首屏。
setTimeout(() => {
  usageImportManager.sync().catch((error) => console.warn('[cc-switch] 会话用量同步失败:', error.message))
}, 1800)

// ZTools 承担应用级登录启动；插件只在自身 Preload 建立后恢复已启用路由，
// 不创建重复或不可审核的 OS Login Item。
setTimeout(() => {
  hostStartupManager.restoreRouter().catch((error) => console.warn('[cc-switch] 宿主启动路由恢复失败:', error.message))
}, 2400)

setTimeout(() => {
  codexHistoryManager.ensure().catch((error) => console.warn('[cc-switch] Codex History Unify 启动态检查失败:', error.message))
}, 3000)

console.info('[cc-switch] preload ready')
