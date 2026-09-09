<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import InlineCreate from './components/InlineCreate.vue'
import ImagePreview from './components/ImagePreview.vue'
import MarkdownEditor from './components/MarkdownEditor.vue'
import OutlinePanel from './components/OutlinePanel.vue'
import TrashPanel from './components/TrashPanel.vue'
import WorkspaceTree from './components/WorkspaceTree.vue'
import { extractOutline } from './outline'
import { endWorkspaceDrag, getWorkspaceDragPath } from './workspaceDrag'
import { clearNoteDraft, clearNoteDraftPath, defaultEditorSettings, loadEditorMode, loadEditorSettings, loadGlobalNoteSearchEnabled, loadGlobalWorkspaceSearchEnabled, loadHiddenGlobalNotePaths, loadLastWorkspacePath, loadNoteDraft, loadPinnedNotePaths, loadRegisteredWorkspaces, loadTrashRetentionDays, replaceNoteDraftPath, saveEditorMode, saveEditorSettings, saveGlobalNoteSearchEnabled, saveGlobalWorkspaceSearchEnabled, saveHiddenGlobalNotePaths, saveLastWorkspacePath, saveNoteDraft, savePinnedNotePaths, saveRegisteredWorkspaces, saveTrashRetentionDays, type NoteDraft, type RegisteredWorkspace } from './workspaceSession'

const workspace = ref<WorkspaceScan | null>(null)
const previousWorkspace = ref<WorkspaceScan | null>(null)
const workspaceName = ref('我的笔记')
const selectedPath = ref('')
const errorMessage = ref('')
const isBusy = ref(false)
const isRestoring = ref(true)
const workspaceAction = ref('current')
const registeredWorkspaces = ref<RegisteredWorkspace[]>([])
const workspaceRenameId = ref<string | null>(null)
const workspaceRenameName = ref('')
const workspaceRenameError = ref('')
const pendingWorkspaceRemoval = ref<RegisteredWorkspace | null>(null)
const pendingWorkspaceMigration = ref<{ workspace: RegisteredWorkspace; targetPath: string } | null>(null)
const isWorkspaceMigrationBusy = ref(false)
const workspaceMigrationError = ref('')
const isWorkspaceDiscoveryBusy = ref(false)
const activeNotePath = ref<string | null>(null)
const editorContent = ref('')
const savedContent = ref('')
const openedModifiedAt = ref<number | null>(null)
const noteBaseUrl = ref('')
const noteMessage = ref('')
const isReadingNote = ref(false)
const isSavingNote = ref(false)
const selectedDirectory = ref('')
const createKind = ref<'note' | 'directory' | null>(null)
const createName = ref('')
const createError = ref('')
const selectedEntry = ref<WorkspaceTreeEntry | null>(null)
const renamePath = ref<string | null>(null)
const renameName = ref('')
const renameError = ref('')
const openEntryMenuPath = ref<string | null>(null)
const operationMessage = ref('')
const pendingDelete = ref<WorkspaceTreeEntry | null>(null)
const isRefreshing = ref(false)
const isCreateMenuOpen = ref(false)
const isEditorMenuOpen = ref(false)
const markdownImportInput = ref<HTMLInputElement | null>(null)
const editorMode = ref<'ir' | 'sv'>('ir')
const operationTone = ref<'error' | 'success'>('error')
const previewImage = ref<{ src: string; alt: string } | null>(null)
const isTrashOpen = ref(false)
const trashItems = ref<TrashItem[]>([])
const trashBusyId = ref<string | null>(null)
const pendingPurge = ref<TrashItem | 'all' | null>(null)
const restoreConflictItem = ref<TrashItem | null>(null)
const restorePath = ref('')
const markdownEditor = ref<InstanceType<typeof MarkdownEditor> | null>(null)
const isOutlineOpen = ref(false)
const pendingNewNoteEntry = ref(false)
const isEditorFullscreen = ref(false)
const searchQuery = ref('')
const searchResults = ref<WorkspaceSearchResult[]>([])
const isSearchOpen = ref(false)
const isSearching = ref(false)
const selectedSearchIndex = ref(0)
const isNoteLinkOpen = ref(false)
const noteLinkQuery = ref('')
const isNoteLinkLoading = ref(false)
const noteLinkCandidates = ref<Array<{
  workspaceId: string
  workspaceName: string
  workspacePath: string
  note: Extract<WorkspaceTreeEntry, { kind: 'note' }>
}>>([])
const isTableDialogOpen = ref(false)
const tableRows = ref(3)
const tableColumns = ref(3)
const findInput = ref<HTMLInputElement | null>(null)
const isFindOpen = ref(false)
const findQuery = ref('')
const findTotal = ref(0)
const findCurrent = ref(0)
const pinnedNotePaths = ref<string[]>([])
const globalNoteSearchEnabled = ref(false)
const globalWorkspaceSearchEnabled = ref(false)
const hiddenGlobalNotePaths = ref<string[]>([])
const isRootDropActive = ref(false)
const isSettingsOpen = ref(false)
const isResetSettingsOpen = ref(false)
const editorSettings = ref({ ...defaultEditorSettings })
const saveConflict = ref<{
  notePath: string
  diskContent: string
  diskModifiedAt: number
} | null>(null)
const isSaveConflictOpen = ref(false)
const draftRecovery = ref<{ draft: NoteDraft; diskContent: string; diskModifiedAt: number } | null>(null)
const isDraftRecoveryOpen = ref(false)
const isAttachmentScanOpen = ref(false)
const unusedAttachments = ref<UnusedAttachment[]>([])
const isAttachmentScanBusy = ref(false)
const isAttachmentCleanupPending = ref(false)
const trashRetentionDays = ref<number | null>(30)
const trashRetentionInput = ref(30)
const expiredTrashItems = ref<TrashItem[]>([])
const isExpiredTrashOpen = ref(false)
const isExpiredTrashBusy = ref(false)
let operationTimer: number | undefined
let autoSaveTimer: number | undefined
let searchTimer: number | undefined
let searchRequestId = 0
let globalFeatureTimer: number | undefined
let pendingGlobalNoteTarget: { workspaceId: string; relativePath: string } | null = null
let pendingGlobalWorkspaceId: string | null = null

const hasRuntime = computed(() => typeof window.znotes !== 'undefined' && typeof window.ztools !== 'undefined')
const isDirty = computed(() => activeNotePath.value !== null && editorContent.value !== savedContent.value)
const hasCurrentPreload = computed(() => window.znotes?.apiVersion >= 2)
const hasTrashPreload = computed(() => window.znotes?.apiVersion >= 4)
const hasSearchPreload = computed(() => window.znotes?.apiVersion >= 5)
const hasLinkPreload = computed(() => window.znotes?.apiVersion >= 6)
const hasNoteLinkPreload = computed(() => window.znotes?.apiVersion >= 7)
const hasMovePreload = computed(() => window.znotes?.apiVersion >= 8)
const hasShowInFolderPreload = computed(() => window.znotes?.apiVersion >= 9)
const outlineItems = computed(() => extractOutline(editorContent.value))
const createTargetLabel = computed(() => selectedDirectory.value || '工作区根目录')
const workspaceChoices = computed<RegisteredWorkspace[]>(() => {
  if (!workspace.value) return registeredWorkspaces.value
  const current = workspace.value.workspace
  const normalizedCurrentPath = current.path.replaceAll('\\', '/').toLocaleLowerCase('en-US')
  return [
    { id: current.id, name: current.name, path: current.path },
    ...registeredWorkspaces.value.filter((item) => (
      item.id !== current.id && item.path.replaceAll('\\', '/').toLocaleLowerCase('en-US') !== normalizedCurrentPath
    )),
  ]
})
const editorStyle = computed(() => ({
  '--editor-font-size': `${editorSettings.value.fontSize}px`,
  '--editor-line-height': String(editorSettings.value.lineHeight),
  '--find-highlight-color': editorSettings.value.findHighlightColor,
}))
const pinnedNotes = computed(() => {
  const notes = new Map(flattenNoteEntries(workspace.value?.entries ?? []).map((note) => [note.relativePath, note]))
  return pinnedNotePaths.value.flatMap((path) => {
    const note = notes.get(path)
    return note ? [note] : []
  })
})
const noteLinkResults = computed(() => {
  const query = noteLinkQuery.value.trim().toLocaleLowerCase('zh-CN')
  return noteLinkCandidates.value
    .filter((item) => item.workspaceId !== workspace.value?.workspace.id || item.note.relativePath !== activeNotePath.value)
    .filter((item) => !query || item.note.name.toLocaleLowerCase('zh-CN').includes(query) || item.note.relativePath.toLocaleLowerCase('zh-CN').includes(query) || item.workspaceName.toLocaleLowerCase('zh-CN').includes(query))
})
const globalFeatureSignature = computed(() => JSON.stringify({
  workspaces: registeredWorkspaces.value.map((item) => [item.id, item.name, item.path]),
  enabled: globalNoteSearchEnabled.value,
  workspaceEnabled: globalWorkspaceSearchEnabled.value,
  hidden: hiddenGlobalNotePaths.value,
  current: workspace.value ? [workspace.value.workspace.id, flattenNoteEntries(workspace.value.entries).map((note) => [note.name, note.relativePath])] : null,
}))

function createGlobalNoteFeatureCode(workspaceId: string, relativePath: string) {
  return `znotes-note:${encodeURIComponent(workspaceId)}:${encodeURIComponent(relativePath)}`
}

function parseGlobalNoteFeatureCode(code: string) {
  if (!code.startsWith('znotes-note:')) return null
  const separator = code.indexOf(':', 'znotes-note:'.length)
  if (separator === -1) return null
  try {
    return {
      workspaceId: decodeURIComponent(code.slice('znotes-note:'.length, separator)),
      relativePath: decodeURIComponent(code.slice(separator + 1)),
    }
  } catch {
    return null
  }
}

function createGlobalWorkspaceFeatureCode(workspaceId: string) {
  return `znotes-workspace:${encodeURIComponent(workspaceId)}`
}

function parseGlobalWorkspaceFeatureCode(code: string) {
  if (!code.startsWith('znotes-workspace:')) return null
  try {
    return decodeURIComponent(code.slice('znotes-workspace:'.length)) || null
  } catch {
    return null
  }
}

async function syncGlobalNoteFeatures() {
  if (!hasRuntime.value || typeof window.ztools.setFeature !== 'function') return
  const scans = globalNoteSearchEnabled.value
    ? await Promise.allSettled(registeredWorkspaces.value.map((item) => window.znotes.scanWorkspace(item.path)))
    : []
  const desired = new Map<string, { code: string; explain: string; cmds: string[] }>()
  scans.forEach((result) => {
    if (result.status !== 'fulfilled') return
    const scan = result.value
    const hiddenPaths = new Set(loadHiddenGlobalNotePaths(scan.workspace.id))
    flattenNoteEntries(scan.entries).forEach((note) => {
      if (hiddenPaths.has(note.relativePath)) return
      const code = createGlobalNoteFeatureCode(scan.workspace.id, note.relativePath)
      desired.set(code, { code, explain: `${scan.workspace.name} · ${note.relativePath}`, cmds: [note.name] })
    })
  })
  const existing = window.ztools.getFeatures().filter((feature) => feature.code.startsWith('znotes-note:'))
  existing.forEach((feature) => { if (!desired.has(feature.code)) window.ztools.removeFeature(feature.code) })
  desired.forEach((feature) => window.ztools.setFeature(feature))

  const desiredWorkspaces = new Map<string, { code: string; explain: string; cmds: string[] }>()
  if (globalWorkspaceSearchEnabled.value) {
    registeredWorkspaces.value.forEach((item) => {
      const code = createGlobalWorkspaceFeatureCode(item.id)
      desiredWorkspaces.set(code, { code, explain: `打开 Markdown 工作区 · ${item.name}`, cmds: [item.name] })
    })
  }
  const existingWorkspaces = window.ztools.getFeatures().filter((feature) => feature.code.startsWith('znotes-workspace:'))
  existingWorkspaces.forEach((feature) => { if (!desiredWorkspaces.has(feature.code)) window.ztools.removeFeature(feature.code) })
  desiredWorkspaces.forEach((feature) => window.ztools.setFeature(feature))
}

