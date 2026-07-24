const http = require('node:http')
const https = require('node:https')
const electron = require('electron')
const { ipcRenderer } = electron
const electronScreen = electron.screen

const STORAGE_KEY = 'sub2api-usage-config'
const REQUEST_TIMEOUT_MS = 15000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const DEFAULT_CONFIG = {
  baseUrl: '',
  authorization: '',
  refreshToken: '',
  apiKeys: [{ id: 1418, alias: '默认 Key' }],
  autoRefreshSeconds: 60
}

let floatingWindow = null
const FLOATING_PEEK_SIZE = 16
const FLOATING_DOCK_HOVER_DELAY_MS = 200
const FLOATING_DOCK_WATCH_INTERVAL_MS = 80
const FLOATING_DOCK_HIT_PADDING = 8
const FLOATING_DOCK_ANIMATION_MS = 260
let floatingDockState = null
let floatingDockWatchTimer = null
let floatingDockHoverStartedAt = 0
let floatingAnimationId = 0

function getZtools() {
  if (!window.ztools) {
    throw new Error('ZTools runtime is not ready')
  }
  return window.ztools
}

function ok(data) {
  return { success: true, data }
}

function fail(error) {
  return { success: false, error: error instanceof Error ? error.message : String(error || '操作失败') }
}

function normalizeConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const apiKeys = Array.isArray(source.apiKeys)
    ? source.apiKeys
        .map((item) => ({
          id: Number(item && item.id),
          alias: typeof item?.alias === 'string' ? item.alias.trim() : ''
        }))
        .filter((item) => Number.isInteger(item.id) && item.id > 0)
    : []

  return {
    baseUrl: typeof source.baseUrl === 'string' && source.baseUrl.trim() ? source.baseUrl.trim() : DEFAULT_CONFIG.baseUrl,
    authorization:
      typeof source.authorization === 'string' && source.authorization.trim()
        ? source.authorization.trim()
        : DEFAULT_CONFIG.authorization,
    refreshToken:
      typeof source.refreshToken === 'string' && source.refreshToken.trim()
        ? source.refreshToken.trim()
        : DEFAULT_CONFIG.refreshToken,
    apiKeys: apiKeys.length ? apiKeys : DEFAULT_CONFIG.apiKeys,
    autoRefreshSeconds: normalizeRefreshSeconds(source.autoRefreshSeconds)
  }
}

function normalizeRefreshSeconds(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return DEFAULT_CONFIG.autoRefreshSeconds
  return Math.max(15, Math.min(3600, Math.round(seconds)))
}

function validateConfig(config) {
  const normalized = normalizeConfig(config)
  let parsedUrl

  try {
    parsedUrl = new URL(ensureProtocol(normalized.baseUrl))
  } catch {
    return { success: false, error: '域名必须是有效的 http/https 地址' }
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { success: false, error: '域名只支持 http 或 https' }
  }

  if (!normalized.authorization) {
    return { success: false, error: 'authorization 不能为空' }
  }

  const seenIds = new Set()
  normalized.apiKeys = normalized.apiKeys.map((item) => {
    const id = Number(item.id)
    if (seenIds.has(id)) {
      throw new Error(`api_key_id ${id} 重复`)
    }
    seenIds.add(id)
    return {
      id,
      alias: item.alias || `API Key ${id}`
    }
  })
  normalized.baseUrl = parsedUrl.origin

  return { success: true, config: normalized }
}

function ensureProtocol(url) {
  if (/^https?:\/\//i.test(url)) return url
  return `https://${url}`
}

function getConfig() {
  const saved = getZtools().dbStorage?.getItem(STORAGE_KEY)
  return normalizeConfig(saved)
}

function saveConfig(config) {
  const result = validateConfig(config)
  if (!result.success) return result
  getZtools().dbStorage?.setItem(STORAGE_KEY, result.config)
  return ok(result.config)
}

class HttpStatusError extends Error {
  constructor(statusCode, response) {
    super(extractErrorMessage(response) || `请求失败：HTTP ${statusCode}`)
    this.name = 'HttpStatusError'
    this.statusCode = statusCode
    this.response = response
  }
}

function requestJson(url, payload, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const client = target.protocol === 'http:' ? http : https
    const body = JSON.stringify(payload)
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh',
      'Content-Type': 'application/json',
      Origin: target.origin,
      Referer: `${target.origin}/keys`,
      'Content-Length': Buffer.byteLength(body),
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Encoding': 'identity',
      ...(options.headers || {})
    }
    const chunks = []
    let receivedBytes = 0
    let done = false
    let timer = null

    const finish = (fn, value) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      fn(value)
    }

    const request = client.request(
      target,
      {
        method: 'POST',
        headers
      },
      (response) => {
        response.on('error', (error) => finish(reject, error))
        response.on('data', (chunk) => {
          const buffer = Buffer.from(chunk)
          chunks.push(buffer)
          receivedBytes += buffer.length
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            request.destroy()
            finish(reject, new Error('响应过大'))
          }
        })
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            finish(reject, new Error(text || '响应不是有效 JSON'))
            return
          }

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            finish(reject, new HttpStatusError(response.statusCode || 0, json))
            return
          }

          finish(resolve, json)
        })
      }
    )

    timer = setTimeout(() => {
      request.destroy()
      finish(reject, new Error('请求超时'))
    }, REQUEST_TIMEOUT_MS)

    request.on('error', (error) => finish(reject, error))
    request.write(body)
    request.end()
  })
}

