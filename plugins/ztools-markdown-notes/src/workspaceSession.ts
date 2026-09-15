const LAST_WORKSPACE_KEY = 'last-workspace-path'
const EDITOR_MODE_KEY = 'editor-mode'
const PINNED_NOTES_KEY = 'pinned-notes'
const EDITOR_SETTINGS_KEY = 'editor-settings'
const NOTE_DRAFT_KEY = 'note-draft'
const TRASH_RETENTION_KEY = 'trash-retention-days'
const WORKSPACES_KEY = 'registered-workspaces'
const GLOBAL_NOTE_SEARCH_KEY = 'global-note-search-enabled'
const GLOBAL_WORKSPACE_SEARCH_KEY = 'global-workspace-search-enabled'
const HIDDEN_GLOBAL_NOTES_KEY = 'hidden-global-notes'

export type EditorSettings = { fontSize: number; lineHeight: number; findHighlightColor: string }
export type RegisteredWorkspace = { id: string; name: string; path: string }
export const defaultEditorSettings: EditorSettings = { fontSize: 16, lineHeight: 1.4, findHighlightColor: '#facc15' }
export type NoteDraft = {
  workspaceId: string
  relativePath: string
  content: string
  updatedAt: number
  baseModifiedAt: number | null
}

function storageKey() {
  return `${LAST_WORKSPACE_KEY}:${window.ztools.getNativeId()}`
}

export function loadLastWorkspacePath(): string | null {
  const value = window.ztools.dbStorage.getItem(storageKey())
  return typeof value === 'string' && value ? value : null
}

export function saveLastWorkspacePath(path: string) {
  window.ztools.dbStorage.setItem(storageKey(), path)
}

export function loadRegisteredWorkspaces(): RegisteredWorkspace[] {
  const value = window.ztools.dbStorage.getItem(`${WORKSPACES_KEY}:${window.ztools.getNativeId()}`)
  if (!Array.isArray(value)) return []
  const workspaces = value.filter((item): item is RegisteredWorkspace => (
    typeof item?.id === 'string' && Boolean(item.id) &&
    typeof item?.name === 'string' && Boolean(item.name.trim()) &&
    typeof item?.path === 'string' && Boolean(item.path)
  ))
  return [...new Map(workspaces.map((item) => [item.id, { ...item, name: item.name.trim() }])).values()]
}

export function saveRegisteredWorkspaces(workspaces: RegisteredWorkspace[]) {
  window.ztools.dbStorage.setItem(
    `${WORKSPACES_KEY}:${window.ztools.getNativeId()}`,
    workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, path: workspace.path })),
  )
}

export function loadEditorMode(): 'ir' | 'sv' {
  const value = window.ztools.dbStorage.getItem(`${EDITOR_MODE_KEY}:${window.ztools.getNativeId()}`)
  return value === 'sv' ? 'sv' : 'ir'
}

export function saveEditorMode(mode: 'ir' | 'sv') {
  window.ztools.dbStorage.setItem(`${EDITOR_MODE_KEY}:${window.ztools.getNativeId()}`, mode)
}

export function loadPinnedNotePaths(workspaceId: string): string[] {
  const value = window.ztools.dbStorage.getItem(`${PINNED_NOTES_KEY}:${workspaceId}`)
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((path): path is string => typeof path === 'string' && path.toLowerCase().endsWith('.md')))]
}

export function savePinnedNotePaths(workspaceId: string, paths: string[]) {
  window.ztools.dbStorage.setItem(`${PINNED_NOTES_KEY}:${workspaceId}`, [...new Set(paths)])
}

export function loadGlobalNoteSearchEnabled(): boolean {
  return window.ztools.dbStorage.getItem(GLOBAL_NOTE_SEARCH_KEY) === true
}

export function saveGlobalNoteSearchEnabled(enabled: boolean) {
  window.ztools.dbStorage.setItem(GLOBAL_NOTE_SEARCH_KEY, enabled)
}

export function loadGlobalWorkspaceSearchEnabled(): boolean {
  return window.ztools.dbStorage.getItem(GLOBAL_WORKSPACE_SEARCH_KEY) === true
}

export function saveGlobalWorkspaceSearchEnabled(enabled: boolean) {
  window.ztools.dbStorage.setItem(GLOBAL_WORKSPACE_SEARCH_KEY, enabled)
}

export function loadHiddenGlobalNotePaths(workspaceId: string): string[] {
  const value = window.ztools.dbStorage.getItem(`${HIDDEN_GLOBAL_NOTES_KEY}:${workspaceId}`)
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((path): path is string => typeof path === 'string' && path.toLowerCase().endsWith('.md')))]
}

