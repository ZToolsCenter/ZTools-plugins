import type { SharedFile } from '../context/SharedFilesContext'
import { generateTaskId, buildTaskOutputPath, sanitizeTaskName } from '../hooks/useTaskFolder'

/** Build a browser File from a workspace entry (drag/drop or path-only open dialog). */
export async function ensureBrowserFile(file: SharedFile): Promise<File> {
  if (file.rawFile) return file.rawFile
  const p = file.path
  if (!p) throw new Error('无效文件路径')
  if (typeof window.services.readFileBase64 !== 'function') {
    throw new Error('请拖入 PDF 文件（当前环境无法读取路径文件）')
  }
  const b64 = window.services.readFileBase64(p)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], file.name || 'document.pdf', { type: 'application/pdf' })
}

export function fileFromBase64(
  b64: string,
  name: string,
  type = 'application/pdf',
): File {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name || 'document.pdf', { type })
}

/** Absolute input path when the browser File has one; empty string otherwise. */
export function resolveInputPath(file: SharedFile): string {
  if (file.rawFile) {
    const direct = window.ztools.getPathForFile(file.rawFile)
    return (direct || '').trim()
  }
  return (file.path || '').trim()
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/** Write browser File bytes to a pdf-tmp task file and return its path. */
export async function materializeInputPath(file: SharedFile): Promise<string> {
  if (typeof window.services.writeFileBase64 !== 'function') {
    throw new Error('当前环境无法保存浏览器文件')
  }
  const browserFile = await ensureBrowserFile(file)
  const base64 = arrayBufferToBase64(await browserFile.arrayBuffer())
  const filename = sanitizeTaskName(file.name || 'document.pdf') + '.pdf'
  const tempPath = buildTaskOutputPath(
    window.ztools.getPath('downloads'),
    'tmp',
    filename,
    generateTaskId('shared-input'),
  )
  return window.services.writeFileBase64(base64, tempPath)
}

/** Resolve a real input path, materializing browser-only bytes when needed. */
export async function withInputPath<T>(
  file: SharedFile,
  run: (inputPath: string) => Promise<T>,
): Promise<T> {
  const direct = resolveInputPath(file)
  if (direct) return run(direct)
  const tempPath = await materializeInputPath(file)
  try {
    return await run(tempPath)
  } finally {
    try {
      window.services.deleteFile?.(tempPath)
    } catch {
      // ignore
    }
  }
}

/** Batch variant of withInputPath that preserves file order. */
export async function withInputPaths<T>(
  files: SharedFile[],
  run: (inputPaths: string[]) => Promise<T>,
): Promise<T> {
  const inputPaths: string[] = []
  const temps: string[] = []
  try {
    for (const file of files) {
      const direct = resolveInputPath(file)
      if (direct) {
        inputPaths.push(direct)
      } else {
        const tempPath = await materializeInputPath(file)
        temps.push(tempPath)
        inputPaths.push(tempPath)
      }
    }
    return await run(inputPaths)
  } finally {
    for (const tempPath of temps) {
      try {
        window.services.deleteFile?.(tempPath)
      } catch {
        // ignore
      }
    }
  }
}
