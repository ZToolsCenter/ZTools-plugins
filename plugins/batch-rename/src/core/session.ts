export type SortMode = 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc' |
  'modified-asc' | 'modified-desc' | 'created-asc' | 'created-desc'
export type ActiveModule = 'replace' | 'smart' | 'number' | 'insert' | 'manual'
export type SequenceStyle = 'arabic' | 'chinese-lower' | 'chinese-upper' | 'alpha-lower' | 'alpha-upper'
export type NumberRule = { prefix: string; start: number; style: SequenceStyle; digits: number; suffix: string }
export type ReplaceMode = 'text' | 'first' | 'last' | 'range' | 'after' | 'before' | 'after-n' | 'before-n'
export type ReplaceRule = {
  id: string
  mode: ReplaceMode
  find: string
  replacement: string
  start: number
  count: number
  includeExtension: boolean
}
export type InsertInfo = 'created' | 'modified' | 'size' | 'dimensions' | 'captured'
export type InsertRule = {
  kind: 'text' | 'number' | 'info'
  position: 'start' | 'index' | 'end'
  index: number
  text: string
  number: NumberRule
  info: InsertInfo
  prefix: string
  suffix: string
}
export type FileMetadata = { dimensions?: string; capturedAt?: number; error?: string }

export type FileInfo = {
  path: string
  name: string
  size?: number
  createdAt?: number
  modifiedAt?: number
  error?: string
  metadata?: FileMetadata
}

export type FileItem = {
  id: string
  sourcePath: string
  directory: string
  currentName: string
  baseName: string
  extension: string
  size?: number
  createdAt?: number
  modifiedAt?: number
  error?: string
  metadata?: FileMetadata
}

export type RenameSession = {
  files: FileItem[]
  sortMode: SortMode
  activeModule: ActiveModule
  replaceRules: ReplaceRule[]
  numberRule: NumberRule
  insertRule: InsertRule
  manualNames: Record<string, string>
  smartNames: Record<string, string>
}

export type LaunchParam = {
  code?: string
  type?: string
  payload?: unknown
}

export function createSession(): RenameSession {
  const numberRule: NumberRule = { prefix: '', start: 1, style: 'arabic', digits: 0, suffix: '' }
  return {
    files: [], sortMode: 'name-asc', activeModule: 'replace',
    replaceRules: [{ id: 'default', mode: 'text', find: '', replacement: '', start: 1, count: 1, includeExtension: false }],
    numberRule,
    insertRule: { kind: 'text', position: 'end', index: 1, text: '', number: { ...numberRule }, info: 'modified', prefix: '', suffix: '' },
    manualNames: {}, smartNames: {}
  }
}

export function pathKey(path: string, platform: string): string {
  return platform === 'win32' ? path.replaceAll('/', '\\').toLowerCase() : path
}

function isAbsolutePath(path: string, platform: string): boolean {
  if (platform === 'win32') {
    return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path)
  }
  return path.startsWith('/')
}

export function extractFilePaths(param: LaunchParam, platform: string): string[] | null {
  if (param.code !== 'batch-rename-files') return null
  if (!Array.isArray(param.payload)) return []

  const seen = new Set<string>()
  const paths: string[] = []
  for (const value of param.payload) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    if (entry.isDirectory === true || entry.isFile === false) continue
    if (typeof entry.path !== 'string' || !isAbsolutePath(entry.path, platform)) continue
    const key = pathKey(entry.path, platform)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(entry.path)
  }
  return paths
}

export function toFileItem(info: FileInfo, platform: string): FileItem {
  const separator = platform === 'win32' ? /[\\/]/ : /\//
  const parts = info.path.split(separator)
  const currentName = info.name || parts.at(-1) || info.path
  const dot = currentName.lastIndexOf('.')
  const hasExtension = dot > 0
  const parent = info.path.slice(0, info.path.length - (parts.at(-1)?.length || 0))
  return {
    id: pathKey(info.path, platform),
    sourcePath: info.path,
    directory: parent === '/' || /^[a-zA-Z]:[\\/]$/.test(parent)
      ? parent
      : parent.replace(/[\\/]$/, ''),
    currentName,
    baseName: hasExtension ? currentName.slice(0, dot) : currentName,
    extension: hasExtension ? currentName.slice(dot) : '',
    size: info.size,
    createdAt: info.createdAt,
    modifiedAt: info.modifiedAt,
    error: info.error,
    metadata: info.metadata
  }
}

export function replaceTask(infos: FileInfo[], platform: string): RenameSession {
  return { ...createSession(), files: infos.map((info) => toFileItem(info, platform)) }
}

export function appendFiles(session: RenameSession, infos: FileInfo[], platform: string): RenameSession {
  const seen = new Set(session.files.map((file) => pathKey(file.sourcePath, platform)))
  const files = [...session.files]
  for (const info of infos) {
    const key = pathKey(info.path, platform)
    if (seen.has(key) || files.length >= 10000) continue
    seen.add(key)
    files.push(toFileItem(info, platform))
  }
  return { ...session, files, smartNames: files.length === session.files.length ? session.smartNames : {} }
}

export function applyBatchResults(session: RenameSession, results: RenameOutcome[], platform: string): RenameSession {
  const byId = new Map(results.map((result) => [result.id, result]))
  const manualNames = { ...session.manualNames }
  const files = session.files.map((file) => {
    const result = byId.get(file.id)
    if (!result) return file
    const info: FileInfo = {
      path: result.actualPath || file.sourcePath,
      name: (result.actualPath || file.sourcePath).split(/[\\/]/).at(-1) || file.currentName,
      size: file.size, createdAt: file.createdAt, modifiedAt: file.modifiedAt,
      error: undefined,
      metadata: file.metadata
    }
    const next = { ...toFileItem(info, platform), id: file.id }
    if (result.status === 'success' && file.id in manualNames) manualNames[file.id] = next.currentName
    return next
  })
  return { ...session, files, manualNames }
}

export function removeFile(session: RenameSession, id: string): RenameSession {
  const manualNames = { ...session.manualNames }
  delete manualNames[id]
  return { ...session, files: session.files.filter((file) => file.id !== id), manualNames, smartNames: {} }
}

export function clearFiles(session: RenameSession): RenameSession {
  return { ...session, files: [], smartNames: {} }
}