async function openGlobalWorkspaceTarget(workspaceId: string) {
  const target = registeredWorkspaces.value.find((item) => item.id === workspaceId)
  if (!target) {
    showOperationError('目标工作区尚未关联')
    void syncGlobalNoteFeatures()
    return
  }
  try {
    if (isDirty.value) {
      await saveCurrentNote()
      if (isDirty.value) throw new Error('当前笔记尚未保存，暂时无法切换工作区')
    }
    const next = await window.znotes.scanWorkspace(target.path)
    clearEditor()
    workspace.value = next
    registerWorkspace(next.workspace)
    workspaceAction.value = next.workspace.id
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '无法打开目标工作区')
  }
}

async function openGlobalNoteTarget(target: { workspaceId: string; relativePath: string }) {
  const registered = registeredWorkspaces.value.find((item) => item.id === target.workspaceId)
  if (!registered) {
    showOperationError('目标工作区尚未关联，请在设置中重新关联')
    return
  }
  try {
    if (isDirty.value) {
      await saveCurrentNote()
      if (isDirty.value) throw new Error('当前笔记尚未保存，暂时无法切换工作区')
    }
    const next = await window.znotes.scanWorkspace(registered.path)
    if (!flattenNoteEntries(next.entries).some((note) => note.relativePath === target.relativePath)) throw new Error('目标笔记不存在，正在更新全局入口')
    clearEditor()
    workspace.value = next
    registerWorkspace(next.workspace)
    workspaceAction.value = next.workspace.id
    await openNote(target.relativePath)
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '无法打开目标笔记')
    void syncGlobalNoteFeatures()
  }
}

function flattenNoteEntries(entries: WorkspaceTreeEntry[]): Extract<WorkspaceTreeEntry, { kind: 'note' }>[] {
  return entries.flatMap((entry) => entry.kind === 'directory' ? flattenNoteEntries(entry.children) : [entry])
}

async function reopenDraftNote() {
  const draft = loadNoteDraft(workspace.value?.workspace.id)
  if (
    !workspace.value || !draft ||
    draft.workspaceId !== workspace.value.workspace.id ||
    !flattenNoteEntries(workspace.value.entries).some((note) => note.relativePath === draft.relativePath)
  ) return
  await openNote(draft.relativePath)
}

function persistPinnedNotes(paths: string[]) {
  const workspaceId = workspace.value?.workspace.id
  if (!workspaceId) return
  pinnedNotePaths.value = [...new Set(paths)]
  savePinnedNotePaths(workspaceId, pinnedNotePaths.value)
}

function togglePinnedNote(note: Extract<WorkspaceTreeEntry, { kind: 'note' }>) {
  if (pinnedNotePaths.value.includes(note.relativePath)) {
    persistPinnedNotes(pinnedNotePaths.value.filter((path) => path !== note.relativePath))
    showOperationSuccess(`已取消置顶“${note.name}”`)
  } else {
    persistPinnedNotes([note.relativePath, ...pinnedNotePaths.value])
    showOperationSuccess(`已置顶“${note.name}”`)
  }
}

function toggleGlobalNoteSearch(note: Extract<WorkspaceTreeEntry, { kind: 'note' }>) {
  const workspaceId = workspace.value?.workspace.id
  if (!workspaceId) return
  hiddenGlobalNotePaths.value = hiddenGlobalNotePaths.value.includes(note.relativePath)
    ? hiddenGlobalNotePaths.value.filter((path) => path !== note.relativePath)
    : [...hiddenGlobalNotePaths.value, note.relativePath]
  saveHiddenGlobalNotePaths(workspaceId, hiddenGlobalNotePaths.value)
  showOperationSuccess(hiddenGlobalNotePaths.value.includes(note.relativePath) ? '已从 zTools 全局搜索隐藏' : '已恢复到 zTools 全局搜索')
  void syncGlobalNoteFeatures()
}

function updateGlobalNoteSearchEnabled() {
  saveGlobalNoteSearchEnabled(globalNoteSearchEnabled.value)
  void syncGlobalNoteFeatures()
}

function toggleGlobalNoteSearchEnabled() {
  globalNoteSearchEnabled.value = !globalNoteSearchEnabled.value
  updateGlobalNoteSearchEnabled()
}

function toggleGlobalWorkspaceSearchEnabled() {
  globalWorkspaceSearchEnabled.value = !globalWorkspaceSearchEnabled.value
  saveGlobalWorkspaceSearchEnabled(globalWorkspaceSearchEnabled.value)
  void syncGlobalNoteFeatures()
}

function replacePinnedPath(oldPath: string, newPath: string) {
  const oldPrefix = `${oldPath}/`
  const nextPaths = pinnedNotePaths.value.map((path) => {
    if (path === oldPath) return newPath
    return path.startsWith(oldPrefix) ? `${newPath}${path.slice(oldPath.length)}` : path
  })
  if (nextPaths.some((path, index) => path !== pinnedNotePaths.value[index])) persistPinnedNotes(nextPaths)
}

function replaceHiddenGlobalPath(oldPath: string, newPath: string) {
  const workspaceId = workspace.value?.workspace.id
  if (!workspaceId) return
  const prefix = `${oldPath}/`
  const next = hiddenGlobalNotePaths.value.map((path) => path === oldPath ? newPath : path.startsWith(prefix) ? `${newPath}${path.slice(oldPath.length)}` : path)
  if (next.some((path, index) => path !== hiddenGlobalNotePaths.value[index])) {
    hiddenGlobalNotePaths.value = next
    saveHiddenGlobalNotePaths(workspaceId, next)
  }
}

function removePinnedPaths(path: string) {
  const prefix = `${path}/`
  const nextPaths = pinnedNotePaths.value.filter((pinnedPath) => pinnedPath !== path && !pinnedPath.startsWith(prefix))
  if (nextPaths.length !== pinnedNotePaths.value.length) persistPinnedNotes(nextPaths)
}

function removeHiddenGlobalPaths(path: string) {
  const workspaceId = workspace.value?.workspace.id
  if (!workspaceId) return
  const next = hiddenGlobalNotePaths.value.filter((item) => item !== path && !item.startsWith(`${path}/`))
  if (next.length !== hiddenGlobalNotePaths.value.length) {
    hiddenGlobalNotePaths.value = next
    saveHiddenGlobalNotePaths(workspaceId, next)
  }
}

async function moveEntry(sourcePath: string, targetDirectoryPath: string) {
  if (!workspace.value || !sourcePath) return
  if (!hasMovePreload.value) {
    showOperationError('移动功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  try {
    const affectsOpenNote = activeNotePath.value === sourcePath || activeNotePath.value?.startsWith(`${sourcePath}/`)
    if (affectsOpenNote && isDirty.value) {
      await saveCurrentNote()
      if (isDirty.value) throw new Error('当前笔记尚未保存，暂时无法移动')
    }
    const root = workspace.value.workspace.path
    const newPath = await window.znotes.moveEntry(root, sourcePath, targetDirectoryPath)
    replacePinnedPath(sourcePath, newPath)
    replaceHiddenGlobalPath(sourcePath, newPath)
    const movedOpenNotePath = activeNotePath.value === sourcePath
      ? newPath
      : activeNotePath.value?.startsWith(`${sourcePath}/`) ? `${newPath}${activeNotePath.value.slice(sourcePath.length)}` : null
    workspace.value = await window.znotes.scanWorkspace(root)
    if (movedOpenNotePath) {
      clearEditor()
      await openNote(movedOpenNotePath)
    }
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '移动失败')
  }
}

async function showEntryInFolder(entry: WorkspaceTreeEntry) {
  if (!workspace.value) return
  if (!hasShowInFolderPreload.value) {
    showOperationError('资源管理器功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  try {
    await window.znotes.showEntryInFolder(workspace.value.workspace.path, entry.relativePath)
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '无法打开资源管理器')
  }
}

function showRootDropTarget(event: DragEvent) {
  if (event.target !== event.currentTarget) return
  const sourcePath = getWorkspaceDragPath()
  const parentPath = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
  isRootDropActive.value = Boolean(sourcePath) && parentPath !== ''
  if (event.dataTransfer) event.dataTransfer.dropEffect = isRootDropActive.value ? 'move' : 'none'
}

function dropIntoRoot(event: DragEvent) {
  if (event.target !== event.currentTarget) return
  const sourcePath = getWorkspaceDragPath()
  const allowed = isRootDropActive.value
  isRootDropActive.value = false
  endWorkspaceDrag()
  if (allowed) void moveEntry(sourcePath, '')
}

function showOperationError(message: string) {
  window.clearTimeout(operationTimer)
  operationTone.value = 'error'
  operationMessage.value = message
}

function showOperationSuccess(message: string) {
  window.clearTimeout(operationTimer)
  operationTone.value = 'success'
  operationMessage.value = message
  operationTimer = window.setTimeout(() => {
    operationMessage.value = ''
  }, 1600)
}

function closeTransientUi() {
  window.clearTimeout(operationTimer)
  operationMessage.value = ''
  pendingDelete.value = null
  pendingPurge.value = null
  restoreConflictItem.value = null
  previewImage.value = null
  isTrashOpen.value = false
  isOutlineOpen.value = false
  isNoteLinkOpen.value = false
  isTableDialogOpen.value = false
  isSettingsOpen.value = false
  isResetSettingsOpen.value = false
  workspaceRenameId.value = null
  pendingWorkspaceRemoval.value = null
  pendingWorkspaceMigration.value = null
  workspaceMigrationError.value = ''
  isSaveConflictOpen.value = false
  isDraftRecoveryOpen.value = false
  isAttachmentScanOpen.value = false
  isAttachmentCleanupPending.value = false
  isExpiredTrashOpen.value = false
  openEntryMenuPath.value = null
  isCreateMenuOpen.value = false
  isEditorMenuOpen.value = false
  isRootDropActive.value = false
  closeSearch()
  closeFind()
}

function updateEditorSettings() {
  saveEditorSettings(editorSettings.value)
}

function resetDefaultSettings() {
  editorSettings.value = { ...defaultEditorSettings }
  saveEditorSettings(editorSettings.value)
  globalNoteSearchEnabled.value = false
  saveGlobalNoteSearchEnabled(false)
  globalWorkspaceSearchEnabled.value = false
  saveGlobalWorkspaceSearchEnabled(false)
  trashRetentionDays.value = 30
  trashRetentionInput.value = 30
  saveTrashRetentionDays(30)
  expiredTrashItems.value = []
  isExpiredTrashOpen.value = false
  isResetSettingsOpen.value = false
  void syncGlobalNoteFeatures()
  void checkExpiredTrash()
}

async function checkExpiredTrash() {
  if (!workspace.value || trashRetentionDays.value === null || window.znotes.apiVersion < 11 || isExpiredTrashBusy.value) return
  const workspacePath = workspace.value.workspace.path
  isExpiredTrashBusy.value = true
  try {
    const items = await window.znotes.listExpiredTrash(workspacePath, trashRetentionDays.value)
    if (workspace.value?.workspace.path !== workspacePath) return
    expiredTrashItems.value = items
    if (items.length) isExpiredTrashOpen.value = true
  } catch {
    // Expiration checks are advisory; the normal trash view remains available if a background check fails.
  } finally {
    isExpiredTrashBusy.value = false
  }
}

function updateTrashRetention() {
  const days = Math.min(365, Math.max(1, Math.trunc(trashRetentionInput.value || 30)))
  trashRetentionInput.value = days
  trashRetentionDays.value = days
  saveTrashRetentionDays(days)
  void checkExpiredTrash()
}

function toggleTrashRetention(event: Event) {
  const never = (event.target as HTMLInputElement).checked
  trashRetentionDays.value = never ? null : trashRetentionInput.value
  saveTrashRetentionDays(trashRetentionDays.value)
  if (never) {
    expiredTrashItems.value = []
    isExpiredTrashOpen.value = false
  } else {
    void checkExpiredTrash()
  }
}

async function confirmExpiredTrashCleanup() {
  if (!workspace.value || trashRetentionDays.value === null || !expiredTrashItems.value.length) return
  isExpiredTrashBusy.value = true
  const workspacePath = workspace.value.workspace.path
  try {
    const count = await window.znotes.deleteExpiredTrashItems(
      workspacePath,
      expiredTrashItems.value.map((item) => item.id),
      trashRetentionDays.value,
    )
    expiredTrashItems.value = []
    isExpiredTrashOpen.value = false
    if (isTrashOpen.value) trashItems.value = await window.znotes.listTrash(workspacePath)
    showOperationSuccess(`已永久清理 ${count} 个过期项目`)
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '清理过期项目失败')
    isExpiredTrashBusy.value = false
    await checkExpiredTrash()
  } finally {
    isExpiredTrashBusy.value = false
  }
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

