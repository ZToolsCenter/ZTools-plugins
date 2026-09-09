import { nanoid } from 'nanoid'
import type { Emoticon } from '@/types'

const IMAGE_EXTENSIONS = new Set(['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const MIME_MAP: Record<string, string> = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

const MAX_SCAN_RESULTS = 5000
const MAX_INDEX_WALK_DEPTH = 4
const MAX_INDEX_FILE_SIZE = 8 * 1024 * 1024
const MAX_IMAGE_FILE_SIZE = 25 * 1024 * 1024
const MIN_CUSTOM_STICKER_SIDE = 96
const LARK_USER_ID_PATTERN = /^[0-9a-f]{24,40}$/i
const LARK_CUSTOM_STICKER_KEY_PATTERN = /^[0-9a-f-]{32,}g?$/i
const VERIFIED_INDEX_MARKERS = [
  'customizedStickers',
  'userStickerSets',
  'PULL_STICKERS',
  'PULL_STICKER_SETS'
]

const LARK_STICKER_DIR_NAMES = new Set([
  'customizedstickers',
  'stickers',
  'sticker',
  'customstickers'
])

export interface LarkScanResult {
  name: string
  filePath: string
  type: string
}

export interface LarkDetectResult {
  found: boolean
  path: string
  description: string
}

interface LarkIndexSticker {
  name: string
  keys: string[]
}

interface LarkUserStorage {
  path: string
  desc: string
  stickerPath: string
  imageCount: number
  lastModified: number
}

function getFs() {
  return (window as any).preload.fs
}

function getHomePath(): string {
  try {
    return (window as any).ztools.getPath('home')
  } catch {
    return ''
  }
}

function getAppDataPath(): string {
  try {
    return (window as any).ztools.getPath('appData')
  } catch {
    return ''
  }
}

function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function getBaseName(filePath: string): string {
  const parts = filePath.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || filePath
}

function getFileStem(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(0, dot) : filename
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, '')
}

function joinPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  return [basePath.replace(/[\\/]+$/, ''), ...segments].join(separator)
}

function pathExists(dirPath: string): boolean {
  const fs = getFs()
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

function isImageExtension(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExt(filename))
}

function getMimeTypeByExtension(filename: string): string {
  return MIME_MAP[getExt(filename)] || 'image/png'
}

function isLikelyVersionedStickerCache(filename: string): boolean {
  const normalized = filename.toLowerCase()
  return normalized.startsWith('v2_') || normalized.startsWith('v3_')
}

function isLikelyCustomStickerFilename(filename: string): boolean {
  if (!isImageExtension(filename) || isLikelyVersionedStickerCache(filename)) return false
  return LARK_CUSTOM_STICKER_KEY_PATTERN.test(getFileStem(filename))
}

function isDirectory(dirPath: string): boolean {
  const fs = getFs()
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

function getImageSize(filePath: string): { width: number; height: number } | null {
  const fs = getFs()

  try {
    const buffer = fs.readFileSync(filePath)
    if (!buffer || buffer.length < 10) return null

    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer.length >= 24
    ) {
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
      }
    }

    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38 &&
      buffer.length >= 10
    ) {
      return {
        width: buffer.readUInt16LE(6),
        height: buffer.readUInt16LE(8)
      }
    }

    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break
        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        if (length < 2) break

        if (marker >= 0xc0 && marker <= 0xc3) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7)
          }
        }

        offset += 2 + length
      }
    }
  } catch {
    return null
  }

  return null
}

function isLargeEnoughCustomSticker(filePath: string): boolean {
  const size = getImageSize(filePath)
  if (!size) return true
  return Math.max(size.width, size.height) >= MIN_CUSTOM_STICKER_SIDE
}

function isStickerDirectory(dirPath: string): boolean {
  const parts = dirPath.split(/[\\/]+/).map(normalizeText)
  const lastPart = parts[parts.length - 1]
  const parentPart = parts[parts.length - 2]
  return lastPart === 'stickers' && parentPart === 'resources'
}

function isLikelyLarkUserStorage(dirPath: string): boolean {
  return pathExists(joinPath(dirPath, 'resources', 'stickers'))
}

function readTextFile(filePath: string): string | null {
  const fs = getFs()

  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INDEX_FILE_SIZE) return null

    const value = fs.readFileSync(filePath, 'utf8')
    return typeof value === 'string' ? value : String(value)
  } catch {
    return null
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function collectImageKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || keys.size >= MAX_SCAN_RESULTS) return keys

  if (typeof value === 'string') {
    if (/^(v[23]_[0-9a-z_]+-)|([0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12})/i.test(value)) {
      keys.add(value)
    }
    return keys
  }

  if (Array.isArray(value)) {
    for (const item of value) collectImageKeys(item, keys)
    return keys
  }

  if (typeof value !== 'object') return keys

  const record = value as Record<string, unknown>
  for (const field of ['key', 'originKey', 'middleKey', 'thumbKey']) {
    collectImageKeys(record[field], keys)
  }

  for (const field of ['image', 'origin', 'thumbnail', 'middle', 'thumbnailWebp', 'middleWebp']) {
    collectImageKeys(record[field], keys)
  }

  return keys
}

