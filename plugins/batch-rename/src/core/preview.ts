import type { FileItem, RenameSession } from './session'
import { sortFiles } from './sort'
import { applyReplaceRules } from './replace'
import { applyNumberRule } from './number'
import { getManualTargetName } from './manual'
import { applyInsertRule } from './insert'

export type PreviewItem = FileItem & {
  targetName: string
  status: 'unchanged' | 'ready' | 'error' | 'success'
  errorMessage?: string
}

export function createPreview(session: RenameSession): PreviewItem[] {
  return sortFiles(session.files, session.sortMode).map((file, index) => {
    let targetName = file.currentName
    let errorMessage = file.error
    if (session.activeModule === 'replace') targetName = applyReplaceRules(file, session.replaceRules)
    if (session.activeModule === 'number') targetName = applyNumberRule(file, index, session.numberRule)
    if (session.activeModule === 'manual') targetName = getManualTargetName(file, session.manualNames)
    if (session.activeModule === 'smart') targetName = session.smartNames[file.id] ?? file.currentName
    if (session.activeModule === 'insert') {
      const result = applyInsertRule(file, index, session.insertRule)
      targetName = result.name
      errorMessage ||= result.error
    }
    return { ...file, targetName, status: errorMessage ? 'error' : targetName === file.currentName ? 'unchanged' : 'ready', errorMessage }
  })
}
