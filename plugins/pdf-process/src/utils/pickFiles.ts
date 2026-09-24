/**
 * Normalize ZTools / Electron open-dialog return values.
 * Host may return:
 * - string[] (sync docs)
 * - Promise<string[]>
 * - { canceled, filePaths } (Electron async shape)
 * - Promise of that object
 */
export type OpenDialogResult =
  | string
  | string[]
  | undefined
  | null
  | {
      canceled?: boolean
      cancelled?: boolean
      filePaths?: string[]
      filePath?: string
      paths?: string[]
    }

export function coerceOpenDialogPaths(result: OpenDialogResult): string[] {
  if (result == null) return []
  if (Array.isArray(result)) {
    return result
      .filter((p) => typeof p === 'string' && p.trim().length > 0)
      .map((p) => normalizePathString(p))
  }
  if (typeof result === 'object') {
    const obj = result as {
      canceled?: boolean
      cancelled?: boolean
      filePaths?: unknown
      filePath?: unknown
      paths?: unknown
    }
    if (obj.canceled || obj.cancelled) return []
    const list = Array.isArray(obj.filePaths)
      ? obj.filePaths
      : Array.isArray(obj.paths)
        ? obj.paths
        : null
    if (list) {
      return list
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map((p) => normalizePathString(p))
    }
    if (typeof obj.filePath === 'string' && obj.filePath.trim()) {
      return [normalizePathString(obj.filePath)]
    }
  }
  // Some hosts return a single path string
  if (typeof result === 'string' && result.trim()) {
    return [normalizePathString(result)]
  }
  return []
}

function normalizePathString(p: string): string {
  let s = p.trim()
  // strip surrounding quotes Windows sometimes adds
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1)
  }
  // file:///C:/... → C:\...
  if (/^file:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      if (u.protocol === 'file:') {
        // URL pathname is /C:/Users/... on Windows
        let pathname = decodeURIComponent(u.pathname)
        if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1)
        s = pathname.replace(/\//g, '\\')
      }
    } catch {
      // keep original
    }
  }
  return s
}

export async function pickPdfFiles(options?: {
  multiple?: boolean
  title?: string
}): Promise<string[]> {
  const multiple = options?.multiple !== false
  const title = options?.title || '选择 PDF 文件'
  try {
    const raw = window.ztools.showOpenDialog({
      title,
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }) as OpenDialogResult | Promise<OpenDialogResult>
    const resolved = raw != null && typeof (raw as Promise<unknown>).then === 'function'
      ? await (raw as Promise<OpenDialogResult>)
      : (raw as OpenDialogResult)
    return coerceOpenDialogPaths(resolved)
  } catch (e) {
    console.warn('pickPdfFiles failed', e)
    return []
  }
}
