import type { ClipboardCopyRequest, FileItem, FileStats } from './types'

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/
const UNC_ABSOLUTE_PATH = /^\\\\/
const POSIX_ABSOLUTE_PATH = /^\//

export function isAbsoluteFilePath(targetPath: string) {
  return WINDOWS_ABSOLUTE_PATH.test(targetPath)
    || UNC_ABSOLUTE_PATH.test(targetPath)
    || POSIX_ABSOLUTE_PATH.test(targetPath)
}

export function getNameFromPath(targetPath: string) {
  const normalizedPath = targetPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const lastSlash = normalizedPath.lastIndexOf('/')
  return lastSlash === -1 ? normalizedPath : normalizedPath.slice(lastSlash + 1)
}

export function getExtension(name: string, isDirectory = false) {
  if (isDirectory) return ''
  const lastDot = name.lastIndexOf('.')
  return lastDot > 0 && lastDot < name.length - 1 ? name.slice(lastDot + 1) : ''
}

export function buildTargetPath(sourcePath: string, newName: string) {
  const lastSeparator = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'))
  if (lastSeparator === -1) return newName
  return `${sourcePath.slice(0, lastSeparator + 1)}${newName}`
}

export function pathIdentity(targetPath: string) {
  const normalizedPath = targetPath.replace(/[\\/]+$/, '')
  return WINDOWS_ABSOLUTE_PATH.test(normalizedPath) || UNC_ABSOLUTE_PATH.test(normalizedPath)
    ? normalizedPath.toLowerCase()
    : normalizedPath
}

export function uniquePaths(paths: string[]) {
  const seen = new Set<string>()
  return paths.reduce<string[]>((result, rawPath) => {
    const targetPath = rawPath.trim()
    if (!isAbsoluteFilePath(targetPath)) return result

    const identity = pathIdentity(targetPath)
    if (seen.has(identity)) return result

    seen.add(identity)
    result.push(targetPath)
    return result
  }, [])
}

export function createFileItem(targetPath: string, stats: FileStats): FileItem {
  const name = getNameFromPath(targetPath)
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    originalName: name,
    newName: name,
    path: targetPath,
    size: stats.size,
    lastModified: stats.mtimeMs,
    isDirectory: stats.isDirectory,
    status: 'idle',
    extension: getExtension(name, stats.isDirectory)
  }
}

export function formatClipboardItems(items: FileItem[], request: ClipboardCopyRequest) {
  const values = items.map((item) => request.field === 'path' ? item.path : item.originalName)
  return request.format === 'json' ? JSON.stringify(values, null, 2) : values.join('\n')
}
