import type { FileItem } from './session'

export type ManualPasteResult = { names: Record<string, string>; ignoredCount: number }

export function getManualTargetName(file: FileItem, names: Record<string, string>): string {
  return names[file.id] ?? file.currentName
}

export function applyManualPaste(
  sortedFiles: FileItem[],
  names: Record<string, string>,
  pastedText: string
): ManualPasteResult {
  const normalized = pastedText.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const lines = (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n')
  const nextNames = { ...names }
  const appliedCount = Math.min(lines.length, sortedFiles.length)
  for (let index = 0; index < appliedCount; index += 1) {
    nextNames[sortedFiles[index].id] = lines[index]
  }
  return { names: nextNames, ignoredCount: Math.max(0, lines.length - sortedFiles.length) }
}