async function scanUnusedAttachments() {
  if (!workspace.value) return
  if (window.znotes.apiVersion < 10) {
    showOperationError('附件清理功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  if (isDirty.value) {
    await saveCurrentNote()
    if (isDirty.value) {
      showOperationError('当前笔记尚未保存，暂时无法扫描附件')
      return
    }
  }
  isAttachmentScanBusy.value = true
  try {
    unusedAttachments.value = await window.znotes.scanUnusedAttachments(workspace.value.workspace.path)
    isSettingsOpen.value = false
    isAttachmentScanOpen.value = true
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '扫描附件失败')
  } finally {
    isAttachmentScanBusy.value = false
  }
}

async function confirmAttachmentCleanup() {
  if (!workspace.value || !unusedAttachments.value.length) return
  isAttachmentScanBusy.value = true
  isAttachmentCleanupPending.value = false
  try {
    const count = await window.znotes.deleteUnusedAttachments(
      workspace.value.workspace.path,
      unusedAttachments.value.map((item) => item.relativePath),
    )
    unusedAttachments.value = []
    isAttachmentScanOpen.value = false
    showOperationSuccess(`已清理 ${count} 个未使用附件`)
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '清理附件失败')
    await scanUnusedAttachments()
  } finally {
    isAttachmentScanBusy.value = false
  }
}

function requireCurrentPreload() {
  if (hasCurrentPreload.value) return true
  showOperationError('插件后台代码已更新，请完全退出并重新打开此插件后再操作')
  return false
}

function requireTrashPreload() {
  if (hasTrashPreload.value) return true
  showOperationError('回收站功能已更新，请完全退出并重新打开此插件后再操作')
  return false
}

function clearEditor() {
  clearAutoSaveTimer()
  activeNotePath.value = null
  editorContent.value = ''
  savedContent.value = ''
  openedModifiedAt.value = null
  noteBaseUrl.value = ''
  noteMessage.value = ''
  saveConflict.value = null
  isSaveConflictOpen.value = false
  draftRecovery.value = null
  isDraftRecoveryOpen.value = false
}

function canDiscardChanges() {
  if (!isDirty.value) return true
  if (!window.confirm('当前笔记尚未保存，确定放弃修改吗？')) return false
  if (workspace.value && activeNotePath.value) clearNoteDraft(workspace.value.workspace.id, activeNotePath.value)
  return true
}

onMounted(async () => {
  window.addEventListener('keydown', handleShortcut, true)
  window.addEventListener('click', closeEntryMenu)
  if (!hasRuntime.value) {
    isRestoring.value = false
    return
  }

  installNativeSearch()
  window.ztools.onPluginEnter((action) => {
    installNativeSearch()
    const globalTarget = parseGlobalNoteFeatureCode(action.code)
    if (globalTarget) {
      pendingGlobalNoteTarget = globalTarget
      if (!isRestoring.value) {
        pendingGlobalNoteTarget = null
        void openGlobalNoteTarget(globalTarget)
      }
      return
    }
    const globalWorkspaceId = parseGlobalWorkspaceFeatureCode(action.code)
    if (globalWorkspaceId) {
      pendingGlobalWorkspaceId = globalWorkspaceId
      if (!isRestoring.value) {
        pendingGlobalWorkspaceId = null
        void openGlobalWorkspaceTarget(globalWorkspaceId)
      }
      return
    }
    if (action.code !== 'new-note') return
    pendingNewNoteEntry.value = true
    if (workspace.value) void enterNewNoteMode()
  })
  window.ztools.onPluginOut(() => {
    closeTransientUi()
    void window.ztools.removeSubInput()
  })

  try {
    editorMode.value = loadEditorMode()
    editorSettings.value = loadEditorSettings()
    globalNoteSearchEnabled.value = loadGlobalNoteSearchEnabled()
    globalWorkspaceSearchEnabled.value = loadGlobalWorkspaceSearchEnabled()
    registeredWorkspaces.value = loadRegisteredWorkspaces()
    trashRetentionDays.value = loadTrashRetentionDays()
    trashRetentionInput.value = trashRetentionDays.value ?? 30
    const lastPath = loadLastWorkspacePath()
    if (lastPath) {
      try {
        workspace.value = await window.znotes.scanWorkspace(lastPath)
        registerWorkspace(workspace.value.workspace)
        workspaceAction.value = workspace.value.workspace.id
        return
      } catch {
        // Fall back to the device's default workspace when a saved path moved.
      }
    }

    workspace.value = await window.znotes.openDefaultWorkspace(window.ztools.getPath('documents'))
    registerWorkspace(workspace.value.workspace)
    workspaceAction.value = workspace.value.workspace.id
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法创建默认工作区，请手动选择目录'
  } finally {
    isRestoring.value = false
    if (pendingGlobalWorkspaceId) {
      const workspaceId = pendingGlobalWorkspaceId
      pendingGlobalWorkspaceId = null
      await openGlobalWorkspaceTarget(workspaceId)
    } else if (pendingGlobalNoteTarget) {
      const target = pendingGlobalNoteTarget
      pendingGlobalNoteTarget = null
      await openGlobalNoteTarget(target)
    } else if (pendingNewNoteEntry.value && workspace.value) await enterNewNoteMode()
    else await reopenDraftNote()
    void syncGlobalNoteFeatures()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcut, true)
  window.removeEventListener('click', closeEntryMenu)
  window.clearTimeout(operationTimer)
  clearAutoSaveTimer()
  window.clearTimeout(searchTimer)
  window.clearTimeout(globalFeatureTimer)
  closeFind()
  void window.ztools?.removeSubInput()
})

watch(globalFeatureSignature, () => {
  window.clearTimeout(globalFeatureTimer)
  globalFeatureTimer = window.setTimeout(() => { void syncGlobalNoteFeatures() }, 400)
})

function closeEntryMenu(event?: MouseEvent) {
  openEntryMenuPath.value = null
  isCreateMenuOpen.value = false
  isEditorMenuOpen.value = false
  if (!(event?.target instanceof HTMLElement) || !event.target.closest('.search-results')) closeSearch()
}

function closeSearch() {
  if (!isSearchOpen.value && !searchQuery.value) return
  isSearchOpen.value = false
  searchQuery.value = ''
  searchResults.value = []
  selectedSearchIndex.value = 0
  if (hasRuntime.value) {
    window.ztools.setSubInputValue('')
    window.ztools.subInputBlur()
  }
}

function installNativeSearch() {
  window.ztools.setSubInput((input) => {
    const text = typeof input === 'string' ? input : input?.text ?? ''
    searchQuery.value = text
    isSearchOpen.value = Boolean(text.trim())
    if (!text.trim()) searchResults.value = []
  }, '搜索当前工作区笔记（Ctrl+P）', false)
}

function openSearch() {
  if (!workspace.value) return
  if (!hasSearchPreload.value) {
    showOperationError('搜索功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  window.ztools.subInputSelect()
}

async function runSearch() {
  const requestId = ++searchRequestId
  const query = searchQuery.value.trim()
  if (!workspace.value || !query || !hasSearchPreload.value) {
    searchResults.value = []
    isSearching.value = false
    return
  }
  isSearching.value = true
  try {
    const results = await window.znotes.searchWorkspace(workspace.value.workspace.path, query)
    if (requestId !== searchRequestId) return
    searchResults.value = results
    selectedSearchIndex.value = 0
  } catch (error) {
    if (requestId === searchRequestId) showOperationError(error instanceof Error ? error.message : '搜索失败')
  } finally {
    if (requestId === searchRequestId) isSearching.value = false
  }
}

function scheduleSearch() {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void runSearch(), 180)
}

async function openSearchResult(result = searchResults.value[selectedSearchIndex.value]) {
  if (!result) return
  closeSearch()
  searchQuery.value = ''
  searchResults.value = []
  await openNote(result.relativePath)
}

async function beginCreate(kind: 'note' | 'directory', parentPath = selectedDirectory.value) {
  if (!workspace.value) return
  selectedDirectory.value = parentPath
  cancelRename()
  createKind.value = kind
  createName.value = ''
  createError.value = ''
  await nextTick()
  const parent = Array.from(document.querySelectorAll<HTMLDetailsElement>('.tree-directory'))
    .find((details) => details.dataset.entryPath === parentPath)
  if (parent) parent.open = true
  await nextTick()
  document.querySelector<HTMLInputElement>('.inline-create-input')?.focus()
}

async function enterNewNoteMode() {
  if (!workspace.value || !pendingNewNoteEntry.value) return
  pendingNewNoteEntry.value = false
  selectedEntry.value = null
  selectedDirectory.value = ''
  await beginCreate('note', '')
}

function cancelCreate() {
  createKind.value = null
  createName.value = ''
  createError.value = ''
}

function handleShortcut(event: KeyboardEvent) {
  const eventTarget = event.target instanceof HTMLElement ? event.target : null
  const isEditing = Boolean(eventTarget?.closest('input, textarea, [contenteditable="true"]'))
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f' && activeNotePath.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    void openFind()
    return
  }
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault()
    void openSearch()
    return
  }
  if (event.ctrlKey && event.altKey && event.key === '/') {
    event.preventDefault()
    setEditorMode(editorMode.value === 'ir' ? 'sv' : 'ir')
    return
  }
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveCurrentNote()
    return
  }
  if (event.key === 'F5') {
    event.preventDefault()
    void refreshWorkspace()
    return
  }
  if (event.key === 'Escape' && isSearchOpen.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closeSearch()
    return
  }
  if (event.key === 'Escape' && isNoteLinkOpen.value) {
    event.preventDefault()
    isNoteLinkOpen.value = false
    return
  }
  if (event.key === 'Escape' && isTableDialogOpen.value) {
    event.preventDefault()
    isTableDialogOpen.value = false
    return
  }
  if (event.key === 'Escape' && isFindOpen.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closeFind()
    return
  }
  if (event.key === 'Escape' && isResetSettingsOpen.value) {
    event.preventDefault()
    isResetSettingsOpen.value = false
    return
  }
  if (event.key === 'Escape' && isSettingsOpen.value) {
    event.preventDefault()
    isSettingsOpen.value = false
    return
  }
  if (event.key === 'Escape' && isSaveConflictOpen.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    isSaveConflictOpen.value = false
    return
  }
  if (event.key === 'Escape' && isDraftRecoveryOpen.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    isDraftRecoveryOpen.value = false
    return
  }
  if (event.key === 'Escape' && isAttachmentCleanupPending.value) {
    event.preventDefault()
    isAttachmentCleanupPending.value = false
    return
  }
  if (event.key === 'Escape' && isAttachmentScanOpen.value) {
    event.preventDefault()
    isAttachmentScanOpen.value = false
    return
  }
  if (event.key === 'Escape' && isExpiredTrashOpen.value) {
    event.preventDefault()
    isExpiredTrashOpen.value = false
    return
  }
  if (event.key === 'Escape' && markdownEditor.value?.exitFullscreen()) {
    event.preventDefault()
    return
  }
  if (event.key === 'Escape' && previewImage.value) {
    event.preventDefault()
    previewImage.value = null
    return
  }
  if (event.key === 'Escape' && (restoreConflictItem.value || pendingPurge.value)) {
    restoreConflictItem.value = null
    pendingPurge.value = null
    return
  }
  if (event.key === 'Escape' && isTrashOpen.value) {
    isTrashOpen.value = false
    return
  }
  if (event.key === 'Escape' && isOutlineOpen.value) {
    isOutlineOpen.value = false
    return
  }
  if (event.key === 'Escape' && (openEntryMenuPath.value || isCreateMenuOpen.value || isEditorMenuOpen.value)) {
    openEntryMenuPath.value = null
    isCreateMenuOpen.value = false
    isEditorMenuOpen.value = false
    return
  }
  if (event.key === 'Escape') {
    const focusedElement = document.activeElement
    if (focusedElement instanceof HTMLElement && focusedElement.closest('.markdown-editor')) {
      event.preventDefault()
      event.stopImmediatePropagation()
      focusedElement.blur()
      return
    }
  }
  if (event.key === 'F2' && selectedEntry.value && !isEditing) {
    event.preventDefault()
    beginRename(selectedEntry.value)
    return
  }
  if (event.key === 'Delete' && selectedEntry.value && !isEditing) {
    event.preventDefault()
    void deleteEntry(selectedEntry.value)
    return
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    beginCreate(event.shiftKey ? 'directory' : 'note')
  }
}

