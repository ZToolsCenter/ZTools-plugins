import type { Ref } from 'vue'
import type { IconCreatorProjectArtboard, IconCreatorProjectFile, ProjectLoadOptions, SnapshotOptions } from '../../../types'
import type { HistorySnapshot, HistoryState, HomeArtboardStateRefs } from '../../../composables/contracts'

export interface HomeWorkspaceState extends HomeArtboardStateRefs {
  artboardRenameDialog: Ref<{ show: boolean; value: string; targetId: string }>
  draftRestoreDialog: Ref<{ show: boolean; tabCount: number }>
  undoStack: HistorySnapshot[]
  historyIndex: Ref<number>
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
}

export interface HomeWorkspaceCommands {
  addArtboard: () => Promise<void>
  captureHistoryState: () => HistoryState
  clearStoredDraft: () => void
  deleteArtboard: (artboardId: string) => Promise<void>
  duplicateArtboard: (artboardId: string) => void
  flushDraftBeforeDispose: () => void
  jumpToHistory: (index: number) => void
  loadProjectFile: (project: IconCreatorProjectFile, options?: ProjectLoadOptions) => Promise<void>
  newDoc: () => void
  onProjectFileChosen: (event: Event) => Promise<void>
  openProject: () => void
  promptRestoreDraft: () => Promise<void>
  confirmDraftRestore: () => Promise<void>
  handleDraftRestoreDialogShowChange: (show: boolean) => void
  redo: () => void
  renameArtboard: (artboardId: string) => void
  confirmArtboardRename: () => void
  handleArtboardRenameDialogShowChange: (show: boolean) => void
  resetHistoryToCurrentCanvas: () => void
  restoreHistoryState: (state: HistoryState) => void
  saveProject: () => void
  saveProjectAs: (onSaved?: (filePath: string) => void) => void
  saveProjectToPath: (filePath: string) => string | undefined
  /** 立即同步写入一次草稿（不走防抖），供标签新建 / 关闭 / 切换等结构变化节点调用。 */
  saveDraftNow: () => void
  scheduleDraftSave: () => void
  snapshot: (options?: SnapshotOptions) => void
  switchArtboard: (artboardId: string) => Promise<void>
  undo: () => void
}

export interface HomeWorkspaceHelpers {
  captureCurrentArtboard: () => IconCreatorProjectArtboard
  createProjectFile: () => IconCreatorProjectFile
  loadArtboardContent: (artboard: IconCreatorProjectArtboard) => Promise<void>
}

export interface HomeWorkspaceController {
  state: HomeWorkspaceState
  commands: HomeWorkspaceCommands
  helpers: HomeWorkspaceHelpers
}
