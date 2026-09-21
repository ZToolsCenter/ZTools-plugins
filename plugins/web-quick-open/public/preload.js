const http = require('node:http')
const https = require('node:https')

const STORAGE_KEY = 'web-quick-open-engines'
const FEATURE_PREFIX = 'quick-open-'
const ICON_SIZE = 128
const compressedIconCache = new Map()
const registeredFeatureSignatures = new Map()
const FAVICON_API_URL = 'https://fav.lee.cm/get.php'
const REQUEST_TIMEOUT_MS = 10000
const MAX_REDIRECTS = 5
const MAX_ICON_BYTES = 1024 * 1024
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
  const value = getZtools().dbStorage.getItem(STORAGE_KEY)
  return Array.isArray(value) ? value.map(normalizeEngine).filter((engine) => engine.id) : []
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
    keyword: typeof engine?.keyword === 'string' ? engine.keyword.trim() : ''
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
        console.warn('[WebQuickOpen] compress icon failed:', error)
        resolve(icon)
      }
    }
    image.onerror = () => resolve(icon)
    image.src = icon
  })
}

async function saveEngines(engines) {
  const normalized = await Promise.all(
    engines.map(async (engine) => {
      const normalizedEngine = normalizeEngine(engine)
      return {
        ...normalizedEngine,
        icon: await compressIconToPng(normalizedEngine.icon)
      }
    })
  )
  getZtools().dbStorage.setItem(STORAGE_KEY, normalized)
  return normalized
}

function validateEngine(engine, requireId) {
  const normalized = normalizeEngine(engine)
  if (requireId && !normalized.id) {
    return { success: false, error: 'ID 不能为空' }
  }
  if (!normalized.name || !normalized.url) {
    return { success: false, error: '名称和 URL 不能为空' }
  }

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
        .filter((feature) => typeof feature?.code === 'string' && feature.code.startsWith(FEATURE_PREFIX))
        .map((feature) => [feature.code, feature])
    )
  } catch (error) {
    console.warn('[WebQuickOpen] get current features failed:', error)
    return null
  }
}

function setEngineFeature(engine, existingFeatures = null) {
  const code = buildFeatureCode(engine.id)
  if (!engine.enabled) {
    if (existingFeatures === null || existingFeatures.has(code) || registeredFeatureSignatures.has(code)) {
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

  getZtools().onMainPush(({ payload }) => {
    const input = String(payload || '').trim()
    if (!isWebUrl(input)) return { type: 'list', data: [] }

    const url = ensureUrlProtocol(input)
    return {
      type: 'list',
      data: [
        { text: '打开网址', title: url, icon: 'logo.png', action: 'open', url },
        { text: '添加网址', title: '添加到网页快开', icon: 'logo.png', action: 'add', url }
      ]
    }
  }, ({ option }) => {
    if (!option || !isWebUrl(option.url)) return false
    if (option.action === 'open') {
      getZtools().shellOpenExternal(option.url)
      getZtools().hideMainWindow(false)
      return false
    }
    if (option.action === 'add') return true
    return false
  })
}

function syncEngineFeatures(engines) {
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

async function fetchFavicon(url) {
  const candidateUrl = ensureUrlProtocol(String(url || '').replace('{q}', 'test').trim())
  const parsed = new URL(candidateUrl)
  const faviconUrl = `${FAVICON_API_URL}?url=${encodeURIComponent(parsed.host)}`
  const icon = await downloadAsDataUrl(faviconUrl)
  if (!icon) {
    throw new Error('未能通过图标服务获取图标')
  }
  return icon
}

function requestUrl(url, options, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const urlObject = new URL(url)
    const client = urlObject.protocol === 'http:' ? http : https

    const chunks = []
    let receivedBytes = 0
    let done = false

    const finish = (fn, value) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      fn(value)
    }

    const timeout = setTimeout(() => {
      request.destroy()
      finish(reject, new Error('请求超时'))
    }, REQUEST_TIMEOUT_MS)

    const request = client.request(
      urlObject,
      {
        method: 'GET',
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
        finish(resolve, requestUrl(new URL(location, url).href, options, redirectCount + 1))
        return
      }

      response.on('error', (error) => finish(reject, error))
      response.on('data', (chunk) => {
        const buffer = Buffer.from(chunk)
        chunks.push(buffer)
        receivedBytes += buffer.length
        if (receivedBytes > options.maxBytes) {
          request.destroy()
          finish(resolve, {
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks)
          })
        }
      })
      response.on('end', () =>
        finish(resolve, {
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks)
        })
      )
      }
    )
    request.on('error', (error) => finish(reject, error))
    request.end()
  })
}

