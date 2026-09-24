let taskCounter = 0

/** Basename without extension. Accepts path or bare filename. */
export function stripExtension(nameOrPath: string): string {
  const base = nameOrPath.replace(/^.*[\\/]/, '')
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Sanitize a name for use as a folder segment: task-...-文件名 */
export function sanitizeTaskName(nameOrPath: string): string {
  const base = stripExtension(nameOrPath) || 'file'
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  return cleaned || 'file'
}

/** Local date as yyyymmdd. */
export function formatTaskDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return '' + y + m + day
}

/**
 * Generates a task folder id: task-yyyymmdd-序号-文件名
 * Example: task-20260729-1-合同
 */
export function generateTaskId(sourceNameOrPath?: string, now: Date = new Date()): string {
  taskCounter++
  const date = formatTaskDate(now)
  if (sourceNameOrPath) {
    const name = sanitizeTaskName(sourceNameOrPath)
    return 'task-' + date + '-' + taskCounter + '-' + name
  }
  return 'task-' + date + '-' + taskCounter
}

/** Builds downloads\\pdf-feature\\task-...\\filename */
export function buildTaskOutputPath(
  downloads: string,
  feature: string,
  filename: string,
  taskId: string,
): string {
  const base = downloads.replace(/[\\/]+$/, '')
  return [base, 'pdf-' + feature, taskId, filename].join(String.fromCharCode(92))
}

export function buildTaskOutputDir(downloads: string, feature: string, taskId: string): string {
  const base = downloads.replace(/[\\/]+$/, '')
  return [base, 'pdf-' + feature, taskId].join(String.fromCharCode(92))
}

export function buildTaskOutputPathFromDownloads(feature: string, filename: string, taskId: string): string {
  const downloads = window.ztools.getPath('downloads')
  return buildTaskOutputPath(downloads, feature, filename, taskId)
}

export function buildTaskOutputDirFromDownloads(feature: string, taskId: string): string {
  const downloads = window.ztools.getPath('downloads')
  return buildTaskOutputDir(downloads, feature, taskId)
}

export function buildConvertedFilename(sourceNameOrPath: string, extWithDot: string): string {
  const base = stripExtension(sourceNameOrPath) || 'document'
  const ext = extWithDot.startsWith('.') ? extWithDot : '.' + extWithDot
  return base + '_converted' + ext
}

export function buildPageImageFilename(
  sourceNameOrPath: string,
  pageIndex: number,
  extWithoutDot: string,
): string {
  const base = stripExtension(sourceNameOrPath) || 'page'
  const ext = extWithoutDot.replace(/^\./, '')
  return base + '_' + pageIndex + '.' + ext
}
