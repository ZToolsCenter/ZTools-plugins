const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const zlib = require('node:zlib')
const { pathToFileURL } = require('node:url')
const { ipcRenderer } = require('electron')

const TEST_ORIGIN =
  process.env.ZTOOLS_E2E === '1' && process.env.ZTOOLS_DESKTOP_PET_API_ORIGIN
    ? new URL(process.env.ZTOOLS_DESKTOP_PET_API_ORIGIN).origin
    : null
const PETDEX_ORIGIN = TEST_ORIGIN || 'https://petdex.dev'
const PETDEX_SEARCH_URL = `${PETDEX_ORIGIN}/api/pets/search`
const TRUSTED_ASSET_HOST = 'assets.petdex.dev'
const STORAGE_DIRECTORY_NAME = 'petdex-desktop-pet-data'
const RUNTIME_CONFIG_STORAGE_KEY = 'runtime-config'
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const MAX_ZIP_ENTRIES = 32
const MAX_PET_JSON_BYTES = 64 * 1024
const MAX_SPRITESHEET_BYTES = 10 * 1024 * 1024
const MAX_SOUND_BYTES = 3 * 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED_BYTES = MAX_PET_JSON_BYTES + MAX_SPRITESHEET_BYTES
const PREVIEW_ASSET_CACHE_LIMIT = 24
const previewAssetCache = new Map()
const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  activeSlug: null,
  enabled: false,
  scale: 0.72,
  opacity: 1,
  alwaysOnTop: true,
  soundEnabled: false,
  returnToDefaultAnimation: true,
  position: null
})
const PET_CONTEXT_MENU_COMMANDS = new Set([
  'petdex-desktop-pet:zoom-in',
  'petdex-desktop-pet:zoom-out',
  'petdex-desktop-pet:opacity-increase',
  'petdex-desktop-pet:opacity-decrease',
  'petdex-desktop-pet:close'
])

/**
 * 校验 Petdex slug 可安全用于本地目录名。
 * @param {unknown} value 待校验的 slug。
 * @returns {string} 校验后的 slug。
 * @throws {Error} slug 不符合 Petdex 命名约束时抛错。
 */
function assertSafeSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
    throw new Error('宠物标识不合法')
  }
  return value
}

/**
 * 校验 ZIP 内仅作为元数据保存的原始宠物 ID。
 * @param {unknown} value pet.json 中的原始 ID。
 * @returns {string} 去除首尾空白后的包内 ID。
 * @throws {Error} ID 为空、过长或包含控制字符时抛错。
 */
function assertPackageId(value) {
  if (typeof value !== 'string') throw new Error('pet.json 中的宠物 ID 无效')
  const packageId = value.trim()
  if (!packageId || packageId.length > 120 || /[\u0000-\u001f\u007f]/.test(packageId)) {
    throw new Error('pet.json 中的宠物 ID 无效')
  }
  return packageId
}

/**
 * 校验远程资源来自 Petdex 受信资产域名。
 * @param {unknown} value 待校验的 URL。
 * @returns {URL} 校验后的 URL 对象。
 * @throws {Error} URL 协议、域名或认证信息不符合约束时抛错。
 */
function assertTrustedAssetUrl(value) {
  if (typeof value !== 'string') throw new Error('资源地址缺失')
  const url = new URL(value)
  const isProductionAsset = url.protocol === 'https:' && url.hostname === TRUSTED_ASSET_HOST
  const isTestAsset = Boolean(TEST_ORIGIN && url.origin === TEST_ORIGIN)
  if ((!isProductionAsset && !isTestAsset) || url.username || url.password) {
    throw new Error('资源地址不受信任')
  }
  return url
}

/**
 * 返回插件私有数据根目录并确保目录存在。
 * @returns {string} 插件私有数据根目录。
 */
function getStorageRoot() {
  const root = path.join(window.ztools.getPath('userData'), STORAGE_DIRECTORY_NAME)
  fs.mkdirSync(root, { recursive: true })
  return root
}

/**
 * 返回已安装宠物目录并确保目录存在。
 * @returns {string} 已安装宠物根目录。
 */
function getPetsRoot() {
  const root = path.join(getStorageRoot(), 'pets')
  fs.mkdirSync(root, { recursive: true })
  return root
}

