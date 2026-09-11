import type { Control, FabricObject, Point } from 'fabric'
import type { FabricBooleanStyleSnapshot } from './geometry/fabricToPathKit'
import type { EditablePathObject, EditableSegmentRef } from './geometry/editablePath'
import type { FillGradientStop, FillGradientType } from './fabric/objectMetadata'
import type { DocumentProjectMeta } from './documentSnapshots'
import type { ProjectGuide } from './documentGuides'
import type { ProjectSymbol } from './symbols'

export type FabricControls = Record<string, Control>

// 左侧面板插入页签：symbols 为文档符号库（可复用定义 + 联动实例，见 symbols.ts 说明）
export type LeftPanelTab = 'shape' | 'text' | 'assets' | 'iconify' | 'templates' | 'symbols'
export type RightPanelTab = 'properties' | 'layers' | 'history'

export type BooleanPreviewHiddenObject = {
  object: FabricObject
  visible: boolean
}

export type StrokeLineType = 'solid' | 'dashed'
export type CurveControlPointKey = 'cp1' | 'cp2'
// 填充面板模式：solid 纯色 / gradient 渐变 / pattern 图案（fabric Pattern fill）。
export type FillModeOption = 'solid' | 'gradient' | 'pattern'

export type UiFillGradientStop = FillGradientStop & {
  id: string
}

export type StyleTargetChannel = 'fill' | 'stroke'
export type StylePresetManagerTab = 'colors' | 'gradients'

export type ColorSwatchItem = {
  id: string
  name: string
  color: string
}

export type ColorPaletteGroup = {
  id: string
  name: string
  colors: ColorSwatchItem[]
}

export type GradientPresetItem = {
  id: string
  name: string
  type: FillGradientType
  stops: FillGradientStop[]
  angle?: number
  centerX?: number
  centerY?: number
  radius?: number
  userCreated?: boolean
}

export type StylePresetSettings = {
  colorPaletteGroups: ColorPaletteGroup[]
  gradientPresets: GradientPresetItem[]
  colorColumns: number
  gradientPresetRows: number
}

export type UserStylePresets = {
  colors: ColorSwatchItem[]
  gradients: GradientPresetItem[]
}

export type ClipboardEntry = {
  object: Record<string, unknown>
  sourceName: string
  kaleidoscopeEnabled: boolean
  sourceMissing: boolean
}

export type UserAssetItem = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  objects: Record<string, unknown>[]
  layerOrder: string[]
  thumbnail: string
}

export type UserAssetDialogState = {
  show: boolean
  mode: 'create' | 'rename'
  name: string
  error: string
  targetId: string
}

export type InternalClipboard = {
  entries: ClipboardEntry[]
  pasteCount: number
}

export type ExportFormat = 'svg' | 'png'
export type PreviewBackgroundMode = 'transparent' | 'light' | 'dark'
export type KeylineTemplate = 'none' | 'material' | 'ios' | 'favicon' | 'custom'

export type IconCreatorProjectViewMode = 'canvas' | 'svg'
export type IconCreatorProjectSvgPreviewMode = 'graphic' | 'code'

export type IconCreatorProjectCanvas = {
  width: number
  height: number
  background: string
  gridSize?: number
  showPixelGrid?: boolean
  snapToPixelGrid?: boolean
  brushSize?: number
  keylineTemplate?: KeylineTemplate
  keylineMargin?: number
  keylineOpacity?: number
}

export type IconCreatorProjectViewport = {
  zoom: number
  panX: number
  panY: number
}

export type IconCreatorProjectViewState = IconCreatorProjectViewport & {
  viewMode: IconCreatorProjectViewMode
  svgPreviewMode: IconCreatorProjectSvgPreviewMode
}

export type IconCreatorProjectArtboard = {
  id: string
  name: string
  canvas: IconCreatorProjectCanvas
  fabric: Record<string, unknown>
  layerOrder: string[]
  thumbnail?: string
}

export type IconCreatorProjectFile = {
  app: 'icon-creator'
  schemaVersion: number
  createdAt: string
  updatedAt: string
  canvas: IconCreatorProjectCanvas
  fabric: Record<string, unknown>
  layerOrder: string[]
  artboards?: IconCreatorProjectArtboard[]
  activeArtboardId?: string
  /**
   * 文档级元数据（命名色板/自定义样式预设/命名画布快照），旧工程文件无此字段。
   * 色板与预设同时随撤销快照持久化，命名快照数据量大只随工程 JSON 保存。
   */
  meta?: DocumentProjectMeta
  /**
   * 文档级对齐参考线（用户从标尺拖出的辅助线，全画板共享，见 documentGuides.ts 说明）。
   * 随工程 JSON / 自动草稿 round-trip，同时以 editorGuides 进入撤销快照；
   * 旧工程无此字段，为空时写出侧省略字段保持旧文件结构不变。
   */
  guides?: ProjectGuide[]
  /**
   * 文档级符号定义（可复用组件库，实例通过 symbolId 引用定义，见 symbols.ts 说明）。
   * 随工程 JSON / 自动草稿 round-trip，同时以 editorSymbols 进入撤销快照；
   * 旧工程无此字段，为空时写出侧省略字段保持旧文件结构不变。
   */
  symbols?: ProjectSymbol[]
}

