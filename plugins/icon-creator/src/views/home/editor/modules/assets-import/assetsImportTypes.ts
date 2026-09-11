import type { ComputedRef, Ref } from 'vue'
import type { IconTemplateItem } from '../../../editorCatalog'
import type {
  IconifySearchState,
  PasteSVGDialogState,
  UserAssetDialogState,
  UserAssetItem
} from '../../../types'

export type InsertScenePoint = {
  x: number
  y: number
}

export interface HomeAssetsImportState {
  filteredIconifyResults: ComputedRef<string[]>
  iconifyCollectionOptions: ComputedRef<Array<{ label: string; value: string; tag?: string }>>
  iconifySearch: IconifySearchState
  pasteSVGDialog: PasteSVGDialogState
  userAssetDialog: UserAssetDialogState
  userAssets: Ref<UserAssetItem[]>
}

export interface HomeAssetsImportCommands {
  applyIconTemplateAsDocument: (template: IconTemplateItem) => Promise<void>
  confirmPasteSVGImport: () => Promise<void>
  confirmUserAssetDialog: () => Promise<void>
  deleteUserAsset: (asset: UserAssetItem) => void
  handleCanvasDragOver: (event: DragEvent) => void
  handleCanvasDrop: (event: DragEvent) => Promise<void>
  handlePasteSVGDialogShowChange: (show: boolean) => void
  handleUserAssetDialogShowChange: (show: boolean) => void
  handleWindowPaste: (event: ClipboardEvent) => Promise<void>
  importImage: () => void
  importSVG: () => void
  insertIconTemplate: (template: IconTemplateItem, scenePoint?: InsertScenePoint | null) => Promise<void>
  insertIconifyIcon: (iconName: string, scenePoint?: InsertScenePoint | null) => Promise<void>
  insertUserAsset: (asset: UserAssetItem, scenePoint?: InsertScenePoint | null) => Promise<void>
  onImageFileChosen: (event: Event) => Promise<void>
  onSVGFileChosen: (event: Event) => Promise<void>
  openCreateUserAssetDialog: () => void
  openPasteSVGDialog: () => void
  openRenameUserAssetDialog: (asset: UserAssetItem) => void
  readClipboardIntoPasteSVGDialog: () => Promise<void>
  loadMoreIconifyBrowseResults: () => void
  searchIconifyIcons: () => Promise<void>
  setIconifyCollectionFilter: (collection: string) => Promise<void>
}

export interface HomeAssetsImportController {
  state: HomeAssetsImportState
  commands: HomeAssetsImportCommands
}
