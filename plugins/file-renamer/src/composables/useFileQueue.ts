import { computed, ref } from 'vue'
import { fsBridge } from '@/core/bridge'
import { createFileItem, pathIdentity, uniquePaths } from '@/core/file-items'
import type { DirectoryBreadcrumb, FileItem } from '@/core/types'

export interface ImportResult {
  imported: number
  skipped: number
  duplicates: number
}

export function useFileQueue() {
  const rootItems = ref<FileItem[]>([])
  const directoryItems = ref<FileItem[]>([])
  const breadcrumbs = ref<DirectoryBreadcrumb[]>([])
  const visibleItems = computed(() => breadcrumbs.value.length > 0 ? directoryItems.value : rootItems.value)
  let navigationRequest = 0

  async function importPaths(rawPaths: string[]): Promise<ImportResult> {
    const paths = uniquePaths(rawPaths)
    const existing = new Set(rootItems.value.map((item) => pathIdentity(item.path)))
    const pathsToImport = paths.filter((targetPath) => !existing.has(pathIdentity(targetPath)))
    const duplicates = paths.length - pathsToImport.length

    const imported = await Promise.all(pathsToImport.map(async (targetPath) => {
      const stats = await fsBridge.getStats(targetPath)
      return stats ? createFileItem(targetPath, stats) : null
    }))

    const validItems = imported.filter((item): item is FileItem => item !== null)
    if (validItems.length > 0) {
      rootItems.value = [...rootItems.value, ...validItems]
      breadcrumbs.value = []
      directoryItems.value = []
    }

    return {
      imported: validItems.length,
      skipped: pathsToImport.length - validItems.length + (rawPaths.length - paths.length),
      duplicates
    }
  }

  function appendFallbackFiles(importedFiles: File[]) {
    const existing = new Set(rootItems.value.map((item) => pathIdentity(item.path)))
    const newItems = importedFiles.reduce<FileItem[]>((result, file) => {
      const fallbackPath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).trim()
      if (!fallbackPath || existing.has(pathIdentity(fallbackPath))) return result

      existing.add(pathIdentity(fallbackPath))
      result.push({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
        originalName: file.name,
        newName: file.name,
        path: fallbackPath,
        size: file.size,
        lastModified: file.lastModified,
        isDirectory: false,
        status: 'error',
        errorMessage: '无法获取文件绝对路径，请使用导入按钮选择本地文件',
        extension: file.name.includes('.') ? file.name.split('.').pop() || '' : ''
      })
      return result
    }, [])

    if (newItems.length > 0) {
      rootItems.value = [...rootItems.value, ...newItems]
      breadcrumbs.value = []
      directoryItems.value = []
    }

    return newItems.length
  }

  async function loadDirectory(target: DirectoryBreadcrumb, nextBreadcrumbs: DirectoryBreadcrumb[]) {
    const requestId = ++navigationRequest
    const entries = await fsBridge.readDirectory(target.path)
    if (requestId !== navigationRequest || entries === null) return false

    directoryItems.value = entries.map((entry) => createFileItem(entry.path, entry))
    breadcrumbs.value = nextBreadcrumbs
    return true
  }

  async function openDirectory(item: FileItem) {
    if (!item.isDirectory) return false
    const target = { name: item.originalName, path: item.path }
    return loadDirectory(target, [...breadcrumbs.value, target])
  }

  async function navigateToBreadcrumb(index: number) {
    if (index < 0) {
      navigationRequest += 1
      breadcrumbs.value = []
      directoryItems.value = []
      return true
    }

    const target = breadcrumbs.value[index]
    if (!target) return false
    return loadDirectory(target, breadcrumbs.value.slice(0, index + 1))
  }

  function removeItems(itemIds: string[]) {
    if (itemIds.length === 0) return
    const idSet = new Set(itemIds)
    if (breadcrumbs.value.length > 0) {
      directoryItems.value = directoryItems.value.filter((item) => !idSet.has(item.id))
      return
    }
    rootItems.value = rootItems.value.filter((item) => !idSet.has(item.id))
  }

  function clear() {
    navigationRequest += 1
    rootItems.value = []
    directoryItems.value = []
    breadcrumbs.value = []
  }

  return {
    rootItems,
    visibleItems,
    breadcrumbs,
    importPaths,
    appendFallbackFiles,
    openDirectory,
    navigateToBreadcrumb,
    removeItems,
    clear
  }
}
