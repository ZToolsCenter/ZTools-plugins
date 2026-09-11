import { nanoid } from 'nanoid'
import type { Emoticon } from '@/types'

const IMAGE_EXTENSIONS = new Set(['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const QQ_LEGACY_PERSONAL_EMOTICON_DIR_NAMES = new Set([
  'customface',
  'roamingcustomface'
])
const QQ_BUILT_IN_EMOTICON_DIR_NAMES = new Set([
  'emoji',
  'emoticon',
  'emotion',
  'face',
  'facestore',
  'facesource',
  'sticker',
  '表情',
  '贴纸'
])
const QQ_NON_EMOTICON_DIR_KEYWORDS = [
  'avatar',
  'cache',
  'chatimg',
  'chatimage',
  'download',
  'filerecv',
  'grouphead',
  'head',
  'image',
  'photo',
  'picture',
  'qzone',
  'richmedia',
  'screenshot',
  'temp',
  'thumbnail',
  'thumb',
  'video',
  'wallpaper'
]
const MIME_MAP: Record<string, string> = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

export interface ScanResult {
  name: string
  filePath: string
  type: string
}

export interface QQDetectResult {
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

function isQQPersonalEmoticonSourceDirectory(dirname: string): boolean {
  const normalized = normalizePathSegment(dirname)
  return QQ_LEGACY_PERSONAL_EMOTICON_DIR_NAMES.has(normalized)
}

function shouldSkipQQDirectory(dirname: string): boolean {
  const normalized = normalizePathSegment(dirname)
  return QQ_NON_EMOTICON_DIR_KEYWORDS.some(keyword => normalized.includes(keyword))
}

function shouldSkipQQBuiltInEmoticonDirectory(dirname: string): boolean {
  const normalized = normalizePathSegment(dirname)
  return QQ_BUILT_IN_EMOTICON_DIR_NAMES.has(normalized)
}

function joinPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  return [basePath.replace(/[\\/]+$/, ''), ...segments].join(separator)
}

function getMimeType(filename: string): string {
  return MIME_MAP[getExt(filename)] || 'image/png'
}

function isPersonalEmojiOriDirectory(dirPath: string): boolean {
  const normalizedParts = dirPath.split(/[\\/]+/).map(normalizePathSegment)
  const lastPart = normalizedParts[normalizedParts.length - 1]
  const parentPart = normalizedParts[normalizedParts.length - 2]
  return lastPart === 'ori' && parentPart === 'personalemoji'
}

function isQQPersonalEmoticonSourcePath(dirPath: string): boolean {
  return isQQPersonalEmoticonSourceDirectory(getBaseName(dirPath)) || isPersonalEmojiOriDirectory(dirPath)
}

function getQQPersonalSourcePaths(basePath: string): string[] {
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

  if (isQQPersonalEmoticonSourcePath(basePath)) {
    addIfExists(basePath)
    return results
  }

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

        const normalizedEntry = normalizePathSegment(entry)
        if (isQQPersonalEmoticonSourceDirectory(entry)) {
          addIfExists(fullPath)
          continue
        }

        if (normalizedEntry === 'personalemoji') {
          addIfExists(joinPath(fullPath, 'Ori'))
          continue
        }

        if (isPersonalEmojiOriDirectory(fullPath)) {
          addIfExists(fullPath)
          continue
        }

        if (shouldSkipQQDirectory(entry)) continue
        if (['baseemojisyastems', 'emojirelated', 'emojirecv', 'emojiresource', 'marketface', 'pokeface'].includes(normalizedEntry)) {
          continue
        }

        walk(fullPath, depth + 1, maxDepth)
      }
    } catch {
      // Directory not readable
    }
  }

  walk(basePath)
  return results
}

