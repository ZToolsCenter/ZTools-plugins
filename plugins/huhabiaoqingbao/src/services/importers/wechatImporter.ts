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

// File header magic bytes for extension-less files
const FILE_SIGNATURES: Array<{ bytes: number[]; ext: string }> = [
  { bytes: [0xff, 0xd8, 0xff], ext: '.jpg' },       // JPEG
  { bytes: [0x89, 0x50, 0x4e, 0x47], ext: '.png' }, // PNG
  { bytes: [0x47, 0x49, 0x46], ext: '.gif' },       // GIF
  { bytes: [0x52, 0x49, 0x46, 0x46], ext: '.webp' } // WEBP (RIFF)
]

const WECHAT_NON_EMOTICON_DIR_KEYWORDS = [
  'avatar',
  'cache',
  'chatimg',
  'chatimage',
  'download',
  'filerecv',
  'head',
  'image',
  'photo',
  'picture',
  'screenshot',
  'temp',
  'thumbnail',
  'thumb',
  'video',
  'wallpaper'
]

export interface WechatScanResult {
  name: string
  filePath: string
  type: string
}

export interface WechatDetectResult {
  found: boolean
  path: string
  description: string
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

function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function getBaseName(filePath: string): string {
  const parts = filePath.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || filePath
}

function normalizePathSegment(segment: string): string {
  return segment.toLowerCase().replace(/[\s_-]/g, '')
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExt(filename))
}

function shouldSkipWechatDirectory(dirname: string): boolean {
  const normalized = normalizePathSegment(dirname)
  return WECHAT_NON_EMOTICON_DIR_KEYWORDS.some(keyword => normalized.includes(keyword))
}

function joinPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  return [basePath.replace(/[\\/]+$/, ''), ...segments].join(separator)
}

function getMimeType(filename: string): string {
  return MIME_MAP[getExt(filename)] || 'image/png'
}

/**
 * Detect image type from file header bytes for extension-less files.
 */
function detectImageType(filePath: string): string | null {
  try {
    const fs = getFs()
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(12)
    const bytesRead = fs.readSync(fd, buffer, 0, 12, 0)
    fs.closeSync(fd)

    if (bytesRead < 4) return null

    for (const sig of FILE_SIGNATURES) {
      let match = true
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[i] !== sig.bytes[i]) {
          match = false
          break
        }
      }
      if (match) return MIME_MAP[sig.ext] || 'image/png'
    }

    return null
  } catch {
    return null
  }
}

/**
 * Scan a directory for image files (with or without extensions).
 * For WeChat's CustomEmotions, files often have no extension.
 */
function scanFilesInDirectory(dirPath: string, depth = 0, maxDepth = 2): WechatScanResult[] {
  if (depth > maxDepth) return []

  const fs = getFs()
  const results: WechatScanResult[] = []

  try {
    const entries = fs.readdirSync(dirPath)
    for (const entry of entries) {
      if (entry.startsWith('.')) continue

      const fullPath = joinPath(dirPath, entry)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          if (shouldSkipWechatDirectory(entry)) continue
          results.push(...scanFilesInDirectory(fullPath, depth + 1, maxDepth))
        } else if (stat.isFile()) {
          const ext = getExt(entry)
          if (ext && IMAGE_EXTENSIONS.has(ext)) {
            // File with image extension
            results.push({
              name: entry,
              filePath: fullPath,
              type: getMimeType(entry)
            })
          } else if (!ext && stat.size > 100 && stat.size < 25 * 1024 * 1024) {
            // Extensionless file - check if it's an image by header
            const detectedType = detectImageType(fullPath)
            if (detectedType) {
              results.push({
                name: entry,
                filePath: fullPath,
                type: detectedType
              })
            }
          }
        }
      } catch {
        // Skip files that can't be accessed
      }
    }
  } catch {
    // Directory not readable
  }

  return results
}

/**
 * Find WeChat emoticon source paths under a base directory.
 * Looks for:
 *   - CustomEmotions/ (custom emoticons, Windows style)
 *   - FileStorage/Stickers/ (sticker packs)
 *   - CustomStickers/ or customStickers/ (macOS style)
 */
function getWechatEmoticonSourcePaths(basePath: string): string[] {
  const fs = getFs()
  const results: string[] = []
  const seen = new Set<string>()

  function addIfExists(dirPath: string) {
    if (seen.has(dirPath)) return
    try {
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        seen.add(dirPath)
        results.push(dirPath)
      }
    } catch {
      // Skip inaccessible paths
    }
  }

  // Check if basePath itself is an emoticon directory
  const baseName = getBaseName(basePath)
  const normalizedBaseName = normalizePathSegment(baseName)
  if (normalizedBaseName === 'customemotions' || normalizedBaseName === 'stickers' || normalizedBaseName === 'customstickers') {
    addIfExists(basePath)
    return results
  }

  // Walk up to 4 levels to find emoticon directories
  function walk(dirPath: string, depth = 0, maxDepth = 4) {
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

        const normalized = normalizePathSegment(entry)

        // Found CustomEmotions directory
        if (normalized === 'customemotions') {
          addIfExists(fullPath)
          continue
        }

        // Found Stickers directory
        if (normalized === 'stickers') {
          addIfExists(fullPath)
          continue
        }

        // Found custom sticker directories
        if (normalized === 'customstickers' || normalized === 'customizedstickers') {
          addIfExists(fullPath)
          continue
        }

        // Skip non-emoticon directories
        if (shouldSkipWechatDirectory(entry)) continue

        walk(fullPath, depth + 1, maxDepth)
      }
    } catch {
      // Directory not readable
    }
  }

  walk(basePath)
  return results
}