/**
 * 以有界缓冲区发起 HTTPS GET 请求并跟随受控重定向。
 * @param {string | URL} input 请求地址。
 * @param {number} [redirectCount=0] 已跟随的重定向次数。
 * @param {(progress: {receivedBytes: number, totalBytes: number | null, percent: number | null}) => void} [onProgress] 响应下载进度回调。
 * @param {number} [maxBytes=MAX_RESPONSE_BYTES] 响应体最大字节数。
 * @returns {Promise<Buffer>} 完整响应体。
 * @throws {Error} 网络失败、响应过大、状态异常或重定向越界时抛错。
 */
function requestBuffer(input, redirectCount = 0, onProgress, maxBytes = MAX_RESPONSE_BYTES) {
  const url = input instanceof URL ? input : new URL(input)
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'http:' ? http : https
    const request = transport.get(
      url,
      {
        headers: {
          Accept: 'application/json, application/zip, audio/mpeg, image/webp, image/png, */*',
          Referer: `${PETDEX_ORIGIN}/`,
          'User-Agent': 'ZTools Desktop Pet/1.0'
        },
        timeout: 20_000
      },
      (response) => {
        const statusCode = response.statusCode || 0
        const location = response.headers.location

        // 重定向只允许继续留在 Petdex 官方站点或资产域名。
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume()
          if (redirectCount >= 3) return reject(new Error('资源重定向次数过多'))
          const redirectUrl = new URL(location, url)
          if (![PETDEX_ORIGIN, `https://${TRUSTED_ASSET_HOST}`].includes(redirectUrl.origin)) {
            return reject(new Error('资源重定向到了不受信任的站点'))
          }
          requestBuffer(redirectUrl, redirectCount + 1, onProgress, maxBytes).then(resolve, reject)
          return
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume()
          reject(new Error(`Petdex 请求失败 (${statusCode})`))
          return
        }

        const chunks = []
        let receivedBytes = 0
        const declaredLength = Number(response.headers['content-length'])
        const totalBytes =
          Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : null

        // 在读取响应体前发布初始状态，让界面立即切换为下载进度。
        onProgress?.({ receivedBytes: 0, totalBytes, percent: totalBytes ? 0 : null })
        response.on('data', (chunk) => {
          receivedBytes += chunk.length
          if (receivedBytes > maxBytes) {
            request.destroy(new Error('下载内容超过大小限制'))
            return
          }
          chunks.push(chunk)
          onProgress?.({
            receivedBytes,
            totalBytes,
            percent: totalBytes
              ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
              : null
          })
        })
        response.on('end', () => resolve(Buffer.concat(chunks)))
      }
    )
    request.on('timeout', () => request.destroy(new Error('Petdex 请求超时')))
    request.on('error', reject)
  })
}

/**
 * 解析 JSON 缓冲区并把语法错误转换为业务错误。
 * @param {Buffer} buffer JSON 数据。
 * @param {string} label 错误信息中的资源名称。
 * @returns {unknown} 解析后的 JSON 值。
 * @throws {Error} JSON 无法解析时抛错。
 */
function parseJsonBuffer(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error(`${label} 不是有效 JSON`)
  }
}

/**
 * 把远端宠物对象压缩成插件认可的稳定字段集合。
 * @param {unknown} value Petdex API 返回的单个宠物对象。
 * @returns {Record<string, unknown>} 已校验的宠物对象。
 * @throws {Error} 必填字段缺失或资源域名不可信时抛错。
 */
