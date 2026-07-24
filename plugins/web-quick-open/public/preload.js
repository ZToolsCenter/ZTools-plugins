const http = require('node:http')
const https = require('node:https')

const STORAGE_KEY = 'web-quick-open-engines'
const FEATURE_PREFIX = 'quick-open-'
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

function saveEngines(engines) {
  getZtools().dbStorage.setItem(STORAGE_KEY, engines.map(normalizeEngine))
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

function setEngineFeature(engine) {
  if (!engine.enabled) {
    getZtools().removeFeature(buildFeatureCode(engine.id))
    return
  }

  const baseFeature = {
    code: buildFeatureCode(engine.id),
    explain: engine.name,
    icon: engine.icon || 'logo.png',
    mainHide: true
  }

  if (engine.type === 'webpage') {
    getZtools().setFeature({
      ...baseFeature,
      cmds: [engine.keyword]
    })
    return
  }

  getZtools().setFeature({
    ...baseFeature,
    cmds: [
      {
        type: 'over',
        label: engine.name,
        minLength: 1
      }
    ]
  })
}

function removeEngineFeature(engineId) {
  getZtools().removeFeature(buildFeatureCode(engineId))
}

function syncEngineFeatures(engines) {
  for (const engine of engines) {
    setEngineFeature(engine)
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

function importFromJsonText(jsonText) {
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
    saveEngines(nextEngines)
    syncEngineFeatures(nextEngines)
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

window.webQuickOpen = {
  async getAll() {
    const engines = getAllEngines()
    syncEngineFeatures(engines)
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
    saveEngines(engines)
    setEngineFeature(nextEngine)
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
    saveEngines(engines)
    setEngineFeature(validated.engine)
    return { success: true }
  },
  async delete(engineId) {
    const engines = getAllEngines()
    const nextEngines = engines.filter((item) => item.id !== engineId)
    if (nextEngines.length === engines.length) {
      return { success: false, error: '未找到该入口' }
    }
    saveEngines(nextEngines)
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
      return importFromJsonText(jsonText)
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
