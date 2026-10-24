const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const { Worker } = require('node:worker_threads')
const { AsyncLocalStorage } = require('node:async_hooks')
const { getBrowserIcon } = require('./browser-icons.cjs')

let logIpc = null
try {
  logIpc = require('electron').ipcRenderer
} catch {
  // Browser-only development and Node tests do not have Electron IPC
}

let debugTraceSequence = 0
const debugContext = new AsyncLocalStorage()

function debugLog(event, details = {}, layer = 'preload') {
  const prefix = `[WebQuickOpen][${layer}]`
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    operationId: debugContext.getStore()?.operationId || null,
    ...details
  }
  try {
    console.debug(prefix, payload)
  } catch {
    // Logging must never interrupt plugin operations
  }
  try {
    // ZTools imports electron-log 5 in main, whose IPC listener feeds logCollector
    logIpc?.send('__ELECTRON_LOG__', {
      logId: 'default',
      level: 'debug',
      date: Date.now(),
      data: [prefix, payload]
    })
  } catch {
    // A missing host transport must not block plugin operations
  }
}

function debugError(error) {
  const knownTypes = [
    'Error',
    'TypeError',
    'SyntaxError',
    'RangeError',
    'AggregateError',
    'AbortError'
  ]
  const code = String(error?.code || '')
  return {
    errorType: knownTypes.includes(error?.name) ? error.name : 'Error',
    errorCode: /^[A-Z][A-Z0-9_]{0,39}$/.test(code) ? code : 'UNSPECIFIED',
    reason: debugFailureReason(error?.message)
  }
}

function debugFailureReason(message) {
  const text = typeof message === 'string' ? message : ''
  if (/超时|timeout|timedout/i.test(text)) return 'timeout'
  if (/取消|abort/i.test(text)) return 'cancelled'
  if (/不存在|未找到|找不到|enoent|not found/i.test(text)) return 'notFound'
  if (/权限|拒绝访问|eacces|eperm|permission/i.test(text)) return 'permission'
  if (/json|格式|版本/i.test(text)) return 'format'
  if (/网络|econn|enotfound|证书|certificate/i.test(text)) return 'network'
  if (/无效|不能为空|请输入|请选择|必须|不允许|重复|已存在|超过|invalid/i.test(text))
    return 'validation'
  return 'unspecified'
}

function startDebugTrace(event, details = {}) {
  const traceId = ++debugTraceSequence
  const startedAt = Date.now()
  debugLog(`${event}.start`, { traceId, ...details })
  const trace = (stage, extra = {}) =>
    debugLog(`${event}.${stage}`, {
      traceId,
      elapsedMs: Date.now() - startedAt,
      ...extra
    })
  trace.traceId = traceId
  return trace
}

function debugResult(result) {
  const summary = { success: result?.success !== false }
  if (!summary.success) summary.reason = debugFailureReason(result?.error)
  if (Array.isArray(result?.data)) summary.itemCount = result.data.length
  if (typeof result?.data === 'string') summary.dataCharacters = result.data.length
  for (const key of [
    'totalCount',
    'importedCount',
    'skippedCount',
    'duplicateCount',
    'invalidCount',
    'importedGroupCount',
    'importedBrowserProfileCount'
  ]) {
    if (typeof result?.[key] === 'number') summary[key] = result[key]
  }
  return summary
}

const STORAGE_KEY = 'web-quick-open-engines'
const GROUPS_STORAGE_KEY = 'web-quick-open-groups'
const BROWSER_PROFILES_STORAGE_KEY = 'web-quick-open-browser-profiles'
const FEATURE_PREFIX = 'quick-open-'
const DEFAULT_GROUP = '默认'
const ALL_GROUPS = '全部'
const ICON_SIZE = 128
const compressedIconCache = new Map()
const registeredFeatureSignatures = new Map()
const REQUEST_TIMEOUT_MS = 5000
const FAVICON_API_URL = 'https://fav.lee.cm/get.php'
const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0))
const MAX_REDIRECTS = 5
const MAX_HTML_BYTES = 256 * 1024
const MAX_ICON_BYTES = 1024 * 1024
const MAX_ICON_CANDIDATES = 8
const BUILTIN_BROWSER_PROFILES = require('./browser-presets.json')
const BUILTIN_BROWSER_ICONS = Object.fromEntries(
  ['chrome', 'edge', 'firefox', 'safari', 'ie', 'chromium'].map((key) => [
    key,
    BUILTIN_BROWSER_PROFILES.find(
      (profile) => profile.id === key || profile.id.startsWith(`${key}-`)
    )?.icon
  ])
)
const REQUEST_HEADERS = {
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
}

function getZtools() {
  if (!window.ztools) {
    throw new Error('ZTools runtime is not ready')
  }
  return window.ztools
}

function getAllEngines() {
  ensureBrowserProfileStorage()
  const value = getZtools().dbStorage.getItem(STORAGE_KEY)
  const groups = getGroups()
  const profiles = getBrowserProfiles()
  const profileIds = new Set(profiles.map((profile) => profile.id))
  return Array.isArray(value)
    ? value
        .map(normalizeEngine)
        .filter((engine) => engine.id)
        .map((engine) => ({
          ...engine,
          group: resolveGroupName(engine.group, groups),
          browserId:
            engine.browserId && engine.browserId !== 'system' && !profileIds.has(engine.browserId)
              ? null
              : engine.browserId
        }))
    : []
}
function normalizeBrowserProfile(profile) {
  if (!profile || typeof profile !== 'object') return null
  const id = typeof profile.id === 'string' ? profile.id.trim() : ''
  const name = typeof profile.name === 'string' ? profile.name.trim() : ''
  const executablePath = typeof profile.path === 'string' ? profile.path.trim() : ''
  if (!id || !name || !executablePath || name.length > 80 || executablePath.length > 4096)
    return null
  if (/[\0-\x1f]/.test(executablePath)) return null
  const args = Array.isArray(profile.args)
    ? profile.args
        .filter((argument) => typeof argument === 'string' && argument.length <= 2048)
        .slice(0, 30)
    : []
  if (args.some((argument) => argument.includes('\0'))) return null
  const platform = Array.isArray(profile.platform)
    ? profile.platform.filter((item) => ['win32', 'darwin', 'linux'].includes(item))
    : []
  return {
    id,
    name,
    icon: normalizeBrowserIcon(profile.icon),
    path: executablePath,
    args,
    builtin: profile.builtin === true,
    hidden: profile.hidden === true,
    platform
  }
}

function normalizeBrowserIcon(icon) {
  if (typeof icon !== 'string') return 'custom'
  if (Object.hasOwn(BUILTIN_BROWSER_ICONS, icon)) return BUILTIN_BROWSER_ICONS[icon]
  if (
    icon.length <= 2 * MAX_ICON_BYTES &&
    /^data:image\/(?:png|jpeg|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[a-z\d+/]+={0,2}$/i.test(
      icon
    )
  )
    return icon
  return 'custom'
}

function getBrowserProfiles() {
  const storage = getZtools().dbStorage
  const saved = storage.getItem(BROWSER_PROFILES_STORAGE_KEY)
  const profiles = Array.isArray(saved)
    ? saved.map(normalizeBrowserProfile).filter(Boolean)
    : BUILTIN_BROWSER_PROFILES.map((profile) => ({
        ...profile,
        args: [...profile.args]
      }))
  const ids = new Set(profiles.map((profile) => profile.id))
  for (const builtin of BUILTIN_BROWSER_PROFILES) {
    if (!ids.has(builtin.id)) profiles.push({ ...builtin, args: [...builtin.args] })
  }
  return profiles
}

function saveBrowserProfiles(profiles) {
  debugLog('storage.browserProfiles.write', { itemCount: profiles.length })
  getZtools().dbStorage.setItem(
    BROWSER_PROFILES_STORAGE_KEY,
    profiles.map(normalizeBrowserProfile).filter(Boolean)
  )
}

function validateBrowserProfile(profile) {
  const normalized = normalizeBrowserProfile(profile)
  if (!normalized) return { success: false, error: '浏览器配置不完整或参数无效' }
  if (normalized.name.toLowerCase() === '系统默认浏览器打开') {
    return { success: false, error: '此名称为系统保留名称' }
  }
  const profiles = getBrowserProfiles()
  if (
    profiles.some(
      (item) =>
        item.id !== normalized.id &&
        item.name.toLowerCase() === normalized.name.toLowerCase() &&
        (!item.platform.length ||
          !normalized.platform.length ||
          item.platform.some((value) => normalized.platform.includes(value)))
    )
  ) {
    return { success: false, error: '浏览器配置名称已存在' }
  }
  try {
    validateProfileTarget(normalized)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '浏览器路径无效'
    }
  }
  return { success: true, profile: normalized }
}