function normalizePet(value) {
  if (!value || typeof value !== 'object') throw new Error('Petdex 返回了无效宠物数据')
  const pet = value
  const slug = assertSafeSlug(pet.slug)
  const zipUrl = assertTrustedAssetUrl(pet.zipUrl).toString()
  const spritesheetPath = assertTrustedAssetUrl(pet.spritesheetPath).toString()
  const displayName = typeof pet.displayName === 'string' ? pet.displayName.trim() : ''
  if (!displayName || displayName.length > 120) throw new Error(`宠物 ${slug} 名称无效`)
  const spriteVersionNumber = pet.spriteVersionNumber === 2 ? 2 : 1
  return {
    slug,
    displayName,
    description: typeof pet.description === 'string' ? pet.description.slice(0, 1000) : '',
    spritesheetPath,
    zipUrl,
    soundUrl:
      typeof pet.soundUrl === 'string' ? assertTrustedAssetUrl(pet.soundUrl).toString() : undefined,
    featured: pet.featured === true,
    kind: ['creature', 'object', 'character'].includes(pet.kind) ? pet.kind : 'creature',
    vibes: Array.isArray(pet.vibes) ? pet.vibes.filter((item) => typeof item === 'string') : [],
    tags: Array.isArray(pet.tags) ? pet.tags.filter((item) => typeof item === 'string') : [],
    dominantColor: typeof pet.dominantColor === 'string' ? pet.dominantColor : undefined,
    submittedBy: {
      name:
        pet.submittedBy && typeof pet.submittedBy.name === 'string'
          ? pet.submittedBy.name.slice(0, 120)
          : 'Petdex creator',
      imageUrl:
        pet.submittedBy && typeof pet.submittedBy.imageUrl === 'string'
          ? pet.submittedBy.imageUrl
          : undefined
    },
    previewUrl: TEST_ORIGIN
      ? `${TEST_ORIGIN}/pets/${slug}/preview.png`
      : `https://${TRUSTED_ASSET_HOST}/pets/${slug}/preview.webp`,
    spriteVersionNumber,
    dexNumber: Number.isFinite(pet.dexNumber) ? pet.dexNumber : undefined,
    metrics: {
      installCount: Number.isFinite(pet.metrics?.installCount) ? pet.metrics.installCount : 0,
      likeCount: Number.isFinite(pet.metrics?.likeCount) ? pet.metrics.likeCount : 0,
      zipDownloadCount: Number.isFinite(pet.metrics?.zipDownloadCount)
        ? pet.metrics.zipDownloadCount
        : 0
    }
  }
}

/**
 * 查询 Petdex 宠物并返回经过校验的分页结果。
 * @param {Record<string, unknown>} params 搜索、排序、分页和筛选参数。
 * @returns {Promise<Record<string, unknown>>} 宠物分页结果。
 * @throws {Error} 参数无效或远端响应结构不合法时抛错。
 */
async function searchPets(params = {}) {
  const query = typeof params.query === 'string' ? params.query.trim().slice(0, 120) : ''
  const cursor = Number.isInteger(params.cursor) && params.cursor >= 0 ? params.cursor : 0
  const limit = Number.isInteger(params.limit) ? Math.min(Math.max(params.limit, 1), 48) : 24
  const sort = ['installed', 'recent', 'popular', 'alpha', 'curated'].includes(params.sort)
    ? params.sort
    : query
      ? 'curated'
      : 'installed'
  const url = new URL(PETDEX_SEARCH_URL)
  if (query) url.searchParams.set('q', query)
  url.searchParams.set('sort', sort)
  url.searchParams.set('cursor', String(cursor))
  url.searchParams.set('limit', String(limit))
  if (Array.isArray(params.kinds) && params.kinds.length) {
    url.searchParams.set('kinds', params.kinds.join(','))
  }
  if (Array.isArray(params.vibes) && params.vibes.length) {
    url.searchParams.set('vibes', params.vibes.join(','))
  }

  const response = parseJsonBuffer(await requestBuffer(url), 'Petdex 搜索响应')
  if (!response || typeof response !== 'object' || !Array.isArray(response.pets)) {
    throw new Error('Petdex 搜索响应结构无效')
  }
  return {
    pets: response.pets.map(normalizePet),
    nextCursor: Number.isInteger(response.nextCursor) ? response.nextCursor : null,
    total: Number.isFinite(response.total) ? response.total : response.pets.length,
    searchMode: typeof response.searchMode === 'string' ? response.searchMode : 'all',
    facets: response.facets && typeof response.facets === 'object' ? response.facets : {}
  }
}

/**
 * 通过带 Petdex 来源标识的受控请求加载预览图片。
 * @param {unknown} value Petdex PNG 或 WebP 资源地址。
 * @returns {Promise<string>} 可供渲染进程直接加载的图片 data URL。
 * @throws {Error} 地址不可信、格式不受支持或图片内容损坏时抛错。
 */
