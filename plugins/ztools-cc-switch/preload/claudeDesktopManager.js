'use strict'

/**
 * Claude Desktop 3P 配置管理器。
 *
 * Claude Desktop 的配置并不是 Claude Code 的 settings.json。它由普通配置、
 * 3P 配置、配置库 Profile 与配置库索引四个文件共同组成，因此任何切换都必须
 * 作为一个事务完成。该模块不向 Web UI 返回 Gateway Token 或 Provider 密钥。
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const PROFILE_ID = '00000000-0000-4000-8000-000000157210'
const PROFILE_NAME = 'CC Switch'
const OFFICIAL_PROVIDER_ID = 'claude-desktop-official'
const PROXY_PREFIX = '/claude-desktop'
const DEFAULT_ROUTES = Object.freeze([
  { routeId: 'claude-sonnet-5', envKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL', supports1m: true },
  { routeId: 'claude-opus-4-8', envKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL', supports1m: true },
  { routeId: 'claude-haiku-4-5', envKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', supports1m: true },
  { routeId: 'claude-fable-5', envKey: 'ANTHROPIC_DEFAULT_FABLE_MODEL', supports1m: true }
])

function isClaudeSafeModelId(value) {
  const model = String(value || '').trim().toLowerCase()
  if (model.includes('[1m]')) return false
  const tail = model.replace(/^anthropic\//, '').replace(/^claude-/, '')
  return ['sonnet-', 'opus-', 'haiku-', 'fable-'].some((prefix) => tail.startsWith(prefix) && tail.length > prefix.length)
}

function normalizeRoutes(input, mode = 'proxy') {
  const rows = Array.isArray(input) ? input : []
  const used = new Set()
  const safeFallbacks = DEFAULT_ROUTES.map((row) => row.routeId)
  const output = []
  for (const source of rows) {
    const upstreamModel = String(source?.upstreamModel || source?.model || '').trim()
    if (!upstreamModel) continue
    let routeId = String(source?.routeId || '').trim()
    if (mode === 'direct') {
      if (!isClaudeSafeModelId(routeId)) throw new Error(`Claude Desktop 直连模型必须使用 claude-* 或 anthropic/claude-* 名称: ${routeId || upstreamModel}`)
      if (upstreamModel && upstreamModel !== routeId) throw new Error(`Claude Desktop 直连模式不能映射模型: ${routeId} → ${upstreamModel}`)
    } else if (!isClaudeSafeModelId(routeId)) {
      routeId = safeFallbacks.find((candidate) => !used.has(candidate)) || ''
      if (!routeId) {
        let index = 2
        do { routeId = `${DEFAULT_ROUTES[0].routeId}-r${index}`; index += 1 } while (used.has(routeId))
      }
    }
    if (!routeId || used.has(routeId)) continue
    used.add(routeId)
    output.push({
      routeId,
      upstreamModel,
      labelOverride: String(source?.labelOverride || (!isClaudeSafeModelId(String(source?.routeId || '')) ? upstreamModel : '')).trim(),
      supports1m: Boolean(source?.supports1m)
    })
  }
  return output.sort((left, right) => left.routeId.localeCompare(right.routeId))
}

function resolveWindowsAppDir(localAppData, baseName) {
  const exact = path.join(localAppData, baseName)
  if (fs.existsSync(exact)) return exact
  try {
    const suffix = baseName.endsWith('-3p') ? '-3p' : ''
    const candidates = fs.readdirSync(localAppData, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^Claude/i.test(entry.name) && entry.name.toLowerCase().endsWith(suffix))
      .filter((entry) => suffix || !entry.name.toLowerCase().endsWith('-3p'))
      .map((entry) => path.join(localAppData, entry.name))
      .sort()
    return candidates[0] || exact
  } catch { return exact }
}

function getClaudeDesktopPaths(options = {}) {
  const platform = options.platform || process.platform
  const homeDir = path.resolve(options.homeDir || process.env.HOME || process.env.USERPROFILE || os.homedir())
  let normalDir
  let threepDir
  if (platform === 'darwin') {
    const root = path.join(homeDir, 'Library', 'Application Support')
    normalDir = path.join(root, 'Claude')
    threepDir = path.join(root, 'Claude-3p')
  } else if (platform === 'win32') {
    const localAppData = path.resolve(options.localAppData || process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'))
    normalDir = resolveWindowsAppDir(localAppData, 'Claude')
    threepDir = resolveWindowsAppDir(localAppData, 'Claude-3p')
  } else {
    return { supported: false, platform, homeDir }
  }
  const configLibraryPath = path.join(threepDir, 'configLibrary')
  return {
    supported: true,
    platform,
    homeDir,
    normalConfigPath: path.join(normalDir, 'claude_desktop_config.json'),
    threepConfigPath: path.join(threepDir, 'claude_desktop_config.json'),
    configLibraryPath,
    profilePath: path.join(configLibraryPath, `${PROFILE_ID}.json`),
    metaPath: path.join(configLibraryPath, '_meta.json')
  }
}

function createClaudeDesktopManager(options = {}) {
  const paths = getClaudeDesktopPaths(options)
  const dataDir = path.resolve(options.dataDir || path.join(paths.homeDir || os.homedir(), '.ztools', 'cc-switch'))
  const tokenPath = path.join(dataDir, 'claude-desktop-gateway.json')
  const storage = options.storage || null
  const secretCodec = options.secretCodec || null
  const gatewayStorageKey = 'cc-switch:claude-desktop-gateway-token'
  const randomUUID = options.randomUUID || crypto.randomUUID
  const beforeWrite = options.beforeWrite || null

  async function readJson(filePath, fallback = {}) {
    try {
      const value = JSON.parse(await fsp.readFile(filePath, 'utf8'))
      return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
    } catch (error) {
      if (error.code === 'ENOENT') return fallback
      throw new Error(`读取 Claude Desktop 配置失败 (${filePath}): ${error.message}`)
    }
  }

  async function replaceFile(filePath, content) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
    const temp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`
    await fsp.writeFile(temp, content, { mode: 0o600 })
    await fsp.rename(temp, filePath)
  }

  async function writeJson(filePath, value) {
    if (beforeWrite) await beforeWrite(filePath, value)
    try { await fsp.copyFile(filePath, `${filePath}.bak`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    await replaceFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
  }

  async function snapshotFiles() {
    const snapshots = []
    for (const filePath of [paths.normalConfigPath, paths.threepConfigPath, paths.profilePath, paths.metaPath]) {
      try { snapshots.push({ filePath, content: await fsp.readFile(filePath) }) }
      catch (error) { if (error.code === 'ENOENT') snapshots.push({ filePath, content: null }); else throw error }
    }
    return snapshots
  }

  async function restoreSnapshots(snapshots) {
    for (const snapshot of snapshots) {
      if (snapshot.content === null) await fsp.rm(snapshot.filePath, { force: true })
      else await replaceFile(snapshot.filePath, snapshot.content)
    }
  }

  async function transaction(operation) {
    if (!paths.supported) throw new Error('Claude Desktop 配置切换仅支持 macOS 与 Windows')
    const snapshots = await snapshotFiles()
    try { return await operation() }
    catch (error) {
      try { await restoreSnapshots(snapshots) }
      catch (rollbackError) { throw new Error(`${error.message}；回滚失败：${rollbackError.message}`) }
      throw error
    }
  }

  async function getGatewayToken() {
    if (storage && secretCodec) {
      const encoded = storage.getItem(gatewayStorageKey)
      if (typeof encoded === 'string' && encoded) {
        try { const token = secretCodec.decode(encoded); if (token.startsWith('ccs-')) return token } catch {}
      }
      const token = `ccs-${randomUUID().replace(/-/g, '')}`
      storage.setItem(gatewayStorageKey, secretCodec.encode(token))
      return token
    }
    const stored = await readJson(tokenPath, {})
    if (typeof stored.token === 'string' && stored.token.startsWith('ccs-')) return stored.token
    const token = `ccs-${randomUUID().replace(/-/g, '')}`
    await fsp.mkdir(dataDir, { recursive: true, mode: 0o700 })
    await replaceFile(tokenPath, `${JSON.stringify({ token }, null, 2)}\n`)
    return token
  }

  function validateProvider(provider) {
    if (provider.id === OFFICIAL_PROVIDER_ID) return { mode: 'official', routes: [] }
    const mode = provider.claudeDesktopMode === 'proxy' ? 'proxy' : 'direct'
    const apiFormat = String(provider.claudeDesktopApiFormat || ({ openai_compat: 'openai_chat', responses: 'openai_responses', gemini: 'gemini_native' }[provider.apiType] || provider.apiType || 'anthropic'))
    if (!provider.baseUrl) throw new Error('Claude Desktop Provider 缺少 Base URL')
    if (mode === 'direct') {
      if (apiFormat !== 'anthropic' || provider.authProvider || provider.isFullUrl) throw new Error('Claude Desktop 直连模式仅支持原生 Anthropic API、Bearer Token 与非完整 URL')
      if (!provider.apiKey) throw new Error('Claude Desktop 直连模式缺少 API Key')
    } else {
      if (!['anthropic', 'openai_chat', 'openai_responses', 'gemini_native'].includes(apiFormat)) throw new Error(`Claude Desktop 本地路由不支持 API 格式: ${apiFormat}`)
      if (!provider.apiKey && !provider.authProvider) throw new Error('Claude Desktop 本地路由 Provider 缺少 API Key 或已登录账号')
    }
    const fallback = provider.model ? [{ routeId: provider.model, upstreamModel: provider.model, supports1m: false }] : []
    const routes = normalizeRoutes(provider.claudeDesktopRoutes?.length ? provider.claudeDesktopRoutes : fallback, mode)
    if (mode === 'proxy' && !routes.length) throw new Error('Claude Desktop 本地路由至少需要一个模型路由映射')
    return { mode, apiFormat, routes }
  }

  async function writeDeploymentMode(filePath, mode) {
    const config = await readJson(filePath, {})
    config.deploymentMode = mode
    await writeJson(filePath, config)
  }

  async function writeMeta(applied) {
    const meta = await readJson(paths.metaPath, {})
    const entries = (Array.isArray(meta.entries) ? meta.entries : []).filter((entry) => entry?.id !== PROFILE_ID)
    if (applied) {
      entries.push({ id: PROFILE_ID, name: PROFILE_NAME })
      meta.appliedId = PROFILE_ID
    } else if (meta.appliedId === PROFILE_ID) {
      if (entries[0]?.id) meta.appliedId = entries[0].id
      else delete meta.appliedId
    }
    meta.entries = entries
    await writeJson(paths.metaPath, meta)
  }

  async function restoreOfficial() {
    return transaction(async () => {
      await writeDeploymentMode(paths.normalConfigPath, '1p')
      await writeDeploymentMode(paths.threepConfigPath, '1p')
      const threep = await readJson(paths.threepConfigPath, {})
      if (threep.enterpriseConfig && typeof threep.enterpriseConfig === 'object') {
        for (const key of ['disableDeploymentModeChooser', 'inferenceGatewayApiKey', 'inferenceGatewayAuthScheme', 'inferenceGatewayBaseUrl', 'inferenceProvider']) delete threep.enterpriseConfig[key]
        if (!Object.keys(threep.enterpriseConfig).length) delete threep.enterpriseConfig
        await writeJson(paths.threepConfigPath, threep)
      }
      await fsp.rm(paths.profilePath, { force: true })
      await writeMeta(false)
      return { mode: 'official', configured: false }
    })
  }

  async function applyProvider(provider, routerStatus = {}) {
    const validated = validateProvider(provider)
    if (validated.mode === 'official') return restoreOfficial()
    let baseUrl = provider.baseUrl.replace(/\/+$/, '')
    let apiKey = provider.apiKey
    if (validated.mode === 'proxy') {
      if (!routerStatus.running) throw new Error('Claude Desktop Proxy 模式需要先启动本地路由')
      const origin = new URL(routerStatus.url)
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Claude Desktop Gateway 必须监听在本机回环地址')
      baseUrl = `${origin.origin}${PROXY_PREFIX}`
      apiKey = await getGatewayToken()
    }
    const inferenceModels = validated.routes.map((route) => ({
      name: route.routeId,
      ...(route.labelOverride ? { labelOverride: route.labelOverride } : {}),
      supports1m: route.supports1m
    }))
    const profile = {
      coworkEgressAllowedHosts: ['*'],
      disableDeploymentModeChooser: true,
      inferenceGatewayApiKey: apiKey,
      inferenceGatewayAuthScheme: 'bearer',
      inferenceGatewayBaseUrl: baseUrl,
      inferenceProvider: 'gateway',
      inferenceModels
    }
    return transaction(async () => {
      await writeDeploymentMode(paths.normalConfigPath, '3p')
      await writeDeploymentMode(paths.threepConfigPath, '3p')
      await writeJson(paths.profilePath, profile)
      await writeMeta(true)
      return { mode: validated.mode, configured: true, profilePath: paths.profilePath, baseUrl }
    })
  }

  async function getStatus(routerStatus = {}) {
    if (!paths.supported) return { supported: false, configured: false, proxyRunning: Boolean(routerStatus.running) }
    const meta = await readJson(paths.metaPath, {})
    const profile = await readJson(paths.profilePath, {})
    const configured = fs.existsSync(paths.profilePath) || (meta.entries || []).some((entry) => entry?.id === PROFILE_ID)
    return {
      supported: true,
      configured,
      appliedId: meta.appliedId || null,
      profilePath: paths.profilePath,
      configLibraryPath: paths.configLibraryPath,
      actualBaseUrl: profile.inferenceGatewayBaseUrl || null,
      proxyRunning: Boolean(routerStatus.running),
      staleRawModels: Array.isArray(profile.inferenceModels) && profile.inferenceModels.some((item) => !isClaudeSafeModelId(typeof item === 'string' ? item : item?.name)),
      gatewayTokenConfigured: Boolean(storage?.getItem?.(gatewayStorageKey)) || fs.existsSync(tokenPath)
    }
  }

  return { getPaths: () => ({ ...paths }), getStatus, getGatewayToken, validateProvider, applyProvider, restoreOfficial, getDefaultRoutes: () => DEFAULT_ROUTES.map((row) => ({ ...row })), normalizeRoutes }
}

module.exports = { PROFILE_ID, PROFILE_NAME, OFFICIAL_PROVIDER_ID, PROXY_PREFIX, DEFAULT_ROUTES, isClaudeSafeModelId, normalizeRoutes, getClaudeDesktopPaths, createClaudeDesktopManager }
