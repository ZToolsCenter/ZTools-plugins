import axios from 'axios'

const GIF_HEADER_87A = 'GIF87a'
const GIF_HEADER_89A = 'GIF89a'
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const readAscii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.slice(offset, offset + length))

const readUint32BE = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) >>> 0)
  + (bytes[offset + 1] << 16)
  + (bytes[offset + 2] << 8)
  + bytes[offset + 3]

const readUint32LE = (bytes: Uint8Array, offset: number) =>
  bytes[offset]
  + (bytes[offset + 1] << 8)
  + (bytes[offset + 2] << 16)
  + ((bytes[offset + 3] << 24) >>> 0)

const hasSignature = (bytes: Uint8Array, signature: Uint8Array) => {
  if (bytes.length < signature.length) return false

  for (let index = 0; index < signature.length; index++) {
    if (bytes[index] !== signature[index]) {
      return false
    }
  }

  return true
}

const skipSubBlocks = (bytes: Uint8Array, offset: number) => {
  let cursor = offset

  while (cursor < bytes.length) {
    const blockSize = bytes[cursor]
    cursor += 1

    if (blockSize === 0) {
      return cursor
    }

    cursor += blockSize
  }

  return -1
}

const isAnimatedGif = (bytes: Uint8Array) => {
  if (bytes.length < 13) return false

  const header = readAscii(bytes, 0, 6)
  if (header !== GIF_HEADER_87A && header !== GIF_HEADER_89A) {
    return false
  }

  let offset = 13
  const globalColorTableFlag = (bytes[10] & 0x80) !== 0

  if (globalColorTableFlag) {
    const globalColorTableSize = 3 * (2 ** ((bytes[10] & 0x07) + 1))
    offset += globalColorTableSize
  }

  let frameCount = 0

  while (offset < bytes.length) {
    const blockId = bytes[offset]
    offset += 1

    if (blockId === 0x3B) {
      break
    }

    if (blockId === 0x21) {
      if (offset >= bytes.length) return false

      offset += 1
      offset = skipSubBlocks(bytes, offset)
      if (offset === -1) return false
      continue
    }

    if (blockId === 0x2C) {
      if (offset + 9 > bytes.length) return false

      frameCount += 1
      if (frameCount > 1) {
        return true
      }

      const packedField = bytes[offset + 8]
      offset += 9

      if ((packedField & 0x80) !== 0) {
        const localColorTableSize = 3 * (2 ** ((packedField & 0x07) + 1))
        offset += localColorTableSize
      }

      if (offset >= bytes.length) return false

      offset += 1
      offset = skipSubBlocks(bytes, offset)
      if (offset === -1) return false
      continue
    }

    return false
  }

  return false
}

const isAnimatedPng = (bytes: Uint8Array) => {
  if (!hasSignature(bytes, PNG_SIGNATURE)) {
    return false
  }

  let offset = PNG_SIGNATURE.length

  while (offset + 8 <= bytes.length) {
    const chunkLength = readUint32BE(bytes, offset)
    const chunkType = readAscii(bytes, offset + 4, 4)
    const nextOffset = offset + 12 + chunkLength

    if (nextOffset > bytes.length) {
      return false
    }

    if (chunkType === 'acTL') {
      return true
    }

    if (chunkType === 'IEND') {
      break
    }

    offset = nextOffset
  }

  return false
}

const isAnimatedWebp = (bytes: Uint8Array) => {
  if (bytes.length < 16) return false
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
    return false
  }

  let offset = 12
  let hasAnimationFlag = false

  while (offset + 8 <= bytes.length) {
    const chunkType = readAscii(bytes, offset, 4)
    const chunkLength = readUint32LE(bytes, offset + 4)

    if (chunkType === 'ANIM') {
      return true
    }

    if (chunkType === 'VP8X' && offset + 9 <= bytes.length) {
      hasAnimationFlag = (bytes[offset + 8] & 0x02) !== 0
    }

    offset += 8 + chunkLength + (chunkLength % 2)
  }

  return hasAnimationFlag
}