async function loadPreviewAsset(value) {
  const url = assertTrustedAssetUrl(value)
  const pathname = url.pathname.toLowerCase()
  const fileName = pathname.endsWith('.png')
    ? 'preview.png'
    : pathname.endsWith('.webp')
      ? 'preview.webp'
      : null
  if (!fileName) throw new Error('预览资源格式不受支持')

  const cacheKey = url.toString()
  const cached = previewAssetCache.get(cacheKey)
  if (cached) return cached

  const pending = requestBuffer(url)
    .then((buffer) => {
      // 校验图片头后再交给渲染进程，避免把错误页或其他内容作为图片缓存。
      readImageDimensions(buffer, fileName)
      const mimeType = fileName.endsWith('.png') ? 'image/png' : 'image/webp'
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    })
    .catch((error) => {
      // 失败结果不进入缓存，允许临时网络故障恢复后重新请求。
      previewAssetCache.delete(cacheKey)
      throw error
    })
  previewAssetCache.set(cacheKey, pending)

  // 只保留最近一批目录资源，限制长时间浏览带来的内存增长。
  if (previewAssetCache.size > PREVIEW_ASSET_CACHE_LIMIT) {
    const oldestKey = previewAssetCache.keys().next().value
    if (oldestKey && oldestKey !== cacheKey) previewAssetCache.delete(oldestKey)
  }
  return pending
}

/**
 * 从 ZIP 尾部定位中央目录结束记录。
 * @param {Buffer} archive ZIP 数据。
 * @returns {number} EOCD 记录偏移。
 * @throws {Error} ZIP 结构不完整时抛错。
 */
function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('下载包不是有效 ZIP 文件')
}

/**
 * 读取 ZIP 中受允许的宠物文件并拒绝危险条目。
 * @param {Buffer} archive ZIP 数据。
 * @returns {{petJson: Buffer, spritesheet: Buffer, spritesheetFileName: string}} 安装所需文件。
 * @throws {Error} ZIP 结构、压缩方式、文件大小或文件名不符合约束时抛错。
 */
function readPetArchive(archive) {
  const eocdOffset = findEndOfCentralDirectory(archive)
  const entryCount = archive.readUInt16LE(eocdOffset + 10)
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16)
  if (entryCount < 2 || entryCount > MAX_ZIP_ENTRIES) throw new Error('下载包文件数量异常')

  let cursor = centralDirectoryOffset
  let totalUncompressedBytes = 0
  const selectedEntries = new Map()
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('下载包中央目录损坏')
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const compressionMethod = archive.readUInt16LE(cursor + 10)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localHeaderOffset = archive.readUInt32LE(cursor + 42)
    const fileName = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    const normalizedName = fileName.replace(/\\/g, '/')
    const baseName = path.posix.basename(normalizedName)

    // 所有条目都必须是相对路径，避免恶意 ZIP 越界写入。
    if (
      normalizedName.startsWith('/') ||
      normalizedName.split('/').includes('..') ||
      normalizedName.includes('\0')
    ) {
      throw new Error('下载包包含不安全路径')
    }
    if ((flags & 0x1) !== 0) throw new Error('不支持加密的宠物下载包')
    if (![0, 8].includes(compressionMethod)) throw new Error('下载包使用了不支持的压缩方式')
    totalUncompressedBytes += uncompressedSize
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('下载包解压后超过大小限制')
    }

    if (['pet.json', 'spritesheet.webp', 'spritesheet.png'].includes(baseName)) {
      if (selectedEntries.has(baseName)) throw new Error(`下载包包含重复的 ${baseName}`)
      selectedEntries.set(baseName, {
        compressedSize,
        uncompressedSize,
        compressionMethod,
        localHeaderOffset
      })
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }

  const petEntry = selectedEntries.get('pet.json')
  const spriteName = selectedEntries.has('spritesheet.webp')
    ? 'spritesheet.webp'
    : selectedEntries.has('spritesheet.png')
      ? 'spritesheet.png'
      : null
  if (!petEntry || !spriteName) throw new Error('下载包缺少 pet.json 或 spritesheet')
  if (petEntry.uncompressedSize > MAX_PET_JSON_BYTES) throw new Error('pet.json 超过大小限制')
  const spriteEntry = selectedEntries.get(spriteName)
  if (spriteEntry.uncompressedSize > MAX_SPRITESHEET_BYTES) throw new Error('精灵图超过大小限制')

  return {
    petJson: readZipEntry(archive, petEntry),
    spritesheet: readZipEntry(archive, spriteEntry),
    spritesheetFileName: spriteName
  }
}