function getStickerName(value: Record<string, unknown>, fallback: string): string {
  for (const field of ['description', 'name', 'title', 'stickerId', 'stickerSetId']) {
    const raw = value[field]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }

  return fallback
}

function collectStickerEntries(value: unknown, entries: LarkIndexSticker[] = []): LarkIndexSticker[] {
  if (!value || entries.length >= MAX_SCAN_RESULTS) return entries

  if (Array.isArray(value)) {
    for (const item of value) collectStickerEntries(item, entries)
    return entries
  }

  if (typeof value !== 'object') return entries

  const record = value as Record<string, unknown>

  if (record.image || record.stickerId || record.stickerSetId) {
    const keys = [...collectImageKeys(record)]
    if (keys.length > 0) {
      entries.push({
        name: getStickerName(record, keys[0]),
        keys
      })
    }
  }

  for (const field of ['customizedStickers', 'stickers', 'userStickerSets', 'stickerSets']) {
    collectStickerEntries(record[field], entries)
  }

  return entries
}

function extractVerifiedStickerIndex(filePath: string): LarkIndexSticker[] {
  const text = readTextFile(filePath)
  if (!text || !VERIFIED_INDEX_MARKERS.some(marker => text.includes(marker))) return []

  const jsonStart = text.search(/[\[{]/)
  const jsonEnd = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (jsonStart === -1 || jsonEnd <= jsonStart) return []

  const parsed = tryParseJson(text.slice(jsonStart, jsonEnd + 1))
  if (!parsed) return []

  return collectStickerEntries(parsed)
}

function findVerifiedIndexFiles(basePath: string): string[] {
  const fs = getFs()
  const results: string[] = []
  const seen = new Set<string>()

  function walk(dirPath: string, depth = 0) {
    if (depth > MAX_INDEX_WALK_DEPTH || results.length >= MAX_SCAN_RESULTS) return

    let entries: string[]
    try {
      entries = fs.readdirSync(dirPath)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const fullPath = joinPath(dirPath, entry)

      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          walk(fullPath, depth + 1)
          continue
        }

        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INDEX_FILE_SIZE) continue
        if (seen.has(fullPath)) continue

        const text = readTextFile(fullPath)
        if (text && VERIFIED_INDEX_MARKERS.some(marker => text.includes(marker))) {
          seen.add(fullPath)
          results.push(fullPath)
        }
      } catch {
        // Skip unreadable entries.
      }
    }
  }

  walk(basePath)
  return results
}

function findStickerSourcePaths(basePath: string): string[] {
  const fs = getFs()
  const results: string[] = []
  const seen = new Set<string>()

  function addIfStickerPath(dirPath: string) {
    if (seen.has(dirPath)) return
    if (!isStickerDirectory(dirPath)) return
    if (!pathExists(dirPath)) return

    seen.add(dirPath)
    results.push(dirPath)
  }

  addIfStickerPath(basePath)
  addIfStickerPath(joinPath(basePath, 'resources', 'stickers'))

  function walk(dirPath: string, depth = 0, maxDepth = 6) {
    if (depth > maxDepth) return

    try {
      const entries = fs.readdirSync(dirPath)
      for (const entry of entries) {
        if (entry.startsWith('.')) continue

        const fullPath = joinPath(dirPath, entry)
        let isDirectory = false
        try {
          isDirectory = fs.statSync(fullPath).isDirectory()
        } catch {
          continue
        }
        if (!isDirectory) continue

        addIfStickerPath(fullPath)
        if (isStickerDirectory(fullPath)) continue

        walk(fullPath, depth + 1, maxDepth)
      }
    } catch {
      // Directory not readable.
    }
  }

  walk(basePath)
  return results
}

function findStickerSourcePathsFlexible(basePath: string): string[] {
  const fs = getFs()
  const results: string[] = []
  const seen = new Set<string>()

  function addIfExists(dirPath: string) {
    if (seen.has(dirPath)) return
    seen.add(dirPath)
    if (pathExists(dirPath)) results.push(dirPath)
  }

  // 1) Existing strict structure-based detection
  for (const p of findStickerSourcePaths(basePath)) addIfExists(p)

  // 2) Name-based detection for common Lark sticker directories
  function walkByName(dirPath: string, depth = 0) {
    if (depth > MAX_INDEX_WALK_DEPTH) return

    let entries: string[]
    try {
      entries = fs.readdirSync(dirPath)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const fullPath = joinPath(dirPath, entry)

      let isDir = false
      try {
        isDir = fs.statSync(fullPath).isDirectory()
      } catch {
        continue
      }
      if (!isDir) continue

      if (LARK_STICKER_DIR_NAMES.has(normalizeText(entry))) {
        addIfExists(fullPath)
      }

      walkByName(fullPath, depth + 1)
    }
  }

  walkByName(basePath)
  return results
}