export const isAnimatedImageBuffer = (buffer: ArrayBuffer | Uint8Array, mimeType = '') => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const normalizedMimeType = mimeType.toLowerCase()

  if (!bytes.length) return false

  if (!normalizedMimeType || normalizedMimeType === 'image/gif') {
    if (isAnimatedGif(bytes)) {
      return true
    }
  }

  if (!normalizedMimeType || normalizedMimeType === 'image/png' || normalizedMimeType === 'image/apng') {
    if (isAnimatedPng(bytes)) {
      return true
    }
  }

  if (!normalizedMimeType || normalizedMimeType === 'image/webp') {
    if (isAnimatedWebp(bytes)) {
      return true
    }
  }

  return false
}

// ==================== 智能缓存系统 ====================

interface CacheEntry {
  result: boolean
  timestamp: number
  url: string
}

const MEMORY_CACHE_MAX_SIZE = 500
const PERSISTENT_CACHE_KEY = 'gif_validation_cache_v2'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7天

class ValidationCache {
  // Map天然维护插入顺序，delete+set可实现O(1)的LRU更新
  private cache = new Map<string, CacheEntry>()

  constructor() {
    this.loadFromStorage()
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(PERSISTENT_CACHE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, CacheEntry>
        const now = Date.now()

        for (const [url, entry] of Object.entries(parsed)) {
          if (now - entry.timestamp < CACHE_TTL) {
            this.cache.set(url, entry)
          }
        }

        this.trimCache()
      }
    } catch {
      // 忽略存储错误
    }
  }

  private saveToStorage() {
    try {
      const obj: Record<string, CacheEntry> = {}
      this.cache.forEach((entry, url) => {
        obj[url] = entry
      })
      localStorage.setItem(PERSISTENT_CACHE_KEY, JSON.stringify(obj))
    } catch {
      // 忽略存储错误（可能是存储已满）
    }
  }

  private trimCache() {
    // Map.keys() 按插入顺序返回，最早的在最前面
    while (this.cache.size > MEMORY_CACHE_MAX_SIZE) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) {
        this.cache.delete(oldest)
      } else {
        break
      }
    }
  }

  get(url: string): boolean | null {
    const entry = this.cache.get(url)
    if (!entry) return null

    // 检查是否过期
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(url)
      return null
    }

    // O(1) LRU更新：删除后重新插入，Map会将其移到末尾
    this.cache.delete(url)
    this.cache.set(url, entry)

    return entry.result
  }

  set(url: string, result: boolean) {
    // O(1)更新：先删除旧的（如果有），再插入新的
    this.cache.delete(url)
    this.cache.set(url, {
      url,
      result,
      timestamp: Date.now()
    })

    this.trimCache()
    this.debouncedSave()
  }

  private saveTimeout: number | null = null

  private debouncedSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
    }
    this.saveTimeout = window.setTimeout(() => {
      this.saveToStorage()
    }, 1000)
  }

  // 批量预加载缓存
  preload(urls: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    for (const url of urls) {
      const cached = this.get(url)
      if (cached !== null) {
        result[url] = cached
      }
    }
    return result
  }
}

const validationCache = new ValidationCache()

// ==================== 智能预检测 ====================

// 高置信度 GIF URL 模式
const HIGH_CONFIDENCE_GIF_PATTERNS = [
  /\/gif\//i,
  /\/animated\//i,
  /\/animation\//i,
  /_animated\./i,
  /-animated\./i,
  /_gif\./i,
  /-gif\./i,
]

// 中置信度 GIF URL 模式
const MEDIUM_CONFIDENCE_GIF_PATTERNS = [
  /\.gif(?:\?.*)?$/i,
  /giphy/i,
  /tenor/i,
  /media\.giphy/i,
  /media1\.tenor/i,
]

// 低置信度（可能是假 GIF）
const LOW_CONFIDENCE_PATTERNS = [
  /thumb/i,
  /thumbnail/i,
  /preview/i,
  /small/i,
  /mini/i,
]

export interface GifConfidenceScore {
  score: number // 0-100
  reason: string
  needsValidation: boolean
}