/**
 * 根据中央目录信息读取并解压单个 ZIP 条目。
 * @param {Buffer} archive ZIP 数据。
 * @param {{compressedSize: number, uncompressedSize: number, compressionMethod: number, localHeaderOffset: number}} entry 条目元数据。
 * @returns {Buffer} 解压后的文件内容。
 * @throws {Error} 本地文件头或解压后大小不一致时抛错。
 */
function readZipEntry(archive, entry) {
  const offset = entry.localHeaderOffset
  if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('下载包文件头损坏')
  }
  const nameLength = archive.readUInt16LE(offset + 26)
  const extraLength = archive.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > archive.length) throw new Error('下载包文件内容不完整')
  const compressed = archive.subarray(dataStart, dataEnd)
  let output
  try {
    // 在解压阶段限制输出，避免伪造中央目录的压缩包造成超额内存占用。
    output =
      entry.compressionMethod === 0
        ? Buffer.from(compressed)
        : zlib.inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize })
  } catch {
    throw new Error('下载包解压失败或输出超过大小限制')
  }
  if (output.length !== entry.uncompressedSize) throw new Error('下载包解压后大小不一致')
  return output
}

/**
 * 读取 PNG 或 WebP 的像素尺寸。
 * @param {Buffer} image 图片字节。
 * @param {string} fileName 图片文件名。
 * @returns {{width: number, height: number}} 图片尺寸。
 * @throws {Error} 图片头不受支持或已损坏时抛错。
 */
function readImageDimensions(image, fileName) {
  if (fileName.endsWith('.png')) {
    if (image.length < 24 || image.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
      throw new Error('spritesheet.png 文件头无效')
    }
    return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
  }
  if (
    image.length < 30 ||
    image.toString('ascii', 0, 4) !== 'RIFF' ||
    image.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('spritesheet.webp 文件头无效')
  }
  const kind = image.toString('ascii', 12, 16)
  if (kind === 'VP8X') {
    return {
      width: 1 + image.readUIntLE(24, 3),
      height: 1 + image.readUIntLE(27, 3)
    }
  }
  if (kind === 'VP8 ') {
    if (image.toString('hex', 23, 26) !== '9d012a') throw new Error('VP8 图片头无效')
    return {
      width: image.readUInt16LE(26) & 0x3fff,
      height: image.readUInt16LE(28) & 0x3fff
    }
  }
  if (kind === 'VP8L') {
    if (image[20] !== 0x2f) throw new Error('VP8L 图片头无效')
    const bits = image.readUInt32LE(21)
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff)
    }
  }
  throw new Error('不支持的 WebP 图片格式')
}

/**
 * 校验下载内容具有可识别的 MP3 文件头且大小受限。
 * @param {Buffer} sound 音效文件字节。
 * @returns {Buffer} 校验后的原始音效字节。
 * @throws {Error} 文件为空、过大或不是可识别的 MP3 时抛错。
 */
function validatePetSound(sound) {
  const hasId3Header = sound.length >= 3 && sound.toString('ascii', 0, 3) === 'ID3'
  const hasFrameSync = sound.length >= 2 && sound[0] === 0xff && (sound[1] & 0xe0) === 0xe0
  if (!sound.length || sound.length > MAX_SOUND_BYTES || (!hasId3Header && !hasFrameSync)) {
    throw new Error('宠物音效文件无效')
  }
  return sound
}

/**
 * 下载可选宠物音效；音效不可用时降级为无音效安装。
 * @param {string | undefined} soundUrl Petdex 音效地址。
 * @returns {Promise<Buffer | null>} 校验后的 MP3 字节或 null。
 */
async function downloadPetSound(soundUrl) {
  if (!soundUrl) return null
  try {
    return validatePetSound(
      await requestBuffer(assertTrustedAssetUrl(soundUrl), 0, undefined, MAX_SOUND_BYTES)
    )
  } catch (error) {
    // 独立音效故障不能阻断已通过校验的宠物主体安装。
    console.warn('[petdex-desktop-pet] failed to download optional sound', error)
    return null
  }
}