export type IconCreatorDraftFile = {
  app: 'icon-creator'
  schemaVersion: number
  updatedAt: string
  project: IconCreatorProjectFile
}

export type ParsedProjectFileResult = {
  project: IconCreatorProjectFile
  source: 'project' | 'draft'
}

export type ProjectLoadOptions = {
  keepDraft?: boolean
  resetHistory?: boolean
}

export type SnapshotOptions = {
  autoSave?: boolean
  description?: string
}

export type SpacePanStart = {
  pointerId: number
  x: number
  y: number
  panX: number
  panY: number
}

export type EndpointAttachmentEdge = 'left' | 'right' | 'top' | 'bottom'
export type EndpointAttachmentRatio = number

export type BoundsEndpointAttachment = {
  targetId: string
  kind?: 'bounds'
  edge: EndpointAttachmentEdge
  ratio: EndpointAttachmentRatio
}

export type SegmentEndpointAttachment = {
  targetId: string
  kind: 'segment'
  contourIndex: number
  segmentIndex: number
  ratio: EndpointAttachmentRatio
  normalSign?: 1 | -1
}

export type EndpointAttachment = BoundsEndpointAttachment | SegmentEndpointAttachment
export type EndpointAttachmentMap = Record<string, EndpointAttachment | undefined>

export type EndpointSnapCandidate = {
  target: FabricObject
  attachment: EndpointAttachment
  scenePoint: Point
  distance: number
}

export type EditableSegmentRefWithTarget = EditableSegmentRef & {
  target: EditablePathObject
}

export type LayerContextMenuAction =
  | 'rename'
  | 'show'
  | 'hide'
  | 'lock'
  | 'unlock'
  | 'delete'
  | 'detach-source'
  | 'select-source'
  | 'move-up'
  | 'move-top'
  | 'move-down'
  | 'move-bottom'
  | 'duplicate'
  | 'group'
  | 'ungroup'
  | 'save-user-asset'
  | 'copy-style'
  | 'paste-style'
  // 符号系统：把选中对象保存为可复用定义 / 解除实例与定义的关联（见 symbols.ts 说明）
  | 'create-symbol'
  | 'detach-symbol'
  // 对齐参考线右键菜单（标尺 / 参考线场景复用 LayerContextMenu 组件渲染）
  | 'toggle-guides'
  | 'clear-guides'

export type LayerContextMenuRowAction = {
  key: LayerContextMenuAction
  icon: string
  title: string
  disabled?: boolean
}

export type LayerContextMenuItem =
  | { type: 'separator' }
  | { type?: 'item'; key: LayerContextMenuAction; label: string; icon?: string; danger?: boolean; disabled?: boolean }
  | { type: 'icon-row'; actions: LayerContextMenuRowAction[] }

export type LayerItem = {
  id: string
  canvasIndex: number
  name: string
  obj: FabricObject
}

export type LayerContextMenuState = {
  show: boolean
  x: number
  y: number
}

export type LayerRenameDialogState = {
  show: boolean
  value: string
  target: FabricObject | null
}

export type PasteSVGDialogState = {
  show: boolean
  value: string
  error: string
  loading: boolean
}

export type IconifySearchState = {
  query: string
  lastQuery: string
  loading: boolean
  loadingMore: boolean
  error: string
  results: string[]
  total: number
  inserting: string
  collectionFilter: string
  mode: 'browse' | 'search'
  hasMore: boolean
  /** 全量图标集列表（来自 Iconify /collections 接口，带本地缓存）。 */
  collections: IconifyCollectionInfo[]
  /** 全量图标集列表是否正在加载。 */
  collectionsLoading: boolean
}

export type IconifyCollectionInfo = {
  prefix: string
  name: string
  totalIcons: number
}

export type IconifySearchResponse = {
  icons?: unknown
  total?: unknown
}

export type KeylineSafeArea = {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export type IconCheckSeverity = 'warning' | 'info'

export type IconCheckIssue = {
  id: string
  severity: IconCheckSeverity
  title: string
  detail: string
  target?: FabricObject
  targetName?: string
}

export type ParsedCanvasColor = {
  r: number
  g: number
  b: number
  a: number
}

export type StrokeOutlineResult = {
  source: FabricObject
  outline: FabricObject
  sourceIndex: number
  keepFilledSource: boolean
  style: FabricBooleanStyleSnapshot
}

export type BitmapTraceMode = 'alpha' | 'luminance'

export type PreviewItem = {
  size: number
  width: number
  height: number
  dataUrl: string
}

export type ExportDialogState = {
  show: boolean
  svgEnabled: boolean
  svgIncludeBg: boolean
  pngEnabled: boolean
  pngSizes: number[]
  customSizeInput: string
  transparentBg: boolean
  filePrefix: string
  exportAllArtboards: boolean
  status: string
  loading: boolean
}