/**
 * Detect WeChat emoticon directories on the current system.
 */
export function detectWechatPath(): WechatDetectResult[] {
  const results: WechatDetectResult[] = []
  const fs = getFs()
  const home = getHomePath()
  if (!home) return results

  const isWindows = home.includes('\\') || home.indexOf(':') === 1

  if (!isWindows) {
    // macOS WeChat paths
    const macBase = `${home}/Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat`
    if (fs.existsSync(macBase)) {
      try {
        // WeChat stores data in version-named subdirectories
        const entries = fs.readdirSync(macBase)
        for (const entry of entries) {
          if (entry.startsWith('.')) continue
          const fullPath = joinPath(macBase, entry)
          try {
            if (!fs.statSync(fullPath).isDirectory()) continue
          } catch { continue }

          const sourcePaths = getWechatEmoticonSourcePaths(fullPath)
          for (const sourcePath of sourcePaths) {
            const imageFiles = scanFilesInDirectory(sourcePath)
            const dirLabel = getBaseName(sourcePath)
            results.push({
              found: true,
              path: sourcePath,
              description: `微信 (${dirLabel}) - 发现 ${imageFiles.length} 张表情`
            })
          }
        }
      } catch { /* skip */ }
    }

    // macOS alternative path
    const macAltBase = `${home}/Library/Application Support/com.tencent.xinWeChat`
    if (fs.existsSync(macAltBase)) {
      try {
        const entries = fs.readdirSync(macAltBase)
        for (const entry of entries) {
          if (entry.startsWith('.')) continue
          const fullPath = joinPath(macAltBase, entry)
          try {
            if (!fs.statSync(fullPath).isDirectory()) continue
          } catch { continue }

          const sourcePaths = getWechatEmoticonSourcePaths(fullPath)
          for (const sourcePath of sourcePaths) {
            const imageFiles = scanFilesInDirectory(sourcePath)
            const dirLabel = getBaseName(sourcePath)
            results.push({
              found: true,
              path: sourcePath,
              description: `微信 (${dirLabel}) - 发现 ${imageFiles.length} 张表情`
            })
          }
        }
      } catch { /* skip */ }
    }
  } else {
    // Windows WeChat paths
    const winPaths = [
      `${home}\\Documents\\WeChat Files`,
      `${home}\\AppData\\Local\\Tencent\\WeChat`
    ]

    for (const basePath of winPaths) {
      if (!fs.existsSync(basePath)) continue
      try {
        const entries = fs.readdirSync(basePath)
        for (const entry of entries) {
          if (entry === 'All Users' || entry.startsWith('.')) continue
          const subPath = joinPath(basePath, entry)
          try {
            if (!fs.statSync(subPath).isDirectory()) continue
          } catch { continue }

          // Check for CustomEmotions (Windows custom emoticons)
          const customEmotions = joinPath(subPath, 'CustomEmotions')
          if (fs.existsSync(customEmotions)) {
            const imageFiles = scanFilesInDirectory(customEmotions)
            results.push({
              found: true,
              path: customEmotions,
              description: `微信 (${entry} 自定义表情) - 发现 ${imageFiles.length} 张表情`
            })
          }

          // Check for FileStorage/Stickers
          const fileStorageStickers = joinPath(subPath, 'FileStorage', 'Stickers')
          if (fs.existsSync(fileStorageStickers)) {
            const imageFiles = scanFilesInDirectory(fileStorageStickers)
            results.push({
              found: true,
              path: fileStorageStickers,
              description: `微信 (${entry} 表情包) - 发现 ${imageFiles.length} 张表情`
            })
          }
        }
      } catch { /* skip */ }
    }
  }

  return results
}

/**
 * Scan a directory for WeChat emoticon files and return results.
 */
export function scanWechatEmoticons(dirPath: string): WechatScanResult[] {
  const scanned = scanFilesInDirectory(dirPath)
  const seen = new Set<string>()
  return scanned.filter(item => {
    if (seen.has(item.filePath)) return false
    seen.add(item.filePath)
    return true
  })
}

/**
 * Read a file from disk and convert to Blob.
 */
function readFileAsBlob(filePath: string, mimeType: string): Blob {
  const fs = getFs()
  const buffer = fs.readFileSync(filePath)
  const uint8 = new Uint8Array(buffer)
  return new Blob([uint8], { type: mimeType })
}

export function createWechatImportItem(item: WechatScanResult): { emoticon: Emoticon; file: Blob } | null {
  try {
    const blob = readFileAsBlob(item.filePath, item.type)
    if (blob.size === 0) return null

    const now = Date.now()
    const emoticon: Emoticon = {
      id: nanoid(),
      name: item.name,
      url: '',
      type: item.type,
      tags: [],
      favorite: false,
      source: 'wechat',
      createdAt: now,
      createTime: now,
      updateTime: now
    }

    return { emoticon, file: blob }
  } catch (err) {
    console.warn(`Failed to read file: ${item.filePath}`, err)
    return null
  }
}