/**
 * 校验宠物元数据和精灵图网格尺寸。
 * @param {Buffer} petJsonBuffer pet.json 文件内容。
 * @param {Buffer} spritesheet 精灵图文件内容。
 * @param {string} spritesheetFileName 精灵图文件名。
 * @param {Record<string, unknown>} catalogPet 搜索接口中的宠物数据。
 * @returns {Record<string, unknown>} 规范化的本地元数据。
 * @throws {Error} 包内标识、版本或图片尺寸不符合协议时抛错。
 */
function validatePetFiles(petJsonBuffer, spritesheet, spritesheetFileName, catalogPet) {
  const petJson = parseJsonBuffer(petJsonBuffer, 'pet.json')
  if (!petJson || typeof petJson !== 'object') throw new Error('pet.json 结构无效')
  const packageId = assertPackageId(petJson.id)
  const spriteVersionNumber = petJson.spriteVersionNumber == null ? 1 : petJson.spriteVersionNumber
  if (![1, 2].includes(spriteVersionNumber)) throw new Error('pet.json 中的精灵图版本无效')

  // 目录数据可能滞后，以 ZIP 内元数据和实际图片尺寸的一致性为安装依据。
  const expectedHeight = spriteVersionNumber === 2 ? 208 * 11 : 208 * 9
  const dimensions = readImageDimensions(spritesheet, spritesheetFileName)
  if (dimensions.width !== 192 * 8 || dimensions.height !== expectedHeight) {
    throw new Error(`精灵图尺寸应为 1536×${expectedHeight}`)
  }
  return {
    // 目录 slug 是 Petdex 的唯一安装身份；包内 ID 可能因重名后缀而保留旧值。
    slug: catalogPet.slug,
    packageId,
    displayName: catalogPet.displayName,
    description: catalogPet.description,
    spriteVersionNumber,
    spritesheetFileName,
    soundFileName: null,
    sourceZipUrl: catalogPet.zipUrl,
    installedAt: new Date().toISOString()
  }
}

/**
 * 把宠物文件写入临时目录并原子替换已有安装。
 * @param {Record<string, unknown>} metadata 本地宠物元数据。
 * @param {Buffer} spritesheet 精灵图内容。
 * @param {Buffer | null} sound 可选 MP3 音效内容。
 * @returns {Promise<Record<string, unknown>>} 安装后的宠物信息。
 * @throws {Error} 文件写入或替换失败时抛错。
 */