function setEditorMode(mode: 'ir' | 'sv') {
  editorMode.value = mode
  if (hasRuntime.value) saveEditorMode(mode)
}

function downloadCurrentNote(content: string, extension: 'md' | 'html', mimeType: string) {
  if (!activeNotePath.value) return
  const fileName = activeNotePath.value.split('/').at(-1)?.replace(/\.md$/i, '') || '笔记'
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileName}.${extension}`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function exportMarkdown() {
  isEditorMenuOpen.value = false
  downloadCurrentNote(editorContent.value, 'md', 'text/markdown')
  showOperationSuccess('已导出 Markdown')
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function exportHtml() {
  isEditorMenuOpen.value = false
  const title = activeNotePath.value?.split('/').at(-1)?.replace(/\.md$/i, '') || '笔记'
  const body = markdownEditor.value?.getHtml() || `<pre>${escapeHtml(editorContent.value)}</pre>`
  const html = `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>body{max-width:920px;margin:0 auto;padding:40px 24px;color:#172033;font:16px/1.7 system-ui,sans-serif}img{max-width:100%;height:auto}pre,code{font-family:ui-monospace,monospace}pre{overflow:auto;padding:16px;background:#f6f8fa;border-radius:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #d0d7de}blockquote{margin-left:0;padding-left:16px;border-left:4px solid #d0d7de;color:#57606a}</style>\n</head>\n<body>${body}</body>\n</html>\n`
  downloadCurrentNote(html, 'html', 'text/html')
  showOperationSuccess('已导出 HTML')
}

function requestMarkdownImport() {
  isEditorMenuOpen.value = false
  markdownImportInput.value?.click()
}

async function importMarkdown(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!window.confirm(`导入“${file.name}”将替换当前笔记内容，是否继续？`)) return
  try {
    editorContent.value = await file.text()
    showOperationSuccess(`已导入 ${file.name}，正在自动保存`)
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : 'Markdown 导入失败')
  }
}

function selectOutlineHeading(headingIndex: number) {
  if (markdownEditor.value?.scrollToHeading(headingIndex)) {
    isOutlineOpen.value = false
  } else {
    showOperationError('未能定位到该标题，请刷新笔记后重试')
  }
}

async function refreshWorkspace() {
  if (!workspace.value || isRefreshing.value) return
  if (draftRecovery.value) {
    isDraftRecoveryOpen.value = true
    showOperationError('请先处理异常退出草稿，再刷新工作区')
    return
  }
  if (isDirty.value) {
    showOperationError('当前笔记有未保存修改，请先保存后再刷新')
    return
  }

  isRefreshing.value = true
  operationMessage.value = ''
  try {
    const root = workspace.value.workspace.path
    workspace.value = await window.znotes.scanWorkspace(root)
    if (activeNotePath.value) {
      const note = await window.znotes.readNote(root, activeNotePath.value)
      editorContent.value = note.content
      savedContent.value = note.content
      openedModifiedAt.value = note.modifiedAt
      noteBaseUrl.value = note.baseUrl
    }
    showOperationSuccess('已刷新工作区')
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '刷新工作区失败')
  } finally {
    isRefreshing.value = false
  }
}

function selectEntry(entry: WorkspaceTreeEntry) {
  selectedEntry.value = entry
  if (entry.kind === 'directory') selectedDirectory.value = entry.relativePath
  else selectedDirectory.value = entry.relativePath.includes('/')
    ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/'))
    : ''
}

function clearTreeSelection() {
  selectedEntry.value = null
  selectedDirectory.value = ''
  cancelCreate()
  cancelRename()
}

function handleTreeAreaClick(event: MouseEvent) {
  if (event.target instanceof HTMLElement && event.target.closest('.workspace-tree, .inline-create')) return
  clearTreeSelection()
}

function beginRename(entry: WorkspaceTreeEntry) {
  if (!requireCurrentPreload()) return
  cancelCreate()
  selectedEntry.value = entry
  renamePath.value = entry.relativePath
  renameName.value = entry.name
  renameError.value = ''
}

function cancelRename() {
  renamePath.value = null
  renameName.value = ''
  renameError.value = ''
}

async function submitRename() {
  if (!workspace.value || !renamePath.value) return
  if (!renameName.value.trim()) {
    cancelRename()
    return
  }
  renameError.value = ''
  const oldPath = renamePath.value
  try {
    const root = workspace.value.workspace.path
    const newPath = await window.znotes.renameEntry(root, oldPath, renameName.value)
    replacePinnedPath(oldPath, newPath)
    replaceHiddenGlobalPath(oldPath, newPath)
    replaceNoteDraftPath(workspace.value.workspace.id, oldPath, newPath)
    if (activeNotePath.value === oldPath) activeNotePath.value = newPath
    else if (activeNotePath.value?.startsWith(`${oldPath}/`)) {
      activeNotePath.value = `${newPath}${activeNotePath.value.slice(oldPath.length)}`
    }
    workspace.value = await window.znotes.scanWorkspace(root)
    const renamed = selectedEntry.value
    selectedEntry.value = renamed ? { ...renamed, name: renameName.value.trim(), relativePath: newPath } : null
    if (renamed?.kind === 'directory') selectedDirectory.value = newPath
    cancelRename()
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '重命名失败')
    await nextTick()
    document.querySelector<HTMLInputElement>('.inline-create-input')?.focus()
  }
}

async function deleteEntry(entry: WorkspaceTreeEntry) {
  if (!workspace.value || !requireCurrentPreload()) return
  const affectsOpenNote = activeNotePath.value === entry.relativePath || activeNotePath.value?.startsWith(`${entry.relativePath}/`)
  if (affectsOpenNote && !canDiscardChanges()) return
  pendingDelete.value = entry
}

async function confirmDelete() {
  if (!workspace.value || !pendingDelete.value) return
  const entry = pendingDelete.value
  const affectsOpenNote = activeNotePath.value === entry.relativePath || activeNotePath.value?.startsWith(`${entry.relativePath}/`)
  pendingDelete.value = null

  try {
    const root = workspace.value.workspace.path
    await window.znotes.moveEntryToTrash(root, entry.relativePath)
    removePinnedPaths(entry.relativePath)
    removeHiddenGlobalPaths(entry.relativePath)
    clearNoteDraftPath(workspace.value.workspace.id, entry.relativePath)
    workspace.value = await window.znotes.scanWorkspace(root)
    selectedEntry.value = null
    selectedDirectory.value = ''
    if (affectsOpenNote) clearEditor()
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '删除失败')
  }
}

async function openTrash() {
  if (!workspace.value || !requireTrashPreload()) return
  trashBusyId.value = 'loading'
  try {
    trashItems.value = await window.znotes.listTrash(workspace.value.workspace.path)
    isTrashOpen.value = true
    void checkExpiredTrash()
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '无法打开回收站')
  } finally {
    trashBusyId.value = null
  }
}

async function restoreTrashItem(item: TrashItem, targetPath?: string) {
  if (!workspace.value) return
  trashBusyId.value = item.id
  try {
    const restoredPath = await window.znotes.restoreTrashItem(workspace.value.workspace.path, item.id, targetPath)
    trashItems.value = await window.znotes.listTrash(workspace.value.workspace.path)
    workspace.value = await window.znotes.scanWorkspace(workspace.value.workspace.path)
    restoreConflictItem.value = null
    showOperationSuccess(`已恢复到 ${restoredPath}`)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (!targetPath && code === 'ENTRY_EXISTS') {
      const slash = item.originalPath.lastIndexOf('/')
      const parent = slash >= 0 ? item.originalPath.slice(0, slash + 1) : ''
      const name = slash >= 0 ? item.originalPath.slice(slash + 1) : item.originalPath
      const extensionIndex = item.kind === 'note' ? name.toLowerCase().lastIndexOf('.md') : -1
      const alternateName = extensionIndex > 0 ? `${name.slice(0, extensionIndex)}（恢复）${name.slice(extensionIndex)}` : `${name}（恢复）`
      restoreConflictItem.value = item
      restorePath.value = `${parent}${alternateName}`
    } else {
      showOperationError(error instanceof Error ? error.message : '恢复失败')
    }
  } finally {
    trashBusyId.value = null
  }
}

function requestPermanentDelete(item: TrashItem) {
  pendingPurge.value = item
}

async function confirmPermanentDelete() {
  if (!workspace.value || !pendingPurge.value) return
  const target = pendingPurge.value
  pendingPurge.value = null
  trashBusyId.value = target === 'all' ? 'all' : target.id
  try {
    if (target === 'all') await window.znotes.emptyTrash(workspace.value.workspace.path)
    else await window.znotes.permanentlyDeleteTrashItem(workspace.value.workspace.path, target.id)
    trashItems.value = await window.znotes.listTrash(workspace.value.workspace.path)
    showOperationSuccess(target === 'all' ? '回收站已清空' : '已永久删除')
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '永久删除失败')
  } finally {
    trashBusyId.value = null
  }
}

async function submitCreate() {
  if (!workspace.value || !createKind.value) return
  if (!createName.value.trim()) {
    cancelCreate()
    return
  }
  createError.value = ''
  try {
    const root = workspace.value.workspace.path
    const relativePath = createKind.value === 'note'
      ? await window.znotes.createNote(root, selectedDirectory.value, createName.value)
      : await window.znotes.createDirectory(root, selectedDirectory.value, createName.value)
    workspace.value = await window.znotes.scanWorkspace(root)
    const createdKind = createKind.value
    cancelCreate()
    if (createdKind === 'note') await openNote(relativePath)
    else selectedDirectory.value = relativePath
  } catch (error) {
    createError.value = error instanceof Error ? error.message : '创建失败'
    await nextTick()
    document.querySelector<HTMLInputElement>('.inline-create-input')?.focus()
  }
}

function chooseDirectory() {
  errorMessage.value = ''
  const paths = window.ztools.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  if (paths?.[0]) selectedPath.value = paths[0]
}

function registerWorkspace(identity: WorkspaceIdentity) {
  const normalizedPath = identity.path.replaceAll('\\', '/').toLocaleLowerCase('en-US')
  registeredWorkspaces.value = [
    ...registeredWorkspaces.value.filter((item) => (
      item.id !== identity.id && item.path.replaceAll('\\', '/').toLocaleLowerCase('en-US') !== normalizedPath
    )),
    { id: identity.id, name: identity.name, path: identity.path },
  ]
  saveRegisteredWorkspaces(registeredWorkspaces.value)
  saveLastWorkspacePath(identity.path)
}

async function handleWorkspaceAction() {
  if (workspaceAction.value !== 'switch') {
    const target = workspaceChoices.value.find((item) => item.id === workspaceAction.value)
    if (!target || target.id === workspace.value?.workspace.id) return
    if (!canDiscardChanges()) {
      workspaceAction.value = workspace.value?.workspace.id ?? 'current'
      return
    }
    try {
      const nextWorkspace = await window.znotes.scanWorkspace(target.path)
      clearEditor()
      workspace.value = nextWorkspace
      registerWorkspace(nextWorkspace.workspace)
      workspaceAction.value = nextWorkspace.workspace.id
    } catch (error) {
      workspaceAction.value = workspace.value?.workspace.id ?? 'current'
      const reason = error instanceof Error ? error.message : '未知错误'
      showOperationError(`“${target.name}”无法打开：${reason}（${target.path}）`)
    }
    return
  }
  if (!canDiscardChanges()) {
    workspaceAction.value = workspace.value?.workspace.id ?? 'current'
    return
  }
  workspaceAction.value = 'current'
  selectedPath.value = ''
  errorMessage.value = ''
  previousWorkspace.value = workspace.value
  workspace.value = null
}

function returnToCurrentWorkspace() {
  if (!previousWorkspace.value) return
  workspace.value = previousWorkspace.value
  workspaceAction.value = previousWorkspace.value.workspace.id
  previousWorkspace.value = null
  selectedPath.value = ''
  errorMessage.value = ''
}