/**
 * 智能评估 URL 为 GIF 的置信度
 * 分数 >= 80: 高置信度，可直接认为是 GIF
 * 分数 >= 50: 中置信度，建议验证
 * 分数 < 50: 低置信度，可跳过或延迟验证
 */
export const evaluateGifConfidence = (url: string): GifConfidenceScore => {
  if (!url) {
    return { score: 0, reason: '空URL', needsValidation: false }
  }

  const lowerUrl = url.toLowerCase()
  const isLikelyThumbnail = LOW_CONFIDENCE_PATTERNS.some(pattern => pattern.test(lowerUrl))

  // 高置信度模式
  for (const pattern of HIGH_CONFIDENCE_GIF_PATTERNS) {
    if (pattern.test(url)) {
      return { score: 90, reason: '高置信度模式匹配', needsValidation: false }
    }
  }

  // 直接以 .gif 结尾且不像缩略图的资源，通常可以直接信任
  if (/\.gif(?:\?.*)?$/i.test(lowerUrl) && !isLikelyThumbnail) {
    return { score: 85, reason: 'GIF扩展名明确', needsValidation: false }
  }

  // 中置信度模式
  for (const pattern of MEDIUM_CONFIDENCE_GIF_PATTERNS) {
    if (pattern.test(url)) {
      return { score: 70, reason: '中置信度模式匹配', needsValidation: true }
    }
  }

  // 低置信度（缩略图等）
  if (isLikelyThumbnail) {
    return { score: 20, reason: '可能是缩略图', needsValidation: true }
  }

  // 默认情况
  return { score: 40, reason: '无明确特征', needsValidation: true }
}

// ==================== 优化的流式验证 ====================

const PROBE_BYTE_LIMIT = 128 * 1024 // 减少到 128KB，足以检测大多数 GIF
const STREAM_TIMEOUT = 3000 // 减少到 3 秒

const concatChunks = (chunks: Uint8Array[], totalLength: number) => {
  const merged = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return merged
}

// 快速 GIF 检测：只需要检测前几个数据块就能确定是否为动画
const quickAnimatedGifCheck = (bytes: Uint8Array): boolean | null => {
  if (bytes.length < 13) return null

  const header = readAscii(bytes, 0, 6)
  if (header !== GIF_HEADER_87A && header !== GIF_HEADER_89A) {
    return false
  }

  let offset = 13
  const globalColorTableFlag = (bytes[10] & 0x80) !== 0

  if (globalColorTableFlag) {
    const globalColorTableSize = 3 * (2 ** ((bytes[10] & 0x07) + 1))
    offset += globalColorTableSize
  }

  let frameCount = 0
  let hasGraphicControl = false

  while (offset < bytes.length && offset < 32768) { // 只检查前 32KB
    if (offset >= bytes.length) return null

    const blockId = bytes[offset]
    offset += 1

    if (blockId === 0x3B) {
      break
    }

    if (blockId === 0x21) {
      if (offset >= bytes.length) return null

      const label = bytes[offset]
      offset += 1

      // Graphic Control Extension
      if (label === 0xF9) {
        hasGraphicControl = true
      }

      offset = skipSubBlocks(bytes, offset)
      if (offset === -1) return null
      continue
    }

    if (blockId === 0x2C) {
      if (offset + 9 > bytes.length) return null

      frameCount += 1
      if (frameCount > 1) {
        return true
      }

      const packedField = bytes[offset + 8]
      offset += 9

      if ((packedField & 0x80) !== 0) {
        const localColorTableSize = 3 * (2 ** ((packedField & 0x07) + 1))
        offset += localColorTableSize
      }

      if (offset >= bytes.length) return null

      offset += 1 // LZW minimum code size
      offset = skipSubBlocks(bytes, offset)
      if (offset === -1) return null
      continue
    }

    // 遇到未知块，可能是数据不足
    return null
  }

  // 只找到一帧，但数据可能不完整
  return frameCount === 1 && !hasGraphicControl ? false : null
}