async function publishInstalledPet(metadata, spritesheet, sound) {
  const petsRoot = getPetsRoot()
  const finalDirectory = path.join(petsRoot, metadata.slug)
  const temporaryDirectory = path.join(petsRoot, `.${metadata.slug}.install-${crypto.randomUUID()}`)
  const backupDirectory = path.join(petsRoot, `.${metadata.slug}.backup-${crypto.randomUUID()}`)
  await fs.promises.mkdir(temporaryDirectory, { recursive: true })
  try {
    metadata.soundFileName = sound ? 'sound.mp3' : null

    // 临时目录完整落盘后再切换，避免中断留下半安装状态。
    const filesToWrite = [
      fs.promises.writeFile(
        path.join(temporaryDirectory, 'pet.json'),
        JSON.stringify(metadata, null, 2),
        'utf8'
      ),
      fs.promises.writeFile(
        path.join(temporaryDirectory, metadata.spritesheetFileName),
        spritesheet
      )
    ]
    if (sound) {
      filesToWrite.push(fs.promises.writeFile(path.join(temporaryDirectory, 'sound.mp3'), sound))
    }
    await Promise.all(filesToWrite)
    const hasExisting = fs.existsSync(finalDirectory)
    if (hasExisting) await fs.promises.rename(finalDirectory, backupDirectory)
    try {
      await fs.promises.rename(temporaryDirectory, finalDirectory)
    } catch (error) {
      // 发布失败时恢复旧版本，保证当前启用的桌宠仍然可读。
      if (hasExisting && fs.existsSync(backupDirectory)) {
        await fs.promises.rename(backupDirectory, finalDirectory)
      }
      throw error
    }
    if (fs.existsSync(backupDirectory)) {
      await fs.promises.rm(backupDirectory, { recursive: true, force: true })
    }
    return metadata
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

/**
 * 下载、校验并安装一个 Petdex 宠物。
 * @param {unknown} value 前端传入的宠物目录项。
 * @param {(progress: {receivedBytes: number, totalBytes: number | null, percent: number | null}) => void} [onProgress] ZIP 下载进度回调。
 * @returns {Promise<Record<string, unknown>>} 已安装宠物信息。
 * @throws {Error} 宠物数据或下载包不符合安全约束时抛错。
 */
async function installPet(value, onProgress) {
  const pet = normalizePet(value)
  if (onProgress != null && typeof onProgress !== 'function') throw new Error('下载进度回调无效')
  const archive = await requestBuffer(assertTrustedAssetUrl(pet.zipUrl), 0, onProgress)
  const files = readPetArchive(archive)
  const metadata = validatePetFiles(
    files.petJson,
    files.spritesheet,
    files.spritesheetFileName,
    pet
  )
  const sound = await downloadPetSound(pet.soundUrl)
  const installed = await publishInstalledPet(metadata, files.spritesheet, sound)

  // 安装计数失败不能回滚已经安全落盘的本地宠物。
  void requestBuffer(`${PETDEX_ORIGIN}/install/${pet.slug}`).catch(() => undefined)
  return installed
}

/**
 * 读取单个已安装宠物的本地元数据。
 * @param {string} slug 宠物 slug。
 * @returns {Promise<Record<string, unknown>>} 已安装宠物信息。
 * @throws {Error} 本地元数据缺失或损坏时抛错。
 */
async function readInstalledPet(slug) {
  const safeSlug = assertSafeSlug(slug)
  const metadataPath = path.join(getPetsRoot(), safeSlug, 'pet.json')
  const metadata = parseJsonBuffer(await fs.promises.readFile(metadataPath), '本地 pet.json')
  if (!metadata || typeof metadata !== 'object' || metadata.slug !== safeSlug) {
    throw new Error('本地宠物元数据无效')
  }
  return metadata
}

/**
 * 列出所有有效的本地已安装宠物。
 * @returns {Promise<Record<string, unknown>[]>} 按安装时间倒序排列的宠物列表。
 */
async function listInstalledPets() {
  const entries = await fs.promises.readdir(getPetsRoot(), { withFileTypes: true })
  const pets = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^[a-z0-9]/.test(entry.name))
      .map(async (entry) => {
        try {
          const pet = await readInstalledPet(entry.name)
          return {
            ...pet,
            spritesheetUrl: pathToFileURL(
              path.join(getPetsRoot(), pet.slug, pet.spritesheetFileName)
            ).toString(),
            soundUrl: pet.soundFileName
              ? pathToFileURL(path.join(getPetsRoot(), pet.slug, pet.soundFileName)).toString()
              : null
          }
        } catch {
          return null
        }
      })
  )
  return pets
    .filter(Boolean)
    .sort((left, right) => String(right.installedAt).localeCompare(String(left.installedAt)))
}

/**
 * 删除指定已安装宠物目录。
 * @param {string} slug 宠物 slug。
 * @returns {Promise<void>} 删除完成后结束的 Promise。
 */
async function uninstallPet(slug) {
  const safeSlug = assertSafeSlug(slug)
  await fs.promises.rm(path.join(getPetsRoot(), safeSlug), { recursive: true, force: true })
}

/**
 * 把未知配置值合并为受约束的桌宠运行配置。
 * @param {unknown} value 待规范化的配置。
 * @returns {Record<string, unknown>} 规范化后的配置。
 */
function normalizeRuntimeConfig(value) {
  const config = value && typeof value === 'object' ? value : {}
  const activeSlug = config.activeSlug == null ? null : assertSafeSlug(config.activeSlug)
  const position =
    config.position && Number.isFinite(config.position.x) && Number.isFinite(config.position.y)
      ? { x: Math.round(config.position.x), y: Math.round(config.position.y) }
      : null
  return {
    activeSlug,
    enabled: config.enabled === true,
    scale: Number.isFinite(config.scale) ? Math.min(Math.max(config.scale, 0.4), 1.4) : 0.72,
    opacity: Number.isFinite(config.opacity) ? Math.min(Math.max(config.opacity, 0.2), 1) : 1,
    alwaysOnTop: config.alwaysOnTop !== false,
    soundEnabled: config.soundEnabled === true,
    returnToDefaultAnimation: config.returnToDefaultAnimation !== false,
    position
  }
}

/**
 * 通过 ZTools 插件存储读取运行配置。
 * @returns {Promise<Record<string, unknown>>} 桌宠运行配置；没有记录时返回默认值。
 */