function findProfileForBrowser(browser, profiles) {
  const normalized = normalizeBrowser(browser)
  if (!normalized?.executablePath) return null
  const key = normalized.mode === 'new-window' ? 'newWindow' : normalized.mode
  let args = normalized.args[key] || []
  if (normalized.mode !== 'default' && args.length === 0) {
    const executable = normalized.executablePath.toLowerCase()
    if (normalized.mode === 'private') {
      if (executable.includes('chrome')) args = ['--incognito', '{url}']
      else if (executable.includes('msedge')) args = ['--inprivate', '{url}']
      else if (executable.includes('firefox')) args = ['-private-window', '{url}']
    } else if (normalized.mode === 'new-window') {
      args = ['--new-window', '{url}']
    }
  }
  if (!args.some((argument) => argument.includes('{url}'))) args = [...args, '{url}']
  const existing = profiles.find(
    (profile) =>
      profile.path.toLowerCase() === normalized.executablePath.toLowerCase() &&
      JSON.stringify(profile.args) === JSON.stringify(args)
  )
  if (existing) return existing

  const basename = normalized.executablePath.split(/[\\/]/).pop() || '浏览器'
  const profile = normalizeBrowserProfile({
    id: `custom-${generateId()}`,
    name: `自定义 - ${basename}`,
    icon: 'custom',
    path: normalized.executablePath,
    args,
    builtin: false,
    hidden: false,
    platform: []
  })
  profiles.push(profile)
  return profile
}

function ensureBrowserProfileStorage() {
  const storage = getZtools().dbStorage
  const rawProfiles = storage.getItem(BROWSER_PROFILES_STORAGE_KEY)
  const profiles = getBrowserProfiles()
  const rawEngines = storage.getItem(STORAGE_KEY)
  if (!Array.isArray(rawEngines)) {
    if (!Array.isArray(rawProfiles)) saveBrowserProfiles(profiles)
    return
  }

  let changed = !Array.isArray(rawProfiles) || profiles.length !== rawProfiles.length
  const migrated = rawEngines.map((rawEngine) => {
    if (!rawEngine || typeof rawEngine !== 'object') return rawEngine
    let browserId = typeof rawEngine.browserId === 'string' ? rawEngine.browserId : null
    if (rawEngine.browser && !browserId) {
      browserId = findProfileForBrowser(rawEngine.browser, profiles)?.id || null
      changed = true
    }
    if (rawEngine.browserId && !profiles.some((profile) => profile.id === rawEngine.browserId)) {
      browserId = null
      changed = true
    }
    if (rawEngine.browser !== undefined || rawEngine.browserId !== browserId) changed = true
    if (!changed && rawEngine.browser === undefined) return rawEngine
    const next = { ...rawEngine, browserId }
    delete next.browser
    return next
  })

  if (!changed) return
  debugLog('storage.migration.apply', {
    entryCount: rawEngines.length,
    profileCount: profiles.length
  })
  const oldProfiles = rawProfiles
  try {
    saveBrowserProfiles(profiles)
    storage.setItem(STORAGE_KEY, migrated)
    debugLog('storage.migration.complete', { entryCount: migrated.length })
  } catch (error) {
    debugLog('storage.migration.rollback', debugError(error))
    if (oldProfiles !== undefined) storage.setItem(BROWSER_PROFILES_STORAGE_KEY, oldProfiles)
    throw error
  }
}

function normalizeGroups(value) {
  if (!Array.isArray(value)) return []

  const names = []
  const seen = new Set([ALL_GROUPS.toLowerCase(), DEFAULT_GROUP.toLowerCase()])
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

function getGroups() {
  return normalizeGroups(getZtools().dbStorage.getItem(GROUPS_STORAGE_KEY))
}

function resolveGroupName(value, groups = getGroups()) {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value.trim().toLowerCase()
  return groups.find((group) => group.toLowerCase() === normalized) || null
}

function normalizeBrowser(browser) {
  if (!browser || typeof browser !== 'object') return null
  const executablePath =
    typeof browser.executablePath === 'string' ? browser.executablePath.trim() : ''

  const modes = new Set(['default', 'private', 'new-window'])
  const mode = modes.has(browser.mode) ? browser.mode : 'default'
  const modeArgs = Array.isArray(browser.args) ? { [mode]: browser.args } : browser.args || {}
  const normalizeArgs = (value) =>
    Array.isArray(value)
      ? value.filter((argument) => typeof argument === 'string').slice(0, 30)
      : []
  return {
    executablePath,
    mode,
    args: {
      default: normalizeArgs(modeArgs.default),
      private: normalizeArgs(modeArgs.private),
      newWindow: normalizeArgs(modeArgs.newWindow || modeArgs['new-window'])
    }
  }
}

function normalizeEngine(engine) {
  const type = engine && engine.type === 'search' ? 'search' : 'webpage'
  return {
    id: typeof engine?.id === 'string' ? engine.id : '',
    name: typeof engine?.name === 'string' ? engine.name.trim() : '',
    url: typeof engine?.url === 'string' ? engine.url.trim() : '',
    icon: typeof engine?.icon === 'string' ? engine.icon : '',
    enabled: typeof engine?.enabled === 'boolean' ? engine.enabled : true,
    type,
    keyword: typeof engine?.keyword === 'string' ? engine.keyword.trim() : '',
    group: typeof engine?.group === 'string' ? engine.group.trim() || null : null,
    browserId: typeof engine?.browserId === 'string' ? engine.browserId.trim() || null : null
  }
}

function compressIconToPng(icon) {
  if (!icon || !/^data:image\//i.test(icon)) return Promise.resolve(icon)

  const cached = compressedIconCache.get(icon)
  if (cached) return Promise.resolve(cached)

  if (
    typeof window.Image !== 'function' ||
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function'
  ) {
    return Promise.resolve(icon)
  }

  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () => {
      try {
        const width = image.naturalWidth || image.width
        const height = image.naturalHeight || image.height
        if (!width || !height) {
          resolve(icon)
          return
        }

        const canvas = document.createElement('canvas')
        canvas.width = ICON_SIZE
        canvas.height = ICON_SIZE
        const context = canvas.getContext('2d')
        if (!context) {
          resolve(icon)
          return
        }

        const scale = Math.min(ICON_SIZE / width, ICON_SIZE / height)
        const drawWidth = Math.max(1, Math.round(width * scale))
        const drawHeight = Math.max(1, Math.round(height * scale))
        const offsetX = Math.round((ICON_SIZE - drawWidth) / 2)
        const offsetY = Math.round((ICON_SIZE - drawHeight) / 2)

        context.clearRect(0, 0, ICON_SIZE, ICON_SIZE)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight)

        const compressed = canvas.toDataURL('image/png')
        compressedIconCache.set(icon, compressed)
        resolve(compressed)
      } catch (error) {
        debugLog('icon.compress.failed', debugError(error))
        resolve(icon)
      }
    }
    image.onerror = () => resolve(icon)
    image.src = icon
  })
}

async function saveEngines(engines) {
  const trace = startDebugTrace('storage.engines.save', { entryCount: engines.length })
  const normalized = []
  for (let index = 0; index < engines.length; index += 20) {
    await yieldToEventLoop()
    const batch = await Promise.all(
      engines.slice(index, index + 20).map(async (engine) => {
        const normalizedEngine = normalizeEngine(engine)
        return { ...normalizedEngine, icon: await compressIconToPng(normalizedEngine.icon) }
      })
    )
    normalized.push(...batch)
    trace('batch', { processedCount: normalized.length, totalCount: engines.length })
  }
  getZtools().dbStorage.setItem(STORAGE_KEY, normalized)
  trace('complete', { entryCount: normalized.length })
  return normalized
}

function validateEngine(engine, requireId, context = null) {
  const normalized = normalizeEngine(engine)
  if (requireId && !normalized.id) {
    return { success: false, error: 'ID 不能为空' }
  }
  if (!normalized.name || !normalized.url) {
    return { success: false, error: '名称和 URL 不能为空' }
  }

  if (normalized.browserId && normalized.browserId !== 'system') {
    const profile = (context?.profiles || getBrowserProfiles()).find(
      (item) => item.id === normalized.browserId
    )
    if (!profile) normalized.browserId = null
  }

  normalized.group = resolveGroupName(normalized.group, context?.groups || getGroups())

  normalized.url = ensureUrlProtocol(normalized.url)
  if (normalized.type === 'webpage') {
    if (!normalized.keyword) {
      return { success: false, error: '匹配关键字不能为空' }
    }
    if (normalized.url.includes('{q}')) {
      return { success: false, error: '网页 URL 不能包含 {q}' }
    }
    if (!isHttpUrl(normalized.url)) {
      return { success: false, error: '网页 URL 必须是有效的 http/https 地址' }
    }
  } else {
    if (!normalized.url.includes('{q}')) {
      return { success: false, error: '搜索 URL 必须包含 {q}' }
    }
    if (!isHttpUrl(normalized.url.replace('{q}', 'test'))) {
      return { success: false, error: '搜索 URL 必须是有效的 http/https 地址' }
    }
    normalized.keyword = ''
  }

  return { success: true, engine: normalized }
}