const probeAnimatedImageByStreaming = async (url: string, timeout: number): Promise<boolean | null> => {
  if (typeof fetch === 'undefined' || typeof AbortController === 'undefined') {
    return null
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'image/*',
        'Range': 'bytes=0-131071' // 请求前 128KB
      }
    })

    if (!response.ok) {
      // 如果服务器不支持 Range，尝试普通请求
      if (response.status === 416) {
        return null // 让上层用普通方式请求
      }
      return false
    }

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase()

    if (!response.body) {
      return null
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalLength = 0

    while (totalLength < PROBE_BYTE_LIMIT) {
      const { done, value } = await reader.read()

      if (done) {
        const bytes = concatChunks(chunks, totalLength)
        // 对于 GIF 使用快速检测
        if (!contentType || contentType === 'image/gif') {
          const quickResult = quickAnimatedGifCheck(bytes)
          if (quickResult !== null) return quickResult
        }
        return isAnimatedImageBuffer(bytes, contentType)
      }

      if (!value?.length) {
        continue
      }

      chunks.push(value)
      totalLength += value.length

      // 累积到一定数据就尝试快速检测
      if (totalLength >= 8192) { // 8KB 足以检测大多数 GIF
        const bytes = concatChunks(chunks, totalLength)

        if (!contentType || contentType === 'image/gif') {
          const quickResult = quickAnimatedGifCheck(bytes)
          if (quickResult === true) {
            controller.abort()
            return true
          }
          // 如果快速检测不能确定，继续读取
        } else {
          // 其他类型直接完整检测
          const result = isAnimatedImageBuffer(bytes, contentType)
          if (result) {
            controller.abort()
            return true
          }
        }
      }
    }

    controller.abort()
    return null
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null
    }

    return false
  } finally {
    window.clearTimeout(timer)
  }
}

// ==================== 主验证函数 ====================

const pendingValidations = new Map<string, Promise<boolean>>()

export const validateAnimatedImageUrl = async (
  url: string,
  options: { timeout?: number; useCache?: boolean; skipLowConfidence?: boolean } = {}
): Promise<boolean> => {
  const normalizedUrl = url.trim()
  const timeout = options.timeout ?? 4000
  const useCache = options.useCache ?? true
  const skipLowConfidence = options.skipLowConfidence ?? false

  if (!normalizedUrl) {
    return false
  }

  // 1. 检查缓存
  if (useCache) {
    const cachedResult = validationCache.get(normalizedUrl)
    if (cachedResult !== null) {
      return cachedResult
    }

    // 检查进行中的验证
    const pending = pendingValidations.get(normalizedUrl)
    if (pending) {
      return pending
    }
  }

  // 2. 智能置信度评估
  const confidence = evaluateGifConfidence(normalizedUrl)

  // 高置信度直接返回，跳过网络请求
  if (confidence.score >= 80) {
    if (useCache) {
      validationCache.set(normalizedUrl, true)
    }
    return true
  }

  // 低置信度且设置了跳过，直接返回 false
  if (skipLowConfidence && confidence.score < 40) {
    return false
  }

  // 3. 执行验证
  const validationTask = (async () => {
    try {
      // 优先使用流式验证
      const quickProbeResult = await probeAnimatedImageByStreaming(normalizedUrl, STREAM_TIMEOUT)
      if (quickProbeResult !== null) {
        if (useCache) {
          validationCache.set(normalizedUrl, quickProbeResult)
        }
        return quickProbeResult
      }

      // 流式失败，使用 axios 完整请求
      const response = await axios.get<ArrayBuffer>(normalizedUrl, {
        responseType: 'arraybuffer',
        timeout,
        headers: {
          'Accept': 'image/*'
        },
        // 限制最大下载 256KB
        maxContentLength: 256 * 1024,
        maxBodyLength: 256 * 1024
      })

      const contentType = String(response.headers['content-type'] || '').split(';')[0]
      const result = isAnimatedImageBuffer(response.data, contentType)

      if (useCache) {
        validationCache.set(normalizedUrl, result)
      }

      return result
    } catch {
      // 验证失败，缓存为 false
      if (useCache) {
        validationCache.set(normalizedUrl, false)
      }
      return false
    } finally {
      // 清理进行中的验证
      pendingValidations.delete(normalizedUrl)
    }
  })()

  if (useCache) {
    pendingValidations.set(normalizedUrl, validationTask)
  }

  return validationTask
}

