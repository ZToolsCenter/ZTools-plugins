const fs = require('node:fs/promises')
const path = require('node:path')
const exifr = require('exifr')
const { imageSizeFromFile } = require('image-size/fromFile')

const cache = new Map()
const CAPTURE_TAGS = ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']

async function readMetadata(sourcePath, kind = 'all') {
  const wanted = normalizeKind(kind)
  if (!wanted) return { error: '元数据类型无效' }
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    return { error: '文件路径必须是绝对路径' }
  }

  let stats
  try {
    stats = await fs.stat(sourcePath)
    if (!stats.isFile()) return { error: '仅支持文件' }
  } catch (error) {
    return { error: `读取文件信息失败：${messageOf(error)}` }
  }

  const absolutePath = path.resolve(sourcePath)
  const signature = `${stats.mtimeMs}:${stats.size}`
  let entry = cache.get(absolutePath)
  if (!entry || entry.signature !== signature) {
    entry = { signature }
    cache.set(absolutePath, entry)
  }

  const result = {}
  const errors = []
  if (wanted.includes('dimensions')) {
    const outcome = await cachedRead(entry, 'dimensions', () => readDimensions(absolutePath))
    if (outcome.value) result.dimensions = outcome.value
    if (outcome.error) errors.push(`尺寸读取失败：${outcome.error}`)
  }
  if (wanted.includes('capturedAt')) {
    const outcome = await cachedRead(entry, 'capturedAt', () => readCapturedAt(absolutePath))
    if (outcome.value !== undefined) result.capturedAt = outcome.value
    if (outcome.error) errors.push(`拍摄时间读取失败：${outcome.error}`)
  }
  if (errors.length) result.error = errors.join('；')
  return result
}

function normalizeKind(kind) {
  if (kind === undefined || kind === 'all') return ['dimensions', 'capturedAt']
  if (kind === 'dimensions' || kind === 'capturedAt') return [kind]
  return null
}

async function cachedRead(entry, key, read) {
  const taskKey = `${key}Task`
  if (!entry[taskKey]) {
    entry[taskKey] = read()
      .then((value) => ({ value }))
      .catch((error) => ({ error: messageOf(error) }))
  }
  return entry[taskKey]
}

async function readDimensions(sourcePath) {
  const { width, height } = await imageSizeFromFile(sourcePath)
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('图片尺寸无效')
  return `${width}x${height}`
}

async function readCapturedAt(sourcePath) {
  const tags = await exifr.parse(sourcePath, { tiff: false, exif: CAPTURE_TAGS })
  const raw = tags && CAPTURE_TAGS.map((tag) => tags[tag]).find((value) => value !== undefined && value !== null)
  if (raw === undefined) throw new Error('图片不含拍摄时间')
  const date = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error('拍摄时间格式无效')
  return date.getTime()
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function clearMetadataCache() { cache.clear() }

module.exports = { readMetadata, clearMetadataCache }