function buildFeatureCode(engineId) {
  return `${FEATURE_PREFIX}${engineId}`
}

function buildEngineFeature(engine) {
  const baseFeature = {
    code: buildFeatureCode(engine.id),
    explain: engine.name,
    icon: engine.icon || 'logo.png',
    mainHide: true
  }

  if (engine.type === 'webpage') {
    return {
      ...baseFeature,
      cmds: [engine.keyword]
    }
  }

  return {
    ...baseFeature,
    cmds: [
      {
        type: 'over',
        label: engine.name,
        minLength: 1
      }
    ]
  }
}

function getFeatureSignature(feature) {
  return JSON.stringify({
    code: feature?.code || '',
    explain: feature?.explain || '',
    icon: feature?.icon || '',
    mainHide: feature?.mainHide === true,
    cmds: Array.isArray(feature?.cmds)
      ? feature.cmds.map((command) => {
          if (typeof command === 'string') return command
          if (!command || typeof command !== 'object') return command
          return {
            type: command.type,
            label: command.label,
            minLength: command.minLength,
            maxLength: command.maxLength
          }
        })
      : []
  })
}

function getCurrentFeatureMap() {
  const getFeatures = getZtools().getFeatures
  if (typeof getFeatures !== 'function') return null

  try {
    const features = getFeatures()
    if (!Array.isArray(features)) return new Map()
    return new Map(
      features
        .filter(
          (feature) => typeof feature?.code === 'string' && feature.code.startsWith(FEATURE_PREFIX)
        )
        .map((feature) => [feature.code, feature])
    )
  } catch (error) {
    debugLog('features.read.failed', debugError(error))
    return null
  }
}

function setEngineFeature(engine, existingFeatures = null) {
  const code = buildFeatureCode(engine.id)
  if (!engine.enabled) {
    if (
      existingFeatures === null ||
      existingFeatures.has(code) ||
      registeredFeatureSignatures.has(code)
    ) {
      getZtools().removeFeature(code)
    }
    registeredFeatureSignatures.delete(code)
    return
  }

  const feature = buildEngineFeature(engine)
  const signature = JSON.stringify(feature)
  const currentFeature = existingFeatures?.get(code)
  if (
    (existingFeatures === null && registeredFeatureSignatures.get(code) === signature) ||
    (currentFeature && getFeatureSignature(currentFeature) === getFeatureSignature(feature))
  ) {
    registeredFeatureSignatures.set(code, signature)
    return
  }

  const result = getZtools().setFeature(feature)
  if (result !== false) {
    registeredFeatureSignatures.set(code, signature)
  }
}

function removeEngineFeature(engineId) {
  const code = buildFeatureCode(engineId)
  getZtools().removeFeature(code)
  registeredFeatureSignatures.delete(code)
}

function isWebUrl(value) {
  return isHttpUrl(ensureUrlProtocol(String(value || '').trim()))
}

function registerMainPush() {
  if (typeof getZtools().onMainPush !== 'function') return

  getZtools().onMainPush(
    ({ payload }) => {
      const input = String(payload || '').trim()
      if (!isWebUrl(input)) return { type: 'list', data: [] }

      const url = ensureUrlProtocol(input)
      return {
        type: 'list',
        data: [
          {
            text: '打开网址',
            title: url,
            icon: 'logo.png',
            action: 'open',
            url
          },
          {
            text: '添加网址',
            title: '添加到网页快开',
            icon: 'logo.png',
            action: 'add',
            url
          }
        ]
      }
    },
    ({ option }) => {
      if (!option || !isWebUrl(option.url)) return false
      if (option.action === 'open') {
        getZtools().shellOpenExternal(option.url)
        getZtools().hideMainWindow(false)
        return false
      }
      if (option.action === 'add') return true
      return false
    }
  )
}

async function syncImportedEngineFeatures(engines) {
  const trace = startDebugTrace('features.importSync', { entryCount: engines.length })
  const existingFeatures = getCurrentFeatureMap()
  const activeCodes = new Set()
  for (let index = 0; index < engines.length; index++) {
    if (index % 25 === 0) {
      trace('batch', { processedCount: index, totalCount: engines.length })
      await yieldToEventLoop()
    }
    const engine = engines[index]
    activeCodes.add(buildFeatureCode(engine.id))
    setEngineFeature(engine, existingFeatures)
  }
  for (const code of new Set([
    ...registeredFeatureSignatures.keys(),
    ...(existingFeatures ? existingFeatures.keys() : [])
  ])) {
    if (!activeCodes.has(code)) {
      getZtools().removeFeature(code)
      registeredFeatureSignatures.delete(code)
    }
  }
  trace('complete', { activeCount: activeCodes.size })
}

function syncEngineFeatures(engines) {
  const trace = startDebugTrace('features.sync', { entryCount: engines.length })
  const existingFeatures = getCurrentFeatureMap()
  const activeCodes = new Set()
  for (const engine of engines) {
    activeCodes.add(buildFeatureCode(engine.id))
    setEngineFeature(engine, existingFeatures)
  }

  const knownCodes = new Set([
    ...registeredFeatureSignatures.keys(),
    ...(existingFeatures ? existingFeatures.keys() : [])
  ])
  for (const code of knownCodes) {
    if (activeCodes.has(code)) continue
    getZtools().removeFeature(code)
    registeredFeatureSignatures.delete(code)
  }
  trace('complete', { activeCount: activeCodes.size })
}