function scanStickerImages(dirPaths: string[], customizedOnly = false): LarkScanResult[] {
  const fs = getFs()
  const results: LarkScanResult[] = []
  const seen = new Set<string>()

  for (const dirPath of dirPaths) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dirPath)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (results.length >= MAX_SCAN_RESULTS) return results
      if (entry.startsWith('.') || !isImageExtension(entry)) continue
      if (customizedOnly && !isLikelyCustomStickerFilename(entry)) continue

      const fullPath = joinPath(dirPath, entry)
      if (seen.has(fullPath)) continue

      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_FILE_SIZE) continue
        if (customizedOnly && !isLargeEnoughCustomSticker(fullPath)) continue

        seen.add(fullPath)
        results.push({
          name: getFileStem(entry),
          filePath: fullPath,
          type: getMimeTypeByExtension(entry)
        })
      } catch {
        // Skip unreadable files
      }
    }
  }

  return results
}

function countCustomizedStickerImages(dirPath: string): number {
  return scanStickerImages([dirPath], false).length
}

function getStickerCacheByKey(stickerPaths: string[]): Map<string, string> {
  const fs = getFs()
  const result = new Map<string, string>()

  for (const stickerPath of stickerPaths) {
    let entries: string[]
    try {
      entries = fs.readdirSync(stickerPath)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || !isImageExtension(entry)) continue
      const fullPath = joinPath(stickerPath, entry)

      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_FILE_SIZE) continue

        const stem = getFileStem(entry)
        result.set(stem, fullPath)
      } catch {
        // Skip unreadable entries.
      }
    }
  }

  return result
}

function resolveStickerFile(keys: string[], cacheByKey: Map<string, string>): string | null {
  for (const key of keys) {
    const exact = cacheByKey.get(key)
    if (exact) return exact
  }

  return null
}

function scanFromVerifiedIndexes(basePath: string): LarkScanResult[] {
  if (isLikelyLarkUserStorage(basePath)) {
    return scanStickerImages([joinPath(basePath, 'resources', 'stickers')], false)
  }

  const stickerPaths = findStickerSourcePathsFlexible(basePath)
  if (stickerPaths.length === 0) return []

  // Try strict index-based matching first
  const indexFiles = findVerifiedIndexFiles(basePath)
  if (indexFiles.length > 0) {
    const cacheByKey = getStickerCacheByKey(stickerPaths)
    const results: LarkScanResult[] = []

    for (const indexFile of indexFiles) {
      const stickers = extractVerifiedStickerIndex(indexFile)
      for (const sticker of stickers) {
        if (results.length >= MAX_SCAN_RESULTS) return dedupeScans(results)

        const filePath = resolveStickerFile(sticker.keys, cacheByKey)
        if (!filePath) continue

        results.push({
          name: sticker.name || getBaseName(filePath),
          filePath,
          type: getMimeTypeByExtension(filePath)
        })
      }
    }

    const deduped = dedupeScans(results)
    if (deduped.length > 0) return deduped
  }

  return scanStickerImages(stickerPaths, false)
}

function dedupeScans<T extends { filePath: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.filePath)) return false
    seen.add(item.filePath)
    return true
  })
}

function getSdkStorageCandidates(): Array<{ path: string; desc: string }> {
  const home = getHomePath()
  const appData = getAppDataPath()
  if (!home) return []

  const isWindows = home.includes('\\') || home.indexOf(':') === 1
  const candidates: Array<{ path: string; desc: string }> = []

  if (isWindows) {
    const appDataRoots = [
      appData,
      `${home}\\AppData\\Roaming`,
      `${home}\\AppData\\Local`
    ].filter(Boolean)

    for (const root of appDataRoots) {
      candidates.push(
        { path: `${root}\\LarkShell\\sdk_storage`, desc: '飞书 SDK 数据' },
        { path: `${root}\\Feishu\\sdk_storage`, desc: '飞书 SDK 数据' },
        { path: `${root}\\Lark\\sdk_storage`, desc: 'Lark SDK 数据' }
      )
    }
  } else {
    const containerIds = [
      'com.bytedance.macos.feishu',
      'com.larkoffice.Lark',
      'com.larksuite.desktop',
      'com.electron.lark'
    ]

    for (const bundleId of containerIds) {
      const root = `${home}/Library/Containers/${bundleId}/Data/Library`
      candidates.push(
        { path: `${root}/Application Support/LarkShell/sdk_storage`, desc: '飞书 SDK 数据' }
      )
    }

    candidates.push(
      { path: `${home}/Library/Application Support/LarkShell/sdk_storage`, desc: '飞书 SDK 数据' },
      { path: `${home}/Library/Application Support/Feishu/sdk_storage`, desc: '飞书 SDK 数据' },
      { path: `${home}/Library/Application Support/Lark/sdk_storage`, desc: 'Lark SDK 数据' }
    )
  }

  const seen = new Set<string>()
  return candidates.filter(item => {
    if (seen.has(item.path)) return false
    seen.add(item.path)
    return true
  })
}