function extractErrorMessage(value) {
  if (!value || typeof value !== 'object') return ''
  return value.message || value.error || value.msg || value.detail || ''
}

async function fetchUsage() {
  try {
    const configResult = validateConfig(getConfig())
    if (!configResult.success) return configResult

    const config = configResult.config
    const result = await requestUsage(config)
    const payload = normalizeUsageResponse(result.raw, result.config.apiKeys)
    payload.authUpdated = result.authUpdated
    payload.config = result.config
    return ok(payload)
  } catch (error) {
    return fail(error)
  }
}

async function refreshAuthToken() {
  try {
    const configResult = validateConfig(getConfig())
    if (!configResult.success) return configResult
    if (!configResult.config.refreshToken) {
      return { success: false, error: 'refresh_token 不能为空' }
    }

    return ok(await refreshAuthTokens(configResult.config))
  } catch (error) {
    return fail(error)
  }
}

async function requestUsage(config) {
  const url = `${config.baseUrl}/api/v1/usage/dashboard/api-keys-usage`

  try {
    const raw = await requestJson(url, buildUsagePayload(config), {
      headers: { Authorization: normalizeAuthorization(config.authorization) }
    })
    return { raw, config, authUpdated: false }
  } catch (error) {
    if (!(error instanceof HttpStatusError) || error.statusCode !== 401 || !config.refreshToken) {
      throw error
    }

    const refreshedConfig = await refreshAuthTokens(config)
    const raw = await requestJson(url, buildUsagePayload(refreshedConfig), {
      headers: { Authorization: normalizeAuthorization(refreshedConfig.authorization) }
    })
    return { raw, config: refreshedConfig, authUpdated: true }
  }
}

function buildUsagePayload(config) {
  return { api_key_ids: config.apiKeys.map((item) => item.id) }
}

async function refreshAuthTokens(config) {
  const url = `${config.baseUrl}/api/v1/auth/refresh`
  const raw = await requestJson(url, { refresh_token: config.refreshToken })
  const data = raw && typeof raw === 'object' ? raw.data : null
  const accessToken = data && typeof data.access_token === 'string' ? data.access_token.trim() : ''
  const refreshToken = data && typeof data.refresh_token === 'string' ? data.refresh_token.trim() : ''
  const tokenType = data && typeof data.token_type === 'string' && data.token_type.trim() ? data.token_type.trim() : 'Bearer'

  if (!accessToken || !refreshToken) {
    throw new Error('刷新 token 失败：响应缺少 access_token 或 refresh_token')
  }

  const nextConfig = {
    ...config,
    authorization: `${tokenType} ${accessToken}`,
    refreshToken
  }
  getZtools().dbStorage?.setItem(STORAGE_KEY, nextConfig)
  return nextConfig
}

