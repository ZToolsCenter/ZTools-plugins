type EditorCommandHandler = (...args: any[]) => unknown

export interface EditorCommands {
  addShape: EditorCommandHandler
  addText: EditorCommandHandler
  applyIconTemplateAsDocument: EditorCommandHandler
  closeShortcutDrawer: () => void
  copyAsPNG: () => unknown
  copyAsSVG: () => unknown
  deleteUserAsset: EditorCommandHandler
  importImage: () => unknown
  importSVG: () => unknown
  insertIconTemplate: EditorCommandHandler
  insertIconifyIcon: EditorCommandHandler
  insertUserAsset: EditorCommandHandler
  newDoc: () => unknown
  openCreateUserAssetDialog: () => unknown
  openExportDialog: () => unknown
  openPasteSVGDialog: () => unknown
  openProject: () => unknown
  openRenameUserAssetDialog: EditorCommandHandler
  openShortcutDrawer: () => void
  redo: () => unknown
  saveProject: () => unknown
  searchIconifyIcons: () => unknown
  setSelectionMode: (mode: 'shape' | 'point' | 'segment') => unknown
  setZoom: (value: number) => unknown
  toggleArtboardList: () => void
  toggleKeylineOverlay: () => unknown
  togglePixelGrid: () => unknown
  toggleRuler: () => unknown
  toggleSnapToPixelGrid: () => unknown
  undo: () => unknown
}

export type CreateEditorCommandsOptions = EditorCommands

/**
 * 创建面向 UI 的编辑器命令集合，集中承接顶栏、左栏等入口触发的用户动作。
 * 现阶段命令委托到既有实现以保持行为稳定，后续领域模块迁移时只需替换这里的命令实现而非继续改动模板。
 */
export function createEditorCommands(options: CreateEditorCommandsOptions): EditorCommands {
  return options
}