function ensureUrlProtocol(url) {
  if (/^https?:\/\//i.test(url)) {
    return url
  }
  return `https://${url}`
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function buildEntryUrl(engine, query = '') {
  if (engine.type === 'search') {
    if (!query) throw new Error('缺少搜索关键词')
    return engine.url.replace('{q}', encodeURIComponent(query))
  }
  return engine.url
}

function validateExecutablePath(executablePath) {
  const value = String(executablePath || '').trim()
  if (!value) throw new Error('请输入浏览器程序路径')
  if (/[\0\r\n]/.test(value)) throw new Error('浏览器程序路径无效')
  if (/\.(bat|cmd|ps1|sh|command|js|vbs)$/i.test(value)) {
    throw new Error('不能启动脚本文件，请选择可执行程序')
  }
  const isAbsolute =
    process.platform === 'win32' ? path.win32.isAbsolute(value) : path.isAbsolute(value)
  if (!isAbsolute) {
    if (
      !/^[\w.+-]+(?:\.exe)?$/i.test(value) &&
      !(process.platform === 'darwin' && value === 'open')
    ) {
      throw new Error('相对路径只能填写程序名，请使用“选择程序”指定完整路径')
    }
    return { executablePath: value, isMacApp: false }
  }

  let stat
  try {
    stat = fs.statSync(value)
  } catch {
    throw new Error('浏览器程序不存在或无法访问')
  }
  const isMacApp = process.platform === 'darwin' && /\.app$/i.test(value) && stat.isDirectory()
  if (!stat.isFile() && !isMacApp) {
    throw new Error(
      process.platform === 'darwin' ? '请选择可执行文件或 .app 应用' : '请选择可执行文件'
    )
  }
  if (process.platform === 'win32' && !/\.exe$/i.test(value)) {
    throw new Error('Windows 浏览器必须是 .exe 文件')
  }
  return { executablePath: value, isMacApp }
}

function validateBrowserTarget(browser) {
  const executablePath = browser?.executablePath?.trim()
  if (!executablePath) throw new Error('请输入浏览器程序路径')
  const modeKey = browser.mode === 'new-window' ? 'newWindow' : browser.mode
  if (
    browser.mode !== 'default' &&
    (!browser.args?.[modeKey] || browser.args[modeKey].length === 0)
  ) {
    throw new Error('请为当前浏览器模式至少添加一个启动参数')
  }
  return validateExecutablePath(executablePath)
}

function validateProfileTarget(profile) {
  if (!profile?.path) throw new Error('请输入浏览器程序路径')
  if (!Array.isArray(profile.args) || profile.args.length > 30)
    throw new Error('启动参数最多支持 30 项')
  if (
    profile.args.some(
      (argument) =>
        typeof argument !== 'string' || argument.length > 2048 || argument.includes('\0')
    )
  ) {
    throw new Error('启动参数无效')
  }
  return validateExecutablePath(profile.path)
}

function resolveProfileExecutable(executablePath) {
  const trace = startDebugTrace('browser.resolve', { platform: process.platform })
  const target = validateExecutablePath(executablePath)
  const isAbsolute =
    process.platform === 'win32'
      ? path.win32.isAbsolute(target.executablePath)
      : path.isAbsolute(target.executablePath)
  if (process.platform !== 'win32' || isAbsolute) {
    trace('complete', { strategy: isAbsolute ? 'absolute' : 'PATH' })
    return target
  }

  const executableName = path.win32.basename(target.executablePath)
  if (!/\.exe$/i.test(executableName)) return target
  const appPathKeys = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`
  ]
  for (const [index, key] of appPathKeys.entries()) {
    trace('registryAttempt', { attempt: index + 1 })
    try {
      const output = execFileSync('reg.exe', ['query', key, '/ve'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const match = output.match(/REG_SZ\s+(.+)$/im)
      const registeredPath = match?.[1]?.trim().replace(/^"|"$/g, '')
      if (registeredPath) {
        const resolved = validateExecutablePath(registeredPath)
        trace('complete', { strategy: 'AppPaths', attempt: index + 1 })
        return resolved
      }
    } catch {
      // Continue with the next known App Paths location or PATH lookup
    }
  }
  trace('complete', { strategy: 'PATH' })
  return target
}

function buildBrowserArgs(browser, url) {
  const key = browser.mode === 'new-window' ? 'newWindow' : browser.mode
  const modeArgs = Array.isArray(browser.args) ? browser.args : browser.args[key] || []
  const args = modeArgs.map((argument) => argument.replaceAll('{url}', url))
  if (!modeArgs.some((argument) => argument.includes('{url}'))) args.push(url)
  return args
}

function buildProfileArgs(profile, url) {
  const args = profile.args.map((argument) => argument.replaceAll('{url}', url))
  if (!profile.args.some((argument) => argument.includes('{url}'))) args.push(url)
  return args
}

function spawnBrowser(executablePath, args) {
  const trace = startDebugTrace('browser.spawn', { argumentCount: args.length, shell: false })
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(executablePath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false
      })
    } catch (error) {
      trace('failed', debugError(error))
      reject(error)
      return
    }

    child.once('error', (error) => {
      trace('failed', debugError(error))
      const failure = new Error(error?.message || '无法启动浏览器')
      failure.code = error?.code
      reject(failure)
    })
    child.once('spawn', () => {
      trace('complete', { pid: child.pid || null })
      child.unref()
      resolve()
    })
  })
}

async function openUrl(url, browser = null) {
  if (!isHttpUrl(url)) throw new Error('只能打开有效的 HTTP 或 HTTPS 地址')
  if (!browser) {
    debugLog('browser.systemDefault.dispatch', { platform: process.platform })
    getZtools().shellOpenExternal(url)
    return
  }

  const normalized = normalizeBrowser(browser)
  if (!normalized) throw new Error('浏览器配置无效')
  const target = validateBrowserTarget(normalized)
  const browserArgs = buildBrowserArgs(normalized, url)

  if (target.isMacApp) {
    debugLog('browser.macApp.dispatch')
    const openArgs = ['-a', target.executablePath]
    const modeKey = normalized.mode === 'new-window' ? 'newWindow' : normalized.mode
    if (normalized.args[modeKey].length > 0) openArgs.push('--args', ...browserArgs)
    else openArgs.push(url)
    await spawnBrowser('/usr/bin/open', openArgs)
    return
  }

  await spawnBrowser(target.executablePath, browserArgs)
}

async function openProfile(url, profile) {
  if (!isHttpUrl(url)) throw new Error('只能打开有效的 HTTP 或 HTTPS 地址')
  const normalized = normalizeBrowserProfile(profile)
  if (!normalized) throw new Error('浏览器配置无效')
  validateProfileTarget(normalized)
  debugLog('browser.profile.launch', {
    platform: process.platform,
    builtin: normalized.builtin,
    argumentCount: normalized.args.length
  })
  const target = resolveProfileExecutable(normalized.path)
  const args = buildProfileArgs(normalized, url)
  if (target.isMacApp) {
    debugLog('browser.macApp.dispatch')
    const openArgs = ['-a', target.executablePath]
    openArgs.push('--args', ...args)
    await spawnBrowser('/usr/bin/open', openArgs)
    return
  }
  const aliases =
    process.platform === 'linux' && normalized.builtin
      ? {
          'google-chrome': ['google-chrome-stable'],
          chromium: ['chromium-browser'],
          'microsoft-edge': ['microsoft-edge-stable']
        }[target.executablePath] || []
      : []
  const candidates = [target.executablePath, ...aliases]
  for (let index = 0; index < candidates.length; index++) {
    try {
      await spawnBrowser(candidates[index], args)
      return
    } catch (error) {
      if (error.code !== 'ENOENT' || index === candidates.length - 1) throw error
      debugLog('browser.linux.aliasRetry', { attempt: index + 2 })
    }
  }
}

async function openEngine(engineId, query = '') {
  const engine = getAllEngines().find((item) => item.id === engineId)
  if (!engine) throw new Error('未找到网页快开入口')
  const url = buildEntryUrl(engine, query)
  if (!engine.browserId || engine.browserId === 'system') {
    await openUrl(url)
    return
  }
  const profile = getBrowserProfiles().find((item) => item.id === engine.browserId)
  if (!profile) {
    debugLog('browser.reference.fallback', { reason: 'profileMissing' })
    await openUrl(url)
    return
  }
  await openProfile(url, profile)
}

async function pickBrowserExecutable() {
  debugLog('browser.filePicker.open', { platform: process.platform })
  const ztools = getZtools()
  if (typeof ztools.showOpenDialog !== 'function') {
    return { success: false, error: '当前 ZTools 版本不支持选择程序' }
  }

  const properties = process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile']
  const options = { title: '选择浏览器程序', properties }
  if (process.platform === 'win32') {
    options.filters = [{ name: '应用程序', extensions: ['exe'] }]
  }
  const selected = await ztools.showOpenDialog(options)
  debugLog('browser.filePicker.complete', {
    selected: Array.isArray(selected) && Boolean(selected[0])
  })
  return {
    success: true,
    data: Array.isArray(selected) ? selected[0] || '' : ''
  }
}

async function fetchFavicon(url) {
  const input = String(url || '')
    .replace('{q}', 'test')
    .trim()
  if (!input || (/^[a-z][a-z\d+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input))) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 地址')
  }
  const candidateUrl = ensureUrlProtocol(input)
  const parsed = new URL(candidateUrl)
  if (!isHttpUrl(parsed.href)) {
    throw new Error('请输入有效的 HTTP 或 HTTPS 地址')
  }

  const trace = startDebugTrace('favicon.fetch', { timeoutMs: REQUEST_TIMEOUT_MS })
  const controller = new AbortController()
  const options = { signal: controller.signal, parentTraceId: trace.traceId }
  const iconRequests = new Map()
  let timer
  const requireIcon = (iconUrl, source = 'declared') => {
    if (!iconRequests.has(iconUrl)) {
      iconRequests.set(
        iconUrl,
        downloadAsDataUrl(iconUrl, { ...options, source }).then((icon) => {
          if (!icon) {
            trace('candidateFailed', { source, cancelled: controller.signal.aborted })
            throw new Error('未获取到有效图标')
          }
          trace('candidateReady', { source, dataCharacters: icon.length })
          return icon
        })
      )
    }
    return iconRequests.get(iconUrl)
  }
  const fromPage = async () => {
    const response = await requestUrl(parsed.href, {
      ...options,
      source: 'page',
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      maxBytes: MAX_HTML_BYTES,
      stopAtHead: true
    })
    const pageUrl = response.url || parsed.href
    const candidates = [new URL('/favicon.ico', pageUrl).href]
    if (response.statusCode >= 200 && response.statusCode < 300) {
      candidates.push(...extractFaviconUrls(response.body.toString('utf8'), pageUrl))
    }
    trace('pageParsed', { candidateCount: candidates.length, statusCode: response.statusCode })
    return Promise.any([...new Set(candidates)].map((candidate) => requireIcon(candidate)))
  }
  // Reuse the 1.0.3 service URL and host encoding alongside direct requests
  const faviconUrl = `${FAVICON_API_URL}?url=${encodeURIComponent(parsed.host)}`
  try {
    const icon = await Promise.race([
      Promise.any([
        fromPage(),
        requireIcon(new URL('/favicon.ico', parsed.href).href, 'root'),
        requireIcon(faviconUrl, 'service')
      ]),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          trace('timeout')
          reject(new Error('获取图标超时（整体限时 5 秒）'))
        }, REQUEST_TIMEOUT_MS)
      })
    ])
    trace('complete', { dataCharacters: icon.length, requestedCount: iconRequests.size })
    return icon
  } catch (error) {
    trace('failed', debugError(error))
    if (error instanceof AggregateError)
      throw new Error('所有图标来源均获取失败，请检查网络或上传图标')
    throw error
  } finally {
    clearTimeout(timer)
    controller.abort()
    trace('cancelRemaining', { requestedCount: iconRequests.size })
  }
}

function getContentType(headers) {
  const value = headers['content-type']
  return String(Array.isArray(value) ? value[0] : value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}

function getTagEnd(html, start) {
  let quote = ''
  for (let index = start; index < html.length; index++) {
    const character = html[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

function readTagName(html, start) {
  let index = start
  while (/\s/.test(html[index] || '')) index++
  const nameStart = index
  while (/[a-z0-9:-]/i.test(html[index] || '')) index++
  return { name: html.slice(nameStart, index).toLowerCase(), end: index }
}

function findRawTextClose(html, tagName, start) {
  const closeTag = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'ig')
  closeTag.lastIndex = start
  const match = closeTag.exec(html)
  return match ? match.index : -1
}

function findHtmlHeadEnd(html) {
  let cursor = 0

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor)
    if (tagStart === -1) return -1

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4)
      if (commentEnd === -1) return -1
      cursor = commentEnd + 3
      continue
    }

    let nameStart = tagStart + 1
    const isClosingTag = html[nameStart] === '/'
    if (isClosingTag) nameStart++

    if (html[nameStart] === '!' || html[nameStart] === '?') {
      const declarationEnd = getTagEnd(html, nameStart + 1)
      if (declarationEnd === -1) return -1
      cursor = declarationEnd + 1
      continue
    }

    const { name, end } = readTagName(html, nameStart)
    if (!name) {
      cursor = tagStart + 1
      continue
    }

    const tagEnd = getTagEnd(html, end)
    if (tagEnd === -1) return -1

    if (isClosingTag) {
      if (name === 'head') return tagEnd + 1
      cursor = tagEnd + 1
      continue
    }

    if (name === 'body') return tagStart

    if (['script', 'style', 'title', 'textarea'].includes(name)) {
      const rawTextEnd = findRawTextClose(html, name, tagEnd + 1)
      if (rawTextEnd === -1) return -1
      cursor = rawTextEnd
      continue
    }

    cursor = tagEnd + 1
  }

  return -1
}

function extractFaviconUrls(html, pageUrl) {
  if (typeof window.DOMParser !== 'function') return []

  try {
    const document = new window.DOMParser().parseFromString(html, 'text/html')
    let baseUrl = pageUrl
    const baseElement = document.querySelector('base[href]')
    const baseHref = baseElement && baseElement.getAttribute('href')
    if (baseHref) {
      try {
        baseUrl = new URL(baseHref, pageUrl).href
      } catch {
        baseUrl = pageUrl
      }
    }

    const icons = []
    for (const link of document.querySelectorAll('link[rel][href]')) {
      const relTokens = String(link.getAttribute('rel') || '')
        .toLowerCase()
        .split(/\s+/)
      let priority = Number.POSITIVE_INFINITY
      if (relTokens.includes('icon')) priority = 0
      else if (relTokens.includes('apple-touch-icon')) priority = 1
      else if (relTokens.includes('mask-icon') || relTokens.includes('fluid-icon')) priority = 2
      if (!Number.isFinite(priority)) continue

      const href = String(link.getAttribute('href') || '').trim()
      if (!href) continue

      try {
        const iconUrl = new URL(href, baseUrl)
        if (
          (iconUrl.protocol !== 'http:' && iconUrl.protocol !== 'https:') ||
          icons.some((icon) => icon.url === iconUrl.href)
        ) {
          continue
        }
        icons.push({ url: iconUrl.href, priority })
      } catch {
        continue
      }
    }

    return icons
      .sort((left, right) => left.priority - right.priority)
      .slice(0, MAX_ICON_CANDIDATES)
      .map((icon) => icon.url)
  } catch (error) {
    debugLog('favicon.parse.failed', debugError(error))
    return []
  }
}

async function requestChromiumUrl(url, options) {
  const trace = startDebugTrace('http.request', {
    transport: 'chromium',
    source: options.source || 'unspecified',
    parentTraceId: options.parentTraceId || null,
    maxBytes: options.maxBytes
  })
  let reader
  let receivedBytes = 0
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const timer = options.signal ? null : setTimeout(abort, REQUEST_TIMEOUT_MS)
  try {
    if (!isHttpUrl(url)) throw new Error('Only HTTP and HTTPS URLs are supported')
    // Use the plugin Session's network stack and proxy, without sending session cookies
    const response = await window.fetch(url, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: options.accept }
    })
    if (!isHttpUrl(response.url)) throw new Error('Unsupported redirect protocol')
    const chunks = []
    let body = Buffer.alloc(0)
    if (response.body) {
      reader = response.body.getReader()
      while (receivedBytes < options.maxBytes) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value).subarray(0, options.maxBytes - receivedBytes)
        chunks.push(chunk)
        receivedBytes += chunk.length
        body = Buffer.concat(chunks, receivedBytes)
        if (options.stopAtHead) {
          const html = body.toString('utf8')
          const headEnd = findHtmlHeadEnd(html)
          if (headEnd !== -1) {
            trace('headComplete', { byteCount: receivedBytes })
            body = body.subarray(0, Buffer.byteLength(html.slice(0, headEnd), 'utf8'))
            break
          }
        }
      }
    }
    trace('complete', { statusCode: response.status, byteCount: receivedBytes })
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      url: response.url
    }
  } catch (error) {
    trace('failed', { byteCount: receivedBytes, ...debugError(error) })
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        /* The shared timeout may already have cancelled the stream */
      }
    }
    controller.abort()
  }
}

function requestUrl(url, options, redirectCount = 0) {
  // Node transport is only for tests and environments without a browser runtime
  if (typeof window.fetch === 'function') return requestChromiumUrl(url, options)
  const trace = startDebugTrace('http.request', {
    source: options.source || 'unspecified',
    parentTraceId: options.parentTraceId || null,
    redirectCount,
    maxBytes: options.maxBytes
  })
  return new Promise((resolve, reject) => {
    const urlObject = new URL(url)
    if (urlObject.protocol !== 'http:' && urlObject.protocol !== 'https:') {
      trace('rejected', { reason: 'unsupportedProtocol' })
      reject(new Error('Only HTTP and HTTPS URLs are supported'))
      return
    }
    if (options.signal?.aborted) {
      trace('cancelled')
      reject(new Error('图标请求已取消'))
      return
    }
    const client = urlObject.protocol === 'http:' ? http : https

    const chunks = []
    let receivedBytes = 0
    let done = false

    const finish = (fn, value) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      trace(fn === reject ? 'failed' : 'complete', {
        byteCount: receivedBytes,
        statusCode: value?.statusCode || null,
        ...(fn === reject ? debugError(value) : {})
      })
      fn(value)
    }

    const timeout = options.signal
      ? null
      : setTimeout(() => {
          request.destroy()
          finish(reject, new Error('请求超时'))
        }, REQUEST_TIMEOUT_MS)

    const request = client.request(
      urlObject,
      {
        method: 'GET',
        signal: options.signal,
        headers: {
          ...REQUEST_HEADERS,
          Accept: options.accept,
          'Accept-Encoding': 'identity'
        }
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const location = Array.isArray(response.headers.location)
            ? response.headers.location[0]
            : response.headers.location
          if (!location || redirectCount >= MAX_REDIRECTS) {
            finish(reject, new Error('重定向次数过多'))
            return
          }
          trace('redirect', { statusCode: response.statusCode, redirectCount: redirectCount + 1 })
          response.resume()
          finish(resolve, requestUrl(new URL(location, url).href, options, redirectCount + 1))
          return
        }

        const finishResponse = (body) => {
          finish(resolve, {
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body,
            url: urlObject.href
          })
          response.destroy()
        }

        response.on('error', (error) => finish(reject, error))
        response.on('data', (chunk) => {
          if (done) return
          const remainingBytes = options.maxBytes - receivedBytes
          if (remainingBytes <= 0) {
            finishResponse(Buffer.concat(chunks, receivedBytes))
            return
          }

          const buffer = Buffer.from(chunk).subarray(0, remainingBytes)
          chunks.push(buffer)
          receivedBytes += buffer.length
          const body = Buffer.concat(chunks, receivedBytes)

          if (options.stopAtHead) {
            const html = body.toString('utf8')
            const headEnd = findHtmlHeadEnd(html)
            if (headEnd !== -1) {
              trace('headComplete', { byteCount: receivedBytes })
              const byteEnd = Buffer.byteLength(html.slice(0, headEnd), 'utf8')
              finishResponse(body.subarray(0, byteEnd))
              return
            }
          }

          if (receivedBytes >= options.maxBytes) {
            trace('sizeLimit', { byteCount: receivedBytes })
            finishResponse(body)
          }
        })
        response.on('end', () => {
          if (!done) finishResponse(Buffer.concat(chunks, receivedBytes))
        })
      }
    )
    request.on('error', (error) => finish(reject, error))
    request.end()
  })
}

async function downloadAsDataUrl(url, options = {}) {
  try {
    const response = await requestUrl(url, {
      ...options,
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      maxBytes: MAX_ICON_BYTES
    })

    const contentType =
      getContentType(response.headers) || guessIconContentType(response.url || url)

    if (
      response.statusCode < 200 ||
      response.statusCode >= 300 ||
      response.body.length === 0 ||
      (!contentType.startsWith('image/') && contentType !== 'application/octet-stream')
    ) {
      debugLog('favicon.imageRejected', {
        parentTraceId: options.parentTraceId || null,
        statusCode: response.statusCode,
        byteCount: response.body.length
      })
      return ''
    }

    return `data:${contentType};base64,${response.body.toString('base64')}`
  } catch (error) {
    if (!options.signal?.aborted)
      debugLog('favicon.download.failed', {
        parentTraceId: options.parentTraceId || null,
        ...debugError(error)
      })
    return ''
  }
}

function guessIconContentType(url) {
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
  if (pathname.endsWith('.webp')) return 'image/webp'
  return 'image/x-icon'
}

function validateGroupName(value, groups, replacing = null) {
  if (typeof value !== 'string') return { success: false, error: '分组名称无效' }
  const name = value.trim()
  if (!name) return { success: false, error: '分组名称不能为空' }
  if (
    [ALL_GROUPS, DEFAULT_GROUP].some((reserved) => reserved.toLowerCase() === name.toLowerCase())
  ) {
    return { success: false, error: '该名称为系统保留分组' }
  }
  if ([...name].length > 40) return { success: false, error: '分组名称不能超过 40 个字符' }

  const duplicate = groups.some(
    (group) =>
      group.toLowerCase() !== replacing?.toLowerCase() && group.toLowerCase() === name.toLowerCase()
  )
  if (duplicate) return { success: false, error: '分组名称已存在' }
  return { success: true, name }
}

function extractImportedData(raw) {
  if (Array.isArray(raw)) {
    return {
      success: true,
      engines: raw,
      groups: [],
      browserProfiles: [],
      legacy: true
    }
  }
  if (raw && typeof raw === 'object') {
    if (raw.format !== undefined) {
      if (raw.format !== 'ztools.web-quick-open') {
        return { success: false, error: '不支持的导入文件格式' }
      }
      if (raw.version !== 2) {
        return { success: false, error: '不支持的文件版本' }
      }
      if (!Array.isArray(raw.engines)) {
        return { success: false, error: '导入文件缺少入口列表' }
      }
      return {
        success: true,
        engines: raw.engines,
        groups: normalizeGroups(raw.groups),
        browserProfiles: Array.isArray(raw.browserProfiles) ? raw.browserProfiles : [],
        legacy: false
      }
    }
    if (Array.isArray(raw.data)) {
      return {
        success: true,
        engines: raw.data,
        groups: [],
        browserProfiles: [],
        legacy: true
      }
    }
    if (Array.isArray(raw.engines)) {
      return {
        success: true,
        engines: raw.engines,
        groups: [],
        browserProfiles: [],
        legacy: true
      }
    }
  }
  return {
    success: false,
    error: '文件格式不正确，需为导出的文档对象或入口数组'
  }
}

function normalizeImportedEngine(engine) {
  const fallbackType = String(engine?.url || '').includes('{q}') ? 'search' : 'webpage'
  const type = engine?.type === 'search' || engine?.type === 'webpage' ? engine.type : fallbackType
  return normalizeEngine({
    id: typeof engine?.id === 'string' ? engine.id : '',
    name: typeof engine?.name === 'string' ? engine.name : '',
    url: typeof engine?.url === 'string' ? engine.url : '',
    icon: typeof engine?.icon === 'string' ? engine.icon : '',
    enabled: typeof engine?.enabled === 'boolean' ? engine.enabled : true,
    type,
    keyword: typeof engine?.keyword === 'string' ? engine.keyword : '',
    group: typeof engine?.group === 'string' ? engine.group : null,
    browserId: typeof engine?.browserId === 'string' ? engine.browserId : null
  })
}

function buildEngineDedupKey(engine) {
  const url = ensureUrlProtocol(String(engine.url || '').trim())
  if (engine.type === 'search') {
    return `search::${url.toLowerCase()}`
  }
  const keyword = String(engine.keyword || '')
    .trim()
    .toLowerCase()
  return `webpage::${keyword}::${url.toLowerCase()}`
}

async function parseImportedJson(jsonText) {
  const trace = startDebugTrace('import.parse', { inputCharacters: jsonText.length })
  const parseError = () =>
    Object.assign(new Error('JSON 解析失败，请确认文件内容正确'), { code: 'INVALID_IMPORT_JSON' })
  const runWorker = (create, browser = false) =>
    new Promise((resolve, reject) => {
      const worker = create()
      trace('workerCreated', { strategy: browser ? 'webWorker' : 'nodeWorker' })
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          Promise.resolve(worker.terminate()).then(
            () => trace('workerTerminated'),
            (error) => trace('workerTerminationFailed', debugError(error))
          )
        } catch (error) {
          trace('workerTerminationFailed', debugError(error))
        }
        callback(value)
      }
      const timer = setTimeout(() => {
        trace('timeout')
        finish(reject, Object.assign(new Error('导入解析超时'), { code: 'IMPORT_PARSE_TIMEOUT' }))
      }, 30000)
      const receive = (result) => {
        if (result.error) finish(reject, parseError())
        else finish(resolve, result.data)
      }
      if (browser) {
        worker.onmessage = (event) => receive(event.data)
        worker.onerror = (event) => {
          event.preventDefault?.()
          finish(reject, new Error('Web Worker unavailable'))
        }
        worker.onmessageerror = () => finish(reject, new Error('Worker message unavailable'))
        try {
          worker.postMessage(jsonText)
        } catch (error) {
          finish(reject, error)
        }
      } else {
        worker.once('message', receive)
        worker.once('error', (error) => finish(reject, error))
        worker.once('exit', () => {
          if (!settled) finish(reject, new Error('Node Worker exited before returning data'))
        })
      }
    })
  const shouldFail = (error) => ['INVALID_IMPORT_JSON', 'IMPORT_PARSE_TIMEOUT'].includes(error.code)
  // Electron renderers may reject Node worker_threads even when require succeeds
  if (
    typeof window.Worker === 'function' &&
    typeof window.Blob === 'function' &&
    window.URL?.createObjectURL
  ) {
    let objectUrl
    try {
      objectUrl = window.URL.createObjectURL(
        new window.Blob(
          [
            'onmessage = function(event) { try { postMessage({ data: JSON.parse(event.data) }) } catch { postMessage({ error: true }) } }'
          ],
          { type: 'text/javascript' }
        )
      )
      const data = await runWorker(() => new window.Worker(objectUrl), true)
      trace('complete', { strategy: 'webWorker' })
      return data
    } catch (error) {
      if (shouldFail(error)) throw error
      trace('workerUnavailable', { strategy: 'webWorker', ...debugError(error) })
    } finally {
      if (objectUrl) window.URL.revokeObjectURL(objectUrl)
    }
  }
  try {
    const data = await runWorker(
      () =>
        new Worker(
          "const { parentPort, workerData } = require('node:worker_threads'); try { parentPort.postMessage({ data: JSON.parse(workerData) }) } catch { parentPort.postMessage({ error: true }) }",
          { eval: true, workerData: jsonText }
        )
    )
    trace('complete', { strategy: 'nodeWorker' })
    return data
  } catch (error) {
    if (shouldFail(error)) throw error
    trace('workerUnavailable', { strategy: 'nodeWorker', ...debugError(error) })
  }
  // Last-resort compatibility path keeps import usable when both worker APIs are disabled
  await yieldToEventLoop()
  trace('fallback', { strategy: 'localParse' })
  try {
    const data = JSON.parse(jsonText)
    trace('complete', { strategy: 'localParse' })
    return data
  } catch {
    throw parseError()
  }
}

async function importFromJsonText(jsonText) {
  const trace = startDebugTrace('import.entries', {
    inputCharacters: typeof jsonText === 'string' ? jsonText.length : 0
  })
  if (typeof jsonText !== 'string' || Buffer.byteLength(jsonText, 'utf8') > MAX_IMPORT_BYTES) {
    trace('rejected', { reason: 'invalidInputOrSize' })
    return { success: false, error: '导入文件不能超过 20 MB' }
  }
  await yieldToEventLoop()
  let parsed
  try {
    parsed = await parseImportedJson(jsonText)
  } catch (error) {
    trace('parseFailed', debugError(error))
    return { success: false, error: error.message || 'JSON 解析失败，请确认文件内容正确' }
  }

  const extracted = extractImportedData(parsed)
  if (!extracted.success) {
    trace('rejected', { reason: 'unsupportedFormat' })
    return extracted
  }

  const sourceItems = extracted.engines
  trace('formatAccepted', {
    sourceCount: sourceItems.length,
    legacy: Boolean(extracted.legacy),
    profileCount: extracted.browserProfiles.length,
    groupCount: extracted.groups.length
  })
  const existingEngines = getAllEngines()
  const originalProfiles = getBrowserProfiles()
  const profileIds = new Set(originalProfiles.map((profile) => profile.id))
  const profileIdMap = new Map()
  const importedProfiles = []
  for (const item of extracted.browserProfiles || []) {
    let profile = normalizeBrowserProfile(item)
    if (!profile || profileIdMap.has(profile.id)) continue
    const existing = originalProfiles.find((candidate) => candidate.id === profile.id)
    if (existing) {
      if (
        profile.builtin ||
        (existing.path === profile.path &&
          JSON.stringify(existing.args) === JSON.stringify(profile.args))
      ) {
        profileIdMap.set(profile.id, existing.id)
        continue
      }
      profile = { ...profile, id: `${profile.id}-${generateId()}` }
    }
    importedProfiles.push(profile)
    profileIds.add(profile.id)
    profileIdMap.set(item.id, profile.id)
  }
  const nextProfiles = [...originalProfiles, ...importedProfiles]
  const originalGroups = getGroups()
  const nextGroups = normalizeGroups([...originalGroups, ...extracted.groups])
  const nextEngines = existingEngines.slice()
  const existingKeys = new Set(existingEngines.map(buildEngineDedupKey))
  const existingIds = new Set(existingEngines.map((engine) => engine.id))
  const importedKeys = new Set()

  let importedCount = 0
  let duplicateCount = 0
  let invalidCount = 0

  let processed = 0
  for (const item of sourceItems) {
    if (processed++ % 50 === 0) {
      trace('validationBatch', {
        processedCount: processed - 1,
        totalCount: sourceItems.length,
        importedCount,
        duplicateCount,
        invalidCount
      })
      await yieldToEventLoop()
    }
    let sourceItem = item
    if (item?.browser && !item.browserId) {
      const profileCount = nextProfiles.length
      const profile = findProfileForBrowser(item.browser, nextProfiles)
      if (profile) {
        sourceItem = { ...item, browserId: profile.id }
        profileIdMap.set(profile.id, profile.id)
        if (nextProfiles.length > profileCount) {
          importedProfiles.push(profile)
          profileIds.add(profile.id)
        }
      }
    }
    const normalized = normalizeImportedEngine(sourceItem)
    normalized.browserId = normalized.browserId
      ? profileIdMap.get(normalized.browserId) ||
        (nextProfiles.some((profile) => profile.id === normalized.browserId)
          ? normalized.browserId
          : null)
      : null
    normalized.group = extracted.legacy
      ? null
      : resolveGroupName(normalized.group, extracted.groups)
    const validated = validateEngine(normalized, false, {
      profiles: nextProfiles,
      groups: nextGroups
    })
    if (!validated.success) {
      invalidCount++
      continue
    }

    const candidate = {
      ...validated.engine,
      browserId: normalized.browserId,
      group: resolveGroupName(normalized.group, nextGroups),
      id: validated.engine.id || generateId()
    }
    const dedupKey = buildEngineDedupKey(candidate)

    if (existingKeys.has(dedupKey) || importedKeys.has(dedupKey)) {
      duplicateCount++
      continue
    }

    if (existingIds.has(candidate.id)) candidate.id = generateId()
    existingIds.add(candidate.id)

    existingKeys.add(dedupKey)
    importedKeys.add(dedupKey)
    nextEngines.push(candidate)
    importedCount++
  }

  trace('validationComplete', { importedCount, duplicateCount, invalidCount })
  const addedGroups = nextGroups.length - originalGroups.length
  const oldEngineValue = getZtools().dbStorage.getItem(STORAGE_KEY)
  const oldProfileValue = getZtools().dbStorage.getItem(BROWSER_PROFILES_STORAGE_KEY)
  const oldGroupValue = getZtools().dbStorage.getItem(GROUPS_STORAGE_KEY)
  try {
    if (importedCount > 0 || importedProfiles.length > 0) {
      const savedEngines = importedCount > 0 ? await saveEngines(nextEngines) : existingEngines
      saveBrowserProfiles(nextProfiles)
      getZtools().dbStorage.setItem(GROUPS_STORAGE_KEY, nextGroups)
      await syncImportedEngineFeatures(savedEngines)
    } else if (addedGroups > 0) {
      getZtools().dbStorage.setItem(GROUPS_STORAGE_KEY, nextGroups)
    }
  } catch (error) {
    trace('rollback', debugError(error))
    if (oldEngineValue !== undefined) getZtools().dbStorage.setItem(STORAGE_KEY, oldEngineValue)
    if (oldProfileValue !== undefined)
      getZtools().dbStorage.setItem(BROWSER_PROFILES_STORAGE_KEY, oldProfileValue)
    if (oldGroupValue !== undefined)
      getZtools().dbStorage.setItem(GROUPS_STORAGE_KEY, oldGroupValue)
    throw error
  }

  trace('complete', {
    importedCount,
    duplicateCount,
    invalidCount,
    importedGroupCount: addedGroups,
    importedBrowserProfileCount: importedProfiles.length
  })
  return {
    success: true,
    totalCount: sourceItems.length,
    importedCount,
    importedGroupCount: addedGroups,
    importedBrowserProfileCount: importedProfiles.length,
    duplicateCount,
    invalidCount,
    skippedCount: duplicateCount + invalidCount
  }
}

registerMainPush()

window.webQuickOpen = {
  writeDebugLog(event, details = {}) {
    if (typeof event !== 'string' || !/^[a-z][a-z\d.]{0,79}$/i.test(event)) return
    const safe = {}
    for (const [key, value] of Object.entries(details || {})) {
      if (
        ![
          'type',
          'entryCount',
          'groupCount',
          'profileCount',
          'byteCount',
          'inputCharacters',
          'editor',
          'browserManager',
          'browserProfileDialog',
          'errorCode'
        ].includes(key)
      )
        continue
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
        safe[key] = value
      if (key === 'type' && ['success', 'error', 'info'].includes(value)) safe[key] = value
      if (
        key === 'errorCode' &&
        [
          'ENOENT',
          'EACCES',
          'EPERM',
          'ECONNREFUSED',
          'ETIMEDOUT',
          'ENOTFOUND',
          'UNSPECIFIED'
        ].includes(value)
      )
        safe[key] = value
    }
    debugLog(event, safe, 'ui')
  },
  async fetchBrowserIcon(profile) {
    const trace = startDebugTrace('browser.icon', { platform: process.platform, timeoutMs: 2000 })
    try {
      const icon = await getBrowserIcon(profile, { trace })
      trace('complete', { dataCharacters: icon.length })
      return { success: true, data: icon }
    } catch (error) {
      trace('failed', debugError(error))
      return {
        success: false,
        error: /超时/.test(error.message) ? error.message : '未能获取程序图标，请检查路径或上传图片'
      }
    }
  },
  async getAll() {
    const engines = getAllEngines()
    return { success: true, data: engines }
  },
  async getBrowserProfiles(includeUnsupported = false) {
    const profiles = getBrowserProfiles()
    return {
      success: true,
      data: includeUnsupported
        ? profiles
        : profiles.filter(
            (profile) => !profile.platform.length || profile.platform.includes(process.platform)
          )
    }
  },
  async saveBrowserProfile(profile) {
    const validated = validateBrowserProfile(profile)
    if (!validated.success) return validated
    const profiles = getBrowserProfiles()
    const index = profiles.findIndex((item) => item.id === validated.profile.id)
    if (index >= 0 && profiles[index].builtin) {
      profiles[index] = {
        ...profiles[index],
        ...validated.profile,
        builtin: true
      }
    } else if (index >= 0) {
      profiles[index] = validated.profile
    } else {
      profiles.push({ ...validated.profile, builtin: false })
    }
    saveBrowserProfiles(profiles)
    return { success: true, data: getBrowserProfiles() }
  },
  async deleteBrowserProfile(profileId) {
    const profiles = getBrowserProfiles()
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return { success: false, error: '未找到浏览器配置' }
    if (profile.builtin) {
      profile.hidden = true
      saveBrowserProfiles(profiles)
    } else {
      saveBrowserProfiles(profiles.filter((item) => item.id !== profileId))
    }
    const engines = getAllEngines()
    const nextEngines = engines.map((engine) =>
      engine.browserId === profileId ? { ...engine, browserId: null } : engine
    )
    await saveEngines(nextEngines)
    syncEngineFeatures(nextEngines)
    return { success: true, data: getBrowserProfiles() }
  },
  async toggleBrowserProfileHidden(profileId) {
    const profiles = getBrowserProfiles()
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return { success: false, error: '未找到浏览器配置' }
    profile.hidden = !profile.hidden
    saveBrowserProfiles(profiles)
    return { success: true, data: getBrowserProfiles() }
  },
  async resetBrowserProfiles() {
    const custom = getBrowserProfiles().filter((profile) => !profile.builtin)
    saveBrowserProfiles([
      ...BUILTIN_BROWSER_PROFILES.map((profile) => ({
        ...profile,
        args: [...profile.args]
      })),
      ...custom
    ])
    return { success: true, data: getBrowserProfiles() }
  },
  async getGroups() {
    return { success: true, data: getGroups() }
  },
  async createGroup(name) {
    const groups = getGroups()
    const validated = validateGroupName(name, groups)
    if (!validated.success) return validated
    groups.push(validated.name)
    getZtools().dbStorage.setItem(GROUPS_STORAGE_KEY, groups)
    return { success: true, data: groups }
  },
  async renameGroup(oldName, newName) {
    const groups = getGroups()
    const existing = groups.find(
      (group) =>
        group.toLowerCase() ===
        String(oldName || '')
          .trim()
          .toLowerCase()
    )
    if (!existing) return { success: false, error: '未找到该分组' }
    const validated = validateGroupName(newName, groups, existing)
    if (!validated.success) return validated

    const engines = getAllEngines()
    const nextEngines = engines.map((engine) =>
      engine.group?.toLowerCase() === existing.toLowerCase()
        ? { ...engine, group: validated.name }
        : engine
    )
    const nextGroups = groups.map((group) => (group === existing ? validated.name : group))
    const storage = getZtools().dbStorage
    const oldEngineValue = storage.getItem(STORAGE_KEY)
    try {
      storage.setItem(STORAGE_KEY, nextEngines)
      storage.setItem(GROUPS_STORAGE_KEY, nextGroups)
    } catch (error) {
      storage.setItem(STORAGE_KEY, oldEngineValue || [])
      storage.setItem(GROUPS_STORAGE_KEY, groups)
      throw error
    }
    return { success: true, data: nextGroups }
  },
  async deleteGroup(name) {
    const groups = getGroups()
    const existing = groups.find(
      (group) =>
        group.toLowerCase() ===
        String(name || '')
          .trim()
          .toLowerCase()
    )
    if (!existing) return { success: false, error: '未找到该分组' }

    const engines = getAllEngines()
    const nextEngines = engines.map((engine) =>
      engine.group?.toLowerCase() === existing.toLowerCase() ? { ...engine, group: null } : engine
    )
    const nextGroups = groups.filter((group) => group !== existing)
    const storage = getZtools().dbStorage
    const oldEngineValue = storage.getItem(STORAGE_KEY)
    try {
      storage.setItem(STORAGE_KEY, nextEngines)
      storage.setItem(GROUPS_STORAGE_KEY, nextGroups)
    } catch (error) {
      storage.setItem(STORAGE_KEY, oldEngineValue || [])
      storage.setItem(GROUPS_STORAGE_KEY, groups)
      throw error
    }
    return { success: true, data: nextGroups }
  },
  async add(engine) {
    const validated = validateEngine(engine, false)
    if (!validated.success) return validated
    const nextEngine = {
      ...validated.engine,
      id: validated.engine.id || generateId()
    }
    const engines = getAllEngines()
    if (engines.some((item) => item.id === nextEngine.id)) {
      return { success: false, error: '入口 ID 已存在' }
    }
    engines.push(nextEngine)
    const savedEngines = await saveEngines(engines)
    setEngineFeature(savedEngines.find((item) => item.id === nextEngine.id) || nextEngine)
    return { success: true }
  },
  async update(engine) {
    const validated = validateEngine(engine, true)
    if (!validated.success) return validated
    const engines = getAllEngines()
    const index = engines.findIndex((item) => item.id === validated.engine.id)
    if (index === -1) {
      return { success: false, error: '未找到该入口' }
    }
    engines[index] = validated.engine
    const savedEngines = await saveEngines(engines)
    setEngineFeature(savedEngines[index] || validated.engine)
    return { success: true }
  },
  async delete(engineId) {
    const engines = getAllEngines()
    const nextEngines = engines.filter((item) => item.id !== engineId)
    if (nextEngines.length === engines.length) {
      return { success: false, error: '未找到该入口' }
    }
    await saveEngines(nextEngines)
    removeEngineFeature(engineId)
    return { success: true }
  },
  async fetchFavicon(url) {
    try {
      return { success: true, data: await fetchFavicon(url) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '获取图标失败'
      }
    }
  },
  async importFromJsonText(jsonText) {
    try {
      return await importFromJsonText(jsonText)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导入失败'
      }
    }
  },
  async exportJson() {
    try {
      const engines = getAllEngines().map((engine) => ({
        id: engine.id,
        name: engine.name,
        url: engine.url,
        icon: engine.icon,
        enabled: engine.enabled,
        type: engine.type,
        keyword: engine.keyword,
        group: engine.group,
        browserId: engine.browserId
      }))
      return {
        success: true,
        data: JSON.stringify(
          {
            format: 'ztools.web-quick-open',
            version: 2,
            exportedAt: new Date().toISOString(),
            groups: getGroups(),
            browserProfiles: getBrowserProfiles(),
            engines
          },
          null,
          2
        )
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导出失败'
      }
    }
  },
  async pickBrowserExecutable() {
    try {
      return await pickBrowserExecutable()
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '选择浏览器失败'
      }
    }
  },
  async testBrowserProfile(url, profile) {
    try {
      await openProfile(url, profile)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '浏览器启动失败'
      }
    }
  },
  async testOpen(url, browser) {
    try {
      if (!normalizeBrowser(browser)) throw new Error('请先配置浏览器程序路径')
      await openUrl(url, browser)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '启动浏览器失败'
      }
    }
  },
  async openEngine(engineId, query = '') {
    try {
      await openEngine(engineId, query)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '启动浏览器失败'
      }
    }
  },
  openExternal(url) {
    return getZtools().shellOpenExternal(url)
  },
  hideMainWindow() {
    return getZtools().hideMainWindow(false)
  },
  outPlugin() {
    return getZtools().outPlugin(false)
  }
}

// Keep synchronous APIs synchronous and preserve existing Promise results
for (const [name, operation] of Object.entries(window.webQuickOpen)) {
  if (name === 'writeDebugLog') continue
  window.webQuickOpen[name] = function (...args) {
    const trace = startDebugTrace(`api.${name}`, { argumentCount: args.length })
    const complete = (result) => {
      trace(result?.success === false ? 'failed' : 'complete', debugResult(result))
      return result
    }
    const failed = (error) => {
      trace('failed', debugError(error))
      throw error
    }
    return debugContext.run({ operationId: trace.traceId }, () => {
      try {
        const result = operation.apply(this, args)
        return result && typeof result.then === 'function'
          ? result.then(complete, failed)
          : complete(result)
      } catch (error) {
        return failed(error)
      }
    })
  }
}

// Register persisted dynamic features once when the preload context starts.
debugLog('runtime.initialize', {
  platform: typeof process === 'undefined' ? 'unknown' : process.platform,
  presetCount: BUILTIN_BROWSER_PROFILES.length
})
syncEngineFeatures(getAllEngines())
debugLog('runtime.ready')