async function downloadAsDataUrl(url) {
  try {
    const response = await requestUrl(url, {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      maxBytes: MAX_ICON_BYTES
    })

    const contentType = Array.isArray(response.headers['content-type'])
      ? response.headers['content-type'][0]
      : response.headers['content-type'] || guessIconContentType(url)
    const normalizedType = String(contentType).split(';')[0].trim().toLowerCase()

    if (
      !response.statusCode ||
      response.statusCode >= 400 ||
      response.body.length === 0 ||
      (!normalizedType.startsWith('image/') && normalizedType !== 'application/octet-stream')
    ) {
      return ''
    }

    return `data:${normalizedType || guessIconContentType(url)};base64,${response.body.toString('base64')}`
  } catch (error) {
    console.warn('[WebQuickOpen] download favicon failed:', url, error)
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

function extractImportedEngineList(raw) {
  if (Array.isArray(raw)) {
    return { success: true, data: raw }
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.data)) {
      return { success: true, data: raw.data }
    }
    if (Array.isArray(raw.engines)) {
      return { success: true, data: raw.engines }
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
    keyword: typeof engine?.keyword === 'string' ? engine.keyword : ''
  })
}

function buildEngineDedupKey(engine) {
  const url = ensureUrlProtocol(String(engine.url || '').trim())
  if (engine.type === 'search') {
    return `search::${url.toLowerCase()}`
  }
  const keyword = String(engine.keyword || '').trim().toLowerCase()
  return `webpage::${keyword}::${url.toLowerCase()}`
}

async function importFromJsonText(jsonText) {
  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { success: false, error: 'JSON 解析失败，请确认文件内容正确' }
  }

  const extracted = extractImportedEngineList(parsed)
  if (!extracted.success) {
    return extracted
  }

  const sourceItems = extracted.data
  const existingEngines = getAllEngines()
  const nextEngines = existingEngines.slice()
  const existingKeys = new Set(existingEngines.map(buildEngineDedupKey))
  const importedKeys = new Set()

  let importedCount = 0
  let duplicateCount = 0
  let invalidCount = 0

  for (const item of sourceItems) {
    const normalized = normalizeImportedEngine(item)
    const validated = validateEngine(normalized, false)
    if (!validated.success) {
      invalidCount++
      continue
    }

    const candidate = {
      ...validated.engine,
      id: validated.engine.id || generateId()
    }
    const dedupKey = buildEngineDedupKey(candidate)

    if (existingKeys.has(dedupKey) || importedKeys.has(dedupKey)) {
      duplicateCount++
      continue
    }

    existingKeys.add(dedupKey)
    importedKeys.add(dedupKey)
    nextEngines.push(candidate)
    importedCount++
  }

  if (importedCount > 0) {
    const savedEngines = await saveEngines(nextEngines)
    syncEngineFeatures(savedEngines)
  }

  return {
    success: true,
    totalCount: sourceItems.length,
    importedCount,
    duplicateCount,
    invalidCount,
    skippedCount: duplicateCount + invalidCount
  }
}

registerMainPush()

window.webQuickOpen = {
  async getAll() {
    const engines = getAllEngines()
    return { success: true, data: engines }
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

// Register persisted dynamic features once when the preload context starts.
syncEngineFeatures(getAllEngines())