export function saveHiddenGlobalNotePaths(workspaceId: string, paths: string[]) {
  window.ztools.dbStorage.setItem(`${HIDDEN_GLOBAL_NOTES_KEY}:${workspaceId}`, [...new Set(paths)])
}

export function loadEditorSettings(): EditorSettings {
  const value = window.ztools.dbStorage.getItem(EDITOR_SETTINGS_KEY) as Partial<EditorSettings> | null
  return {
    fontSize: typeof value?.fontSize === 'number' && value.fontSize >= 12 && value.fontSize <= 24 ? value.fontSize : defaultEditorSettings.fontSize,
    lineHeight: typeof value?.lineHeight === 'number' && value.lineHeight >= 1.2 && value.lineHeight <= 2.4 ? value.lineHeight : defaultEditorSettings.lineHeight,
    findHighlightColor: typeof value?.findHighlightColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.findHighlightColor) ? value.findHighlightColor : defaultEditorSettings.findHighlightColor,
  }
}

export function saveEditorSettings(settings: EditorSettings) {
  window.ztools.dbStorage.setItem(EDITOR_SETTINGS_KEY, {
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    findHighlightColor: settings.findHighlightColor,
  })
}

export function loadTrashRetentionDays(): number | null {
  const value = window.ztools.dbStorage.getItem(TRASH_RETENTION_KEY)
  if (value === 'never') return null
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365 ? value : 30
}

export function saveTrashRetentionDays(days: number | null) {
  window.ztools.dbStorage.setItem(TRASH_RETENTION_KEY, days === null ? 'never' : days)
}

function parseNoteDraft(value: unknown): NoteDraft | null {
  const draft = value as Partial<NoteDraft> | null
  if (
    typeof draft?.workspaceId !== 'string' || !draft.workspaceId ||
    typeof draft.relativePath !== 'string' || !draft.relativePath.toLowerCase().endsWith('.md') ||
    typeof draft.content !== 'string' ||
    typeof draft.updatedAt !== 'number' || !Number.isFinite(draft.updatedAt) ||
    (draft.baseModifiedAt !== null && (typeof draft.baseModifiedAt !== 'number' || !Number.isFinite(draft.baseModifiedAt)))
  ) return null
  return {
    workspaceId: draft.workspaceId,
    relativePath: draft.relativePath,
    content: draft.content,
    updatedAt: draft.updatedAt,
    baseModifiedAt: draft.baseModifiedAt,
  }
}

function loadNoteDrafts(): NoteDraft[] {
  const stored = window.ztools.dbStorage.getItem(NOTE_DRAFT_KEY)
  const values = Array.isArray(stored) ? stored : [stored]
  return values.flatMap((value) => {
    const draft = parseNoteDraft(value)
    return draft ? [draft] : []
  })
}

function storeNoteDrafts(drafts: NoteDraft[]) {
  window.ztools.dbStorage.setItem(NOTE_DRAFT_KEY, drafts)
}

export function loadNoteDraft(workspaceId?: string, relativePath?: string): NoteDraft | null {
  return loadNoteDrafts()
    .filter((draft) => !workspaceId || draft.workspaceId === workspaceId)
    .filter((draft) => !relativePath || draft.relativePath === relativePath)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
}

export function saveNoteDraft(draft: NoteDraft) {
  const drafts = loadNoteDrafts().filter((item) => item.workspaceId !== draft.workspaceId || item.relativePath !== draft.relativePath)
  storeNoteDrafts([...drafts, draft])
}

export function clearNoteDraft(workspaceId: string, relativePath: string, content?: string) {
  storeNoteDrafts(loadNoteDrafts().filter((draft) => (
    draft.workspaceId !== workspaceId || draft.relativePath !== relativePath ||
    (content !== undefined && draft.content !== content)
  )))
}

export function replaceNoteDraftPath(workspaceId: string, oldPath: string, newPath: string) {
  const oldPrefix = `${oldPath}/`
  storeNoteDrafts(loadNoteDrafts().map((draft) => {
    if (draft.workspaceId !== workspaceId || (draft.relativePath !== oldPath && !draft.relativePath.startsWith(oldPrefix))) return draft
    return { ...draft, relativePath: `${newPath}${draft.relativePath.slice(oldPath.length)}` }
  }))
}

export function clearNoteDraftPath(workspaceId: string, path: string) {
  storeNoteDrafts(loadNoteDrafts().filter((draft) => (
    draft.workspaceId !== workspaceId || (draft.relativePath !== path && !draft.relativePath.startsWith(`${path}/`))
  )))
}