function beginRenameRegisteredWorkspace(item: RegisteredWorkspace) {
  if (window.znotes.apiVersion < 12) {
    showOperationError('工作区管理功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  workspaceRenameId.value = item.id
  workspaceRenameName.value = item.name
  workspaceRenameError.value = ''
}

async function submitWorkspaceRename(item: RegisteredWorkspace) {
  const name = workspaceRenameName.value.trim()
  if (!name) {
    workspaceRenameError.value = '名称不能为空'
    return
  }
  if (name === item.name) {
    workspaceRenameId.value = null
    return
  }
  try {
    const identity = await window.znotes.renameWorkspace(item.path, name)
    registerWorkspace(identity)
    if (workspace.value?.workspace.id === item.id) workspace.value = { ...workspace.value, workspace: identity }
    workspaceRenameId.value = null
    showOperationSuccess(`已改名为“${identity.name}”`)
  } catch (error) {
    workspaceRenameError.value = error instanceof Error ? error.message : '工作区改名失败'
  }
}

async function relinkRegisteredWorkspace(item: RegisteredWorkspace) {
  if (window.znotes.apiVersion < 12) {
    showOperationError('工作区管理功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  const paths = window.ztools.showOpenDialog({ properties: ['openDirectory'] })
  if (!paths?.[0]) return
  try {
    const identity = await window.znotes.relinkWorkspace(paths[0], item.id)
    registerWorkspace(identity)
    if (workspace.value?.workspace.id === item.id) {
      clearEditor()
      workspace.value = await window.znotes.scanWorkspace(identity.path)
    }
    showOperationSuccess(`已重新关联“${identity.name}”`)
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '重新关联失败')
  }
}

async function discoverRegisteredWorkspaces() {
  if (window.znotes.apiVersion < 13) {
    showOperationError('批量恢复功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  const paths = window.ztools.showOpenDialog({ properties: ['openDirectory'] })
  if (!paths?.[0]) return
  isWorkspaceDiscoveryBusy.value = true
  try {
    const identities = await window.znotes.discoverWorkspaces(paths[0])
    identities.forEach(registerWorkspace)
    showOperationSuccess(identities.length ? `已发现并关联 ${identities.length} 个工作区` : '所选目录三层范围内没有找到工作区')
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '批量恢复工作区失败')
  } finally {
    isWorkspaceDiscoveryBusy.value = false
  }
}

function beginWorkspaceMigration(item: RegisteredWorkspace) {
  if (window.znotes.apiVersion < 14) {
    showOperationError('工作区迁移功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  const paths = window.ztools.showOpenDialog({ properties: ['openDirectory'] })
  if (!paths?.[0]) return
  workspaceMigrationError.value = ''
  pendingWorkspaceMigration.value = { workspace: item, targetPath: paths[0] }
}

async function confirmWorkspaceMigration() {
  const pending = pendingWorkspaceMigration.value
  if (!pending || isWorkspaceMigrationBusy.value) return
  isWorkspaceMigrationBusy.value = true
  workspaceMigrationError.value = ''
  try {
    const wasCurrent = workspace.value?.workspace.id === pending.workspace.id
    const notePath = wasCurrent ? activeNotePath.value : null
    if (wasCurrent && isDirty.value) {
      await saveCurrentNote()
      if (isDirty.value) throw new Error('当前笔记尚未保存，暂时无法迁移')
    }
    const identity = await window.znotes.migrateWorkspace(pending.workspace.path, pending.targetPath)
    registerWorkspace(identity)
    pendingWorkspaceMigration.value = null
    isSettingsOpen.value = false
    if (wasCurrent) {
      clearEditor()
      workspace.value = await window.znotes.scanWorkspace(identity.path)
      workspaceAction.value = identity.id
      if (notePath) await openNote(notePath)
    }
    showOperationSuccess('迁移完成，原目录已保留为备份')
  } catch (error) {
    const message = error instanceof Error ? error.message : '工作区迁移失败'
    if (pendingWorkspaceMigration.value) workspaceMigrationError.value = message
    else showOperationError(`工作区已迁移，但切换显示失败：${message}`)
  } finally {
    isWorkspaceMigrationBusy.value = false
  }
}

function removeRegisteredWorkspace(item: RegisteredWorkspace) {
  pendingWorkspaceRemoval.value = item
}

async function confirmRemoveRegisteredWorkspace() {
  const item = pendingWorkspaceRemoval.value
  if (!item) return
  pendingWorkspaceRemoval.value = null
  registeredWorkspaces.value = registeredWorkspaces.value.filter((workspaceItem) => workspaceItem.id !== item.id)
  saveRegisteredWorkspaces(registeredWorkspaces.value)
  if (workspace.value?.workspace.id !== item.id) return
  clearEditor()
  const next = registeredWorkspaces.value[0]
  if (!next) {
    workspace.value = null
    previousWorkspace.value = null
    selectedPath.value = ''
    return
  }
  try {
    workspace.value = await window.znotes.scanWorkspace(next.path)
    workspaceAction.value = next.id
    registerWorkspace(workspace.value.workspace)
  } catch {
    workspace.value = null
    errorMessage.value = `“${next.name}”无法打开，请重新选择或关联目录`
  }
}

async function createWorkspace() {
  if (!selectedPath.value) {
    errorMessage.value = '请先选择一个目录'
    return
  }

  isBusy.value = true
  errorMessage.value = ''
  try {
    await window.znotes.createWorkspace(selectedPath.value, workspaceName.value)
    workspace.value = await window.znotes.scanWorkspace(selectedPath.value)
    clearEditor()
    previousWorkspace.value = null
    registerWorkspace(workspace.value.workspace)
    workspaceAction.value = workspace.value.workspace.id
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法创建工作区'
  } finally {
    isBusy.value = false
  }
}

async function openWorkspace() {
  if (!selectedPath.value) {
    errorMessage.value = '请先选择一个目录'
    return
  }

  isBusy.value = true
  errorMessage.value = ''
  try {
    workspace.value = await window.znotes.scanWorkspace(selectedPath.value)
    clearEditor()
    previousWorkspace.value = null
    registerWorkspace(workspace.value.workspace)
    workspaceAction.value = workspace.value.workspace.id
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法打开工作区'
  } finally {
    isBusy.value = false
  }
}

async function openNote(relativePath: string) {
  if (!workspace.value || relativePath === activeNotePath.value || !canDiscardChanges()) return

  clearAutoSaveTimer()
  isReadingNote.value = true
  noteMessage.value = ''
  let didOpen = false
  try {
    const note = await window.znotes.readNote(workspace.value.workspace.path, relativePath)
    activeNotePath.value = relativePath
    editorContent.value = note.content
    savedContent.value = note.content
    openedModifiedAt.value = note.modifiedAt
    noteBaseUrl.value = note.baseUrl
    saveConflict.value = null
    isSaveConflictOpen.value = false
    const draft = loadNoteDraft(workspace.value.workspace.id, relativePath)
    if (
      draft?.workspaceId === workspace.value.workspace.id &&
      draft.relativePath === relativePath &&
      draft.content !== note.content
    ) {
      draftRecovery.value = { draft, diskContent: note.content, diskModifiedAt: note.modifiedAt }
      isDraftRecoveryOpen.value = true
      noteMessage.value = '发现未保存的异常退出草稿'
    } else {
      if (draft?.workspaceId === workspace.value.workspace.id && draft.relativePath === relativePath) {
        clearNoteDraft(draft.workspaceId, draft.relativePath)
      }
      draftRecovery.value = null
      isDraftRecoveryOpen.value = false
    }
    didOpen = true
  } catch (error) {
    noteMessage.value = error instanceof Error ? error.message : '无法读取笔记'
  } finally {
    isReadingNote.value = false
  }
  if (didOpen) await refreshFindAfterNoteOpen()
}

function recoverDraft() {
  const recovery = draftRecovery.value
  if (!recovery || activeNotePath.value !== recovery.draft.relativePath) return
  editorContent.value = recovery.draft.content
  openedModifiedAt.value = recovery.diskModifiedAt
  draftRecovery.value = null
  isDraftRecoveryOpen.value = false
  noteMessage.value = '已恢复草稿，等待自动保存…'
}

function useDiskRecoveryVersion() {
  const recovery = draftRecovery.value
  if (!recovery) return
  clearNoteDraft(recovery.draft.workspaceId, recovery.draft.relativePath)
  draftRecovery.value = null
  isDraftRecoveryOpen.value = false
  noteMessage.value = '已保留磁盘版本'
}

function isNoteConflict(error: unknown): error is Error & { code: 'NOTE_CONFLICT' } {
  return error instanceof Error && 'code' in error && error.code === 'NOTE_CONFLICT'
}

async function openSaveConflict(notePath: string) {
  if (!workspace.value || activeNotePath.value !== notePath) return
  try {
    const diskNote = await window.znotes.readNote(workspace.value.workspace.path, notePath)
    if (activeNotePath.value !== notePath) return
    saveConflict.value = {
      notePath,
      diskContent: diskNote.content,
      diskModifiedAt: diskNote.modifiedAt,
    }
    isSaveConflictOpen.value = true
    noteMessage.value = '检测到外部修改，自动保存已暂停'
  } catch (error) {
    noteMessage.value = error instanceof Error ? `保存冲突，且无法读取磁盘版本：${error.message}` : '保存冲突，且无法读取磁盘版本'
  }
}

async function useDiskConflictVersion() {
  const conflict = saveConflict.value
  if (!workspace.value || !conflict || activeNotePath.value !== conflict.notePath) return
  isReadingNote.value = true
  try {
    const diskNote = await window.znotes.readNote(workspace.value.workspace.path, conflict.notePath)
    if (activeNotePath.value !== conflict.notePath) return
    editorContent.value = diskNote.content
    savedContent.value = diskNote.content
    openedModifiedAt.value = diskNote.modifiedAt
    clearNoteDraft(workspace.value.workspace.id, conflict.notePath)
    saveConflict.value = null
    isSaveConflictOpen.value = false
    noteMessage.value = '已使用磁盘版本'
  } catch (error) {
    noteMessage.value = error instanceof Error ? `无法读取磁盘版本：${error.message}` : '无法读取磁盘版本'
  } finally {
    isReadingNote.value = false
  }
}

async function keepLocalConflictVersion() {
  const conflict = saveConflict.value
  if (!workspace.value || !conflict || activeNotePath.value !== conflict.notePath) return
  const contentToSave = editorContent.value
  isSavingNote.value = true
  noteMessage.value = '保存中…'
  try {
    const workspacePath = workspace.value.workspace.path
    const result = await window.znotes.saveNote(workspacePath, conflict.notePath, contentToSave, conflict.diskModifiedAt)
    if (activeNotePath.value !== conflict.notePath) return
    openedModifiedAt.value = result.modifiedAt
    savedContent.value = contentToSave
    saveConflict.value = null
    isSaveConflictOpen.value = false
    noteMessage.value = editorContent.value === contentToSave ? '已保存' : '等待自动保存…'
    workspace.value = await window.znotes.scanWorkspace(workspacePath)
  } catch (error) {
    if (isNoteConflict(error)) {
      await openSaveConflict(conflict.notePath)
    } else if (activeNotePath.value === conflict.notePath) {
      noteMessage.value = error instanceof Error ? error.message : '保存失败'
    }
  } finally {
    isSavingNote.value = false
    if (!saveConflict.value && isDirty.value) scheduleAutoSave()
  }
}

async function openEditorLink(href: string) {
  if (!workspace.value || !activeNotePath.value) return
  if (/^https?:\/\//i.test(href)) {
    if (!window.ztools.shellOpenExternal(href)) showOperationError('无法使用系统浏览器打开该链接')
    return
  }
  if (/^znotes:\/\//i.test(href)) {
    if (window.znotes.apiVersion < 15) {
      showOperationError('跨工作区链接功能已更新，请完全退出并重新打开此插件后再操作')
      return
    }
    const workspaceId = href.match(/^znotes:\/\/([^/]+)/i)?.[1]
    const target = registeredWorkspaces.value.find((item) => item.id === workspaceId)
    if (!target) {
      showOperationError('目标工作区尚未关联，请在设置中重新关联')
      return
    }
    try {
      if (isDirty.value) {
        await saveCurrentNote()
        if (isDirty.value) throw new Error('当前笔记尚未保存，暂时无法切换工作区')
      }
      const resolved = await window.znotes.openCrossWorkspaceNoteLink(target.path, href)
      clearEditor()
      workspace.value = await window.znotes.scanWorkspace(resolved.workspace.path)
      registerWorkspace(resolved.workspace)
      workspaceAction.value = resolved.workspace.id
      await openNote(resolved.relativePath)
    } catch (error) {
      showOperationError(error instanceof Error ? error.message : '无法打开跨工作区链接')
    }
    return
  }
  if (!hasLinkPreload.value) {
    showOperationError('链接功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  try {
    const result = await window.znotes.openWorkspaceLink(workspace.value.workspace.path, activeNotePath.value, href)
    if (result.kind === 'note') await openNote(result.relativePath)
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '无法打开该链接')
  }
}

async function openNoteLinkDialog() {
  if (!workspace.value) return
  isNoteLinkOpen.value = true
  noteLinkQuery.value = ''
  isNoteLinkLoading.value = true
  const current = workspace.value
  const candidates = flattenNoteEntries(current.entries).map((note) => ({
    workspaceId: current.workspace.id,
    workspaceName: current.workspace.name,
    workspacePath: current.workspace.path,
    note,
  }))
  const others = registeredWorkspaces.value.filter((item) => item.id !== current.workspace.id)
  const scans = await Promise.allSettled(others.map((item) => window.znotes.scanWorkspace(item.path)))
  scans.forEach((result) => {
    if (result.status !== 'fulfilled') return
    candidates.push(...flattenNoteEntries(result.value.entries).map((note) => ({
      workspaceId: result.value.workspace.id,
      workspaceName: result.value.workspace.name,
      workspacePath: result.value.workspace.path,
      note,
    })))
  })
  noteLinkCandidates.value = candidates
  isNoteLinkLoading.value = false
}

async function insertNoteLink(target: typeof noteLinkCandidates.value[number]) {
  if (!workspace.value || !activeNotePath.value) return
  if (!hasNoteLinkPreload.value) {
    showOperationError('笔记链接功能已更新，请完全退出并重新打开此插件后再操作')
    return
  }
  try {
    const href = target.workspaceId === workspace.value.workspace.id
      ? await window.znotes.createNoteLink(workspace.value.workspace.path, activeNotePath.value, target.note.relativePath)
      : await window.znotes.createCrossWorkspaceNoteLink(target.workspacePath, target.workspaceId, target.note.relativePath)
    if (!markdownEditor.value?.insertNoteLink(target.note.name, href)) throw new Error('编辑器暂时无法插入链接')
    isNoteLinkOpen.value = false
    noteLinkQuery.value = ''
  } catch (error) {
    showOperationError(error instanceof Error ? error.message : '插入笔记链接失败')
  }
}

function openTableDialog() {
  tableRows.value = 3
  tableColumns.value = 3
  isTableDialogOpen.value = true
}

async function openFind() {
  isFindOpen.value = true
  await nextTick()
  findInput.value?.focus()
  findInput.value?.select()
  runCurrentFind(0)
}

function runCurrentFind(direction: -1 | 0 | 1 = 0) {
  const result = markdownEditor.value?.findInNote(findQuery.value, direction) ?? { total: 0, current: 0 }
  findTotal.value = result.total
  findCurrent.value = result.current
}

async function refreshFindAfterNoteOpen() {
  if (!isFindOpen.value) return
  await nextTick()
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  if (!isFindOpen.value) return
  runCurrentFind(0)
  findInput.value?.focus()
}

function closeFind() {
  markdownEditor.value?.clearFind()
  isFindOpen.value = false
  findQuery.value = ''
  findTotal.value = 0
  findCurrent.value = 0
}

function insertTable() {
  const rows = Math.min(20, Math.max(2, Math.trunc(tableRows.value)))
  const columns = Math.min(12, Math.max(1, Math.trunc(tableColumns.value)))
  tableRows.value = rows
  tableColumns.value = columns
  if (!markdownEditor.value?.insertTable(rows, columns)) {
    showOperationError('编辑器暂时无法插入表格')
    return
  }
  isTableDialogOpen.value = false
}

async function saveCurrentNote() {
  if (!workspace.value || !activeNotePath.value) return

  clearAutoSaveTimer()
  if (draftRecovery.value) {
    isDraftRecoveryOpen.value = true
    noteMessage.value = '请先处理异常退出草稿'
    return
  }
  if (isSavingNote.value || !isDirty.value) return

  const workspacePath = workspace.value.workspace.path
  const workspaceId = workspace.value.workspace.id
  const notePath = activeNotePath.value
  const contentToSave = editorContent.value
  const expectedModifiedAt = openedModifiedAt.value
  let didSave = false

  isSavingNote.value = true
  noteMessage.value = '保存中…'
  try {
    const result = await window.znotes.saveNote(
      workspacePath,
      notePath,
      contentToSave,
      expectedModifiedAt,
    )
    didSave = true
    if (activeNotePath.value === notePath) {
      openedModifiedAt.value = result.modifiedAt
      savedContent.value = contentToSave
      noteMessage.value = editorContent.value === contentToSave ? '已保存' : '等待自动保存…'
    }
    clearNoteDraft(workspaceId, notePath, contentToSave)

    const refreshedWorkspace = await window.znotes.scanWorkspace(workspacePath)
    if (workspace.value?.workspace.path === workspacePath) workspace.value = refreshedWorkspace
  } catch (error) {
    if (didSave) {
      showOperationError(error instanceof Error ? `笔记已保存，但目录刷新失败：${error.message}` : '笔记已保存，但目录刷新失败')
    } else if (isNoteConflict(error)) {
      await openSaveConflict(notePath)
    } else if (activeNotePath.value === notePath) {
      noteMessage.value = error instanceof Error ? error.message : '保存失败'
    }
  } finally {
    isSavingNote.value = false
    if (didSave && activeNotePath.value === notePath && isDirty.value) scheduleAutoSave()
  }
}

function clearAutoSaveTimer() {
  window.clearTimeout(autoSaveTimer)
  autoSaveTimer = undefined
}

function scheduleAutoSave() {
  clearAutoSaveTimer()
  if (!workspace.value || !activeNotePath.value || !isDirty.value || saveConflict.value || draftRecovery.value) return

  saveNoteDraft({
    workspaceId: workspace.value.workspace.id,
    relativePath: activeNotePath.value,
    content: editorContent.value,
    updatedAt: Date.now(),
    baseModifiedAt: openedModifiedAt.value,
  })

  noteMessage.value = '等待自动保存…'
  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = undefined
    void saveCurrentNote()
  }, 500)
}

watch(editorContent, scheduleAutoSave)
watch(searchQuery, scheduleSearch)
watch(workspace, (currentWorkspace) => {
  if (!currentWorkspace) {
    pinnedNotePaths.value = []
    hiddenGlobalNotePaths.value = []
    return
  }
  workspaceAction.value = currentWorkspace.workspace.id
  const storedPaths = loadPinnedNotePaths(currentWorkspace.workspace.id)
  const validPaths = new Set(flattenNoteEntries(currentWorkspace.entries).map((note) => note.relativePath))
  const availablePaths = storedPaths.filter((path) => validPaths.has(path))
  pinnedNotePaths.value = availablePaths
  if (availablePaths.length !== storedPaths.length) savePinnedNotePaths(currentWorkspace.workspace.id, availablePaths)
  const storedHiddenPaths = loadHiddenGlobalNotePaths(currentWorkspace.workspace.id)
  const availableHiddenPaths = storedHiddenPaths.filter((path) => validPaths.has(path))
  hiddenGlobalNotePaths.value = availableHiddenPaths
  if (availableHiddenPaths.length !== storedHiddenPaths.length) saveHiddenGlobalNotePaths(currentWorkspace.workspace.id, availableHiddenPaths)
  void checkExpiredTrash()
})
watch(() => workspace.value?.workspace.path, () => {
  isTrashOpen.value = false
  trashItems.value = []
  pendingPurge.value = null
  restoreConflictItem.value = null
  expiredTrashItems.value = []
  isExpiredTrashOpen.value = false
  isOutlineOpen.value = false
  searchQuery.value = ''
  searchResults.value = []
  closeSearch()
  closeFind()
})
watch(activeNotePath, () => {
  isOutlineOpen.value = false
})
</script>

<template>
  <main class="app-shell" :style="editorStyle">
    <section v-if="isRestoring" class="panel">
      <h1>正在恢复工作区…</h1>
    </section>

    <section v-else-if="!hasRuntime" class="panel panel--error">
      <h1>插件运行环境不可用</h1>
      <p>开发时请运行 <code>pnpm dev</code> 并通过 zTools 加载 <code>public/plugin.json</code>。</p>
    </section>

    <template v-else-if="workspace">
      <div v-if="operationMessage" class="operation-message" :class="`operation-message--${operationTone}`" role="status">
        <span>{{ operationMessage }}</span>
        <button type="button" aria-label="关闭提示" @click="operationMessage = ''">×</button>
      </div>
      <header class="topbar">
        <span class="app-title">Markdown 笔记</span>
        <div class="topbar-actions">
          <button
            type="button"
            class="toolbar-icon-button"
            :class="{ 'toolbar-icon-button--spinning': isRefreshing }"
            :disabled="isRefreshing"
            aria-label="刷新工作区"
            title="刷新工作区 (F5)"
            @click="refreshWorkspace"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 5v6h-6" /></svg>
          </button>
          <button type="button" class="toolbar-icon-button" aria-label="打开回收站" title="回收站" @click="openTrash">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14M10 11v6M14 11v6" /></svg>
          </button>
          <button type="button" class="toolbar-icon-button" aria-label="打开设置" title="设置" @click="isSettingsOpen = true">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 14l-1-2 1-2 2-.5.5-2L5 6l2-2 1.5 1.5 2-.5.5-2h2l.5 2 2 .5L17 4l2 2-1.5 1.5.5 2 2 .5 1 2-1 2-2 .5-.5 2L19 18l-2 2-1.5-1.5-2 .5-.5 2h-2l-.5-2-2-.5L7 20l-2-2 1.5-1.5-.5-2z" /></svg>
          </button>
          <select v-model="workspaceAction" aria-label="切换工作区" @change="handleWorkspaceAction">
            <option v-for="item in workspaceChoices" :key="item.id" :value="item.id">{{ item.name }}</option>
            <option value="switch">添加或打开工作区…</option>
          </select>
        </div>
      </header>

      <div v-if="isSearchOpen && searchQuery.trim()" class="search-results" @click.stop>
        <p v-if="isSearching" class="search-state">正在搜索…</p>
        <template v-else>
          <button
            v-for="(result, index) in searchResults"
            :key="result.relativePath"
            type="button"
            :class="{ 'search-result--selected': index === selectedSearchIndex }"
            @mouseenter="selectedSearchIndex = index"
            @mousedown.prevent="openSearchResult(result)"
          >
            <strong>{{ result.name }}</strong>
            <span>{{ result.relativePath }}</span>
            <small v-if="result.snippet">{{ result.snippet }}</small>
          </button>
        </template>
        <p v-if="!isSearching && !searchResults.length" class="search-state">没有找到相关笔记</p>
      </div>

      <section class="workspace-view">
        <aside
          :class="{ 'workspace-root--drop-target': isRootDropActive }"
          @click="handleTreeAreaClick"
          @dragenter.prevent="showRootDropTarget"
          @dragover.prevent="showRootDropTarget"
          @dragleave.self="isRootDropActive = false"
          @drop.prevent="dropIntoRoot"
        >
          <header class="tree-toolbar">
            <p class="create-target">新建位置：{{ createTargetLabel }}</p>
            <div class="create-menu" @click.stop>
              <button type="button" class="create-menu-trigger" aria-label="新建" title="新建笔记或文件夹" @click="isCreateMenuOpen = !isCreateMenuOpen">+</button>
              <div v-if="isCreateMenuOpen" class="create-menu-popover create-menu-popover--left">
                <button type="button" @mousedown.prevent @click="isCreateMenuOpen = false; beginCreate('note')">新建笔记</button>
                <button type="button" @mousedown.prevent @click="isCreateMenuOpen = false; beginCreate('directory')">新建文件夹</button>
              </div>
            </div>
          </header>
          <div v-if="isRootDropActive" class="root-drop-hint">移动到工作区根目录</div>
          <InlineCreate
            v-if="createKind && selectedDirectory === ''"
            v-model:name="createName"
            :kind="createKind"
            :error="createError"
            @submit="submitCreate"
            @cancel="cancelCreate"
          />
          <section v-if="pinnedNotes.length" class="pinned-notes" @click.stop>
            <h2>置顶</h2>
            <div
              v-for="note in pinnedNotes"
              :key="note.relativePath"
              class="pinned-note-row"
              :class="{ 'pinned-note-row--active': note.relativePath === activeNotePath }"
            >
              <button type="button" class="pinned-note" :title="note.relativePath" @click="openNote(note.relativePath)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 4 6 2-1 5 3 3-5 1-3 5-1-6-4-3 5-1z" /></svg>
                <span>{{ note.name }}</span>
              </button>
              <button type="button" class="pinned-note-remove" aria-label="取消置顶" title="取消置顶" @click="togglePinnedNote(note)">×</button>
            </div>
          </section>
          <WorkspaceTree
            v-if="workspace.entries.length"
            :entries="workspace.entries"
            :active-path="activeNotePath"
            :selected-path="selectedEntry?.relativePath ?? ''"
            :create-parent-path="selectedDirectory"
            :create-kind="createKind"
            :create-name="createName"
            :create-error="createError"
            :rename-path="renamePath"
            :rename-name="renameName"
            :rename-error="''"
            :open-menu-path="openEntryMenuPath"
            :pinned-paths="pinnedNotePaths"
            :hidden-global-paths="hiddenGlobalNotePaths"
            :global-note-search-enabled="globalNoteSearchEnabled"
            @open-note="openNote"
            @select-entry="selectEntry"
            @request-create="beginCreate"
            @request-rename="beginRename"
            @request-delete="deleteEntry"
            @toggle-pin="togglePinnedNote"
            @toggle-global-search="toggleGlobalNoteSearch"
            @update:create-name="createName = $event"
            @submit-create="submitCreate"
            @cancel-create="cancelCreate"
            @update:rename-name="renameName = $event"
            @submit-rename="submitRename"
            @cancel-rename="cancelRename"
            @toggle-menu="openEntryMenuPath = $event"
            @request-move="moveEntry"
            @show-in-folder="showEntryInFolder"
          />
          <p v-else class="muted">工作区中还没有 Markdown 笔记。</p>
        </aside>
        <section v-if="activeNotePath" class="editor-panel">
          <header class="editor-toolbar">
            <div>
              <strong>{{ activeNotePath }}</strong>
              <span v-if="isDirty" class="dirty-indicator">等待自动保存</span>
            </div>
            <div class="editor-toolbar-actions">
              <button
                type="button"
                class="note-link-trigger"
                title="插入当前工作区的笔记链接"
                @click="openNoteLinkDialog"
              >
                插入笔记链接
              </button>
              <button
                type="button"
                class="outline-trigger"
                :class="{ 'outline-trigger--active': isOutlineOpen }"
                aria-label="打开大纲"
                title="大纲"
                @click="isOutlineOpen = !isOutlineOpen"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h10" /></svg>
              </button>
              <div class="editor-more-menu" @click.stop>
                <button
                  type="button"
                  class="editor-more-trigger"
                  aria-label="更多编辑器操作"
                  title="更多"
                  :aria-expanded="isEditorMenuOpen"
                  @click="isEditorMenuOpen = !isEditorMenuOpen"
                >⋮</button>
                <div v-if="isEditorMenuOpen" class="editor-more-popover">
                  <button type="button" @click="setEditorMode(editorMode === 'ir' ? 'sv' : 'ir'); isEditorMenuOpen = false">
                    <span class="menu-check">{{ editorMode === 'ir' ? '✓' : '' }}</span>
                    即时渲染
                  </button>
                  <span class="editor-menu-divider" />
                  <button type="button" @click="requestMarkdownImport">导入 Markdown…</button>
                  <button type="button" @click="exportMarkdown">导出 Markdown</button>
                  <button type="button" @click="exportHtml">导出为 HTML</button>
                </div>
              </div>
              <input
                ref="markdownImportInput"
                class="visually-hidden"
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                tabindex="-1"
                @change="importMarkdown"
              />
            </div>
          </header>
          <MarkdownEditor
            ref="markdownEditor"
            v-model="editorContent"
            :mode="editorMode"
            :disabled="isReadingNote"
            :workspace-path="workspace.workspace.path"
            :note-path="activeNotePath"
            :base-url="noteBaseUrl"
            @preview-image="previewImage = $event"
            @fullscreen-change="isEditorFullscreen = $event"
            @toggle-outline="isOutlineOpen = !isOutlineOpen"
            @open-link="openEditorLink"
            @request-table="openTableDialog"
            @operation-error="showOperationError"
          />
          <div v-if="isFindOpen" class="note-find-bar" :class="{ 'note-find-bar--fullscreen': isEditorFullscreen }">
            <input
              ref="findInput"
              v-model="findQuery"
              aria-label="在当前笔记中查找"
              placeholder="在当前笔记中查找"
              autocomplete="off"
              @input="runCurrentFind(0)"
              @keydown.enter.prevent="runCurrentFind($event.shiftKey ? -1 : 1)"
            />
            <span class="note-find-count">{{ findCurrent }}/{{ findTotal }}</span>
            <button type="button" aria-label="上一个匹配项" title="上一个（Shift+Enter）" :disabled="findTotal === 0" @click="runCurrentFind(-1)">↑</button>
            <button type="button" aria-label="下一个匹配项" title="下一个（Enter）" :disabled="findTotal === 0" @click="runCurrentFind(1)">↓</button>
            <button type="button" aria-label="关闭查找" title="关闭（Esc）" @click="closeFind">×</button>
          </div>
          <OutlinePanel
            v-if="isOutlineOpen"
            :class="{ 'outline-panel--fullscreen': isEditorFullscreen }"
            :items="outlineItems"
            @close="isOutlineOpen = false"
            @select="selectOutlineHeading"
          />
          <div
            v-if="noteMessage"
            class="note-message"
            :class="{ 'error-message': !['保存中…', '等待自动保存…', '已保存'].includes(noteMessage) }"
          >
            <span>{{ noteMessage }}</span>
            <button v-if="saveConflict" type="button" @click="isSaveConflictOpen = true">处理冲突</button>
            <button v-if="draftRecovery" type="button" @click="isDraftRecoveryOpen = true">查看草稿</button>
          </div>
        </section>
        <section v-else class="empty-editor">
          <h2>{{ isReadingNote ? '正在读取…' : '选择一篇笔记' }}</h2>
          <p>从左侧目录树中打开一个 Markdown 文件。</p>
          <p v-if="noteMessage" class="error-message">{{ noteMessage }}</p>
        </section>
      </section>

      <div v-if="pendingDelete" class="modal-backdrop" @click.self="pendingDelete = null">
        <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <h2 id="delete-title">移入回收站？</h2>
          <p>“{{ pendingDelete.name }}”将移动到当前工作区的回收站，可以在后续恢复。</p>
          <div class="confirm-actions">
            <button type="button" class="button-secondary" @click="pendingDelete = null">取消</button>
            <button type="button" class="danger-button" @click="confirmDelete">移入回收站</button>
          </div>
        </section>
      </div>

      <div v-if="isNoteLinkOpen" class="modal-backdrop" @click.self="isNoteLinkOpen = false">
        <section class="note-link-dialog" role="dialog" aria-modal="true" aria-labelledby="note-link-title">
          <header>
            <h2 id="note-link-title">插入笔记链接</h2>
            <button type="button" aria-label="关闭" @click="isNoteLinkOpen = false">×</button>
          </header>
          <input v-model="noteLinkQuery" autofocus autocomplete="off" placeholder="搜索笔记名称或路径" />
          <div class="note-link-list">
            <button v-for="item in noteLinkResults" :key="`${item.workspaceId}:${item.note.relativePath}`" type="button" @click="insertNoteLink(item)">
              <strong>{{ item.note.name }}</strong>
              <span>{{ item.workspaceName }} · {{ item.note.relativePath }}</span>
            </button>
            <p v-if="isNoteLinkLoading">正在读取工作区目录…</p>
            <p v-else-if="!noteLinkResults.length">没有可链接的笔记</p>
          </div>
        </section>
      </div>

      <div v-if="isTableDialogOpen" class="modal-backdrop" @click.self="isTableDialogOpen = false">
        <section class="table-dialog" role="dialog" aria-modal="true" aria-labelledby="table-dialog-title">
          <h2 id="table-dialog-title">插入表格</h2>
          <div class="table-size-fields">
            <label>
              行数
              <input v-model.number="tableRows" type="number" min="2" max="20" @keydown.enter="insertTable" />
            </label>
            <span>×</span>
            <label>
              列数
              <input v-model.number="tableColumns" type="number" min="1" max="12" @keydown.enter="insertTable" />
            </label>
          </div>
          <p>行数包含标题行，最多 20 行、12 列。</p>
          <div class="confirm-actions">
            <button type="button" class="button-secondary" @click="isTableDialogOpen = false">取消</button>
            <button type="button" @click="insertTable">插入</button>
          </div>
        </section>
      </div>

      <TrashPanel
        v-if="isTrashOpen"
        :items="trashItems"
        :busy-id="trashBusyId"
        @close="isTrashOpen = false"
        @restore="restoreTrashItem"
        @remove="requestPermanentDelete"
        @empty="pendingPurge = 'all'"
      />

      <div v-if="restoreConflictItem" class="modal-backdrop" @click.self="restoreConflictItem = null">
        <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <h2 id="restore-title">原位置已有同名项目</h2>
          <p>请输入工作区内的新位置或新名称，不会覆盖现有内容。</p>
          <input v-model="restorePath" class="dialog-input" autocomplete="off" @keydown.enter="restoreTrashItem(restoreConflictItem, restorePath)" />
          <div class="confirm-actions">
            <button type="button" class="button-secondary" @click="restoreConflictItem = null">取消</button>
            <button type="button" @click="restoreTrashItem(restoreConflictItem, restorePath)">恢复</button>
          </div>
        </section>
      </div>

      <div v-if="pendingPurge" class="modal-backdrop" @click.self="pendingPurge = null">
        <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="purge-title">
          <h2 id="purge-title">{{ pendingPurge === 'all' ? '清空回收站？' : '永久删除？' }}</h2>
          <p>{{ pendingPurge === 'all' ? '回收站中的所有项目将被永久删除。' : `“${pendingPurge.originalPath}”将被永久删除。` }}此操作无法撤销，也不会删除笔记引用的附件。</p>
          <div class="confirm-actions">
            <button type="button" class="button-secondary" @click="pendingPurge = null">取消</button>
            <button type="button" class="danger-button" @click="confirmPermanentDelete">确认永久删除</button>
          </div>
        </section>
      </div>

      <ImagePreview
        v-if="previewImage"
        :src="previewImage.src"
        :alt="previewImage.alt"
        @close="previewImage = null"
      />
      <div v-if="isSettingsOpen" class="modal-backdrop" @click.self="isSettingsOpen = false">
        <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header><h2 id="settings-title">设置</h2><button type="button" aria-label="关闭设置" @click="isSettingsOpen = false">×</button></header>
          <div class="settings-content">
          <section class="settings-group workspace-settings">
            <div class="workspace-settings-header"><span><h3>工作区</h3><small>从父目录批量找回迁移或同步后的工作区。</small></span><button type="button" class="button-secondary" :disabled="isWorkspaceDiscoveryBusy" @click="discoverRegisteredWorkspaces">{{ isWorkspaceDiscoveryBusy ? '扫描中…' : '批量恢复' }}</button></div>
            <div v-for="item in registeredWorkspaces" :key="item.id" class="workspace-settings-row">
              <span v-if="workspaceRenameId !== item.id"><strong>{{ item.name }}</strong><small>{{ item.path }}</small></span>
              <span v-else class="workspace-rename-field">
                <input v-model="workspaceRenameName" aria-label="新的工作区名称" autocomplete="off" @keydown.enter="submitWorkspaceRename(item)" @keydown.esc="workspaceRenameId = null" />
                <small v-if="workspaceRenameError" class="error-message">{{ workspaceRenameError }}</small>
                <small v-else>{{ item.path }}</small>
              </span>
              <div v-if="workspaceRenameId !== item.id">
                <button type="button" class="button-secondary" @click="beginRenameRegisteredWorkspace(item)">改名</button>
                <button type="button" class="button-secondary" @click="beginWorkspaceMigration(item)">迁移</button>
                <button type="button" class="button-secondary" @click="relinkRegisteredWorkspace(item)">重新关联</button>
                <button type="button" class="button-secondary" @click="removeRegisteredWorkspace(item)">移除</button>
              </div>
              <div v-else>
                <button type="button" class="button-secondary" @click="workspaceRenameId = null">取消</button>
                <button type="button" @click="submitWorkspaceRename(item)">确定</button>
              </div>
            </div>
          </section>
          <section class="settings-group">
            <header class="settings-group-title"><h3>编辑器</h3><small>调整正文显示和当前笔记查找效果。</small></header>
            <label>正文字号 <input v-model.number="editorSettings.fontSize" type="range" min="12" max="24" step="1" @input="updateEditorSettings" /><span>{{ editorSettings.fontSize }} px</span></label>
            <label>正文行高 <input v-model.number="editorSettings.lineHeight" type="range" min="1.2" max="2.4" step="0.1" @input="updateEditorSettings" /><span>{{ editorSettings.lineHeight.toFixed(1) }}</span></label>
            <label>查找匹配颜色 <input v-model="editorSettings.findHighlightColor" type="color" @input="updateEditorSettings" /></label>
          </section>
          <section class="settings-group">
            <header class="settings-group-title"><h3>zTools 集成</h3><small>控制哪些内容可以从 zTools 主搜索中直接打开。</small></header>
            <div class="settings-action-row global-note-search-setting">
              <span><strong>全局笔记搜索</strong><small>{{ globalNoteSearchEnabled ? '已启用：笔记名称可以在 zTools 中搜索，不包含正文。' : '已关闭：所有笔记入口已从 zTools 搜索中移除。' }}</small></span>
              <button type="button" class="settings-switch" :class="{ 'settings-switch--on': globalNoteSearchEnabled }" role="switch" :aria-checked="globalNoteSearchEnabled" @click="toggleGlobalNoteSearchEnabled">
                <i aria-hidden="true"></i><em>{{ globalNoteSearchEnabled ? '已启用' : '已关闭' }}</em>
              </button>
            </div>
            <div class="settings-action-row global-note-search-setting">
              <span><strong>全局工作区搜索</strong><small>{{ globalWorkspaceSearchEnabled ? '已启用：可以通过工作区名称直接打开工作区。' : '默认关闭：不会在 zTools 搜索中显示工作区名称入口。' }}</small></span>
              <button type="button" class="settings-switch" :class="{ 'settings-switch--on': globalWorkspaceSearchEnabled }" role="switch" :aria-checked="globalWorkspaceSearchEnabled" @click="toggleGlobalWorkspaceSearchEnabled">
                <i aria-hidden="true"></i><em>{{ globalWorkspaceSearchEnabled ? '已启用' : '已关闭' }}</em>
              </button>
            </div>
          </section>
          <section class="settings-group">
            <header class="settings-group-title"><h3>附件</h3><small>附件固定保存在工作区的 .assets 目录中。</small></header>
            <div class="settings-action-row"><span><strong>附件清理</strong><small>扫描正常笔记和回收站后，找出没有被引用的附件。</small></span><button type="button" class="button-secondary" :disabled="isAttachmentScanBusy" @click="scanUnusedAttachments">{{ isAttachmentScanBusy ? '扫描中…' : '扫描未使用附件' }}</button></div>
          </section>
          <section class="settings-group">
            <header class="settings-group-title"><h3>回收站</h3><small>到期项目只会提示确认，不会自动永久删除。</small></header>
            <div class="settings-action-row trash-retention-setting" :class="{ 'trash-retention-setting--never': trashRetentionDays === null }">
              <span><strong>保留时间</strong><small>{{ trashRetentionDays === null ? '项目将一直保留，仍可在回收站中手动清理。' : '到期后提示确认，不会自动永久删除。' }}</small></span>
              <div><span class="trash-retention-days"><input v-model.number="trashRetentionInput" type="number" min="1" max="365" :disabled="trashRetentionDays === null" @change="updateTrashRetention" /><em>天</em></span><label><input type="checkbox" :checked="trashRetentionDays === null" @change="toggleTrashRetention" />关闭到期提醒</label></div>
            </div>
          </section>
          </div>
          <footer><button type="button" class="button-secondary" @click="isResetSettingsOpen = true">恢复默认设置</button><button type="button" @click="isSettingsOpen = false">完成</button></footer>
        </section>
      </div>
      <div v-if="isResetSettingsOpen" class="modal-backdrop" @click.self="isResetSettingsOpen = false">
        <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-settings-title">
          <h2 id="reset-settings-title">恢复默认设置？</h2>
          <p>将重置编辑器显示、zTools 全局搜索开关和回收站保留时间。工作区、笔记、置顶和单篇隐藏状态不会改变。</p>
          <div class="confirm-actions">
            <button type="button" class="button-secondary" @click="isResetSettingsOpen = false">取消</button>
            <button type="button" @click="resetDefaultSettings">确认恢复</button>
          </div>
        </section>
      </div>
      <div v-if="pendingWorkspaceRemoval" class="modal-backdrop" @click.self="pendingWorkspaceRemoval = null">
        <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-workspace-title">
          <h2 id="remove-workspace-title">移除工作区？</h2>
          <p>只会从插件中移除“{{ pendingWorkspaceRemoval.name }}”的关联，磁盘目录和所有笔记都不会删除。</p>
          <div class="confirm-actions">
            <button type="button" class="button-secondary" @click="pendingWorkspaceRemoval = null">取消</button>
            <button type="button" @click="confirmRemoveRegisteredWorkspace">确认移除</button>
          </div>
        </section>
      </div>
      <div v-if="pendingWorkspaceMigration" class="modal-backdrop" @click.self="!isWorkspaceMigrationBusy && (pendingWorkspaceMigration = null)">
        <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="migrate-workspace-title">
          <h2 id="migrate-workspace-title">迁移工作区？</h2>
          <p>插件会先完整复制并校验，然后切换到新位置。原目录会保留为备份，不会自动删除。</p>
          <dl class="workspace-migration-paths">
            <div><dt>原位置</dt><dd>{{ pendingWorkspaceMigration.workspace.path }}</dd></div>
            <div><dt>新位置</dt><dd>{{ pendingWorkspaceMigration.targetPath }}</dd></div>
          </dl>
          <p class="dialog-hint">新位置必须是空目录。</p>
          <p v-if="workspaceMigrationError" class="error-message workspace-migration-error">{{ workspaceMigrationError }}</p>
          <div class="confirm-actions">
            <button type="button" class="button-secondary" :disabled="isWorkspaceMigrationBusy" @click="pendingWorkspaceMigration = null">取消</button>
            <button type="button" :disabled="isWorkspaceMigrationBusy" @click="confirmWorkspaceMigration">{{ isWorkspaceMigrationBusy ? '迁移中…' : '开始迁移' }}</button>
          </div>
        </section>
      </div>
      <div v-if="saveConflict && isSaveConflictOpen" class="modal-backdrop">
        <section class="save-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="save-conflict-title">
          <header>
            <div><h2 id="save-conflict-title">笔记内容发生冲突</h2><p>磁盘文件已被其他程序修改，自动保存已暂停。请选择要保留的版本。</p></div>
            <button type="button" aria-label="稍后处理" @click="isSaveConflictOpen = false">×</button>
          </header>
          <div class="save-conflict-versions">
            <label><strong>当前编辑内容</strong><textarea :value="editorContent" readonly spellcheck="false" /></label>
            <label><strong>磁盘版本</strong><textarea :value="saveConflict.diskContent" readonly spellcheck="false" /></label>
          </div>
          <footer class="confirm-actions">
            <button type="button" class="button-secondary" @click="isSaveConflictOpen = false">稍后处理</button>
            <button type="button" class="button-secondary" @click="useDiskConflictVersion">使用磁盘版本</button>
            <button type="button" :disabled="isSavingNote" @click="keepLocalConflictVersion">保留当前版本</button>
          </footer>
        </section>
      </div>
      <div v-if="draftRecovery && isDraftRecoveryOpen" class="modal-backdrop">
        <section class="save-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-recovery-title">
          <header>
            <div><h2 id="draft-recovery-title">发现未保存的草稿</h2><p>上次编辑可能异常中断。请对比草稿和当前磁盘文件后选择。</p></div>
            <button type="button" aria-label="稍后处理" @click="isDraftRecoveryOpen = false">×</button>
          </header>
          <div class="save-conflict-versions">
            <label><strong>异常退出草稿</strong><textarea :value="draftRecovery.draft.content" readonly spellcheck="false" /></label>
            <label><strong>磁盘版本</strong><textarea :value="draftRecovery.diskContent" readonly spellcheck="false" /></label>
          </div>
          <footer class="confirm-actions">
            <button type="button" class="button-secondary" @click="isDraftRecoveryOpen = false">稍后处理</button>
            <button type="button" class="button-secondary" @click="useDiskRecoveryVersion">使用磁盘版本</button>
            <button type="button" @click="recoverDraft">恢复草稿</button>
          </footer>
        </section>
      </div>
      <div v-if="isAttachmentScanOpen" class="modal-backdrop" @click.self="isAttachmentScanOpen = false">
        <section class="attachment-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-scan-title">
          <header><div><h2 id="attachment-scan-title">未使用附件</h2><p>共 {{ unusedAttachments.length }} 个，合计 {{ formatFileSize(unusedAttachments.reduce((total, item) => total + item.size, 0)) }}</p></div><button type="button" aria-label="关闭" @click="isAttachmentScanOpen = false">×</button></header>
          <div class="attachment-scan-list">
            <p v-if="!unusedAttachments.length">没有发现未使用附件。</p>
            <div v-for="item in unusedAttachments" :key="item.relativePath"><span>{{ item.relativePath }}</span><small>{{ formatFileSize(item.size) }}</small></div>
          </div>
          <footer class="confirm-actions"><button type="button" class="button-secondary" @click="isAttachmentScanOpen = false">关闭</button><button v-if="unusedAttachments.length" type="button" class="danger-button" @click="isAttachmentCleanupPending = true">清理这些附件</button></footer>
        </section>
      </div>
      <div v-if="isAttachmentCleanupPending" class="modal-backdrop" @click.self="isAttachmentCleanupPending = false">
        <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-cleanup-title">
          <h2 id="attachment-cleanup-title">永久清理这些附件？</h2>
          <p>将永久删除 {{ unusedAttachments.length }} 个文件，不会进入系统回收站。删除前会重新扫描引用；如果引用发生变化，本次清理会取消。</p>
          <div class="confirm-actions"><button type="button" class="button-secondary" @click="isAttachmentCleanupPending = false">取消</button><button type="button" class="danger-button" :disabled="isAttachmentScanBusy" @click="confirmAttachmentCleanup">确认永久清理</button></div>
        </section>
      </div>
      <div v-if="isExpiredTrashOpen" class="modal-backdrop" @click.self="isExpiredTrashOpen = false">
        <section class="attachment-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="expired-trash-title">
          <header><div><h2 id="expired-trash-title">回收站中有过期项目</h2><p>以下项目已超过 {{ trashRetentionDays }} 天。确认后才会永久删除。</p></div><button type="button" aria-label="稍后处理" @click="isExpiredTrashOpen = false">×</button></header>
          <div class="attachment-scan-list">
            <div v-for="item in expiredTrashItems" :key="item.id"><span>{{ item.originalPath }}</span><small>{{ new Date(item.deletedAt).toLocaleDateString('zh-CN') }}</small></div>
          </div>
          <footer class="confirm-actions"><button type="button" class="button-secondary" @click="isExpiredTrashOpen = false">稍后处理</button><button type="button" class="danger-button" :disabled="isExpiredTrashBusy" @click="confirmExpiredTrashCleanup">{{ isExpiredTrashBusy ? '正在核对…' : `确认永久清理 ${expiredTrashItems.length} 项` }}</button></footer>
        </section>
      </div>
    </template>

    <section v-else class="panel">
      <button v-if="previousWorkspace" type="button" class="back-button" @click="returnToCurrentWorkspace">
        ← 返回当前工作区
      </button>
      <span class="eyebrow">zTools Markdown Notes</span>
      <h1>建立本地笔记工作区</h1>
      <p class="muted">正文将保存为所选目录中的真实 Markdown 文件。</p>

      <label>
        工作区名称
        <input v-model="workspaceName" autocomplete="off" />
      </label>

      <label>
        本地目录
        <div class="path-picker">
          <input :value="selectedPath" readonly placeholder="尚未选择目录" />
          <button type="button" @click="chooseDirectory">选择目录</button>
        </div>
      </label>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <div class="actions">
        <button type="button" :disabled="isBusy" @click="createWorkspace">
          {{ isBusy ? '处理中…' : '创建新工作区' }}
        </button>
        <button type="button" class="button-secondary" :disabled="isBusy" @click="openWorkspace">
          打开已有工作区
        </button>
      </div>
    </section>
  </main>
</template>