function scanFilesInDirectory(dirPath: string, depth = 0, maxDepth = 3): ScanResult[] {
  if (depth > maxDepth) return []

  const fs = getFs()
  const results: ScanResult[] = []

  try {
    const entries = fs.readdirSync(dirPath)
    for (const entry of entries) {
      if (entry.startsWith('.')) continue

      const fullPath = joinPath(dirPath, entry)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          if (shouldSkipQQDirectory(entry) || shouldSkipQQBuiltInEmoticonDirectory(entry)) continue
          results.push(...scanFilesInDirectory(fullPath, depth + 1, maxDepth))
        } else if (stat.isFile() && isImageFile(entry)) {
          results.push({
            name: entry,
            filePath: fullPath,
            type: getMimeType(entry)
          })
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

function scanQQPersonalEmoticons(dirPath: string): ScanResult[] {
  const sourcePaths = getQQPersonalSourcePaths(dirPath)
  return sourcePaths.flatMap(sourcePath => scanFilesInDirectory(sourcePath))
}

/**
 * Detect QQ emoticon directories on the current system.
 */
export function detectQQPath(): QQDetectResult[] {
  const results: QQDetectResult[] = []
  const fs = getFs()
  const home = getHomePath()
  if (!home) return results

  const isWindows = home.includes('\\') || home.indexOf(':') === 1

  if (!isWindows) {
    // macOS QQ paths
    const macPaths = [
      {
        path: `${home}/Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ`,
        desc: 'QQ 桌面版 (Mac)'
      },
      {
        path: `${home}/Library/Containers/com.tencent.qq/Data/Documents/QQ`,
        desc: 'QQ 旧版 (Mac)'
      }
    ]

    for (const { path: basePath, desc } of macPaths) {
      if (fs.existsSync(basePath)) {
        const imageFiles = scanQQPersonalEmoticons(basePath)
        if (imageFiles.length > 0) {
          results.push({ found: true, path: basePath, description: `${desc} - 发现 ${imageFiles.length} 张个人添加 QQ 表情` })
        } else {
          results.push({ found: true, path: basePath, description: `${desc} - 已找到目录，未发现个人添加 QQ 表情` })
        }
      }
    }
  } else {
    // Windows QQ paths
    const docsPaths = [
      `${home}\\Documents\\Tencent Files`,
      `${home}\\AppData\\Local\\Tencent\\QQ`
    ]

    for (const basePath of docsPaths) {
      if (fs.existsSync(basePath)) {
        try {
          const entries = fs.readdirSync(basePath)
          for (const entry of entries) {
            if (entry === 'All Users' || entry.startsWith('.')) continue
            const subPath = `${basePath}\\${entry}`
            try {
              const stat = fs.statSync(subPath)
              if (stat.isDirectory()) {
                // Check for CustomFace directory
                const customFace = `${subPath}\\CustomFace`
                if (fs.existsSync(customFace)) {
                  const imageFiles = scanQQPersonalEmoticons(customFace)
                  results.push({
                    found: true,
                    path: customFace,
                    description: `QQ (${entry}) - 发现 ${imageFiles.length} 张个人添加 QQ 表情`
                  })
                }

                const roamingCustomFace = `${subPath}\\RoamingCustomFace`
                if (fs.existsSync(roamingCustomFace)) {
                  const imageFiles = scanQQPersonalEmoticons(roamingCustomFace)
                  results.push({
                    found: true,
                    path: roamingCustomFace,
                    description: `QQ (${entry}) - 发现 ${imageFiles.length} 张漫游个人 QQ 表情`
                  })
                }
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    }
  }

  return results
}

/**
 * Scan a directory for image files and return results.
 */
export function scanEmoticons(dirPath: string): ScanResult[] {
  const scanned = scanQQPersonalEmoticons(dirPath)
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
export function readFileAsBlob(filePath: string, mimeType: string): Blob {
  const fs = getFs()
  const buffer = fs.readFileSync(filePath)
  // buffer is a Node.js Buffer, convert to Uint8Array for Blob
  const uint8 = new Uint8Array(buffer)
  return new Blob([uint8], { type: mimeType })
}

export function createImportItem(item: ScanResult): { emoticon: Emoticon; file: Blob } | null {
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
      source: 'qq',
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

/**
 * Import emoticons from a directory.
 * Returns an array of { emoticon, file } pairs ready for store.addEmoticon().
 */
export function importFromPath(
  dirPath: string,
  onProgress?: (current: number, total: number) => void
): { emoticon: Emoticon; file: Blob }[] {
  const scanned = scanEmoticons(dirPath)
  const results: { emoticon: Emoticon; file: Blob }[] = []

  for (let i = 0; i < scanned.length; i++) {
    const item = createImportItem(scanned[i])
    if (item) results.push(item)

    onProgress?.(i + 1, scanned.length)
  }

  return results
}