function normalizeAuthorization(value) {
  const token = String(value || '').trim()
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`
}

function normalizeUsageResponse(raw, apiKeys) {
  const rows = extractRows(raw)
  const byId = new Map()

  for (const row of rows) {
    const id = extractId(row)
    if (id) byId.set(id, row)
  }

  if (!byId.size) {
    for (const row of findUsageRowsByConfiguredIds(raw, apiKeys)) {
      const id = extractId(row)
      if (id) byId.set(id, row)
    }
  }

  const records = apiKeys.map((apiKey) => {
    const row = byId.get(apiKey.id) || {}
    return normalizeUsageRecord(apiKey, row)
  })

  return {
    records,
    summary: records.reduce(
      (summary, record) => ({
        tokens: summary.tokens + record.tokens,
        inputTokens: summary.inputTokens + record.inputTokens,
        outputTokens: summary.outputTokens + record.outputTokens,
        cachedTokens: summary.cachedTokens + record.cachedTokens,
        requests: summary.requests + record.requests,
        todayCost: summary.todayCost + record.todayCost,
        cost: summary.cost + record.cost
      }),
      { tokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0, todayCost: 0, cost: 0 }
    ),
    fetchedAt: new Date().toISOString(),
    raw
  }
}

function extractRows(raw) {
  if (Array.isArray(raw)) return raw.filter(isObject)
  if (!isObject(raw)) return []

  const candidates = [
    raw.data,
    raw.data?.stats,
    raw.data?.api_keys_usage,
    raw.data?.apiKeysUsage,
    raw.data?.items,
    raw.data?.list,
    raw.data?.rows,
    raw.data?.api_keys,
    raw.data?.apiKeys,
    raw.api_keys_usage,
    raw.apiKeysUsage,
    raw.stats,
    raw.items,
    raw.list,
    raw.rows,
    raw.api_keys,
    raw.apiKeys
  ]

  const firstArray = candidates.find(Array.isArray)
  if (Array.isArray(firstArray)) return firstArray.filter(isObject)

  const firstObject = candidates.find(isUsageMapObject) || candidates.find(isObject)
  if (!firstObject) return []

  return Object.entries(firstObject)
    .map(([key, value]) => {
      if (!isObject(value)) return null
      if (extractId(value)) return value
      const numericKey = Number(key)
      return Number.isInteger(numericKey) ? { ...value, api_key_id: numericKey } : value
    })
    .filter(isObject)
}

function isUsageMapObject(value) {
  if (!isObject(value)) return false
  return Object.entries(value).some(([key, child]) => {
    const numericKey = Number(key)
    return isObject(child) && (extractId(child) || Number.isInteger(numericKey))
  })
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extractId(row) {
  return toNumber(row.api_key_id ?? row.apiKeyId ?? row.api_key?.id ?? row.apiKey?.id ?? row.id)
}

function normalizeUsageRecord(apiKey, row) {
  const tokens =
    firstNumber(row, [
      'tokens',
      'total_tokens',
      'totalTokens',
      'usage',
      'token_usage',
      'tokenUsage',
      'used_tokens',
      'usedTokens'
    ]) || sumNumbersByKeyPattern(row, /(^|_)(total_)?tokens?$|totalTokens|tokenUsage|usedTokens/i)
  const inputTokens =
    firstNumber(row, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens']) ||
    sumNumbersByKeyPattern(row, /inputTokens|input_tokens|promptTokens|prompt_tokens/i)
  const outputTokens =
    firstNumber(row, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens']) ||
    sumNumbersByKeyPattern(row, /outputTokens|output_tokens|completionTokens|completion_tokens/i)
  const cachedTokens =
    firstNumber(row, ['cached_tokens', 'cachedTokens', 'cache_read_input_tokens', 'cacheReadInputTokens']) ||
    sumNumbersByKeyPattern(row, /cachedTokens|cached_tokens|cacheReadInputTokens|cache_read_input_tokens/i)
  const requests =
    firstNumber(row, ['requests', 'request_count', 'requestCount', 'count']) ||
    sumNumbersByKeyPattern(row, /requestCount|request_count|requests$/i)
  const todayCost =
    firstNumber(row, ['today_actual_cost', 'todayActualCost', 'today_cost', 'todayCost']) ||
    sumNumbersByKeyPattern(row, /todayActualCost|today_actual_cost|todayCost|today_cost/i)
  const cost =
    firstNumber(row, ['total_actual_cost', 'totalActualCost', 'cost', 'amount', 'total_cost', 'totalCost']) ||
    sumNumbersByKeyPattern(row, /totalActualCost|total_actual_cost|totalCost|total_cost|^cost$|^amount$/i)

  return {
    id: apiKey.id,
    alias: apiKey.alias || `API Key ${apiKey.id}`,
    tokens: tokens || inputTokens + outputTokens + cachedTokens,
    inputTokens,
    outputTokens,
    cachedTokens,
    requests,
    todayCost,
    cost,
    raw: row
  }
}

function firstNumber(row, keys) {
  for (const key of keys) {
    const directValue = toNumber(row?.[key])
    if (directValue !== 0) return directValue

    const nestedValue = findFirstNumberByKey(row, key)
    if (nestedValue !== 0) return nestedValue
  }
  return 0
}

function findFirstNumberByKey(value, key, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return 0
  seen.add(value)

  if (Object.prototype.hasOwnProperty.call(value, key)) {
    const number = toNumber(value[key])
    if (number !== 0) return number
  }

  const entries = Array.isArray(value) ? value : Object.values(value)
  for (const child of entries) {
    const number = findFirstNumberByKey(child, key, seen)
    if (number !== 0) return number
  }

  return 0
}

function sumNumbersByKeyPattern(value, pattern, seen = new Set(), parentKey = '') {
  if (!value || typeof value !== 'object' || seen.has(value)) return 0
  seen.add(value)

  let total = 0
  for (const [key, child] of Object.entries(value)) {
    const scopedKey = parentKey ? `${parentKey}.${key}` : key
    if (typeof child === 'number' || typeof child === 'string') {
      if (pattern.test(key) || pattern.test(scopedKey)) {
        total += toNumber(child)
      }
      continue
    }
    total += sumNumbersByKeyPattern(child, pattern, seen, scopedKey)
  }

  return total
}

function findUsageRowsByConfiguredIds(raw, apiKeys) {
  const wantedIds = new Set(apiKeys.map((item) => item.id))
  const rows = []
  collectRowsWithWantedIds(raw, wantedIds, rows)
  return rows
}

function collectRowsWithWantedIds(value, wantedIds, rows, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)

  if (isObject(value) && wantedIds.has(extractId(value))) {
    rows.push(value)
  }

  for (const child of Object.values(value)) {
    collectRowsWithWantedIds(child, wantedIds, rows, seen)
  }
}

function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function getFloatingUrl() {
  const current = new URL(window.location.href)
  current.searchParams.set('floating', '1')
  return current.href
}

function getDisplayForBounds(bounds) {
  const ztools = getZtools()
  const center = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  }
  if (typeof ztools.getDisplayNearestPoint === 'function') {
    return ztools.getDisplayNearestPoint(center)
  }
  if (typeof ztools.getPrimaryDisplay === 'function') {
    return ztools.getPrimaryDisplay()
  }
  return null
}

function getDisplayAreasForBounds(bounds) {
  const display = getDisplayForBounds(bounds)
  const displayBounds = normalizeArea(display?.bounds || display?.workArea || display?.size)
  const workArea = normalizeArea(display?.workArea || display?.bounds || display?.size)
  return { displayBounds, workArea }
}

function normalizeArea(area) {
  if (!area) {
    return { x: 0, y: 0, width: 1440, height: 900 }
  }
  return {
    x: Number(area.x) || 0,
    y: Number(area.y) || 0,
    width: Number(area.width) || 1440,
    height: Number(area.height) || 900
  }
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function isMacOS() {
  return /mac/i.test(navigator.userAgent || '')
}

function dockFloatingWindow() {
  try {
    if (!floatingWindow || typeof floatingWindow.getBounds !== 'function') {
      return { success: false, error: '悬浮小窗未打开' }
    }

    const bounds = floatingWindow.getBounds()
    const { displayBounds, workArea } = getDisplayAreasForBounds(bounds)
    const centerX = bounds.x + bounds.width / 2
    const side = centerX < workArea.x + workArea.width / 2 ? 'left' : 'right'
    const y = clampNumber(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height)
    const expandedBounds = buildExpandedBounds({ ...bounds, y }, workArea, side)
    floatingDockState = {
      side,
      mode: 'collapsed',
      expandedBounds,
      collapsedBounds: buildCollapsedBounds(expandedBounds, displayBounds, side)
    }
    animateFloatingWindowTo(floatingDockState.collapsedBounds)
    startDockWatcher()
    return ok(true)
  } catch (error) {
    return fail(error)
  }
}

function buildExpandedBounds(bounds, area, side) {
  return {
    ...bounds,
    x: side === 'left' ? area.x : area.x + area.width - bounds.width,
    y: clampNumber(bounds.y, area.y, area.y + area.height - bounds.height)
  }
}

function buildCollapsedBounds(bounds, area, side) {
  return {
    ...bounds,
    x: side === 'left' ? area.x - bounds.width + FLOATING_PEEK_SIZE : area.x + area.width - FLOATING_PEEK_SIZE
  }
}

function buildCollapsedHoverBounds(state) {
  const bounds = state.collapsedBounds
  if (state.side === 'left') {
    return {
      x: bounds.x + bounds.width - FLOATING_PEEK_SIZE - FLOATING_DOCK_HIT_PADDING,
      y: bounds.y - FLOATING_DOCK_HIT_PADDING,
      width: FLOATING_PEEK_SIZE + FLOATING_DOCK_HIT_PADDING * 2,
      height: bounds.height + FLOATING_DOCK_HIT_PADDING * 2
    }
  }

  return {
    x: bounds.x - FLOATING_DOCK_HIT_PADDING,
    y: bounds.y - FLOATING_DOCK_HIT_PADDING,
    width: FLOATING_PEEK_SIZE + FLOATING_DOCK_HIT_PADDING * 2,
    height: bounds.height + FLOATING_DOCK_HIT_PADDING * 2
  }
}

function expandDockedFloatingWindow() {
  try {
    if (!floatingWindow || !floatingDockState) return ok(false)
    floatingDockState.mode = 'expanded'
    animateFloatingWindowTo(floatingDockState.expandedBounds)
    return ok(true)
  } catch (error) {
    return fail(error)
  }
}

function collapseDockedFloatingWindow() {
  try {
    if (!floatingWindow || !floatingDockState) return ok(false)
    const bounds = floatingWindow.getBounds()
    const { displayBounds, workArea } = getDisplayAreasForBounds(bounds)
    floatingDockState.expandedBounds = buildExpandedBounds(bounds, workArea, floatingDockState.side)
    floatingDockState.collapsedBounds = buildCollapsedBounds(floatingDockState.expandedBounds, displayBounds, floatingDockState.side)
    floatingDockState.mode = 'collapsed'
    animateFloatingWindowTo(floatingDockState.collapsedBounds)
    return ok(true)
  } catch (error) {
    return fail(error)
  }
}

function startDockWatcher() {
  stopDockWatcher()
  floatingDockWatchTimer = setInterval(watchDockHover, FLOATING_DOCK_WATCH_INTERVAL_MS)
}

function stopDockWatcher() {
  if (floatingDockWatchTimer) {
    clearInterval(floatingDockWatchTimer)
    floatingDockWatchTimer = null
  }
  floatingDockHoverStartedAt = 0
}

function watchDockHover() {
  if (!floatingWindow || !floatingDockState) {
    stopDockWatcher()
    return
  }

  const point = getCursorPoint()
  if (!point) return

  if (floatingDockState.mode === 'collapsed') {
    if (isPointInBounds(point, buildCollapsedHoverBounds(floatingDockState))) {
      if (!floatingDockHoverStartedAt) {
        floatingDockHoverStartedAt = Date.now()
      } else if (Date.now() - floatingDockHoverStartedAt >= FLOATING_DOCK_HOVER_DELAY_MS) {
        expandDockedFloatingWindow()
      }
    } else {
      floatingDockHoverStartedAt = 0
    }
    return
  }

  const bounds = floatingWindow.getBounds()
  const paddedBounds = {
    x: bounds.x - 2,
    y: bounds.y - 2,
    width: bounds.width + 4,
    height: bounds.height + 4
  }
  if (!isPointInBounds(point, paddedBounds)) {
    floatingDockHoverStartedAt = 0
    collapseDockedFloatingWindow()
  }
}

function getCursorPoint() {
  try {
    const ztools = getZtools()
    if (typeof ztools.getCursorScreenPoint === 'function') {
      return ztools.getCursorScreenPoint()
    }
  } catch {
    // Fall through to Electron when available.
  }

  try {
    return typeof electronScreen?.getCursorScreenPoint === 'function' ? electronScreen.getCursorScreenPoint() : null
  } catch {
    return null
  }
}

function isPointInBounds(point, bounds) {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  )
}

function animateFloatingWindowTo(targetBounds, duration = FLOATING_DOCK_ANIMATION_MS) {
  if (!floatingWindow || typeof floatingWindow.setBounds !== 'function') return

  const nextAnimationId = ++floatingAnimationId
  const normalizedTarget = {
    x: Math.round(targetBounds.x),
    y: Math.round(targetBounds.y),
    width: Math.round(targetBounds.width),
    height: Math.round(targetBounds.height)
  }

  if (isMacOS()) {
    floatingWindow.setBounds(normalizedTarget, true)
    return
  }

  const startBounds =
    typeof floatingWindow.getBounds === 'function' ? floatingWindow.getBounds() : { ...normalizedTarget }
  const startedAt = Date.now()
  const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3)

  const step = () => {
    if (!floatingWindow || nextAnimationId !== floatingAnimationId) return
    const progress = Math.min((Date.now() - startedAt) / duration, 1)
    const eased = easeOutCubic(progress)
    const bounds = {
      x: Math.round(startBounds.x + (normalizedTarget.x - startBounds.x) * eased),
      y: Math.round(startBounds.y + (normalizedTarget.y - startBounds.y) * eased),
      width: Math.round(startBounds.width + (normalizedTarget.width - startBounds.width) * eased),
      height: Math.round(startBounds.height + (normalizedTarget.height - startBounds.height) * eased)
    }

    floatingWindow.setBounds(bounds)
    if (progress < 1) {
      setTimeout(step, 16)
    }
  }

  step()
}

function focusFloatingWindow() {
  if (!floatingWindow) return
  try {
    floatingWindow.focus?.()
    floatingWindow.moveTop?.()
    floatingWindow.focusOnWebView?.()
    floatingWindow.webContents?.focus?.()
  } catch {
    // Best effort only. Some ZTools versions do not expose every Electron method.
  }
}

function moveFloatingWindow(point) {
  try {
    if (!floatingWindow || typeof floatingWindow.setPosition !== 'function') {
      return { success: false, error: '悬浮小窗未打开' }
    }

    const x = Math.round(Number(point?.x))
    const y = Math.round(Number(point?.y))
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { success: false, error: '窗口坐标无效' }
    }

    floatingDockState = null
    stopDockWatcher()
    floatingAnimationId++
    floatingWindow.setPosition(x, y)
    return ok(true)
  } catch (error) {
    return fail(error)
  }
}

function stopFloatingMove() {
  return ok(true)
}

function openFloatingWindow() {
  try {
    const ztools = getZtools()
    if (floatingWindow && typeof floatingWindow.focus === 'function') {
      try {
        focusFloatingWindow()
        return ok(true)
      } catch {
        floatingWindow = null
      }
    }

    if (typeof ztools.createBrowserWindow !== 'function') {
      return { success: false, error: '当前 ZTools 版本不支持悬浮小窗' }
    }

    floatingWindow = ztools.createBrowserWindow(getFloatingUrl(), {
      title: 'Sub2API 用量',
      width: 248,
      height: 116,
      minWidth: 230,
      minHeight: 108,
      useContentSize: true,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: 'preload.js'
      }
    })
    if (floatingWindow && typeof floatingWindow.on === 'function') {
      floatingWindow.on('closed', () => {
        floatingWindow = null
        floatingDockState = null
        stopDockWatcher()
      })
    }

    return ok(true)
  } catch (error) {
    return fail(error)
  }
}

function sendFloatingCommand(command) {
  try {
    const sendToParent = getZtools().sendToParent
    if (typeof sendToParent !== 'function') {
      return { success: false, error: '当前窗口无法向主窗口发送悬浮信令' }
    }
    sendToParent('sub2api-floating-window', command)
    return ok(true)
  } catch (error) {
    return fail(error)
  }
}

ipcRenderer.on('sub2api-floating-window', (event, command) => {
  const name = typeof command === 'string' ? command : command?.name
  const payload = command && typeof command === 'object' ? command.payload : null
  if (name === 'dock') {
    dockFloatingWindow()
  } else if (name === 'expand') {
    expandDockedFloatingWindow()
  } else if (name === 'collapse') {
    collapseDockedFloatingWindow()
  } else if (name === 'move') {
    moveFloatingWindow(payload)
  } else if (name === 'stop-move') {
    stopFloatingMove()
  }
})

function copyText(text) {
  try {
    getZtools().copyText?.(String(text || ''))
    return ok(true)
  } catch (error) {
    return fail(error)
  }
}

window.sub2ApiUsage = {
  getConfig() {
    try {
      return ok(getConfig())
    } catch (error) {
      return fail(error)
    }
  },
  saveConfig(config) {
    try {
      return saveConfig(config)
    } catch (error) {
      return fail(error)
    }
  },
  fetchUsage,
  refreshAuthToken,
  dockFloatingWindow() {
    return sendFloatingCommand('dock')
  },
  expandDockedFloatingWindow() {
    return sendFloatingCommand('expand')
  },
  collapseDockedFloatingWindow() {
    return sendFloatingCommand('collapse')
  },
  moveFloatingWindow(x, y) {
    return sendFloatingCommand({ name: 'move', payload: { x, y } })
  },
  stopFloatingMove() {
    return sendFloatingCommand({ name: 'stop-move' })
  },
  openFloatingWindow,
  copyText
}