// ==================== 批量验证优化 ====================

interface ValidationPriority {
  url: string
  priority: number
  confidence: GifConfidenceScore
}

/**
 * 智能排序 URL 验证优先级
 * 优先验证高置信度的 URL，提高用户体验
 */
export const prioritizeUrlsForValidation = (urls: string[]): ValidationPriority[] => {
  return urls.map(url => {
    const confidence = evaluateGifConfidence(url)
    return {
      url,
      priority: confidence.score,
      confidence
    }
  }).sort((a, b) => b.priority - a.priority)
}

/**
 * 批量验证，支持提前终止
 */
export const validateUrlsWithEarlyTermination = async (
  urls: string[],
  options: {
    targetCount?: number
    concurrency?: number
    timeout?: number
    onProgress?: (validated: number, found: number) => void
  } = {}
): Promise<string[]> => {
  const {
    targetCount = urls.length,
    concurrency = 12,
    timeout = 4000,
    onProgress
  } = options

  if (urls.length === 0) return []

  const prioritized = prioritizeUrlsForValidation(urls)
  const animatedUrls: string[] = []
  const processed = new Set<string>()

  // 首先利用缓存快速返回已知结果
  for (const item of prioritized) {
    const cached = validationCache.get(item.url)
    if (cached === true) {
      animatedUrls.push(item.url)
      processed.add(item.url)

      if (animatedUrls.length >= targetCount) {
        onProgress?.(processed.size, animatedUrls.length)
        return animatedUrls
      }
    } else if (cached === false) {
      processed.add(item.url)
    }
  }

  // 对剩余的需要验证的 URL 进行并发验证
  const toValidate = prioritized.filter(item => !processed.has(item.url))
  let completed = processed.size

  await new Promise<void>((resolve) => {
    let activeCount = 0
    let index = 0
    let resolved = false

    const checkComplete = () => {
      if (resolved) return
      if (animatedUrls.length >= targetCount || (activeCount === 0 && index >= toValidate.length)) {
        resolved = true
        resolve()
      }
    }

    const processNext = async () => {
      if (resolved) return
      if (index >= toValidate.length) {
        checkComplete()
        return
      }

      const item = toValidate[index++]
      activeCount++

      try {
        const isAnimated = await validateAnimatedImageUrl(item.url, { timeout })
        if (isAnimated && !resolved) {
          animatedUrls.push(item.url)
        }
      } catch {
        // 忽略错误
      } finally {
        activeCount--
        completed++
        onProgress?.(completed, animatedUrls.length)

        // 检查是否达到目标
        if (animatedUrls.length >= targetCount) {
          checkComplete()
        } else {
          processNext()
        }
      }
    }

    // 启动并发 workers
    const workers = Math.min(concurrency, toValidate.length)
    for (let i = 0; i < workers; i++) {
      processNext()
    }
  })

  return animatedUrls
}

// ==================== 工具函数 ====================

export const filterAsyncWithConcurrency = async <T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<boolean>,
  concurrency: number = 12
) => {
  if (items.length === 0) {
    return []
  }

  const results = new Array<boolean>(items.length).fill(false)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await predicate(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )

  return items.filter((_, index) => results[index])
}

export const mapAsyncWithConcurrency = async <T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number = 12
) => {
  if (items.length === 0) {
    return [] as R[]
  }

  const results = new Array<R>(items.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )

  return results
}

/**
 * 预加载缓存中的结果
 */
export const preloadValidationCache = (urls: string[]): Record<string, boolean> => {
  return validationCache.preload(urls)
}

/**
 * 批量设置缓存（用于从搜索结果元数据直接标记）
 */
export const batchSetValidationCache = (entries: Array<{ url: string; isAnimated: boolean }>) => {
  entries.forEach(({ url, isAnimated }) => {
    validationCache.set(url, isAnimated)
  })
}