async function getRuntimeConfig() {
  const storedConfig = window.ztools.dbStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY)
  return storedConfig == null ? { ...DEFAULT_RUNTIME_CONFIG } : normalizeRuntimeConfig(storedConfig)
}

/**
 * 通过 ZTools 插件存储持久化受约束的桌宠运行配置。
 * @param {unknown} value 待保存的配置。
 * @returns {Promise<Record<string, unknown>>} 已保存的规范化配置。
 */
async function saveRuntimeConfig(value) {
  const config = normalizeRuntimeConfig(value)
  window.ztools.dbStorage.setItem(RUNTIME_CONFIG_STORAGE_KEY, config)
  return config
}

/**
 * 返回桌宠子窗口加载本地精灵图所需的数据。
 * @param {string} slug 宠物 slug。
 * @returns {Promise<Record<string, unknown>>} 宠物信息与本地 file URL。
 * @throws {Error} 宠物未安装或文件不存在时抛错。
 */
async function getPetWindowPayload(slug) {
  const pet = await readInstalledPet(slug)
  const spritesheetPath = path.join(getPetsRoot(), pet.slug, pet.spritesheetFileName)
  await fs.promises.access(spritesheetPath, fs.constants.R_OK)
  const soundPath = pet.soundFileName ? path.join(getPetsRoot(), pet.slug, pet.soundFileName) : null
  if (soundPath) await fs.promises.access(soundPath, fs.constants.R_OK)
  return {
    pet,
    spritesheetUrl: pathToFileURL(spritesheetPath).toString(),
    soundUrl: soundPath ? pathToFileURL(soundPath).toString() : null
  }
}

/**
 * 向桌宠控制页发送拖动或关闭等子窗口事件。
 * @param {string} type 事件类型。
 * @param {Record<string, unknown>} [detail={}] 事件数据。
 * @returns {void} 无返回值。
 */
function emitPetEvent(type, detail = {}) {
  window.ztools.sendToParent('petdex-desktop-pet:event', { type, detail })
}

/**
 * 订阅来自桌宠子窗口的事件并返回取消函数。
 * @param {(payload: {type: string, detail: Record<string, unknown>}) => void} callback 事件回调。
 * @returns {() => void} 取消订阅函数。
 */
function onPetEvent(callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on('petdex-desktop-pet:event', handler)
  return () => ipcRenderer.removeListener('petdex-desktop-pet:event', handler)
}

/**
 * 使用 ZTools 宿主能力显示固定的桌宠原生右键菜单。
 * @returns {Promise<void>} 原生菜单显示后结束的 Promise。
 */
async function showPetContextMenu() {
  await ipcRenderer.invoke('show-context-menu', [
    { id: 'petdex-desktop-pet:zoom-in', label: '放大' },
    { id: 'petdex-desktop-pet:zoom-out', label: '缩小' },
    { id: 'petdex-desktop-pet:opacity-increase', label: '透明度+' },
    { id: 'petdex-desktop-pet:opacity-decrease', label: '透明度-' },
    { id: 'petdex-desktop-pet:close', label: '关闭' }
  ])
}

/**
 * 订阅宿主原生菜单命令并仅转发桌宠允许的固定命令。
 * @param {(command: 'zoom-in' | 'zoom-out' | 'opacity-increase' | 'opacity-decrease' | 'close') => void} callback 菜单命令回调。
 * @returns {() => void} 取消订阅函数。
 */
function onPetContextMenuCommand(callback) {
  const handler = (_event, command) => {
    // 丢弃其他页面或宿主来源的菜单命令，保持桌宠桥接边界可控。
    if (!PET_CONTEXT_MENU_COMMANDS.has(command)) return
    callback(command.slice('petdex-desktop-pet:'.length))
  }
  ipcRenderer.on('context-menu-command', handler)
  return () => ipcRenderer.removeListener('context-menu-command', handler)
}

window.desktopPet = {
  searchPets,
  loadPreviewAsset,
  listInstalledPets,
  installPet,
  uninstallPet,
  getRuntimeConfig,
  saveRuntimeConfig,
  getPetWindowPayload,
  emitPetEvent,
  onPetEvent,
  showPetContextMenu,
  onPetContextMenuCommand
}