function getLarkUserStorages(): LarkUserStorage[] {
  const fs = getFs()
  const results: LarkUserStorage[] = []
  const seen = new Set<string>()

  function addUserStorage(dirPath: string, desc: string) {
    if (seen.has(dirPath) || !isLikelyLarkUserStorage(dirPath)) return

    const stickerPath = joinPath(dirPath, 'resources', 'stickers')
    let lastModified = 0
    try {
      lastModified = fs.statSync(dirPath).mtimeMs || 0
    } catch {
      // Keep default value.
    }

    seen.add(dirPath)
    results.push({
      path: dirPath,
      desc,
      stickerPath,
      imageCount: countCustomizedStickerImages(stickerPath),
      lastModified
    })
  }

  for (const candidate of getSdkStorageCandidates()) {
    if (!pathExists(candidate.path)) continue

    addUserStorage(candidate.path, candidate.desc)

    let entries: string[]
    try {
      entries = fs.readdirSync(candidate.path)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'settings') continue
      if (!LARK_USER_ID_PATTERN.test(entry) && normalizeText(entry) !== 'global') continue

      const userPath = joinPath(candidate.path, entry)
      if (isDirectory(userPath)) {
        addUserStorage(userPath, `${candidate.desc} (${entry})`)
      }
    }
  }

  return results.sort((a, b) => {
    if (b.imageCount !== a.imageCount) return b.imageCount - a.imageCount
    return b.lastModified - a.lastModified
  })
}

function getScanBasePath(dirPath: string): string {
  if (isLikelyLarkUserStorage(dirPath)) return dirPath

  const stickerSource = findStickerSourcePaths(dirPath)[0]
  if (stickerSource && isStickerDirectory(stickerSource)) {
    const parts = stickerSource.split(/[\\/]+/)
    return parts.slice(0, -2).join(stickerSource.includes('\\') ? '\\' : '/')
  }

  return dirPath
}

export function detectLarkPath(): LarkDetectResult[] {
  const best = getLarkUserStorages()[0]
  if (!best) return []

  return [{
    found: true,
    path: best.path,
    description: best.imageCount > 0
      ? `${best.desc} - 发现 ${best.imageCount} 张飞书表情`
      : `${best.desc} - 已找到用户表情目录，未发现图片文件`
  }]
}

export function scanLarkEmoticons(dirPath: string): LarkScanResult[] {
  const basePath = getScanBasePath(dirPath)
  return scanFromVerifiedIndexes(basePath)
}

export function readFileAsBlob(filePath: string, mimeType: string): Blob {
  const fs = getFs()
  const buffer = fs.readFileSync(filePath)
  const uint8 = new Uint8Array(buffer)
  return new Blob([uint8], { type: mimeType })
}

export function createLarkImportItem(item: LarkScanResult): { emoticon: Emoticon; file: Blob } | null {
  try {
    const blob = readFileAsBlob(item.filePath, item.type)
    if (blob.size === 0) return null

    const now = Date.now()
    const emoticon: Emoticon = {
      id: nanoid(),
      name: item.name || getBaseName(item.filePath),
      url: '',
      type: item.type,
      tags: [],
      favorite: false,
      source: 'feishu',
      createdAt: now,
      createTime: now,
      updateTime: now
    }

    return { emoticon, file: blob }
  } catch (err) {
    console.warn(`Failed to read Feishu file: ${item.filePath}`, err)
    return null
  }
}

export function importFromLarkPath(
  dirPath: string,
  onProgress?: (current: number, total: number) => void
): { emoticon: Emoticon; file: Blob }[] {
  const scanned = scanLarkEmoticons(dirPath)
  const results: { emoticon: Emoticon; file: Blob }[] = []

  for (let i = 0; i < scanned.length; i++) {
    const item = createLarkImportItem(scanned[i])
    if (item) results.push(item)

    onProgress?.(i + 1, scanned.length)
  }

  return results
}
