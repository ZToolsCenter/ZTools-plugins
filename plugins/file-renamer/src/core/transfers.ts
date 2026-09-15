import { uniquePaths } from './file-items'

export type ImportedFile = File & {
  path?: string
  webkitRelativePath?: string
}

export function getFilePath(file: File) {
  try {
    if (typeof window.services?.getPathForFile === 'function') {
      return window.services.getPathForFile(file).trim()
    }
  } catch {
    // Fall back to older Electron versions below.
  }

  return ((file as ImportedFile).path || '').trim()
}

export function collectTransferFiles(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return []

  const itemFiles = Array.from(dataTransfer.items || [])
    .map((item) => item.kind === 'file' ? item.getAsFile() : null)
    .filter((file): file is File => Boolean(file))

  const files = [...itemFiles, ...Array.from(dataTransfer.files || [])]
  const seen = new Set<File>()
  return files.filter((file) => {
    if (seen.has(file)) return false
    seen.add(file)
    return true
  }) as ImportedFile[]
}

export function getPathsForFiles(files: File[]) {
  return uniquePaths(files.map(getFilePath).filter(Boolean))
}

export function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
