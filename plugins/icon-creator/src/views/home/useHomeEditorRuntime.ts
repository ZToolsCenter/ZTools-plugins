import { ref, shallowRef, triggerRef, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useZtoolsTheme } from 'ztools-ui'
import { Canvas, Control, FabricObject, Gradient, Pattern, Shadow, Text, Textbox, Group, ActiveSelection, FabricImage, Path, Point, Rect, Circle, Triangle, Polygon, Line, StaticCanvas, util, loadSVGFromString } from 'fabric'
import {
  BITMAP_FILTER_LABELS,
  BITMAP_FILTER_PARAM_CONFIG,
  BITMAP_FILTER_PARAM_LABELS,
  BITMAP_FILTER_TYPES,
  blendModeToCompositeOperation,
  clampBitmapFilterParam,
  compositeOperationToBlendMode,
  createDefaultBitmapFilterSetting,
  normalizeBlendMode,
  normalizeBitmapFilterSettings,
  readBitmapFilterSettings,
  type BitmapFilterParamKey,
  type BitmapFilterSetting,
  type BitmapFilterType
} from './bitmapFilters'
import { applyBitmapFilterSettings } from './fabric/imageFilters'
import {
  applyBitmapCropSourceRect,
  computeBitmapCropFromDisplayRect,
  type BitmapCropRect
} from './fabric/imageCrop'
import {
  DEFAULT_PATTERN_FILL_REPEAT,
  DEFAULT_PATTERN_FILL_SCALE,
  applyDefaultPatternFillMetadata,
  createPatternFromSource,
  getPatternFillMetadata,
  normalizePatternFillRepeat,
  normalizePatternFillScale,
  readPatternFillState,
  type PatternFillRepeat
} from './fabric/patternFill'
import { html as beautifyHtml } from 'js-beautify'
import { basicShapes, textPresets, canvasPresets, shapePreviewPaths, iconTemplates, colorPaletteGroups as defaultColorPaletteGroups, gradientPresets as defaultGradientPresets } from './editorCatalog'
import type { ShapeLibraryItem, TextLibraryItem, IconTemplateItem } from './editorCatalog'
import {
  DEFAULT_FILL_GRADIENT_ANGLE,
  DEFAULT_FILL_GRADIENT_RADIUS,
  DEFAULT_FILL_GRADIENT_TYPE,
  DEFAULT_KALEIDOSCOPE_COUNT,
  DEFAULT_FILL_MODE,
  EDITOR_OBJECT_ID_PREFIX,
  SERIALIZED_OBJECT_PROPS,
  applyDefaultEndpointSnapMargin,
  applyDefaultFillGradientMetadata,
  applyDefaultKaleidoscopeMetadata,
  applyDefaultSizeRatioLockMetadata,
  applyDefaultShadowEffectsMetadata,
  applyDefaultRotation3DMetadata,
  applyShadowEffectsToFabricObject,
  applyRotation3DTransformToObject,
  extractRotation3DBaseScalesFromObject,
  clearKaleidoscopeMetadata,
  clearRotation3DMetadata,
  cloneFillGradientStops,
  createDefaultShadowEffect,
  createGradientFromMetadata,
  getEndpointSnapMarginMetadata,
  getFillGradientMetadata,
  getNormalizedGradientOffsetSlots,
  getKaleidoscopeMetadata,
  getObjectEndpointSnapMargin,
  getRotation3DMetadata,
  getShadowEffectsMetadata,
  isObjectSizeRatioLocked,
  markObjectSizeRatioLocked,
  normalizeEndpointSnapMargin,
  normalizeKaleidoscopeCount,
  normalizeRotation3DAngle,
  syncFillGradientMetadataFromGradient,
  type FillGradientCoords,
  type AnyFabricObject,
  type FillGradientStop,
  type FillGradientType,
  type FillMode,
  type ShadowEffectItem
} from './fabric/objectMetadata'
// 导入即安装多阴影渲染支持（多投影/内阴影的画布自绘 + SVG 多分支 filter 导出）
import './fabric/multiShadow'
import {
  isEmptyDocumentStyleMeta,
  normalizeDocumentStyleMeta,
  removeDocumentStylePresetByName,
  removeDocumentSwatchByName,
  upsertDocumentStylePreset,
  upsertDocumentSwatch,
  type DocumentStyleMeta,
  type DocumentStylePreset,
  type DocumentStylePresetStyle,
  type DocumentSwatch
} from './documentStyleMeta'
import {
  normalizeDocumentCanvasSnapshots,
  removeDocumentCanvasSnapshotByName,
  upsertDocumentCanvasSnapshot,
  type DocumentCanvasSnapshot
} from './documentSnapshots'
import {
  clampGuidePosition,
  createGuideId,
  findGuideAt,
  moveGuidePosition,
  normalizeDocumentGuides,
  removeGuideById,
  type GuideOrientation,
  type ProjectGuide
} from './documentGuides'
import {
  MAX_PROJECT_SYMBOLS,
  computeSymbolInstanceScale,
  createSymbolId,
  createSymbolInstanceMetadata,
  findProjectSymbolById,
  normalizeProjectSymbols,
  normalizeSymbolName,
  normalizeSymbolObjects,
  normalizeSymbolObjectsToBounds,
  readSymbolInstanceMetadata,
  removeProjectSymbolById,
  upsertProjectSymbol,
  type ProjectSymbol
} from './symbols'
import {
  normalizeColorKey,
  replaceDocumentColor,
  scanDocumentColors,
  type ScannedColorEntry
} from './colorReplace'
import { createShape } from './fabric/shapeFactories'
import { createHomeMcpModule } from './mcp/createHomeMcpModule'
import {
  BITMAP_VECTOR_ALPHA_THRESHOLD,
  BITMAP_VECTOR_DEFAULT_THRESHOLD,
  BITMAP_VECTOR_MAX_TRACE_SIDE,
  BITMAP_VECTOR_TRACE_MULTIPLIER,
  DEFAULT_COLOR_PALETTE_COLUMNS,
  DEFAULT_KEYLINE_MARGIN,
  DEFAULT_KEYLINE_OPACITY,
  DEFAULT_KEYLINE_TEMPLATE,
  EXPORT_PNG_SIZE_OPTIONS,
  GRADIENT_PRESET_GRID_COLUMNS,
  ICONIFY_SEARCH_LIMIT,
  MAX_COLOR_PALETTE_COLUMNS,
  MAX_GRADIENT_PRESET_ROWS,
  MIN_COLOR_PALETTE_COLUMNS,
  MIN_GRADIENT_PRESET_ROWS,
  MIN_PIXEL_GRID_VISIBLE_STEP,
  SMALL_PREVIEW_SIZE_OPTIONS,
  STYLE_PRESET_STORAGE_SCHEMA_VERSION,
  TEXT_OUTLINE_ALPHA_THRESHOLD,
  TEXT_OUTLINE_TRACE_MULTIPLIER,
  USER_ASSET_MAX_THUMBNAIL_SOURCE_SIZE,
  USER_ASSET_STORAGE_KEY,
  USER_ASSET_THUMBNAIL_SIZE,
  USER_STYLE_PRESET_STORAGE_KEY
} from './constants'
import { loadUserPreferences, saveUserPreferences } from './userPreferences'
import type {
  BooleanPreviewHiddenObject,
  BitmapTraceMode,
  BoundsEndpointAttachment,
  ClipboardEntry,
  ColorPaletteGroup,
  ColorSwatchItem,
  CurveControlPointKey,
  EditableSegmentRefWithTarget,
  EndpointAttachment,
  EndpointAttachmentEdge,
  EndpointAttachmentMap,
  EndpointAttachmentRatio,
  EndpointSnapCandidate,
  FabricControls,
  FillModeOption,
  GradientPresetItem,
  IconCreatorProjectFile,
  IconCreatorProjectSvgPreviewMode,
  IconCreatorProjectViewMode,
  IconCheckIssue,
  IconifySearchResponse,
  KeylineSafeArea,
  KeylineTemplate,
  LeftPanelTab,
  PasteSVGDialogState,
  PreviewBackgroundMode,
  PreviewItem,
  RightPanelTab,
  SegmentEndpointAttachment,
  SpacePanStart,
  StrokeLineType,
  StrokeOutlineResult,
  StylePresetManagerTab,
  StylePresetSettings,
  StyleTargetChannel,
  UiFillGradientStop,
  UserAssetItem
} from './types'
import { isTransparentCanvasBg, normalizeCanvasBg, normalizeKeylineMargin, normalizeKeylineOpacity, normalizeKeylineTemplate, normalizePixelGridSize, normalizePixelPaintBrushSize } from './canvasSettings'
import {
  getBrushPaintRegion,
  getGridPaintAnchorCell,
  planGridPaintWrite,
  type GridCell,
  type GridRect
} from './geometry/gridPaint'
import { DEFAULT_TEXT_FONT_FAMILY } from './fontCatalog'
import { buildIconCheckIssues as buildIconCheckIssuesFromContext } from './iconChecks'
import { commitNumericInput, commitPositiveNumericInput, formatNumericInputValue, normalizeInputValue } from './inputUtils'
import { readFileAsDataURL } from './fileUtils'
import { isBooleanCandidate, fabricObjectToPathKitWithApi, fabricStrokeToPathKitWithApi, type FabricBooleanStyleSnapshot } from './geometry/fabricToPathKit'
import { applyBooleanOperation, computeBooleanResult } from './geometry/booleanOps'
import type { BooleanOperation, SubtractDirection } from './geometry/booleanOps'
import { pathKitToEditablePathObject, pathKitToFabricPath } from './geometry/pathKitToFabric'
import { getPathKit, peekPathKit } from './geometry/pathkit'
import type { HistoryState, HomeDraftTabsSnapshot } from './composables/contracts'
import type { DecodedProjectDraft } from './projectDraft'
import { createHomeWorkspaceModule } from './editor/modules/workspace/createHomeWorkspaceModule'
import { createHomeCanvasKernelModule } from './editor/modules/canvas/createHomeCanvasKernelModule'
import { createHomeAssetsImportModule } from './editor/modules/assets-import/createHomeAssetsImportModule'
import { createHomeExportDeliveryModule } from './editor/modules/export-delivery/createHomeExportDeliveryModule'
import { createHomeSelectionModule } from './editor/modules/selection/createHomeSelectionModule'
import { createHomeLayersModule } from './editor/modules/layers/createHomeLayersModule'
import { createHomeDirectEditModule } from './editor/modules/direct-edit/createHomeDirectEditModule'
import { createHomeCropModule } from './editor/modules/crop/createHomeCropModule'
import { createHomePenToolModule } from './editor/modules/pen-tool/createHomePenToolModule'
import type { PenPathData } from './editor/modules/pen-tool/createHomePenToolModule'
import { createHomePaintBucketModule } from './editor/modules/paint-bucket/createHomePaintBucketModule'
import { createEditorRuntime } from './editor/runtime/createEditorRuntime'
import { createEditorServices } from './editor/runtime/editorServices'
import type { EditorModule, EditorRuntime } from './editor/runtime/editorTypes'
import { createEditorCommands } from './editor/state/editorCommands'
import { createEditorSelectors } from './editor/state/editorSelectors'
import { createEditorStore } from './editor/state/editorStore'
import {
  editablePointToLocalObjectPoint,
  getArrowRenderMode,
  getContourSegmentParameterAt,
  getEditablePointArrowHead,
  getHollowShaftArrowLineWidth,
  getHollowShaftArrowSideAngle,
  getHollowShaftArrowTipAngle,
  getEditablePointEndpointInfo,
  getEditableSegmentByLocalPoint,
  getEditableSegmentMidpoint,
  getEditableSegments,
  getEditableAnchorHandleRefs,
  getPointRadius,
  getSelectableEditablePoints,
  insertEditablePointOnObjectSegment,
  isEditablePathObject,
  isEditablePointOpenEndpoint,
  isSameEditableSegmentRef,
  moveEditablePoint,
  moveEditablePoints,
  pathHasSolidArrowHead,
  rebuildEditablePathObject,
  rebuildEditablePathObjectFromPoint,
  removeEditablePointsFromObject,
  resolveEditableSegmentRef,
  setEditablePointsArrowHead,
  setEditableSegmentControlPoint,
  setEditableSegmentType,
  createDefaultArrowHead,
  pathEditableModel,
  createEditablePathObject,
  setObjectCornerRadius,
  setPointCornerRadius,
  setPointsCornerRadius,
  type ArrowHead,
  type ArrowHeadShape,
  type ArrowRenderMode,
  type EditablePathObject,
  type EditablePathSegment,
  type EditablePoint,
  type EditableSegmentRef
} from './geometry/editablePath'

/**
 * 创建 Home 页面壳层所需的编辑器运行时绑定。
 * index.vue 只负责模板布局和事件转发，遗留桥接逻辑集中在这里继续向领域模块迁移。
 */
export function useHomeEditorRuntime() {
  // ── 类型工具 ──
  const KALEIDOSCOPE_CENTER_CONTROL_KEY = 'kaleidoscopeCenter'
  const RADIAL_GRADIENT_CENTER_CONTROL_KEY = 'radialGradientCenter'
  const DIRECT_EDIT_SHAPE_IDS = new Set(['base-line', 'base-arrow-right', 'base-solid-shaft-arrow', 'base-double-solid-shaft-arrow'])
  const FABRIC_TRANSFORM_CONTROL_KEYS = ['tl', 'tr', 'br', 'bl', 'ml', 'mt', 'mr', 'mb', 'mtr']
  const ENDPOINT_SNAP_MARGIN = 4
  let editorObjectIdSeed = 0

  // ── refs ──
  const canvasElRef = ref<HTMLCanvasElement | null>(null)
  const canvasAreaRef = ref<HTMLElement | null>(null)
  const canvasWrapperRef = ref<HTMLElement | null>(null)
  const svgInputRef = ref<HTMLInputElement | null>(null)
  const imgInputRef = ref<HTMLInputElement | null>(null)
  const projectInputRef = ref<HTMLInputElement | null>(null)

  // ── 状态 ──
  let fabricCanvas: Canvas | null = null
  let editorRuntime: EditorRuntime | null = null
  let spacePanStart: SpacePanStart | null = null
  const fabricCanvasVersion = ref(0)
  const artboardIdSeed = ref(0)

  const leftTab = ref<LeftPanelTab>('shape')
  // 应用级偏好（网格间距 / 画笔大小 / 左侧栏收起 / 标尺 / 网格吸附）启动时从本地存储恢复，
  // 变更通过下方 watch 即时写回，保证关闭插件再打开回到上次状态；必须先于依赖这些值的输入框 ref 初始化。
  const userPreferences = loadUserPreferences()
  const leftPanelCollapsed = ref(userPreferences.leftPanelCollapsed)
  const activeRightTab = ref<RightPanelTab>('properties')
  const showRuler = ref(userPreferences.showRuler)
  const showPixelGrid = ref(false)
  const snapToPixelGrid = ref(userPreferences.snapToPixelGrid)
  // ── 对齐参考线（用户参考线，区别于 Keyline 安全区模板）──
  // 参考线数据挂工程级 guides 通道持久化（documentGuides.ts 有归属说明）；
  // showGuides 为会话级视图开关（与 showRuler 同策略），不写入工程文件。
  const guides = ref<ProjectGuide[]>([])
  const showGuides = ref(true)
  // 进行中的参考线拖拽（标尺新建或画布内移动）：orientation + 最新位置 + 被移动的参考线 id
  // （isNew=true 表示从标尺拖出的新建预览，未落定前不写入 guides 列表）。
  const guideDragState = ref<{ orientation: GuideOrientation; position: number; guideId: string | null; isNew: boolean } | null>(null)
  const pixelGridSize = ref(userPreferences.pixelGridSize)
  const pixelGridSizeInput = ref(String(pixelGridSize.value))
  // ── 油漆桶网格上色 ──
  // 画笔大小（N × N 个网格单元格），随画布设置持久化；悬停单元格驱动方形画笔光标（null 时隐藏）。
  const pixelPaintBrushSize = ref(userPreferences.pixelPaintBrushSize)
  const pixelPaintBrushSizeInput = ref(String(pixelPaintBrushSize.value))
  const gridPaintHoverCell = ref<GridCell | null>(null)
  // 进行中的网格上色手势：记录上一锚点单元格用于拖动插值补格；changed 标记手势内是否实际写入过颜色。
  let gridPaintGesture: { lastAnchor: GridCell } | null = null
  let gridPaintChanged = false
  const keylineTemplate = ref<KeylineTemplate>(DEFAULT_KEYLINE_TEMPLATE)
  const keylineMargin = ref(DEFAULT_KEYLINE_MARGIN)
  const keylineOpacity = ref(DEFAULT_KEYLINE_OPACITY)
  const keylineMarginInput = ref(String(keylineMargin.value))
  const zoom = ref(1)
  const canvasPanX = ref(20)
  const canvasPanY = ref(20)
  const spacePanReady = ref(false)
  const isSpacePanning = ref(false)
  const rulerModifierKeys = reactive({ shift: false, ctrl: false, alt: false, meta: false })
  const rulerModifierActive = computed(() => rulerModifierKeys.shift || rulerModifierKeys.ctrl || rulerModifierKeys.alt || rulerModifierKeys.meta)
  const rulerCoordinateHintActive = computed(() => showRuler.value && (rulerModifierActive.value || spacePanReady.value || isSpacePanning.value))
  const activeObject = shallowRef<FabricObject | null>(null)
  const canvasWidth = ref(512)
  const canvasHeight = ref(512)
  const canvasWidthInput = ref(String(canvasWidth.value))
  const canvasHeightInput = ref(String(canvasHeight.value))
  const canvasBg = ref('#ffffff')
  const lastOpaqueCanvasBg = ref('#ffffff')
  const canvasPresetValue = ref('512x512')
  const canvasPresetOptions = computed(() => canvasPresets.map(({ label, value }) => ({ label, value })))
  const isCanvasBgTransparent = computed(() => isTransparentCanvasBg(canvasBg.value))
  const currentFillStyleMode = computed<'solid' | FillGradientType | 'pattern'>(() => {
    if (objProps.fillMode === 'pattern') return 'pattern'
    if (objProps.fillMode !== 'gradient') return 'solid'
    return objProps.fillGradientType === 'radial' ? 'radial' : 'linear'
  })
  const canvasBgPickerValue = computed(() => (isCanvasBgTransparent.value ? lastOpaqueCanvasBg.value : canvasBg.value))
  // 根据当前缩放渲染像素网格叠层；缩小时自动合并多格为一格，避免密集线条糊成色块。
  const pixelGridStepMultiplier = computed(() => {
    const baseStep = Math.max(0.0001, pixelGridSize.value * zoom.value)
    return Math.max(1, Math.ceil(MIN_PIXEL_GRID_VISIBLE_STEP / baseStep))
  })
  const effectivePixelGridStep = computed(() => Math.max(0.0001, pixelGridSize.value * zoom.value) * pixelGridStepMultiplier.value)
  const pixelGridOverlayStyle = computed(() => {
    const step = effectivePixelGridStep.value
    return {
      width: `${canvasWidth.value * zoom.value}px`,
      height: `${canvasHeight.value * zoom.value}px`,
      backgroundSize: `${step}px ${step}px`,
      opacity: pixelGridStepMultiplier.value > 1 ? 0.42 : 1
    }
  })
  const keylineOverlayStyle = computed(() => ({
    width: `${canvasWidth.value * zoom.value}px`,
    height: `${canvasHeight.value * zoom.value}px`,
    opacity: keylineOpacity.value
  }))
  const canvasWrapperStyle = computed(() => ({
    transform: `translate(${canvasPanX.value}px, ${canvasPanY.value}px)`
  }))
  const keylineSafeArea = computed<KeylineSafeArea>(() => {
    const width = canvasWidth.value
    const height = canvasHeight.value
    if (keylineTemplate.value === 'material') {
      const margin = Math.min(width, height) * 0.125
      return { x: margin, y: margin, width: Math.max(0, width - margin * 2), height: Math.max(0, height - margin * 2), radius: 0 }
    }
    if (keylineTemplate.value === 'ios') {
      const margin = Math.min(width, height) * 0.09
      return { x: margin, y: margin, width: Math.max(0, width - margin * 2), height: Math.max(0, height - margin * 2), radius: Math.min(width, height) * 0.19 }
    }
    if (keylineTemplate.value === 'favicon') {
      const margin = Math.min(width, height) * 0.18
      return { x: margin, y: margin, width: Math.max(0, width - margin * 2), height: Math.max(0, height - margin * 2), radius: 0 }
    }
    const margin = Math.min(keylineMargin.value, width / 2, height / 2)
    return { x: margin, y: margin, width: Math.max(0, width - margin * 2), height: Math.max(0, height - margin * 2), radius: 0 }
  })
  const iconCheckIssues = computed<IconCheckIssue[]>(() => buildIconCheckIssues())
  const booleanBusy = ref(false)
  const strokeOutlineBusy = ref(false)
  const textOutlineBusy = ref(false)
  const bitmapTraceBusy = ref(false)
  const booleanError = ref('')
  const subtractPopoverVisible = ref(false)
  const booleanPreviewObjects = shallowRef<FabricObject[]>([])
  const booleanPreviewHiddenObjects = shallowRef<BooleanPreviewHiddenObject[]>([])
  let booleanPreviewToken = 0

  const objProps = reactive({
    left: 0, top: 0, width: 0, height: 0,
    leftInput: '0', topInput: '0',
    widthInput: '0', heightInput: '0',
    scaleX: 1, scaleY: 1, angle: 0,
    rotateX: 0, rotateY: 0,
    // 用户翻转意图回显（驱动变换区翻转按钮的激活态），值来自 rotation3dFlipX/Y 元数据而非原生 flip
    flipX: false, flipY: false,
    rotateXInput: '0', rotateYInput: '0', angleInput: '0',
    fill: '#000000', fillEnabled: true, fillMode: 'solid' as FillModeOption, fillGradientType: DEFAULT_FILL_GRADIENT_TYPE as FillGradientType, fillGradientAngle: DEFAULT_FILL_GRADIENT_ANGLE, fillGradientAngleInput: String(DEFAULT_FILL_GRADIENT_ANGLE), fillGradientStops: decorateGradientStops(cloneFillGradientStops(undefined)), fillGradientCenterX: 0.5, fillGradientCenterY: 0.5, fillGradientRadius: DEFAULT_FILL_GRADIENT_RADIUS,
    // 图案填充回显状态：面板展示来源名/平铺方式/缩放，由 syncObjProps 从对象元数据同步。
    fillPatternSourceName: '', fillPatternRepeat: DEFAULT_PATTERN_FILL_REPEAT as PatternFillRepeat, fillPatternScale: DEFAULT_PATTERN_FILL_SCALE,
    stroke: '#000000', strokeEnabled: true, strokeWidth: 0, strokeWidthInput: '0', strokeLineType: 'solid' as StrokeLineType, strokeDashLength: 6, strokeDashGap: 4, strokeDashLengthInput: '6', strokeDashGapInput: '4', opacity: 1,
    bitmapTraceMode: 'alpha' as BitmapTraceMode,
    bitmapTraceThreshold: BITMAP_VECTOR_DEFAULT_THRESHOLD,
    bitmapTraceThresholdInput: String(BITMAP_VECTOR_DEFAULT_THRESHOLD),
    cornerRadius: 0,
    pointCornerRadius: 0,
    endpointSnapMargin: 0,
    arrowLineWidth: 0,
    arrowTipAngle: 0,
    arrowSideAngle: 0,
    cornerRadiusInput: '0',
    pointCornerRadiusInput: '0',
    endpointSnapMarginInput: '0',
    arrowLengthInput: '16',
    arrowLineWidthInput: '0',
    arrowTipAngleInput: '0',
    arrowSideAngleInput: '0',
    curveEnabled: false,
    curveCp1XInput: '0',
    curveCp1YInput: '0',
    curveCp2XInput: '0',
    curveCp2YInput: '0',
    kaleidoscopeEnabled: false,
    kaleidoscopeCenterXInput: '0',
    kaleidoscopeCenterYInput: '0',
    kaleidoscopeFollowRotation: false,
    kaleidoscopeCountInput: String(DEFAULT_KALEIDOSCOPE_COUNT),
    shadowEffects: [] as any[],
    blendMode: 'normal',
    // 文本专属回显状态：由 syncObjProps 从选中集合内的文本对象同步（多选时回显第一个文本对象），
    // 数值字段附带可写的输入缓冲（fontSizeInput 等），键入期间由面板更新缓冲，change 时才提交数值。
    fontFamily: DEFAULT_TEXT_FONT_FAMILY,
    fontSize: 24,
    fontSizeInput: '24',
    fontBold: false,
    fontItalic: false,
    fontUnderline: false,
    fontLinethrough: false,
    charSpacing: 0,
    charSpacingInput: '0',
    lineHeight: 1.16,
    lineHeightInput: '1.16',
    textAlign: 'left',
    bitmapFilters: [] as Array<BitmapFilterSetting & { label: string; paramKey: BitmapFilterParamKey | null; paramLabel: string; paramMin: number; paramMax: number }>
  })
  const sizeRatioLocked = ref(false)
  const lockedAspectRatio = ref(1)

  type CopiedStyle = {
    fill?: any
    fillMode?: FillMode
    fillGradientType?: FillGradientType
    fillGradientStops?: any[]
    fillGradientAngle?: number
    fillGradientCenterX?: number
    fillGradientCenterY?: number
    fillGradientRadius?: number
    fillGradientCoords?: FillGradientCoords
    stroke?: any
    strokeWidth?: number
    strokeDashArray?: number[] | null
    opacity?: number
    shadowEffects?: any[]
  }
  const copiedStyle = ref<CopiedStyle | null>(null)

  const { isDark, primaryColor, customColor } = useZtoolsTheme()

  function getCssVar(name: string, fallback: string, scopeEl?: Element | null) {
    if (typeof window === 'undefined') return fallback
    const candidates = [scopeEl, document.body, document.documentElement]
    for (const candidate of candidates) {
      if (!candidate) continue
      const value = getComputedStyle(candidate).getPropertyValue(name).trim()
      if (value) return value
    }
    return fallback
  }

  function hexToRgba(hex: string, alpha: number) {
    const normalized = hex.trim().replace('#', '')
    const full = normalized.length === 3
      ? normalized.split('').map((char) => char + char).join('')
      : normalized
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex
    const r = Number.parseInt(full.slice(0, 2), 16)
    const g = Number.parseInt(full.slice(2, 4), 16)
    const b = Number.parseInt(full.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  function getCanvasAssistColors() {
    const dark = isDark.value
    const primary = getCssVar('--primary-color', '#0284c7', document.body)
    const border = getCssVar('--border-color', dark ? '#374151' : '#e5e7eb', document.body)
    const textOnPrimary = getCssVar('--text-on-primary', '#ffffff', document.body)
    return {
      primary,
      primarySoft: hexToRgba(primary, dark ? 0.22 : 0.18),
      primaryOverlay: hexToRgba(primary, dark ? 0.18 : 0.10),
      primaryStrong: hexToRgba(primary, 0.85),
      neutralSurface: getCssVar('--control-bg', dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.035)', document.body),
      neutralBorder: border,
      textOnPrimary,
    }
  }

  const homeDirectEdit = createHomeDirectEditModule({
    activeObject,
    getArrowRenderMode,
    getCanvasAssistColors,
    getFabricCanvas: () => fabricCanvas,
    getSelectableEditablePoints,
    getViewportPointForEditablePoint,
    isEditablePathObject,
    isKaleidoscopeInstance,
    resolveEditableSegmentRef,
    syncCanvasInteractionMode: () => syncCanvasInteractionMode(),
    syncObjProps,
    updateCurveControls
  })
  const homePenTool = createHomePenToolModule({
    getFabricCanvas: () => fabricCanvas,
    getCanvasAssistColors,
    getZoom: () => zoom.value,
    snapScenePoint: (point) => getPixelGridAdjustedScenePoint(point),
    addPenPathObject,
    discardActiveObject: () => fabricCanvas?.discardActiveObject()
  })
  const homePaintBucket = createHomePaintBucketModule({
    getFabricCanvas: () => fabricCanvas,
    isExcludedTarget: (obj) => !obj || isBooleanPreviewObject(obj) || isKaleidoscopeInstance(obj as FabricObject),
    applyObjectFill: applyPaintBucketFill,
    applyObjectStroke: applyPaintBucketStroke
  })
  const homeCrop = createHomeCropModule({
    activeObject,
    getCanvasAssistColors,
    getFabricCanvas: () => fabricCanvas,
    onCropApplied: (image, description) => {
      triggerKaleidoscopeContentSync(image)
      fabricCanvas?.requestRenderAll()
      refreshLayers()
      syncObjProps()
      snapshot({ description })
    },
    showToast
  })
  const cropCommands = homeCrop.controller.commands
  const cropModeActive = homeCrop.controller.state.cropModeActive
  const penToolActive = homePenTool.controller.state.penToolActive
  const penCommands = homePenTool.controller.commands
  const paintBucketActive = homePaintBucket.controller.state.paintBucketActive
  const paintBucketCommands = homePaintBucket.controller.commands
  const paintBucketState = homePaintBucket.controller.state
  // 钢笔/油漆桶等"点击画布产生效果"的工具态：抑制 Fabric 原生框选与命中，
  // 避免 mouse:down 之后的内置 setActiveObject 把对象选中（见 canvas kernel 的 syncInteractionMode）。
  const toolSuppressSelection = computed(() => penToolActive.value || paintBucketActive.value)
  // 网格上色模式：油漆桶填充行为 + 网格可见时，点击/拖动不再对对象整体上色，
  // 而是按网格单元格写入同尺寸色块（行为切到 stroke 或关闭网格即回到普通油漆桶语义）。
  const gridPaintMode = computed(() =>
    paintBucketActive.value
    && showPixelGrid.value
    && paintBucketState.paintBehavior.value === 'fill'
  )
  // 方形画笔光标样式：锚定悬停单元格左上角、随网格线吸附移动；退出网格上色或不在画布内时隐藏。
  const gridPaintCursorStyle = computed(() => {
    const cell = gridPaintHoverCell.value
    if (!gridPaintMode.value || !cell) return null
    const step = Math.max(1, pixelGridSize.value)
    const edge = Math.max(1, pixelPaintBrushSize.value) * step * zoom.value
    return {
      left: `${cell.col * step * zoom.value}px`,
      top: `${cell.row * step * zoom.value}px`,
      width: `${edge}px`,
      height: `${edge}px`
    }
  })
  const directEditState = homeDirectEdit.controller.state
  const directEditCommands = homeDirectEdit.controller.commands
  const {
    activeEditablePathObject,
    editablePathMetadataVersion,
    hasEditablePoints,
    hasSelectedPoint,
    selectedEditableSegment,
    selectedPointIndex,
    selectedPointIndices,
    selectedSegmentRef,
    selectionMode
  } = directEditState
  const {
    beginBlankPointGesture,
    beginPointControlGesture,
    clearEditableAssistSelection,
    clearPointEditing,
    clearSelectedPoint,
    clearSelectedSegment,
    cloneCurrentControls,
    consumePointModeSwitchPending,
    consumeRestoreActiveObjectAfterSelectionClear,
    drawPointGestureMarquee,
    finishPointGesture,
    getLiveEditableSegmentRef,
    getPointGestureState,
    handlePointGestureCanvasMove,
    installTemporaryControls,
    isMultiSelectModifierPressed,
    isPointModeSwitchPending,
    normalizeSelectedPointIndices,
    refreshEditablePathMetadata,
    renderPointControl,
    restorePointControls,
    setPointModeSwitchPending,
    setRestoreActiveObjectAfterSelectionClear,
    setSelectedEditablePoints,
    setSelectedEditableSegment,
    setSelectionMode: setSelectionModeDirect,
    shouldProtectPointGestureSelection
  } = directEditCommands
  const pointGestureState = getPointGestureState()

  // 钢笔/油漆桶工具与点位/线段模式互斥：切换到非 shape 模式时先退出两个工具态（钢笔不生成图形），避免覆盖层残留。
  function setSelectionMode(mode: 'shape' | 'point' | 'segment') {
    if (mode !== 'shape') {
      if (penToolActive.value) penCommands.deactivate(false)
      paintBucketCommands.deactivate()
    }
    return setSelectionModeDirect(mode)
  }

  const homeCanvasKernel = createHomeCanvasKernelModule({
    getCanvas: () => fabricCanvas,
    setCanvas: (canvas) => {
      fabricCanvas = canvas
      fabricCanvasVersion.value += 1
    },
    canvasElRef,
    canvasAreaRef,
    canvasWidth,
    canvasHeight,
    canvasBg,
    lastOpaqueCanvasBg,
    zoom,
    panX: canvasPanX,
    panY: canvasPanY,
    sizeRatioLocked,
    selectionMode,
    snapToPixelGrid,
    suppressSelection: toolSuppressSelection,
    isTransparentCanvasBg,
    getCanvasAssistColors,
    getAligningObjectsByTarget,
    ensureCanvasObjectMetadata,
    setupCanvasEvents
  })

  const {
    applyBackground: applyCanvasBgToFabric,
    applyTheme: applyCanvasTheme,
    applyThemeToObject: applyCanvasThemeToObject,
    fitInView: fitCanvasInView,
    setZoom: applyCanvasZoom,
    syncBackgroundFromCanvas: syncCanvasBgFromFabric,
    syncInteractionMode: syncCanvasInteractionMode
  } = homeCanvasKernel.controller

  const homeSelection = createHomeSelectionModule({
    activeObject,
    getCurrentCopyTargets,
    getFabricCanvas: () => fabricCanvas,
    getSelectedLayoutTargets,
    getStrokeOutlineUnsupportedReason,
    isBitmapObject: (obj) => obj instanceof FabricImage,
    isKaleidoscopeObject,
    isKaleidoscopeInstance,
    isTextObject: (obj) => obj instanceof Textbox,
    isBooleanCandidate,
    bitmapTraceBusy,
    booleanBusy,
    strokeOutlineBusy,
    textOutlineBusy
  })
  const selectionState = homeSelection.controller.state
  const selectionCommands = homeSelection.controller.commands
  const {
    canAlignSelection,
    canBoolean,
    canConvertStrokeSelection,
    canConvertTextSelection,
    canDirectionalSubtract,
    canDistributeSelection,
    canGroup,
    canSaveUserAsset,
    canUngroup,
    canVectorizeBitmapSelection,
    layerVersion,
    selectedObjects
  } = selectionState

  const homeLayers = createHomeLayersModule({
    activeObject,
    applyActiveObjectsSelection,
    canGroup,
    canSaveUserAsset,
    canUngroup,
    canPasteStyle: computed(() => copiedStyle.value !== null),
    clearBooleanPreview,
    clearKaleidoscopeMetadata,
    copyStyle: () => copyStyle(),
    deleteObjects,
    detachSymbolInstances: (objects: FabricObject[]) => { detachSymbolInstances(objects) },
    duplicateSelection: () => duplicateSelection(),
    ensureEditorObjectId,
    findKaleidoscopeSourceById,
    getFabricCanvas: () => fabricCanvas,
    getKaleidoscopeInstanceSourceId,
    groupObjects,
    isBooleanPreviewObject,
    isKaleidoscopeInstance,
    isSymbolInstance: (obj: FabricObject | null | undefined) => !!readSymbolInstanceMetadata(obj),
    layerBottom,
    layerDown,
    layerTop,
    layerUp,
    layerVersion,
    openCreateSymbolDialog,
    openCreateUserAssetDialog,
    pasteStyle: () => pasteStyle(),
    refreshActiveObject,
    refreshLayers,
    selectedObjects,
    selectionMode,
    setKaleidoscopeInstanceManagedState,
    setSelectionMode,
    snapshot: () => snapshot(),
    syncObjProps,
    triggerKaleidoscopeVisibilitySync,
    ungroupObject,
    withSnapshotSuppressed
  })
  const layersState = homeLayers.controller.state
  const layersCommands = homeLayers.controller.commands
  const {
    filteredLayers,
    isLayerDragDisabled,
    isLayerDragging,
    layerContextMenu,
    layerContextMenuItems,
    layerDragItems,
    layerRenameDialog,
    layerSearch
  } = layersState
  const {
    confirmLayerRename,
    handleLayerContextMenuSelect,
    handleLayerMouseDown,
    handleLayerRenameDialogShowChange,
    isLayerActive,
    openLayerContextMenu,
    removeObject,
    reorderLayers,
    toggleLock,
    toggleVisible
  } = layersCommands


  // 撤销重做
  let skipSnapshot = false
  function withSnapshotSuppressed<T>(callback: () => T) {
    const previous = skipSnapshot
    skipSnapshot = true
    try {
      return callback()
    } finally {
      skipSnapshot = previous
    }
  }

  // 图层搜索
  const stylePresetSettings = reactive<StylePresetSettings>({
    colorPaletteGroups: defaultColorPaletteGroups.map((group) => ({
      ...group,
      colors: group.colors.map((color) => ({ ...color }))
    })),
    gradientPresets: defaultGradientPresets.map((preset) => ({
      ...preset,
      stops: preset.stops.map((stop) => ({ ...stop }))
    })),
    colorColumns: DEFAULT_COLOR_PALETTE_COLUMNS,
    gradientPresetRows: Math.max(
      MIN_GRADIENT_PRESET_ROWS,
      Math.ceil(defaultGradientPresets.length / GRADIENT_PRESET_GRID_COLUMNS)
    )
  })
  const stylePresetManagerState = reactive<{
    show: boolean
    initialTab: StylePresetManagerTab
  }>({
    show: false,
    initialTab: 'colors'
  })

  // ── 文档级样式元数据（命名色板与自定义样式预设）──
  // 与界面样式面板的“我的颜色”不同，这里的数据随工程文件 meta 字段与撤销快照 editorMeta 持久化，
  // 主要供 MCP 色板/样式预设操作读写，也可以被后续界面功能复用。
  const documentStyleMeta = reactive<DocumentStyleMeta>(normalizeDocumentStyleMeta(null))

  /** 读取文档级样式元数据的可序列化深拷贝，供工程导出与撤销快照使用。 */
  function getDocumentStyleMeta(): DocumentStyleMeta {
    return {
      swatches: documentStyleMeta.swatches.map((item) => ({ ...item })),
      stylePresets: documentStyleMeta.stylePresets.map((item) => ({ name: item.name, style: { ...item.style } }))
    }
  }

  /**
   * 覆盖文档级样式元数据：工程加载传 meta 字段，新建文档传 null 归一化为空结构。
   * 内部先整体归一化，非法数据自动降级，保证响应式状态始终可用。
   */
  function applyDocumentStyleMeta(value: unknown) {
    const next = normalizeDocumentStyleMeta(value)
    documentStyleMeta.swatches = next.swatches
    documentStyleMeta.stylePresets = next.stylePresets
  }

  /** 从撤销快照 JSON 还原文档级样式元数据；解析失败时静默忽略，避免历史回滚被样式数据阻断。 */
  function restoreDocumentStyleMetaFromSnapshot(snapshotJson: string) {
    try {
      const parsed = JSON.parse(snapshotJson) as { editorMeta?: unknown }
      applyDocumentStyleMeta(parsed?.editorMeta)
    } catch {
      // 快照 JSON 由本模块序列化生成，理论上不会解析失败；兜底忽略保持撤销流程可用。
    }
  }

  /** 添加（或按名称覆盖）文档级色板条目，返回更新后的色板副本。 */
  function addDocumentSwatch(name: string, color: string): DocumentSwatch[] {
    documentStyleMeta.swatches = upsertDocumentSwatch(documentStyleMeta.swatches, name, color)
    return documentStyleMeta.swatches.map((item) => ({ ...item }))
  }

  /** 删除文档级色板条目，返回剩余色板副本。 */
  function removeDocumentSwatch(name: string): DocumentSwatch[] {
    documentStyleMeta.swatches = removeDocumentSwatchByName(documentStyleMeta.swatches, name)
    return documentStyleMeta.swatches.map((item) => ({ ...item }))
  }

  /** 保存（或按名称覆盖）文档级自定义样式预设，返回更新后的预设副本。 */
  function saveDocumentStylePreset(name: string, style: DocumentStylePresetStyle): DocumentStylePreset[] {
    documentStyleMeta.stylePresets = upsertDocumentStylePreset(documentStyleMeta.stylePresets, name, style)
    return documentStyleMeta.stylePresets.map((item) => ({ name: item.name, style: { ...item.style } }))
  }

  /** 删除文档级自定义样式预设，返回剩余预设副本。 */
  function removeDocumentStylePreset(name: string): DocumentStylePreset[] {
    documentStyleMeta.stylePresets = removeDocumentStylePresetByName(documentStyleMeta.stylePresets, name)
    return documentStyleMeta.stylePresets.map((item) => ({ name: item.name, style: { ...item.style } }))
  }

  // ── 文档级命名画布快照 ──
  // 与色板/预设不同：快照数据量大且只描述画布视觉状态，只随工程 JSON（meta.snapshots）持久化，
  // 不进入撤销快照（editorMeta），撤销/重做不会回滚快照列表本身。
  const documentCanvasSnapshots = ref<DocumentCanvasSnapshot[]>([])

  /** 读取文档级命名画布快照列表的浅拷贝（canvasJson 创建后不再被修改，浅拷贝即可隔离外部直接改动）。 */
  function getDocumentCanvasSnapshots(): DocumentCanvasSnapshot[] {
    return documentCanvasSnapshots.value.map((item) => ({ ...item }))
  }

  /**
   * 覆盖文档级命名画布快照：工程加载传 meta.snapshots，新建文档传 null 归一化为空列表。
   * 内部整体归一化，非法数据自动降级，保证响应式状态始终可用。
   */
  function applyDocumentCanvasSnapshots(value: unknown) {
    documentCanvasSnapshots.value = normalizeDocumentCanvasSnapshots(value)
  }

  /** 保存（或按名称覆盖）命名画布快照，返回更新后的快照列表副本。 */
  function saveDocumentCanvasSnapshot(name: string, canvasJson: Record<string, unknown>): DocumentCanvasSnapshot[] {
    documentCanvasSnapshots.value = upsertDocumentCanvasSnapshot(documentCanvasSnapshots.value, name, canvasJson)
    return getDocumentCanvasSnapshots()
  }

  /** 删除文档级命名画布快照，返回剩余快照列表副本。 */
  function removeDocumentCanvasSnapshot(name: string): DocumentCanvasSnapshot[] {
    documentCanvasSnapshots.value = removeDocumentCanvasSnapshotByName(documentCanvasSnapshots.value, name)
    return getDocumentCanvasSnapshots()
  }

  /**
   * 用一份画布序列化 JSON 整体替换当前画布内容（命名快照恢复专用路径）：
   * 过程挂起自动撤销快照（由调用方决定何时提交撤销记录），加载后重建
   * 万花筒/渐变/端点贴附等派生状态并同步背景到界面状态。
   * 结束时恢复进入前的快照挂起状态，避免破坏外层批处理的挂起语义。
   */
  async function restoreCanvasContentFromJson(canvasJson: Record<string, unknown>) {
    const fabric = fabricCanvas
    if (!fabric) throw new Error('画布尚未初始化')
    clearBooleanPreview()
    clearPointEditing()
    const previousGate = snapshotGate.get()
    snapshotGate.set(true)
    try {
      await fabric.loadFromJSON(canvasJson)
      await syncAllKaleidoscopes()
      ensureCanvasObjectMetadata()
      rehydrateCanvasGradientFills()
      syncAllEndpointAttachments()
      fabric.discardActiveObject()
      syncActiveObject(null)
      syncCanvasBgFromFabric()
      fabric.requestRenderAll()
      refreshLayers()
      markSmallPreviewsDirty()
    } finally {
      snapshotGate.set(previousGate)
    }
  }

  // Toast 通知状态
  const toast = reactive<{
    message: string
    type: 'success' | 'error' | 'info' | 'warning'
    duration: number
    key: number
  }>({
    message: '',
    type: 'info',
    duration: 3000,
    key: 0
  })

  // 显示 Toast 通知
  function showToast(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', duration = 3000) {
    toast.message = message
    toast.type = type
    toast.duration = duration
    toast.key = Date.now() // 强制重新渲染
  }

  const snapshotGate = {
    get: () => skipSnapshot,
    set: (value: boolean) => {
      skipSnapshot = value
    }
  }
  const canvasState = {
    canvasWidth,
    canvasHeight,
    canvasBg,
    lastOpaqueCanvasBg,
    showPixelGrid,
    snapToPixelGrid,
    pixelGridSize,
    pixelPaintBrushSize,
    keylineTemplate,
    keylineMargin,
    keylineOpacity
  }
  const homeWorkspace = createHomeWorkspaceModule({
    artboardIdSeed,
    getFabricCanvas: () => fabricCanvas,
    serializeFabricCanvas,
    snapshotGate,
    canvasState,
    showToast,
    clearBooleanPreview,
    clearPointEditing,
    syncPixelGridSizeInput,
    syncPixelPaintBrushSizeInput,
    syncKeylineMarginInput,
    syncCanvasSizeInputs,
    syncCanvasInteractionMode,
    applyCanvasBgToFabric,
    syncCanvasBgFromFabric,
    syncActiveObject,
    syncAllKaleidoscopes,
    ensureCanvasObjectMetadata,
    applyProjectLayerOrder,
    rehydrateCanvasGradientFills,
    syncAllEndpointAttachments,
    applyCanvasTheme,
    refreshLayers,
    fitCanvasInView,
    markSmallPreviewsDirty,
    isBooleanPreviewObject,
    ensureEditorObjectId,
    isTransparentCanvasBg,
    endSpacePan,
    cancelSmallPreviewsRefresh,
    projectInputRef,
    afterInitialDocumentReady: initializeProjectTabs,
    getDocumentStyleMeta,
    applyDocumentStyleMeta,
    restoreDocumentStyleMetaFromSnapshot,
    getDocumentSnapshots: getDocumentCanvasSnapshots,
    applyDocumentSnapshots: applyDocumentCanvasSnapshots,
    getDocumentGuides,
    applyDocumentGuides,
    restoreDocumentGuidesFromSnapshot,
    getDocumentSymbols,
    applyDocumentSymbols,
    restoreDocumentSymbolsFromSnapshot,
    getDraftTabsSnapshot: captureDraftTabsSnapshot,
    applyDraftTabs: applyDraftTabsFromDraft
  })
  const {
    artboards,
    activeArtboardId,
    showArtboardList,
    artboardRenameDialog,
    draftRestoreDialog,
    undoStack,
    historyIndex,
    canUndo,
    canRedo
  } = homeWorkspace.controller.state
  const {
    addArtboard,
    captureHistoryState,
    clearStoredDraft,
    confirmArtboardRename,
    confirmDraftRestore,
    handleDraftRestoreDialogShowChange,
    deleteArtboard,
    duplicateArtboard,
    handleArtboardRenameDialogShowChange,
    jumpToHistory: workspaceJumpToHistory,
    loadProjectFile,
    newDoc,
    onProjectFileChosen,
    openProject,
    redo: workspaceRedo,
    renameArtboard,
    resetHistoryToCurrentCanvas,
    restoreHistoryState,
    saveProject,
    saveProjectAs,
    saveProjectToPath,
    saveDraftNow,
    scheduleDraftSave,
    snapshot,
    switchArtboard,
    undo: workspaceUndo
  } = homeWorkspace.controller.commands

  /** 历史操作前置守卫：撤销/重做/跳转会整体替换画布对象，先退出位图裁剪会话避免覆盖层残留。 */
  function exitCropSessionForHistory() {
    if (cropCommands.isCropSessionActive()) cropCommands.cancelCropSession()
  }

  function undo() {
    exitCropSessionForHistory()
    workspaceUndo()
  }

  function redo() {
    exitCropSessionForHistory()
    workspaceRedo()
  }

  function jumpToHistory(index: number) {
    exitCropSessionForHistory()
    workspaceJumpToHistory(index)
  }
  const {
    captureCurrentArtboard,
    createProjectFile,
    loadArtboardContent
  } = homeWorkspace.controller.helpers

  const keylineTemplateOptions: Array<{ value: KeylineTemplate; label: string }> = [
    { value: 'none', label: '无参考线' },
    { value: 'material', label: 'Material Keyline' },
    { value: 'ios', label: 'iOS / macOS 安全区' },
    { value: 'favicon', label: 'Favicon 安全区' },
    { value: 'custom', label: '自定义安全区' }
  ]
  const previewBackgroundOptions: Array<{ value: PreviewBackgroundMode; label: string }> = [
    { value: 'transparent', label: '透明' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' }
  ]
  const svgPreviewModeOptions: Array<{ value: 'graphic' | 'code'; label: string; description: string; icon: string }> = [
    { value: 'graphic', label: '图形模式', description: '以图形方式预览当前 SVG 输出结果。', icon: 'mdi:image-outline' },
    { value: 'code', label: '代码模式', description: '只读查看 SVG 源码，并提供语法高亮。', icon: 'mdi:code-tags' }
  ]
  const previewBackgroundMode = ref<PreviewBackgroundMode>('transparent')
  const canvasViewMode = ref<IconCreatorProjectViewMode>('canvas')
  const svgPreviewMode = ref<IconCreatorProjectSvgPreviewMode>('graphic')
  const previewItems = shallowRef<PreviewItem[]>([])
  const previewPopoverVisible = ref(false)
  const previewDirty = ref(true)
  let previewRenderTimer: ReturnType<typeof window.setTimeout> | null = null

  type ProjectTabState = {
    id: string
    name: string
    project: IconCreatorProjectFile
    selectedObjectIds: string[]
    zoom: number
    panX: number
    panY: number
    viewMode: IconCreatorProjectViewMode
    svgPreviewMode: IconCreatorProjectSvgPreviewMode
    history: HistoryState
    dirty: boolean
    // 记住该标签首次保存选择的绝对路径，之后保存直接覆盖该文件，避免每次都弹保存框。
    savedFilePath: string
  }

  const projectTabs = ref<ProjectTabState[]>([])
  const activeProjectTabId = ref('')
  let projectTabSeed = 0
  let switchingProjectTab = false
  let projectTabSnapshotReady = false
  let suppressProjectTabAutoSave = false
  const hasMultipleProjectTabs = computed(() => projectTabs.value.length > 1)
  const activeProjectTab = computed(() => projectTabs.value.find((tab) => tab.id === activeProjectTabId.value) ?? null)
  const visibleColorPaletteGroups = computed(() => stylePresetSettings.colorPaletteGroups)
  const visibleGradientPresets = computed(() => {
    const maxCount = Math.max(
      GRADIENT_PRESET_GRID_COLUMNS,
      stylePresetSettings.gradientPresetRows * GRADIENT_PRESET_GRID_COLUMNS
    )
    return stylePresetSettings.gradientPresets.slice(0, maxCount)
  })
  const stylePresetColorColumns = computed(() => stylePresetSettings.colorColumns)
  const stylePresetGradientPresets = computed(() => stylePresetSettings.gradientPresets)
  const stylePresetGradientRows = computed(() => stylePresetSettings.gradientPresetRows)
  const defaultStylePresetColorPaletteGroups = computed(() => cloneManagedColorPaletteGroups(defaultColorPaletteGroups))
  const defaultStylePresetGradientPresets = computed(() => cloneManagedGradientPresets(defaultGradientPresets))
  const defaultStylePresetColorColumns = DEFAULT_COLOR_PALETTE_COLUMNS
  const defaultStylePresetGradientRows = Math.max(
    MIN_GRADIENT_PRESET_ROWS,
    Math.ceil(defaultGradientPresets.length / GRADIENT_PRESET_GRID_COLUMNS)
  )
  function refreshLayers() {
    selectionCommands.refreshLayers()
  }

  function createEditorObjectId() {
    editorObjectIdSeed += 1
    return `${EDITOR_OBJECT_ID_PREFIX}${Date.now().toString(36)}-${editorObjectIdSeed.toString(36)}`
  }

  function ensureEditorObjectId(obj: FabricObject | null | undefined) {
    if (!obj) return ''
    const target = obj as AnyFabricObject
    const current = typeof target.editorObjectId === 'string' ? target.editorObjectId.trim() : ''
    if (current) return current
    const next = createEditorObjectId()
    target.editorObjectId = next
    return next
  }

  function getEndpointAttachmentMap(obj: FabricObject | null | undefined): EndpointAttachmentMap {
    if (!obj) return {}
    const target = obj as AnyFabricObject
    const raw = target.endpointAttachments
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      target.endpointAttachments = {}
      return target.endpointAttachments as EndpointAttachmentMap
    }
    return raw as EndpointAttachmentMap
  }

  function getEndpointAttachmentKey(pointIndex: number) {
    return String(pointIndex)
  }

  function setEndpointAttachment(obj: FabricObject, pointIndex: number, attachment: EndpointAttachment | null) {
    const target = obj as AnyFabricObject
    const map = getEndpointAttachmentMap(target)
    const key = getEndpointAttachmentKey(pointIndex)
    if (attachment) {
      map[key] = attachment
    } else {
      delete map[key]
    }
    target.endpointAttachments = { ...map }
  }

  function clearEndpointAttachmentsForPoints(obj: FabricObject, pointIndices: number[]) {
    const target = obj as AnyFabricObject
    const map = getEndpointAttachmentMap(target)
    let touched = false
    pointIndices.forEach((index) => {
      const key = getEndpointAttachmentKey(index)
      if (map[key]) {
        delete map[key]
        touched = true
      }
    })
    if (touched) target.endpointAttachments = { ...map }
  }

  function clearAllEndpointAttachments(obj: FabricObject | null | undefined) {
    if (!obj) return
    const target = obj as AnyFabricObject
    const raw = target.endpointAttachments
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    if (!Object.keys(raw).length) return
    target.endpointAttachments = {}
  }

  function clearOwnedEndpointAttachmentsForTransformedObject(target: FabricObject | null | undefined) {
    if (!target) return
    if (target instanceof ActiveSelection || target instanceof Group) {
      ;(target as ActiveSelection | Group).getObjects().forEach((child) => clearAllEndpointAttachments(child))
    }
    clearAllEndpointAttachments(target)
  }

  function getObjectSceneBounds(object: FabricObject) {
    object.setCoords()
    const points = object.getCoords()
    if (!points.length) return null
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      left = Math.min(left, point.x)
      right = Math.max(right, point.x)
      top = Math.min(top, point.y)
      bottom = Math.max(bottom, point.y)
    }
    if (![left, right, top, bottom].every(Number.isFinite)) return null
    return { left, right, top, bottom, width: right - left, height: bottom - top, points }
  }

  function clampEndpointAttachmentRatio(value: number) {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(1, value))
  }

  function lerpScenePoint(from: Point, to: Point, ratio: number) {
    const amount = clampEndpointAttachmentRatio(ratio)
    return new Point(
      from.x + (to.x - from.x) * amount,
      from.y + (to.y - from.y) * amount
    )
  }

  function getObjectSceneEdge(bounds: NonNullable<ReturnType<typeof getObjectSceneBounds>>, edge: EndpointAttachmentEdge): [Point, Point] {
    if (bounds.points.length >= 4) {
      const [topLeft, topRight, bottomRight, bottomLeft] = bounds.points
      if (edge === 'left') return [topLeft, bottomLeft]
      if (edge === 'right') return [topRight, bottomRight]
      if (edge === 'top') return [topLeft, topRight]
      return [bottomLeft, bottomRight]
    }
    if (edge === 'left') return [new Point(bounds.left, bounds.top), new Point(bounds.left, bounds.bottom)]
    if (edge === 'right') return [new Point(bounds.right, bounds.top), new Point(bounds.right, bounds.bottom)]
    if (edge === 'top') return [new Point(bounds.left, bounds.top), new Point(bounds.right, bounds.top)]
    return [new Point(bounds.left, bounds.bottom), new Point(bounds.right, bounds.bottom)]
  }

  function normalizeSceneVector(dx: number, dy: number) {
    const length = Math.hypot(dx, dy)
    if (!Number.isFinite(length) || length <= 0) return null
    return { x: dx / length, y: dy / length }
  }

  function offsetScenePoint(point: Point, normal: { x: number; y: number } | null, offset: number) {
    if (!normal || !Number.isFinite(offset) || offset === 0) return new Point(point.x, point.y)
    return new Point(point.x + normal.x * offset, point.y + normal.y * offset)
  }

  function getBoundsEdgeOutwardNormal(bounds: NonNullable<ReturnType<typeof getObjectSceneBounds>>, edge: EndpointAttachmentEdge) {
    const [from, to] = getObjectSceneEdge(bounds, edge)
    const edgeVector = normalizeSceneVector(to.x - from.x, to.y - from.y)
    if (!edgeVector) return null
    const center = new Point((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)
    let normal = { x: edgeVector.y, y: -edgeVector.x }
    const midpoint = new Point((from.x + to.x) / 2, (from.y + to.y) / 2)
    const toCenter = { x: center.x - midpoint.x, y: center.y - midpoint.y }
    if (normal.x * toCenter.x + normal.y * toCenter.y > 0) {
      normal = { x: -normal.x, y: -normal.y }
    }
    return normal
  }

  function getEditableContourSignedArea(points: EditablePoint[]) {
    if (points.length < 3) return 0
    let area = 0
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]
      const next = points[(index + 1) % points.length]
      area += current.x * next.y - next.x * current.y
    }
    return area / 2
  }

  function getEditableSegmentOutwardNormal(segmentRef: EditableSegmentRefWithTarget) {
    const from = getEditableSegmentScenePoint(segmentRef.target, segmentRef, 0)
    const to = getEditableSegmentScenePoint(segmentRef.target, segmentRef, 1)
    const edgeVector = normalizeSceneVector(to.x - from.x, to.y - from.y)
    if (!edgeVector) return null
    if (!segmentRef.contour.closed) {
      return { x: edgeVector.y, y: -edgeVector.x }
    }
    const signedArea = getEditableContourSignedArea(segmentRef.contour.points)
    if (signedArea === 0) {
      return { x: edgeVector.y, y: -edgeVector.x }
    }
    return signedArea > 0
      ? { x: edgeVector.y, y: -edgeVector.x }
      : { x: -edgeVector.y, y: edgeVector.x }
  }

  function projectScenePointToSegment(point: Point, from: Point, to: Point) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lenSq = dx * dx + dy * dy
    const ratio = lenSq > 0 ? clampEndpointAttachmentRatio(((point.x - from.x) * dx + (point.y - from.y) * dy) / lenSq) : 0
    const scenePoint = lerpScenePoint(from, to, ratio)
    const distance = Math.hypot(scenePoint.x - point.x, scenePoint.y - point.y)
    return { ratio, scenePoint, distance }
  }

  function resolveBoundsEndpointAttachmentPoint(target: FabricObject, attachment: BoundsEndpointAttachment) {
    const bounds = getObjectSceneBounds(target)
    if (!bounds) return null
    const [from, to] = getObjectSceneEdge(bounds, attachment.edge)
    const basePoint = lerpScenePoint(from, to, attachment.ratio)
    return offsetScenePoint(basePoint, getBoundsEdgeOutwardNormal(bounds, attachment.edge), getObjectEndpointSnapMargin(target))
  }

  function getEditableSegmentPoint(segmentRef: EditableSegmentRef, ratio: number): EditablePoint {
    const amount = clampEndpointAttachmentRatio(ratio)
    const segment = segmentRef.segment
    if (segment.type === 'cubic' && segment.cp1 && segment.cp2) {
      const inverse = 1 - amount
      return {
        x: inverse ** 3 * segmentRef.fromPoint.x
          + 3 * inverse ** 2 * amount * segment.cp1.x
          + 3 * inverse * amount ** 2 * segment.cp2.x
          + amount ** 3 * segmentRef.toPoint.x,
        y: inverse ** 3 * segmentRef.fromPoint.y
          + 3 * inverse ** 2 * amount * segment.cp1.y
          + 3 * inverse * amount ** 2 * segment.cp2.y
          + amount ** 3 * segmentRef.toPoint.y
      }
    }
    return lerpEditablePoint(segmentRef.fromPoint, segmentRef.toPoint, amount)
  }

  function getEditableSegmentScenePoint(obj: EditablePathObject, segmentRef: EditableSegmentRef, ratio: number) {
    const point = getEditableSegmentPoint(segmentRef, ratio)
    return new Point(point.x, point.y)
      .subtract(obj.pathOffset)
      .transform(obj.calcTransformMatrix())
  }

  function getEditablePathScenePoint(obj: EditablePathObject, point: EditablePoint) {
    return new Point(point.x, point.y)
      .subtract(obj.pathOffset)
      .transform(obj.calcTransformMatrix())
  }

  function intersectSceneSegments(fromA: Point, toA: Point, fromB: Point, toB: Point) {
    const ax = toA.x - fromA.x
    const ay = toA.y - fromA.y
    const bx = toB.x - fromB.x
    const by = toB.y - fromB.y
    const denominator = ax * by - ay * bx
    if (Math.abs(denominator) < 1e-6) return null
    const cx = fromB.x - fromA.x
    const cy = fromB.y - fromA.y
    const ratioA = (cx * by - cy * bx) / denominator
    const ratioB = (cx * ay - cy * ax) / denominator
    if (ratioA < -1e-6 || ratioA > 1 + 1e-6 || ratioB < -1e-6 || ratioB > 1 + 1e-6) return null
    const lineRatio = clampEndpointAttachmentRatio(ratioA)
    const segmentRatio = clampEndpointAttachmentRatio(ratioB)
    return {
      lineRatio,
      segmentRatio,
      scenePoint: lerpScenePoint(fromA, toA, lineRatio)
    }
  }

  function getEndpointReferenceScenePoint(obj: EditablePathObject, pointIndex: number) {
    const endpointInfo = getEditablePointEndpointInfo(obj, pointIndex)
    if (!endpointInfo.isEndpoint) return null
    const segmentRef = getEditableSegments(obj).find((item) => (
      endpointInfo.isStart ? item.fromGlobalIndex === pointIndex : item.toGlobalIndex === pointIndex
    ))
    if (!segmentRef) return null
    const endpointPoint = endpointInfo.isStart ? segmentRef.fromPoint : segmentRef.toPoint
    const candidates: EditablePoint[] = []
    if (segmentRef.segment.type === 'cubic') {
      if (endpointInfo.isStart) {
        candidates.push(segmentRef.segment.cp1, segmentRef.segment.cp2)
      } else {
        candidates.push(segmentRef.segment.cp2, segmentRef.segment.cp1)
      }
    }
    candidates.push(endpointInfo.isStart ? segmentRef.toPoint : segmentRef.fromPoint)
    const referencePoint = candidates.find((candidate) => Math.hypot(candidate.x - endpointPoint.x, candidate.y - endpointPoint.y) > 1e-6)
    return referencePoint ? getEditablePathScenePoint(obj, referencePoint) : null
  }

  function buildExpandedSnapOutlineHelper(target: FabricObject) {
    const pathKit = peekPathKit()
    if (!pathKit) return null
    const converted = fabricObjectToPathKitWithApi(pathKit, target)
    if (!converted.path) return null
    const snapMargin = getObjectEndpointSnapMargin(target)
    const basePath = converted.path
    let expandedPath: ReturnType<typeof basePath.copy> | null = null
    let strokePath: ReturnType<typeof basePath.copy> | null = null
    try {
      expandedPath = basePath.copy()
      if (snapMargin > 0) {
        strokePath = basePath.copy()
        if (!strokePath.stroke({
          width: snapMargin * 2,
          cap: pathKit.StrokeCap.ROUND,
          join: pathKit.StrokeJoin.ROUND,
          miter_limit: 4
        })) return null
        if (!expandedPath.op(strokePath, pathKit.PathOp.UNION)) return null
        if (!expandedPath.simplify()) return null
      }
      return pathKitToEditablePathObject(expandedPath)
    } finally {
      basePath.delete()
      strokePath?.delete()
      expandedPath?.delete()
    }
  }

  function findCenterDirectedSnapOutlineAttachmentCandidate(
    target: FabricObject,
    targetId: string,
    referenceScenePoint: Point
  ) {
    const helper = buildExpandedSnapOutlineHelper(target)
    if (!helper) return null
    const center = getObjectCenter(target)
    let best: { lineRatio: number, scenePoint: Point } | null = null
    for (const segmentRef of getEditableSegments(helper)) {
      if (!segmentRef.contour.closed) continue
      const steps = segmentRef.segment.type === 'cubic' ? 24 : 1
      let previousRatio = 0
      let previousPoint = getEditableSegmentScenePoint(helper, segmentRef, previousRatio)
      for (let index = 1; index <= steps; index += 1) {
        const nextRatio = index / steps
        const nextPoint = getEditableSegmentScenePoint(helper, segmentRef, nextRatio)
        const intersection = intersectSceneSegments(referenceScenePoint, center, previousPoint, nextPoint)
        if (intersection && (!best || intersection.lineRatio < best.lineRatio)) {
          best = {
            lineRatio: intersection.lineRatio,
            scenePoint: intersection.scenePoint
          }
        }
        previousRatio = nextRatio
        previousPoint = nextPoint
      }
    }
    if (!best) return null
    const baseCandidate = findBestEndpointAttachmentCandidateOnTarget(target, best.scenePoint)
    if (!baseCandidate) return null
    return {
      target,
      attachment: baseCandidate.attachment,
      scenePoint: best.scenePoint,
      distance: 0
    } satisfies EndpointSnapCandidate
  }

  function findCenterDirectedBoundsAttachmentCandidate(target: FabricObject, targetId: string, referenceScenePoint: Point) {
    const bounds = getObjectSceneBounds(target)
    if (!bounds) return null
    const center = getObjectCenter(target)
    const snapMargin = getObjectEndpointSnapMargin(target)
    const edges: EndpointAttachmentEdge[] = ['left', 'right', 'top', 'bottom']
    let best: { lineRatio: number, candidate: EndpointSnapCandidate } | null = null
    for (const edge of edges) {
      const [from, to] = getObjectSceneEdge(bounds, edge)
      const normal = getBoundsEdgeOutwardNormal(bounds, edge)
      const intersection = intersectSceneSegments(referenceScenePoint, center, from, to)
      if (!intersection) continue
      const candidate: EndpointSnapCandidate = {
        target,
        attachment: { targetId, kind: 'bounds', edge, ratio: intersection.segmentRatio },
        scenePoint: offsetScenePoint(intersection.scenePoint, normal, snapMargin),
        distance: 0
      }
      if (!best || intersection.lineRatio < best.lineRatio) {
        best = { lineRatio: intersection.lineRatio, candidate }
      }
    }
    return best?.candidate ?? null
  }

  function findCenterDirectedEditableAttachmentCandidate(target: EditablePathObject, targetId: string, referenceScenePoint: Point) {
    const center = getObjectCenter(target)
    const snapMargin = getObjectEndpointSnapMargin(target)
    let best: { lineRatio: number, candidate: EndpointSnapCandidate } | null = null
    for (const segmentRef of getEditableSegments(target)) {
      if (!segmentRef.contour.closed) continue
      const normal = getEditableSegmentOutwardNormal({ ...segmentRef, target })
      if (!normal) continue
      const steps = segmentRef.segment.type === 'cubic' ? 24 : 1
      let previousRatio = 0
      let previousPoint = getEditableSegmentScenePoint(target, segmentRef, previousRatio)
      for (let index = 1; index <= steps; index += 1) {
        const nextRatio = index / steps
        const nextPoint = getEditableSegmentScenePoint(target, segmentRef, nextRatio)
        const intersection = intersectSceneSegments(referenceScenePoint, center, previousPoint, nextPoint)
        if (intersection && (!best || intersection.lineRatio < best.lineRatio)) {
          const ratio = clampEndpointAttachmentRatio(previousRatio + (nextRatio - previousRatio) * intersection.segmentRatio)
          const basePoint = getEditableSegmentScenePoint(target, segmentRef, ratio)
          best = {
            lineRatio: intersection.lineRatio,
            candidate: {
              target,
              attachment: {
                targetId,
                kind: 'segment',
                contourIndex: segmentRef.contourIndex,
                segmentIndex: segmentRef.segmentIndex,
                ratio,
                normalSign: 1
              },
              scenePoint: offsetScenePoint(basePoint, normal, snapMargin),
              distance: 0
            }
          }
        }
        previousRatio = nextRatio
        previousPoint = nextPoint
      }
    }
    return best?.candidate ?? null
  }

  function findCenterDirectedEndpointAttachmentCandidateOnTarget(target: FabricObject, referenceScenePoint: Point) {
    const targetId = ensureEditorObjectId(target)
    if (!targetId) return null
    const helperCandidate = findCenterDirectedSnapOutlineAttachmentCandidate(target, targetId, referenceScenePoint)
    if (helperCandidate) return helperCandidate
    if (isEditablePathObject(target)) {
      return findCenterDirectedEditableAttachmentCandidate(target, targetId, referenceScenePoint)
    }
    return findCenterDirectedBoundsAttachmentCandidate(target, targetId, referenceScenePoint)
  }

  function findBestEndpointAttachmentCandidateOnTarget(target: FabricObject, scenePoint: Point) {
    const targetId = ensureEditorObjectId(target)
    if (!targetId) return null
    const candidates: EndpointSnapCandidate[] = []
    addEditableSegmentSnapCandidates(target, targetId, scenePoint, Infinity, candidates)
    if (!isEditablePathObject(target)) {
      addBoundsSnapCandidates(target, targetId, scenePoint, Infinity, candidates)
    }
    candidates.sort((a, b) => a.distance - b.distance)
    return candidates[0] ?? null
  }

  function resolveDynamicEndpointAttachment(target: FabricObject, owner: EditablePathObject, pointIndex: number) {
    const referenceScenePoint = getEndpointReferenceScenePoint(owner, pointIndex)
    if (!referenceScenePoint) return null
    return findCenterDirectedEndpointAttachmentCandidateOnTarget(target, referenceScenePoint)
      ?? findBestEndpointAttachmentCandidateOnTarget(target, referenceScenePoint)
  }

  function projectScenePointToEditableSegment(obj: EditablePathObject, segmentRef: EditableSegmentRef, point: Point) {
    if (segmentRef.segment.type !== 'cubic') {
      return projectScenePointToSegment(
        point,
        getEditableSegmentScenePoint(obj, segmentRef, 0),
        getEditableSegmentScenePoint(obj, segmentRef, 1)
      )
    }
    const steps = 24
    let best: ReturnType<typeof projectScenePointToSegment> | null = null
    for (let index = 0; index < steps; index += 1) {
      const fromRatio = index / steps
      const toRatio = (index + 1) / steps
      const projected = projectScenePointToSegment(
        point,
        getEditableSegmentScenePoint(obj, segmentRef, fromRatio),
        getEditableSegmentScenePoint(obj, segmentRef, toRatio)
      )
      const resolved = {
        ...projected,
        ratio: fromRatio + (toRatio - fromRatio) * projected.ratio
      }
      if (!best || resolved.distance < best.distance) best = resolved
    }
    return best ?? projectScenePointToSegment(
      point,
      getEditableSegmentScenePoint(obj, segmentRef, 0),
      getEditableSegmentScenePoint(obj, segmentRef, 1)
    )
  }

  function resolveSegmentEndpointAttachmentPoint(target: FabricObject, attachment: SegmentEndpointAttachment) {
    if (!isEditablePathObject(target)) return null
    const segments = getEditableSegments(target)
    const segmentRef = segments.find((item) => item.contourIndex === attachment.contourIndex && item.segmentIndex === attachment.segmentIndex)
    if (!segmentRef) return null
    const basePoint = getEditableSegmentScenePoint(target, segmentRef, attachment.ratio)
    const normalSign = attachment.normalSign === -1 ? -1 : 1
    const normal = getEditableSegmentOutwardNormal({ ...segmentRef, target })
    return offsetScenePoint(basePoint, normal ? { x: normal.x * normalSign, y: normal.y * normalSign } : null, getObjectEndpointSnapMargin(target))
  }

  function resolveEndpointAttachmentPoint(target: FabricObject, attachment: EndpointAttachment) {
    if (attachment.kind === 'segment') return resolveSegmentEndpointAttachmentPoint(target, attachment)
    return resolveBoundsEndpointAttachmentPoint(target, attachment)
  }


  function getEditableLocalPointFromScene(obj: EditablePathObject, point: Point) {
    return point.transform(util.invertTransform(obj.calcOwnMatrix())).add(obj.pathOffset)
  }

  // 将场景坐标吸附到当前像素网格；未开启吸附时直接返回原点位，供对象和点位拖拽共用。
  function snapScenePointToPixelGrid(point: Point) {
    if (!snapToPixelGrid.value) return point
    const step = normalizePixelGridSize(pixelGridSize.value)
    return new Point(
      Math.round(point.x / step) * step,
      Math.round(point.y / step) * step
    )
  }

  // 根据目标包围盒左上角计算吸附偏移量，避免旋转对象直接改写 left/top 后出现基准点偏差。
  function getObjectPixelGridSnapDelta(obj: FabricObject) {
    if (!snapToPixelGrid.value) return null
    const bounds = obj.getBoundingRect()
    const snapped = snapScenePointToPixelGrid(new Point(bounds.left, bounds.top))
    const dx = snapped.x - bounds.left
    const dy = snapped.y - bounds.top
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return null
    return { dx, dy }
  }

  // 把移动中的对象或选区整体对齐到网格左上角，保持对象内部相对位置不变。
  function snapObjectPositionToPixelGrid(obj: FabricObject | null | undefined) {
    if (!obj) return false
    const delta = getObjectPixelGridSnapDelta(obj)
    if (!delta) return false
    obj.set({
      left: (obj.left ?? 0) + delta.dx,
      top: (obj.top ?? 0) + delta.dy
    })
    obj.setCoords()
    return true
  }

  // 缩放时把对象当前显示宽高量化到网格，保证缩放后的边界尺寸更容易落在像素整数倍上。
  function snapObjectSizeToPixelGrid(obj: FabricObject | null | undefined) {
    if (!obj || !snapToPixelGrid.value) return false
    const currentWidth = obj.getScaledWidth()
    const currentHeight = obj.getScaledHeight()
    if (currentWidth <= 0 || currentHeight <= 0) return false
    const step = normalizePixelGridSize(pixelGridSize.value)
    const snappedWidth = Math.max(step, Math.round(currentWidth / step) * step)
    const snappedHeight = Math.max(step, Math.round(currentHeight / step) * step)
    const nextScaleX = (obj.scaleX ?? 1) * (snappedWidth / currentWidth)
    const nextScaleY = (obj.scaleY ?? 1) * (snappedHeight / currentHeight)
    if (!Number.isFinite(nextScaleX) || !Number.isFinite(nextScaleY)) return false
    if (Math.abs(nextScaleX - (obj.scaleX ?? 1)) < 0.0001 && Math.abs(nextScaleY - (obj.scaleY ?? 1)) < 0.0001) return false
    obj.set({ scaleX: nextScaleX, scaleY: nextScaleY })
    obj.setCoords()
    return true
  }

  // 将传入的拖拽场景点按当前吸附设置归一化，供点位、端点和曲线控制柄编辑使用。
  function getPixelGridAdjustedScenePoint(point: Point) {
    return snapScenePointToPixelGrid(point)
  }

  function addEditableSegmentSnapCandidates(target: FabricObject, targetId: string, scenePoint: Point, snapDistance: number, candidates: EndpointSnapCandidate[]) {
    if (!isEditablePathObject(target)) return
    const segments = getEditableSegments(target)
    const snapMargin = getObjectEndpointSnapMargin(target)
    for (const segmentRef of segments) {
      const projected = projectScenePointToEditableSegment(target, segmentRef, scenePoint)
      if (projected.distance > snapDistance) continue
      const normal = getEditableSegmentOutwardNormal({ ...segmentRef, target })
      const sign = segmentRef.contour.closed || !normal
        ? 1
        : ((scenePoint.x - projected.scenePoint.x) * normal.x + (scenePoint.y - projected.scenePoint.y) * normal.y) < 0 ? -1 : 1
      const snappedPoint = offsetScenePoint(
        projected.scenePoint,
        normal ? { x: normal.x * sign, y: normal.y * sign } : null,
        snapMargin
      )
      candidates.push({
        target,
        attachment: {
          targetId,
          kind: 'segment',
          contourIndex: segmentRef.contourIndex,
          segmentIndex: segmentRef.segmentIndex,
          ratio: projected.ratio,
          normalSign: sign as 1 | -1
        },
        scenePoint: snappedPoint,
        distance: projected.distance
      })
    }
  }

  function addBoundsSnapCandidates(target: FabricObject, targetId: string, scenePoint: Point, snapDistance: number, candidates: EndpointSnapCandidate[]) {
    const bounds = getObjectSceneBounds(target)
    if (!bounds) return
    const snapMargin = getObjectEndpointSnapMargin(target)
    const edges: EndpointAttachmentEdge[] = ['left', 'right', 'top', 'bottom']
    for (const edge of edges) {
      const [from, to] = getObjectSceneEdge(bounds, edge)
      const projected = projectScenePointToSegment(scenePoint, from, to)
      if (projected.distance > snapDistance) continue
      const snappedPoint = offsetScenePoint(projected.scenePoint, getBoundsEdgeOutwardNormal(bounds, edge), snapMargin)
      candidates.push({
        target,
        attachment: { targetId, kind: 'bounds', edge, ratio: projected.ratio },
        scenePoint: snappedPoint,
        distance: projected.distance
      })
    }
  }


  function getEndpointSnapCandidates(owner: EditablePathObject, scenePoint: Point) {
    if (!fabricCanvas) return []
    const snapDistance = ENDPOINT_SNAP_MARGIN / (fabricCanvas.getZoom() || 1)
    const candidates: EndpointSnapCandidate[] = []
    const objects = fabricCanvas.getObjects()
    for (let i = objects.length - 1; i >= 0; i--) {
      const target = objects[i]
      if (target === owner) continue
      if (isBooleanPreviewObject(target)) continue
      const targetId = ensureEditorObjectId(target)
      if (!targetId) continue
      addEditableSegmentSnapCandidates(target, targetId, scenePoint, snapDistance, candidates)
      if (!isEditablePathObject(target)) {
        addBoundsSnapCandidates(target, targetId, scenePoint, snapDistance, candidates)
      }
    }
    candidates.sort((a, b) => a.distance - b.distance)
    return candidates
  }

  function findEndpointSnapCandidate(owner: EditablePathObject, scenePoint: Point) {
    return getEndpointSnapCandidates(owner, scenePoint)[0] ?? null
  }

  function normalizeEndpointAttachments(obj: FabricObject) {
    const target = obj as AnyFabricObject
    const raw = target.endpointAttachments
    const next: EndpointAttachmentMap = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
        const attachment = value as Partial<EndpointAttachment> | null
        if (!attachment || typeof attachment.targetId !== 'string') return
        if (!Number.isFinite(attachment.ratio)) return
        if (attachment.kind === 'segment') {
          const contourIndex = Number(attachment.contourIndex)
          const segmentIndex = Number(attachment.segmentIndex)
          if (!Number.isFinite(contourIndex) || !Number.isFinite(segmentIndex)) return
          const normalSign = attachment.normalSign === -1 ? -1 : 1
          next[key] = {
            targetId: attachment.targetId,
            kind: 'segment',
            contourIndex: Math.max(0, Math.round(contourIndex)),
            segmentIndex: Math.max(0, Math.round(segmentIndex)),
            ratio: clampEndpointAttachmentRatio(attachment.ratio),
            normalSign
          }
          return
        }
        if (attachment.edge !== 'left' && attachment.edge !== 'right' && attachment.edge !== 'top' && attachment.edge !== 'bottom') return
        next[key] = {
          targetId: attachment.targetId,
          kind: 'bounds',
          edge: attachment.edge,
          ratio: clampEndpointAttachmentRatio(attachment.ratio)
        }
      })
    }
    target.endpointAttachments = next
  }

  function ensureCanvasObjectMetadata() {
    if (!fabricCanvas) return
    const seen = new Set<string>()
    fabricCanvas.getObjects().forEach((obj) => {
      let id = String((obj as AnyFabricObject).editorObjectId || '').trim()
      if (!id || seen.has(id)) {
        id = createEditorObjectId()
        ;(obj as AnyFabricObject).editorObjectId = id
      }
      seen.add(id)
      applyDefaultEndpointSnapMargin(obj)
      applyDefaultFillGradientMetadata(obj)
      normalizeEndpointAttachments(obj)
    })
  }

  function removeEndpointAttachmentsReferencing(target: FabricObject) {
    if (!fabricCanvas) return
    const targetId = (target as AnyFabricObject).editorObjectId
    if (typeof targetId !== 'string' || !targetId) return
    fabricCanvas.getObjects().forEach((obj) => {
      if (obj === target) return
      const raw = (obj as AnyFabricObject).endpointAttachments
      if (!raw || typeof raw !== 'object') return
      const map = raw as EndpointAttachmentMap
      let touched = false
      Object.entries(map).forEach(([key, attachment]) => {
        if (attachment?.targetId === targetId) {
          delete map[key]
          touched = true
        }
      })
      if (touched) (obj as AnyFabricObject).endpointAttachments = { ...map }
    })
  }

  function moveEndpointToScenePoint(obj: EditablePathObject, pointIndex: number, scenePoint: Point) {
    moveEditablePoint(obj, pointIndex, getEditableLocalPointFromScene(obj, scenePoint))
  }

  // 端点拖拽时优先处理像素网格吸附；未开启网格吸附时继续保留原有的端点贴附到对象边界 / 线段能力。
  function moveEndpointWithSnap(obj: EditablePathObject, pointIndex: number, scenePoint: Point) {
    const adjustedScenePoint = getPixelGridAdjustedScenePoint(scenePoint)
    if (!isEditablePointOpenEndpoint(obj, pointIndex)) {
      moveEndpointToScenePoint(obj, pointIndex, adjustedScenePoint)
      setEndpointAttachment(obj, pointIndex, null)
      return null
    }
    const candidate = snapToPixelGrid.value ? null : findEndpointSnapCandidate(obj, adjustedScenePoint)
    if (!candidate) {
      moveEndpointToScenePoint(obj, pointIndex, adjustedScenePoint)
      setEndpointAttachment(obj, pointIndex, null)
      return null
    }
    moveEndpointToScenePoint(obj, pointIndex, candidate.scenePoint)
    ensureEditorObjectId(candidate.target)
    setEndpointAttachment(obj, pointIndex, candidate.attachment)
    return candidate
  }

  function syncEndpointsAttachedToTarget(target: FabricObject) {
    if (!fabricCanvas) return false
    const targetId = (target as AnyFabricObject).editorObjectId
    if (typeof targetId !== 'string' || !targetId) return false
    let touched = false
    fabricCanvas.getObjects().forEach((obj) => {
      if (obj === target || !isEditablePathObject(obj)) return
      const map = getEndpointAttachmentMap(obj)
      Object.entries(map).forEach(([key, attachment]) => {
        if (!attachment || attachment.targetId !== targetId) return
        const pointIndex = Number(key)
        if (!Number.isInteger(pointIndex) || !isEditablePointOpenEndpoint(obj, pointIndex)) return
        const dynamicCandidate = resolveDynamicEndpointAttachment(target, obj, pointIndex)
        if (dynamicCandidate) {
          moveEndpointToScenePoint(obj, pointIndex, dynamicCandidate.scenePoint)
          setEndpointAttachment(obj, pointIndex, dynamicCandidate.attachment)
          touched = true
          return
        }
        const scenePoint = resolveEndpointAttachmentPoint(target, attachment)
        if (!scenePoint) return
        moveEndpointToScenePoint(obj, pointIndex, scenePoint)
        touched = true
      })
    })
    return touched
  }

  function syncEndpointsForChangedObject(target: FabricObject | null | undefined) {
    if (!target) return false
    if (target instanceof ActiveSelection || target instanceof Group) {
      let touched = false
      ;(target as ActiveSelection | Group).getObjects().forEach((child) => {
        touched = syncEndpointsAttachedToTarget(child) || touched
      })
      touched = syncEndpointsAttachedToTarget(target) || touched
      return touched
    }
    return syncEndpointsAttachedToTarget(target)
  }

  function syncAllEndpointAttachments() {
    if (!fabricCanvas) return false
    let touched = false
    fabricCanvas.getObjects().forEach((obj) => {
      touched = syncEndpointsAttachedToTarget(obj) || touched
    })
    return touched
  }

  /**
   * 为克隆对象补齐新的内部标识与默认元数据，避免粘贴/复制后的对象继续复用源对象 id 或缺失比例锁定状态。
   */
  function prepareClonedObjectMetadata(obj: FabricObject) {
    ensureEditorObjectId(obj)
    ;(obj as AnyFabricObject).editorObjectId = createEditorObjectId()
    ;(obj as AnyFabricObject).endpointAttachments = {}
    applyDefaultFillGradientMetadata(obj)
    applyDefaultSizeRatioLockMetadata(obj)
  }

  // 对象命名计数
  let objCounter = 0
  function nextName(type: string) {
    return `${type} ${++objCounter}`
  }

  /**
   * 无序号优先的对象命名：读当前画布顶层对象 name 集合，没有同名对象时直接返回 type，
   * 已重名时返回最小的 `type N`（N 从 1 递增并跳过已占用的名称）。
   * 与 nextName 的固定递增序号不同，首次导入的对象可保持干净名称，仅真正冲突时才追加序号；
   * 画布未就绪或为空时视为无冲突，同样直接返回 type。
   */
  function nextNameUnique(type: string) {
    const existingNames = new Set(
      (fabricCanvas?.getObjects() ?? [])
        .map((obj) => String((obj as AnyFabricObject).name ?? '').trim())
        .filter(Boolean)
    )
    if (!existingNames.has(type)) return type
    let index = 1
    while (existingNames.has(`${type} ${index}`)) index++
    return `${type} ${index}`
  }

  function createKaleidoscopeSourceId() {
    return `kaleidoscope-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  function canUseKaleidoscopeAsSource(obj: FabricObject | null | undefined) {
    if (!obj) return false
    if (obj instanceof Group || obj instanceof ActiveSelection) return false
    applyDefaultKaleidoscopeMetadata(obj)
    return getKaleidoscopeMetadata(obj)?.kaleidoscopeManaged !== true
  }

  function isKaleidoscopeInstance(obj: FabricObject | null | undefined) {
    if (!obj) return false
    applyDefaultKaleidoscopeMetadata(obj)
    const target = getKaleidoscopeMetadata(obj)
    return !!target && target.kaleidoscopeManaged === true && !!target.kaleidoscopeInstanceOf
  }

  function isKaleidoscopeSource(obj: FabricObject | null | undefined) {
    if (!obj || !canUseKaleidoscopeAsSource(obj)) return false
    applyDefaultKaleidoscopeMetadata(obj)
    return getKaleidoscopeMetadata(obj)?.kaleidoscopeEnabled === true
  }

  function isKaleidoscopeObject(obj: FabricObject | null | undefined) {
    return isKaleidoscopeSource(obj) || isKaleidoscopeInstance(obj)
  }

  function canMutateKaleidoscopeObject(obj: FabricObject | null | undefined) {
    return !!obj && !isKaleidoscopeInstance(obj)
  }

  function getKaleidoscopeSourceId(obj: FabricObject | null | undefined) {
    if (!obj) return ''
    applyDefaultKaleidoscopeMetadata(obj)
    return getKaleidoscopeMetadata(obj)?.kaleidoscopeSourceId || ''
  }

  function getKaleidoscopeInstanceSourceId(obj: FabricObject | null | undefined) {
    if (!obj) return ''
    applyDefaultKaleidoscopeMetadata(obj)
    return getKaleidoscopeMetadata(obj)?.kaleidoscopeInstanceOf || ''
  }

  function ensureKaleidoscopeSourceId(obj: FabricObject) {
    applyDefaultKaleidoscopeMetadata(obj)
    const target = getKaleidoscopeMetadata(obj)
    if (!target) return ''
    if (!target.kaleidoscopeSourceId) {
      target.kaleidoscopeSourceId = createKaleidoscopeSourceId()
    }
    return target.kaleidoscopeSourceId
  }

  function getObjectCenter(obj: FabricObject) {
    return obj.getCenterPoint()
  }

  function initializeKaleidoscopeSource(obj: FabricObject) {
    if (!canUseKaleidoscopeAsSource(obj)) return
    applyDefaultKaleidoscopeMetadata(obj)
    const target = getKaleidoscopeMetadata(obj)
    if (!target) return
    if (!target.kaleidoscopeSourceId) {
      target.kaleidoscopeSourceId = createKaleidoscopeSourceId()
      const center = getObjectCenter(obj)
      target.kaleidoscopeCenterX = center.x
      target.kaleidoscopeCenterY = center.y
    }
    target.kaleidoscopeCount = normalizeKaleidoscopeCount(target.kaleidoscopeCount)
    target.kaleidoscopeManaged = false
    target.kaleidoscopeInstanceOf = ''
    target.kaleidoscopeInstanceIndex = 0
  }

  function getKaleidoscopeCount(obj: FabricObject) {
    applyDefaultKaleidoscopeMetadata(obj)
    return normalizeKaleidoscopeCount(getKaleidoscopeMetadata(obj)?.kaleidoscopeCount)
  }

  function getKaleidoscopeEffectiveCenter(obj: FabricObject) {
    applyDefaultKaleidoscopeMetadata(obj)
    const target = getKaleidoscopeMetadata(obj)
    if (target?.kaleidoscopeSourceId) {
      return new Point(target.kaleidoscopeCenterX || 0, target.kaleidoscopeCenterY || 0)
    }
    return getObjectCenter(obj)
  }

  function findKaleidoscopeSourceById(sourceId: string) {
    if (!fabricCanvas || !sourceId) return null
    return fabricCanvas.getObjects().find((obj) => {
      if (isBooleanPreviewObject(obj)) return false
      if (obj instanceof ActiveSelection) return false
      applyDefaultKaleidoscopeMetadata(obj)
      const target = getKaleidoscopeMetadata(obj)
      return !!target && target.kaleidoscopeManaged !== true && target.kaleidoscopeSourceId === sourceId
    }) ?? null
  }

  function findKaleidoscopeInstancesBySourceId(sourceId: string) {
    if (!fabricCanvas || !sourceId) return []
    return fabricCanvas.getObjects()
      .filter((obj) => {
        if (isBooleanPreviewObject(obj)) return false
        return isKaleidoscopeInstance(obj) && getKaleidoscopeInstanceSourceId(obj) === sourceId
      })
      .sort((a, b) => {
        const aIndex = getKaleidoscopeMetadata(a)?.kaleidoscopeInstanceIndex || 0
        const bIndex = getKaleidoscopeMetadata(b)?.kaleidoscopeInstanceIndex || 0
        return aIndex - bIndex
      })
  }

  function setKaleidoscopeInstanceManagedState(obj: FabricObject, managed: boolean) {
    obj.set({
      lockMovementX: managed,
      lockMovementY: managed,
      lockScalingX: managed,
      lockScalingY: managed,
      lockRotation: managed,
      hasControls: !managed,
      selectable: true,
      evented: true
    })
  }

  function positionKaleidoscopeInstance(source: FabricObject, instance: FabricObject, instanceIndex: number) {
    const count = getKaleidoscopeCount(source)
    if (count <= 0) return
    const baseCenter = source.getCenterPoint()
    const pivot = getKaleidoscopeEffectiveCenter(source)
    const step = 360 / count
    const delta = step * instanceIndex
    const radians = delta * Math.PI / 180
    const offsetX = baseCenter.x - pivot.x
    const offsetY = baseCenter.y - pivot.y
    const nextCenter = new Point(
      pivot.x + (offsetX * Math.cos(radians) - offsetY * Math.sin(radians)),
      pivot.y + (offsetX * Math.sin(radians) + offsetY * Math.cos(radians))
    )
    const sourceAngle = source.angle ?? 0
    const followRotation = getKaleidoscopeMetadata(source)?.kaleidoscopeFollowRotation === true

    instance.set({
      scaleX: source.scaleX ?? 1,
      scaleY: source.scaleY ?? 1,
      skewX: source.skewX ?? 0,
      skewY: source.skewY ?? 0,
      flipX: source.flipX,
      flipY: source.flipY,
      visible: source.visible !== false,
      opacity: source.opacity ?? 1,
      angle: followRotation ? sourceAngle + delta : sourceAngle
    })
    instance.setPositionByOrigin(nextCenter, 'center', 'center')
    instance.dirty = true
    instance.setCoords()
  }

  function setKaleidoscopeInstanceMetadata(source: FabricObject, instance: FabricObject, instanceIndex: number) {
    const sourceId = ensureKaleidoscopeSourceId(source)
    clearKaleidoscopeMetadata(instance)
    const target = getKaleidoscopeMetadata(instance)
    if (!target) return
    target.kaleidoscopeManaged = true
    target.kaleidoscopeInstanceOf = sourceId
    target.kaleidoscopeInstanceIndex = instanceIndex
    applyDefaultEndpointSnapMargin(source)
    applyDefaultEndpointSnapMargin(instance)
    ;(instance as AnyFabricObject).endpointSnapMargin = getObjectEndpointSnapMargin(source)
    setKaleidoscopeInstanceManagedState(instance, true)
    ;(instance as AnyFabricObject).name = `${(source as AnyFabricObject).name || source.type || '对象'} · ${instanceIndex}`
  }

  const kaleidoscopeSyncTokens = new Map<string, number>()

  function nextKaleidoscopeSyncToken(sourceId: string) {
    const next = (kaleidoscopeSyncTokens.get(sourceId) || 0) + 1
    kaleidoscopeSyncTokens.set(sourceId, next)
    return next
  }

  function moveKaleidoscopeInstanceNearSource(source: FabricObject, instance: FabricObject, instanceIndex: number) {
    if (!fabricCanvas) return
    const sourceIndex = fabricCanvas.getObjects().indexOf(source)
    if (sourceIndex < 0) return
    const nextIndex = Math.min(sourceIndex + instanceIndex, fabricCanvas.getObjects().length - 1)
    fabricCanvas.moveObjectTo(instance, nextIndex)
  }

  const KALEIDOSCOPE_INSTANCE_OWN_KEYS = new Set([
    'editorObjectId',
    'endpointAttachments',
    'name',
    'kaleidoscopeEnabled',
    'kaleidoscopeCenterX',
    'kaleidoscopeCenterY',
    'kaleidoscopeFollowRotation',
    'kaleidoscopeCount',
    'kaleidoscopeSourceId',
    'kaleidoscopeManaged',
    'kaleidoscopeInstanceOf',
    'kaleidoscopeInstanceIndex',
    'path'
  ])

  function cloneKaleidoscopeSyncValue<T>(value: T): T {
    if (value == null || typeof value !== 'object') return value
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
  }

  function applyKaleidoscopeSourceContentToInstance(source: FabricObject, instance: FabricObject) {
    if (source.type !== instance.type) return false
    const serialized = (source as AnyFabricObject).toObject(SERIALIZED_OBJECT_PROPS as unknown as string[]) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    Object.entries(serialized).forEach(([key, value]) => {
      if (KALEIDOSCOPE_INSTANCE_OWN_KEYS.has(key)) return
      patch[key] = cloneKaleidoscopeSyncValue(value)
    })
    instance.set(patch as any)
    if (source instanceof Path && instance instanceof Path) {
      const pathData = Array.isArray(serialized.path) && serialized.path.length
        ? cloneKaleidoscopeSyncValue(serialized.path)
        : [['M', 0, 0]]
      ;(instance as AnyFabricObject)._setPath(pathData, false)
    }
    applyGradientMetadataToCanvasObject(instance)
    instance.dirty = true
    instance.setCoords()
    return true
  }

  function syncKaleidoscopeContent(source: FabricObject) {
    if (!fabricCanvas || !isKaleidoscopeSource(source)) return false
    const sourceId = ensureKaleidoscopeSourceId(source)
    const expectedCount = getKaleidoscopeCount(source) - 1
    const instances = findKaleidoscopeInstancesBySourceId(sourceId)
    if (expectedCount <= 0) return false
    if (instances.length !== expectedCount) {
      void rebuildKaleidoscopeInstances(source)
      return false
    }
    let requiresRebuild = false
    instances.forEach((instance) => {
      const instanceIndex = getKaleidoscopeMetadata(instance)?.kaleidoscopeInstanceIndex || 1
      if (!applyKaleidoscopeSourceContentToInstance(source, instance)) {
        requiresRebuild = true
        return
      }
      applyDefaultKaleidoscopeMetadata(instance)
      setKaleidoscopeInstanceMetadata(source, instance, instanceIndex)
      positionKaleidoscopeInstance(source, instance, instanceIndex)
    })
    if (requiresRebuild) {
      void rebuildKaleidoscopeInstances(source)
      return false
    }
    fabricCanvas.requestRenderAll()
    refreshLayers()
    return true
  }

  function removeKaleidoscopeInstancesBySourceId(sourceId: string) {
    if (!fabricCanvas || !sourceId) return []
    const instances = findKaleidoscopeInstancesBySourceId(sourceId)
    if (!instances.length) return []
    withSnapshotSuppressed(() => {
      instances.forEach((instance) => fabricCanvas!.remove(instance as AnyFabricObject))
    })
    return instances
  }

  function removeKaleidoscopeInstancesForRemovedSource(obj: FabricObject | null | undefined) {
    if (!obj || !fabricCanvas || !isKaleidoscopeSource(obj)) return []
    const sourceId = getKaleidoscopeSourceId(obj)
    if (!sourceId) return []
    return removeKaleidoscopeInstancesBySourceId(sourceId)
  }

  async function rebuildKaleidoscopeInstances(source: FabricObject) {
    if (!fabricCanvas || !canUseKaleidoscopeAsSource(source)) return
    initializeKaleidoscopeSource(source)
    const target = getKaleidoscopeMetadata(source)
    if (!target) return
    const sourceId = ensureKaleidoscopeSourceId(source)
    const token = nextKaleidoscopeSyncToken(sourceId)
    removeKaleidoscopeInstancesBySourceId(sourceId)

    if (target.kaleidoscopeEnabled !== true || getKaleidoscopeCount(source) <= 1 || !fabricCanvas.getObjects().includes(source)) {
      fabricCanvas.requestRenderAll()
      refreshLayers()
      return
    }

    const clones = await Promise.all(
      // 带上序列化元数据：阴影/圆角/渐变模式等自定义元数据不会随 fabric 原生 clone 保留
      Array.from({ length: getKaleidoscopeCount(source) - 1 }, () => source.clone(SERIALIZED_OBJECT_PROPS as unknown as string[]))
    )

    if (!fabricCanvas || kaleidoscopeSyncTokens.get(sourceId) !== token || !fabricCanvas.getObjects().includes(source) || !isKaleidoscopeSource(source)) {
      return
    }

    skipSnapshot = true
    try {
      clones.forEach((clone, offset) => {
        applyDefaultKaleidoscopeMetadata(clone)
        applyDefaultFillGradientMetadata(clone)
        applyGradientMetadataToCanvasObject(clone)
        setKaleidoscopeInstanceMetadata(source, clone, offset + 1)
        positionKaleidoscopeInstance(source, clone, offset + 1)
        fabricCanvas!.add(clone as AnyFabricObject)
        moveKaleidoscopeInstanceNearSource(source, clone, offset + 1)
      })
    } finally {
      skipSnapshot = false
    }

    fabricCanvas.requestRenderAll()
    refreshLayers()
  }

  function syncKaleidoscopeTransforms(source: FabricObject) {
    if (!fabricCanvas || !isKaleidoscopeSource(source)) return
    const sourceId = ensureKaleidoscopeSourceId(source)
    const expectedCount = getKaleidoscopeCount(source) - 1
    const instances = findKaleidoscopeInstancesBySourceId(sourceId)

    if (expectedCount <= 0) {
      if (instances.length) {
        removeKaleidoscopeInstancesBySourceId(sourceId)
        fabricCanvas.requestRenderAll()
        refreshLayers()
      }
      return
    }

    if (instances.length !== expectedCount) {
      void rebuildKaleidoscopeInstances(source)
      return
    }

    instances.forEach((instance) => {
      applyDefaultKaleidoscopeMetadata(instance)
      setKaleidoscopeInstanceManagedState(instance, true)
      positionKaleidoscopeInstance(source, instance, getKaleidoscopeMetadata(instance)?.kaleidoscopeInstanceIndex || 1)
    })
    fabricCanvas.requestRenderAll()
  }

  async function syncAllKaleidoscopes() {
    if (!fabricCanvas) return
    const objects = fabricCanvas.getObjects().filter((obj) => !isBooleanPreviewObject(obj))
    objects.forEach((obj) => applyDefaultKaleidoscopeMetadata(obj))

    const activeSources = objects.filter((obj) => isKaleidoscopeSource(obj))
    const sourceIds = new Set(activeSources.map((obj) => ensureKaleidoscopeSourceId(obj)))
    const orphanInstances = objects.filter((obj) => isKaleidoscopeInstance(obj) && !sourceIds.has(getKaleidoscopeInstanceSourceId(obj)))

    if (orphanInstances.length) {
      skipSnapshot = true
      try {
        orphanInstances.forEach((obj) => fabricCanvas!.remove(obj as AnyFabricObject))
      } finally {
        skipSnapshot = false
      }
    }

    for (const source of activeSources) {
      await rebuildKaleidoscopeInstances(source)
    }

    fabricCanvas.requestRenderAll()
    refreshLayers()
  }

  function triggerKaleidoscopeTransformSync(obj: FabricObject | null | undefined) {
    if (obj && isKaleidoscopeSource(obj)) {
      syncKaleidoscopeTransforms(obj)
    }
  }

  function triggerKaleidoscopeContentSync(obj: FabricObject | null | undefined) {
    if (obj && isKaleidoscopeSource(obj)) {
      syncKaleidoscopeContent(obj)
    }
  }

  function triggerKaleidoscopeRebuild(obj: FabricObject | null | undefined) {
    if (obj && isKaleidoscopeSource(obj)) {
      void rebuildKaleidoscopeInstances(obj)
    }
  }

  function triggerKaleidoscopeVisibilitySync(obj: FabricObject | null | undefined) {
    if (!obj || !isKaleidoscopeSource(obj)) return
    findKaleidoscopeInstancesBySourceId(ensureKaleidoscopeSourceId(obj)).forEach((instance) => {
      instance.set('visible', obj.visible !== false)
      instance.setCoords()
    })
    fabricCanvas?.requestRenderAll()
  }

  // 保留 Fabric 的原始选择结果，不再把万花筒实例压回单选，方便图层里对多个实例做批量脱离。
  function applyKaleidoscopeSelectionConstraints(obj: FabricObject | null, event?: Event | MouseEvent) {
    if (!fabricCanvas || !obj) return obj
    return obj
  }

  // 切换画板列表显隐，作为顶栏命令入口隔离 UI 事件和底层 showArtboardList 状态写入。
  // 即将展开列表时若还没有任何画板，先自动创建一个默认画板，否则面板因 artboards.length === 0 不渲染，按钮看起来无反应。
  async function toggleArtboardList() {
    const next = !showArtboardList.value
    showArtboardList.value = next
    if (next && artboards.value.length === 0) {
      await addArtboard()
    }
  }

  function getDefaultStrokeDashArray(strokeWidth: unknown = 2): [number, number] {
    const width = Number(strokeWidth)
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 2
    return [Math.max(1, safeWidth * 3), Math.max(1, safeWidth * 2)]
  }

  function createGradientStopId(index: number) {
    return `gradient-stop-${index}-${Math.random().toString(36).slice(2, 8)}`
  }

  function decorateGradientStops(stops: FillGradientStop[], previousStops: UiFillGradientStop[] = []) {
    return cloneFillGradientStops(stops).map((stop, index) => ({
      ...stop,
      id: previousStops[index]?.id ?? createGradientStopId(index)
    }))
  }

  function normalizeGradientOffsetPercentInput(value: string | number, fallback: number, min = 0, max = 100) {
    const normalized = normalizeInputValue(value)
    const parsed = Number(normalized)
    if (normalized === '' || !Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  }

  function normalizeFillGradientRadiusInput(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_FILL_GRADIENT_RADIUS
    return Math.min(2, Math.max(0.05, value))
  }

  function getFillGradientStopMinPercent(index: number) {
    const previousStop = objProps.fillGradientStops[index - 1]
    return previousStop ? Math.round(previousStop.offset * 100) : 0
  }

  function getFillGradientStopMaxPercent(index: number) {
    const nextStop = objProps.fillGradientStops[index + 1]
    return nextStop ? Math.round(nextStop.offset * 100) : 100
  }

  function isFillGradientStopPercentDisabled(index: number, value: number) {
    if (index === 0 || index === objProps.fillGradientStops.length - 1) return true
    return value < getFillGradientStopMinPercent(index) || value > getFillGradientStopMaxPercent(index)
  }

  function normalizeStrokeDashArray(
    value: unknown,
    fallback: [number, number] | null = null
  ): [number, number] | null {
    if (!Array.isArray(value)) return fallback
    const numeric = value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
    if (!numeric.length) return fallback
    return [numeric[0], numeric[1] ?? numeric[0]]
  }

  function getStrokeDashPair(target?: FabricObject | null) {
    if (!target) return getDefaultStrokeDashArray(objProps.strokeWidth)
    return normalizeStrokeDashArray(target.strokeDashArray)
      ?? normalizeStrokeDashArray((target as AnyFabricObject).lastStrokeDashArray)
      ?? getDefaultStrokeDashArray(target.strokeWidth ?? objProps.strokeWidth)
  }

  // ── 计算属性 ──

  // 判断对象是否属于描边转轮廓的可处理类型，供按钮启用和批量转换前置校验共用。
  function isStrokeOutlineSupportedObject(obj: FabricObject) {
    return obj instanceof Rect
      || obj instanceof Circle
      || obj instanceof Triangle
      || obj instanceof Polygon
      || obj instanceof Line
      || obj instanceof Path
  }

  // 返回对象无法执行描边转轮廓的具体原因；返回 null 表示可安全进入 PathKit 转换流程。
  function getStrokeOutlineUnsupportedReason(obj: FabricObject): string | null {
    if (obj instanceof Textbox || obj instanceof FabricImage) return '文字和图片暂不支持描边转轮廓'
    if (obj instanceof Group || obj instanceof ActiveSelection) return '成组对象暂不支持描边转轮廓，请先解组'
    if (isKaleidoscopeObject(obj)) return '万花筒对象暂不支持描边转轮廓，请先脱离源对象'
    if (!isStrokeEnabled(obj.stroke, obj.strokeWidth)) return '对象没有可转换的可见描边'
    if (normalizeStrokeDashArray(obj.strokeDashArray)?.length) return '虚线描边暂不支持转轮廓，请先改为实线'
    if (!isStrokeOutlineSupportedObject(obj)) return '该对象类型暂不支持描边转轮廓'
    return null
  }

  const homeAssetsImport = createHomeAssetsImportModule({
    svgInputRef,
    imgInputRef,
    getFabricCanvas: () => fabricCanvas,
    canvasWidth,
    canvasHeight,
    canvasBg,
    lastOpaqueCanvasBg,
    canSaveUserAsset,
    snapshotGate,
    snapshot,
    newDoc,
    clearStoredDraft,
    onTemplateAppliedAsDocument: () => {
      // 模板应用清空了草稿；多标签时立即重写全部标签，单标签保持“应用后无草稿”的原语义
      if (projectTabs.value.length > 1) saveDraftNow()
    },
    resetHistoryToCurrentCanvas,
    createProjectFile,
    loadProjectFile,
    showToast,
    clearBooleanPreview,
    clearPointEditing,
    addShape,
    addText,
    // 符号拖拽落点插入：转发到符号系统运行时实现（见 symbols.ts 说明）。
    insertSymbolById: async (symbolId: string, scenePoint: { x: number; y: number } | null) => {
      await insertSymbolInstance(symbolId, scenePoint)
    },
    refreshLayers,
    syncActiveObjectPreservingPointMode,
    setSelectionMode,
    applyActiveObjectsSelection,
    applyCanvasBgToFabric,
    applyCanvasSize,
    ensureEditorObjectId,
    nextName,
    nextNameUnique,
    prepareClonedObjectMetadata,
    normalizeEndpointAttachments,
    applyCanvasThemeToObject,
    createKaleidoscopeSourceId,
    canUseKaleidoscopeAsSource,
    isKaleidoscopeSource,
    getCurrentCopyTargets,
    createClipboardEntry,
    getObjectDisplayName,
    cloneSerializedObjectData,
    getObjectsCombinedBounds,
    rebuildKaleidoscopeInstances,
    markObjectSizeRatioLocked
  })
  const assetsImportState = homeAssetsImport.controller.state
  const assetsImportCommands = homeAssetsImport.controller.commands
  const importedUserAssets = assetsImportState.userAssets
  const importedUserAssetDialog = assetsImportState.userAssetDialog
  const importedPasteSVGDialog = assetsImportState.pasteSVGDialog
  const iconifyImportState = assetsImportState.iconifySearch
  const importedFilteredIconifyResults = assetsImportState.filteredIconifyResults
  const importedIconifyCollectionOptions = assetsImportState.iconifyCollectionOptions
  const userAssets = importedUserAssets
  const userAssetDialog = importedUserAssetDialog
  const pasteSVGDialog = importedPasteSVGDialog
  const iconifySearch = iconifyImportState

  const homeExportDelivery = createHomeExportDeliveryModule({
    clipboard: {
      applyActiveObjectsSelection,
      applyCanvasThemeToObject,
      applyDefaultKaleidoscopeMetadata,
      applyGradientMetadataToCanvasObject,
      canUseKaleidoscopeAsSource,
      clearBooleanPreview,
      clearKaleidoscopeMetadata,
      clearPointEditing,
      createClipboardEntry,
      createKaleidoscopeSourceId,
      getCurrentCopyTargets,
      getFabricCanvas: () => fabricCanvas,
      getKaleidoscopeEffectiveCenter,
      getKaleidoscopeMetadata: (obj) => getKaleidoscopeMetadata(obj),
      isKaleidoscopeSource,
      nextName,
      normalizeKaleidoscopeCount,
      prepareClonedObjectMetadata,
      rebuildKaleidoscopeInstances,
      refreshLayers,
      setSelectionMode,
      snapshot,
      snapshotGate
    },
    exportWorkflow: {
      activeArtboardId,
      artboards,
      canvasBg,
      canvasHeight,
      canvasWidth,
      captureCurrentArtboard,
      clearBooleanPreview,
      createProjectFile,
      getFabricCanvas: () => fabricCanvas,
      getObjectsCombinedBounds,
      isTransparentCanvasBg,
      loadArtboardContent,
      loadProjectFile
    },
    shortcut: {
      activeObject,
      canGroup,
      canRedo,
      canUndo,
      canUngroup,
      deleteObject,
      activatePenTool: () => {
        if (paintBucketActive.value) paintBucketCommands.deactivate()
        penCommands.activate()
      },
      activatePaintBucketTool: togglePaintBucketTool,
      saveProject: saveActiveProjectTab,
      fitCanvasInView,
      groupObjects,
      layerBottom,
      layerDown,
      layerTop,
      layerUp,
      redo,
      selectAllByMode,
      selectionMode,
      setSelectionMode,
      setZoom,
      showToast,
      toggleRuler,
      undo,
      ungroupObject,
      zoom,
      copyStyle,
      pasteStyle
    }
  })
  const exportDeliveryState = homeExportDelivery.controller.state
  const exportDeliveryCommands = homeExportDelivery.controller.commands
  const exportDeliveryHelpers = homeExportDelivery.controller.helpers
  const exportDialog = exportDeliveryState.exportDialog
  const exportDialogCanExport = exportDeliveryState.exportDialogCanExport
  const exportDialogSelectedPreset = exportDeliveryState.exportDialogSelectedPreset
  const filteredShortcutGroups = exportDeliveryState.filteredShortcutGroups
  const shortcutBindings = exportDeliveryState.shortcutBindings
  const shortcutDrawerOpen = exportDeliveryState.shortcutDrawerOpen
  const shortcutPlatform = exportDeliveryState.shortcutPlatform
  const shortcutSearch = exportDeliveryState.shortcutSearch
  const {
    addShortcutBinding,
    applyShortcutBinding,
    closeShortcutDrawer,
    copyAsPNG,
    copyAsSVG,
    executeShortcutAction,
    getShortcutActionByEvent,
    handleExportDialogShowChange,
    handleExportPresetSelect,
    loadShortcutBindings,
    openExportDialog,
    openShortcutDrawer,
    removeShortcutBinding,
    resetShortcutBindingsToDefault,
    runExportDialogExport,
    setExportFormatEnabled,
    toggleExportPngSize
  } = exportDeliveryCommands
  const {
    copySelectionToInternalClipboard,
    createCanvasSVGPreview,
    createSelectionSvgText,
    duplicateSelection,
    exportIconContainer,
    exportPNG,
    exportSVG,
    exportSizeSet,
    pasteInternalClipboard,
    renderPNGDataUrl,
    withArtboardExport
  } = exportDeliveryHelpers

  let svgPreviewRequestId = 0
  const svgPreviewSource = ref('')

  async function refreshSvgPreviewSource() {
    const requestId = ++svgPreviewRequestId
    if (canvasViewMode.value !== 'svg') {
      svgPreviewSource.value = ''
      return
    }
    try {
      const source = await createCanvasSVGPreview(false)
      if (requestId === svgPreviewRequestId && canvasViewMode.value === 'svg') {
        svgPreviewSource.value = source
      }
    } catch {
      if (requestId === svgPreviewRequestId) svgPreviewSource.value = ''
    }
  }

  watch([canvasViewMode, layerVersion, canvasWidth, canvasHeight, canvasBg], () => {
    void refreshSvgPreviewSource()
  }, { immediate: true })

  const svgPreviewDataUrl = computed(() => (
    svgPreviewSource.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgPreviewSource.value)}` : ''
  ))

  // 使用 js-beautify 格式化 SVG 源码，添加换行和缩进以提升可读性。
  function formatSvgSource(source: string) {
    try {
      return beautifyHtml(source, {
        indent_size: 2,
        indent_char: ' ',
        max_preserve_newlines: 1,
        preserve_newlines: true,
        wrap_line_length: 0,
        wrap_attributes: 'auto',
        unformatted: [],
        content_unformatted: [],
        indent_inner_html: false,
        indent_scripts: 'normal',
        end_with_newline: false,
        extra_liners: []
      })
    } catch {
      // 如果格式化失败，返回原始源码
      return source
    }
  }

  // 将 SVG 源码转成分段高亮的 HTML，保持代码模式只读展示且不执行源码中的 SVG 内容。
  function highlightSvgSource(source: string) {
    const escapeHtml = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    // 先使用 js-beautify 格式化源码，添加缩进
    const formatted = formatSvgSource(source)

    const tagPattern = /<\/?[\w:-]+(?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g
    let highlighted = ''
    let lastIndex = 0
    for (const match of formatted.matchAll(tagPattern)) {
      const tagSource = match[0]
      const index = match.index ?? 0
      highlighted += escapeHtml(formatted.slice(lastIndex, index))
      const escapedTag = escapeHtml(tagSource)
      const highlightedAttrs = escapedTag.replace(
        /([\w:-]+)(=)("[^"]*"|'[^']*'|[^\s]+)/g,
        '<span class="svg-code-attr">$1</span>$2<span class="svg-code-string">$3</span>'
      )
      highlighted += highlightedAttrs
        .replace(/^(&lt;\/?)([\w:-]+)/, '<span class="svg-code-bracket">$1</span><span class="svg-code-tag">$2</span>')
        .replace(/(\/??&gt;)$/, '<span class="svg-code-bracket">$1</span>')
      lastIndex = index + tagSource.length
    }
    highlighted += escapeHtml(formatted.slice(lastIndex))
    return highlighted
  }

  const highlightedSvgPreviewSource = computed(() => highlightSvgSource(svgPreviewSource.value))

  const svgModeTooltipTitle = computed(() => svgPreviewMode.value === 'graphic' ? 'SVG 图形模式' : 'SVG 代码模式')
  const svgModeTooltipDetail = computed(() => (
    svgPreviewMode.value === 'graphic'
      ? '悬浮可切换为代码模式；当前以图形方式预览导出结果。'
      : '悬浮可切换为图形模式；当前只读查看带高亮的 SVG 源码。'
  ))

  // 切换 SVG 二级预览模式；该状态只影响 SVG 页签下的展示方式，不修改画布或导出内容。
  function setSvgPreviewMode(mode: IconCreatorProjectSvgPreviewMode) {
    svgPreviewMode.value = mode
    canvasViewMode.value = 'svg'
  }

  // 生成项目标签的本地唯一 id，标签只在当前编辑会话内隔离不同项目状态。
  function createProjectTabId() {
    projectTabSeed += 1
    return `project-tab-${projectTabSeed}-${Date.now()}`
  }

  // 使用顺序编号生成默认项目名，避免多个未保存标签都显示成难以区分的空名称。
  function createProjectTabName() {
    return `项目 ${projectTabs.value.length + 1}`
  }

  // 深拷贝工程对象，避免 inactive 标签与当前画布恢复流程共享可变引用。
  function cloneProjectFile(project: IconCreatorProjectFile): IconCreatorProjectFile {
    return JSON.parse(JSON.stringify(project)) as IconCreatorProjectFile
  }

  // 收集当前选区对象 id，切换回标签时尽量恢复用户离开前的选择上下文。
  function captureSelectedObjectIds() {
    if (!fabricCanvas) return []
    return fabricCanvas.getActiveObjects()
      .filter((obj) => !isBooleanPreviewObject(obj))
      .map((obj) => ensureEditorObjectId(obj))
      .filter(Boolean)
  }

  // 根据保存的对象 id 恢复标签选区；对象已删除或无法恢复时自动退化为空选择。
  function restoreSelectedObjectsByIds(ids: string[]) {
    if (!fabricCanvas || !ids.length) {
      fabricCanvas?.discardActiveObject()
      syncActiveObject(null)
      fabricCanvas?.requestRenderAll()
      return
    }
    const idSet = new Set(ids)
    const targets = fabricCanvas.getObjects()
      .filter((obj) => !isBooleanPreviewObject(obj) && idSet.has(String((obj as AnyFabricObject).editorObjectId || '')))
    applyActiveObjectsSelection(targets)
  }

  // 捕获指定项目标签的完整编辑现场，包括工程内容、选择态、视口、视图模式和历史栈。
  function captureCurrentProjectTabState(tab: ProjectTabState) {
    if (!fabricCanvas) return
    tab.project = cloneProjectFile(createProjectFile())
    tab.selectedObjectIds = captureSelectedObjectIds()
    tab.zoom = zoom.value
    tab.panX = canvasPanX.value
    tab.panY = canvasPanY.value
    tab.viewMode = canvasViewMode.value
    tab.svgPreviewMode = svgPreviewMode.value
    tab.history = captureHistoryState()
  }

  // 在离开当前标签前保存现场，确保再次切换回来时不会丢失编辑状态。
  function persistActiveProjectTabState() {
    const tab = activeProjectTab.value
    if (!tab || !fabricCanvas) return
    captureCurrentProjectTabState(tab)
  }

  // 将标签中保存的完整项目状态恢复到当前 Fabric 画布，并还原独立历史与视口。
  async function loadProjectTabState(tab: ProjectTabState) {
    if (!fabricCanvas) return
    switchingProjectTab = true
    try {
      activeProjectTabId.value = tab.id
      await loadProjectFile(cloneProjectFile(tab.project), { keepDraft: true, resetHistory: false })
      restoreHistoryState(tab.history)
      canvasViewMode.value = tab.viewMode
      svgPreviewMode.value = tab.svgPreviewMode
      setZoom(tab.zoom)
      canvasPanX.value = tab.panX
      canvasPanY.value = tab.panY
      restoreSelectedObjectsByIds(tab.selectedObjectIds)
      markSmallPreviewsDirty()
    } finally {
      switchingProjectTab = false
    }
  }

  // 初始化第一个项目标签，将当前启动后的画布包装成可切换项目。
  function initializeProjectTabs() {
    if (projectTabs.value.length || !fabricCanvas) return
    const id = createProjectTabId()
    const tab: ProjectTabState = {
      id,
      name: createProjectTabName(),
      project: cloneProjectFile(createProjectFile()),
      selectedObjectIds: captureSelectedObjectIds(),
      zoom: zoom.value,
      panX: canvasPanX.value,
      panY: canvasPanY.value,
      viewMode: canvasViewMode.value,
      svgPreviewMode: svgPreviewMode.value,
      history: captureHistoryState(),
      dirty: false,
      savedFilePath: ''
    }
    projectTabs.value = [tab]
    activeProjectTabId.value = id
    projectTabSnapshotReady = true
  }

  // 新建独立项目标签，并把画布重置为新的空项目现场。
  async function addProjectTab() {
    if (!fabricCanvas) return
    if (!projectTabs.value.length) initializeProjectTabs()
    persistActiveProjectTabState()
    const id = createProjectTabId()
    const name = createProjectTabName()
    switchingProjectTab = true
    suppressProjectTabAutoSave = true
    try {
      newDoc()
      canvasViewMode.value = 'canvas'
      svgPreviewMode.value = 'graphic'
      fitCanvasInView()
      const tab: ProjectTabState = {
        id,
        name,
        project: cloneProjectFile(createProjectFile()),
        selectedObjectIds: [],
        zoom: zoom.value,
        panX: canvasPanX.value,
        panY: canvasPanY.value,
        viewMode: canvasViewMode.value,
        svgPreviewMode: svgPreviewMode.value,
        history: captureHistoryState(),
        dirty: false,
        savedFilePath: ''
      }
      projectTabs.value = [...projectTabs.value, tab]
      activeProjectTabId.value = id
      showToast('已新建项目标签', 'success')
    } finally {
      suppressProjectTabAutoSave = false
      switchingProjectTab = false
    }
    // 标签结构变化后立即保存草稿（内部 newDoc 已清空旧草稿），让新标签进入崩溃恢复范围
    saveDraftNow()
  }

  // 切换到目标项目标签；当前标签会先保存现场，目标标签再恢复自己的项目、历史与视图状态。
  async function switchProjectTab(tabId: string) {
    if (switchingProjectTab || tabId === activeProjectTabId.value) return
    const target = projectTabs.value.find((tab) => tab.id === tabId)
    if (!target) return
    persistActiveProjectTabState()
    await loadProjectTabState(target)
    // 切换后立即保存草稿记录激活态，崩溃恢复时才能回到用户离开时所在的标签
    saveDraftNow()
  }

  // 关闭项目标签；关闭含未保存提示的标签前做轻量确认，至少保留一个项目标签。
  async function closeProjectTab(tabId: string) {
    if (projectTabs.value.length <= 1) return
    const index = projectTabs.value.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    const target = projectTabs.value[index]
    if (target.dirty && !window.confirm(`项目“${target.name}”存在未保存修改，确定关闭吗？`)) return
    const wasActive = tabId === activeProjectTabId.value
    const nextTab = wasActive
      ? projectTabs.value[index + 1] ?? projectTabs.value[index - 1]
      : null
    projectTabs.value = projectTabs.value.filter((tab) => tab.id !== tabId)
    if (wasActive && nextTab) await loadProjectTabState(nextTab)
    // 关闭后立即同步草稿，被关闭的标签不会再出现在崩溃恢复列表中
    saveDraftNow()
  }

  // ── 多标签草稿 ──
  // 为恢复出来的标签构建仅含初始状态的独立历史栈，保证每个标签恢复后的第一次编辑仍可撤销。
  function createInitialHistoryForProject(project: IconCreatorProjectFile): HistoryState {
    const payload: Record<string, unknown> = { ...project.fabric }
    // 工程自带文档级样式元数据（色板/预设）时随初始快照还原（与撤销快照 editorMeta 通道一致）；
    // 命名画布快照数据量大且不进撤销通道，不写入 editorMeta。
    const meta = project.meta
    if (meta && !isEmptyDocumentStyleMeta(meta)) {
      payload.editorMeta = { swatches: meta.swatches ?? [], stylePresets: meta.stylePresets ?? [] }
    }
    // 对齐参考线随初始快照进入撤销通道（与 buildSnapshotPayload 的 editorGuides 字段一致），
    // 撤销到初始状态时还原本标签自己的参考线而不是清空。
    if (project.guides?.length) {
      payload.editorGuides = project.guides.map((guide) => ({ ...guide }))
    }
    return {
      undoStack: [{ json: JSON.stringify(payload), description: '初始状态', timestamp: Date.now() }],
      redoStack: [],
      historyIndex: 0
    }
  }

  // 收集多标签草稿快照：激活标签直接使用刚序列化的工程对象（避免内存克隆滞后于画布编辑），
  // 其余标签复用内存中的工程克隆（已是 JSON-ready），不为写草稿对隐藏画布做 toObject。
  function captureDraftTabsSnapshot(currentProject: IconCreatorProjectFile): HomeDraftTabsSnapshot | null {
    const tabs = projectTabs.value
    // 标签未初始化（启动早期）或标签切换进行中时返回 null：草稿跳过本次写入，避免用过场状态覆盖已有草稿
    if (!tabs.length || !fabricCanvas || switchingProjectTab) return null
    const activeId = activeProjectTabId.value || tabs[0].id
    return {
      activeTabId: activeId,
      tabs: tabs.map((tab) => ({
        tabId: tab.id,
        title: tab.name,
        project: tab.id === activeId ? currentProject : tab.project,
        dirty: tab.dirty,
        ...(tab.savedFilePath ? { savedFilePath: tab.savedFilePath } : {}),
        viewMode: tab.viewMode,
        svgPreviewMode: tab.svgPreviewMode,
        zoom: tab.zoom,
        panX: tab.panX,
        panY: tab.panY
      }))
    }
  }

  // 将多标签草稿写回项目标签运行时：激活标签载入画布，其余标签以内存工程克隆待命，切换时再恢复。
  async function applyDraftTabsFromDraft(draft: DecodedProjectDraft) {
    if (!fabricCanvas || !draft.tabs.length) return
    const activeEntry = draft.tabs.find((tab) => tab.tabId === draft.activeTabId) ?? draft.tabs[0]
    switchingProjectTab = true
    suppressProjectTabAutoSave = true
    try {
      await loadProjectFile(activeEntry.project, { keepDraft: true, resetHistory: false })
      // 激活标签历史重置为当前画布；其余标签使用各自工程的初始快照（见 createInitialHistoryForProject）。
      resetHistoryToCurrentCanvas()
      projectTabs.value = draft.tabs.map((entry) => {
        const isActive = entry.tabId === activeEntry.tabId
        return {
          id: entry.tabId,
          name: entry.title,
          project: cloneProjectFile(entry.project),
          selectedObjectIds: [],
          zoom: entry.zoom ?? zoom.value,
          panX: entry.panX ?? canvasPanX.value,
          panY: entry.panY ?? canvasPanY.value,
          viewMode: entry.viewMode ?? 'canvas',
          svgPreviewMode: entry.svgPreviewMode ?? 'graphic',
          history: isActive ? captureHistoryState() : createInitialHistoryForProject(entry.project),
          dirty: entry.dirty === true,
          savedFilePath: entry.savedFilePath ?? ''
        }
      })
      activeProjectTabId.value = activeEntry.tabId
      projectTabSnapshotReady = true
      // 恢复激活标签离开时的视口与视图模式；降级草稿缺视口元数据时保持 fit 之后的默认视图
      canvasViewMode.value = activeEntry.viewMode ?? 'canvas'
      svgPreviewMode.value = activeEntry.svgPreviewMode ?? 'graphic'
      setZoom(activeEntry.zoom ?? zoom.value)
      canvasPanX.value = activeEntry.panX ?? canvasPanX.value
      canvasPanY.value = activeEntry.panY ?? canvasPanY.value
    } finally {
      switchingProjectTab = false
      suppressProjectTabAutoSave = false
    }
  }

  watch(historyIndex, () => {
    if (!projectTabSnapshotReady || switchingProjectTab || suppressProjectTabAutoSave) return
    const tab = activeProjectTab.value
    if (tab) tab.dirty = true
  })

  watch([canvasViewMode, svgPreviewMode, zoom, canvasPanX, canvasPanY], () => {
    if (switchingProjectTab) return
    const tab = activeProjectTab.value
    if (!tab) return
    tab.viewMode = canvasViewMode.value
    tab.svgPreviewMode = svgPreviewMode.value
    tab.zoom = zoom.value
    tab.panX = canvasPanX.value
    tab.panY = canvasPanY.value
  })

  // 顶栏“新建”命令在当前标签内重置项目内容，并同步更新该标签保存的初始历史。
  function resetActiveProjectTabDocument() {
    newDoc()
    canvasViewMode.value = 'canvas'
    svgPreviewMode.value = 'graphic'
    const tab = activeProjectTab.value
    if (!tab || !fabricCanvas) return
    // 新建属于全新文档，清空原标签记忆的保存路径，下次保存会重新弹框选位置。
    tab.savedFilePath = ''
    captureCurrentProjectTabState(tab)
    tab.dirty = false
    // 内部 newDoc 清空了草稿；多标签时立即重写草稿，避免丢失其他标签的未保存内容。
    // 单标签保持“新建后无草稿”的原语义，不在恢复提示里出现空文档。
    if (projectTabs.value.length > 1) saveDraftNow()
  }

  // 保存当前项目标签并清除未保存提示；首次保存弹出选择存储位置与文件名，之后自动覆盖同一文件。
  function saveActiveProjectTab() {
    const tab = activeProjectTab.value
    if (tab && tab.savedFilePath) {
      if (saveProjectToPath(tab.savedFilePath)) {
        captureCurrentProjectTabState(tab)
        tab.dirty = false
        // 保存工程内部会清空草稿；多标签时立即重写以保留其他标签的未保存内容，
        // 单标签保持“保存后无草稿、不再弹恢复提示”的原语义。
        if (projectTabs.value.length > 1) saveDraftNow()
      }
      return
    }
    // 从未保存过：弹出系统保存框收集路径，成功后记忆到当前标签，后续保存直接覆盖。
    saveProjectAs((filePath) => {
      const currentTab = activeProjectTab.value
      if (!currentTab) return
      currentTab.savedFilePath = filePath
      captureCurrentProjectTabState(currentTab)
      currentTab.dirty = false
      if (projectTabs.value.length > 1) saveDraftNow()
    })
  }

  // 打开工程入口会先保存当前标签现场，再复用文件选择器加载到当前项目标签。
  function openProjectForActiveTab() {
    persistActiveProjectTabState()
    openProject()
  }

  async function onProjectFileChosenForActiveTab(event: Event) {
    const target = event.target as HTMLInputElement
    const chosenPath = target?.files?.[0] && 'path' in target.files[0] ? String((target.files[0] as File & { path?: string }).path) : ''
    await onProjectFileChosen(event)
    const tab = activeProjectTab.value
    if (!tab || !fabricCanvas) return
    tab.name = '导入项目'
    // 打开的是磁盘上真实工程文件时，把它的路径记到标签，后续保存直接覆盖原文件。
    tab.savedFilePath = chosenPath || ''
    captureCurrentProjectTabState(tab)
    tab.dirty = false
    // 打开工程内部会清空草稿；多标签时立即重写以保留其他标签的未保存内容。
    if (projectTabs.value.length > 1) saveDraftNow()
  }

  const iconCheckSummary = computed(() => {
    const count = iconCheckIssues.value.length
    if (!count) {
      return {
        title: '当前没有检测到问题',
        detail: '检查结果会根据画布、安全区、颜色和小尺寸表现自动刷新。'
      }
    }
    return {
      title: `检测到 ${count} 项问题`,
      detail: '悬浮查看问题列表，点击具体问题可直接定位到关联对象。'
    }
  })

  const activeKaleidoscopeInstance = computed(() => {
    const obj = activeObject.value
    return obj && isKaleidoscopeInstance(obj) ? obj : null
  })

  const activeKaleidoscopeSource = computed(() => {
    const obj = activeObject.value
    return obj && isKaleidoscopeSource(obj) ? obj : null
  })

  const activeKaleidoscopeEditableSource = computed(() => {
    const obj = activeObject.value
    return obj && canUseKaleidoscopeAsSource(obj) ? obj : null
  })

  const activeKaleidoscopeInstanceSource = computed(() => {
    const instance = activeKaleidoscopeInstance.value
    return instance ? findKaleidoscopeSourceById(getKaleidoscopeInstanceSourceId(instance)) : null
  })

  const activeKaleidoscopePanelSource = computed(() => activeKaleidoscopeEditableSource.value ?? activeKaleidoscopeInstanceSource.value)

  const activeArrowRenderMode = computed<ArrowRenderMode>(() => {
    const obj = activeEditablePathObject.value
    return obj ? getArrowRenderMode(obj) : 'standard'
  })

  const isHollowShaftArrow = computed(() => activeArrowRenderMode.value === 'hollow-shaft')

  const hasSelectedCurveSegment = computed(() => {
    if (isHollowShaftArrow.value) return false
    return !!selectedEditableSegment.value
  })

  const selectedArrowEndpointIndices = computed<number[]>(() => {
    void editablePathMetadataVersion.value
    const obj = activeEditablePathObject.value
    const indices = selectedPointIndices.value
    if (!obj || !indices.length) return []
    const result: number[] = []
    for (const index of indices) {
      if (!isEditablePointOpenEndpoint(obj, index)) return []
      result.push(index)
    }
    return result
  })

  const hasSelectedArrowEndpoint = computed(() => selectedArrowEndpointIndices.value.length > 0)

  const editorStore = createEditorStore({
    activeObject,
    activeRightTab,
    canRedo,
    canUndo,
    canvasBg,
    canvasHeight,
    canvasWidth,
    hasEditablePoints,
    keylineTemplate,
    selectionMode,
    shortcutDrawerOpen,
    showArtboardList,
    showPixelGrid,
    showRuler,
    snapToPixelGrid,
    zoom
  })
  const editorSelectors = createEditorSelectors(editorStore)
  const editorCommands = createEditorCommands({
    addShape,
    addText,
    applyIconTemplateAsDocument: assetsImportCommands.applyIconTemplateAsDocument,
    closeShortcutDrawer,
    copyAsPNG,
    copyAsSVG,
    deleteUserAsset: assetsImportCommands.deleteUserAsset,
    importImage: assetsImportCommands.importImage,
    importSVG: assetsImportCommands.importSVG,
    insertIconTemplate: assetsImportCommands.insertIconTemplate,
    insertIconifyIcon: assetsImportCommands.insertIconifyIcon,
    insertUserAsset: assetsImportCommands.insertUserAsset,
    newDoc: resetActiveProjectTabDocument,
    openCreateUserAssetDialog: assetsImportCommands.openCreateUserAssetDialog,
    openExportDialog,
    openPasteSVGDialog: assetsImportCommands.openPasteSVGDialog,
    openProject: openProjectForActiveTab,
    openRenameUserAssetDialog: assetsImportCommands.openRenameUserAssetDialog,
    openShortcutDrawer,
    redo,
    saveProject: saveActiveProjectTab,
    searchIconifyIcons: assetsImportCommands.searchIconifyIcons,
    setSelectionMode,
    setZoom,
    toggleArtboardList,
    toggleKeylineOverlay,
    togglePixelGrid,
    toggleRuler,
    toggleSnapToPixelGrid,
    undo
  })

  type ArrowAggregated = {
    enabled: boolean | null
    shape: ArrowHeadShape | null
    angle: number | null
    length: number | null
  }

  const arrowAggregated = computed<ArrowAggregated>(() => {
    void editablePathMetadataVersion.value
    const obj = activeEditablePathObject.value
    const indices = selectedArrowEndpointIndices.value
    const empty: ArrowAggregated = { enabled: null, shape: null, angle: null, length: null }
    if (!obj || !indices.length) return empty
    let enabled: boolean | null = null
    let shape: ArrowHeadShape | null = null
    let angle: number | null = null
    let length: number | null = null
    let first = true
    for (const index of indices) {
      const head: ArrowHead | null = getEditablePointArrowHead(obj, index)
      const e = !!head?.enabled
      const s = head?.shape ?? 'hollow'
      const a = head?.angle ?? 60
      const l = head?.length ?? 16
      if (first) {
        enabled = e
        shape = s
        angle = a
        length = l
        first = false
      } else {
        if (enabled !== e) enabled = null
        if (shape !== s) shape = null
        if (angle !== a) angle = null
        if (length !== l) length = null
      }
    }
    return { enabled, shape, angle, length }
  })

  function getSelectableCanvasObjects() {
    if (!fabricCanvas) return []
    return fabricCanvas.getObjects().filter((obj) => {
      if (isBooleanPreviewObject(obj)) return false
      if (isKaleidoscopeInstance(obj)) return false
      return obj.selectable !== false
    })
  }

  function getCurrentCopyTargets() {
    if (!fabricCanvas) return []
    const objects = fabricCanvas.getActiveObjects()
    const targets = objects.length ? objects : activeObject.value ? [activeObject.value] : []
    const expanded = targets.map((obj) => {
      if (!isKaleidoscopeInstance(obj)) return obj
      return findKaleidoscopeSourceById(getKaleidoscopeInstanceSourceId(obj)) ?? obj
    })
    const unique = Array.from(new Set(expanded))
    return fabricCanvas.getObjects().filter((obj) => unique.includes(obj) && !isBooleanPreviewObject(obj))
  }

  function createClipboardEntry(obj: FabricObject): ClipboardEntry {
    const source = isKaleidoscopeInstance(obj)
      ? findKaleidoscopeSourceById(getKaleidoscopeInstanceSourceId(obj))
      : obj
    const target = source ?? obj
    const serialized = (target as AnyFabricObject).toObject(SERIALIZED_OBJECT_PROPS as unknown as string[]) as Record<string, unknown>
    return {
      object: serialized,
      sourceName: String((target as AnyFabricObject).name || target.type || '对象'),
      kaleidoscopeEnabled: source ? isKaleidoscopeSource(source) : false,
      sourceMissing: !source && isKaleidoscopeInstance(obj)
    }
  }

  // 生成个人素材唯一标识，避免重启后素材重命名或重新排序影响插入与编辑操作。
  function createUserAssetId() {
    return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  // 规范用户输入的素材名；空名称会回退到可读默认名，避免素材库出现不可点击的空标题。
  function normalizeUserAssetName(value: string, fallback = '素材') {
    const trimmed = value.trim()
    return trimmed || fallback
  }

  // 根据当前选区生成新素材的默认名称，多对象选区使用统一名称，单对象选区沿用图层显示名。
  function getDefaultUserAssetName() {
    const targets = getCurrentCopyTargets()
    if (targets.length === 1) return getObjectDisplayName(targets[0])
    return `素材 ${userAssets.value.length + 1}`
  }

  // 深拷贝 Fabric 序列化结果，确保写入 localStorage 的素材不再引用当前画布对象状态。
  function cloneSerializedObjectData(value: Record<string, unknown>) {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  }

  // 把当前选区序列化为素材对象列表，保留渐变、可编辑路径等自定义元数据并记录原始图层顺序。
  function serializeCurrentSelectionForUserAsset() {
    const targets = getCurrentCopyTargets()
    const objects = targets.map((obj) => cloneSerializedObjectData((obj as AnyFabricObject).toObject(SERIALIZED_OBJECT_PROPS as unknown as string[]) as Record<string, unknown>))
    const layerOrder = targets.map((obj) => ensureEditorObjectId(obj))
    return { objects, layerOrder }
  }

  // 计算一组对象的联合包围盒，供素材缩略图生成和插入居中复用；无有效尺寸时返回 null。
  function getObjectsCombinedBounds(objects: FabricObject[]) {
    if (!objects.length) return null
    let left = Number.POSITIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    objects.forEach((obj) => {
      obj.setCoords()
      const bounds = obj.getBoundingRect()
      if (![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)) return
      left = Math.min(left, bounds.left)
      top = Math.min(top, bounds.top)
      right = Math.max(right, bounds.left + bounds.width)
      bottom = Math.max(bottom, bounds.top + bounds.height)
    })
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null
    return { left, top, width: right - left, height: bottom - top }
  }

  // 为素材列表生成透明 PNG 缩略图；通过临时 StaticCanvas 渲染克隆对象，不污染当前编辑画布。
  async function createUserAssetThumbnail(serializedObjects: Record<string, unknown>[]) {
    const objects = await util.enlivenObjects(serializedObjects.map(cloneSerializedObjectData)) as FabricObject[]
    const bounds = getObjectsCombinedBounds(objects)
    if (!bounds) return ''
    const sourceMaxSize = Math.max(bounds.width, bounds.height)
    const sourceScale = sourceMaxSize > USER_ASSET_MAX_THUMBNAIL_SOURCE_SIZE
      ? USER_ASSET_MAX_THUMBNAIL_SOURCE_SIZE / sourceMaxSize
      : 1
    const renderWidth = Math.max(1, Math.ceil(bounds.width * sourceScale))
    const renderHeight = Math.max(1, Math.ceil(bounds.height * sourceScale))
    const sourceCanvasEl = document.createElement('canvas')
    const sourceCanvas = new StaticCanvas(sourceCanvasEl, {
      width: renderWidth,
      height: renderHeight,
      backgroundColor: ''
    })
    sourceCanvas.viewportTransform = [sourceScale, 0, 0, sourceScale, -bounds.left * sourceScale, -bounds.top * sourceScale]
    objects.forEach((obj) => sourceCanvas.add(obj as AnyFabricObject))
    sourceCanvas.renderAll()

    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = USER_ASSET_THUMBNAIL_SIZE
    thumbCanvas.height = USER_ASSET_THUMBNAIL_SIZE
    const ctx = thumbCanvas.getContext('2d')
    if (!ctx) {
      sourceCanvas.dispose()
      return ''
    }
    const padding = 8
    const drawScale = Math.min(
      (USER_ASSET_THUMBNAIL_SIZE - padding * 2) / Math.max(1, renderWidth),
      (USER_ASSET_THUMBNAIL_SIZE - padding * 2) / Math.max(1, renderHeight)
    )
    const drawWidth = Math.max(1, renderWidth * drawScale)
    const drawHeight = Math.max(1, renderHeight * drawScale)
    ctx.clearRect(0, 0, USER_ASSET_THUMBNAIL_SIZE, USER_ASSET_THUMBNAIL_SIZE)
    ctx.drawImage(
      sourceCanvas.getElement(),
      (USER_ASSET_THUMBNAIL_SIZE - drawWidth) / 2,
      (USER_ASSET_THUMBNAIL_SIZE - drawHeight) / 2,
      drawWidth,
      drawHeight
    )
    const dataUrl = thumbCanvas.toDataURL('image/png')
    sourceCanvas.dispose()
    return dataUrl
  }

  // 读取 localStorage 中的素材条目并做最小校验，坏数据会被忽略以免阻塞编辑器启动。
  function normalizeStoredUserAsset(value: unknown): UserAssetItem | null {
    const source = value && typeof value === 'object' ? value as Partial<UserAssetItem> : null
    if (!source || typeof source.id !== 'string' || typeof source.name !== 'string') return null
    if (!Array.isArray(source.objects) || !source.objects.length) return null
    const objects = source.objects.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    if (!objects.length) return null
    const now = new Date().toISOString()
    return {
      id: source.id,
      name: normalizeUserAssetName(source.name),
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
      objects,
      layerOrder: Array.isArray(source.layerOrder) ? source.layerOrder.filter((id): id is string => typeof id === 'string') : [],
      thumbnail: typeof source.thumbnail === 'string' ? source.thumbnail : ''
    }
  }

  // 启动时加载本地个人素材；解析失败时只清空内存列表，不删除原始存储，方便后续排查。
  function loadUserAssets() {
    try {
      const raw = window.localStorage.getItem(USER_ASSET_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { assets?: unknown } | unknown[]
      const rawAssets = Array.isArray(parsed) ? parsed : Array.isArray(parsed.assets) ? parsed.assets : []
      userAssets.value = rawAssets
        .map(normalizeStoredUserAsset)
        .filter((asset): asset is UserAssetItem => !!asset)
    } catch (error) {
      console.warn('读取个人素材失败', error)
      userAssets.value = []
    }
  }

  // 将当前素材列表持久化到 localStorage，使用户重启插件后仍能继续插入常用素材。
  function saveUserAssets() {
    try {
      window.localStorage.setItem(USER_ASSET_STORAGE_KEY, JSON.stringify({
        schemaVersion: 1,
        assets: userAssets.value
      }))
    } catch (error) {
      console.warn('保存个人素材失败', error)
      throw new Error('保存个人素材失败，请检查浏览器本地存储空间')
    }
  }

  // 为样式预设生成稳定 id，避免分组、颜色和渐变在排序、编辑或二次保存后互相覆盖。
  function createUserStylePresetId(kind: 'color' | 'gradient' | 'color-group') {
    return `${kind}-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  // 深拷贝色板分组，保证管理弹窗和持久化写入都不会复用编辑器内置配置的对象引用。
  function cloneManagedColorPaletteGroups(groups: ColorPaletteGroup[]) {
    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      colors: group.colors.map((color) => ({ ...color }))
    }))
  }

  // 深拷贝渐变预设及其色标，避免应用预设或弹窗编辑时直接改写当前运行中的列表源数据。
  function cloneManagedGradientPresets(presets: GradientPresetItem[]) {
    return presets.map((preset) => ({
      ...preset,
      stops: preset.stops.map((stop) => ({ ...stop }))
    }))
  }

  // 规范用户样式预设名称；本地旧数据缺失名称时回退到便于识别的默认标题。
  function normalizeUserStylePresetName(value: unknown, fallback: string) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback
  }

  // 规范可保存的颜色值；保持 hex / rgba 等 CSS 字符串原样，空值返回空串表示不可保存。
  function normalizeSavedColor(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  }

  // 将色板列数限制在可读范围内，避免配置异常时把属性面板挤成无法点击的极窄色块。
  function normalizeColorPaletteColumns(value: unknown, fallback = DEFAULT_COLOR_PALETTE_COLUMNS) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(MAX_COLOR_PALETTE_COLUMNS, Math.max(MIN_COLOR_PALETTE_COLUMNS, parsed))
  }

  // 将渐变展示行数限制在合理范围内，结合固定两列布局控制右侧面板露出的预设数量。
  function normalizeGradientPresetRows(
    value: unknown,
    fallback = Math.ceil(defaultGradientPresets.length / GRADIENT_PRESET_GRID_COLUMNS)
  ) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(MAX_GRADIENT_PRESET_ROWS, Math.max(MIN_GRADIENT_PRESET_ROWS, parsed))
  }

  // 按固定两列网格把预设数量折算为展示行数，兼容默认值计算和旧版“展示条数”配置迁移。
  function getGradientPresetRowsFromCount(count: unknown) {
    const parsed = Math.max(0, Math.round(Number(count) || 0))
    return normalizeGradientPresetRows(Math.ceil(parsed / GRADIENT_PRESET_GRID_COLUMNS))
  }

  // 读取本地颜色预设时执行最小校验，过滤空颜色并为旧数据补齐名称和 id。
  function normalizeStoredColorSwatch(value: unknown, index: number): ColorSwatchItem | null {
    const source = value && typeof value === 'object' ? value as Partial<ColorSwatchItem> : null
    const color = normalizeSavedColor(source?.color)
    if (!source || !color) return null
    return {
      id: typeof source.id === 'string' && source.id.trim() ? source.id : createUserStylePresetId('color'),
      name: normalizeUserStylePresetName(source.name, `颜色 ${index + 1}`),
      color
    }
  }

  // 读取本地色板分组时保留空分类，便于用户先搭好结构再逐步补颜色。
  function normalizeStoredColorPaletteGroup(value: unknown, index: number): ColorPaletteGroup | null {
    const source = value && typeof value === 'object' ? value as Partial<ColorPaletteGroup> : null
    if (!source) return null
    const colors = Array.isArray(source.colors)
      ? source.colors
        .map(normalizeStoredColorSwatch)
        .filter((item): item is ColorSwatchItem => !!item)
      : []
    return {
      id: typeof source.id === 'string' && source.id.trim() ? source.id : createUserStylePresetId('color-group'),
      name: normalizeUserStylePresetName(source.name, `分类 ${index + 1}`),
      colors
    }
  }

  // 将角度预设归一到 0-359，避免手写或旧版本数据导致 Fabric 渐变方向异常。
  function normalizeGradientPresetAngle(value: unknown, fallback = DEFAULT_FILL_GRADIENT_ANGLE) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const normalized = parsed % 360
    return normalized < 0 ? normalized + 360 : normalized
  }

  // 将渐变中心比例限制在对象内部，保证径向渐变预设应用后控制点仍可见可拖拽。
  function normalizeGradientPresetUnit(value: unknown, fallback = 0.5) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(1, Math.max(0, parsed))
  }

  // 读取本地渐变预设时补齐类型、色标和径向参数，坏数据会被降级为安全的默认渐变。
  function normalizeStoredGradientPreset(value: unknown, index: number): GradientPresetItem | null {
    const source = value && typeof value === 'object' ? value as Partial<GradientPresetItem> : null
    if (!source) return null
    const type = source.type === 'radial' ? 'radial' : 'linear'
    const stopsSource = Array.isArray(source.stops) ? source.stops : undefined
    const stops = cloneFillGradientStops(stopsSource)
    if (!stops.length) return null
    return {
      id: typeof source.id === 'string' && source.id.trim() ? source.id : createUserStylePresetId('gradient'),
      name: normalizeUserStylePresetName(source.name, `渐变 ${index + 1}`),
      type,
      stops,
      angle: normalizeGradientPresetAngle(source.angle),
      centerX: normalizeGradientPresetUnit(source.centerX),
      centerY: normalizeGradientPresetUnit(source.centerY),
      radius: normalizeFillGradientRadiusInput(Number(source.radius ?? DEFAULT_FILL_GRADIENT_RADIUS)),
      userCreated: source.userCreated === true
    }
  }

  // 恢复为编辑器内置色板和渐变基线；重置操作与异常回退都复用这一份默认构建逻辑。
  function resetStylePresetSettingsToDefault() {
    stylePresetSettings.colorPaletteGroups = cloneManagedColorPaletteGroups(defaultColorPaletteGroups)
    stylePresetSettings.gradientPresets = cloneManagedGradientPresets(defaultGradientPresets)
    stylePresetSettings.colorColumns = DEFAULT_COLOR_PALETTE_COLUMNS
    stylePresetSettings.gradientPresetRows = Math.max(
      MIN_GRADIENT_PRESET_ROWS,
      Math.ceil(defaultGradientPresets.length / GRADIENT_PRESET_GRID_COLUMNS)
    )
  }

  // 旧版本仅保存“我的颜色/渐变”，迁移时把颜色合并成独立分组并追加到系统预设后面。
  function buildMigratedColorPaletteGroups(legacyColors: ColorSwatchItem[]) {
    const groups = cloneManagedColorPaletteGroups(defaultColorPaletteGroups)
    if (!legacyColors.length) return groups
    groups.push({
      id: createUserStylePresetId('color-group'),
      name: '我的颜色',
      colors: legacyColors.map((item) => ({ ...item }))
    })
    return groups
  }

  // 启动时加载用户保存的样式预设；兼容旧版仅有 colors/gradients 的结构，并允许新版保存空分组或空预设。
  function loadUserStylePresets() {
    try {
      const raw = window.localStorage.getItem(USER_STYLE_PRESET_STORAGE_KEY)
      if (!raw) {
        resetStylePresetSettingsToDefault()
        return
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const isManagedSchema = Number(parsed.schemaVersion) >= STYLE_PRESET_STORAGE_SCHEMA_VERSION
        || Object.prototype.hasOwnProperty.call(parsed, 'colorPaletteGroups')
        || Object.prototype.hasOwnProperty.call(parsed, 'gradientPresets')

      if (isManagedSchema) {
        const groups = Array.isArray(parsed.colorPaletteGroups)
          ? parsed.colorPaletteGroups
            .map(normalizeStoredColorPaletteGroup)
            .filter((item): item is ColorPaletteGroup => !!item)
          : cloneManagedColorPaletteGroups(defaultColorPaletteGroups)
        const presets = Array.isArray(parsed.gradientPresets)
          ? parsed.gradientPresets
            .map(normalizeStoredGradientPreset)
            .filter((item): item is GradientPresetItem => !!item)
          : cloneManagedGradientPresets(defaultGradientPresets)
        stylePresetSettings.colorPaletteGroups = groups
        stylePresetSettings.gradientPresets = presets
        stylePresetSettings.colorColumns = normalizeColorPaletteColumns(parsed.colorColumns)
        stylePresetSettings.gradientPresetRows = normalizeGradientPresetRows(
          parsed.gradientPresetRows,
          Object.prototype.hasOwnProperty.call(parsed, 'gradientPresetVisibleCount')
            ? getGradientPresetRowsFromCount(parsed.gradientPresetVisibleCount)
            : Math.ceil((presets.length || defaultGradientPresets.length) / GRADIENT_PRESET_GRID_COLUMNS)
        )
        return
      }

      const legacyColors = Array.isArray(parsed.colors)
        ? parsed.colors
          .map(normalizeStoredColorSwatch)
          .filter((item): item is ColorSwatchItem => !!item)
        : []
      const legacyGradients = Array.isArray(parsed.gradients)
        ? parsed.gradients
          .map(normalizeStoredGradientPreset)
          .filter((item): item is GradientPresetItem => !!item)
        : []
      stylePresetSettings.colorPaletteGroups = buildMigratedColorPaletteGroups(legacyColors)
      stylePresetSettings.gradientPresets = [
        ...cloneManagedGradientPresets(defaultGradientPresets),
        ...legacyGradients
      ]
      stylePresetSettings.colorColumns = DEFAULT_COLOR_PALETTE_COLUMNS
      stylePresetSettings.gradientPresetRows = normalizeGradientPresetRows(
        parsed.gradientPresetRows,
        getGradientPresetRowsFromCount(parsed.gradientPresetVisibleCount)
      )
    } catch (error) {
      console.warn('读取样式预设失败', error)
      resetStylePresetSettingsToDefault()
    }
  }

  // 将当前样式预设完整写回 localStorage，保存失败时抛出错误供弹窗或按钮操作提示用户。
  function saveUserStylePresets() {
    try {
      window.localStorage.setItem(USER_STYLE_PRESET_STORAGE_KEY, JSON.stringify({
        schemaVersion: STYLE_PRESET_STORAGE_SCHEMA_VERSION,
        colorPaletteGroups: stylePresetSettings.colorPaletteGroups,
        gradientPresets: stylePresetSettings.gradientPresets,
        colorColumns: stylePresetSettings.colorColumns,
        gradientPresetRows: stylePresetSettings.gradientPresetRows
      }))
    } catch (error) {
      console.warn('保存样式预设失败', error)
      throw new Error('保存样式预设失败，请检查浏览器本地存储空间')
    }
  }

  // 获取或创建“我的颜色”分组，供快捷保存当前填充/描边色以及旧功能迁移复用。
  function getOrCreateUserColorPaletteGroup() {
    const existing = stylePresetSettings.colorPaletteGroups.find((group) => group.name === '我的颜色')
    if (existing) return existing
    const group: ColorPaletteGroup = {
      id: createUserStylePresetId('color-group'),
      name: '我的颜色',
      colors: []
    }
    stylePresetSettings.colorPaletteGroups = [...stylePresetSettings.colorPaletteGroups, group]
    return group
  }

  // 构造当前对象的渐变快照，供管理弹窗“取当前渐变”和旧快捷保存逻辑复用。
  function createCurrentGradientPreset(name = '当前渐变'): GradientPresetItem | null {
    if (!activeObject.value || objProps.fillMode !== 'gradient') return null
    return {
      id: createUserStylePresetId('gradient'),
      name,
      type: objProps.fillGradientType === 'radial' ? 'radial' : 'linear',
      stops: cloneFillGradientStops(objProps.fillGradientStops.map(({ color, offset }) => ({ color, offset }))),
      angle: normalizeGradientPresetAngle(objProps.fillGradientAngle),
      centerX: normalizeGradientPresetUnit(objProps.fillGradientCenterX),
      centerY: normalizeGradientPresetUnit(objProps.fillGradientCenterY),
      radius: normalizeFillGradientRadiusInput(objProps.fillGradientRadius),
      userCreated: true
    }
  }

  // 打开样式预设管理弹窗，并记住入口来源，便于直接切到色板或渐变管理页签。
  function openStylePresetManager(tab: StylePresetManagerTab) {
    stylePresetManagerState.initialTab = tab
    stylePresetManagerState.show = true
  }

  // 统一同步样式预设管理弹窗显隐，供外层 Modal 的 v-model 透传使用。
  function handleStylePresetManagerShowChange(show: boolean) {
    stylePresetManagerState.show = show
  }

  // 应用管理弹窗提交的完整配置；这里只更新本地样式体系，不写入撤销栈也不改动画板数据。
  function applyStylePresetSettings(next: StylePresetSettings) {
    try {
      stylePresetSettings.colorPaletteGroups = Array.isArray(next.colorPaletteGroups)
        ? next.colorPaletteGroups
          .map(normalizeStoredColorPaletteGroup)
          .filter((item): item is ColorPaletteGroup => !!item)
        : cloneManagedColorPaletteGroups(defaultColorPaletteGroups)
      stylePresetSettings.gradientPresets = Array.isArray(next.gradientPresets)
        ? next.gradientPresets
          .map(normalizeStoredGradientPreset)
          .filter((item): item is GradientPresetItem => !!item)
        : cloneManagedGradientPresets(defaultGradientPresets)
      stylePresetSettings.colorColumns = normalizeColorPaletteColumns(next.colorColumns)
      stylePresetSettings.gradientPresetRows = normalizeGradientPresetRows(
        next.gradientPresetRows,
        Math.ceil((stylePresetSettings.gradientPresets.length || defaultGradientPresets.length) / GRADIENT_PRESET_GRID_COLUMNS)
      )
      saveUserStylePresets()
      stylePresetManagerState.show = false
      showToast('样式预设已保存', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存样式预设失败', 'error')
    }
  }

  const stylePresetCurrentFillColor = computed(() => normalizeSavedColor(objProps.fill))
  const stylePresetCurrentStrokeColor = computed(() => normalizeSavedColor(objProps.stroke))
  const stylePresetCurrentGradientPreset = computed(() => createCurrentGradientPreset())

  // 应用描边色板时同步补齐描边宽度，确保从无描边对象点击色板也能立即看到效果。
  function applyStrokeColorSwatch(color: string) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      typedTarget.lastStroke = color
      const patch: Record<string, unknown> = { stroke: color }
      if (!isStrokeEnabled(color, target.strokeWidth)) {
        const fallbackWidth = Number(typedTarget.lastStrokeWidth ?? objProps.strokeWidth)
        patch.strokeWidth = Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : 2
        typedTarget.lastStrokeWidth = patch.strokeWidth
      }
      target.set(patch as any)
      typedTarget.lastStrokeDashArray = normalizeStrokeDashArray(typedTarget.lastStrokeDashArray)
        ?? getDefaultStrokeDashArray(target.strokeWidth)
      target.dirty = true
      target.setCoords()
    })
    if (obj instanceof Group) obj.triggerLayout()
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  // 根据用户选择把色板颜色应用到填充或描边；填充复用纯色逻辑，描边使用上面的宽度补齐策略。
  // 油漆桶工具态下没有选中对象可改，色板/颜色选择器写入的是油漆桶前景颜料：
  // 点击上色始终用前景色，改填充还是描边由工具栏 hover 弹窗的行为开关决定，与色板 channel 无关。
  function applyColorSwatch(channel: StyleTargetChannel, color: string) {
    const normalized = normalizeSavedColor(color)
    if (!normalized) return
    if (paintBucketActive.value) {
      paintBucketCommands.setForegroundColor(normalized)
      showToast(`油漆桶前景色已设为 ${normalized}`, 'success')
      return
    }
    if (channel === 'stroke') {
      applyStrokeColorSwatch(normalized)
      return
    }
    setSolidFillColor(normalized)
  }

  // 兼容旧快捷保存入口：把当前填充色或描边色加入“我的颜色”，重复颜色会前置刷新名称。
  function saveCurrentColorSwatch(channel: StyleTargetChannel) {
    const color = normalizeSavedColor(channel === 'stroke' ? objProps.stroke : objProps.fill)
    if (!color) return
    const group = getOrCreateUserColorPaletteGroup()
    const name = `${channel === 'stroke' ? '描边色' : '填充色'} ${group.colors.length + 1}`
    const existingIndex = group.colors.findIndex((item) => item.color.toLowerCase() === color.toLowerCase())
    if (existingIndex >= 0) {
      const [existing] = group.colors.splice(existingIndex, 1)
      existing.name = name
      group.colors.unshift(existing)
    } else {
      group.colors.unshift({ id: createUserStylePresetId('color'), name, color })
    }
    stylePresetSettings.colorPaletteGroups = [...stylePresetSettings.colorPaletteGroups]
    saveUserStylePresets()
    showToast('已保存到我的颜色', 'success')
  }

  // 将渐变预设写入当前填充，保留对象原位置尺寸并刷新径向渐变控制点和万花筒同步内容。
  function applyGradientPreset(preset: GradientPresetItem) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      applyDefaultFillGradientMetadata(typedTarget)
      typedTarget.fillMode = 'gradient'
      typedTarget.fillGradientType = preset.type === 'radial' ? 'radial' : 'linear'
      typedTarget.fillGradientStops = cloneFillGradientStops(preset.stops)
      typedTarget.fillGradientAngle = normalizeGradientPresetAngle(preset.angle)
      typedTarget.fillGradientCenterX = normalizeGradientPresetUnit(preset.centerX)
      typedTarget.fillGradientCenterY = normalizeGradientPresetUnit(preset.centerY)
      typedTarget.fillGradientRadius = normalizeFillGradientRadiusInput(Number(preset.radius ?? DEFAULT_FILL_GRADIENT_RADIUS))
      applyGradientFillToTarget(target)
      target.dirty = true
      target.setCoords()
    })
    if (obj instanceof Group) obj.triggerLayout()
    objProps.fillEnabled = true
    objProps.fillMode = 'gradient'
    objProps.fillGradientType = preset.type === 'radial' ? 'radial' : 'linear'
    triggerKaleidoscopeContentSync(obj)
    updateCurveControls()
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  // 样式预览：悬浮色板/渐变预设时临时套用，离开时完整还原，全程不写入历史。
  // 按 getStyleTargets 逐个目标备份填充/描边的完整状态（含渐变元数据），避免多目标编组只按聚合 objProps 还原导致丢失。
  type StylePreviewBackupEntry = {
    target: AnyFabricObject
    fill: unknown
    stroke: unknown
    lastFill: unknown
    fillMode: unknown
    fillGradientType: unknown
    fillGradientStops: FillGradientStop[]
    fillGradientAngle: unknown
    fillGradientCenterX: unknown
    fillGradientCenterY: unknown
    fillGradientRadius: unknown
  }
  let stylePreviewBackup: StylePreviewBackupEntry[] | null = null

  function beginStylePreview() {
    const obj = activeObject.value
    if (!obj) return
    stylePreviewBackup = getStyleTargets(obj).map((target) => {
      const t = target as AnyFabricObject
      applyDefaultFillGradientMetadata(t)
      return {
        target: t,
        fill: t.fill,
        stroke: t.stroke,
        lastFill: t.lastFill,
        fillMode: t.fillMode,
        fillGradientType: t.fillGradientType,
        fillGradientStops: cloneFillGradientStops(t.fillGradientStops),
        fillGradientAngle: t.fillGradientAngle,
        fillGradientCenterX: t.fillGradientCenterX,
        fillGradientCenterY: t.fillGradientCenterY,
        fillGradientRadius: t.fillGradientRadius
      }
    })
  }

  // 悬浮预览纯色色板（填充或描边），首次预览时自动备份原始状态。
  function previewStyleColor(channel: StyleTargetChannel, color: string) {
    if (!activeObject.value) return
    if (!stylePreviewBackup) beginStylePreview()
    withSnapshotSuppressed(() => {
      if (channel === 'fill') setSolidFillColor(color)
      else applyColorSwatch('stroke', color)
    })
  }

  // 悬浮预览渐变预设，首次预览时自动备份原始状态。
  function previewStyleGradient(preset: GradientPresetItem) {
    if (!activeObject.value) return
    if (!stylePreviewBackup) beginStylePreview()
    withSnapshotSuppressed(() => applyGradientPreset(preset))
  }

  // 离开预设时把备份的原始填充/描边状态完整还原回画布，不写入历史。
  function restoreStylePreview() {
    const obj = activeObject.value
    const backup = stylePreviewBackup
    stylePreviewBackup = null
    if (!obj || !fabricCanvas || !backup) return
    withSnapshotSuppressed(() => {
      backup.forEach((entry) => {
        const t = entry.target
        t.fillMode = entry.fillMode
        t.fillGradientType = entry.fillGradientType
        t.fillGradientStops = cloneFillGradientStops(entry.fillGradientStops)
        t.fillGradientAngle = entry.fillGradientAngle
        t.fillGradientCenterX = entry.fillGradientCenterX
        t.fillGradientCenterY = entry.fillGradientCenterY
        t.fillGradientRadius = entry.fillGradientRadius
        t.lastFill = entry.lastFill
        if (t.fillMode === 'gradient') {
          applyGradientFillToTarget(t)
        } else {
          t.set('fill', typeof entry.fill === 'string' ? entry.fill : (entry.lastFill as string) || objProps.fill || '#000000')
        }
        t.set('stroke', entry.stroke as any)
        t.dirty = true
        t.setCoords()
      })
      if (obj instanceof Group) obj.triggerLayout()
      triggerKaleidoscopeContentSync(obj)
      fabricCanvas.requestRenderAll()
      refreshLayers()
      syncObjProps()
    })
  }

  // 点击应用预设时丢弃备份（保留当前预览结果），由调用方再走正式的 apply 写入历史。
  function commitStylePreview() {
    stylePreviewBackup = null
  }

  // 兼容旧快捷保存入口：把当前对象渐变插到预设列表前面，便于立刻在右侧面板再次复用。
  function saveCurrentGradientPreset() {
    const preset = createCurrentGradientPreset(`渐变 ${stylePresetSettings.gradientPresets.length + 1}`)
    if (!preset) return
    stylePresetSettings.gradientPresets = [preset, ...stylePresetSettings.gradientPresets]
    saveUserStylePresets()
    showToast('已保存当前渐变', 'success')
  }

  // 打开保存素材弹窗，并使用当前选区名称作为默认值以减少重复输入。
  function openCreateUserAssetDialog() {
    if (!canSaveUserAsset.value) return
    userAssetDialog.mode = 'create'
    userAssetDialog.name = getDefaultUserAssetName()
    userAssetDialog.targetId = ''
    userAssetDialog.error = ''
    userAssetDialog.show = true
  }

  // 打开素材重命名弹窗，保留目标 id，确认时只修改素材库数据而不影响画布上已插入对象。
  function openRenameUserAssetDialog(asset: UserAssetItem) {
    userAssetDialog.mode = 'rename'
    userAssetDialog.name = asset.name
    userAssetDialog.targetId = asset.id
    userAssetDialog.error = ''
    userAssetDialog.show = true
  }

  // 关闭素材弹窗时清空临时状态，避免下一次保存或重命名沿用旧错误信息。
  function handleUserAssetDialogShowChange(show: boolean) {
    userAssetDialog.show = show
    if (show) return
    userAssetDialog.name = ''
    userAssetDialog.error = ''
    userAssetDialog.targetId = ''
  }

  // 基于当前选区创建一条个人素材，包含可编辑对象 JSON、图层顺序和列表缩略图。
  async function createUserAssetFromSelection(name: string) {
    const { objects, layerOrder } = serializeCurrentSelectionForUserAsset()
    if (!objects.length) throw new Error('请先选中要保存的对象')
    const now = new Date().toISOString()
    const asset: UserAssetItem = {
      id: createUserAssetId(),
      name: normalizeUserAssetName(name, getDefaultUserAssetName()),
      createdAt: now,
      updatedAt: now,
      objects,
      layerOrder,
      thumbnail: await createUserAssetThumbnail(objects)
    }
    userAssets.value = [asset, ...userAssets.value]
    saveUserAssets()
  }

  // 确认保存或重命名素材；失败时把错误留在弹窗内，便于用户改名或释放存储空间后重试。
  async function confirmUserAssetDialog() {
    const name = normalizeUserAssetName(userAssetDialog.name)
    try {
      if (userAssetDialog.mode === 'create') {
        await createUserAssetFromSelection(name)
      } else {
        const asset = userAssets.value.find((item) => item.id === userAssetDialog.targetId)
        if (!asset) throw new Error('素材不存在')
        asset.name = name
        asset.updatedAt = new Date().toISOString()
        userAssets.value = [...userAssets.value]
        saveUserAssets()
      }
      handleUserAssetDialogShowChange(false)
    } catch (error) {
      userAssetDialog.error = error instanceof Error ? error.message : '保存素材失败'
    }
  }

  // 删除素材前进行二次确认，防止误删本地收藏；删除后立即写回 localStorage。
  function deleteUserAsset(asset: UserAssetItem) {
    const confirmed = window.confirm(`确定删除素材“${asset.name}”吗？`)
    if (!confirmed) return
    userAssets.value = userAssets.value.filter((item) => item.id !== asset.id)
    saveUserAssets()
  }

  // 插入素材前为克隆对象换新内部 id、清理外部端点引用，并递归处理组内子对象元数据。
  function prepareUserAssetObjectForInsert(obj: FabricObject, assetName: string, index: number, isRoot = true) {
    prepareClonedObjectMetadata(obj)
    applyDefaultKaleidoscopeMetadata(obj)
    applyDefaultEndpointSnapMargin(obj)
    normalizeEndpointAttachments(obj)
    applyGradientMetadataToCanvasObject(obj)
    if (isRoot) {
      ;(obj as AnyFabricObject).name = nextName(index === 0 ? assetName : `${assetName} 元素`)
    } else if (!String((obj as AnyFabricObject).name || '').trim()) {
      ;(obj as AnyFabricObject).name = nextName(`${assetName} 元素`)
    }
    if (obj instanceof Group) {
      obj.getObjects().forEach((child, childIndex) => prepareUserAssetObjectForInsert(child, assetName, childIndex, false))
    }
    applyCanvasThemeToObject(obj)
    obj.setCoords()
  }

  // 将素材对象整体移动到当前画布中心，若素材明显大于画布则等比缩小以保证插入后可见。
  function placeUserAssetObjects(objects: FabricObject[]) {
    const bounds = getObjectsCombinedBounds(objects)
    if (!bounds) return { dx: 0, dy: 0 }
    const maxWidth = canvasWidth.value * 0.82
    const maxHeight = canvasHeight.value * 0.82
    const scaleRatio = Math.min(
      1,
      bounds.width > 0 ? maxWidth / bounds.width : 1,
      bounds.height > 0 ? maxHeight / bounds.height : 1
    )
    if (Number.isFinite(scaleRatio) && scaleRatio > 0 && scaleRatio < 1) {
      objects.forEach((obj) => {
        obj.set({
          left: bounds.left + ((obj.left ?? 0) - bounds.left) * scaleRatio,
          top: bounds.top + ((obj.top ?? 0) - bounds.top) * scaleRatio,
          scaleX: (obj.scaleX || 1) * scaleRatio,
          scaleY: (obj.scaleY || 1) * scaleRatio
        })
        obj.setCoords()
      })
    }
    const nextBounds = getObjectsCombinedBounds(objects) ?? bounds
    const dx = canvasWidth.value / 2 - (nextBounds.left + nextBounds.width / 2)
    const dy = canvasHeight.value / 2 - (nextBounds.top + nextBounds.height / 2)
    objects.forEach((obj) => {
      obj.set({
        left: (obj.left || 0) + dx,
        top: (obj.top || 0) + dy
      })
      obj.setCoords()
    })
    return { dx, dy }
  }

  // 素材插入后重置万花筒源 id，并把中心点随对象移动，避免新素材继续引用旧画布中的源对象。
  function resetInsertedAssetKaleidoscopeMetadata(obj: FabricObject, dx: number, dy: number) {
    if (obj instanceof Group) {
      obj.getObjects().forEach((child) => resetInsertedAssetKaleidoscopeMetadata(child, dx, dy))
    }
    applyDefaultKaleidoscopeMetadata(obj)
    const metadata = getKaleidoscopeMetadata(obj)
    if (!metadata) return
    if (metadata.kaleidoscopeManaged || metadata.kaleidoscopeInstanceOf) {
      clearKaleidoscopeMetadata(obj)
      return
    }
    if (metadata.kaleidoscopeEnabled && canUseKaleidoscopeAsSource(obj)) {
      metadata.kaleidoscopeSourceId = createKaleidoscopeSourceId()
      metadata.kaleidoscopeCenterX = (metadata.kaleidoscopeCenterX || 0) + dx
      metadata.kaleidoscopeCenterY = (metadata.kaleidoscopeCenterY || 0) + dy
      metadata.kaleidoscopeCount = normalizeKaleidoscopeCount(metadata.kaleidoscopeCount)
      metadata.kaleidoscopeManaged = false
      metadata.kaleidoscopeInstanceOf = ''
      metadata.kaleidoscopeInstanceIndex = 0
    }
  }

  // 将个人素材重新反序列化为 Fabric 对象插入画布，插入后保持可编辑并生成一次撤销快照。
  async function insertUserAsset(asset: UserAssetItem) {
    if (!fabricCanvas) return
    clearBooleanPreview()
    clearPointEditing()
    const objects = await util.enlivenObjects(asset.objects.map(cloneSerializedObjectData)) as FabricObject[]
    if (!objects.length) return
    const inserted: FabricObject[] = []
    skipSnapshot = true
    try {
      objects.forEach((obj, index) => {
        prepareUserAssetObjectForInsert(obj, asset.name, index)
        inserted.push(obj)
      })
      const { dx, dy } = placeUserAssetObjects(inserted)
      inserted.forEach((obj) => resetInsertedAssetKaleidoscopeMetadata(obj, dx, dy))
      for (const obj of inserted) {
        fabricCanvas.add(obj as AnyFabricObject)
        if (isKaleidoscopeSource(obj)) {
          await rebuildKaleidoscopeInstances(obj)
        }
      }
    } finally {
      skipSnapshot = false
    }
    setSelectionMode('shape')
    applyActiveObjectsSelection(inserted)
    refreshLayers()
    fabricCanvas.requestRenderAll()
    snapshot()
  }

  function selectAllByMode() {
    if (!fabricCanvas) return
    if (selectionMode.value === 'shape') {
      applyActiveObjectsSelection(getSelectableCanvasObjects())
      return
    }
    if (selectionMode.value === 'point') {
      const obj = activeEditablePathObject.value
      if (!obj) return
      setSelectedEditablePoints(obj, getSelectableEditablePoints(obj).map((item) => item.index))
    }
  }

  function toggleRuler() {
    showRuler.value = !showRuler.value
  }

  // 同步网格间距输入框显示，保证工程恢复、预设切换和非法输入回退后界面数值一致。
  function syncPixelGridSizeInput() {
    pixelGridSizeInput.value = formatNumericInputValue(pixelGridSize.value)
  }

  // 开关像素网格可见性；该状态属于工程辅助设置，会写入草稿和工程文件但不进入撤销栈。
  function setPixelGridVisible(visible: boolean) {
    showPixelGrid.value = visible
    scheduleDraftSave()
  }

  // 控制移动和点位编辑是否吸附到当前网格；该辅助状态随工程保存，便于恢复编辑环境。
  function setSnapToPixelGrid(enabled: boolean) {
    snapToPixelGrid.value = enabled
    syncCanvasInteractionMode()
    scheduleDraftSave()
  }

  // 更新网格间距并同步输入框，后续对象移动和点位拖拽都会使用这个间距进行吸附。
  function setPixelGridSize(value: number) {
    pixelGridSize.value = normalizePixelGridSize(value)
    syncPixelGridSizeInput()
    scheduleDraftSave()
  }

  // 提交网格间距输入，非法内容回退到当前间距，避免输入错误时把吸附间距改成不可用值。
  function setPixelGridSizeFromInput(value: string | number) {
    commitNumericInput(
      value,
      pixelGridSize.value,
      setPixelGridSize,
      (next) => { pixelGridSizeInput.value = formatNumericInputValue(normalizePixelGridSize(next)) }
    )
  }

  // 同步画笔大小输入框显示，保证工程恢复、画板切换和非法输入回退后界面数值一致。
  function syncPixelPaintBrushSizeInput() {
    pixelPaintBrushSizeInput.value = formatNumericInputValue(pixelPaintBrushSize.value)
  }

  // 更新网格上色画笔大小（N × N 个网格单元格）并同步输入框；该设置随画布设置持久化。
  function setPixelPaintBrushSize(value: number) {
    pixelPaintBrushSize.value = normalizePixelPaintBrushSize(value)
    syncPixelPaintBrushSizeInput()
    scheduleDraftSave()
  }

  // 提交画笔大小输入，非法内容回退到当前值，避免输入错误时把画笔改成不可用状态。
  function setPixelPaintBrushSizeFromInput(value: string | number) {
    commitNumericInput(
      value,
      pixelPaintBrushSize.value,
      setPixelPaintBrushSize,
      (next) => { pixelPaintBrushSizeInput.value = formatNumericInputValue(normalizePixelPaintBrushSize(next)) }
    )
  }

  // 顶栏快捷入口用于快速显示或隐藏像素网格，不影响真实画布对象和最终导出内容。
  function togglePixelGrid() {
    setPixelGridVisible(!showPixelGrid.value)
  }

  // 顶栏快捷入口用于快速启停吸附，方便在自由编辑和像素对齐之间切换。
  function toggleSnapToPixelGrid() {
    setSnapToPixelGrid(!snapToPixelGrid.value)
  }

  // 同步安全区输入框显示，保证工程恢复和非法输入回退后仍展示真实生效值。
  function syncKeylineMarginInput() {
    keylineMarginInput.value = formatNumericInputValue(keylineMargin.value)
  }

  // 统一更新参考线透明度，供属性面板、工程恢复和画板切换复用，避免 overlay 留下越界透明值。
  function setKeylineOpacity(value: number) {
    keylineOpacity.value = normalizeKeylineOpacity(value)
    scheduleDraftSave()
  }

  // 切换 Keyline / 安全区模板；Material / iOS / Favicon 使用内置规则，自定义模式使用用户边距。
  function setKeylineTemplate(template: KeylineTemplate) {
    keylineTemplate.value = normalizeKeylineTemplate(template)
    scheduleDraftSave()
  }

  // 更新自定义安全区边距，模板未切到自定义时仍保留该值，便于稍后切回。
  function setKeylineMargin(value: number) {
    keylineMargin.value = normalizeKeylineMargin(value)
    syncKeylineMarginInput()
    scheduleDraftSave()
  }

  // 提交安全区边距输入，非法内容回退到当前值，避免参考线被错误参数移出画布。
  function setKeylineMarginFromInput(value: string | number) {
    commitNumericInput(
      value,
      keylineMargin.value,
      setKeylineMargin,
      (next) => { keylineMarginInput.value = formatNumericInputValue(normalizeKeylineMargin(next)) }
    )
  }

  // 顶栏参考线按钮在无参考线和 Material Keyline 间快速切换，不参与导出。
  function toggleKeylineOverlay() {
    setKeylineTemplate(keylineTemplate.value === 'none' ? 'material' : 'none')
  }

  // ── 对齐参考线（用户参考线）──
  // 撤销策略：参考线的增删改会写入撤销快照（editorGuides 字段），与画布对象保持一致的可
  // 撤销体验；一次拖拽手势 / 一条 MCP 指令只产生一条撤销记录。视图开关 showGuides 仅是
  // 会话级显示控制，不进撤销栈也不入工程文件。

  /** 读取参考线列表的深拷贝，供撤销快照与工程 JSON 序列化使用。 */
  function getDocumentGuides(): ProjectGuide[] {
    return guides.value.map((guide) => ({ ...guide }))
  }

  /**
   * 覆盖文档级参考线：工程加载传 guides 字段，新建文档 / 旧工程传 null 归一化为空列表。
   * 内部先整体归一化（非法条目丢弃、缺 id 补生成），保证响应式状态始终可用。
   */
  function applyDocumentGuides(value: unknown) {
    guides.value = normalizeDocumentGuides(value)
    guideDragState.value = null
  }

  /** 从撤销快照 JSON 还原参考线；解析失败时静默忽略，避免历史回滚被参考线数据阻断。 */
  function restoreDocumentGuidesFromSnapshot(snapshotJson: string) {
    try {
      const parsed = JSON.parse(snapshotJson) as { editorGuides?: unknown }
      applyDocumentGuides(parsed?.editorGuides)
    } catch {
      // 快照 JSON 由本模块序列化生成，理论上不会解析失败；兜底忽略保持撤销流程可用。
    }
  }

  /** 切换参考线显示；仅影响渲染，不改动参考线数据本身。 */
  function setGuidesVisible(visible: boolean) {
    showGuides.value = visible === true
  }

  /** 视图菜单 / 右键菜单共用的显隐开关。 */
  function toggleGuides() {
    setGuidesVisible(!showGuides.value)
  }

  /** 把画布外坐标换算为参考线允许的落点范围（水平线限画布高、垂直线限画布宽）。 */
  function clampGuidePositionToCanvas(orientation: GuideOrientation, position: number) {
    return clampGuidePosition(orientation, position, canvasWidth.value, canvasHeight.value)
  }

  /**
   * 从标尺按下拖出新参考线：只更新拖拽预览状态，不写入 guides 列表；
   * 落定（endGuideDrag）时才真正创建，取消则什么都不留。
   */
  function beginGuideCreate(orientation: GuideOrientation, position: number) {
    guideDragState.value = {
      orientation,
      position: clampGuidePositionToCanvas(orientation, position),
      guideId: null,
      isNew: true
    }
  }

  /**
   * 开始拖动已有参考线：立即以实时位置更新 guides 列表（拖动过程可见跟随效果），
   * 松手后按落点决定保留还是删除（拖回标尺区域删除）。
   */
  function beginGuideMove(guideId: string, position: number) {
    const guide = guides.value.find((item) => item.id === guideId)
    if (!guide) return
    guideDragState.value = {
      orientation: guide.orientation,
      position: clampGuidePositionToCanvas(guide.orientation, position),
      guideId,
      isNew: false
    }
  }

  /** 拖拽过程中更新参考线位置（画布坐标，夹取到当前画布范围内）。 */
  function updateGuideDrag(position: number) {
    const state = guideDragState.value
    if (!state) return
    const next = clampGuidePositionToCanvas(state.orientation, position)
    state.position = next
    if (state.guideId) {
      guides.value = moveGuidePosition(guides.value, state.guideId, next)
    }
  }

  /**
   * 结束一次参考线拖拽手势：
   * - 落点在标尺区域（dropOnRuler=true）→ 新建预览直接取消；已有参考线则删除（拖回标尺删除）；
   * - 落点在画布 → 夹取后保留。整个手势提交一条撤销记录并触发草稿保存。
   */
  function endGuideDrag(dropOnRuler: boolean) {
    const state = guideDragState.value
    guideDragState.value = null
    if (!state) return
    if (dropOnRuler) {
      if (state.isNew) return
      guides.value = removeGuideById(guides.value, state.guideId ?? '')
      snapshot({ description: '删除参考线' })
      scheduleDraftSave()
      return
    }
    if (state.isNew) {
      // 新建：与同方向容差内已有参考线去重（重复落点不产生叠加参考线）
      const duplicate = findGuideAt(guides.value, state.orientation, state.position, 0.5)
      if (duplicate) return
      guides.value = [...guides.value, {
        id: createGuideId(),
        orientation: state.orientation,
        position: state.position
      }]
      snapshot({ description: `添加${state.orientation === 'horizontal' ? '水平' : '垂直'}参考线` })
    } else {
      snapshot({ description: '调整参考线' })
    }
    scheduleDraftSave()
  }

  /** 右键 / 菜单删除单条参考线，提交一条撤销记录。 */
  function removeGuide(guideId: string) {
    if (!guides.value.some((guide) => guide.id === guideId)) return
    guides.value = removeGuideById(guides.value, guideId)
    snapshot({ description: '删除参考线' })
    scheduleDraftSave()
  }

  /** 清除全部参考线；列表已空时不产生撤销记录。 */
  function clearGuides() {
    if (!guides.value.length) return
    guides.value = []
    snapshot({ description: '清除全部参考线' })
    scheduleDraftSave()
  }

  /**
   * 整体替换参考线列表（MCP set_guides / clear_guides 的运行时实现）：
   * 归一化 + 夹取到当前画布范围（越界位置夹取而非报错，保证每条参考线都可见可再编辑），
   * 由调用方（MCP 网关）负责提交撤销快照。返回应用后的完整列表供回显。
   */
  function setDocumentGuides(entries: Array<{ orientation: GuideOrientation; position: number }>): ProjectGuide[] {
    guides.value = normalizeDocumentGuides(entries.map((entry) => ({
      id: createGuideId(),
      orientation: entry.orientation,
      position: clampGuidePositionToCanvas(entry.orientation, entry.position)
    })))
    scheduleDraftSave()
    return getDocumentGuides()
  }

  // ── 文档级符号（Symbol）系统 ──
  // 符号定义挂工程级 symbols 通道持久化（symbols.ts 有归属与实例语义说明）；
  // 定义随撤销快照（editorSymbols 字段）还原，实例外观由画布 JSON 保持，
  // 恢复后不自动按定义重建，内容联动只发生在显式「更新符号」时。

  /** 符号定义响应式列表：随工程 / 草稿 / 撤销快照 round-trip。 */
  const symbols = ref<ProjectSymbol[]>([])

  /** 读取符号定义列表的深拷贝，供撤销快照与工程 JSON 序列化使用。 */
  function getDocumentSymbols(): ProjectSymbol[] {
    return JSON.parse(JSON.stringify(symbols.value)) as ProjectSymbol[]
  }

  /**
   * 覆盖文档级符号定义：工程加载传 symbols 字段，新建文档 / 旧工程传 null 归一化为空列表。
   * 内部先整体归一化（非法条目丢弃、重复 id 保留先出现者），保证响应式状态始终可用。
   */
  function applyDocumentSymbols(value: unknown) {
    symbols.value = normalizeProjectSymbols(value)
  }

  /** 从撤销快照 JSON 还原符号定义；解析失败时静默忽略，避免历史回滚被符号数据阻断。 */
  function restoreDocumentSymbolsFromSnapshot(snapshotJson: string) {
    try {
      const parsed = JSON.parse(snapshotJson) as { editorSymbols?: unknown }
      applyDocumentSymbols(parsed?.editorSymbols)
    } catch {
      // 快照 JSON 由本模块序列化生成，理论上不会解析失败；兜底忽略保持撤销流程可用。
    }
  }

  /** 收集画布上引用指定符号定义的全部实例（按 symbols.ts 元数据语义判定）。 */
  function findSymbolInstancesBySymbolId(symbolId: string): FabricObject[] {
    if (!fabricCanvas || !symbolId) return []
    return fabricCanvas.getObjects().filter((obj) => readSymbolInstanceMetadata(obj)?.symbolId === symbolId)
  }

  /** 统计画布上引用指定符号定义的实例数量，供符号库与 MCP 摘要展示。 */
  function getSymbolInstanceCount(symbolId: string): number {
    return findSymbolInstancesBySymbolId(symbolId).length
  }

  /**
   * 把序列化对象数组归一化为定义存储形态：先深拷贝校验，再按定义包围盒左上角平移到 (0,0)。
   * bounds 为源对象在画布上的联合包围盒（getObjectsCombinedBounds 结果）。
   */
  function buildNormalizedSymbolObjects(serialized: Record<string, unknown>[], bounds: { left: number; top: number }) {
    return normalizeSymbolObjectsToBounds(normalizeSymbolObjects(serialized), bounds)
  }

  /**
   * 用画布对象序列化结果创建符号定义并入库（创建符号的公共底层）：
   * 原对象保持不变（不自动转为实例，见 symbols.ts 语义说明）。
   * 返回新定义；对象无效或超出定义数量上限时抛中文错误。
   */
  function createSymbolDefinition(name: string, objects: FabricObject[]): ProjectSymbol {
    if (symbols.value.length >= MAX_PROJECT_SYMBOLS) {
      throw new Error(`符号数量已达上限 ${MAX_PROJECT_SYMBOLS} 个，请先删除不需要的符号`)
    }
    const bounds = getObjectsCombinedBounds(objects)
    if (!bounds) throw new Error('选中对象没有有效包围盒，无法创建符号')
    const serialized = objects.map((obj) => cloneSerializedObjectData(
      (obj as AnyFabricObject).toObject(SERIALIZED_OBJECT_PROPS as unknown as string[]) as Record<string, unknown>
    ))
    const symbol: ProjectSymbol = {
      id: createSymbolId(),
      name: normalizeSymbolName(name, `符号 ${symbols.value.length + 1}`),
      createdAt: Date.now(),
      objects: buildNormalizedSymbolObjects(serialized, bounds)
    }
    symbols.value = upsertProjectSymbol(symbols.value, symbol)
    scheduleDraftSave()
    return symbol
  }

  /**
   * 用画布对象重写指定符号定义（更新符号的公共底层，不负责实例重建）：
   * 重写定义 objects 并返回旧定义供调用方做实例几何映射。
   * 符号不存在或对象无效时抛中文错误。
   */
  function rewriteSymbolDefinition(symbolId: string, name: string, objects: FabricObject[]): { previous: ProjectSymbol; next: ProjectSymbol } {
    const previous = findProjectSymbolById(symbols.value, symbolId)
    if (!previous) throw new Error(`未找到符号: ${symbolId}`)
    const bounds = getObjectsCombinedBounds(objects)
    if (!bounds) throw new Error('选中对象没有有效包围盒，无法更新符号')
    const serialized = objects.map((obj) => cloneSerializedObjectData(
      (obj as AnyFabricObject).toObject(SERIALIZED_OBJECT_PROPS as unknown as string[]) as Record<string, unknown>
    ))
    const next: ProjectSymbol = {
      ...previous,
      name: normalizeSymbolName(name, previous.name),
      objects: buildNormalizedSymbolObjects(serialized, bounds)
    }
    symbols.value = upsertProjectSymbol(symbols.value, next)
    scheduleDraftSave()
    return { previous, next }
  }

  /**
   * 从定义构建一个全新的实例 Group（插入与更新重建共用的底层）：
   * enliven 定义对象 → 编组 → 挂实例元数据 → 换新内部 id 与默认元数据。
   * 子对象沿用 prepareClonedObjectMetadata 重置 id，避免多个实例共享 editorObjectId。
   */
  async function buildSymbolInstanceGroup(symbol: ProjectSymbol): Promise<Group> {
    const enlivened = await util.enlivenObjects(symbol.objects.map(cloneSerializedObjectData)) as FabricObject[]
    if (!enlivened.length) throw new Error('符号定义内容为空，无法创建实例')
    // 先补齐子对象元数据再编组：换新内部 id（避免多实例共享 editorObjectId）并重置
    // 万花筒/端点贴附等画布级引用，随后编组不会引入过期缓存。
    enlivened.forEach((child) => {
      prepareClonedObjectMetadata(child)
      applyDefaultKaleidoscopeMetadata(child)
      applyDefaultEndpointSnapMargin(child)
      normalizeEndpointAttachments(child)
      applyCanvasThemeToObject(child)
    })
    const group = new Group(enlivened)
    const metadata = createSymbolInstanceMetadata(symbol.id)
    const target = group as AnyFabricObject
    target.symbolId = metadata.symbolId
    target.symbolInstanceId = metadata.symbolInstanceId
    target.name = nextNameUnique(symbol.name)
    ensureEditorObjectId(group)
    applyDefaultSizeRatioLockMetadata(group)
    group.setCoords()
    return group
  }

  /**
   * 把实例 Group 的包围盒中心移动到目标场景坐标，并保证实例完整落在画布内：
   * 实例显示尺寸明显大于画布时先等比缩小到 82% 以内（与素材插入行为一致）。
   */
  function placeSymbolInstance(group: Group, scenePoint: { x: number; y: number } | null) {
    group.setCoords()
    const bounds = group.getBoundingRect()
    const maxWidth = canvasWidth.value * 0.82
    const maxHeight = canvasHeight.value * 0.82
    const scaleRatio = Math.min(
      1,
      bounds.width > 0 ? maxWidth / bounds.width : 1,
      bounds.height > 0 ? maxHeight / bounds.height : 1
    )
    if (Number.isFinite(scaleRatio) && scaleRatio > 0 && scaleRatio < 1) {
      group.set({ scaleX: (group.scaleX || 1) * scaleRatio, scaleY: (group.scaleY || 1) * scaleRatio })
      group.setCoords()
    }
    const target = scenePoint ?? { x: canvasWidth.value / 2, y: canvasHeight.value / 2 }
    group.setPositionByOrigin(new Point(target.x, target.y), 'center', 'center')
    group.setCoords()
  }

  /**
   * 插入符号实例（insert_symbol / MCP insert_symbol_instance 的运行时实现）：
   * 从定义构建实例 Group → 放到画布中心或落点 → 加入画布并选中。
   * 一次插入提交一条撤销记录；symbolId 不存在时抛中文错误，返回实例 Group。
   */
  async function insertSymbolInstance(symbolId: string, scenePoint: { x: number; y: number } | null = null): Promise<Group> {
    const fabric = fabricCanvas
    if (!fabric) throw new Error('画布尚未初始化')
    const symbol = findProjectSymbolById(symbols.value, symbolId)
    if (!symbol) throw new Error(`未找到符号: ${symbolId}，可先执行 list_symbols 查询`)
    clearBooleanPreview()
    clearPointEditing()
    const group = await buildSymbolInstanceGroup(symbol)
    placeSymbolInstance(group, scenePoint)
    const previousGate = skipSnapshot
    skipSnapshot = true
    try {
      fabric.add(group as AnyFabricObject)
    } finally {
      skipSnapshot = previousGate
    }
    setSelectionMode('shape')
    applyActiveObjectsSelection([group])
    snapshot({ description: `插入符号实例: ${symbol.name}` })
    scheduleDraftSave()
    return group
  }

  /**
   * 更新符号定义并用画布对象重建全部实例（update_symbol 的运行时实现）：
   * 定义 objects 重写后，全部实例按新定义重建——重建策略保持实例的包围盒中心、
   * 显示尺寸与旋转角不变（computeSymbolInstanceScale 把新定义内容映射进旧实例包围盒），
   * symbolInstanceId 保持不变以维持外部引用稳定。整个操作提交一条撤销记录。
   * 返回更新后的定义与重建的实例 id 列表。
   */
  async function updateSymbolInstances(symbolId: string, objects: FabricObject[]): Promise<{ symbol: ProjectSymbol; instanceIds: string[] }> {
    const fabric = fabricCanvas
    if (!fabric) throw new Error('画布尚未初始化')
    const symbol = findProjectSymbolById(symbols.value, symbolId)
    if (!symbol) throw new Error(`未找到符号: ${symbolId}，可先执行 list_symbols 查询`)
    // 先记录旧实例几何（中心点 / 显示尺寸 / 角度），供重建后映射恢复。
    const instances = findSymbolInstancesBySymbolId(symbolId)
    const geometries = instances.map((instance) => {
      instance.setCoords()
      return {
        instance,
        center: instance.getCenterPoint(),
        width: instance.getScaledWidth?.() ?? Number(instance.width ?? 0),
        height: instance.getScaledHeight?.() ?? Number(instance.height ?? 0),
        angle: Number(instance.angle ?? 0)
      }
    })
    const { next } = rewriteSymbolDefinition(symbolId, symbol.name, objects)
    const instanceIds: string[] = []
    const previousGate = skipSnapshot
    skipSnapshot = true
    try {
      for (const geometry of geometries) {
        const group = await buildSymbolInstanceGroup(next)
        // 保持实例 id 稳定：仅替换内容与几何，外部引用（symbolInstanceId）不变。
        ;(group as AnyFabricObject).symbolInstanceId = readSymbolInstanceMetadata(geometry.instance)?.symbolInstanceId
          ?? (group as AnyFabricObject).symbolInstanceId
        const scale = computeSymbolInstanceScale(
          { width: geometry.width, height: geometry.height },
          { width: group.width || 1, height: group.height || 1 }
        )
        group.set({ angle: geometry.angle, scaleX: scale.scaleX, scaleY: scale.scaleY })
        group.setPositionByOrigin(geometry.center, 'center', 'center')
        group.setCoords()
        const index = fabric.getObjects().indexOf(geometry.instance)
        if (index >= 0) fabric.remove(geometry.instance as AnyFabricObject)
        fabric.insertAt(index >= 0 ? index : fabric.getObjects().length, group as AnyFabricObject)
        instanceIds.push(ensureEditorObjectId(group))
      }
    } finally {
      skipSnapshot = previousGate
    }
    if (geometries.length) {
      applyActiveObjectsSelection([])
    }
    refreshLayers()
    syncObjProps()
    fabric.requestRenderAll()
    snapshot({ description: `更新符号: ${next.name}` })
    scheduleDraftSave()
    return { symbol: next, instanceIds }
  }

  /**
   * 解除对象与符号定义的关联（detach 的运行时实现）：
   * 移除 symbolId / symbolInstanceId 元数据转普通对象，定义不动，外观保持。
   * 返回解除关联的对象列表；无命中时返回空列表且不提交撤销记录。
   */
  function detachSymbolInstances(objects: FabricObject[]): FabricObject[] {
    const fabric = fabricCanvas
    if (!fabric) return []
    const targets = objects.filter((obj) => !!readSymbolInstanceMetadata(obj))
    if (!targets.length) return []
    withSnapshotSuppressed(() => {
      targets.forEach((obj) => {
        const target = obj as AnyFabricObject
        delete target.symbolId
        delete target.symbolInstanceId
        target.setCoords()
      })
    })
    fabric.requestRenderAll()
    refreshLayers()
    syncObjProps()
    snapshot({ description: '解除符号关联' })
    scheduleDraftSave()
    return targets
  }

  /**
   * 删除符号定义（符号库删除按钮 / MCP delete 的底层）：
   * 定义从列表移除，画布上全部实例自动解除关联（保留外观转普通对象）。
   * 返回被删除的定义与解除关联的实例数；定义不存在时抛中文错误。
   */
  function deleteSymbolDefinition(symbolId: string): { symbol: ProjectSymbol; detachedCount: number } {
    const symbol = findProjectSymbolById(symbols.value, symbolId)
    if (!symbol) throw new Error(`未找到符号: ${symbolId}`)
    symbols.value = removeProjectSymbolById(symbols.value, symbolId)
    const instances = findSymbolInstancesBySymbolId(symbolId)
    withSnapshotSuppressed(() => {
      instances.forEach((obj) => {
        const target = obj as AnyFabricObject
        delete target.symbolId
        delete target.symbolInstanceId
        target.setCoords()
      })
    })
    fabricCanvas?.requestRenderAll()
    refreshLayers()
    snapshot({ description: `删除符号定义: ${symbol.name}` })
    scheduleDraftSave()
    return { symbol, detachedCount: instances.length }
  }

  /** 读取对象在图层面板显示用的符号徽标文本：实例返回「符号名」，普通对象返回空串。 */
  function getSymbolBadgeText(obj: FabricObject | null | undefined): string {
    const metadata = readSymbolInstanceMetadata(obj)
    if (!metadata) return ''
    return findProjectSymbolById(symbols.value, metadata.symbolId)?.name ?? '已删符号'
  }

  // ── 符号系统的界面命令（右键菜单与符号库面板入口） ──

  /** 创建符号命名弹窗状态：与图层重命名弹窗同一交互模式。 */
  const symbolNameDialog = reactive<{ show: boolean; value: string; error: string }>({
    show: false,
    value: '',
    error: ''
  })

  /** 根据当前选区生成创建符号的默认名称：单选沿用图层显示名，多选用「符号 N」。 */
  function getDefaultSymbolName() {
    const targets = selectedObjects.value.filter((obj) => !isBooleanPreviewObject(obj))
    if (targets.length === 1) return getObjectDisplayName(targets[0])
    return `符号 ${symbols.value.length + 1}`
  }

  /** 打开「创建为符号」命名弹窗，默认名取当前选区。 */
  function openCreateSymbolDialog() {
    const targets = selectedObjects.value.filter((obj) => !isBooleanPreviewObject(obj))
    if (!targets.length) return
    symbolNameDialog.value = getDefaultSymbolName()
    symbolNameDialog.error = ''
    symbolNameDialog.show = true
  }

  /** 关闭创建符号弹窗时清空临时输入与错误信息。 */
  function handleSymbolNameDialogShowChange(show: boolean) {
    symbolNameDialog.show = show
    if (show) return
    symbolNameDialog.value = ''
    symbolNameDialog.error = ''
  }

  /** 确认创建符号：定义入库、原对象保持不变并 toast 说明，一条撤销记录。 */
  function confirmCreateSymbolDialog() {
    const targets = selectedObjects.value.filter((obj) => !isBooleanPreviewObject(obj))
    if (!targets.length) {
      handleSymbolNameDialogShowChange(false)
      return
    }
    try {
      const symbol = createSymbolDefinition(symbolNameDialog.value, targets)
      snapshot({ description: `创建符号: ${symbol.name}` })
      showToast(`已创建符号「${symbol.name}」，画布原对象保持不变`, 'success')
      handleSymbolNameDialogShowChange(false)
    } catch (error) {
      symbolNameDialog.error = error instanceof Error ? error.message : '创建符号失败'
    }
  }

  /** 符号库点击插入：实例落在画布中心（一条撤销记录），失败时 toast 说明。 */
  async function insertSymbolFromLibrary(symbol: ProjectSymbol) {
    try {
      await insertSymbolInstance(symbol.id, null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '插入符号实例失败', 'error')
    }
  }

  /** 符号库「用选中对象更新」：重写定义并同步全部实例（一条撤销记录），失败时 toast 说明。 */
  async function updateSymbolFromLibrary(symbol: ProjectSymbol) {
    const targets = selectedObjects.value.filter((obj) => !isBooleanPreviewObject(obj))
    if (!targets.length) {
      showToast('请先在画布选中用于更新符号的对象', 'warning')
      return
    }
    try {
      const result = await updateSymbolInstances(symbol.id, targets)
      showToast(`符号「${result.symbol.name}」已更新，${result.instanceIds.length} 个实例已同步`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '更新符号失败', 'error')
    }
  }

  /** 符号库删除定义：二次确认后删除，全部实例自动解除关联并 toast 说明（一条撤销记录）。 */
  function deleteSymbolFromLibrary(symbol: ProjectSymbol) {
    if (!window.confirm(`确定删除符号「${symbol.name}」吗？画布上的实例将自动解除关联并保留外观。`)) return
    try {
      const result = deleteSymbolDefinition(symbol.id)
      showToast(`已删除符号「${result.symbol.name}」，${result.detachedCount} 个实例已解除关联`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除符号失败', 'error')
    }
  }

  /** 图层右键「解除符号关联」：对选中对象解除关联，无实例时 toast 提示。 */
  function detachSymbolSelection() {
    const targets = selectedObjects.value.filter((obj) => !isBooleanPreviewObject(obj))
    const detached = detachSymbolInstances(targets)
    if (!detached.length) {
      showToast('选中对象中没有符号实例', 'warning')
      return
    }
    showToast(`已解除 ${detached.length} 个实例的符号关联`, 'success')
  }

  // 对象拖拽吸附参考线的视口像素阈值（换算为画布单位需除以缩放）。
  const GUIDE_SNAP_THRESHOLD_VIEWPORT_PX = 4

  /**
   * 对象拖拽 / 缩放时吸附对齐参考线（加分项能力）：
   * 取包围盒的左/中/右（水平参考线按上/中/下）与同方向参考线比较，取最近的一条，
   * 距离在 4px 视口阈值内时整体平移吸附。不吸附时静默返回，行为与无参考线一致。
   */
  function snapObjectPositionToGuides(obj: FabricObject | null | undefined) {
    if (!obj || !showGuides.value || !guides.value.length) return false
    const zoomValue = zoom.value > 0 ? zoom.value : 1
    const threshold = GUIDE_SNAP_THRESHOLD_VIEWPORT_PX / zoomValue
    const bounds = obj.getBoundingRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    let deltaX = Number.POSITIVE_INFINITY
    let deltaY = Number.POSITIVE_INFINITY
    for (const guide of guides.value) {
      if (guide.orientation === 'vertical') {
        for (const edge of [bounds.left, centerX, bounds.left + bounds.width]) {
          const distance = Math.abs(guide.position - edge)
          if (distance < threshold && distance < Math.abs(deltaX)) deltaX = guide.position - edge
        }
        continue
      }
      for (const edge of [bounds.top, centerY, bounds.top + bounds.height]) {
        const distance = Math.abs(guide.position - edge)
        if (distance < threshold && distance < Math.abs(deltaY)) deltaY = guide.position - edge
      }
    }
    if (!Number.isFinite(deltaX) && !Number.isFinite(deltaY)) return false
    obj.set({
      left: (obj.left ?? 0) + (Number.isFinite(deltaX) ? deltaX : 0),
      top: (obj.top ?? 0) + (Number.isFinite(deltaY) ? deltaY : 0)
    })
    obj.setCoords()
    return true
  }

  // ── 全局颜色替换 ──
  const colorReplaceDialog = reactive({ show: false })
  // 打开弹窗时一次性扫描的文档颜色快照；替换成功后由打开方重新扫描刷新。
  const colorReplaceEntries = ref<ScannedColorEntry[]>([])

  /** 打开颜色替换弹窗并扫描当前文档颜色（排除布尔预览对象，编组递归展开）。 */
  function openColorReplaceDialog() {
    colorReplaceEntries.value = scanDocumentColors(
      fabricCanvas ? fabricCanvas.getObjects() : [],
      { isExcluded: (obj) => isBooleanPreviewObject(obj as FabricObject | null | undefined) }
    )
    colorReplaceDialog.show = true
  }

  /** 关闭颜色替换弹窗。 */
  function closeColorReplaceDialog() {
    colorReplaceDialog.show = false
  }

  /**
   * 执行全局颜色替换（一条撤销记录）：
   * 全量对象走纯模块替换 fill/stroke/渐变色标/渐变元数据，完成后刷新画布与图层面板，
   * toast 汇报替换对象数。源色非法或与目标色相同时返回 null，由调用方提示。
   */
  function replaceAllColor(from: string, to: string): { objectCount: number; slotCount: number } | null {
    if (!fabricCanvas) return null
    if (normalizeColorKey(from) === null || normalizeColorKey(from) === normalizeColorKey(to)) return null
    const objects = fabricCanvas.getObjects()
    const result = withSnapshotSuppressed(() => replaceDocumentColor(
      objects,
      from,
      to,
      { isExcluded: (obj) => isBooleanPreviewObject(obj as FabricObject | null | undefined) }
    ))
    if (!result.objectCount) return result
    for (const obj of objects) {
      const typed = obj as AnyFabricObject
      typed.dirty = true
      typed.setCoords()
      triggerKaleidoscopeContentSync(obj)
    }
    fabricCanvas.requestRenderAll()
    refreshLayers()
    markSmallPreviewsDirty()
    snapshot({ description: `颜色替换 ${from} → ${to}` })
    scheduleDraftSave()
    return result
  }

  // 获取对象在图层面板中的显示名，规范检查定位问题时复用同一套命名策略。
  function getObjectDisplayName(obj: FabricObject) {
    return String((obj as AnyFabricObject).name || obj.type || '对象')
  }

  // 汇总当前画布状态并委托纯检查模块生成规范问题，选择定位等副作用仍留在编辑器壳层。
  function buildIconCheckIssues(): IconCheckIssue[] {
    void fabricCanvasVersion.value
    void layerVersion.value
    if (!fabricCanvas) return []
    return buildIconCheckIssuesFromContext({
      canvasBg: canvasBg.value,
      canvasWidth: canvasWidth.value,
      keylineTemplate: keylineTemplate.value,
      keylineSafeArea: keylineSafeArea.value,
      objects: fabricCanvas.getObjects(),
      isBooleanPreviewObject,
      isStrokeEnabled,
      getStyleTargets,
      getObjectDisplayName
    })
  }

  // 点击检查项时定位到关联对象，方便用户直接调整越界、描边过细或非整数坐标问题。
  function selectIconCheckIssue(issue: IconCheckIssue) {
    if (!issue.target || !fabricCanvas) return
    previewPopoverVisible.value = false
    applyActiveObjectsSelection([issue.target])
  }

  // 生成适合目录或文件名使用的画板名称，避免多画板 ZIP 内出现路径分隔符和空名称。
  function sanitizeExportEntryName(value: string, fallback: string) {
    const normalized = value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '-')
    return normalized || fallback
  }

  // 为 ZIP 条目路径追加序号，确保同名画板或重复尺寸不会在压缩包内互相覆盖。
  function createUniqueZipEntryName(name: string, usedNames: Set<string>) {
    const normalized = name.replace(/\\/g, '/')
    if (!usedNames.has(normalized)) {
      usedNames.add(normalized)
      return normalized
    }
    const slashIndex = normalized.lastIndexOf('/')
    const directory = slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : ''
    const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
    const dotIndex = fileName.lastIndexOf('.')
    const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
    const ext = dotIndex > 0 ? fileName.slice(dotIndex) : ''
    let index = 1
    let candidate = `${directory}${base}-${index}${ext}`
    while (usedNames.has(candidate)) {
      index += 1
      candidate = `${directory}${base}-${index}${ext}`
    }
    usedNames.add(candidate)
    return candidate
  }

  // 将 dataURL 转为 ZIP 可直接写入的 base64 内容，过滤异常渲染结果以便导出流程报错。
  function getBase64PayloadFromDataUrl(dataUrl: string) {
    const match = /^data:[^;]+;base64,(.*)$/i.exec(dataUrl)
    if (!match) throw new Error('PNG 渲染结果无效')
    return match[1]
  }

  function isBooleanPreviewObject(obj: FabricObject | null | undefined): obj is AnyFabricObject {
    return !!obj && !!(obj as AnyFabricObject).booleanPreview
  }

  function getBooleanPreviewStrokeColor(style: FabricBooleanStyleSnapshot) {
    const candidates = [style.stroke, style.lastStroke, style.fill, style.lastFill]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const normalized = candidate.trim().toLowerCase()
      if (normalized && normalized !== 'none' && normalized !== 'transparent') return candidate
    }
    return getCanvasAssistColors().primary
  }

  function getBooleanPreviewStrokeWidth(style: FabricBooleanStyleSnapshot) {
    const width = Number(style.strokeWidth || 0)
    if (!Number.isFinite(width) || width <= 0) return 2
    return Math.max(2, Math.min(width, 4))
  }

  function getViewportPointForEditablePathPoint(obj: EditablePathObject, point: EditablePoint) {
    return new Point(point.x, point.y)
      .subtract(obj.pathOffset)
      .transform(util.multiplyTransformMatrices(obj.getViewportTransform(), obj.calcTransformMatrix()))
  }

  function getViewportPointForEditablePoint(obj: EditablePathObject, pointIndex: number) {
    return editablePointToLocalObjectPoint(obj, pointIndex).transform(
      util.multiplyTransformMatrices(obj.getViewportTransform(), obj.calcTransformMatrix())
    )
  }

  function lerpEditablePoint(fromPoint: EditablePoint, toPoint: EditablePoint, amount: number): EditablePoint {
    return {
      x: fromPoint.x + (toPoint.x - fromPoint.x) * amount,
      y: fromPoint.y + (toPoint.y - fromPoint.y) * amount
    }
  }

  function getLiveEditableSegment(segmentRef: EditableSegmentRef | null) {
    const liveSegmentRef = getLiveEditableSegmentRef(segmentRef)
    if (!liveSegmentRef) return null
    return liveSegmentRef.segment
  }

  function getEditableSegmentControlPoint(segmentRef: EditableSegmentRef, controlPoint: CurveControlPointKey): EditablePoint {
    const liveSegmentRef = getLiveEditableSegmentRef(segmentRef)
    if (!liveSegmentRef) {
      return controlPoint === 'cp1'
        ? lerpEditablePoint(segmentRef.fromPoint, segmentRef.toPoint, 1 / 3)
        : lerpEditablePoint(segmentRef.fromPoint, segmentRef.toPoint, 2 / 3)
    }
    const liveSegment = liveSegmentRef.segment
    if (liveSegment.type === 'cubic') return liveSegment[controlPoint]
    if (liveSegment[controlPoint]) return liveSegment[controlPoint]
    return controlPoint === 'cp1'
      ? lerpEditablePoint(liveSegmentRef.fromPoint, liveSegmentRef.toPoint, 1 / 3)
      : lerpEditablePoint(liveSegmentRef.fromPoint, liveSegmentRef.toPoint, 2 / 3)
  }

  function resetCurveProps() {
    objProps.curveEnabled = false
    objProps.curveCp1XInput = '0'
    objProps.curveCp1YInput = '0'
    objProps.curveCp2XInput = '0'
    objProps.curveCp2YInput = '0'
  }

  function resetKaleidoscopeProps() {
    objProps.kaleidoscopeEnabled = false
    objProps.kaleidoscopeCenterXInput = '0'
    objProps.kaleidoscopeCenterYInput = '0'
    objProps.kaleidoscopeFollowRotation = false
    objProps.kaleidoscopeCountInput = String(DEFAULT_KALEIDOSCOPE_COUNT)
  }

  function createRadialGradientCenterControl(source: FabricObject) {
    return new Control({
      actionName: 'moveRadialGradientCenter',
      cursorStyle: 'move',
      sizeX: 14,
      sizeY: 14,
      touchSizeX: 20,
      touchSizeY: 20,
      positionHandler: () => {
        const target = getGradientTarget(source)
        if (!target) return new Point(0, 0)
        applyDefaultFillGradientMetadata(target)
        const localPoint = new Point(
          (target.fillGradientCenterX ?? 0.5) * (source.width ?? 0) - (source.width ?? 0) / 2,
          (target.fillGradientCenterY ?? 0.5) * (source.height ?? 0) - (source.height ?? 0) / 2
        )
        return localPoint.transform(util.multiplyTransformMatrices(source.getViewportTransform(), source.calcTransformMatrix()))
      },
      getVisibility: () => (
        activeObject.value === source
        && selectionMode.value === 'shape'
        && objProps.fillEnabled
        && objProps.fillMode === 'gradient'
        && objProps.fillGradientType === 'radial'
      ),
      actionHandler: (_eventData, _transform, x, y) => {
        const target = getGradientTarget(source)
        if (!target || !fabricCanvas) return false
        const local = getPixelGridAdjustedScenePoint(new Point(x, y)).transform(util.invertTransform(source.calcTransformMatrix()))
        const width = Math.max(1, source.width ?? 1)
        const height = Math.max(1, source.height ?? 1)
        target.fillGradientCenterX = Math.min(1, Math.max(0, (local.x + width / 2) / width))
        target.fillGradientCenterY = Math.min(1, Math.max(0, (local.y + height / 2) / height))
        objProps.fillGradientCenterX = target.fillGradientCenterX
        objProps.fillGradientCenterY = target.fillGradientCenterY
        applyGradientFillToTarget(source)
        triggerKaleidoscopeContentSync(source)
        source.canvas?.requestRenderAll()
        return true
      },
      mouseUpHandler: () => {
        snapshot()
        syncObjProps()
        return false
      },
      render: (ctx, left, top) => {
        const colors = getCanvasAssistColors()
        ctx.save()
        ctx.beginPath()
        ctx.arc(left, top, 5, 0, Math.PI * 2)
        ctx.fillStyle = colors.textOnPrimary
        ctx.strokeStyle = colors.primary
        ctx.lineWidth = 2
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(left - 7, top)
        ctx.lineTo(left + 7, top)
        ctx.moveTo(left, top - 7)
        ctx.lineTo(left, top + 7)
        ctx.strokeStyle = colors.primaryStrong
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()
      }
    } as Partial<Control>)
  }

  function formatKaleidoscopeInputValue(value: number) {
    return String(Math.round(value * 100) / 100)
  }

  function createKaleidoscopeCenterControl(source: FabricObject) {
    return new Control({
      actionName: 'moveKaleidoscopeCenter',
      cursorStyle: 'move',
      sizeX: 14,
      sizeY: 14,
      touchSizeX: 20,
      touchSizeY: 20,
      positionHandler: () => {
        const pivot = getKaleidoscopeEffectiveCenter(source)
        return pivot.transform(source.getViewportTransform())
      },
      getVisibility: () => (
        activeKaleidoscopeSource.value === source
        && selectionMode.value === 'shape'
        && objProps.kaleidoscopeEnabled
      ),
      actionHandler: (_eventData, _transform, x, y) => {
        const target = getKaleidoscopeMetadata(source)
        if (!target) return false
        target.kaleidoscopeCenterX = x
        target.kaleidoscopeCenterY = y
        objProps.kaleidoscopeCenterXInput = formatKaleidoscopeInputValue(x)
        objProps.kaleidoscopeCenterYInput = formatKaleidoscopeInputValue(y)
        syncKaleidoscopeTransforms(source)
        source.canvas?.requestRenderAll()
        return true
      },
      mouseUpHandler: () => {
        snapshot()
        syncObjProps()
        return false
      },
      render: (ctx, left, top) => {
        ctx.save()
        ctx.beginPath()
        ctx.arc(left, top, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#ff4d4f'
        ctx.lineWidth = 2
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(left - 8, top)
        ctx.lineTo(left + 8, top)
        ctx.moveTo(left, top - 8)
        ctx.lineTo(left, top + 8)
        ctx.strokeStyle = '#ff4d4f'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()
      }
    } as Partial<Control>)
  }

  function attachKaleidoscopeCenterControl(obj: FabricObject | null) {
    restorePointControls()
    if (!obj || selectionMode.value !== 'shape') return
    const controls: FabricControls = cloneCurrentControls(obj)
    if (isKaleidoscopeSource(obj)) {
      controls[KALEIDOSCOPE_CENTER_CONTROL_KEY] = createKaleidoscopeCenterControl(obj)
    }
    if (activeObject.value === obj && objProps.fillEnabled && objProps.fillMode === 'gradient' && objProps.fillGradientType === 'radial') {
      controls[RADIAL_GRADIENT_CENTER_CONTROL_KEY] = createRadialGradientCenterControl(obj)
    }
    installTemporaryControls(obj, controls)
  }

  function setKaleidoscopeCenterValue(axis: 'x' | 'y', value: number) {
    const source = activeKaleidoscopeEditableSource.value
    if (!source || !fabricCanvas) return
    initializeKaleidoscopeSource(source)
    const target = getKaleidoscopeMetadata(source)
    if (!target) return
    if (axis === 'x') target.kaleidoscopeCenterX = value
    else target.kaleidoscopeCenterY = value
    syncKaleidoscopeTransforms(source)
    fabricCanvas.requestRenderAll()
    snapshot()
    syncObjProps()
  }

  function setKaleidoscopeCenterFromInput(axis: 'x' | 'y', value: string | number) {
    const source = activeKaleidoscopeEditableSource.value
    if (!source) return
    initializeKaleidoscopeSource(source)
    const center = getKaleidoscopeEffectiveCenter(source)
    const fallback = axis === 'x' ? center.x : center.y
    commitNumericInput(
      value,
      fallback,
      (next) => { setKaleidoscopeCenterValue(axis, next) },
      (next) => {
        if (axis === 'x') objProps.kaleidoscopeCenterXInput = next
        else objProps.kaleidoscopeCenterYInput = next
      }
    )
  }

  function setKaleidoscopeCountValue(value: number) {
    const source = activeKaleidoscopeEditableSource.value
    if (!source || !fabricCanvas) return
    initializeKaleidoscopeSource(source)
    const target = getKaleidoscopeMetadata(source)
    if (!target) return
    target.kaleidoscopeCount = normalizeKaleidoscopeCount(value)
    objProps.kaleidoscopeCountInput = String(target.kaleidoscopeCount)
    triggerKaleidoscopeRebuild(source)
    snapshot()
    syncObjProps()
  }

  function setKaleidoscopeCountFromInput(value: string | number) {
    const source = activeKaleidoscopeEditableSource.value
    if (!source) return
    commitNumericInput(
      value,
      getKaleidoscopeCount(source),
      (next) => { setKaleidoscopeCountValue(next) },
      (next) => { objProps.kaleidoscopeCountInput = String(normalizeKaleidoscopeCount(next)) }
    )
  }

  function setKaleidoscopeEnabled(enabled: boolean) {
    const source = activeKaleidoscopeEditableSource.value
    if (!source || !fabricCanvas) return
    initializeKaleidoscopeSource(source)
    const target = getKaleidoscopeMetadata(source)
    if (!target) return
    target.kaleidoscopeEnabled = enabled
    objProps.kaleidoscopeEnabled = enabled
    if (!enabled) {
      removeKaleidoscopeInstancesBySourceId(ensureKaleidoscopeSourceId(source))
      fabricCanvas.requestRenderAll()
      refreshLayers()
    } else {
      triggerKaleidoscopeRebuild(source)
    }
    updateCurveControls()
    snapshot()
    syncObjProps()
  }

  function setKaleidoscopeFollowRotation(enabled: boolean) {
    const source = activeKaleidoscopeEditableSource.value
    if (!source || !fabricCanvas) return
    initializeKaleidoscopeSource(source)
    const target = getKaleidoscopeMetadata(source)
    if (!target) return
    target.kaleidoscopeFollowRotation = enabled
    objProps.kaleidoscopeFollowRotation = enabled
    syncKaleidoscopeTransforms(source)
    snapshot()
    syncObjProps()
  }


  function selectKaleidoscopeSourceFromInstance() {
    const source = activeKaleidoscopeInstanceSource.value
    if (!source) return
    applyActiveObjectsSelection([source])
  }

  function detachKaleidoscopeInstance() {
    const instance = activeKaleidoscopeInstance.value
    if (!instance || !fabricCanvas) return
    clearBooleanPreview()
    withSnapshotSuppressed(() => {
      clearKaleidoscopeMetadata(instance)
      setKaleidoscopeInstanceManagedState(instance, false)
      instance.setCoords()
    })
    fabricCanvas.requestRenderAll()
    refreshLayers()
    refreshActiveObject()
    snapshot()
    syncObjProps()
  }
  // 将场景坐标转换为路径本地坐标，不经过网格吸附；用于命中测试等只读判断。
  function getRawLocalPointFromCanvas(obj: EditablePathObject, x: number, y: number) {
    return new Point(x, y)
      .transform(util.invertTransform(obj.calcOwnMatrix()))
      .add(obj.pathOffset)
  }

  // 将编辑拖拽坐标转换为路径本地坐标；启用吸附时先按场景网格对齐，再写回点位模型。
  function getLocalPointFromCanvas(obj: EditablePathObject, x: number, y: number) {
    return getPixelGridAdjustedScenePoint(new Point(x, y))
      .transform(util.invertTransform(obj.calcOwnMatrix()))
      .add(obj.pathOffset)
  }

  function canEditPoints(editable: EditablePathObject) {
    return activeEditablePathObject.value === editable && selectionMode.value === 'point'
  }

  function canEditSegments(editable: EditablePathObject) {
    return activeEditablePathObject.value === editable
      && selectionMode.value === 'segment'
      && getArrowRenderMode(editable) !== 'hollow-shaft'
  }

  function getViewportPointForLocalEditablePoint(obj: EditablePathObject, point: EditablePoint) {
    return getViewportPointForEditablePathPoint(obj, point)
  }

  function createSegmentSelectControl(editable: EditablePathObject, segmentRef: EditableSegmentRef) {
    const segmentKey = `${segmentRef.contourIndex}:${segmentRef.segmentIndex}`
    return new Control({
      actionName: 'selectEditableSegment',
      cursorStyle: 'pointer',
      sizeX: 12,
      sizeY: 12,
      touchSizeX: 22,
      touchSizeY: 22,
      segmentKey,
      positionHandler: () => {
        const liveSegmentRef = resolveEditableSegmentRef(editable, segmentRef)
        if (!liveSegmentRef) return new Point(0, 0)
        return getViewportPointForLocalEditablePoint(editable, getEditableSegmentMidpoint(liveSegmentRef))
      },
      getVisibility: () => {
        if (!canEditSegments(editable)) return false
        // 隐藏当前已选中边的中点辅助器，由 cp1/cp2 等控件接管
        if (isSameEditableSegmentRef(selectedSegmentRef.value, segmentRef)) return false
        return !!resolveEditableSegmentRef(editable, segmentRef)
      },
      mouseDownHandler: () => {
        if (!canEditSegments(editable)) return false
        const liveSegmentRef = resolveEditableSegmentRef(editable, segmentRef)
        if (!liveSegmentRef) return false
        setSelectedEditableSegment(editable, liveSegmentRef)
        return false
      },
      render: (ctx, left, top) => {
        const isSelected = isSameEditableSegmentRef(selectedSegmentRef.value, segmentRef)
        const size = isSelected ? 6 : 5
        const colors = getCanvasAssistColors()
        ctx.save()
        ctx.beginPath()
        ctx.rect(left - size, top - size, size * 2, size * 2)
        ctx.fillStyle = isSelected ? colors.primary : colors.textOnPrimary
        ctx.strokeStyle = colors.primary
        ctx.lineWidth = 1.5
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
    } as Partial<Control> & { segmentKey: string })
  }

  function createCurveHandleControl(editable: EditablePathObject, controlPoint: CurveControlPointKey) {
    return new Control({
      actionName: 'modifyEditableCurve',
      cursorStyle: 'crosshair',
      sizeX: 10,
      sizeY: 10,
      touchSizeX: 18,
      touchSizeY: 18,
      pointIndex: controlPoint,
      positionHandler: () => {
        const segmentRef = selectedEditableSegment.value
        if (!segmentRef) return new Point(0, 0)
        return getViewportPointForEditablePathPoint(editable, getEditableSegmentControlPoint(segmentRef, controlPoint))
      },
      getVisibility: () => canEditSegments(editable) && !!getLiveEditableSegment(selectedEditableSegment.value),
      actionHandler: (_eventData, _transform, x, y) => {
        if (!canEditSegments(editable)) return false
        const segmentRef = selectedEditableSegment.value
        if (!segmentRef) return false
        setEditableSegmentControlPoint(editable, segmentRef, controlPoint, getLocalPointFromCanvas(editable, x, y))
        triggerKaleidoscopeContentSync(editable)
        // 拖动过程中保持 segmentRef 与最新模型同步
        const liveSegmentRef = resolveEditableSegmentRef(editable, segmentRef)
        if (liveSegmentRef) selectedSegmentRef.value = liveSegmentRef
        syncObjProps()
        fabricCanvas?.requestRenderAll()
        return true
      },
      mouseUpHandler: () => {
        snapshot()
        return false
      },
      render: (ctx, left, top) => {
        const segmentRef = selectedEditableSegment.value
        const liveSegmentRef = getLiveEditableSegmentRef(segmentRef)
        if (!liveSegmentRef) return
        const anchorPoint = controlPoint === 'cp1' ? liveSegmentRef.fromPoint : liveSegmentRef.toPoint
        const anchorViewportPoint = getViewportPointForEditablePathPoint(editable, anchorPoint)
        renderCurveHandleControl(ctx, left, top, anchorViewportPoint)
      }
    } as Partial<Control> & { pointIndex: CurveControlPointKey })
  }

  // 曲线控制柄的统一绘制：锚点到柄的细连线 + 柄端小圆点（边模式 cp 柄与锚点柄共用）。
  function renderCurveHandleControl(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    anchorViewportPoint: Point
  ) {
    const colors = getCanvasAssistColors()
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(anchorViewportPoint.x, anchorViewportPoint.y)
    ctx.lineTo(left, top)
    ctx.strokeStyle = colors.primaryStrong
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(left, top, 4, 0, Math.PI * 2)
    ctx.fillStyle = colors.textOnPrimary
    ctx.strokeStyle = colors.primary
    ctx.lineWidth = 2
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  /**
   * 创建点位模式下选中锚点的贝塞尔控制柄控件（与钢笔工具选中锚点后的双柄展示一致）：
   * - side = 'in'：入柄，绑定"入段"（终点为该锚点）的 cp2；
   * - side = 'out'：出柄，绑定"出段"（起点为该锚点）的 cp1；
   * 只要邻段存在就显示（cubic 段取真实 cp，直线段显示在 1/3、2/3 幻影位），
   * 拖拽幻影柄会把直线段转为曲线（setEditableSegmentControlPoint 同边模式规则）；
   * 开放轮廓端点缺少邻段的一侧不显示。
   */
  function createAnchorCurveHandleControl(editable: EditablePathObject, anchorIndex: number, side: 'in' | 'out') {
    const controlPoint: CurveControlPointKey = side === 'in' ? 'cp2' : 'cp1'
    const resolveHandleSegmentRef = () => {
      const refs = getEditableAnchorHandleRefs(editable, anchorIndex)
      return side === 'in' ? refs.inSegmentRef : refs.outSegmentRef
    }
    return new Control({
      actionName: 'modifyEditableCurve',
      cursorStyle: 'crosshair',
      sizeX: 10,
      sizeY: 10,
      touchSizeX: 18,
      touchSizeY: 18,
      pointIndex: `${anchorIndex}:${side}`,
      positionHandler: () => {
        const segmentRef = resolveHandleSegmentRef()
        if (!segmentRef) return new Point(0, 0)
        return getViewportPointForEditablePathPoint(editable, getEditableSegmentControlPoint(segmentRef, controlPoint))
      },
      getVisibility: () => canEditPoints(editable)
        && selectedPointIndices.value.includes(anchorIndex)
        && !!resolveHandleSegmentRef(),
      actionHandler: (_eventData, _transform, x, y) => {
        if (!canEditPoints(editable)) return false
        const segmentRef = resolveHandleSegmentRef()
        if (!segmentRef) return false
        setEditableSegmentControlPoint(editable, segmentRef, controlPoint, getLocalPointFromCanvas(editable, x, y))
        triggerKaleidoscopeContentSync(editable)
        syncObjProps()
        fabricCanvas?.requestRenderAll()
        return true
      },
      mouseUpHandler: () => {
        snapshot()
        return false
      },
      render: (ctx, left, top) => {
        if (!resolveHandleSegmentRef()) return
        renderCurveHandleControl(ctx, left, top, getViewportPointForEditablePoint(editable, anchorIndex))
      }
    } as Partial<Control> & { pointIndex: string })
  }

  function setSelectedDirectSegmentEditablePoints(obj: EditablePathObject, indices: number[]) {
    const segment = getSpecialDirectEditSegment(obj)
    if (!segment) return
    selectedSegmentRef.value = segment
    selectedPointIndices.value = normalizeSelectedPointIndices(obj, indices)
    syncObjProps()
    obj.canvas?.requestRenderAll()
  }

  function selectDirectSegmentEditablePoint(obj: EditablePathObject, pointIndex: number, multi = false) {
    const next = multi
      ? selectedPointIndices.value.includes(pointIndex)
        ? selectedPointIndices.value.filter((index) => index !== pointIndex)
        : [...selectedPointIndices.value, pointIndex]
      : [pointIndex]
    setSelectedDirectSegmentEditablePoints(obj, next)
  }

  function canEditDirectSegmentPoints(editable: EditablePathObject) {
    return canEditSegments(editable) && !!getSpecialDirectEditSegment(editable)
  }

  // 将选中点整体移动到网格对齐后的锚点，保持多点相对形状并同步清理旧端点吸附关系。
  function moveEditablePointsWithPixelGridSnap(editable: EditablePathObject, indices: number[], anchorIndex: number, scenePoint: Point) {
    moveEditablePoints(editable, indices, anchorIndex, getEditableLocalPointFromScene(editable, getPixelGridAdjustedScenePoint(scenePoint)))
    clearEndpointAttachmentsForPoints(editable, indices)
  }

  function createDirectSegmentPointControl(editable: EditablePathObject, index: number) {
    return new Control({
      actionName: 'modifyEditablePath',
      cursorStyle: 'crosshair',
      sizeX: 10,
      sizeY: 10,
      touchSizeX: 18,
      touchSizeY: 18,
      pointIndex: index,
      positionHandler: () => getViewportPointForEditablePoint(editable, index),
      getVisibility: () => canEditDirectSegmentPoints(editable),
      mouseDownHandler: (eventData) => {
        if (!canEditDirectSegmentPoints(editable)) return false
        selectDirectSegmentEditablePoint(editable, index, isMultiSelectModifierPressed(eventData as MouseEvent))
        return false
      },
      actionHandler: (_eventData, _transform, x, y) => {
        if (!canEditDirectSegmentPoints(editable)) return false
        const indices = normalizeSelectedPointIndices(editable, selectedPointIndices.value)
        const moveIndices = indices.includes(index) ? indices : [index]
        const scenePoint = new Point(x, y)
        if (moveIndices.length > 1) {
          moveEditablePointsWithPixelGridSnap(editable, moveIndices, index, scenePoint)
        } else {
          moveEndpointWithSnap(editable, index, scenePoint)
        }
        const segment = getSpecialDirectEditSegment(editable)
        if (segment) selectedSegmentRef.value = segment
        syncObjProps()
        triggerKaleidoscopeContentSync(editable)
        fabricCanvas?.requestRenderAll()
        return true
      },
      mouseUpHandler: () => {
        snapshot()
        return false
      },
      render: renderPointControl
    } as Partial<Control> & { pointIndex: number })
  }

  function attachPointControls(obj: FabricObject | null) {
    restorePointControls()
    if (!obj || !isEditablePathObject(obj) || getSelectableEditablePoints(obj).length === 0) return
    if (selectionMode.value === 'shape') return
    const editable = obj
    const showPointControlsInSegmentMode = selectionMode.value === 'segment' && !!getSpecialDirectEditSegment(editable)
    const controls: FabricControls = cloneCurrentControls(editable)
    const hideTransformControls = shouldHideTransformControlsInEditMode(editable)
    if (hideTransformControls) {
      hideFabricTransformControls(controls)
    }
    // 边选择模式下，不展示选点的辅助点，仅展示每条边的中点辅助器，方便直接点击边来选中
    if (selectionMode.value === 'segment') {
      getEditableSegments(editable).forEach((segmentRef) => {
        const key = `es${segmentRef.contourIndex}_${segmentRef.segmentIndex}`
        controls[key] = createSegmentSelectControl(editable, segmentRef)
      })
      if (showPointControlsInSegmentMode) {
        getSelectableEditablePoints(editable).forEach(({ index }) => {
          controls[`ep${index}`] = createDirectSegmentPointControl(editable, index)
        })
      }
    }
    else {
      getSelectableEditablePoints(editable).forEach(({ index }) => {
        controls[`ep${index}`] = new Control({
          actionName: 'modifyEditablePath',
          cursorStyle: 'crosshair',
          sizeX: 10,
          sizeY: 10,
          touchSizeX: 18,
          touchSizeY: 18,
          pointIndex: index,
          positionHandler: () => getViewportPointForEditablePoint(editable, index),
          mouseDownHandler: (eventData) => {
            if (!canEditPoints(editable)) return false
            beginPointControlGesture(editable, index, eventData as MouseEvent)
            return false
          },
          actionHandler: (_eventData, _transform, x, y) => {
            if (!canEditPoints(editable)) return false
            // 修饰键起拖：始终交给 mouse:move 切到 box-select；不做任何点位移动
            if (pointGestureState.modifierAtStart) {
              return true
            }
            // box-select 进行中：不移动点
            if (pointGestureState.kind === 'box-select') {
              return true
            }
            // 整组拖拽
            if (pointGestureState.kind === 'group-drag') {
              const indices = pointGestureState.initialSelection.length
                ? pointGestureState.initialSelection
                : [index]
              const scenePoint = new Point(x, y)
              moveEditablePointsWithPixelGridSnap(editable, indices, index, scenePoint)
              updateCurveControls()
              syncObjProps()
              triggerKaleidoscopeContentSync(editable)
              return true
            }
            // 单点拖拽
            if (pointGestureState.kind === 'single-drag') {
              moveEndpointWithSnap(editable, index, new Point(x, y))
              updateCurveControls()
              syncObjProps()
              triggerKaleidoscopeContentSync(editable)
              return true
            }
            // 仍处在 pending：等 mouse:move 越过阈值后决议手势类型
            return true
          },
          mouseUpHandler: () => {
            // 拖拽类手势完成后 snapshot；最终的选点决议由 mouse:up 全局回调统一处理
            if (
              pointGestureState.kind === 'single-drag'
              || pointGestureState.kind === 'group-drag'
            ) {
              snapshot()
            }
            return false
          },
          render: renderPointControl
        } as Partial<Control> & { pointIndex: number })
        // 与钢笔工具一致：锚点被选中时展示其入/出两个贝塞尔控制柄（可见性在控件内动态判定）
        controls[`epIn${index}`] = createAnchorCurveHandleControl(editable, index, 'in')
        controls[`epOut${index}`] = createAnchorCurveHandleControl(editable, index, 'out')
      })
    }
    controls.curveCp1 = createCurveHandleControl(editable, 'cp1')
    controls.curveCp2 = createCurveHandleControl(editable, 'cp2')
    installTemporaryControls(editable, controls, { hideBorders: hideTransformControls })
  }

  function applyBooleanPreviewStyle(preview: FabricObject, kind: 'kept' | 'removed', style: FabricBooleanStyleSnapshot) {
    const strokeWidth = getBooleanPreviewStrokeWidth(style)
    const stroke = getBooleanPreviewStrokeColor(style)
    preview.set({
      fill: 'transparent',
      stroke,
      strokeWidth,
      strokeDashArray: kind === 'removed' ? [strokeWidth * 3, strokeWidth * 2] : null,
      opacity: 1,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false
    })
    ;(preview as AnyFabricObject).booleanPreview = true
  }

  function restoreBooleanPreviewSourceObjects() {
    const hiddenObjects = booleanPreviewHiddenObjects.value
    booleanPreviewHiddenObjects.value = []
    hiddenObjects.forEach(({ object, visible }) => {
      object.set('visible', visible)
      object.setCoords()
    })
    return hiddenObjects.length > 0
  }

  function hideBooleanPreviewSourceObjects(objects: FabricObject[]) {
    restoreBooleanPreviewSourceObjects()
    const uniqueObjects = Array.from(new Set(objects))
    booleanPreviewHiddenObjects.value = uniqueObjects.map((object) => ({
      object,
      visible: object.visible !== false
    }))
    uniqueObjects.forEach((object) => {
      object.set('visible', false)
      object.setCoords()
    })
  }

  function nextBooleanPreviewToken() {
    booleanPreviewToken += 1
    return booleanPreviewToken
  }

  function handleSubtractPopoverShowChange(show: boolean) {
    subtractPopoverVisible.value = show
    if (!show) clearBooleanPreview()
  }

  function clearBooleanPreview(invalidate: boolean | Event = true) {
    const shouldInvalidate = typeof invalidate === 'boolean' ? invalidate : true
    if (shouldInvalidate) nextBooleanPreviewToken()
    const previews = booleanPreviewObjects.value
    const restoredSources = restoreBooleanPreviewSourceObjects()
    booleanPreviewObjects.value = []
    if (!fabricCanvas) return
    previews.forEach((preview) => {
      if (fabricCanvas.getObjects().includes(preview)) {
        fabricCanvas.remove(preview as AnyFabricObject)
      }
    })
    if (previews.length || restoredSources) {
      fabricCanvas.requestRenderAll()
    }
  }

  async function showBooleanPreview(operation: BooleanOperation, subtractDirection: SubtractDirection = 'forward') {
    if (!fabricCanvas || !canBoolean.value || booleanBusy.value) {
      clearBooleanPreview()
      return
    }

    const token = nextBooleanPreviewToken()
    const objects = fabricCanvas.getActiveObjects()
    const { result: computed, error } = await computeBooleanResult({
      canvas: fabricCanvas,
      operation,
      objects,
      subtractDirection,
      includePreviewRemovedPath: true
    })
    if (token !== booleanPreviewToken) {
      computed?.removedPath?.delete()
      computed?.path.delete()
      return
    }
    if (error || !computed) {
      clearBooleanPreview(false)
      return
    }

    try {
      const previews: FabricObject[] = []
      if (computed.removedPath) {
        const removedPreview = pathKitToFabricPath(computed.removedPath, {
          style: computed.style,
          preview: true
        })
        if (removedPreview) {
          applyBooleanPreviewStyle(removedPreview, 'removed', computed.style)
          previews.push(removedPreview)
        }
      }

      const keptPreview = pathKitToFabricPath(computed.path, {
        style: computed.style,
        preview: true
      })
      if (keptPreview) {
        applyBooleanPreviewStyle(keptPreview, 'kept', computed.style)
        previews.push(keptPreview)
      }

      if (token !== booleanPreviewToken) return
      clearBooleanPreview(false)
      if (!previews.length || !fabricCanvas) return
      hideBooleanPreviewSourceObjects(objects)
      previews.forEach((preview) => fabricCanvas.add(preview as AnyFabricObject))
      booleanPreviewObjects.value = previews
      fabricCanvas.requestRenderAll()
    } finally {
      computed.removedPath?.delete()
      computed.path.delete()
    }
  }

  function serializeFabricCanvas() {
    ensureCanvasObjectMetadata()
    return (fabricCanvas as any).toObject(SERIALIZED_OBJECT_PROPS as unknown as string[]) as Record<string, unknown>
  }

  function applyProjectLayerOrder(layerOrder: string[]) {
    if (!fabricCanvas || !layerOrder.length) return
    const orderMap = new Map(layerOrder.map((id, index) => [id, index]))
    const objects = fabricCanvas.getObjects().filter((obj) => !isBooleanPreviewObject(obj))
    const fallbackIndexMap = new Map(objects.map((obj, index) => [obj, index]))
    const sorted = [...objects].sort((a, b) => {
      const aId = String((a as AnyFabricObject).editorObjectId || '')
      const bId = String((b as AnyFabricObject).editorObjectId || '')
      const aOrder = orderMap.get(aId) ?? Number.MAX_SAFE_INTEGER
      const bOrder = orderMap.get(bId) ?? Number.MAX_SAFE_INTEGER
      if (aOrder !== bOrder) return aOrder - bOrder
      return (fallbackIndexMap.get(a) ?? 0) - (fallbackIndexMap.get(b) ?? 0)
    })
    sorted.forEach((obj, index) => fabricCanvas!.moveObjectTo(obj as AnyFabricObject, index))
  }

  // ── 对象样式辅助 ──
  function getStyleTargets(obj: FabricObject) {
    return obj instanceof Group ? obj.getObjects() : [obj]
  }

  function getSelectedPointRadiusState(obj: EditablePathObject) {
    const indices = normalizeSelectedPointIndices(obj, selectedPointIndices.value)
    if (!indices.length) {
      return { hasSelection: false, mixed: false, value: 0 }
    }
    const value = getPointRadius(obj, indices[0])
    const mixed = indices.some((index) => Math.abs(getPointRadius(obj, index) - value) > 0.0001)
    return { hasSelection: true, mixed, value }
  }

  // 预览浮层展开时立即刷新过期缩略图；关闭后保留 dirty 标记，等下次查看时再补齐。
  watch(previewPopoverVisible, (show) => {
    if (show && previewDirty.value) refreshSmallPreviews()
  })

  // 保留多对象选择结果，让图层面板可以批量选中万花筒实例后执行脱离、隐藏、锁定等操作。
  function applyActiveObjectsSelection(objects: FabricObject[], event?: MouseEvent) {
    if (!fabricCanvas) return
    const uniqueObjects = Array.from(new Set(objects))
      .filter((obj) => fabricCanvas!.getObjects().includes(obj))
    if (!uniqueObjects.length) {
      fabricCanvas.discardActiveObject(event)
      syncActiveObject(null)
      fabricCanvas.requestRenderAll()
      return
    }

    if (uniqueObjects.length === 1) {
      fabricCanvas.setActiveObject(uniqueObjects[0], event)
      syncActiveObject(fabricCanvas.getActiveObject() ?? uniqueObjects[0])
      fabricCanvas.requestRenderAll()
      return
    }
    const orderedObjects = fabricCanvas.getObjects().filter((obj) => uniqueObjects.includes(obj))
    const selection = new ActiveSelection(orderedObjects, { canvas: fabricCanvas })
    fabricCanvas.setActiveObject(selection, event)
    syncActiveObject(fabricCanvas.getActiveObject() ?? selection)
    fabricCanvas.requestRenderAll()
  }

  function isFillEnabled(fill: unknown) {
    if (fill == null) return false
    if (typeof fill !== 'string') return true
    const normalized = fill.trim().toLowerCase()
    return normalized !== '' && normalized !== 'none' && normalized !== 'transparent'
  }

  function isGradientFill(value: unknown): value is Gradient<Record<string, unknown>> {
    return value instanceof Gradient
  }

  function getGradientTarget(obj: FabricObject | null | undefined) {
    return obj ? (obj as AnyFabricObject) : null
  }

  function getGradientFillMode(obj: FabricObject | null | undefined): FillModeOption {
    const target = getGradientTarget(obj)
    if (!target) return 'solid'
    applyDefaultFillGradientMetadata(target)
    // fillMode 归一化后取值 solid/gradient/pattern，直接透传供面板判断当前模式。
    return target.fillMode
  }

  /**
   * 按对象当前的渐变元数据重建 fabric Gradient 填充。
   * 调用即代表元数据被界面/程序改动过，此时精确坐标快照不再可信，先清除再按角度/中心/半径重建；
   * MCP 生成的精确坐标渐变不经过此函数，因此快照得以保留并在保存/撤销后精确还原。
   */
  function applyGradientFillToTarget(target: FabricObject | null | undefined) {
    const typedTarget = getGradientTarget(target)
    if (!typedTarget) return false
    applyDefaultFillGradientMetadata(typedTarget)
    typedTarget.fillGradientCoords = undefined
    if (typedTarget.fillMode === 'gradient') {
      const gradient = createGradientFromMetadata(typedTarget)
      typedTarget.set('fill', gradient)
      return true
    }
    const solid = typeof typedTarget.lastFill === 'string' && typedTarget.lastFill.trim()
      ? typedTarget.lastFill
      : objProps.fill || '#000000'
    typedTarget.set('fill', solid)
    return false
  }

  function syncGradientPropsFromObject(obj: FabricObject | null | undefined) {
    const target = getGradientTarget(obj)
    if (!target) return
    applyDefaultFillGradientMetadata(target)
    // fillMode 透传 solid/gradient/pattern 三态（pattern 时渐变参数保留但不参与展示）。
    objProps.fillMode = target.fillMode
    objProps.fillGradientType = target.fillGradientType ?? DEFAULT_FILL_GRADIENT_TYPE
    objProps.fillGradientAngle = Number(target.fillGradientAngle ?? DEFAULT_FILL_GRADIENT_ANGLE) || DEFAULT_FILL_GRADIENT_ANGLE
    objProps.fillGradientAngleInput = formatNumericInputValue(objProps.fillGradientAngle)
    objProps.fillGradientStops = decorateGradientStops(target.fillGradientStops ?? [], objProps.fillGradientStops as UiFillGradientStop[])
    objProps.fillGradientCenterX = Number(target.fillGradientCenterX ?? 0.5) || 0.5
    objProps.fillGradientCenterY = Number(target.fillGradientCenterY ?? 0.5) || 0.5
    objProps.fillGradientRadius = Number(target.fillGradientRadius ?? DEFAULT_FILL_GRADIENT_RADIUS) || DEFAULT_FILL_GRADIENT_RADIUS
  }

  function rebuildObjectGradientFill(target: FabricObject | null | undefined) {
    if (!target) return
    if (target instanceof Group || target instanceof ActiveSelection) {
      target.getObjects().forEach((child) => rebuildObjectGradientFill(child))
      target.setCoords()
      return
    }
    if (getGradientFillMode(target) !== 'gradient') return
    applyGradientFillToTarget(target)
    target.dirty = true
    target.setCoords()
  }

  function applyGradientMetadataToCanvasObject(target: FabricObject | null | undefined) {
    if (!target) return
    applyDefaultFillGradientMetadata(target)
    rebuildObjectGradientFill(target)
  }

  function rehydrateCanvasGradientFills() {
    if (!fabricCanvas) return
    fabricCanvas.getObjects().forEach((obj) => applyGradientMetadataToCanvasObject(obj))
  }

  function isStrokeEnabled(stroke: unknown, strokeWidth: unknown) {
    if (stroke == null) return false
    if (typeof stroke === 'string') {
      const normalized = stroke.trim().toLowerCase()
      if (normalized === '' || normalized === 'none' || normalized === 'transparent') return false
    }
    return Number(strokeWidth ?? 0) > 0
  }

  function getObjectAspectRatio(obj: FabricObject) {
    const height = obj.getScaledHeight()
    const width = obj.getScaledWidth()
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1
    return width / height
  }

  /**
   * 将对象当前的宽高比例锁定状态同步到运行时与 Fabric 交互配置。
   * 这样无论对象来自新建、导入还是剪贴板恢复，属性面板与拖拽缩放都会基于对象自身状态保持一致。
   */
  function syncSizeRatioLockFromObject(obj: FabricObject | null | undefined) {
    const locked = isObjectSizeRatioLocked(obj)
    sizeRatioLocked.value = locked
    lockedAspectRatio.value = obj && locked ? getObjectAspectRatio(obj) : 1
    syncCanvasInteractionMode()
  }

  function collectAligningObjectsFromGroup(group: Group, objects: Set<FabricObject>, excludedObjects: Set<FabricObject>) {
    group.getObjects().forEach((child) => {
      if (excludedObjects.has(child) || child.visible === false || isBooleanPreviewObject(child)) return
      if (child instanceof Group) {
        collectAligningObjectsFromGroup(child, objects, excludedObjects)
        return
      }
      objects.add(child)
    })
  }

  function getAligningObjectsByTarget(target: FabricObject) {
    const objects = new Set<FabricObject>()
    const canvas = target.canvas
    if (!canvas) return objects

    const excludedObjects = new Set<FabricObject>(canvas.getActiveObjects())
    excludedObjects.add(target)
    if (target instanceof ActiveSelection) {
      target.getObjects().forEach((obj) => excludedObjects.add(obj))
    }

    canvas.forEachObject((obj) => {
      if (obj.visible === false || !obj.isOnScreen() || excludedObjects.has(obj) || isBooleanPreviewObject(obj)) return
      if (obj instanceof Group) {
        collectAligningObjectsFromGroup(obj, objects, excludedObjects)
        return
      }
      objects.add(obj)
    })

    return objects
  }

  function scaleObjectToDisplaySize(obj: FabricObject, width: number, height: number) {
    const currentWidth = obj.getScaledWidth()
    const currentHeight = obj.getScaledHeight()
    if (currentWidth > 0) obj.set('scaleX', (obj.scaleX ?? 1) * (width / currentWidth))
    if (currentHeight > 0) obj.set('scaleY', (obj.scaleY ?? 1) * (height / currentHeight))
  }

  function toggleSizeRatioLock() {
    const obj = activeObject.value
    const nextLocked = !sizeRatioLocked.value
    sizeRatioLocked.value = nextLocked
    if (obj) {
      markObjectSizeRatioLocked(obj, nextLocked)
      lockedAspectRatio.value = nextLocked ? getObjectAspectRatio(obj) : 1
    } else if (!nextLocked) {
      lockedAspectRatio.value = 1
    }
    syncCanvasInteractionMode()
  }

  // ── 同步选中对象属性 ──
  function getSegmentPickTolerance(obj: EditablePathObject) {
    const scaling = obj.getTotalObjectScaling()
    const maxScale = Math.max(Math.abs(scaling.x), Math.abs(scaling.y), 1)
    return 10 / maxScale
  }

  function handleSegmentPointerDown(sceneX: number, sceneY: number) {
    const obj = activeEditablePathObject.value
    if (!obj || selectionMode.value !== 'segment' || getArrowRenderMode(obj) === 'hollow-shaft') return false
    const segmentRef = getEditableSegmentByLocalPoint(
      obj,
      getRawLocalPointFromCanvas(obj, sceneX, sceneY),
      getSegmentPickTolerance(obj)
    )
    if (!segmentRef) return false
    setSelectedEditableSegment(obj, segmentRef)
    updateCurveControls()
    return true
  }

  // ── 节点编辑：锚点插入 / 删除 ──

  /**
   * 节点编辑（点位）模式下双击线段插入锚点：
   * - 直线段线性插值、曲线段按最近点参数做 de Casteljau 分割，曲线形状保持不变；
   * - 插入后新锚点直接进入选中态，可直接拖拽；
   * - 一次插入 = 一条撤销记录（snapshot 在全部状态刷新后统一调用）。
   * 返回是否已处理该双击。
   */
  function handlePointModeDoubleClick(scenePoint: Point) {
    const obj = activeEditablePathObject.value
    if (!obj || !fabricCanvas || selectionMode.value !== 'point' || !hasEditablePoints.value) return false
    const localPoint = getRawLocalPointFromCanvas(obj, scenePoint.x, scenePoint.y)
    const segmentRef = getEditableSegmentByLocalPoint(obj, localPoint, getSegmentPickTolerance(obj))
    if (!segmentRef) return false
    // 空芯箭头依赖"两点开放轮廓"的专用渲染结构，不允许插点破坏
    if (getArrowRenderMode(obj) === 'hollow-shaft' && !segmentRef.contour.closed && segmentRef.contour.points.length === 2) {
      showToast('当前空芯箭头不支持插入锚点', 'warning')
      return true
    }
    const param = getContourSegmentParameterAt(segmentRef.contour, segmentRef.segmentIndex, localPoint)
    if (!param) return false
    const insertedGlobalIndex = insertEditablePointOnObjectSegment(obj, segmentRef, param.t)
    if (insertedGlobalIndex == null) return false
    // 插点后点索引整体移位，端点吸附关系失效，统一清除避免残留旧索引
    clearAllEndpointAttachments(obj)
    setSelectedEditablePoints(obj, [insertedGlobalIndex])
    updateCurveControls()
    triggerKaleidoscopeContentSync(obj)
    refreshEditablePathMetadata()
    refreshLayers()
    fabricCanvas.requestRenderAll()
    snapshot()
    syncObjProps()
    return true
  }

  /**
   * 节点编辑（点位）模式下删除已选锚点（支持多选）：
   * - 闭合轮廓最少保留 3 点、开放轮廓最少保留 2 点，不足时 toast 提示并保持原状；
   * - 被删锚点两侧段合并为一段（控制柄取舍策略见 removeEditablePointsFromContour）；
   * - 一次删除（含多点）= 一条撤销记录。
   * 返回 true 表示键盘事件已被消费（无论是否真的删除），用于拦截"删除整个对象"的全局快捷键。
   */
  function deleteSelectedEditablePoints() {
    const obj = activeEditablePathObject.value
    if (!obj || selectionMode.value !== 'point' || !hasSelectedPoint.value) return false
    const indices = normalizeSelectedPointIndices(obj, selectedPointIndices.value)
    if (!indices.length) return false
    if (!removeEditablePointsFromObject(obj, indices)) {
      showToast('锚点数量已达下限，无法继续删除', 'warning')
      return true
    }
    // 删点后点索引整体移位，端点吸附关系失效，统一清除避免残留旧索引
    clearAllEndpointAttachments(obj)
    setSelectedEditablePoints(obj, [])
    updateCurveControls()
    triggerKaleidoscopeContentSync(obj)
    refreshEditablePathMetadata()
    refreshLayers()
    fabricCanvas?.requestRenderAll()
    snapshot()
    syncObjProps()
    return true
  }

  function syncObjProps() {
    const obj = activeObject.value
    if (!obj) return
    applyDefaultKaleidoscopeMetadata(obj)
    applyDefaultRotation3DMetadata(obj)
    objProps.left = obj.left ?? 0
    objProps.top = obj.top ?? 0
    objProps.leftInput = formatNumericInputValue(objProps.left)
    objProps.topInput = formatNumericInputValue(objProps.top)
    objProps.width = obj.getScaledWidth()
    objProps.height = obj.getScaledHeight()
    objProps.widthInput = formatNumericInputValue(objProps.width)
    objProps.heightInput = formatNumericInputValue(objProps.height)
    objProps.scaleX = obj.scaleX ?? 1
    objProps.scaleY = obj.scaleY ?? 1
    const rotation3d = getRotation3DMetadata(obj)
    objProps.rotateX = rotation3d?.rotateX ?? 0
    objProps.rotateY = rotation3d?.rotateY ?? 0
    objProps.angle = rotation3d?.rotateZ ?? 0  // 从 metadata 读取原始 Z 轴角度
    // 翻转回显读意图元数据：原生 flipX/flipY 混入了 3D 旋转投影的镜像成分，
    // 按钮激活态应只反映用户是否点过翻转
    objProps.flipX = rotation3d?.rotation3dFlipX === true
    objProps.flipY = rotation3d?.rotation3dFlipY === true
    objProps.rotateXInput = formatNumericInputValue(objProps.rotateX)
    objProps.rotateYInput = formatNumericInputValue(objProps.rotateY)
    objProps.angleInput = formatNumericInputValue(objProps.angle)
    objProps.opacity = obj.opacity ?? 1
    objProps.endpointSnapMargin = getObjectEndpointSnapMargin(obj)
    objProps.endpointSnapMarginInput = formatNumericInputValue(objProps.endpointSnapMargin)

    const panelSource = activeKaleidoscopePanelSource.value
    if (panelSource) {
      initializeKaleidoscopeSource(panelSource)
      const center = getKaleidoscopeEffectiveCenter(panelSource)
      objProps.kaleidoscopeEnabled = getKaleidoscopeMetadata(panelSource)?.kaleidoscopeEnabled === true
      objProps.kaleidoscopeCenterXInput = formatKaleidoscopeInputValue(center.x)
      objProps.kaleidoscopeCenterYInput = formatKaleidoscopeInputValue(center.y)
      objProps.kaleidoscopeFollowRotation = getKaleidoscopeMetadata(panelSource)?.kaleidoscopeFollowRotation === true
      objProps.kaleidoscopeCountInput = String(getKaleidoscopeCount(panelSource))
    } else {
      resetKaleidoscopeProps()
    }

    const targets = getStyleTargets(obj)
    const first = targets[0]
    const fill = first?.fill
    const enabled = isFillEnabled(fill)
    objProps.fillEnabled = enabled
    objProps.fill = enabled && typeof fill === 'string'
      ? fill
      : typeof (first as AnyFabricObject | undefined)?.lastFill === 'string'
        ? (first as AnyFabricObject).lastFill
        : '#000000'
    syncGradientPropsFromObject(first)
    // 同步图案填充回显状态：fill 为 fabric Pattern 时面板显示来源名/平铺方式/缩放（无缩略图）。
    const patternState = readPatternFillState(first)
    objProps.fillPatternRepeat = patternState.repeat
    objProps.fillPatternScale = patternState.scale
    objProps.fillPatternSourceName = patternState.name || (patternState.source ? '自定义图片' : '')
    objProps.stroke = first && typeof first.stroke === 'string'
      ? first.stroke
      : typeof (first as AnyFabricObject | undefined)?.lastStroke === 'string'
        ? (first as AnyFabricObject).lastStroke
        : '#333333'
    objProps.strokeWidth = first?.strokeWidth ?? (first as AnyFabricObject | undefined)?.lastStrokeWidth ?? 0
    objProps.strokeWidthInput = formatNumericInputValue(objProps.strokeWidth)
    objProps.strokeEnabled = isStrokeEnabled(first?.stroke, first?.strokeWidth)
    const currentStrokeDashArray = normalizeStrokeDashArray(first?.strokeDashArray)
    const rememberedStrokeDashArray = getStrokeDashPair(first)
    objProps.strokeLineType = currentStrokeDashArray ? 'dashed' : 'solid'
    objProps.strokeDashLength = rememberedStrokeDashArray[0]
    objProps.strokeDashGap = rememberedStrokeDashArray[1]
    objProps.strokeDashLengthInput = String(rememberedStrokeDashArray[0])
    objProps.strokeDashGapInput = String(rememberedStrokeDashArray[1])

    if (isEditablePathObject(obj)) {
      if (selectionMode.value === 'shape') {
        clearEditableAssistSelection()
      } else if (selectionMode.value === 'point') {
        clearSelectedSegment()
      } else if (!getSpecialDirectEditSegment(obj)) {
        clearSelectedPoint()
      }
      objProps.cornerRadius = obj.cornerRadius ?? 0
      const pointRadiusState = getSelectedPointRadiusState(obj)
      objProps.pointCornerRadius = pointRadiusState.value
      objProps.cornerRadiusInput = String(Math.round(objProps.cornerRadius))
      objProps.pointCornerRadiusInput = pointRadiusState.hasSelection
        ? pointRadiusState.mixed
          ? ''
          : String(Math.round(pointRadiusState.value))
        : '0'

      const arrowLength = arrowAggregated.value.length
      objProps.arrowLengthInput = arrowLength == null
        ? ''
        : String(Math.round(arrowLength))
      objProps.arrowLineWidth = isHollowShaftArrow.value ? getHollowShaftArrowLineWidth(obj) : 0
      objProps.arrowLineWidthInput = isHollowShaftArrow.value
        ? formatNumericInputValue(objProps.arrowLineWidth)
        : '0'
      objProps.arrowTipAngle = isHollowShaftArrow.value ? getHollowShaftArrowTipAngle(obj) : 0
      objProps.arrowSideAngle = isHollowShaftArrow.value ? getHollowShaftArrowSideAngle(obj) : 0
      objProps.arrowTipAngleInput = isHollowShaftArrow.value ? formatNumericInputValue(objProps.arrowTipAngle) : '0'
      objProps.arrowSideAngleInput = isHollowShaftArrow.value ? formatNumericInputValue(objProps.arrowSideAngle) : '0'

      const segmentRef = isHollowShaftArrow.value ? null : selectedEditableSegment.value
      const segment = getLiveEditableSegment(segmentRef)
      objProps.curveEnabled = !isHollowShaftArrow.value && segment?.type === 'cubic'
      if (segmentRef && segment) {
        const cp1 = getEditableSegmentControlPoint(segmentRef, 'cp1')
        const cp2 = getEditableSegmentControlPoint(segmentRef, 'cp2')
        objProps.curveCp1XInput = formatNumericInputValue(cp1.x)
        objProps.curveCp1YInput = formatNumericInputValue(cp1.y)
        objProps.curveCp2XInput = formatNumericInputValue(cp2.x)
        objProps.curveCp2YInput = formatNumericInputValue(cp2.y)
      } else {
        resetCurveProps()
      }
    } else {
      objProps.cornerRadius = 0
      objProps.pointCornerRadius = 0
      objProps.arrowLineWidth = 0
      objProps.arrowTipAngle = 0
      objProps.arrowSideAngle = 0
      objProps.cornerRadiusInput = '0'
      objProps.pointCornerRadiusInput = '0'
      objProps.arrowLengthInput = '16'
      objProps.arrowLineWidthInput = '0'
      objProps.arrowTipAngleInput = '0'
      objProps.arrowSideAngleInput = '0'
      resetCurveProps()
    }

    // 同步阴影效果。属性面板的 ZInput 是受控组件：model-value 不回写时键入会被重置回原值，
    // 因此为数值字段附带可写的输入缓冲字符串（offsetXInput 等），键入期间由面板更新缓冲，change 时才提交数值。
    applyDefaultShadowEffectsMetadata(obj)
    const shadowMetadata = getShadowEffectsMetadata(obj)
    objProps.shadowEffects = shadowMetadata?.shadowEffects
      ? shadowMetadata.shadowEffects.map(effect => ({
          ...effect,
          offsetXInput: formatNumericInputValue(effect.offsetX),
          offsetYInput: formatNumericInputValue(effect.offsetY),
          blurInput: formatNumericInputValue(effect.blur)
        }))
      : []

    // 同步混合模式（所有对象通用；fabric 的 source-over 对外展示为 normal）。
    objProps.blendMode = compositeOperationToBlendMode(obj.globalCompositeOperation)

    // 同步位图滤镜状态：仅位图对象有滤镜列表，并附带面板渲染所需的文案与参数滑杆配置；
    // 面板每行 = 一种滤镜（开关 + 可选参数滑杆），禁用条目也回显以便再次启用时保留参数。
    objProps.bitmapFilters = obj instanceof FabricImage
      ? decorateBitmapFilterSettings(readBitmapFilterSettings(obj))
      : []

    // 同步文本专属属性：目标是选中集合中的全部文本对象（单选文本或多选/编组中的文本子对象），
    // 回显取第一个文本对象；无文本目标时重置默认值，面板据 objProps 是否有文本目标决定显隐。
    const textTargets = getTextTargets(obj)
    if (textTargets.length) {
      const textTarget = textTargets[0]
      objProps.fontFamily = typeof textTarget.fontFamily === 'string' && textTarget.fontFamily.trim()
        ? textTarget.fontFamily
        : DEFAULT_TEXT_FONT_FAMILY
      objProps.fontSize = Number(textTarget.fontSize) || 24
      objProps.fontSizeInput = formatNumericInputValue(objProps.fontSize)
      objProps.fontBold = isBoldFontWeight(textTarget.fontWeight)
      objProps.fontItalic = textTarget.fontStyle === 'italic'
      objProps.fontUnderline = textTarget.underline === true
      objProps.fontLinethrough = textTarget.linethrough === true
      objProps.charSpacing = Number(textTarget.charSpacing) || 0
      objProps.charSpacingInput = formatNumericInputValue(objProps.charSpacing)
      objProps.lineHeight = Number(textTarget.lineHeight) || 1.16
      objProps.lineHeightInput = formatNumericInputValue(objProps.lineHeight)
      objProps.textAlign = typeof textTarget.textAlign === 'string' ? textTarget.textAlign : 'left'
    } else {
      resetTextProps()
    }
  }

  /** 把文本属性面板回显重置为默认值（选中集合不含文本对象时调用）。 */
  function resetTextProps() {
    objProps.fontFamily = DEFAULT_TEXT_FONT_FAMILY
    objProps.fontSize = 24
    objProps.fontSizeInput = '24'
    objProps.fontBold = false
    objProps.fontItalic = false
    objProps.fontUnderline = false
    objProps.fontLinethrough = false
    objProps.charSpacing = 0
    objProps.charSpacingInput = '0'
    objProps.lineHeight = 1.16
    objProps.lineHeightInput = '1.16'
    objProps.textAlign = 'left'
  }

  /** 解析当前对象内的全部文本目标：单选文本返回自身，多选/编组返回其中所有文本子对象。 */
  function getTextTargets(obj: FabricObject): Textbox[] {
    const candidates = obj instanceof Group ? obj.getObjects() : [obj]
    return candidates.filter((candidate): candidate is Textbox => candidate instanceof Textbox)
  }

  /** 判断字重值是否为粗体：'bold' 或数值 ≥ 600（fabric 字重兼容字符串与数字两种形态）。 */
  function isBoldFontWeight(weight: unknown) {
    if (weight === 'bold') return true
    const parsed = Number(weight)
    return Number.isFinite(parsed) && parsed >= 600
  }

  /** 把滤镜设置装饰为面板行数据：按固定顺序补齐全部 7 种滤镜（缺失类型生成禁用态默认行）并附滑杆配置。 */
  function decorateBitmapFilterSettings(settings: BitmapFilterSetting[]) {
    return BITMAP_FILTER_TYPES.map((type) => {
      const setting = settings.find((candidate) => candidate.type === type) ?? createDefaultBitmapFilterSetting(type, false)
      const paramConfig = BITMAP_FILTER_PARAM_CONFIG[type]
      return {
        ...setting,
        label: BITMAP_FILTER_LABELS[type],
        paramKey: paramConfig?.key ?? null,
        paramLabel: paramConfig ? BITMAP_FILTER_PARAM_LABELS[paramConfig.key] : '',
        paramMin: paramConfig?.min ?? 0,
        paramMax: paramConfig?.max ?? 1
      }
    })
  }

  // ── 属性设置 ──
  function setObjProp(prop: string, value: any) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    if (prop === 'fill') {
      // 渐变实例分支：MCP/程序化设置渐变时保留精确坐标元数据，界面面板通过近似角度/中心/半径展示。
      const gradientValue = value instanceof Gradient ? value : null
      getStyleTargets(obj).forEach((target) => {
        const typedTarget = target as AnyFabricObject
        if (gradientValue) {
          typedTarget.fillMode = 'gradient'
          const stopColor = gradientValue.colorStops?.[0]?.color
          typedTarget.lastFill = typeof stopColor === 'string' && stopColor.trim()
            ? stopColor
            : (typeof typedTarget.lastFill === 'string' ? typedTarget.lastFill : '#000000')
          target.set('fill', gradientValue)
          syncFillGradientMetadataFromGradient(typedTarget, gradientValue)
        } else {
          typedTarget.fillMode = 'solid'
          typedTarget.lastFill = value
          target.set('fill', value)
        }
        target.dirty = true
        target.setCoords()
      })
      objProps.fillEnabled = true
      objProps.fillMode = gradientValue ? 'gradient' : 'solid'
    } else if (prop === 'stroke') {
      getStyleTargets(obj).forEach((target) => {
        ;(target as AnyFabricObject).lastStroke = value
        target.set('stroke', value)
        target.dirty = true
        target.setCoords()
      })
      objProps.strokeEnabled = true
    } else if (prop === 'strokeWidth') {
      getStyleTargets(obj).forEach((target) => {
        const typedTarget = target as AnyFabricObject
        typedTarget.lastStrokeWidth = value
        target.set('strokeWidth', value)
        typedTarget.lastStrokeDashArray = normalizeStrokeDashArray(typedTarget.lastStrokeDashArray)
          ?? getDefaultStrokeDashArray(value)
        target.dirty = true
        target.setCoords()
      })
      objProps.strokeEnabled = Number(value) > 0
      objProps.strokeWidthInput = formatNumericInputValue(Number(value) || 0)
    } else if (prop === 'shadow') {
      // 阴影分支：接受 fabric Shadow 实例或普通对象（fabric 会自动包装），null/undefined 清除阴影；
      // 同步 shadowEffects 元数据保证属性面板与序列化状态一致。
      const shadowValue = value && typeof value === 'object' && !(value instanceof Shadow)
        ? new Shadow(value as Record<string, unknown>)
        : (value instanceof Shadow ? value : null)
      obj.set('shadow', shadowValue)
      const shadowMetadata = getShadowEffectsMetadata(obj)
      if (shadowMetadata) {
        const current = obj.shadow
        shadowMetadata.shadowEffects = current
          ? [{
              ...createDefaultShadowEffect(),
              offsetX: Number(current.offsetX ?? 0),
              offsetY: Number(current.offsetY ?? 0),
              blur: Math.max(0, Number(current.blur ?? 0)),
              spread: 0,
              color: typeof current.color === 'string' && current.color.trim() ? current.color : 'rgba(0, 0, 0, 0.25)'
            }]
          : []
      }
    } else if (prop === 'rotateX' || prop === 'rotateY') {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return
      const normalized = normalizeRotation3DAngle(parsed)
      const target = getRotation3DMetadata(obj)
      if (!target) return

      // 确保 rotateZ 已初始化，避免在调整 X/Y 时丢失 Z 轴角度
      if (target.rotateZ === undefined) {
        target.rotateZ = objProps.angle ?? 0
      }

      if (prop === 'rotateX') {
        target.rotateX = normalized
        objProps.rotateX = normalized
        objProps.rotateXInput = formatNumericInputValue(normalized)
      } else {
        target.rotateY = normalized
        objProps.rotateY = normalized
        objProps.rotateYInput = formatNumericInputValue(normalized)
      }

      applyRotation3DTransformToObject(obj)
    } else if (prop === 'angle') {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return
      const normalized = normalizeRotation3DAngle(parsed)
      const target = getRotation3DMetadata(obj)
      if (target) {
        target.rotateZ = normalized  // 存储原始 Z 轴角度到 metadata
      }
      objProps.angle = normalized
      objProps.angleInput = formatNumericInputValue(normalized)
      applyRotation3DTransformToObject(obj)
    } else if (prop === 'cornerRadius') {
      // 圆角需要按当前本体几何重建 path，直接 set 属性只会改数值不会重算圆角。
      const parsed = Number(value)
      const radius = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
      if (isEditablePathObject(obj)) {
        setObjectCornerRadius(obj, radius)
      } else {
        obj.set('cornerRadius', radius)
      }
    } else {
      obj.set(prop as any, value)
      // 文本布局属性（text/fontSize 等）：fabric Text.set 命中 textLayoutProperties 时已自动
      // initDimensions + setCoords；这里显式补一次幂等刷新作为防御，覆盖未来可能绕过
      // Text.set 的程序化赋值路径，保证包围盒与换行始终随内容更新。
      if (obj instanceof Text && TEXT_LAYOUT_PROPS.includes(prop)) {
        obj.initDimensions()
      }
    }
    if (obj instanceof Group && (prop === 'fill' || prop === 'stroke' || prop === 'strokeWidth')) {
      obj.triggerLayout()
    }
    if (prop === 'left' || prop === 'top' || prop === 'angle') {
      clearOwnedEndpointAttachmentsForTransformedObject(obj)
    }
    obj.dirty = true
    obj.setCoords()
    syncEndpointsForChangedObject(obj)
    if (prop === 'fill' || prop === 'stroke' || prop === 'strokeWidth' || prop === 'opacity' || prop === 'cornerRadius' || prop === 'shadow') {
      triggerKaleidoscopeContentSync(obj)
    } else {
      triggerKaleidoscopeTransformSync(obj)
    }
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  // 将对象位置输入提交为数值，非法输入回退到当前坐标
  function setObjPropFromInput(prop: 'left' | 'top' | 'rotateX' | 'rotateY' | 'angle', value: string | number) {
    let fallback: number
    if (prop === 'left') fallback = objProps.left
    else if (prop === 'top') fallback = objProps.top
    else if (prop === 'rotateX') fallback = objProps.rotateX
    else if (prop === 'rotateY') fallback = objProps.rotateY
    else fallback = objProps.angle

    commitNumericInput(
      value,
      fallback,
      (next) => { setObjProp(prop, next) },
      (next) => {
        if (prop === 'left') objProps.leftInput = formatNumericInputValue(Number(next))
        else if (prop === 'top') objProps.topInput = formatNumericInputValue(Number(next))
        else if (prop === 'rotateX') objProps.rotateXInput = formatNumericInputValue(Number(next))
        else if (prop === 'rotateY') objProps.rotateYInput = formatNumericInputValue(Number(next))
        else objProps.angleInput = formatNumericInputValue(Number(next))
      }
    )
  }

  function setEndpointSnapMargin(value: number) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas || obj instanceof ActiveSelection) return
    const next = normalizeEndpointSnapMargin(value)
    const target = getEndpointSnapMarginMetadata(obj)
    if (!target) return
    target.endpointSnapMargin = next
    objProps.endpointSnapMargin = next
    objProps.endpointSnapMarginInput = formatNumericInputValue(next)
    obj.dirty = true
    obj.setCoords()
    const endpointsTouched = syncEndpointsForChangedObject(obj)
    if (isKaleidoscopeSource(obj)) {
      const contentSynced = syncKaleidoscopeContent(obj)
      if (contentSynced) syncEndpointsForChangedObject(obj)
    }
    fabricCanvas.requestRenderAll()
    refreshLayers()
    if (endpointsTouched) refreshEditablePathMetadata()
    snapshot()
    syncObjProps()
  }

  function setEndpointSnapMarginFromInput(value: string | number) {
    commitNumericInput(
      value,
      objProps.endpointSnapMargin,
      setEndpointSnapMargin,
      (next) => { objProps.endpointSnapMarginInput = formatNumericInputValue(normalizeEndpointSnapMargin(next)) }
    )
  }

  function setCornerRadius(value: number) {
    const obj = activeEditablePathObject.value
    if (!obj || !fabricCanvas) return
    setObjectCornerRadius(obj, value)
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setCornerRadiusFromInput(value: string | number) {
    commitNumericInput(
      value,
      objProps.cornerRadius,
      setCornerRadius,
      (next) => { objProps.cornerRadiusInput = next }
    )
  }

  function setSelectedPointCornerRadius(value: number) {
    const obj = activeEditablePathObject.value
    const pointIndices = normalizeSelectedPointIndices(obj!, selectedPointIndices.value)
    if (!obj || !pointIndices.length || !fabricCanvas) return
    if (pointIndices.length === 1) {
      setPointCornerRadius(obj, pointIndices[0], value)
    } else {
      setPointsCornerRadius(obj, pointIndices, value)
    }
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setSelectedPointCornerRadiusFromInput(value: string | number) {
    if (normalizeInputValue(value) === '' && selectedPointIndices.value.length > 1) {
      syncObjProps()
      return
    }
    commitNumericInput(
      value,
      objProps.pointCornerRadius,
      setSelectedPointCornerRadius,
      (next) => { objProps.pointCornerRadiusInput = next }
    )
  }

  function ensureFillForSolidArrow(obj: EditablePathObject) {
    if (!pathHasSolidArrowHead(obj)) return
    const target = obj as AnyFabricObject
    const stroke = typeof target.stroke === 'string' ? target.stroke : ''
    if (!isFillEnabled(stroke)) return
    if (isFillEnabled(target.fill)) return
    target.set('fill', stroke)
    target.autoFillForSolidArrow = true
  }

  function clearAutoFillForHollowArrow(obj: EditablePathObject) {
    const target = obj as AnyFabricObject
    if (pathHasSolidArrowHead(obj)) return
    if (!target.autoFillForSolidArrow) return
    if (isFillEnabled(target.fill)) target.lastFill = target.fill
    target.set('fill', 'transparent')
    target.autoFillForSolidArrow = false
  }

  function applyArrowChange(partial: Partial<ArrowHead>) {
    const obj = activeEditablePathObject.value
    const indices = selectedArrowEndpointIndices.value
    if (!obj || !indices.length || !fabricCanvas) return
    setEditablePointsArrowHead(obj, indices, partial)
    refreshEditablePathMetadata()
    if (getArrowRenderMode(obj) === 'hollow-shaft') {
      clearAutoFillForHollowArrow(obj)
    } else if (partial.shape === 'hollow' || partial.enabled === false) {
      clearAutoFillForHollowArrow(obj)
    } else {
      ensureFillForSolidArrow(obj)
    }
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function toggleSelectedArrowEnabled(enabled: boolean) {
    applyArrowChange({ enabled: !!enabled })
  }

  function setSelectedArrowShape(shape: ArrowHeadShape) {
    if (isHollowShaftArrow.value) return
    applyArrowChange({ shape })
  }

  function setSelectedArrowAngle(angle: number) {
    if (isHollowShaftArrow.value || !Number.isFinite(angle)) return
    applyArrowChange({ angle: Math.max(15, Math.min(150, angle)) })
  }

  function setSelectedArrowLength(length: number) {
    if (!Number.isFinite(length)) return
    applyArrowChange({ length: Math.max(0, length) })
  }

  function setSelectedArrowLengthFromInput(value: string | number) {
    const trimmed = normalizeInputValue(value)
    if (trimmed === '' && selectedArrowEndpointIndices.value.length > 1) {
      syncObjProps()
      return
    }
    const fallback = arrowAggregated.value.length ?? 16
    commitNumericInput(
      value,
      fallback,
      setSelectedArrowLength,
      (next) => { objProps.arrowLengthInput = next }
    )
  }

  function setHollowArrowLineWidth(lineWidth: number) {
    const obj = activeEditablePathObject.value
    if (!obj || !fabricCanvas || getArrowRenderMode(obj) !== 'hollow-shaft' || !Number.isFinite(lineWidth)) return
    ;(obj as AnyFabricObject).arrowLineWidth = Math.max(0, lineWidth)
    refreshEditablePathMetadata()
    rebuildEditablePathObjectFromPoint(obj, 0)
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setHollowArrowTipAngle(angle: number) {
    const obj = activeEditablePathObject.value
    if (!obj || !fabricCanvas || getArrowRenderMode(obj) !== 'hollow-shaft' || !Number.isFinite(angle)) return
    ;(obj as AnyFabricObject).arrowTipAngle = Math.max(15, Math.min(165, angle))
    refreshEditablePathMetadata()
    rebuildEditablePathObjectFromPoint(obj, 0)
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setHollowArrowSideAngle(angle: number) {
    const obj = activeEditablePathObject.value
    if (!obj || !fabricCanvas || getArrowRenderMode(obj) !== 'hollow-shaft' || !Number.isFinite(angle)) return
    ;(obj as AnyFabricObject).arrowSideAngle = Math.max(15, Math.min(90, angle))
    refreshEditablePathMetadata()
    rebuildEditablePathObjectFromPoint(obj, 0)
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setHollowArrowLineWidthFromInput(value: string | number) {
    const obj = activeEditablePathObject.value
    if (!obj || getArrowRenderMode(obj) !== 'hollow-shaft') return
    const fallback = getHollowShaftArrowLineWidth(obj)
    commitNumericInput(
      value,
      fallback,
      setHollowArrowLineWidth,
      (next) => { objProps.arrowLineWidthInput = next }
    )
  }

  function updateCurveControls() {
    const shapeObj = activeObject.value
    if (shapeObj && selectionMode.value === 'shape') {
      attachKaleidoscopeCenterControl(shapeObj)
      shapeObj.canvas?.requestRenderAll()
      return
    }

    const obj = activeEditablePathObject.value
    if (!obj) {
      restorePointControls()
      fabricCanvas?.requestRenderAll()
      return
    }
    if (selectionMode.value !== 'point' && selectionMode.value !== 'segment') {
      restorePointControls()
      obj.canvas?.requestRenderAll()
      return
    }
    attachPointControls(obj)
    obj.canvas?.requestRenderAll()
  }

  function setSelectedSegmentCurveEnabled(enabled: boolean) {
    const obj = activeEditablePathObject.value
    const segmentRef = selectedEditableSegment.value
    if (!obj || getArrowRenderMode(obj) === 'hollow-shaft' || !segmentRef || !fabricCanvas) return
    setEditableSegmentType(obj, segmentRef, enabled ? 'cubic' : 'line')
    triggerKaleidoscopeContentSync(obj)
    // 重新解析为最新的 segmentRef，避免后续操作引用过期数据
    const liveSegmentRef = resolveEditableSegmentRef(obj, segmentRef)
    if (liveSegmentRef) selectedSegmentRef.value = liveSegmentRef
    updateCurveControls()
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setSelectedSegmentControlPoint(controlPoint: CurveControlPointKey, nextPoint: EditablePoint) {
    const obj = activeEditablePathObject.value
    const segmentRef = selectedEditableSegment.value
    if (!obj || getArrowRenderMode(obj) === 'hollow-shaft' || !segmentRef || !fabricCanvas) return
    setEditableSegmentControlPoint(obj, segmentRef, controlPoint, nextPoint)
    triggerKaleidoscopeContentSync(obj)
    // 操作后路径数据已更新，刷新 segmentRef 以引用最新模型
    const liveSegmentRef = resolveEditableSegmentRef(obj, segmentRef)
    if (liveSegmentRef) selectedSegmentRef.value = liveSegmentRef
    updateCurveControls()
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setSelectedSegmentControlPointCoord(controlPoint: CurveControlPointKey, axis: 'x' | 'y', value: number) {
    const segmentRef = selectedEditableSegment.value
    if (!segmentRef) return
    const point = getEditableSegmentControlPoint(segmentRef, controlPoint)
    setSelectedSegmentControlPoint(controlPoint, {
      ...point,
      [axis]: value
    })
  }

  function setSelectedSegmentControlPointCoordFromInput(
    controlPoint: CurveControlPointKey,
    axis: 'x' | 'y',
    value: string | number
  ) {
    const segmentRef = selectedEditableSegment.value
    if (!segmentRef) return
    const point = getEditableSegmentControlPoint(segmentRef, controlPoint)
    const fallback = axis === 'x' ? point.x : point.y
    const key = `curve${controlPoint === 'cp1' ? 'Cp1' : 'Cp2'}${axis.toUpperCase()}Input` as const
    commitNumericInput(
      value,
      fallback,
      (next) => { setSelectedSegmentControlPointCoord(controlPoint, axis, next) },
      (next) => { objProps[key] = next }
    )
  }

  function setStrokeWidthFromInput(value: string | number) {
    commitNumericInput(
      value,
      objProps.strokeWidth,
      (next) => { setObjProp('strokeWidth', next) },
      (next) => { objProps.strokeWidthInput = next }
    )
  }

  function setStrokeLineType(value: string) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const nextType: StrokeLineType = value === 'dashed' ? 'dashed' : 'solid'
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      if (nextType === 'solid') {
        const activeDash = normalizeStrokeDashArray(target.strokeDashArray)
        if (activeDash) typedTarget.lastStrokeDashArray = activeDash
        target.set('strokeDashArray', null)
      } else {
        const nextDash = normalizeStrokeDashArray(typedTarget.lastStrokeDashArray)
          ?? getDefaultStrokeDashArray(target.strokeWidth ?? objProps.strokeWidth)
        typedTarget.lastStrokeDashArray = nextDash
        target.set('strokeDashArray', nextDash)
      }
      target.dirty = true
      target.setCoords()
    })
    if (obj instanceof Group) obj.triggerLayout()
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setStrokeDashValue(index: 0 | 1, value: number) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const nextValue = Number.isFinite(value) && value > 0 ? value : (index === 0 ? objProps.strokeDashLength : objProps.strokeDashGap)
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      const nextDash = [...getStrokeDashPair(target)] as [number, number]
      nextDash[index] = nextValue
      typedTarget.lastStrokeDashArray = nextDash
      if (normalizeStrokeDashArray(target.strokeDashArray)) {
        target.set('strokeDashArray', nextDash)
      }
      target.dirty = true
      target.setCoords()
    })
    if (obj instanceof Group) obj.triggerLayout()
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setStrokeDashLengthFromInput(value: string | number) {
    commitNumericInput(
      value,
      objProps.strokeDashLength,
      (next) => { setStrokeDashValue(0, Math.max(1, next)) },
      (next) => {
        const normalized = String(Math.max(1, Number(next) || objProps.strokeDashLength))
        objProps.strokeDashLengthInput = normalized
      }
    )
  }

  function setStrokeDashGapFromInput(value: string | number) {
    commitNumericInput(
      value,
      objProps.strokeDashGap,
      (next) => { setStrokeDashValue(1, Math.max(1, next)) },
      (next) => {
        const normalized = String(Math.max(1, Number(next) || objProps.strokeDashGap))
        objProps.strokeDashGapInput = normalized
      }
    )
  }

  function toggleFill(enabled: boolean) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    getStyleTargets(obj).forEach((target) => {
      const t = target as AnyFabricObject
      applyDefaultFillGradientMetadata(t)
      if (enabled) {
        if (t.fillMode === 'gradient') applyGradientFillToTarget(target)
        else if (t.fillMode === 'pattern' && !restorePatternFillSync(t)) void restorePatternFillAsync(t)
        else target.set('fill', t.lastFill || objProps.fill || '#000000')
      } else {
        if (typeof target.fill === 'string' && isFillEnabled(target.fill)) t.lastFill = target.fill
        target.set('fill', 'transparent')
      }
      target.dirty = true
      target.setCoords()
    })
    if (obj instanceof Group) obj.triggerLayout()
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function updateFillGradientStops(mutator: (stops: FillGradientStop[]) => FillGradientStop[]) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      applyDefaultFillGradientMetadata(typedTarget)
      typedTarget.fillMode = 'gradient'
      typedTarget.fillGradientStops = mutator(cloneFillGradientStops(typedTarget.fillGradientStops))
      applyGradientFillToTarget(target)
      target.dirty = true
      target.setCoords()
    })
    objProps.fillEnabled = true
    objProps.fillMode = 'gradient'
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setSolidFillColor(value: string) {
    setObjProp('fill', value)
  }

  // ── 图案填充（fabric Pattern fill）──
  /**
   * 生成内置默认图案的 dataURL：8×8 棋盘格。
   * 切换到"图案"模式但尚未上传图片时用它即时生效，避免面板空转；
   * dataURL 随 Pattern 原生序列化持久化，撤销/保存后可完整还原。
   */
  function createDefaultPatternSourceDataURL(): string {
    const size = 8
    const cell = document.createElement('canvas')
    cell.width = size
    cell.height = size
    const ctx = cell.getContext('2d')
    if (!ctx) return ''
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#9aa4b2'
    ctx.fillRect(0, 0, size / 2, size / 2)
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2)
    return cell.toDataURL('image/png')
  }

  /**
   * 对当前对象的全部样式目标应用图案填充（来源/平铺/缩放可部分覆盖，缺省沿用对象元数据）：
   * 来源优先级为入参 > 对象元数据 > 内置默认棋盘格；图片元素经缓存加载后构建 Pattern
   * （字符串 source 无法序列化，必须以图片元素作为 Pattern.source），整体提交一条撤销记录。
   */
  async function applyPatternFillToTargets(overrides: { source?: string; name?: string; repeat?: PatternFillRepeat; scale?: number } = {}) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const targets = getStyleTargets(obj)
    const first = targets[0] as AnyFabricObject | undefined
    if (!first) return
    applyDefaultFillGradientMetadata(first)
    applyDefaultPatternFillMetadata(first)
    const source = overrides.source?.trim() || first.fillPatternSrc || createDefaultPatternSourceDataURL()
    const repeat = overrides.repeat ?? first.fillPatternRepeat ?? DEFAULT_PATTERN_FILL_REPEAT
    const scale = overrides.scale ?? first.fillPatternScale ?? DEFAULT_PATTERN_FILL_SCALE
    const name = overrides.name ?? first.fillPatternName ?? (overrides.source ? '自定义图片' : '默认图案')
    let pattern: Pattern
    try {
      pattern = await createPatternFromSource(source, repeat, scale)
    } catch {
      showToast('图案图片加载失败，请更换图片后重试', 'error')
      return
    }
    const resolveLastFill = (typed: AnyFabricObject) =>
      typeof typed.lastFill === 'string' && typed.lastFill.trim() && typed.lastFill.toLowerCase() !== 'transparent'
        ? typed.lastFill
        : null
    const fallbackLastFill = resolveLastFill(first) ?? '#000000'
    targets.forEach((target) => {
      const typed = target as AnyFabricObject
      applyDefaultFillGradientMetadata(typed)
      applyDefaultPatternFillMetadata(typed)
      typed.fillMode = 'pattern'
      typed.fillPatternSrc = source
      typed.fillPatternName = name
      typed.fillPatternRepeat = repeat
      typed.fillPatternScale = scale
      // 保证后续"清除图案回纯色/切回纯色模式"有可用底色。
      if (!resolveLastFill(typed)) typed.lastFill = fallbackLastFill
      // 缓存 Pattern 实例（不序列化），填充开关重新打开时同步恢复，避免异步加载与撤销快照产生时序差。
      typed.lastPattern = pattern
      typed.set('fill', pattern)
      typed.dirty = true
      typed.setCoords()
    })
    objProps.fillEnabled = true
    objProps.fillMode = 'pattern'
    objProps.fillPatternRepeat = repeat
    objProps.fillPatternScale = scale
    objProps.fillPatternSourceName = name
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  /**
   * 从对象缓存的 Pattern 实例同步恢复图案填充（fill 开关重新打开等场景）：
   * 命中缓存立即生效（随后的撤销快照能同步捕捉到图案状态），未命中返回 false 交由异步路径。
   */
  function restorePatternFillSync(target: FabricObject): boolean {
    const cached = (target as AnyFabricObject).lastPattern
    if (!(cached instanceof Pattern)) return false
    target.set('fill', cached)
    target.dirty = true
    target.setCoords()
    return true
  }

  /**
   * 从对象元数据异步恢复图案填充（同步缓存未命中的兜底）：
   * 加载失败时回退 lastFill 纯色，避免对象停留在透明状态。
   */
  async function restorePatternFillAsync(target: FabricObject) {
    applyDefaultPatternFillMetadata(target)
    const metadata = getPatternFillMetadata(target)
    const source = metadata?.fillPatternSrc
    if (!source || !fabricCanvas) {
      target.set('fill', (target as AnyFabricObject).lastFill || '#000000')
      target.dirty = true
      target.setCoords()
      fabricCanvas?.requestRenderAll()
      return
    }
    try {
      const repeat = metadata?.fillPatternRepeat ?? DEFAULT_PATTERN_FILL_REPEAT
      const scale = metadata?.fillPatternScale ?? DEFAULT_PATTERN_FILL_SCALE
      target.set('fill', await createPatternFromSource(source, repeat, scale))
    } catch {
      target.set('fill', (target as AnyFabricObject).lastFill || '#000000')
    }
    target.dirty = true
    target.setCoords()
    fabricCanvas.requestRenderAll()
  }

  /**
   * 面板：上传本地图片作为图案来源（File → dataURL），应用后入撤销栈。
   * 兼容直接传 File 与 input change 事件两种形态；处理后重置 input.value，同一文件可重复选择。
   */
  async function setPatternFillFromFile(input: Event | File | null | undefined) {
    const file = input instanceof File
      ? input
      : ((input as Event | null | undefined)?.target as HTMLInputElement | null | undefined)?.files?.[0] ?? null
    if (!(input instanceof File) && input?.target) {
      ;(input.target as HTMLInputElement).value = ''
    }
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件（PNG/JPG/SVG 等）', 'warning')
      return
    }
    try {
      const source = await readFileAsDataURL(file)
      await applyPatternFillToTargets({ source, name: file.name.replace(/\.[^.]+$/, '') })
    } catch {
      showToast('读取图片内容失败', 'error')
    }
  }

  /** 面板：切换图案平铺方式（repeat/repeat-x/repeat-y/no-repeat），change 提交并入撤销栈。 */
  function setPatternFillRepeat(value: string) {
    const repeat = normalizePatternFillRepeat(value)
    if (!repeat) return
    void applyPatternFillToTargets({ repeat })
  }

  /** 面板：调整图案缩放倍数（滑杆 change 提交），入撤销栈。 */
  function setPatternFillScale(value: number) {
    const scale = normalizePatternFillScale(value)
    if (scale === null) return
    void applyPatternFillToTargets({ scale })
  }

  // ── 位图裁剪（面板入口，实际会话逻辑在 homeCrop 模块）──
  /** 面板：对当前选中的单个位图进入裁剪模式；先回到图形模式，避免点/边模式的选区守卫干扰裁剪会话。 */
  function beginBitmapCrop() {
    if (selectionMode.value !== 'shape') setSelectionMode('shape')
    cropCommands.beginCropSession()
  }

  /** 面板：确认裁剪（一条撤销记录），面板随 cropModeActive 复位。 */
  function confirmBitmapCrop() {
    cropCommands.confirmCropSession()
  }

  /** 面板：取消裁剪（图片完整恢复进入裁剪前状态，不留撤销记录）。 */
  function cancelBitmapCrop() {
    cropCommands.cancelCropSession()
    syncObjProps()
  }

  /**
   * MCP set_pattern_fill 的运行时实现：对指定对象应用或清除图案填充。
   * source 为 null 时清除图案（fillMode 回 solid、fill 回 lastFill）；
   * 其余参数语义与面板一致。调用方负责撤销快照的挂起与提交。
   */
  async function applyPatternFillRequestToObject(
    target: FabricObject,
    request: { source: string | null; repeat?: PatternFillRepeat; scale?: number }
  ) {
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    const targets = getStyleTargets(target)
    if (!targets.length) throw new Error('目标对象没有可填充的子对象')
    if (request.source === null) {
      targets.forEach((item) => {
        const typed = item as AnyFabricObject
        applyDefaultFillGradientMetadata(typed)
        applyDefaultPatternFillMetadata(typed)
        typed.fillMode = 'solid'
        typed.fillPatternSrc = ''
        typed.fillPatternName = ''
        typed.fillPatternRepeat = DEFAULT_PATTERN_FILL_REPEAT
        typed.fillPatternScale = DEFAULT_PATTERN_FILL_SCALE
        typed.set('fill', typeof typed.lastFill === 'string' && typed.lastFill.trim() && typed.lastFill.toLowerCase() !== 'transparent' ? typed.lastFill : '#000000')
        typed.dirty = true
        typed.setCoords()
      })
      if (target instanceof Group) target.triggerLayout?.()
      target.dirty = true
      target.setCoords()
      fabricCanvas.requestRenderAll()
      syncObjProps()
      return
    }
    const repeat = request.repeat ?? DEFAULT_PATTERN_FILL_REPEAT
    const scale = normalizePatternFillScale(request.scale ?? DEFAULT_PATTERN_FILL_SCALE) ?? DEFAULT_PATTERN_FILL_SCALE
    let pattern: Pattern
    try {
      pattern = await createPatternFromSource(request.source, repeat, scale)
    } catch {
      throw new Error(`图案图片加载失败，请确认 source 是可访问的 dataURL 或 http(s) 图片 URL`)
    }
    targets.forEach((item) => {
      const typed = item as AnyFabricObject
      applyDefaultFillGradientMetadata(typed)
      applyDefaultPatternFillMetadata(typed)
      typed.fillMode = 'pattern'
      typed.fillPatternSrc = request.source as string
      typed.fillPatternName = 'MCP 图案'
      typed.fillPatternRepeat = repeat
      typed.fillPatternScale = scale
      typed.set('fill', pattern)
      typed.lastPattern = pattern
      typed.dirty = true
      typed.setCoords()
    })
    if (target instanceof Group) target.triggerLayout?.()
    target.dirty = true
    target.setCoords()
    fabricCanvas.requestRenderAll()
    syncObjProps()
  }

  /**
   * MCP crop_image 的运行时实现：把"图片当前显示包围盒坐标系"中的裁剪矩形
   * （angle=0 语义，与对象摘要 bboxLeft/bboxTop 同一坐标系）换算为源像素区域并应用裁剪。
   * 参数越界/面积过小抛中文错误；调用方负责撤销快照的挂起与提交。
   */
  function cropImageToDisplayRect(target: FabricObject, rect: BitmapCropRect) {
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    if (!(target instanceof FabricImage)) {
      throw new Error('目标对象不是位图（FabricImage），裁剪仅对位图对象生效')
    }
    const sourceRect = computeBitmapCropFromDisplayRect(target, rect)
    applyBitmapCropSourceRect(target, sourceRect)
    target.setCoords()
    triggerKaleidoscopeContentSync(target)
    fabricCanvas.requestRenderAll()
    syncObjProps()
  }

  function setFillStyleMode(mode: 'solid' | FillGradientType | 'pattern') {
    if (mode === 'solid') {
      setFillMode('solid')
      return
    }
    if (mode === 'pattern') {
      setFillMode('pattern')
      return
    }
    setFillGradientTypeValue(mode)
  }

  function setFillMode(mode: FillModeOption) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    if (mode === 'pattern') {
      // 切到图案模式：无来源时以内置默认棋盘格即时生效（可撤销），随后面板展示上传/平铺/缩放。
      void applyPatternFillToTargets()
      return
    }
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      applyDefaultFillGradientMetadata(typedTarget)
      typedTarget.fillMode = mode
      if (mode === 'gradient') applyGradientFillToTarget(target)
      else target.set('fill', typedTarget.lastFill || objProps.fill || '#000000')
      target.dirty = true
      target.setCoords()
    })
    objProps.fillEnabled = true
    objProps.fillMode = mode
    triggerKaleidoscopeContentSync(obj)
    updateCurveControls()
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setFillGradientTypeValue(value: FillGradientType) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      applyDefaultFillGradientMetadata(typedTarget)
      typedTarget.fillMode = 'gradient'
      typedTarget.fillGradientType = value
      applyGradientFillToTarget(target)
      target.dirty = true
      target.setCoords()
    })
    objProps.fillMode = 'gradient'
    objProps.fillGradientType = value
    triggerKaleidoscopeContentSync(obj)
    updateCurveControls()
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setFillGradientStopColor(index: number, color: string) {
    updateFillGradientStops((stops) => {
      if (!stops[index]) return stops
      stops[index] = { ...stops[index], color }
      return stops
    })
  }

  function reorderFillGradientStops() {
    const reorderedStops = objProps.fillGradientStops.map(({ color, offset }) => ({ color, offset }))
    const offsetSlots = getNormalizedGradientOffsetSlots(reorderedStops, objProps.fill || '#000000')
    updateFillGradientStops(() => reorderedStops.map((stop, index) => ({
      ...stop,
      offset: offsetSlots[index] ?? stop.offset
    })))
  }

  function setFillGradientStopOffset(index: number, value: string | number) {
    updateFillGradientStops((stops) => {
      if (!stops[index]) return stops
      if (index === 0 || index === stops.length - 1) return stops
      const fallback = Math.round(stops[index].offset * 100)
      const min = Math.round(stops[index - 1].offset * 100)
      const max = Math.round(stops[index + 1].offset * 100)
      const nextPercent = normalizeGradientOffsetPercentInput(value, fallback, min, max)
      stops[index] = { ...stops[index], offset: nextPercent / 100 }
      return stops
    })
  }

  function setFillGradientStopOffsetFromInput(index: number, value: string | number) {
    const numValue = parseFloat(String(value))
    if (Number.isFinite(numValue)) {
      setFillGradientStopOffset(index, numValue)
    }
  }

  function addFillGradientStop() {
    updateFillGradientStops((stops) => {
      if (stops.length < 2) return [...stops, { color: objProps.fill || '#000000', offset: 1 }]
      const prev = stops[stops.length - 2]
      const next = stops[stops.length - 1]
      return [
        ...stops.slice(0, -1),
        { color: next.color, offset: (prev.offset + next.offset) / 2 },
        next
      ].sort((a, b) => a.offset - b.offset)
    })
  }

  function removeFillGradientStop(index: number) {
    updateFillGradientStops((stops) => stops.filter((_, stopIndex) => stopIndex !== index))
  }

  function setFillGradientAngleValue(value: number) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      applyDefaultFillGradientMetadata(typedTarget)
      typedTarget.fillMode = 'gradient'
      typedTarget.fillGradientType = 'linear'
      typedTarget.fillGradientAngle = value
      applyGradientFillToTarget(target)
      target.dirty = true
      target.setCoords()
    })
    objProps.fillMode = 'gradient'
    objProps.fillGradientType = 'linear'
    objProps.fillGradientAngle = value
    objProps.fillGradientAngleInput = formatNumericInputValue(value)
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function setFillGradientAngleFromInput() {
    const value = parseFloat(objProps.fillGradientAngleInput)
    if (Number.isFinite(value)) {
      const normalized = ((value % 360) + 360) % 360
      setFillGradientAngleValue(normalized)
    }
  }

  function setFillGradientRadiusValue(value: number) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const normalized = normalizeFillGradientRadiusInput(value)
    getStyleTargets(obj).forEach((target) => {
      const typedTarget = target as AnyFabricObject
      applyDefaultFillGradientMetadata(typedTarget)
      typedTarget.fillMode = 'gradient'
      typedTarget.fillGradientType = 'radial'
      typedTarget.fillGradientRadius = normalized
      applyGradientFillToTarget(target)
      target.dirty = true
      target.setCoords()
    })
    objProps.fillMode = 'gradient'
    objProps.fillGradientType = 'radial'
    objProps.fillGradientRadius = normalized
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }


  function toggleStroke(enabled: boolean) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    getStyleTargets(obj).forEach((target) => {
      const t = target as AnyFabricObject
      if (enabled) {
        target.set({
          stroke: t.lastStroke || objProps.stroke || '#333333',
          strokeWidth: (t.lastStrokeWidth ?? objProps.strokeWidth) || 2
        })
        t.lastStrokeDashArray = normalizeStrokeDashArray(t.lastStrokeDashArray)
          ?? getDefaultStrokeDashArray(t.lastStrokeWidth ?? objProps.strokeWidth)
      } else {
        if (isStrokeEnabled(target.stroke, target.strokeWidth)) {
          t.lastStroke = target.stroke
          t.lastStrokeWidth = target.strokeWidth
        }
        target.set('strokeWidth', 0)
      }
      target.dirty = true
      target.setCoords()
    })
    if (obj instanceof Group) obj.triggerLayout()
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function addShadowEffect() {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const metadata = getShadowEffectsMetadata(obj)
    if (!metadata) return
    applyDefaultShadowEffectsMetadata(obj)
    const newEffect = createDefaultShadowEffect()
    if (!metadata.shadowEffects) metadata.shadowEffects = []
    metadata.shadowEffects.push(newEffect)
    applyShadowEffectsToFabricObject(obj)
    obj.dirty = true
    obj.setCoords()
    fabricCanvas.requestRenderAll()
    syncObjProps()
    snapshot()
  }

  function toggleShadowEffect(index: number, enabled: boolean) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const metadata = getShadowEffectsMetadata(obj)
    if (!metadata?.shadowEffects?.[index]) return
    metadata.shadowEffects[index].enabled = enabled
    applyShadowEffectsToFabricObject(obj)
    obj.dirty = true
    obj.setCoords()
    fabricCanvas.requestRenderAll()
    syncObjProps()
    snapshot()
  }

  function setShadowEffectProp(index: number, prop: string, value: any) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const metadata = getShadowEffectsMetadata(obj)
    if (!metadata?.shadowEffects?.[index]) return
    const effect = metadata.shadowEffects[index]
    if (prop === 'offsetX' || prop === 'offsetY') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        ;(effect as any)[prop] = parsed
      }
    } else if (prop === 'blur') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed >= 0) {
        effect.blur = parsed
      }
    } else if (prop === 'color') {
      effect.color = String(value)
    }
    applyShadowEffectsToFabricObject(obj)
    obj.dirty = true
    obj.setCoords()
    fabricCanvas.requestRenderAll()
    syncObjProps()
    snapshot()
  }

  function removeShadowEffect(index: number) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const metadata = getShadowEffectsMetadata(obj)
    if (!metadata?.shadowEffects) return
    metadata.shadowEffects.splice(index, 1)
    applyShadowEffectsToFabricObject(obj)
    obj.dirty = true
    obj.setCoords()
    fabricCanvas.requestRenderAll()
    syncObjProps()
    snapshot()
  }

  /**
   * 设置选中对象的混合模式（所有对象类型通用）：
   * mode 为对外约定的混合模式名（normal 表示正常），内部换算为 fabric 的
   * globalCompositeOperation 后落值，提交一条撤销记录并同步面板状态。
   */
  function setObjectBlendMode(mode: string) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const normalized = normalizeBlendMode(mode)
    if (!normalized) return
    obj.set('globalCompositeOperation', blendModeToCompositeOperation(normalized))
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  // ── 文本属性 ──
  /** 影响文本换行与宽高的属性集合：这些属性落值后必须调用 initDimensions() 重算布局。 */
  const TEXT_LAYOUT_PROPS = ['text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'charSpacing', 'lineHeight', 'textAlign']

  /** 文本数值属性的合法区间：字号 6-500、字间距 -200~800（千分之一 em）、行高 0.5-3。 */
  const TEXT_NUMERIC_PROP_RANGES: Record<'fontSize' | 'charSpacing' | 'lineHeight', { min: number; max: number; integers: boolean }> = {
    fontSize: { min: 6, max: 500, integers: true },
    charSpacing: { min: -200, max: 800, integers: true },
    lineHeight: { min: 0.5, max: 3, integers: false }
  }

  /** 把文本数值属性收敛到面板合法区间（字号/字间距取整，行高保留两位小数）。 */
  function normalizeTextNumericProp(prop: 'fontSize' | 'charSpacing' | 'lineHeight', value: number) {
    const range = TEXT_NUMERIC_PROP_RANGES[prop]
    const clamped = Math.max(range.min, Math.min(range.max, value))
    return range.integers ? Math.round(clamped) : Math.round(clamped * 100) / 100
  }

  /**
   * 应用文本属性到选中集合内的全部文本目标（单选文本或多选/编组中的文本子对象，
   * 与填充/描边的多目标应用策略一致）。文本布局属性命中 fabric Text.set 的
   * textLayoutProperties 时会自动重算换行与宽高，这里再显式补一次幂等的
   * initDimensions() + setCoords() 防御，随后走统一的渲染/图层/撤销/面板同步收尾
   * （提交时机与 setObjProp 一致）。
   */
  function setTextProp(prop: string, value: unknown) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const targets = getTextTargets(obj)
    if (!targets.length) return
    targets.forEach((target) => {
      target.set(prop as any, value)
      if (TEXT_LAYOUT_PROPS.includes(prop)) {
        target.initDimensions()
      }
      target.dirty = true
      target.setCoords()
    })
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  /**
   * 提交文本数值输入（fontSize/charSpacing/lineHeight，change 时机）：
   * 非法输入回退当前值，越界值收敛到面板合法区间；与现有数值输入提交模式一致，
   * 键入期间输入缓冲由面板维护，这里先回显再应用。
   */
  function setTextPropFromInput(prop: 'fontSize' | 'charSpacing' | 'lineHeight', value: string | number) {
    const fallback = prop === 'fontSize' ? objProps.fontSize : prop === 'charSpacing' ? objProps.charSpacing : objProps.lineHeight
    commitNumericInput(
      value,
      fallback,
      (next) => { setTextProp(prop, normalizeTextNumericProp(prop, next)) },
      (next) => {
        if (prop === 'fontSize') objProps.fontSizeInput = next
        else if (prop === 'charSpacing') objProps.charSpacingInput = next
        else objProps.lineHeightInput = next
      }
    )
  }

  /** 切换粗体：开时写入字重 700，关时回落 400（不覆盖对象原有的具体字重档位语义）。 */
  function toggleTextBold() {
    setTextProp('fontWeight', objProps.fontBold ? 400 : 700)
  }

  /** 切换斜体：italic 与 normal 互切。 */
  function toggleTextItalic() {
    setTextProp('fontStyle', objProps.fontItalic ? 'normal' : 'italic')
  }

  /** 切换下划线。 */
  function toggleTextUnderline() {
    setTextProp('underline', !objProps.fontUnderline)
  }

  /** 切换删除线。 */
  function toggleTextLinethrough() {
    setTextProp('linethrough', !objProps.fontLinethrough)
  }

  /** 设置段内对齐（面板三态按钮：left/center/right）。 */
  function setTextAlign(align: 'left' | 'center' | 'right') {
    setTextProp('textAlign', align)
  }

  /**
   * 更新文本对象的内容与排版属性（MCP update_text 的运行时入口）：
   * updates 的键为 text/fontSize/fontFamily/fontWeight/fontStyle/charSpacing/
   * lineHeight/textAlign/underline/linethrough，逐键 set 落值（fabric Text.set 命中
   * textLayoutProperties 时自动重算换行与宽高，这里再显式补一次幂等刷新防御），
   * 目标非文本对象时抛中文错误，撤销快照由调用方挂起/提交。
   */
  function updateTextObject(target: FabricObject, updates: Record<string, unknown>) {
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    if (!(target instanceof Text)) {
      throw new Error(`仅文本对象支持更新文本属性，当前对象类型为: ${target.type ?? 'unknown'}`)
    }
    for (const [prop, value] of Object.entries(updates)) {
      target.set(prop as any, value)
    }
    target.initDimensions()
    target.dirty = true
    target.setCoords()
    fabricCanvas.requestRenderAll()
    refreshLayers()
  }

  /**
   * 开关当前位图的某一滤镜（离散动作）：启用未配置过的滤镜时取该类型默认参数，
   * 禁用仅改标记（参数保留，再次启用不丢失）。每次开关单独提交一条撤销记录。
   */
  function toggleImageFilter(type: string, enabled: boolean) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas || !(obj instanceof FabricImage)) return
    const filterType = BITMAP_FILTER_TYPES.includes(type as BitmapFilterType) ? (type as BitmapFilterType) : null
    if (!filterType) return
    const current = readBitmapFilterSettings(obj)
    const next = current.some((setting) => setting.type === filterType)
      ? current.map((setting) => (setting.type === filterType ? { ...setting, enabled } : setting))
      : [...current, createDefaultBitmapFilterSetting(filterType, enabled)]
    applyBitmapFilterSettings(obj, next)
    obj.setCoords()
    fabricCanvas.requestRenderAll()
    syncObjProps()
    snapshot()
  }

  /**
   * 调整当前位图某滤镜的参数（滑杆 change 提交）：与现有透明度/渐变角度等滑杆控件
   * 的撤销时机保持一致——每次 change 应用一次并提交一条撤销记录；调参隐含启用该滤镜
   * （面板中参数滑杆仅在启用态可见），未配置过的滤镜按默认参数创建后落值。
   */
  function setImageFilterParam(type: string, paramKey: BitmapFilterParamKey, value: number) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas || !(obj instanceof FabricImage)) return
    const filterType = BITMAP_FILTER_TYPES.includes(type as BitmapFilterType) ? (type as BitmapFilterType) : null
    if (!filterType) return
    const clamped = clampBitmapFilterParam(filterType, paramKey, value)
    if (clamped === undefined) return
    const current = readBitmapFilterSettings(obj)
    const base = current.find((setting) => setting.type === filterType)
      ?? createDefaultBitmapFilterSetting(filterType, true)
    const next = [
      ...current.filter((setting) => setting.type !== filterType),
      { ...base, enabled: true, [paramKey]: clamped } as BitmapFilterSetting
    ]
    applyBitmapFilterSettings(obj, next)
    obj.setCoords()
    fabricCanvas.requestRenderAll()
    syncObjProps()
    snapshot()
  }

  /**
   * 整体替换目标位图的滤镜设置列表（MCP apply_image_filter 的运行时实现）：
   * settings 归一化后写入 bitmapFilters 元数据并重建原生滤镜（仅启用项渲染）；
   * blendMode 提供时同时设置混合模式。调用方负责撤销快照的挂起与提交。
   */
  function applyImageFilterToObject(target: FabricObject, settings: unknown, blendMode?: string) {
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    if (!(target instanceof FabricImage)) {
      throw new Error('目标对象不是位图（FabricImage），滤镜仅对位图对象生效')
    }
    applyBitmapFilterSettings(target, normalizeBitmapFilterSettings(settings))
    if (blendMode !== undefined) {
      const normalized = normalizeBlendMode(blendMode)
      if (!normalized) {
        throw new Error(`blendMode 非法: ${blendMode}。必须是 normal/multiply/screen/overlay/darken/lighten/color-dodge/difference/exclusion/hue/saturation/color/luminosity 之一`)
      }
      target.set('globalCompositeOperation', blendModeToCompositeOperation(normalized))
    }
    target.dirty = true
    target.setCoords()
    fabricCanvas.requestRenderAll()
    syncObjProps()
  }

  /**
   * 翻转当前对象（axis 为 x 水平翻 / y 垂直翻）。
   *
   * 翻转意图写入 rotation3dFlipX/Y 元数据后统一走 applyRotation3DTransformToObject
   * 重算物理变换（与 3D 旋转投影 XOR 叠加），而非只改原生 flipX/flipY——原生值
   * 会在拖拽/缩放松手时的投影重算中被覆盖，导致翻转"失效变回去"。
   */
  function flipObject(axis: 'x' | 'y') {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const target = getRotation3DMetadata(obj)
    if (!target) return
    applyDefaultRotation3DMetadata(target)
    if (axis === 'x') {
      target.rotation3dFlipX = !(target.rotation3dFlipX === true)
    } else {
      target.rotation3dFlipY = !(target.rotation3dFlipY === true)
    }
    applyRotation3DTransformToObject(obj)
    obj.dirty = true
    obj.setCoords()
    if (obj instanceof Group) obj.triggerLayout()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    syncObjProps()
    snapshot()
  }

  function resetTransform() {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    obj.set({
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      skewX: 0,
      skewY: 0,
      flipX: false,
      flipY: false
    })
    clearRotation3DMetadata(obj)
    obj.dirty = true
    obj.setCoords()
    if (obj instanceof Group) obj.triggerLayout()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    syncObjProps()
    snapshot()
  }

  function setRotate3DFromInput(axis: 'x' | 'y', value: string | number) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    const normalized = normalizeRotation3DAngle(parsed)
    const target = getRotation3DMetadata(obj)
    if (!target) return

    // 确保 rotateZ 已初始化，避免在调整 X/Y 时丢失 Z 轴角度
    if (target.rotateZ === undefined) {
      target.rotateZ = objProps.angle ?? 0
    }

    if (axis === 'x') {
      target.rotateX = normalized
      objProps.rotateX = normalized
      objProps.rotateXInput = formatNumericInputValue(normalized)
    } else {
      target.rotateY = normalized
      objProps.rotateY = normalized
      objProps.rotateYInput = formatNumericInputValue(normalized)
    }

    applyRotation3DTransformToObject(obj)
    obj.dirty = true
    obj.setCoords()
    if (obj instanceof Group) obj.triggerLayout()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function copyStyle() {
    const obj = activeObject.value
    if (!obj) return
    const targets = getStyleTargets(obj)
    const first = targets[0]
    if (!first) return

    const metadata = getFillGradientMetadata(first)
    const shadowMetadata = getShadowEffectsMetadata(first)

    copiedStyle.value = {
      fill: first.fill,
      fillMode: metadata?.fillMode,
      fillGradientType: metadata?.fillGradientType,
      fillGradientStops: metadata?.fillGradientStops ? [...metadata.fillGradientStops] : undefined,
      fillGradientAngle: metadata?.fillGradientAngle,
      fillGradientCenterX: metadata?.fillGradientCenterX,
      fillGradientCenterY: metadata?.fillGradientCenterY,
      fillGradientRadius: metadata?.fillGradientRadius,
      fillGradientCoords: metadata?.fillGradientCoords ? { ...metadata.fillGradientCoords } : undefined,
      stroke: first.stroke,
      strokeWidth: first.strokeWidth,
      strokeDashArray: first.strokeDashArray ? [...first.strokeDashArray] : null,
      opacity: first.opacity,
      shadowEffects: shadowMetadata?.shadowEffects ? [...shadowMetadata.shadowEffects] : undefined
    }
    showToast('样式已复制', 'success')
  }

  function pasteStyle() {
    const obj = activeObject.value
    if (!obj || !fabricCanvas || !copiedStyle.value) return

    const style = copiedStyle.value
    const targets = getStyleTargets(obj)

    targets.forEach((target) => {
      const anyTarget = target as AnyFabricObject

      // 应用填充
      if (style.fill !== undefined) {
        target.set('fill', style.fill)
        anyTarget.lastFill = typeof style.fill === 'string' ? style.fill : undefined
      }

      // 应用填充渐变元数据
      const metadata = getFillGradientMetadata(target)
      if (metadata) {
        if (style.fillMode) metadata.fillMode = style.fillMode
        if (style.fillGradientType) metadata.fillGradientType = style.fillGradientType
        if (style.fillGradientStops) metadata.fillGradientStops = [...style.fillGradientStops]
        if (style.fillGradientAngle !== undefined) metadata.fillGradientAngle = style.fillGradientAngle
        if (style.fillGradientCenterX !== undefined) metadata.fillGradientCenterX = style.fillGradientCenterX
        if (style.fillGradientCenterY !== undefined) metadata.fillGradientCenterY = style.fillGradientCenterY
        if (style.fillGradientRadius !== undefined) metadata.fillGradientRadius = style.fillGradientRadius
        // 精确坐标快照随复制样式一起粘贴；源样式没有时清空，避免旧坐标覆盖新元数据。
        metadata.fillGradientCoords = style.fillGradientCoords ? { ...style.fillGradientCoords } : undefined

        // 如果是渐变模式，重建渐变对象
        if (style.fillMode === 'gradient') {
          const gradient = createGradientFromMetadata(target)
          if (gradient) target.set('fill', gradient)
        }
      }

      // 应用描边
      if (style.stroke !== undefined) {
        target.set('stroke', style.stroke)
        anyTarget.lastStroke = typeof style.stroke === 'string' ? style.stroke : undefined
      }
      if (style.strokeWidth !== undefined) {
        target.set('strokeWidth', style.strokeWidth)
        anyTarget.lastStrokeWidth = style.strokeWidth
      }
      if (style.strokeDashArray !== undefined) {
        target.set('strokeDashArray', style.strokeDashArray ? [...style.strokeDashArray] : null)
        anyTarget.lastStrokeDashArray = style.strokeDashArray ? [...style.strokeDashArray] : null
      }

      // 应用透明度
      if (style.opacity !== undefined) {
        target.set('opacity', style.opacity)
      }

      // 应用阴影
      const shadowMetadata = getShadowEffectsMetadata(target)
      if (shadowMetadata && style.shadowEffects) {
        shadowMetadata.shadowEffects = style.shadowEffects.map(effect => ({...effect}))
        applyShadowEffectsToFabricObject(target)
      }

      target.dirty = true
      target.setCoords()
    })

    if (obj instanceof Group) obj.triggerLayout()
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    syncObjProps()
    snapshot()
    showToast('样式已应用', 'success')
  }

  const currentLockMode = computed(() => {
    const obj = activeObject.value
    if (!obj) return 'none'

    const moveLocked = obj.lockMovementX === true && obj.lockMovementY === true
    const scaleLocked = obj.lockScalingX === true && obj.lockScalingY === true
    const rotateLocked = obj.lockRotation === true

    if (moveLocked && scaleLocked && rotateLocked) return 'full'
    if (moveLocked && !scaleLocked) return 'position'
    if (!moveLocked && scaleLocked) return 'size'
    return 'none'
  })

  function setLockMode(mode: 'none' | 'position' | 'size' | 'full') {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return

    switch (mode) {
      case 'none':
        obj.set({
          lockMovementX: false,
          lockMovementY: false,
          lockScalingX: false,
          lockScalingY: false,
          lockRotation: false,
          hasControls: true,
          selectable: true
        })
        break
      case 'position':
        obj.set({
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: false,
          lockScalingY: false,
          lockRotation: false,
          hasControls: true,
          selectable: true
        })
        break
      case 'size':
        obj.set({
          lockMovementX: false,
          lockMovementY: false,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          hasControls: false,
          selectable: true
        })
        break
      case 'full':
        obj.set({
          lockMovementX: true,
          lockMovementY: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          hasControls: false,
          selectable: true
        })
        break
    }

    obj.setCoords()
    fabricCanvas.requestRenderAll()
    refreshLayers()
    syncObjProps()
    snapshot()
    // 强制触发 shallowRef 的响应式更新
    triggerRef(activeObject)
  }

  const isMultiSelection = computed(() => {
    return activeObject.value instanceof ActiveSelection
  })

  const selectionCount = computed(() => {
    const obj = activeObject.value
    if (obj instanceof ActiveSelection) {
      return obj.size()
    }
    return obj ? 1 : 0
  })


  // 按属性面板输入缩放当前对象；开启网格吸附时会继续量化显示尺寸和边界位置。
  function setObjSize(dim: 'width' | 'height', value: number) {
    const obj = activeObject.value
    if (!obj || !Number.isFinite(value) || value <= 0) return
    if (sizeRatioLocked.value) {
      const ratio = lockedAspectRatio.value || getObjectAspectRatio(obj)
      const safeRatio = ratio > 0 ? ratio : 1
      const width = dim === 'width' ? value : value * safeRatio
      const height = dim === 'width' ? value / safeRatio : value
      scaleObjectToDisplaySize(obj, width, height)
    } else if (dim === 'width') {
      obj.scaleToWidth(value)
    } else {
      obj.scaleToHeight(value)
    }
    // 提取新的基础缩放并重新应用 3D 旋转
    extractRotation3DBaseScalesFromObject(obj)
    applyRotation3DTransformToObject(obj)
    rebuildObjectGradientFill(obj)
    snapObjectSizeToPixelGrid(obj)
    snapObjectPositionToPixelGrid(obj)
    clearOwnedEndpointAttachmentsForTransformedObject(obj)
    obj.dirty = true
    obj.setCoords()
    syncEndpointsForChangedObject(obj)
    triggerKaleidoscopeTransformSync(obj)
    fabricCanvas?.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  // 将对象尺寸输入提交为正数，非法输入回退到当前显示尺寸
  function setObjSizeFromInput(dim: 'width' | 'height', value: string | number) {
    const fallback = dim === 'width' ? objProps.width : objProps.height
    commitPositiveNumericInput(
      value,
      fallback,
      (next) => { setObjSize(dim, next) },
      (next) => {
        if (dim === 'width') objProps.widthInput = next
        else objProps.heightInput = next
      }
    )
  }

  // ── 对齐到画布 ──
  type AlignPositionId =
    | 'top-left' | 'top-center' | 'top-right'
    | 'middle-left' | 'middle-center' | 'middle-right'
    | 'bottom-left' | 'bottom-center' | 'bottom-right'

  interface AlignPositionMeta {
    id: AlignPositionId
    label: string
    hAxis: 'left' | 'center' | 'right'
    vAxis: 'top' | 'middle' | 'bottom'
    svgX: number
    svgY: number
  }

  const alignPositions: AlignPositionMeta[] = [
    { id: 'top-left',      label: '左上对齐', hAxis: 'left',   vAxis: 'top',    svgX: 2,  svgY: 2 },
    { id: 'top-center',    label: '中上对齐', hAxis: 'center', vAxis: 'top',    svgX: 6,  svgY: 2 },
    { id: 'top-right',     label: '右上对齐', hAxis: 'right',  vAxis: 'top',    svgX: 10, svgY: 2 },
    { id: 'middle-left',   label: '左中对齐', hAxis: 'left',   vAxis: 'middle', svgX: 2,  svgY: 7 },
    { id: 'middle-center', label: '正中对齐', hAxis: 'center', vAxis: 'middle', svgX: 6,  svgY: 7 },
    { id: 'middle-right',  label: '右中对齐', hAxis: 'right',  vAxis: 'middle', svgX: 10, svgY: 7 },
    { id: 'bottom-left',   label: '左下对齐', hAxis: 'left',   vAxis: 'bottom', svgX: 2,  svgY: 12 },
    { id: 'bottom-center', label: '中下对齐', hAxis: 'center', vAxis: 'bottom', svgX: 6,  svgY: 12 },
    { id: 'bottom-right',  label: '右下对齐', hAxis: 'right',  vAxis: 'bottom', svgX: 10, svgY: 12 }
  ]

  const alignPopoverVisible = ref(false)

  const detectedAlignId = computed<AlignPositionId | null>(() => {
    void layerVersion.value
    const obj = activeObject.value
    if (!obj) return null
    const bounds = obj.getBoundingRect()
    const tolerance = 0.5
    let hAxis: AlignPositionMeta['hAxis'] | null = null
    let vAxis: AlignPositionMeta['vAxis'] | null = null
    if (Math.abs(bounds.left) <= tolerance) hAxis = 'left'
    else if (Math.abs(bounds.left + bounds.width - canvasWidth.value) <= tolerance) hAxis = 'right'
    else if (Math.abs(bounds.left + bounds.width / 2 - canvasWidth.value / 2) <= tolerance) hAxis = 'center'
    if (Math.abs(bounds.top) <= tolerance) vAxis = 'top'
    else if (Math.abs(bounds.top + bounds.height - canvasHeight.value) <= tolerance) vAxis = 'bottom'
    else if (Math.abs(bounds.top + bounds.height / 2 - canvasHeight.value / 2) <= tolerance) vAxis = 'middle'
    if (!hAxis || !vAxis) return null
    return alignPositions.find((item) => item.hAxis === hAxis && item.vAxis === vAxis)?.id ?? null
  })

  const currentAlignId = computed<AlignPositionId>(() => detectedAlignId.value ?? 'middle-center')

  const currentAlignPosition = computed<AlignPositionMeta>(() => (
    alignPositions.find((item) => item.id === currentAlignId.value) ?? alignPositions[4]
  ))

  function alignToCanvas(positionId: AlignPositionId) {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    const meta = alignPositions.find((item) => item.id === positionId)
    if (!meta) return
    const bounds = obj.getBoundingRect()
    let targetLeft = bounds.left
    let targetTop = bounds.top
    if (meta.hAxis === 'left') targetLeft = 0
    else if (meta.hAxis === 'center') targetLeft = (canvasWidth.value - bounds.width) / 2
    else targetLeft = canvasWidth.value - bounds.width
    if (meta.vAxis === 'top') targetTop = 0
    else if (meta.vAxis === 'middle') targetTop = (canvasHeight.value - bounds.height) / 2
    else targetTop = canvasHeight.value - bounds.height
    const dx = targetLeft - bounds.left
    const dy = targetTop - bounds.top
    if (dx === 0 && dy === 0) return
    obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy })
    clearOwnedEndpointAttachmentsForTransformedObject(obj)
    obj.setCoords()
    syncEndpointsForChangedObject(obj)
    triggerKaleidoscopeTransformSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  function selectAlign(positionId: AlignPositionId) {
    alignPopoverVisible.value = false
    alignToCanvas(positionId)
  }

  type SelectionAlignAxis = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  type SelectionDistributeAxis = 'horizontal' | 'vertical'

  type ObjectLayoutBounds = {
    object: FabricObject
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
    centerX: number
    centerY: number
  }

  type LayoutSelectionBounds = {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }

  // 收集当前多选中可参与排版的顶层对象；万花筒实例由源对象托管，避免手动对齐后被同步逻辑覆盖或产生双重偏移。
  function getSelectedLayoutTargets() {
    if (!fabricCanvas) return []
    const canvasObjects = fabricCanvas.getObjects()
    return fabricCanvas.getActiveObjects()
      .filter((obj) => canvasObjects.includes(obj))
      .filter((obj) => !isBooleanPreviewObject(obj) && !isKaleidoscopeInstance(obj))
  }

  // 获取对象在画布场景坐标中的包围盒，统一处理旋转、缩放和 ActiveSelection 内部对象的坐标换算。
  function getObjectLayoutBounds(object: FabricObject): ObjectLayoutBounds | null {
    object.setCoords()
    const bounds = object.getBoundingRect()
    const values = [bounds.left, bounds.top, bounds.width, bounds.height]
    if (!values.every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null
    const right = bounds.left + bounds.width
    const bottom = bounds.top + bounds.height
    return {
      object,
      left: bounds.left,
      top: bounds.top,
      right,
      bottom,
      width: bounds.width,
      height: bounds.height,
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2
    }
  }

  // 合并多对象的初始包围盒，作为“以选区为参考”的对齐和分布基准。
  function getLayoutSelectionBounds(items: ObjectLayoutBounds[]): LayoutSelectionBounds | null {
    if (!items.length) return null
    const left = Math.min(...items.map((item) => item.left))
    const top = Math.min(...items.map((item) => item.top))
    const right = Math.max(...items.map((item) => item.right))
    const bottom = Math.max(...items.map((item) => item.bottom))
    const values = [left, top, right, bottom]
    if (!values.every(Number.isFinite) || right <= left || bottom <= top) return null
    return { left, top, right, bottom, width: right - left, height: bottom - top }
  }

  // 按场景坐标偏移对象；使用 Fabric 的 getXY / setXY 让 ActiveSelection 子对象自动转换到当前父级坐标系。
  function moveObjectBySceneDelta(object: FabricObject, dx: number, dy: number) {
    if ((dx === 0 && dy === 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return false
    const current = object.getXY()
    const nextX = object.lockMovementX ? current.x : current.x + dx
    const nextY = object.lockMovementY ? current.y : current.y + dy
    if (nextX === current.x && nextY === current.y) return false
    object.setXY(new Point(nextX, nextY))
    clearOwnedEndpointAttachmentsForTransformedObject(object)
    object.setCoords()
    syncEndpointsForChangedObject(object)
    triggerKaleidoscopeTransformSync(object)
    return true
  }

  // 完成多对象排版后的统一收尾：刷新 ActiveSelection 尺寸、图层、属性和撤销快照。
  function finalizeSelectionLayoutTransform(targets: FabricObject[]) {
    if (!fabricCanvas) return
    const active = fabricCanvas.getActiveObject()
    if (active instanceof ActiveSelection || active instanceof Group) {
      active.triggerLayout()
      active.setCoords()
    }
    targets.forEach((target) => target.setCoords())
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
  }

  /**
   * 以对象集合的公共包围盒为基准执行对齐，支持左/水平居中/右与顶/垂直居中/底六个方向。
   * 位置计算基于场景坐标包围盒（旋转对象按其包围盒参与），通过 delta 平移保持对象自身 left/top 语义，
   * 编组对象作为整体参与。至少需要 2 个可排版对象，否则不做任何处理。
   * 供选区对齐按钮与 MCP 程序化对齐共用；实际移动并产生历史快照时返回 true。
   */
  function alignObjectsLayout(objects: FabricObject[], mode: SelectionAlignAxis): boolean {
    if (!fabricCanvas) return false
    const targets = objects.filter((obj) => !isBooleanPreviewObject(obj) && !isKaleidoscopeInstance(obj))
    if (targets.length < 2) return false
    const items = targets
      .map(getObjectLayoutBounds)
      .filter((item): item is ObjectLayoutBounds => !!item)
    const selectionBounds = getLayoutSelectionBounds(items)
    if (!selectionBounds) return false

    clearBooleanPreview()
    let moved = false
    items.forEach((item) => {
      let dx = 0
      let dy = 0
      if (mode === 'left') dx = selectionBounds.left - item.left
      else if (mode === 'center') dx = selectionBounds.left + selectionBounds.width / 2 - item.centerX
      else if (mode === 'right') dx = selectionBounds.right - item.right
      else if (mode === 'top') dy = selectionBounds.top - item.top
      else if (mode === 'middle') dy = selectionBounds.top + selectionBounds.height / 2 - item.centerY
      else if (mode === 'bottom') dy = selectionBounds.bottom - item.bottom
      moved = moveObjectBySceneDelta(item.object, dx, dy) || moved
    })
    if (!moved) return false
    finalizeSelectionLayoutTransform(targets)
    return true
  }

  // 以当前选区包围盒为参考执行多对象对齐，支持左右 / 水平居中 / 上下 / 垂直居中六个方向并保持操作可撤销。
  function alignSelection(axis: SelectionAlignAxis) {
    alignObjectsLayout(getSelectedLayoutTargets(), axis)
  }

  /**
   * 在首尾对象之间等间距分布对象集合，首尾对象位置保持不变。
   * axis 为 'x'（水平）或 'y'（垂直）；mode 取 'edge'（对象边缘间距相等）或
   * 'center'（对象中心间距相等，尺寸一致时两者等价）。对象按分布轴坐标排序后参与计算，
   * 不足 2 个可排版对象时不做处理；实际移动并产生历史快照时返回 true。
   */
  function distributeObjectsLayout(objects: FabricObject[], axis: 'x' | 'y', mode: 'edge' | 'center' = 'center'): boolean {
    if (!fabricCanvas) return false
    const targets = objects.filter((obj) => !isBooleanPreviewObject(obj) && !isKaleidoscopeInstance(obj))
    if (targets.length < 2) return false
    const items = targets
      .map(getObjectLayoutBounds)
      .filter((item): item is ObjectLayoutBounds => !!item)
    if (items.length < 2) return false

    clearBooleanPreview()
    const horizontal = axis === 'x'
    const sorted = [...items].sort((a, b) => mode === 'center'
      ? (horizontal ? a.centerX - b.centerX : a.centerY - b.centerY)
      : (horizontal
        ? (a.left === b.left ? a.centerX - b.centerX : a.left - b.left)
        : (a.top === b.top ? a.centerY - b.centerY : a.top - b.top))
    )

    let moved = false
    if (mode === 'center') {
      // 中心等距：以首尾对象的中心为锚点，中间对象的中心均匀分布在两锚点之间。
      const startCenter = horizontal ? sorted[0].centerX : sorted[0].centerY
      const endCenter = horizontal
        ? sorted[sorted.length - 1].centerX
        : sorted[sorted.length - 1].centerY
      for (let index = 1; index < sorted.length - 1; index++) {
        const item = sorted[index]
        const currentCenter = horizontal ? item.centerX : item.centerY
        const targetCenter = startCenter + ((endCenter - startCenter) * index) / (sorted.length - 1)
        const delta = targetCenter - currentCenter
        moved = (horizontal
          ? moveObjectBySceneDelta(item.object, delta, 0)
          : moveObjectBySceneDelta(item.object, 0, delta)) || moved
      }
    } else {
      // 边缘等距：相邻对象包围盒之间的空隙相等，游标从首个对象右/下边缘依次推进。
      const totalSize = sorted.reduce((sum, item) => sum + (horizontal ? item.width : item.height), 0)
      const start = horizontal ? sorted[0].left : sorted[0].top
      const end = horizontal ? sorted[sorted.length - 1].right : sorted[sorted.length - 1].bottom
      const gap = (end - start - totalSize) / (sorted.length - 1)
      if (!Number.isFinite(gap)) return false
      let cursor = start
      sorted.forEach((item, index) => {
        if (index === 0) {
          cursor = (horizontal ? item.right : item.bottom) + gap
          return
        }
        if (index === sorted.length - 1) return
        if (horizontal) {
          moved = moveObjectBySceneDelta(item.object, cursor - item.left, 0) || moved
          cursor += item.width + gap
        } else {
          moved = moveObjectBySceneDelta(item.object, 0, cursor - item.top) || moved
          cursor += item.height + gap
        }
      })
    }
    if (!moved) return false
    finalizeSelectionLayoutTransform(targets)
    return true
  }

  // 在选区首尾对象之间按对象包围盒间距做等距分布，首尾位置保持不变，便于稳定整理图标元素阵列。
  function distributeSelection(axis: SelectionDistributeAxis) {
    distributeObjectsLayout(getSelectedLayoutTargets(), axis === 'horizontal' ? 'x' : 'y', 'edge')
  }

  // ── 画布尺寸 ──
  function syncCanvasSizeInputs() {
    canvasWidthInput.value = String(canvasWidth.value)
    canvasHeightInput.value = String(canvasHeight.value)
  }

  function setCanvasSize(dim: 'width' | 'height', value: number) {
    if (!fabricCanvas) return
    if (!Number.isFinite(value) || value <= 0) {
      syncCanvasSizeInputs()
      return
    }
    if (dim === 'width') canvasWidth.value = value
    else canvasHeight.value = value
    applyCanvasSize()
  }

  function setCanvasSizeFromInput(dim: 'width' | 'height', value: string | number) {
    const fallback = dim === 'width' ? canvasWidth.value : canvasHeight.value
    commitNumericInput(
      value,
      fallback,
      (next) => { setCanvasSize(dim, next) },
      (next) => {
        if (dim === 'width') canvasWidthInput.value = next
        else canvasHeightInput.value = next
      }
    )
  }

  function applyCanvasSize() {
    if (!fabricCanvas) return
    syncCanvasSizeInputs()
    fabricCanvas.setDimensions({ width: canvasWidth.value, height: canvasHeight.value })
    fitCanvasInView()
    snapshot()
  }

  function setCanvasBg(color: string) {
    if (!fabricCanvas) return
    const next = normalizeCanvasBg(color)
    canvasBg.value = next
    if (!isTransparentCanvasBg(next)) lastOpaqueCanvasBg.value = next
    applyCanvasBgToFabric(next)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function applyCanvasPreset(val: string) {
    canvasPresetValue.value = val
    const preset = canvasPresets.find(p => p.value === val)
    if (preset) {
      canvasWidth.value = preset.width
      canvasHeight.value = preset.height
      applyCanvasSize()
    }
  }

  // ── 缩放 ──
  function setZoom(value: number) {
    applyCanvasZoom(value)
  }

  function getSpecialDirectEditSegment(obj: FabricObject | null | undefined) {
    if (!obj || !isEditablePathObject(obj) || !DIRECT_EDIT_SHAPE_IDS.has(String((obj as AnyFabricObject).shapeId ?? ''))) return null
    const segments = getEditableSegments(obj)
    return segments.length === 1 ? segments[0] : null
  }

  function getSpecialDirectEditMode(obj: FabricObject | null | undefined): 'point' | 'segment' | null {
    const segment = getSpecialDirectEditSegment(obj)
    if (!segment) return null
    return segment.segment.type === 'cubic' ? 'segment' : 'point'
  }

  function shouldHideTransformControlsInEditMode(obj: FabricObject | null | undefined) {
    return selectionMode.value !== 'shape' && !!getSpecialDirectEditSegment(obj)
  }

  function hideFabricTransformControls(controls: FabricControls) {
    FABRIC_TRANSFORM_CONTROL_KEYS.forEach((key) => {
      delete controls[key]
    })
  }

  function syncActiveObject(obj: FabricObject | null) {
    clearPointEditing()
    const constrained = applyKaleidoscopeSelectionConstraints(obj)
    const directEditMode = getSpecialDirectEditMode(constrained)
    if (directEditMode) {
      selectionMode.value = directEditMode
    } else if (constrained && isKaleidoscopeInstance(constrained)) {
      selectionMode.value = 'shape'
    }
    if (!constrained) selectionMode.value = 'shape'
    activeObject.value = constrained
    booleanError.value = ''
    if (constrained) {
      applyCanvasThemeToObject(constrained)
      applyDefaultSizeRatioLockMetadata(constrained)
    } else {
      sizeRatioLocked.value = false
      lockedAspectRatio.value = 1
    }
    syncCanvasInteractionMode()
    if (directEditMode === 'segment' && isEditablePathObject(constrained)) {
      setSelectedEditableSegment(constrained, getSpecialDirectEditSegment(constrained))
    } else {
      updateCurveControls()
    }
    refreshLayers()
    if (constrained) {
      syncSizeRatioLockFromObject(constrained)
      syncObjProps()
    }
  }

  // 在 point 模式下创建/切换到新对象时，尝试让新对象继续停留在 point 模式
  // (若新对象不可编辑，setSelectionMode 会自动降级为 shape 模式)
  function syncActiveObjectPreservingPointMode(obj: FabricObject | null) {
    const wantPointMode = selectionMode.value === 'point'
    syncActiveObject(obj)
    if (wantPointMode && obj) {
      setSelectionMode('point')
    }
  }

  function refreshActiveObject() {
    triggerRef(activeObject)
    refreshLayers()
  }

  // ── 油漆桶上色副作用 ──
  // 模块层完成点击判定后，实际的样式写入/同步/撤销快照回到页面层：
  // 填充与"纯色填充"面板逻辑同源（lastFill 元数据 + fillMode 归一），描边与"描边色板"同源（含宽度补齐）。
  /**
   * 把单个对象整体填充改为目标纯色（油漆桶区域命中时）：
   * 编组递归应用到全部子对象；位图/文本等无填充语义对象返回 false 交由上层跳过。
   * 目标未开启填充（fill 为 transparent/none/空，即面板关闭填充后的状态）时同样直接写入颜色，
   * 等价于"自动开启填充后上色"——填充开关本身由 fill 值派生（isFillEnabled），写色即开启；
   * 元数据口径与 toggleFill(true) 对齐：先补齐渐变元数据，再切回 solid 并记录 lastFill。
   */
  function applyPaintBucketFill(obj: FabricObject, color: string): boolean {
    if (!fabricCanvas || !obj) return false
    if (obj instanceof FabricImage) return false
    const targets = getStyleTargets(obj)
    if (!targets.length) return false
    targets.forEach((target) => {
      const typed = target as AnyFabricObject
      applyDefaultFillGradientMetadata(typed)
      typed.fillMode = 'solid'
      typed.lastFill = color
      target.set('fill', color)
      target.dirty = true
      target.setCoords()
    })
    if (obj instanceof Group) obj.triggerLayout()
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
    return true
  }

  /**
   * 把单个对象描边色改为目标色（油漆桶边界命中时）：
   * 复用描边色板语义——原描边未启用时按面板回退宽度补齐，保证效果可见。
   */
  function applyPaintBucketStroke(obj: FabricObject, color: string): boolean {
    if (!fabricCanvas || !obj) return false
    if (obj instanceof FabricImage) return false
    const targets = getStyleTargets(obj)
    if (!targets.length) return false
    targets.forEach((target) => {
      const typed = target as AnyFabricObject
      typed.lastStroke = color
      const patch: Record<string, unknown> = { stroke: color }
      if (!isStrokeEnabled(color, target.strokeWidth)) {
        const fallbackWidth = Number(typed.lastStrokeWidth ?? objProps.strokeWidth)
        patch.strokeWidth = Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : 2
        typed.lastStrokeWidth = patch.strokeWidth
      }
      target.set(patch as any)
      target.dirty = true
      target.setCoords()
    })
    if (obj instanceof Group) obj.triggerLayout()
    obj.dirty = true
    obj.setCoords()
    triggerKaleidoscopeContentSync(obj)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
    syncObjProps()
    return true
  }

  /** 切换油漆桶工具（工具栏按钮与 Alt+5 共用入口）；与钢笔工具互斥。 */
  function togglePaintBucketTool() {
    if (penToolActive.value) penCommands.deactivate(false)
    paintBucketCommands.activate()
  }

  /**
   * 归一化油漆桶颜料的存储格式：统一折算为小写 hex 键（#rrggbb[aa]），
   * 兼容取色面板 HEX/RGBA/HSL 多格式输出；全不透明时省略 alpha 段保持 6 位简洁形式。
   * 无法识别的取值原样返回（交由模块层的静默忽略逻辑兜底）。
   */
  function normalizePaintColor(color: string) {
    const key = normalizeColorKey(color)
    if (!key) return color
    return key.length === 9 && key.endsWith('ff') ? key.slice(0, 7) : key
  }

  /**
   * 设置油漆桶前景颜料（PS 语义：上色用色，工具栏上层色块）。
   * 色板/颜色选择器在油漆桶工具态下写入前景颜料；非工具态调用也直接写颜料
   *（颜料独立于激活状态持久，与 PS 一致）。
   * 颜色先归一化为规范 hex（#rrggbb[aa]）：取色面板可切换 HEX/RGBA 等格式输出，
   * 统一存储形式后 isSolidFillMatched 的"已同色跳过"字符串比较才不受格式影响。
   */
  function setPaintBucketColor(color: string) {
    paintBucketCommands.setForegroundColor(normalizePaintColor(color))
  }

  /** 设置油漆桶背景颜料（PS 语义：备用色，工具栏下层色块）；同样归一化存储格式。 */
  function setPaintBucketStrokeColor(color: string) {
    paintBucketCommands.setBackgroundColor(normalizePaintColor(color))
  }

  /** 交换油漆桶前景/背景颜料（工具栏色块交换按钮）。 */
  function swapPaintBucketColors() {
    paintBucketCommands.swapColors()
  }

  /**
   * 切换油漆桶上色行为：fill（改填充色）↔ stroke（改描边色）。
   * 供工具栏油漆桶 hover 弹窗内的行为开关调用。
   */
  function togglePaintBucketBehavior() {
    paintBucketCommands.toggleBehavior()
  }

  /** 设置油漆桶上色行为（弹窗内两个选项按钮共用）。 */
  function setPaintBucketBehavior(behavior: 'fill' | 'stroke') {
    paintBucketCommands.setBehavior(behavior)
  }

  // ── 油漆桶网格上色 ──
  // 网格可见 + 填充行为下，油漆桶改按网格单元格上色：以矩形色块对象承载每个同色连续区域
  //（gridPaintCell 标记），写入前先从既有色块挖去本区域、再与相邻同色块贪心合并，
  // 使"同色连续区域 = 单个矩形"尽量成立，避免对象数量随笔画线性膨胀。

  /** 网格色块条目：画布对象 + 其场景坐标包围盒 + 当前填充色（非纯色字符串按未知色处理）。 */
  type GridPaintEntry = { obj: AnyFabricObject; rect: GridRect; color: string }

  /**
   * 收集画布上全部网格色块（gridPaintCell 标记的矩形对象）及其包围盒。
   * 包围盒按 left/top + width/height × scale 原始几何计算：色块统一以 originX/originY=left/top
   * 创建且无描边；getBoundingRect/getScaledWidth 会把默认 strokeWidth=1 计入（16px 读成 17px），
   * 用它做挖切/覆盖判定会引入半格缝隙与拖影。
   */
  function collectGridPaintEntries(): GridPaintEntry[] {
    return (fabricCanvas?.getObjects() ?? [])
      .filter((obj) => (obj as AnyFabricObject).gridPaintCell === true)
      .map((obj) => {
        const typed = obj as AnyFabricObject
        const width = (Number(typed.width) || 0) * (Number(typed.scaleX) || 1)
        const height = (Number(typed.height) || 0) * (Number(typed.scaleY) || 1)
        return {
          obj: typed,
          rect: { x: Number(typed.left) || 0, y: Number(typed.top) || 0, width, height },
          color: typeof obj.fill === 'string' ? obj.fill : ''
        }
      })
  }

  /**
   * 创建网格色块矩形（场景坐标对齐网格线，scale 保持 1）：
   * fabric v7 对象默认 originX/originY=center，这里必须显式声明 left/top 锚点，
   * 否则 left/top 会被当作色块中心，整块偏移半格、出现跨格拖影；
   * 元数据口径与油漆桶对象填充一致（fillMode/lastFill），并带 gridPaintCell 标记参与后续挖切合并。
   */
  function createGridPaintRect(rect: GridRect, color: string) {
    const obj = new Rect({
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      fill: color,
      originX: 'left',
      originY: 'top'
    })
    const typed = obj as AnyFabricObject
    typed.gridPaintCell = true
    typed.fillMode = 'solid'
    typed.lastFill = color
    typed.name = nextName('网格上色')
    applyDefaultFillGradientMetadata(typed)
    ensureEditorObjectId(typed)
    obj.setCoords()
    return obj
  }

  /**
   * 把画笔覆盖区域以指定颜色写入网格：
   * 核心挖切/合并算法在 geometry/gridPaint.ts 的 planGridPaintWrite（纯函数，可单测），
   * 这里按计划同步 fabric 对象（remove 既有色块、add 残块与新块）。
   * 挖切合并的 add/remove 会触发 object:added/removed 的自动快照，逐笔抑制，
   * 只在手势结束（finishGridPaintGesture）提交一条"网格上色"记录——
   * 一次完整的按下、拖动、抬起（含快速拖动扫过 N 格）只产生一条历史记录。
   */
  function applyGridPaintRegion(region: GridRect, color: string): boolean {
    if (!fabricCanvas) return false
    const entries = collectGridPaintEntries()
    const plan = planGridPaintWrite(entries, region, color)
    if (!plan.changed) return false
    const previousSkipSnapshot = skipSnapshot
    skipSnapshot = true
    try {
      plan.remove.forEach((shape) => fabricCanvas.remove(shape.obj))
      plan.add.forEach((shape) => fabricCanvas.add(createGridPaintRect(shape.rect, shape.color)))
    } finally {
      skipSnapshot = previousSkipSnapshot
    }
    fabricCanvas.requestRenderAll()
    return true
  }

  /** 在锚点单元格处落一笔画笔区域（brushSize × brushSize 格，超出画布部分自动裁剪）。 */
  function paintGridBrushAt(anchor: GridCell) {
    const region = getBrushPaintRegion(anchor, pixelPaintBrushSize.value, canvasWidth.value, canvasHeight.value, pixelGridSize.value)
    if (!region) return
    if (applyGridPaintRegion(region, paintBucketState.paintForegroundColor.value)) {
      gridPaintChanged = true
    }
  }

  /** 网格上色按下：锚定点击单元格并落第一笔，同时开始手势（供拖动连刷）。 */
  function handleGridPaintDown(scenePoint: { x: number; y: number }) {
    const anchor = getGridPaintAnchorCell(scenePoint, canvasWidth.value, canvasHeight.value, pixelGridSize.value)
    if (!anchor) return
    gridPaintHoverCell.value = anchor
    gridPaintGesture = { lastAnchor: anchor }
    gridPaintChanged = false
    paintGridBrushAt(anchor)
  }

  /**
   * 网格上色移动：更新悬停单元格（驱动方形画笔光标）；手势中沿上次锚点到当前锚点的连线
   * 逐格插值补笔，快速拖动也不会漏格。
   */
  function handleGridPaintMove(scenePoint: { x: number; y: number }) {
    const anchor = getGridPaintAnchorCell(scenePoint, canvasWidth.value, canvasHeight.value, pixelGridSize.value)
    gridPaintHoverCell.value = anchor
    if (!gridPaintGesture || !anchor) return
    const last = gridPaintGesture.lastAnchor
    const steps = Math.max(Math.abs(anchor.col - last.col), Math.abs(anchor.row - last.row))
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps
      paintGridBrushAt({
        col: Math.round(last.col + (anchor.col - last.col) * ratio),
        row: Math.round(last.row + (anchor.row - last.row) * ratio)
      })
    }
    if (steps > 0) gridPaintGesture.lastAnchor = anchor
  }

  /** 结束网格上色手势：手势内确实写入过颜色才刷新图层并提交一条撤销记录。 */
  function finishGridPaintGesture() {
    gridPaintGesture = null
    if (!gridPaintChanged) return
    gridPaintChanged = false
    refreshLayers()
    snapshot({ description: '网格上色' })
  }

  // ── 添加元素 ──
  /**
   * 把钢笔描点的场景数据生成为可编辑路径对象（支持直线/贝塞尔曲线混合段）。
   * 直接以场景坐标作为路径点：rebuildEditablePathObject(obj, true) 会把对象中心定位到路径包围盒中心，
   * 使每个点正好渲染在其原始场景坐标处（Fabric Path 默认 originX/originY=center）。
   * 锚点吸附像素网格时，各锚点携带的控制柄随锚点整体平移，保证曲线形状与描点预览一致。
   */
  function addPenPathObject(data: PenPathData) {
    if (!fabricCanvas) return
    if (data.points.length < 2) return
    const points: EditablePoint[] = []
    // 记录每个锚点吸附前后的位移，供控制柄随锚点同步平移
    const snapDeltaByIndex = new Map<number, { x: number, y: number }>()
    data.points.forEach((point) => {
      const snapped = getPixelGridAdjustedScenePoint(new Point(point.x, point.y))
      snapDeltaByIndex.set(points.length, { x: snapped.x - point.x, y: snapped.y - point.y })
      points.push({ x: snapped.x, y: snapped.y })
    })
    const offsetByDelta = (index: number, handle: { x: number, y: number }) => {
      const delta = snapDeltaByIndex.get(index) ?? { x: 0, y: 0 }
      return { x: handle.x + delta.x, y: handle.y + delta.y }
    }
    // 段按链式顺序给出：cp1 存放在起点侧（随链游标推进）、cp2 存放在终点侧，分别跟随对应锚点的吸附位移
    let fromIndex = 0
    const segments: EditablePathSegment[] = data.segments.map((segment) => {
      const currentFrom = fromIndex
      fromIndex = segment.to
      if (segment.type === 'cubic') {
        return {
          type: 'cubic',
          cp1: offsetByDelta(currentFrom, segment.cp1),
          cp2: offsetByDelta(segment.to, segment.cp2),
          to: segment.to
        }
      }
      return { type: 'line', to: segment.to }
    })
    const obj = createEditablePathObject(pathEditableModel(points, segments, data.closed), 0)
    obj.set({
      stroke: '#333333',
      strokeWidth: 2,
      strokeUniform: true,
      fill: 'transparent',
      strokeLineCap: 'round' as CanvasLineCap,
      strokeLineJoin: 'round' as CanvasLineJoin,
      strokeMiterLimit: 4,
      name: nextName('钢笔图形')
    })
    const target = obj as AnyFabricObject
    target.shapeId = 'base-pen'
    target.lastFill = '#000000'
    target.fillMode = DEFAULT_FILL_MODE
    target.booleanEligible = true
    target.lastStrokeDashArray = [6, 4]
    applyDefaultFillGradientMetadata(obj)
    applyDefaultKaleidoscopeMetadata(obj)
    applyDefaultEndpointSnapMargin(obj)
    markObjectSizeRatioLocked(obj)
    ensureEditorObjectId(obj)
    obj.setCoords()
    fabricCanvas.add(obj)
    refreshLayers()
    fabricCanvas.setActiveObject(obj)
    syncActiveObjectPreservingPointMode(obj)
    fabricCanvas.requestRenderAll()
  }

  /**
   * 添加基础图形；拖拽插入时优先把图形中心放到落点，普通点击则保持原有画布中心插入行为。
   * @param size 可选目标尺寸；传入时形状直接以该尺寸生成本体几何（scale 保持 1），
   *   缺省维度沿用目录默认尺寸，不指定时与原有默认尺寸插入行为完全一致。
   */
  function addShape(
    item: ShapeLibraryItem,
    scenePoint: { x: number; y: number } | null = null,
    size?: { width?: number; height?: number }
  ) {
    if (penToolActive.value) penCommands.deactivate(true)
    if (paintBucketActive.value) paintBucketCommands.deactivate()
    if (!fabricCanvas) return
    const shape = createShape(item, size)
    markObjectSizeRatioLocked(shape)
    const left = scenePoint?.x ?? canvasWidth.value / 2
    const top = scenePoint?.y ?? canvasHeight.value / 2
    shape.set({
      left,
      top,
      name: nextName(item.label)
    })
    ensureEditorObjectId(shape)
    shape.setCoords()
    fabricCanvas.add(shape)
    refreshLayers()
    fabricCanvas.setActiveObject(shape)
    syncActiveObjectPreservingPointMode(shape)
    fabricCanvas.requestRenderAll()
  }

  /**
   * 添加文字预设；拖拽插入时以鼠标落点为文本框中心，点击插入时沿用原有默认位置。
   */
  function addText(preset: TextLibraryItem, scenePoint: { x: number; y: number } | null = null) {
    if (penToolActive.value) penCommands.deactivate(true)
    if (paintBucketActive.value) paintBucketCommands.deactivate()
    if (!fabricCanvas) return
    const width = 200
    const left = scenePoint ? scenePoint.x - width / 2 : canvasWidth.value / 2 - width / 2
    const top = scenePoint ? scenePoint.y - preset.fontSize / 2 : canvasHeight.value / 2 - preset.fontSize / 2
    const t = new Textbox(preset.text, {
      left,
      top,
      fontSize: preset.fontSize,
      fontWeight: preset.fontWeight as any,
      // 显式指定默认字体，避免 fabric 默认 Times New Roman 导致中文回退到随机衬线体。
      fontFamily: DEFAULT_TEXT_FONT_FAMILY,
      fill: '#000000',
      name: nextName(preset.label),
      width
    })
    applyDefaultKaleidoscopeMetadata(t)
    applyDefaultEndpointSnapMargin(t)
    ensureEditorObjectId(t)
    fabricCanvas.add(t)
    refreshLayers()
    fabricCanvas.setActiveObject(t)
    syncActiveObjectPreservingPointMode(t)
    fabricCanvas.requestRenderAll()
  }

  // ── 模板 ──
  // 把模板 SVG 插入当前画布，作为普通可编辑对象继续参与图层、属性、导出和撤销流程。
  async function insertIconTemplate(template: IconTemplateItem) {
    await importSVGText(template.svg, template.name)
  }

  // 用模板尺寸、背景和 SVG 内容创建一份新文档；应用失败时保留已有画布，避免误清空当前作品。
  async function applyIconTemplateAsDocument(template: IconTemplateItem) {
    if (!fabricCanvas) return
    const previousProject = createProjectFile()
    try {
      newDoc()
      canvasWidth.value = template.width
      canvasHeight.value = template.height
      canvasBg.value = normalizeCanvasBg(template.background)
      if (!isTransparentCanvasBg(canvasBg.value)) lastOpaqueCanvasBg.value = canvasBg.value
      applyCanvasBgToFabric(canvasBg.value)
      applyCanvasSize()
      await importSVGText(template.svg, template.name)
      clearStoredDraft()
      resetHistoryToCurrentCanvas()
    } catch (error) {
      await loadProjectFile(previousProject, { keepDraft: true })
      showToast(error instanceof Error ? error.message : '应用模板失败', 'error')
    }
  }

  // ── 导入 ──
  // 打开隐藏的 SVG 文件选择器，保持顶栏导入入口和文件读取逻辑解耦。
  function importSVG() {
    svgInputRef.value?.click()
  }

  // 打开粘贴导入弹窗，用户可输入完整 SVG、path 标签或 path d 数据后复用同一套导入流程。
  function openPasteSVGDialog() {
    pasteSVGDialog.show = true
    pasteSVGDialog.error = ''
  }

  function importImage() {
    imgInputRef.value?.click()
  }

  // 从文件输入读取本地 SVG，导入失败时只重置输入框并保留当前画布内容。
  async function onSVGFileChosen(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    try {
      await importSVGFile(file)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入 SVG 失败', 'error')
    } finally {
      input.value = ''
    }
  }

  // 判断用户选择的文件是否可以按 SVG 文本解析，兼容系统 MIME 为空时的扩展名识别。
  function isSVGFile(file: File) {
    return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
  }

  // 从文件名提取导入对象的基础图层名，避免把扩展名展示到图层面板里。
  function getImportSVGDisplayName(fileName: string) {
    const baseName = fileName.replace(/\.svg$/i, '').trim()
    return baseName || 'SVG'
  }

  // 根据 Iconify 图标名生成简短图层名；保留集合前缀方便区分不同来源的同名图标。
  function getIconifyDisplayName(iconName: string) {
    const normalized = iconName.trim()
    return normalized ? `Iconify ${normalized}` : 'Iconify 图标'
  }

  // 借助浏览器实体解析能力解码 path 标签里的 d 属性，避免 &quot; 等实体进入 Fabric 解析。
  function decodeSVGAttribute(value: string) {
    const textarea = document.createElement('textarea')
    textarea.innerHTML = value
    return textarea.value
  }

  // 转义裸 path 数据后再包裹到 SVG 属性中，避免引号或尖括号破坏临时 SVG 结构。
  function escapeSVGAttribute(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  // 从单个 path 标签中提取 d 属性，支持单双引号并忽略其他属性。
  function extractPathDataFromPathElement(input: string) {
    const match = input.match(/<path\b[^>]*\sd\s*=\s*(["'])([\s\S]*?)\1[^>]*>/i)
    return match ? decodeSVGAttribute(match[2]).trim() : ''
  }

  // 粗略判断一段纯文本是否像 SVG path d 数据，防止普通文本被错误包裹成 SVG。
  function looksLikeSVGPathData(input: string) {
    if (!input || /<[^>]+>/.test(input)) return false
    if (!/[a-zA-Z]/.test(input) || !/[\d.]/.test(input)) return false
    return /^[\sMmZzLlHhVvCcSsQqTtAa\d.,+\-eE]+$/.test(input)
  }

  // 将粘贴内容归一为完整 SVG 文本，允许用户直接粘贴完整 SVG、path 标签或裸 path d 数据。
  function normalizePastedSVGText(input: string) {
    const text = input.trim()
    if (!text) throw new Error('请输入 SVG 代码或 path 数据')
    if (/<svg[\s>]/i.test(text)) return text
    const pathData = extractPathDataFromPathElement(text) || (looksLikeSVGPathData(text) ? text : '')
    if (!pathData) throw new Error('未识别到有效的 SVG 或 path d 数据')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="${escapeSVGAttribute(pathData)}" fill="#000000" /></svg>`
  }

  // 为导入对象补齐编辑器自定义元数据和可读图层名，确保后续图层、草稿和属性面板都能识别。
  // 命名走 nextNameUnique（SVG 导入链路专用）：首次导入不带序号，仅与画布现有对象重名时追加最小可用序号。
  function prepareImportedSVGObjectMetadata(obj: FabricObject, displayName: string, isRoot = true) {
    const target = obj as AnyFabricObject
    applyDefaultFillGradientMetadata(obj)
    applyDefaultKaleidoscopeMetadata(obj)
    applyDefaultEndpointSnapMargin(obj)
    normalizeEndpointAttachments(obj)
    ensureEditorObjectId(obj)
    if (isRoot) {
      target.name = nextNameUnique(displayName)
    } else if (!String(target.name || '').trim()) {
      target.name = nextNameUnique('SVG 元素')
    }
    if (isFillEnabled(obj.fill) && typeof obj.fill === 'string') {
      target.lastFill = obj.fill
    }
    if (isStrokeEnabled(obj.stroke, obj.strokeWidth)) {
      if (typeof obj.stroke === 'string') target.lastStroke = obj.stroke
      target.lastStrokeWidth = obj.strokeWidth || target.lastStrokeWidth || 1
      target.lastStrokeDashArray = normalizeStrokeDashArray(obj.strokeDashArray)
        ?? getDefaultStrokeDashArray(target.lastStrokeWidth)
    }
    if (obj instanceof Group) {
      obj.getObjects().forEach((child) => prepareImportedSVGObjectMetadata(child, displayName, false))
    }
    obj.setCoords()
  }

  // 将导入 SVG 放到画布中心；fitToCanvas 为 true 时超出画布会按比例缩小以便立即看到和操作，
  // 为 false 时保持原始尺寸 1:1 导入（是否越界由调用方决定如何提示），两者都会做居中摆放。
  function placeImportedSVGObject(obj: FabricObject, fitToCanvas = true) {
    obj.setCoords()
    let bounds = obj.getBoundingRect()
    if (fitToCanvas) {
      const maxWidth = canvasWidth.value * 0.82
      const maxHeight = canvasHeight.value * 0.82
      const scaleRatio = Math.min(
        1,
        bounds.width > 0 ? maxWidth / bounds.width : 1,
        bounds.height > 0 ? maxHeight / bounds.height : 1
      )
      if (Number.isFinite(scaleRatio) && scaleRatio > 0 && scaleRatio < 1) {
        obj.set({
          scaleX: (obj.scaleX || 1) * scaleRatio,
          scaleY: (obj.scaleY || 1) * scaleRatio
        })
        obj.setCoords()
        bounds = obj.getBoundingRect()
      }
    }
    const dx = canvasWidth.value / 2 - (bounds.left + bounds.width / 2)
    const dy = canvasHeight.value / 2 - (bounds.top + bounds.height / 2)
    obj.set({
      left: (obj.left || 0) + dx,
      top: (obj.top || 0) + dy
    })
    obj.setCoords()
  }

  // SVG 导入的附加行为：fitToCanvas 控制是否按画布适配缩小，scale 为显式缩放倍数（默认 1）。
  type SVGImportOptions = { fitToCanvas?: boolean; scale?: number }

  // 使用 Fabric 的 SVG 解析能力把完整 SVG 文本转换成一个可编辑对象，并加入当前画布。
  // 默认保持“超出画布时适配缩小”的导入行为；传 fitToCanvas: false 可 1:1 导入原始尺寸。
  async function importSVGText(svgText: string, displayName: string, importOptions: SVGImportOptions = {}) {
    if (!fabricCanvas) return
    clearBooleanPreview()
    clearPointEditing()
    const normalizedText = svgText.trim()
    if (!normalizedText) throw new Error('SVG 内容为空')
    if (!/<svg[\s>]/i.test(normalizedText)) throw new Error('未找到有效的 <svg> 内容')
    const { objects, options } = await loadSVGFromString(normalizedText)
    const svgObjects = objects.filter((obj): obj is FabricObject => !!obj)
    if (!svgObjects.length) throw new Error('SVG 中没有可导入的图形')
    const imported = util.groupSVGElements(svgObjects, options) as FabricObject
    prepareImportedSVGObjectMetadata(imported, displayName)
    // 显式缩放在居中摆放前应用，保证缩放后的包围盒参与居中计算。
    if (Number.isFinite(importOptions.scale) && (importOptions.scale ?? 1) > 0 && importOptions.scale !== 1) {
      imported.set({
        scaleX: (imported.scaleX || 1) * (importOptions.scale as number),
        scaleY: (imported.scaleY || 1) * (importOptions.scale as number)
      })
    }
    placeImportedSVGObject(imported, importOptions.fitToCanvas !== false)
    fabricCanvas.add(imported as AnyFabricObject)
    refreshLayers()
    fabricCanvas.setActiveObject(imported)
    syncActiveObjectPreservingPointMode(imported)
    fabricCanvas.requestRenderAll()
  }

  // 使用 Fabric 的 SVG 解析能力把本地 SVG 文本转换成一个可编辑对象，并加入当前画布。
  async function importSVGFile(file: File) {
    if (!fabricCanvas) return
    if (!isSVGFile(file)) throw new Error('请选择 .svg 文件')
    await importSVGText(await file.text(), getImportSVGDisplayName(file.name))
  }

  // 调用 Iconify 在线搜索接口并展示前若干个图标名；失败时保留上一次输入，方便用户换关键词重试。
  async function searchIconifyIcons() {
    const query = iconifySearch.query.trim()
    if (!query || iconifySearch.loading) return
    iconifySearch.loading = true
    iconifySearch.error = ''
    iconifySearch.lastQuery = query
    try {
      const response = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${ICONIFY_SEARCH_LIMIT}`)
      if (!response.ok) throw new Error(`Iconify 搜索失败：${response.status}`)
      const data = await response.json() as IconifySearchResponse
      const icons = Array.isArray(data.icons) ? data.icons.filter((item): item is string => typeof item === 'string') : []
      iconifySearch.results = icons
      iconifySearch.collectionFilter = ''
      iconifySearch.total = Number.isFinite(Number(data.total)) ? Number(data.total) : icons.length
    } catch (error) {
      iconifySearch.results = []
      iconifySearch.collectionFilter = ''
      iconifySearch.total = 0
      iconifySearch.error = error instanceof Error ? error.message : 'Iconify 搜索失败'
    } finally {
      iconifySearch.loading = false
    }
  }

  // 将 Iconify 的 `collection:name` 图标名转换成 SVG API 地址，并指定黑色填充便于 Fabric 正确解析为可编辑颜色。
  function buildIconifySVGUrl(iconName: string) {
    const [prefix, ...nameParts] = iconName.split(':')
    const name = nameParts.join(':')
    if (!prefix || !name) throw new Error('Iconify 图标名格式无效')
    const path = `${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`
    return `https://api.iconify.design/${path}?width=64&height=64&color=%23000000`
  }

  // 获取指定 Iconify 图标的 SVG 并复用 SVG 导入流程，使插入结果保持可改色、缩放和导出。
  async function insertIconifyIcon(iconName: string) {
    if (!fabricCanvas || iconifySearch.inserting) return
    iconifySearch.inserting = iconName
    iconifySearch.error = ''
    try {
      const response = await fetch(buildIconifySVGUrl(iconName))
      if (!response.ok) throw new Error(`Iconify 图标获取失败：${response.status}`)
      await importSVGText(await response.text(), getIconifyDisplayName(iconName))
    } catch (error) {
      iconifySearch.error = error instanceof Error ? error.message : 'Iconify 图标插入失败'
    } finally {
      iconifySearch.inserting = ''
    }
  }

  // 关闭粘贴弹窗时清理临时输入和错误状态，避免下一次打开沿用旧数据。
  function handlePasteSVGDialogShowChange(show: boolean) {
    pasteSVGDialog.show = show
    if (show) return
    pasteSVGDialog.value = ''
    pasteSVGDialog.error = ''
    pasteSVGDialog.loading = false
  }

  // 主动读取系统剪贴板文本填入弹窗；浏览器权限或空内容异常会展示在弹窗内。
  async function readClipboardIntoPasteSVGDialog() {
    pasteSVGDialog.error = ''
    try {
      const text = await navigator.clipboard?.readText?.()
      if (!text || !text.trim()) throw new Error('剪贴板中没有可读取的文本')
      pasteSVGDialog.value = text
    } catch (error) {
      pasteSVGDialog.error = error instanceof Error ? error.message : '读取剪贴板失败'
    }
  }

  // 校验并导入弹窗内的 SVG / path 文本，失败时保留输入以便用户继续修改。
  async function confirmPasteSVGImport() {
    if (pasteSVGDialog.loading) return
    pasteSVGDialog.error = ''
    pasteSVGDialog.loading = true
    try {
      await importSVGText(normalizePastedSVGText(pasteSVGDialog.value), '粘贴 SVG')
      handlePasteSVGDialogShowChange(false)
    } catch (error) {
      pasteSVGDialog.error = error instanceof Error ? error.message : '导入 SVG 失败'
    } finally {
      pasteSVGDialog.loading = false
    }
  }

  // 监听画布区域拖入文件，支持 SVG 和位图导入。
  function handleCanvasDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  // 处理文件拖放导入，按类型分发到 SVG 或位图导入流程。
  async function handleCanvasDrop(e: DragEvent) {
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    for (const file of files) {
      if (isSVGFile(file)) {
        try {
          await importSVGFile(file)
        } catch (error) {
          showToast(error instanceof Error ? error.message : '导入 SVG 失败', 'error')
        }
      } else if (file.type.startsWith('image/')) {
        try {
          await importImageFile(file)
        } catch (error) {
          showToast(error instanceof Error ? error.message : '导入图片失败', 'error')
        }
      }
    }
  }

  // 把本地图片文件导入为 Fabric Image，并补齐编辑器元数据后放到画布中心附近。
  // 先用 FileReader 读成 base64 dataURL 再建图，使对象 src 可随工程 JSON 持久化，刷新后仍能恢复；
  // 读取或解码失败时异常向上抛出，由调用方统一 toast 提示。
  async function importImageFile(file: File) {
    if (!fabricCanvas) return
    const dataUrl = await readFileAsDataURL(file)
    const img = await FabricImage.fromURL(dataUrl)
    applyDefaultKaleidoscopeMetadata(img)
    applyDefaultEndpointSnapMargin(img)
    img.set({
      left: canvasWidth.value / 2 - (img.width || 60) / 2,
      top: canvasHeight.value / 2 - (img.height || 60) / 2,
      name: nextName(file.name)
    })
    ensureEditorObjectId(img)
    img.setCoords()
    fabricCanvas.add(img)
    refreshLayers()
    fabricCanvas.setActiveObject(img)
    syncActiveObjectPreservingPointMode(img)
    fabricCanvas.requestRenderAll()
    snapshot()
  }

  // 把本地图片文件导入为 Fabric Image，并补齐编辑器元数据后放到画布中心附近。
  async function onImageFileChosen(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      await importImageFile(file)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入图片失败', 'error')
    } finally {
      ;(e.target as HTMLInputElement).value = ''
    }
  }

  // 监听全局粘贴事件，支持从剪贴板导入 SVG 文本或位图。
  async function handleWindowPaste(e: ClipboardEvent) {
    if (!fabricCanvas) return
    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) return
    const items = Array.from(e.clipboardData?.items ?? [])
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        try {
          await importImageFile(file)
          return
        } catch (error) {
          console.error('粘贴图片失败:', error)
          showToast('粘贴图片失败，请检查图片格式是否支持', 'error')
          return
        }
      }
    }
    const text = e.clipboardData?.getData('text/plain')?.trim()
    if (!text) return
    if (/<svg[\s>]/i.test(text) || /<path[\s>]/i.test(text)) {
      try {
        await importSVGText(normalizePastedSVGText(text), '粘贴 SVG')
      } catch (error) {
        console.error('粘贴 SVG 失败:', error)
        showToast('粘贴 SVG 失败，请检查 SVG 代码是否有效', 'error')
      }
    }
  }

  // ── 导出 ──
  const previewStageClass = computed(() => `preview-bg-${previewBackgroundMode.value}`)

  // 控制小尺寸预览背景，不影响真实画布背景，仅用于透明、浅色和深色环境下检查可读性。
  function setPreviewBackgroundMode(mode: PreviewBackgroundMode) {
    previewBackgroundMode.value = mode
  }

  // 标记小尺寸预览需要更新，并用短延迟合并连续编辑产生的多次画布事件。
  function scheduleSmallPreviewsRefresh() {
    previewDirty.value = true
    if (previewRenderTimer != null) window.clearTimeout(previewRenderTimer)
    previewRenderTimer = window.setTimeout(() => {
      previewRenderTimer = null
      refreshSmallPreviews()
    }, 120)
  }

  // 取消等待中的预览刷新计时器，组件卸载或画布销毁前调用以避免访问失效画布。
  function cancelSmallPreviewsRefresh() {
    if (previewRenderTimer == null) return
    window.clearTimeout(previewRenderTimer)
    previewRenderTimer = null
  }

  // 按 16/24/32/48 等标准小图标尺寸生成预览缩略图，复用 PNG 渲染逻辑保证和导出效果一致。
  function refreshSmallPreviews() {
    if (!fabricCanvas) return
    cancelSmallPreviewsRefresh()
    const aspectRatio = canvasHeight.value / canvasWidth.value
    previewItems.value = SMALL_PREVIEW_SIZE_OPTIONS.map((size) => ({
      size,
      width: size,
      height: Math.max(1, Math.round(size * aspectRatio)),
      dataUrl: renderPNGDataUrl(size, true)
    }))
    previewDirty.value = false
  }

  // 在预览浮层可见时立即补齐过期缩略图；关闭时只记录 dirty，避免后台频繁生成 dataURL。
  function markSmallPreviewsDirty() {
    previewDirty.value = true
    if (previewPopoverVisible.value) scheduleSmallPreviewsRefresh()
  }

  // ── 对象操作 ──
  function deleteObjects(objects?: FabricObject[]) {
    if (!fabricCanvas) return
    const selectedObjects = fabricCanvas.getActiveObjects()
    const targets = (objects ?? selectedObjects).filter((obj) => fabricCanvas!.getObjects().includes(obj))
    if (!targets.length) return
    const shouldClearSelection = !objects || targets.some((obj) => selectedObjects.includes(obj))
    if (shouldClearSelection) {
      clearPointEditing()
      fabricCanvas.discardActiveObject()
      syncActiveObject(null)
    }
    withSnapshotSuppressed(() => {
      targets.forEach((obj) => {
        removeEndpointAttachmentsReferencing(obj)
        fabricCanvas!.remove(obj as AnyFabricObject)
      })
    })
    refreshLayers()
    if (shouldClearSelection) {
      fabricCanvas.discardActiveObject()
      syncActiveObject(null)
    }
    fabricCanvas.requestRenderAll()
    snapshot()
  }

  function deleteObject() {
    deleteObjects()
  }

  function lockObject() {
    const obj = activeObject.value
    if (!obj) return
    const locked = !obj.lockMovementX
    obj.set({
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      lockRotation: locked,
      hasControls: !locked,
      selectable: true
    })
    fabricCanvas?.requestRenderAll()
    refreshActiveObject()
    snapshot()
  }

  function groupObjects() {
    const obj = activeObject.value
    if (!(obj instanceof ActiveSelection) || !fabricCanvas) return
    const objs = obj.removeAll() as AnyFabricObject[]
    const group = new Group(objs, {
      canvas: fabricCanvas as any
    } as any)
    ;(group as any).name = nextName('组')
    withSnapshotSuppressed(() => {
      fabricCanvas!.remove(...objs)
      fabricCanvas!.add(group)
    })
    refreshLayers()
    fabricCanvas.setActiveObject(group)
    syncActiveObject(group)
    fabricCanvas.requestRenderAll()
    snapshot()
  }

  function ungroupObject() {
    const obj = activeObject.value
    if (!(obj instanceof Group) || !fabricCanvas) return
    const items = obj.removeAll()
    withSnapshotSuppressed(() => {
      fabricCanvas!.remove(obj)
      for (const item of items) {
        fabricCanvas!.add(item)
      }
    })
    fabricCanvas.discardActiveObject()
    syncActiveObject(null)
    refreshLayers()
    fabricCanvas.requestRenderAll()
    snapshot()
  }

  /**
   * 设置对象图层名，并同步图层面板与属性面板的显示（图层面板重命名弹窗与 MCP 命名共用该语义）。
   * name 去除首尾空白后为空、或与当前名称一致时不做任何变更并返回 false；
   * 实际写入时产生一条撤销快照并返回 true。
   */
  function setObjectName(object: FabricObject, name: string): boolean {
    if (!fabricCanvas) return false
    const trimmed = name.trim()
    if (!trimmed) return false
    const typed = object as AnyFabricObject
    const currentName = String(typed.name ?? '')
    if (currentName === trimmed) return false
    typed.name = trimmed
    refreshLayers()
    refreshActiveObject()
    fabricCanvas.requestRenderAll()
    snapshot()
    return true
  }

  /**
   * 对给定对象集合执行布尔运算的核心实现：过滤不可直接参与的对象（万花筒实例、
   * 布尔预览对象），运算成功后选中结果对象并产生一条撤销快照。
   * 界面布尔按钮与 MCP 程序化调用共用；返回结果对象或带中文说明的错误。
   */
  async function runBooleanOperationOnObjects(
    objects: FabricObject[],
    operation: BooleanOperation,
    subtractDirection: SubtractDirection = 'forward'
  ): Promise<{ result?: FabricObject; error?: string }> {
    if (!fabricCanvas) return { error: '画布尚未初始化' }
    clearBooleanPreview()
    clearPointEditing()
    if (objects.length < 2) return { error: '请至少选择 2 个对象' }

    const canvasObjects = fabricCanvas.getObjects()
    const targets = objects
      .filter((obj) => canvasObjects.includes(obj) && !isBooleanPreviewObject(obj) && !isKaleidoscopeInstance(obj))
    if (targets.length < 2) {
      return { error: '可参与布尔运算的对象不足 2 个（万花筒实例与布尔预览对象不参与运算）' }
    }

    skipSnapshot = true
    try {
      const { result, error } = await applyBooleanOperation({
        canvas: fabricCanvas,
        operation,
        objects: targets,
        makeName: nextName,
        subtractDirection
      })
      if (error || !result) {
        return { error: error || '布尔运算失败' }
      }
      syncActiveObject(result)
      refreshLayers()
      return { result }
    } finally {
      skipSnapshot = false
    }
  }

  async function runBooleanOperation(operation: BooleanOperation, subtractDirection: SubtractDirection = 'forward') {
    if (!fabricCanvas || booleanBusy.value) return
    subtractPopoverVisible.value = false
    booleanBusy.value = true
    booleanError.value = ''
    try {
      const objects = fabricCanvas.getActiveObjects()
      const { result, error } = await runBooleanOperationOnObjects(objects, operation, subtractDirection)
      if (error || !result) {
        booleanError.value = error || '布尔运算失败'
        return
      }
      snapshot()
    } finally {
      booleanBusy.value = false
    }
  }

  // 生成描边轮廓对象使用的填充样式：用原描边色填充轮廓，并关闭新对象自身描边。
  function createStrokeOutlineStyle(style: FabricBooleanStyleSnapshot): FabricBooleanStyleSnapshot {
    const fill = typeof style.stroke === 'string' && isFillEnabled(style.stroke)
      ? style.stroke
      : style.lastStroke || '#000000'
    return {
      ...style,
      fill,
      stroke: 'transparent',
      strokeWidth: 0,
      strokeDashArray: null,
      lastFill: fill,
      fillMode: 'solid',
      fillGradientType: undefined,
      fillGradientStops: undefined,
      fillGradientAngle: undefined,
      fillGradientCenterX: undefined,
      fillGradientCenterY: undefined,
      fillGradientRadius: undefined
    }
  }

  // 批量描边转轮廓失败时回滚已完成的对象替换，尽量恢复到转换前的画布结构和源对象描边状态。
  function rollbackStrokeOutlineConversions(results: StrokeOutlineResult[]) {
    if (!fabricCanvas) return
    results.slice().reverse().forEach(({ source, outline, sourceIndex, keepFilledSource, style }) => {
      if (fabricCanvas!.getObjects().includes(outline)) {
        fabricCanvas!.remove(outline as AnyFabricObject)
      }
      if (keepFilledSource) {
        source.set({
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          strokeDashArray: style.strokeDashArray ? [...style.strokeDashArray] : null
        })
        ;(source as AnyFabricObject).lastStroke = style.lastStroke
        ;(source as AnyFabricObject).lastStrokeWidth = style.lastStrokeWidth
        ;(source as AnyFabricObject).lastStrokeDashArray = style.lastStrokeDashArray ? [...style.lastStrokeDashArray] : null
      } else if (!fabricCanvas!.getObjects().includes(source)) {
        fabricCanvas!.insertAt(Math.min(sourceIndex, fabricCanvas!.getObjects().length), source as AnyFabricObject)
      }
      source.dirty = true
      source.setCoords()
    })
  }

  // 把单个对象的可见描边转换成独立可编辑路径；有填充的源对象保留填充但移除描边以维持视觉效果。
  async function convertObjectStrokeToOutline(obj: FabricObject): Promise<StrokeOutlineResult> {
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    const pathKit = await getPathKit()
    const sourceIndex = Math.max(0, fabricCanvas.getObjects().indexOf(obj))
    const converted = fabricStrokeToPathKitWithApi(pathKit, obj)
    if (converted.error) throw new Error(converted.error)
    if (!converted.path || !converted.style) throw new Error('描边轮廓转换失败')
    try {
      const outline = pathKitToFabricPath(converted.path, {
        name: nextName(`${getObjectDisplayName(obj)} 轮廓`),
        shapeId: 'stroke-outline',
        style: createStrokeOutlineStyle(converted.style),
        sourceCornerRadius: null
      })
      if (!outline) throw new Error('描边轮廓转换失败')
      applyDefaultEndpointSnapMargin(outline)
      ensureEditorObjectId(outline)
      applyCanvasThemeToObject(outline)
      const keepFilledSource = isFillEnabled(obj.fill)
      if (keepFilledSource) {
        obj.set({ stroke: 'transparent', strokeWidth: 0, strokeDashArray: null })
        ;(obj as AnyFabricObject).lastStroke = converted.style.lastStroke
        ;(obj as AnyFabricObject).lastStrokeWidth = converted.style.lastStrokeWidth
        obj.dirty = true
        obj.setCoords()
        fabricCanvas.insertAt(Math.min(sourceIndex + 1, fabricCanvas.getObjects().length), outline as AnyFabricObject)
      } else {
        removeEndpointAttachmentsReferencing(obj)
        fabricCanvas.remove(obj as AnyFabricObject)
        fabricCanvas.insertAt(Math.min(sourceIndex, fabricCanvas.getObjects().length), outline as AnyFabricObject)
      }
      return { source: obj, outline, sourceIndex, keepFilledSource, style: converted.style }
    } finally {
      converted.path.delete()
    }
  }

  // 对当前选择批量执行描边转轮廓；转换前先完整校验所有对象，避免一部分对象已转换后才因后续对象失败而留下半成品。
  async function convertSelectionStrokeToOutline() {
    if (!fabricCanvas || strokeOutlineBusy.value) return
    const canvasObjects = fabricCanvas.getObjects()
    const targets = fabricCanvas.getActiveObjects()
      .filter((obj) => canvasObjects.includes(obj) && !isBooleanPreviewObject(obj))
      .sort((a, b) => canvasObjects.indexOf(a) - canvasObjects.indexOf(b))
    if (!targets.length) return

    const unsupportedReason = targets
      .map((target) => getStrokeOutlineUnsupportedReason(target))
      .find((reason): reason is string => !!reason)
    if (unsupportedReason) {
      booleanError.value = unsupportedReason
      return
    }

    strokeOutlineBusy.value = true
    booleanError.value = ''
    clearBooleanPreview()
    clearPointEditing()
    const outlines: FabricObject[] = []
    const convertedResults: StrokeOutlineResult[] = []
    skipSnapshot = true
    try {
      fabricCanvas.discardActiveObject()
      for (const target of targets) {
        const result = await convertObjectStrokeToOutline(target)
        convertedResults.push(result)
        outlines.push(result.outline)
      }
    } catch (error) {
      rollbackStrokeOutlineConversions(convertedResults)
      outlines.length = 0
      booleanError.value = error instanceof Error ? error.message : '描边转轮廓失败'
    } finally {
      skipSnapshot = false
      strokeOutlineBusy.value = false
    }
    if (!outlines.length) {
      fabricCanvas.requestRenderAll()
      return
    }
    setSelectionMode('shape')
    applyActiveObjectsSelection(outlines)
    refreshLayers()
    fabricCanvas.requestRenderAll()
    snapshot()
  }

  // 根据当前画布尺寸选择文字追踪倍率，避免超大画布在文字转轮廓时生成过大的离屏位图。
  function getTextOutlineTraceMultiplier() {
    const maxSide = Math.max(canvasWidth.value, canvasHeight.value, 1)
    return Math.max(0.5, Math.min(TEXT_OUTLINE_TRACE_MULTIPLIER, 1536 / maxSide))
  }

  // 仅渲染目标文字到透明离屏画布，后续通过 alpha 蒙版追踪出近似轮廓路径。
  function renderTextObjectMaskCanvas(text: Textbox, multiplier: number) {
    if (!fabricCanvas) return null
    const currentZoom = fabricCanvas.getZoom()
    const currentWidth = fabricCanvas.getWidth()
    const currentHeight = fabricCanvas.getHeight()
    const currentBg = fabricCanvas.backgroundColor
    const visibility = new Map<FabricObject, boolean | undefined>()
    fabricCanvas.getObjects().forEach((obj) => visibility.set(obj, obj.visible))
    try {
      text.exitEditing?.()
      fabricCanvas.discardActiveObject()
      fabricCanvas.setZoom(1)
      fabricCanvas.setDimensions({ width: canvasWidth.value, height: canvasHeight.value })
      fabricCanvas.backgroundColor = ''
      fabricCanvas.getObjects().forEach((obj) => {
        obj.visible = obj === text
      })
      text.visible = true
      fabricCanvas.requestRenderAll()
      return (fabricCanvas as any).toCanvasElement({ multiplier, enableRetinaScaling: false }) as HTMLCanvasElement
    } finally {
      visibility.forEach((visible, obj) => { obj.visible = visible })
      fabricCanvas.backgroundColor = currentBg
      fabricCanvas.setZoom(currentZoom)
      fabricCanvas.setDimensions({ width: currentWidth, height: currentHeight })
      fabricCanvas.requestRenderAll()
    }
  }

  // 将文字位图的 alpha 蒙版按横向连续像素段写成 PathKit 矩形路径，再交给 simplify 合并为轮廓。
  function createPathFromTextMask(pathKit: any, maskCanvas: HTMLCanvasElement, multiplier: number) {
    const ctx = maskCanvas.getContext('2d')
    if (!ctx) return null
    const { width, height } = maskCanvas
    const data = ctx.getImageData(0, 0, width, height).data
    const path = pathKit.NewPath()
    let hasPixels = false
    for (let y = 0; y < height; y += 1) {
      let x = 0
      while (x < width) {
        const alpha = data[(y * width + x) * 4 + 3]
        if (alpha <= TEXT_OUTLINE_ALPHA_THRESHOLD) {
          x += 1
          continue
        }
        const startX = x
        while (x < width && data[(y * width + x) * 4 + 3] > TEXT_OUTLINE_ALPHA_THRESHOLD) x += 1
        path.rect(startX / multiplier, y / multiplier, (x - startX) / multiplier, 1 / multiplier)
        hasPixels = true
      }
    }
    if (!hasPixels) {
      path.delete()
      return null
    }
    path.simplify?.()
    return path
  }

  // 生成文字轮廓路径的样式，使用原文字填充色或描边色作为轮廓填充色。
  function createTextOutlineStyle(text: Textbox): FabricBooleanStyleSnapshot {
    const fill = typeof text.fill === 'string' && isFillEnabled(text.fill)
      ? text.fill
      : typeof text.stroke === 'string' && isFillEnabled(text.stroke)
        ? text.stroke
        : '#000000'
    return {
      fill,
      stroke: 'transparent',
      strokeWidth: 0,
      strokeDashArray: null,
      opacity: text.opacity ?? 1,
      strokeUniform: false,
      fillRule: 'nonzero',
      lastFill: fill,
      lastStroke: typeof text.stroke === 'string' ? text.stroke : undefined,
      lastStrokeWidth: Number(text.strokeWidth || 0),
      lastStrokeDashArray: null,
      fillMode: 'solid'
    }
  }

  // 将单个 Fabric Textbox 近似追踪为可编辑填充路径，并放回原文字所在图层位置。
  async function convertTextObjectToOutline(text: Textbox) {
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    const sourceIndex = Math.max(0, fabricCanvas.getObjects().indexOf(text))
    const multiplier = getTextOutlineTraceMultiplier()
    const maskCanvas = renderTextObjectMaskCanvas(text, multiplier)
    if (!maskCanvas) throw new Error('文字轮廓渲染失败')
    const pathKit = await getPathKit()
    const tracedPath = createPathFromTextMask(pathKit, maskCanvas, multiplier)
    if (!tracedPath) throw new Error('未识别到可转换的文字轮廓')
    try {
      const outline = pathKitToFabricPath(tracedPath, {
        name: nextName(`${getObjectDisplayName(text)} 轮廓`),
        shapeId: 'text-outline',
        style: createTextOutlineStyle(text),
        sourceCornerRadius: null
      })
      if (!outline) throw new Error('文字轮廓转换失败')
      applyDefaultEndpointSnapMargin(outline)
      ensureEditorObjectId(outline)
      applyCanvasThemeToObject(outline)
      removeEndpointAttachmentsReferencing(text)
      fabricCanvas.remove(text as AnyFabricObject)
      fabricCanvas.insertAt(Math.min(sourceIndex, fabricCanvas.getObjects().length), outline as AnyFabricObject)
      return outline
    } finally {
      tracedPath.delete()
    }
  }

  // 对当前选中文字批量执行文字转轮廓，输出为可点位编辑、可导出的近似矢量路径。
  async function convertSelectionTextToOutline() {
    if (!fabricCanvas || textOutlineBusy.value) return
    const canvasObjects = fabricCanvas.getObjects()
    const targets = fabricCanvas.getActiveObjects()
      .filter((obj): obj is Textbox => obj instanceof Textbox && canvasObjects.includes(obj))
      .sort((a, b) => canvasObjects.indexOf(a) - canvasObjects.indexOf(b))
    if (!targets.length) return

    textOutlineBusy.value = true
    booleanError.value = ''
    clearBooleanPreview()
    clearPointEditing()
    const outlines: FabricObject[] = []
    skipSnapshot = true
    try {
      fabricCanvas.discardActiveObject()
      for (const target of targets) {
        outlines.push(await convertTextObjectToOutline(target))
      }
    } catch (error) {
      booleanError.value = error instanceof Error ? error.message : '文字转轮廓失败'
    } finally {
      skipSnapshot = false
      textOutlineBusy.value = false
    }
    if (!outlines.length) {
      fabricCanvas.requestRenderAll()
      return
    }
    setSelectionMode('shape')
    applyActiveObjectsSelection(outlines)
    refreshLayers()
    fabricCanvas.requestRenderAll()
    snapshot()
  }

  /**
   * 把单个文本对象转曲为可编辑路径（MCP outline_text 的运行时入口）。
   * 校验目标必须是文本对象（Text/Textbox/IText），转换期间抑制自动快照，
   * 完成后选中新的路径对象并提交一条"文字转曲"撤销记录，返回新对象 id。
   * 转曲结果由现有位图追踪 + PathKit 重建链路生成 EditablePathObject，
   * 字形固化为路径数据，不再依赖系统字体。
   */
  async function outlineTextToPath(target: FabricObject): Promise<string> {
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    if (!(target instanceof Text)) {
      throw new Error(`仅文本对象支持转曲，当前对象类型为: ${target.type ?? 'unknown'}`)
    }
    if (textOutlineBusy.value) throw new Error('文字转曲正在执行中，请稍后重试')
    textOutlineBusy.value = true
    const previousSkipSnapshot = skipSnapshot
    let outline: FabricObject
    try {
      // 转换内部会移除并重新插入对象（触发 object:added/removed 自动快照），抑制为一条记录。
      skipSnapshot = true
      try {
        outline = await convertTextObjectToOutline(target as Textbox)
      } finally {
        skipSnapshot = previousSkipSnapshot
      }
    } finally {
      textOutlineBusy.value = false
    }
    setSelectionMode('shape')
    applyActiveObjectsSelection([outline])
    refreshLayers()
    fabricCanvas.requestRenderAll()
    snapshot({ description: '文字转曲' })
    return ensureEditorObjectId(outline)
  }

  // 将图片转矢量阈值限制在 0-255，避免无效输入导致黑白追踪结果全空或全满。
  function normalizeBitmapTraceThreshold(value: unknown) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return BITMAP_VECTOR_DEFAULT_THRESHOLD
    return Math.max(0, Math.min(255, parsed))
  }

  // 切换位图追踪模式：透明模式提取非透明轮廓，黑白模式按亮度阈值提取深色区域。
  function setBitmapTraceMode(mode: BitmapTraceMode) {
    objProps.bitmapTraceMode = mode
  }

  // 提交黑白位图追踪阈值输入，非法值回退到默认阈值并同步面板显示。
  function setBitmapTraceThresholdFromInput(value: string | number) {
    const normalized = normalizeBitmapTraceThreshold(value)
    objProps.bitmapTraceThreshold = normalized
    objProps.bitmapTraceThresholdInput = String(normalized)
  }

  // 根据画布尺寸选择位图追踪倍率，控制离屏像素总量，避免大画布转换时占用过多内存。
  function getBitmapVectorTraceMultiplier() {
    const maxSide = Math.max(canvasWidth.value, canvasHeight.value, 1)
    return Math.max(0.25, Math.min(BITMAP_VECTOR_TRACE_MULTIPLIER, BITMAP_VECTOR_MAX_TRACE_SIDE / maxSide))
  }

  // 仅渲染目标图片到透明离屏画布，保留其缩放、旋转和位置后再进行像素蒙版追踪。
  function renderBitmapObjectMaskCanvas(image: FabricImage, multiplier: number) {
    if (!fabricCanvas) return null
    const currentZoom = fabricCanvas.getZoom()
    const currentWidth = fabricCanvas.getWidth()
    const currentHeight = fabricCanvas.getHeight()
    const currentBg = fabricCanvas.backgroundColor
    const visibility = new Map<FabricObject, boolean | undefined>()
    fabricCanvas.getObjects().forEach((obj) => visibility.set(obj, obj.visible))
    try {
      fabricCanvas.discardActiveObject()
      fabricCanvas.setZoom(1)
      fabricCanvas.setDimensions({ width: canvasWidth.value, height: canvasHeight.value })
      fabricCanvas.backgroundColor = ''
      fabricCanvas.getObjects().forEach((obj) => {
        obj.visible = obj === image
      })
      image.visible = true
      fabricCanvas.requestRenderAll()
      return (fabricCanvas as any).toCanvasElement({ multiplier, enableRetinaScaling: false }) as HTMLCanvasElement
    } finally {
      visibility.forEach((visible, obj) => { obj.visible = visible })
      fabricCanvas.backgroundColor = currentBg
      fabricCanvas.setZoom(currentZoom)
      fabricCanvas.setDimensions({ width: currentWidth, height: currentHeight })
      fabricCanvas.requestRenderAll()
    }
  }

  // 判断位图像素是否应进入追踪蒙版；透明模式看 alpha，黑白模式额外按亮度阈值筛选深色像素。
  function shouldTraceBitmapPixel(data: Uint8ClampedArray, offset: number, mode: BitmapTraceMode, threshold: number) {
    const alpha = data[offset + 3]
    if (alpha <= BITMAP_VECTOR_ALPHA_THRESHOLD) return false
    if (mode === 'alpha') return true
    const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722
    return luminance <= threshold
  }

  // 将位图蒙版按横向连续像素段写成 PathKit 矩形路径，再简化为可编辑矢量轮廓。
  function createPathFromBitmapMask(pathKit: any, maskCanvas: HTMLCanvasElement, multiplier: number, mode: BitmapTraceMode, threshold: number) {
    const ctx = maskCanvas.getContext('2d')
    if (!ctx) return null
    const { width, height } = maskCanvas
    const data = ctx.getImageData(0, 0, width, height).data
    const path = pathKit.NewPath()
    let hasPixels = false
    for (let y = 0; y < height; y += 1) {
      let x = 0
      while (x < width) {
        const offset = (y * width + x) * 4
        if (!shouldTraceBitmapPixel(data, offset, mode, threshold)) {
          x += 1
          continue
        }
        const startX = x
        while (x < width && shouldTraceBitmapPixel(data, (y * width + x) * 4, mode, threshold)) x += 1
        path.rect(startX / multiplier, y / multiplier, (x - startX) / multiplier, 1 / multiplier)
        hasPixels = true
      }
    }
    if (!hasPixels) {
      path.delete()
      return null
    }
    path.simplify?.()
    return path
  }

  // 生成图片追踪结果的基础样式，默认以黑色填充输出，保留源图片透明度便于视觉对照。
  function createBitmapVectorStyle(image: FabricImage): FabricBooleanStyleSnapshot {
    return {
      fill: '#000000',
      stroke: 'transparent',
      strokeWidth: 0,
      strokeDashArray: null,
      opacity: image.opacity ?? 1,
      strokeUniform: false,
      fillRule: 'nonzero',
      lastFill: '#000000',
      lastStroke: 'transparent',
      lastStrokeWidth: 0,
      lastStrokeDashArray: null,
      fillMode: 'solid'
    }
  }

  // 将单个 Fabric Image 栅格化追踪成可编辑路径，并替换到源图片所在图层位置。
  async function vectorizeBitmapObject(image: FabricImage) {
    if (!fabricCanvas) throw new Error('画布尚未初始化')
    const sourceIndex = Math.max(0, fabricCanvas.getObjects().indexOf(image))
    const multiplier = getBitmapVectorTraceMultiplier()
    const maskCanvas = renderBitmapObjectMaskCanvas(image, multiplier)
    if (!maskCanvas) throw new Error('图片追踪渲染失败')
    const pathKit = await getPathKit()
    const tracedPath = createPathFromBitmapMask(
      pathKit,
      maskCanvas,
      multiplier,
      objProps.bitmapTraceMode,
      normalizeBitmapTraceThreshold(objProps.bitmapTraceThreshold)
    )
    if (!tracedPath) throw new Error('未识别到可转换的图片轮廓，请调整追踪模式或阈值')
    try {
      const outline = pathKitToFabricPath(tracedPath, {
        name: nextName(`${getObjectDisplayName(image)} 矢量`),
        shapeId: 'bitmap-vector',
        style: createBitmapVectorStyle(image),
        sourceCornerRadius: null
      })
      if (!outline) throw new Error('图片转矢量失败')
      applyDefaultEndpointSnapMargin(outline)
      ensureEditorObjectId(outline)
      applyCanvasThemeToObject(outline)
      removeEndpointAttachmentsReferencing(image)
      fabricCanvas.remove(image as AnyFabricObject)
      fabricCanvas.insertAt(Math.min(sourceIndex, fabricCanvas.getObjects().length), outline as AnyFabricObject)
      return outline
    } finally {
      tracedPath.delete()
    }
  }

  // 对当前选中的一张或多张图片执行位图追踪，输出可点位编辑、可导出的黑白矢量路径。
  async function vectorizeSelectionBitmap() {
    if (!fabricCanvas || bitmapTraceBusy.value) return
    const canvasObjects = fabricCanvas.getObjects()
    const targets = fabricCanvas.getActiveObjects()
      .filter((obj): obj is FabricImage => obj instanceof FabricImage && canvasObjects.includes(obj))
      .sort((a, b) => canvasObjects.indexOf(a) - canvasObjects.indexOf(b))
    if (!targets.length) return

    bitmapTraceBusy.value = true
    booleanError.value = ''
    clearBooleanPreview()
    clearPointEditing()
    const outlines: FabricObject[] = []
    skipSnapshot = true
    try {
      fabricCanvas.discardActiveObject()
      for (const target of targets) {
        outlines.push(await vectorizeBitmapObject(target))
      }
    } catch (error) {
      booleanError.value = error instanceof Error ? error.message : '图片转矢量失败'
    } finally {
      skipSnapshot = false
      bitmapTraceBusy.value = false
    }
    if (!outlines.length) {
      fabricCanvas.requestRenderAll()
      return
    }
    setSelectionMode('shape')
    applyActiveObjectsSelection(outlines)
    refreshLayers()
    fabricCanvas.requestRenderAll()
    snapshot()
  }

  // ── 图层 ──
  function isLayerKaleidoscopeLocked(obj: FabricObject) {
    return isKaleidoscopeInstance(obj)
  }

  function layerUp() {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    fabricCanvas.bringObjectForward(obj as AnyFabricObject)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function layerDown() {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    fabricCanvas.sendObjectBackwards(obj as AnyFabricObject)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function layerTop() {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    fabricCanvas.bringObjectToFront(obj as AnyFabricObject)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function layerBottom() {
    const obj = activeObject.value
    if (!obj || !fabricCanvas) return
    fabricCanvas.sendObjectToBack(obj as AnyFabricObject)
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function showAllLayers() {
    if (!fabricCanvas) return
    const objects = fabricCanvas.getObjects()
    objects.forEach(obj => {
      obj.visible = true
    })
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function hideAllLayers() {
    if (!fabricCanvas) return
    const objects = fabricCanvas.getObjects()
    objects.forEach(obj => {
      obj.visible = false
    })
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function unlockAllLayers() {
    if (!fabricCanvas) return
    const objects = fabricCanvas.getObjects()
    objects.forEach(obj => {
      obj.lockMovementX = false
      obj.lockMovementY = false
      obj.lockScalingX = false
      obj.lockScalingY = false
      obj.lockRotation = false
      obj.hasControls = true
      obj.selectable = true
    })
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  function lockAllLayers() {
    if (!fabricCanvas) return
    const objects = fabricCanvas.getObjects()
    objects.forEach(obj => {
      obj.lockMovementX = true
      obj.lockMovementY = true
      obj.lockScalingX = false
      obj.lockScalingY = false
      obj.lockRotation = false
      obj.hasControls = true
      obj.selectable = true
    })
    fabricCanvas.requestRenderAll()
    refreshLayers()
    snapshot()
  }

  // 切换左侧插入面板显隐；仅调整壳层布局，不重置标签状态，确保当前插入分类在再次展开后保持原样。
  function toggleLeftPanel() {
    leftPanelCollapsed.value = !leftPanelCollapsed.value
  }

  // 切换钢笔描点工具：激活或退出（退出时按确认生成语义提交当前描点）；激活前退出油漆桶态。
  function togglePenTool() {
    if (paintBucketActive.value) paintBucketCommands.deactivate()
    if (penToolActive.value) {
      penCommands.deactivate(true)
    } else {
      penCommands.activate()
    }
  }

  // 切换底部轻量预览浮层显隐；展开时触发预览更新，收起时合并掉等待中的刷新计时器。
  function handlePreviewPopoverShowChange(show: boolean) {
    previewPopoverVisible.value = show
    if (!show) cancelSmallPreviewsRefresh()
  }

  // 在画布对象上打开与图层面板复用的快捷菜单；兼容 Fabric 命中结果，空白区或预览对象不触发菜单。
  function openCanvasObjectContextMenu(event: MouseEvent) {
    if (penToolActive.value || paintBucketActive.value) return
    if (!fabricCanvas) return
    const targetInfo = fabricCanvas.findTarget(event) as unknown
    const foundTarget = targetInfo && typeof targetInfo === 'object' && 'target' in targetInfo
      ? (targetInfo as { target?: FabricObject | ActiveSelection | null }).target
      : targetInfo as FabricObject | ActiveSelection | null | undefined
    const target = foundTarget instanceof ActiveSelection
      ? fabricCanvas.getActiveObjects().find((obj) => !isBooleanPreviewObject(obj))
      : foundTarget
    if (!target || isBooleanPreviewObject(target)) return
    openLayerContextMenu(target, event)
  }

  // 切换画布视图模式；SVG 模式只读展示当前画布导出的文本结果，不销毁真实 Fabric 画布节点。
  function setCanvasViewMode(mode: 'canvas' | 'svg') {
    canvasViewMode.value = mode
  }

  function isEditableTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
  }

  function isFabricTextboxEditing() {
    const obj = fabricCanvas?.getActiveObject() ?? activeObject.value
    return obj instanceof Textbox && obj.isEditing
  }

  function shouldIgnoreEditorShortcut(event: KeyboardEvent) {
    if (pasteSVGDialog.show || exportDialog.show) return true
    if (event.isComposing) return true
    if (isEditableTarget(event.target)) return true
    const target = event.target
    if (target instanceof HTMLElement) {
      if (target.closest('.shortcut-drawer') || target.closest('.zt-drawer__mask')) return true
      if (target.closest('.zt-hotkey-input')) return true
    }
    return isFabricTextboxEditing()
  }

  function getArrowNudgeDelta(key: string) {
    if (key === 'ArrowUp') return { dx: 0, dy: -1 }
    if (key === 'ArrowDown') return { dx: 0, dy: 1 }
    if (key === 'ArrowLeft') return { dx: -1, dy: 0 }
    if (key === 'ArrowRight') return { dx: 1, dy: 0 }
    return null
  }

  // 在画布区域按住 Ctrl + 滚轮时，以指针位置为锚点缩放并同步平移偏移，避免浏览器接管页面缩放。
  function handleCanvasAreaWheel(event: WheelEvent) {
    if (!event.ctrlKey || !canvasAreaRef.value) return
    event.preventDefault()
    const area = canvasAreaRef.value
    const rect = area.getBoundingClientRect()
    const pointerOffsetX = event.clientX - rect.left
    const pointerOffsetY = event.clientY - rect.top
    const currentZoom = zoom.value
    const logicalX = (pointerOffsetX - canvasPanX.value) / currentZoom
    const logicalY = (pointerOffsetY - canvasPanY.value) / currentZoom
    setZoom(currentZoom * Math.exp(-event.deltaY * 0.002))
    canvasPanX.value = pointerOffsetX - logicalX * zoom.value
    canvasPanY.value = pointerOffsetY - logicalY * zoom.value
  }

  // 仅在空格平移模式下接管指针并记录起始偏移，保证任意缩放级别都能拖动画板。
  function handleCanvasAreaPointerDown(event: PointerEvent) {
    if (!spacePanReady.value || !canvasAreaRef.value) return
    event.preventDefault()
    event.stopPropagation()
    const area = canvasAreaRef.value
    area.setPointerCapture?.(event.pointerId)
    spacePanStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: canvasPanX.value,
      panY: canvasPanY.value
    }
    isSpacePanning.value = true
    window.addEventListener('pointermove', handleSpacePanPointerMove, true)
    window.addEventListener('pointerup', handleSpacePanPointerEnd, true)
    window.addEventListener('pointercancel', handleSpacePanPointerEnd, true)
  }

  // 按指针位移直接更新画布包裹层平移量，避免依赖容器滚动条才能看到拖动画布结果。
  function handleSpacePanPointerMove(event: PointerEvent) {
    if (!spacePanStart || event.pointerId !== spacePanStart.pointerId) return
    event.preventDefault()
    canvasPanX.value = spacePanStart.panX + (event.clientX - spacePanStart.x)
    canvasPanY.value = spacePanStart.panY + (event.clientY - spacePanStart.y)
  }

  function handleSpacePanPointerEnd(event?: PointerEvent) {
    if (event && spacePanStart && event.pointerId !== spacePanStart.pointerId) return
    if (spacePanStart && canvasAreaRef.value) {
      try { canvasAreaRef.value.releasePointerCapture?.(spacePanStart.pointerId) } catch {}
    }
    spacePanStart = null
    isSpacePanning.value = false
    window.removeEventListener('pointermove', handleSpacePanPointerMove, true)
    window.removeEventListener('pointerup', handleSpacePanPointerEnd, true)
    window.removeEventListener('pointercancel', handleSpacePanPointerEnd, true)
  }

  function endSpacePan() {
    spacePanReady.value = false
    handleSpacePanPointerEnd()
  }

  function nudgeActiveObject(dx: number, dy: number) {
    const obj = fabricCanvas?.getActiveObject() ?? activeObject.value
    if (!obj || !fabricCanvas) return false
    const currentLeft = obj.left ?? 0
    const currentTop = obj.top ?? 0
    const nextLeft = obj.lockMovementX ? currentLeft : currentLeft + dx
    const nextTop = obj.lockMovementY ? currentTop : currentTop + dy
    if (nextLeft === currentLeft && nextTop === currentTop) return false
    clearBooleanPreview()
    obj.set({ left: nextLeft, top: nextTop })
    snapObjectPositionToPixelGrid(obj)
    clearOwnedEndpointAttachmentsForTransformedObject(obj)
    obj.setCoords()
    syncEndpointsForChangedObject(obj)
    fabricCanvas.requestRenderAll()
    triggerKaleidoscopeTransformSync(obj)
    refreshLayers()
    syncObjProps()
    snapshot()
    return true
  }

  function handleKeydown(e: KeyboardEvent) {
    if (shouldIgnoreEditorShortcut(e)) return
    if (e.key === ' ' && !e.repeat) {
      spacePanReady.value = true
      e.preventDefault()
      return
    }
    if (e.key === 'Shift') rulerModifierKeys.shift = true
    if (e.key === 'Control') rulerModifierKeys.ctrl = true
    if (e.key === 'Alt') rulerModifierKeys.alt = true
    if (e.key === 'Meta') rulerModifierKeys.meta = true
    // 钢笔工具下 ESC 退出并生成图形（>=2 点）；右键撤销上一点不经过键盘。
    if (penToolActive.value && e.key === 'Escape') {
      e.preventDefault()
      penCommands.deactivate(true)
      return
    }
    // 钢笔工具下 Enter 闭合多边形并生成图形（>=3 点，与点击首点闭合等价）。
    if (penToolActive.value && e.key === 'Enter') {
      e.preventDefault()
      penCommands.handlePenEnter()
      return
    }
    // 油漆桶工具下 ESC 退出工具态（无中间态需要提交）。
    if (paintBucketActive.value && e.key === 'Escape') {
      e.preventDefault()
      paintBucketCommands.deactivate()
      return
    }
    // 油漆桶工具下 X 交换前景/背景颜料（PS 惯用键）。
    if (paintBucketActive.value && (e.key === 'x' || e.key === 'X') && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      paintBucketCommands.swapColors()
      return
    }
    // 位图裁剪模式下 ESC 取消裁剪：图片完整恢复进入裁剪前的状态，不留撤销记录。
    if (cropCommands.isCropSessionActive() && e.key === 'Escape') {
      e.preventDefault()
      cropCommands.cancelCropSession()
      syncObjProps()
      return
    }
    // 节点编辑模式下优先删除已选锚点：抢在全局"删除对象"快捷键之前分发，
    // 事件被消费（含达到点数下限被拒绝）时不再下传，避免整对象被误删。
    if ((e.key === 'Delete' || e.key === 'Backspace') && deleteSelectedEditablePoints()) {
      e.preventDefault()
      return
    }
    const action = getShortcutActionByEvent(e)
    if (action) {
      e.preventDefault()
      void executeShortcutAction(action.id)
      return
    }
    const activeObjects = fabricCanvas?.getActiveObjects() ?? []
    if (!activeObjects.length || selectionMode.value !== 'shape' || e.altKey || e.ctrlKey || e.metaKey) return
    const delta = getArrowNudgeDelta(e.key)
    if (!delta) return
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    nudgeActiveObject(delta.dx * step, delta.dy * step)
  }

  function handleKeyup(e: KeyboardEvent) {
    if (e.key === ' ') endSpacePan()
    if (e.key === 'Shift') rulerModifierKeys.shift = false
    if (e.key === 'Control') rulerModifierKeys.ctrl = false
    if (e.key === 'Alt') rulerModifierKeys.alt = false
    if (e.key === 'Meta') rulerModifierKeys.meta = false
  }

  function handleWindowBlur() {
    rulerModifierKeys.shift = false
    rulerModifierKeys.ctrl = false
    rulerModifierKeys.alt = false
    rulerModifierKeys.meta = false
    endSpacePan()
    // 窗口失焦时若 Alt 拖拽复制手势仍未收尾，立即收尾以恢复快照门闸，避免后续撤销记录被持续吞掉
    if (altDragDuplicateGesture) void finishAltDragDuplicateGesture()
  }

  // ── Alt + 拖拽快速复制 ──
  // 语义与主流设计工具一致：按住 Alt/Option 开始拖动对象时，落定留下的是副本，
  // 原对象留在原地，副本落在新位置并成为选中对象。
  // 实现采用「延迟克隆交换」：拖拽期间 Fabric 仍然拖动原对象（像素网格/参考线吸附照常生效），
  // mouse:up 后再克隆一份放到落点并把原对象复位到起点；手势全程挂起自动快照，
  // 结束只提交一条撤销记录，与 Ctrl+D 复制副本的撤销粒度一致。
  type AltDragDuplicateGesture = {
    /** Fabric 本次手势实际拖拽的目标：单对象或多选 ActiveSelection。 */
    source: FabricObject
    /** 手势起点 left/top（多选时为 ActiveSelection 自身坐标），用于换算画布位移。 */
    startLeft: number
    startTop: number
    /** 手势开始前的快照门闸状态，手势结束后原样恢复。 */
    previousGate: boolean
  }

  let altDragDuplicateGesture: AltDragDuplicateGesture | null = null
  let altDragDuplicateFinalizing = false

  /**
   * 在 mouse:down 上尝试启动 Alt 拖拽复制手势：仅图形模式的左键 Alt 按下且命中可拖动对象时生效；
   * 钢笔/位图裁剪/文本编辑等专用交互，以及 Alt + 控制点（fabric 中心缩放旋转语义）不抢占。
   */
  function tryBeginAltDragDuplicateGesture(
    nativeEvent: MouseEvent,
    target: FabricObject | null | undefined,
    transformCorner: string | undefined
  ) {
    if (!fabricCanvas || altDragDuplicateFinalizing || altDragDuplicateGesture) return
    if (!target || nativeEvent.button !== 0 || !nativeEvent.altKey) return
    if (penToolActive.value || paintBucketActive.value || cropCommands.isCropSessionActive()) return
    if (selectionMode.value !== 'shape') return
    if (transformCorner) return
    if (target instanceof Textbox && target.isEditing) return
    if (isBooleanPreviewObject(target) || isKaleidoscopeInstance(target)) return
    if (target.lockMovementX && target.lockMovementY) return
    altDragDuplicateGesture = {
      source: target,
      startLeft: target.left ?? 0,
      startTop: target.top ?? 0,
      previousGate: snapshotGate.get()
    }
    // 拖拽期间挂起自动快照：手势中途的 object:modified 不入栈，由收尾统一提交一条记录
    snapshotGate.set(true)
  }

  /**
   * 按内部剪贴板链路克隆一个 Alt 拖拽副本：序列化/enliven 与复制粘贴同源，
   * 保证渐变、滤镜、可编辑路径等元数据完整；副本命名、主题、万花筒元数据处理
   * 与 duplicateSelection 相同。符号实例副本保持 symbolId 关联同一符号定义，
   * 但生成新的 symbolInstanceId——副本作为独立实例参与「更新符号」重建与解除关联，
   * 避免两个实例共享标识互相影响。dx/dy 为本次拖拽位移，副本落在原对象起点加位移处。
   */
  async function cloneObjectForAltDrag(member: FabricObject, dx: number, dy: number): Promise<FabricObject> {
    const entry = createClipboardEntry(member)
    const [clone] = await util.enlivenObjects([cloneSerializedObjectData(entry.object)]) as FabricObject[]
    clone.set({ name: nextName(`${entry.sourceName} 副本`) })
    prepareClonedObjectMetadata(clone)
    applyCanvasThemeToObject(clone)
    applyDefaultKaleidoscopeMetadata(clone)
    applyGradientMetadataToCanvasObject(clone)
    const metadata = getKaleidoscopeMetadata(clone)
    if (entry.kaleidoscopeEnabled && !entry.sourceMissing && canUseKaleidoscopeAsSource(clone) && metadata) {
      const center = getKaleidoscopeEffectiveCenter(clone)
      metadata.kaleidoscopeEnabled = true
      metadata.kaleidoscopeSourceId = createKaleidoscopeSourceId()
      metadata.kaleidoscopeManaged = false
      metadata.kaleidoscopeInstanceOf = ''
      metadata.kaleidoscopeInstanceIndex = 0
      metadata.kaleidoscopeCenterX = center.x + dx
      metadata.kaleidoscopeCenterY = center.y + dy
      metadata.kaleidoscopeCount = normalizeKaleidoscopeCount(metadata.kaleidoscopeCount)
    } else {
      clearKaleidoscopeMetadata(clone)
    }
    const symbolMeta = readSymbolInstanceMetadata(clone)
    if (symbolMeta) {
      const nextSymbolMeta = createSymbolInstanceMetadata(symbolMeta.symbolId)
      ;(clone as AnyFabricObject).symbolId = nextSymbolMeta.symbolId
      ;(clone as AnyFabricObject).symbolInstanceId = nextSymbolMeta.symbolInstanceId
    }
    clone.set({ left: (clone.left ?? 0) + dx, top: (clone.top ?? 0) + dy })
    clone.setCoords()
    return clone
  }

  /**
   * Alt 拖拽收尾：原对象复位到起点、克隆副本放到落点、副本成为选中对象，
   * 最后提交一条撤销记录并恢复快照门闸。多选时先放弃选区，让 Fabric 把
   * ActiveSelection 的拖拽位移烘焙回成员的画布坐标，再做统一的复位/克隆。
   */
  async function finishAltDragDuplicateGesture() {
    const gesture = altDragDuplicateGesture
    if (!gesture || altDragDuplicateFinalizing) return
    altDragDuplicateFinalizing = true
    altDragDuplicateGesture = null
    const fabric = fabricCanvas
    try {
      if (!fabric) return
      const dx = (gesture.source.left ?? 0) - gesture.startLeft
      const dy = (gesture.source.top ?? 0) - gesture.startTop
      // 无位移（Alt 单击或拖回原位）不产生复制语义，也不留下撤销记录
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return
      const members = gesture.source instanceof ActiveSelection
        ? gesture.source.getObjects()
        : [gesture.source]
      // 多选拖拽时成员坐标原本挂在选区平面：先放弃选区让 Fabric 把拖拽位移烘焙回画布坐标，
      // 之后成员的 left/top 即为画布平面上的落点，单选/多选统一按「落点 - 位移」复位
      if (gesture.source instanceof ActiveSelection) fabric.discardActiveObject()
      const restored = members
        .filter((member) => fabric.getObjects().includes(member))
        .map((member) => ({ member, drop: { left: member.left ?? 0, top: member.top ?? 0 } }))
      restored.forEach(({ member, drop }) => {
        // 原对象复位到拖拽起点：Alt 拖拽留下的是副本
        member.set({ left: drop.left - dx, top: drop.top - dy })
        member.setCoords()
        clearOwnedEndpointAttachmentsForTransformedObject(member)
        syncEndpointsForChangedObject(member)
        triggerKaleidoscopeTransformSync(member)
      })
      const clones: FabricObject[] = []
      try {
        for (const { member } of restored) {
          clones.push(await cloneObjectForAltDrag(member, dx, dy))
        }
      } catch (error) {
        // 克隆失败时画布已回到手势前状态（原对象复位），不提交快照
        console.warn('Alt 拖拽复制失败', error)
        return
      }
      clones.forEach((clone) => {
        fabric.add(clone as AnyFabricObject)
        if (isKaleidoscopeSource(clone)) void rebuildKaleidoscopeInstances(clone)
      })
      applyActiveObjectsSelection(clones)
      refreshLayers()
      syncObjProps()
      fabric.requestRenderAll()
      snapshot({ description: 'Alt 拖拽复制' })
    } finally {
      snapshotGate.set(gesture.previousGate)
      altDragDuplicateFinalizing = false
    }
  }

  // ── Fabric 事件 ──
  function setupCanvasEvents() {
    if (!fabricCanvas) return

    // 工具态进出时同步画布选择抑制标志（禁用框选并跳过命中），切回选择工具即恢复。
    watch(toolSuppressSelection, () => {
      syncCanvasInteractionMode()
      fabricCanvas?.requestRenderAll()
    })

    // 退出网格上色模式（关闭网格 / 切描边行为 / 退出油漆桶）时清理光标，
    // 并把进行中的手势收尾提交：拖动中退出也按"一次手势"补一条历史记录，
    // 保证已上色的格子不会漏记（否则撤销会一步跳到本次上色之前的状态）。
    watch(gridPaintMode, (active) => {
      if (active) return
      gridPaintHoverCell.value = null
      finishGridPaintGesture()
    })

    fabricCanvas.on('mouse:down:before', (event) => {
      const nativeEvent = event.e as MouseEvent

      // ── 钢笔工具（正交开关，优先于选择模式判定） ──
      if (penToolActive.value) {
        if (nativeEvent.button === 2) {
          penCommands.handlePenRightClick()
          return
        }
        if (nativeEvent.button === 0) {
          const scenePoint = event.scenePoint ?? fabricCanvas.getScenePoint(event.e)
          penCommands.handlePenLeftDown({ x: scenePoint.x, y: scenePoint.y })
        }
        return
      }

      // ── 油漆桶网格上色（网格可见 + 填充行为：按网格单元上色，支持拖动连刷） ──
      if (paintBucketActive.value && gridPaintMode.value) {
        if (nativeEvent.button === 0) {
          const scenePoint = event.scenePoint ?? fabricCanvas.getScenePoint(event.e)
          handleGridPaintDown({ x: scenePoint.x, y: scenePoint.y })
        }
        return
      }

      // ── 油漆桶工具（区域上色；右键不触发，交给上下文菜单） ──
      if (paintBucketActive.value) {
        if (nativeEvent.button === 0) {
          const scenePoint = event.scenePoint ?? fabricCanvas.getScenePoint(event.e)
          const result = paintBucketCommands.handlePaintBucketClick(
            { x: scenePoint.x, y: scenePoint.y },
            event.target ?? null
          )
          if (result.applied) {
            snapshot({ description: result.mode === 'fill' ? '油漆桶填充' : '油漆桶描边' })
          } else if (result.skipped > 0) {
            showToast('目标已是当前颜色，已跳过', 'info')
          } else {
            showToast('点击区域未命中可上色对象', 'info')
          }
        }
        return
      }

      // ── 右键上下文菜单（在非钢笔工具模式下） ──
      if (nativeEvent.button === 2) {
        openCanvasObjectContextMenu(nativeEvent)
        return
      }

      // 重置上一轮残留 (例如 selection 事件没正常 fire 时)
      setPointModeSwitchPending(false)
      if (!fabricCanvas || !activeObject.value) return
      if (selectionMode.value === 'shape') return
      const scenePoint = event.scenePoint ?? fabricCanvas.getScenePoint(event.e)
      const viewportPoint = event.viewportPoint ?? fabricCanvas.getViewportPoint(event.e)
      if (selectionMode.value === 'segment') {
        // 若点击落在 active 对象的控件上（如 cp1/cp2 辅助点或边中点辅助器），交给控件自身处理，
        // 避免误触发 handleSegmentPointerDown 导致选中相邻边、控件被重建后无法继续拖动
        const active = activeObject.value as AnyFabricObject | null
        if (active && typeof active.findControl === 'function') {
          const hit = active.findControl(viewportPoint, util.isTouchEvent(event.e))
          if (hit) return
        }
        const handled = handleSegmentPointerDown(scenePoint.x, scenePoint.y)
        if (handled) {
          setRestoreActiveObjectAfterSelectionClear()
          fabricCanvas.discardActiveObject(event.e)
          return
        }
        const target = event.target
        if (target && target !== activeObject.value) {
          setRestoreActiveObjectAfterSelectionClear()
          fabricCanvas.discardActiveObject(event.e)
        }
        return
      }
      // ── point 模式 ──
      const editable = activeEditablePathObject.value
      const target = event.target
      const nativeMouseEvent = event.e as MouseEvent
      const multiSelectModifier = isMultiSelectModifierPressed(nativeMouseEvent)
      if (editable && typeof editable.findControl === 'function') {
        const hit = editable.findControl(viewportPoint, util.isTouchEvent(event.e))
        if (hit) {
          // 命中点控件 -> 由 control 自身的 mouseDownHandler 调用 beginPointControlGesture
          return
        }
      }
      if (multiSelectModifier) {
        // 修饰键: 维持 box-select / 加法选点流程
        beginBlankPointGesture(nativeMouseEvent)
        setRestoreActiveObjectAfterSelectionClear()
        fabricCanvas.discardActiveObject(event.e)
        return
      }
      // 无修饰键, 点击其它图形 -> 切换到对应图形的点位模式
      if (target && target !== activeObject.value) {
        setPointModeSwitchPending()
        return
      }
      // 无修饰键, 点击当前 active 对象本体 / 空白区 -> 不做任何操作 (保持 active 与已选点)
      setRestoreActiveObjectAfterSelectionClear()
      fabricCanvas.discardActiveObject(event.e)
    })

    fabricCanvas.on('mouse:move', (event) => {
      if (penToolActive.value) {
        penCommands.handlePenPointerMove(event)
        return
      }
      if (gridPaintMode.value) {
        const scenePoint = event.scenePoint ?? fabricCanvas.getScenePoint(event.e)
        handleGridPaintMove({ x: scenePoint.x, y: scenePoint.y })
        return
      }
      handlePointGestureCanvasMove(event)
    })

    // Alt + 拖拽快速复制：mouse:down（命中对象且带 Alt）挂起快照并记录手势，
    // mouse:up 收尾时落定副本、复位原对象并提交一条撤销记录
    fabricCanvas.on('mouse:down', (event) => {
      const nativeEvent = event.e as MouseEvent
      tryBeginAltDragDuplicateGesture(nativeEvent, event.target ?? null, event.transform?.corner)
    })

    fabricCanvas.on('mouse:up', () => {
      if (altDragDuplicateGesture) void finishAltDragDuplicateGesture()
    })

    fabricCanvas.on('mouse:up', () => {
      if (penToolActive.value) {
        penCommands.handlePenPointerUp()
        return
      }
      if (gridPaintMode.value) {
        finishGridPaintGesture()
        return
      }
      finishPointGesture()
    })

    // 鼠标离开画布容器时隐藏网格画笔光标；手势由 fabric 的 document 级 mouse:up 兜底结束。
    const canvasContainer = fabricCanvas.getElement()?.parentElement
    canvasContainer?.addEventListener('mouseleave', () => {
      gridPaintHoverCell.value = null
    })

    // 节点编辑模式下双击线段插入锚点；钢笔态的双击语义由钢笔模块自行处理，油漆桶态双击等价单击，均跳过
    fabricCanvas.on('mouse:dblclick', (event) => {
      if (penToolActive.value || paintBucketActive.value) return
      if (!activeObject.value) return
      const editable = activeEditablePathObject.value
      if (!editable || selectionMode.value !== 'point') return
      const nativeEvent = event.e as MouseEvent
      const viewportPoint = event.viewportPoint ?? fabricCanvas.getViewportPoint(nativeEvent)
      // 双击命中已有控件（锚点/控制柄）时不插入，保持控件自身交互
      if (typeof editable.findControl === 'function' && editable.findControl(viewportPoint, util.isTouchEvent(event.e))) return
      // 双击到其它对象时交给点击流程处理对象切换，不做插点
      if (event.target && event.target !== activeObject.value) return
      const scenePoint = event.scenePoint ?? fabricCanvas.getScenePoint(nativeEvent)
      handlePointModeDoubleClick(scenePoint)
    })

    fabricCanvas.on('after:render', () => {
      drawPointGestureMarquee()
      if (penToolActive.value) penCommands.drawPenOverlay()
    })

    fabricCanvas.on('selection:created', () => {
      clearBooleanPreview()
      if (consumePointModeSwitchPending()) {
        const next = fabricCanvas!.getActiveObject() ?? null
        // 切换到新对象, 然后尝试回到 point 模式 (新对象不可编辑时会自动降级为 shape)
        syncActiveObject(next)
        if (next) setSelectionMode('point')
        return
      }
      if (selectionMode.value !== 'shape') {
        const active = fabricCanvas!.getActiveObject()
        if (active && active !== activeObject.value) {
          fabricCanvas!.discardActiveObject()
          fabricCanvas!.requestRenderAll()
          return
        }
        // 非 shape 模式下若 active 仍等于我们追踪的 activeObject（典型场景：
        // 我们在 selection:cleared 里把焦点 restore 回了同一对象），
        // 直接返回——syncActiveObject 会通过 clearPointEditing 清除已选点
        // 与正在进行的 point 手势状态，从而把焦点/已选状态打没。
        if (active && active === activeObject.value) {
          return
        }
      }
      syncActiveObject(fabricCanvas!.getActiveObject() ?? null)
    })
    fabricCanvas.on('selection:updated', () => {
      clearBooleanPreview()
      if (consumePointModeSwitchPending()) {
        const next = fabricCanvas!.getActiveObject() ?? null
        syncActiveObject(next)
        if (next) setSelectionMode('point')
        return
      }
      if (selectionMode.value !== 'shape') {
        const active = fabricCanvas!.getActiveObject()
        if (activeObject.value && active && active !== activeObject.value) {
          fabricCanvas!.setActiveObject(activeObject.value)
          fabricCanvas!.requestRenderAll()
          return
        }
        // 同上：同一对象时不再 syncActiveObject，避免清除点选/手势状态
        if (active && active === activeObject.value) {
          return
        }
      }
      syncActiveObject(fabricCanvas!.getActiveObject() ?? null)
    })
    fabricCanvas.on('selection:cleared', () => {
      clearBooleanPreview()
      // point 模式下点击切换到其他图形时, Fabric 会先 discardActiveObject 再 setActiveObject(target),
      // 这里跳过中间一拍, 让 selection:created/updated 完成 mode 切换
      if (isPointModeSwitchPending()) {
        return
      }
      // point 模式下若我们正在自定义手势中（无论 blank 还是 point-control），都要保住 active editable
      const protectingPointGesture = shouldProtectPointGestureSelection()
      if ((consumeRestoreActiveObjectAfterSelectionClear() || protectingPointGesture) && activeObject.value && fabricCanvas) {
        fabricCanvas.setActiveObject(activeObject.value)
        updateCurveControls()
        syncObjProps()
        fabricCanvas.requestRenderAll()
        return
      }
      syncActiveObject(null)
    })
    fabricCanvas.on('object:modified', (event) => {
      const target = event.target ?? null
      if (isBooleanPreviewObject(target)) return
      clearBooleanPreview()
      if (target) {
        // 先提取基础缩放，再重新应用 3D 旋转，保证两者正确叠加
        extractRotation3DBaseScalesFromObject(target)
        applyRotation3DTransformToObject(target)
        snapObjectSizeToPixelGrid(target)
        snapObjectPositionToPixelGrid(target)
        target.setCoords()
      }
      syncEndpointsForChangedObject(target)
      triggerKaleidoscopeContentSync(target)
      triggerKaleidoscopeTransformSync(target)
      snapshot()
      syncObjProps()
      refreshLayers()
    })
    // Real-time sync during drag interactions
    fabricCanvas.on('object:scaling', (event) => {
      clearBooleanPreview()
      const target = event.target ?? null
      // 实时提取基础缩放并重新应用 3D 旋转，保证缩放手柄拖拽时预览正确
      extractRotation3DBaseScalesFromObject(target)
      applyRotation3DTransformToObject(target)
      snapObjectSizeToPixelGrid(target)
      clearOwnedEndpointAttachmentsForTransformedObject(target)
      syncEndpointsForChangedObject(target)
      syncObjProps()
      triggerKaleidoscopeTransformSync(target)
    })
    fabricCanvas.on('object:moving', (event) => {
      clearBooleanPreview()
      snapObjectPositionToPixelGrid(event.target ?? null)
      // 像素网格吸附之后叠加参考线吸附（4px 视口阈值），让对象拖拽可以对齐用户参考线。
      snapObjectPositionToGuides(event.target ?? null)
      clearOwnedEndpointAttachmentsForTransformedObject(event.target ?? null)
      syncEndpointsForChangedObject(event.target ?? null)
      syncObjProps()
      triggerKaleidoscopeTransformSync(event.target ?? null)
    })
    fabricCanvas.on('object:rotating', (event) => {
      clearBooleanPreview()
      clearOwnedEndpointAttachmentsForTransformedObject(event.target ?? null)
      syncEndpointsForChangedObject(event.target ?? null)
      syncObjProps()
      triggerKaleidoscopeTransformSync(event.target ?? null)
    })

    // 对象添加/删除时快照
    fabricCanvas.on('object:added', (event) => {
      const target = event.target ?? null
      if (isBooleanPreviewObject(target)) return
      if (target) {
        ensureEditorObjectId(target)
        normalizeEndpointAttachments(target)
        applyDefaultSizeRatioLockMetadata(target)
        applyDefaultRotation3DMetadata(target)
        applyCanvasThemeToObject(target)
        target.snapAngle = snapToPixelGrid.value ? 15 : undefined
      }
      refreshLayers()
      snapshot()
    })
    fabricCanvas.on('object:removed', (event) => {
      const target = event.target ?? null
      if (isBooleanPreviewObject(target)) return
      if (target) removeEndpointAttachmentsReferencing(target)
      removeKaleidoscopeInstancesForRemovedSource(target)
      refreshLayers()
      snapshot()
    })
  }

  // ── 初始化 ──
  // Canvas Kernel 模块负责 Fabric Canvas 生命周期与基础视口行为；页面仅保留业务回调和运行时注册。
  function createHomeCanvasLifecycleModule(): EditorModule {
    return homeCanvasKernel.module
  }

  // 创建启动数据模块，集中加载不会直接创建画布对象的编辑器基础数据。
  function createHomeStartupDataModule(): EditorModule {
    return {
      name: 'home-startup-data',
      onMount(context) {
        if (!context.getCanvas()) return
        void getPathKit()
        loadUserStylePresets()
      }
    }
  }

  // 组装 MCP 网关依赖：全部转发到已有闭包能力，网关模块本身不新增编辑器逻辑。
  // 画板重命名走直接落值而非弹窗流程，MCP 场景没有用户在界面上确认重命名对话框。
  function createMcpModuleOptions() {
    return {
      getFabricCanvas: () => fabricCanvas,
      getActiveObject: () => activeObject.value,
      getObjects: () => (fabricCanvas ? fabricCanvas.getObjects() : []),
      getSelection: () => selectedObjects.value,
      ensureEditorObjectId,
      isBooleanPreviewObject,

      canvasWidth: () => canvasWidth.value,
      canvasHeight: () => canvasHeight.value,
      canvasBg: () => canvasBg.value,
      zoom: () => zoom.value,
      showPixelGrid: () => showPixelGrid.value,
      snapToPixelGrid: () => snapToPixelGrid.value,
      pixelGridSize: () => pixelGridSize.value,
      keylineTemplate: () => keylineTemplate.value,

      setCanvasSize,
      setCanvasBg,
      setPixelGridVisible,
      setSnapToPixelGrid,
      setPixelGridSize,
      setKeylineTemplate,
      setKeylineMargin,
      setSelectionMode,
      setZoom,
      fitCanvasInView,

      addShape,
      addText,
      setObjProp,
      applyActiveObjectsSelection,
      selectAllByMode,
      deleteObjects,
      duplicateSelection,
      flipObject,
      layerUp,
      layerDown,
      layerTop,
      layerBottom,
      lockObject,
      groupObjects,
      ungroupObject,
      scaleObjectToDisplaySize,
      importSVGText,
      insertIconifyIcon: (iconName: string, scenePoint?: { x: number; y: number } | null) =>
        assetsImportCommands.insertIconifyIcon(iconName, scenePoint ?? null),
      insertIconTemplate: (template: IconTemplateItem, scenePoint?: { x: number; y: number } | null) =>
        assetsImportCommands.insertIconTemplate(template, scenePoint ?? null),
      applyIconTemplateAsDocument: assetsImportCommands.applyIconTemplateAsDocument,

      setObjectsVisible: layersCommands.setObjectsVisible,
      setObjectsLocked: layersCommands.setObjectsLocked,

      alignObjectsLayout,
      distributeObjectsLayout,
      setObjectName,

      // 文档级样式元数据（命名色板与自定义样式预设），随工程与撤销快照持久化
      getDocumentSwatches: () => getDocumentStyleMeta().swatches,
      addDocumentSwatch,
      removeDocumentSwatch,
      getDocumentStylePresets: () => getDocumentStyleMeta().stylePresets,
      saveDocumentStylePreset,
      removeDocumentStylePreset,

      // 文档级命名画布快照（画布视觉状态备份），随工程 JSON 保存、不进入撤销历史
      getDocumentCanvasSnapshots,
      saveDocumentCanvasSnapshot,
      removeDocumentCanvasSnapshot,

      // 对齐参考线（用户参考线）：随撤销快照与工程 JSON 持久化，撤销合并由网关层负责
      getDocumentGuides,
      setDocumentGuides,

      // 符号系统（define_symbol / list_symbols / insert_symbol_instance / update_symbol /
      // detach_symbol_instance 的运行时实现）：除 createSymbolDefinition 由网关提交快照外，
      // 插入/更新/解除均已在运行时内部提交一条撤销记录（与 outline_text 同模式）。
      getDocumentSymbols: () => symbols.value.map((item) => JSON.parse(JSON.stringify(item)) as ProjectSymbol),
      getSymbolInstanceCount,
      defineSymbolFromObjects: (name: string, objects: FabricObject[]) => createSymbolDefinition(name, objects),
      insertSymbolInstanceById: (symbolId: string, scenePoint: { x: number; y: number } | null) => insertSymbolInstance(symbolId, scenePoint),
      updateSymbolFromObjects: async (symbolId: string, objects: FabricObject[]) =>
        (await updateSymbolInstances(symbolId, objects)).symbol,
      detachSymbolInstancesFromObjects: (objects: FabricObject[]) => detachSymbolInstances(objects),

      // 全局颜色替换（replace_color 的运行时实现，撤销合并由网关层负责）
      replaceDocumentColorOnCanvas: replaceAllColor,

      serializeCanvasJson: serializeFabricCanvas,
      restoreCanvasContentFromJson,
      scheduleDraftSave,

      outlineText: outlineTextToPath,

      // 文本编辑（update_text 的运行时实现，撤销合并由网关层负责）
      updateTextObject,

      // 位图滤镜与混合模式（apply_image_filter 的运行时实现，撤销合并由网关层负责）
      applyImageFilterToObject,

      // 位图裁剪与图案填充（crop_image / set_pattern_fill 的运行时实现，撤销合并由网关层负责）
      cropImageToDisplayRect: (target: FabricObject, rect: BitmapCropRect) => cropImageToDisplayRect(target, rect),
      applyPatternFillToObject: applyPatternFillRequestToObject,

      undo,
      redo,
      jumpToHistory,
      undoStack: () => undoStack,
      historyIndex: () => historyIndex.value,
      withSnapshotSuppressed,
      snapshot: (options?: { description?: string }) => snapshot(options),

      newDoc,
      saveActiveProjectTab,
      hasSavedProjectPath: () => !!activeProjectTab.value?.savedFilePath,
      createProjectFile,
      loadProjectFile,

      artboards: () => artboards.value,
      activeArtboardId: () => activeArtboardId.value,
      canRedo: () => canRedo.value,
      switchArtboard,
      addArtboard,
      deleteArtboard,
      renameArtboardDirect: (artboardId: string, name: string) => {
        const artboard = artboards.value.find((item) => item.id === artboardId)
        if (!artboard) return
        artboard.name = name
        markSmallPreviewsDirty()
        snapshot({ description: `重命名画板: ${name}`, autoSave: true })
      },

      exportSvgText: (includeBackground = false) => createCanvasSVGPreview(includeBackground),
      exportSvgSelection: () => createSelectionSvgText(),
      exportPngDataUrl: (options?: { size?: number; transparentBackground?: boolean; format?: 'png' | 'webp'; quality?: number }) =>
        renderPNGDataUrl(
          options?.size ?? canvasWidth.value,
          options?.transparentBackground ?? false,
          options?.format ?? 'png',
          options?.quality ?? 0.92
        ),
      exportSvgFile: (options?: { fileName?: string; includeBackground?: boolean; outputDir?: string }) =>
        exportSVG(options?.fileName, options?.includeBackground ?? false, options?.outputDir),
      exportPngFile: (options?: {
        size?: number
        fileName?: string
        transparentBackground?: boolean
        format?: 'png' | 'webp'
        quality?: number
        outputDir?: string
      }) =>
        exportPNG(
          options?.size,
          options?.fileName,
          options?.transparentBackground ?? false,
          options?.format ?? 'png',
          options?.quality ?? 0.92,
          options?.outputDir
        ),
      exportSizeSet,
      exportIconContainer,
      withArtboardExport,
      runBooleanOperationOnObjects,

      showToast
    }
  }

  // 创建窗口事件模块，统一注册和释放编辑器级全局监听，避免页面卸载时遗漏清理。
  function createHomeWindowEventsModule(): EditorModule {
    return {
      name: 'home-window-events',
      onDocumentReady(context) {
        const targetWindow = context.services.window
        targetWindow.addEventListener('resize', fitCanvasInView)
        targetWindow.addEventListener('keydown', handleKeydown)
        targetWindow.addEventListener('keyup', handleKeyup)
        targetWindow.addEventListener('blur', handleWindowBlur)
        targetWindow.addEventListener('paste', assetsImportCommands.handleWindowPaste)
      },
      onDispose(context) {
        const targetWindow = context.services.window
        targetWindow.removeEventListener('resize', fitCanvasInView)
        targetWindow.removeEventListener('keydown', handleKeydown)
        targetWindow.removeEventListener('keyup', handleKeyup)
        targetWindow.removeEventListener('blur', handleWindowBlur)
        targetWindow.removeEventListener('paste', assetsImportCommands.handleWindowPaste)
      }
    }
  }

  // 创建 Home 编辑器运行时并注册当前阶段已迁入的生命周期模块。
  function createHomeEditorRuntime(): EditorRuntime {
    const runtime = createEditorRuntime({
      services: createEditorServices(),
      state: {
        store: editorStore,
        commands: editorCommands,
        selectors: editorSelectors
      }
    })
    runtime.register(createHomeCanvasLifecycleModule())
    runtime.register(homeDirectEdit.module)
    runtime.register(homeCrop.module)
    runtime.register(homePenTool.module)
    runtime.register(homePaintBucket.module)
    runtime.register(homeWorkspace.module)
    runtime.register(homeAssetsImport.module)
    runtime.register(homeExportDelivery.module)
    runtime.register(createHomeStartupDataModule())
    runtime.register(createHomeWindowEventsModule())
    runtime.register(createHomeMcpModule(createMcpModuleOptions()).module)
    return runtime
  }

  onMounted(() => {
    editorRuntime = createHomeEditorRuntime()
    void editorRuntime.mount()
  })

  watch(
    () => [isDark.value, primaryColor.value, customColor.value],
    () => {
      applyCanvasTheme()
      fabricCanvas?.requestRenderAll()
    }
  )

  // 应用级偏好任意一项变化即时写回本地存储；工程 / 草稿恢复覆盖这些值同样会被记住，
  // 作为「上次状态」在下次打开插件时恢复。写入失败已在 saveUserPreferences 内降级为警告。
  watch(
    () => [
      pixelGridSize.value,
      pixelPaintBrushSize.value,
      leftPanelCollapsed.value,
      showRuler.value,
      snapToPixelGrid.value
    ],
    () => {
      saveUserPreferences({
        pixelGridSize: pixelGridSize.value,
        pixelPaintBrushSize: pixelPaintBrushSize.value,
        leftPanelCollapsed: leftPanelCollapsed.value,
        showRuler: showRuler.value,
        snapToPixelGrid: snapToPixelGrid.value
      })
    }
  )

  onBeforeUnmount(() => {
    void editorRuntime?.dispose()
    editorRuntime = null
  })

  return {
    canvasElRef,
    canvasAreaRef,
    canvasWrapperRef,
    svgInputRef,
    imgInputRef,
    projectInputRef,
    leftPanelCollapsed,
    leftTab,
    activeRightTab,
    showPixelGrid,
    snapToPixelGrid,
    pixelGridSizeInput,
    pixelPaintBrushSizeInput,
    gridPaintMode,
    gridPaintCursorStyle,
    keylineTemplate,
    keylineMarginInput,
    keylineOpacity,
    guides,
    showGuides,
    guideDragState,
    setGuidesVisible,
    toggleGuides,
    beginGuideCreate,
    beginGuideMove,
    updateGuideDrag,
    endGuideDrag,
    removeGuide,
    clearGuides,
    symbols,
    symbolNameDialog,
    openCreateSymbolDialog,
    handleSymbolNameDialogShowChange,
    confirmCreateSymbolDialog,
    insertSymbolFromLibrary,
    updateSymbolFromLibrary,
    deleteSymbolFromLibrary,
    detachSymbolSelection,
    getSymbolBadgeText,
    colorReplaceDialog,
    colorReplaceEntries,
    openColorReplaceDialog,
    closeColorReplaceDialog,
    replaceAllColor,
    spacePanReady,
    isSpacePanning,
    rulerCoordinateHintActive,
    canvasWidth,
    canvasHeight,
    canvasWidthInput,
    canvasHeightInput,
    canvasPresetValue,
    canvasPresetOptions,
    isCanvasBgTransparent,
    currentFillStyleMode,
    canvasBgPickerValue,
    pixelGridOverlayStyle,
    keylineOverlayStyle,
    canvasWrapperStyle,
    keylineSafeArea,
    iconCheckIssues,
    iconCheckSummary,
    booleanBusy,
    strokeOutlineBusy,
    textOutlineBusy,
    bitmapTraceBusy,
    booleanError,
    subtractPopoverVisible,
    objProps,
    sizeRatioLocked,
    hasSelectedPoint,
    canAlignSelection,
    canBoolean,
    canConvertStrokeSelection,
    canConvertTextSelection,
    canDirectionalSubtract,
    canDistributeSelection,
    canGroup,
    canSaveUserAsset,
    canUngroup,
    canVectorizeBitmapSelection,
    filteredLayers,
    isLayerDragDisabled,
    isLayerDragging,
    layerContextMenu,
    layerContextMenuItems,
    layerDragItems,
    layerRenameDialog,
    layerSearch,
    confirmLayerRename,
    handleLayerContextMenuSelect,
    handleLayerMouseDown,
    handleLayerRenameDialogShowChange,
    isLayerActive,
    openLayerContextMenu,
    removeObject,
    reorderLayers,
    toggleLock,
    toggleVisible,
    toast,
    showToast,
    projectTabs,
    activeProjectTabId,
    hasMultipleProjectTabs,
    addProjectTab,
    switchProjectTab,
    closeProjectTab,
    artboards,
    activeArtboardId,
    artboardRenameDialog,
    draftRestoreDialog,
    undoStack,
    historyIndex,
    addArtboard,
    deleteArtboard,
    duplicateArtboard,
    jumpToHistory,
    onProjectFileChosen: onProjectFileChosenForActiveTab,
    renameArtboard,
    confirmArtboardRename,
    handleArtboardRenameDialogShowChange,
    confirmDraftRestore,
    handleDraftRestoreDialogShowChange,
    switchArtboard,
    keylineTemplateOptions,
    previewBackgroundOptions,
    svgPreviewModeOptions,
    previewBackgroundMode,
    canvasViewMode,
    previewPopoverVisible,
    previewItems,
    visibleColorPaletteGroups,
    visibleGradientPresets,
    stylePresetManagerState,
    stylePresetColorColumns,
    stylePresetGradientPresets,
    stylePresetGradientRows,
    defaultStylePresetColorPaletteGroups,
    defaultStylePresetGradientPresets,
    defaultStylePresetColorColumns,
    defaultStylePresetGradientRows,
    stylePresetCurrentFillColor,
    stylePresetCurrentStrokeColor,
    stylePresetCurrentGradientPreset,
    isFillGradientStopPercentDisabled,
    assetsImportCommands,
    importedUserAssets,
    importedUserAssetDialog,
    importedPasteSVGDialog,
    iconifyImportState,
    importedFilteredIconifyResults,
    importedIconifyCollectionOptions,
    exportDialog,
    exportDialogCanExport,
    exportDialogSelectedPreset,
    filteredShortcutGroups,
    shortcutBindings,
    shortcutDrawerOpen,
    shortcutPlatform,
    shortcutSearch,
    addShortcutBinding,
    applyShortcutBinding,
    handleExportDialogShowChange,
    handleExportPresetSelect,
    removeShortcutBinding,
    resetShortcutBindingsToDefault,
    runExportDialogExport,
    setExportFormatEnabled,
    toggleExportPngSize,
    activeKaleidoscopeInstance,
    activeKaleidoscopeEditableSource,
    isHollowShaftArrow,
    hasSelectedCurveSegment,
    hasSelectedArrowEndpoint,
    editorSelectors,
    editorCommands,
    arrowAggregated,
    applyColorSwatch,
    saveCurrentColorSwatch,
    applyGradientPreset,
    saveCurrentGradientPreset,
    previewStyleColor,
    previewStyleGradient,
    restoreStylePreview,
    commitStylePreview,
    openStylePresetManager,
    applyStylePresetSettings,
    handleStylePresetManagerShowChange,
    setPixelGridVisible,
    setSnapToPixelGrid,
    setPixelGridSizeFromInput,
    setPixelPaintBrushSizeFromInput,
    setKeylineTemplate,
    setKeylineMarginFromInput,
    setKeylineOpacity,
    selectIconCheckIssue,
    setKaleidoscopeCenterFromInput,
    setKaleidoscopeCountFromInput,
    setKaleidoscopeEnabled,
    setKaleidoscopeFollowRotation,
    selectKaleidoscopeSourceFromInstance,
    detachKaleidoscopeInstance,
    handleSubtractPopoverShowChange,
    clearBooleanPreview,
    showBooleanPreview,
    toggleSizeRatioLock,
    setObjProp,
    setObjPropFromInput,
    setEndpointSnapMarginFromInput,
    setCornerRadiusFromInput,
    setSelectedPointCornerRadiusFromInput,
    toggleSelectedArrowEnabled,
    setSelectedArrowShape,
    setSelectedArrowAngle,
    setSelectedArrowLengthFromInput,
    setHollowArrowTipAngle,
    setHollowArrowSideAngle,
    setHollowArrowLineWidthFromInput,
    setSelectedSegmentCurveEnabled,
    setSelectedSegmentControlPointCoordFromInput,
    setStrokeWidthFromInput,
    setStrokeLineType,
    setStrokeDashLengthFromInput,
    setStrokeDashGapFromInput,
    toggleFill,
    setSolidFillColor,
    setFillStyleMode,
    setPatternFillFromFile,
    setPatternFillRepeat,
    setPatternFillScale,
    cropModeActive,
    beginBitmapCrop,
    confirmBitmapCrop,
    cancelBitmapCrop,
    setFillGradientStopColor,
    reorderFillGradientStops,
    setFillGradientStopOffset,
    setFillGradientStopOffsetFromInput,
    addFillGradientStop,
    removeFillGradientStop,
    setFillGradientAngleValue,
    setFillGradientAngleFromInput,
    setFillGradientRadiusValue,
    toggleStroke,
    addShadowEffect,
    toggleShadowEffect,
    setShadowEffectProp,
    removeShadowEffect,
    setObjectBlendMode,
    setTextProp,
    setTextPropFromInput,
    toggleTextBold,
    toggleTextItalic,
    toggleTextUnderline,
    toggleTextLinethrough,
    setTextAlign,
    toggleImageFilter,
    setImageFilterParam,
    flipObject,
    resetTransform,
    setRotate3DFromInput,
    copyStyle,
    pasteStyle,
    currentLockMode,
    setLockMode,
    isMultiSelection,
    selectionCount,
    setObjSizeFromInput,
    alignPositions,
    alignPopoverVisible,
    currentAlignId,
    currentAlignPosition,
    alignToCanvas,
    selectAlign,
    alignSelection,
    distributeSelection,
    setCanvasSizeFromInput,
    setCanvasBg,
    applyCanvasPreset,
    previewStageClass,
    svgPreviewSource,
    svgPreviewDataUrl,
    highlightedSvgPreviewSource,
    svgPreviewMode,
    svgModeTooltipTitle,
    svgModeTooltipDetail,
    setPreviewBackgroundMode,
    setCanvasViewMode,
    setSvgPreviewMode,
    handlePreviewPopoverShowChange,
    toggleLeftPanel,
    deleteObject,
    lockObject,
    groupObjects,
    ungroupObject,
    runBooleanOperation,
    convertSelectionStrokeToOutline,
    convertSelectionTextToOutline,
    setBitmapTraceMode,
    setBitmapTraceThresholdFromInput,
    vectorizeSelectionBitmap,
    layerUp,
    layerDown,
    layerTop,
    layerBottom,
    showAllLayers,
    hideAllLayers,
    unlockAllLayers,
    lockAllLayers,
    openCanvasObjectContextMenu,
    handleCanvasAreaPointerDown,
    handleCanvasAreaWheel,
    penToolActive,
    togglePenTool,
    paintBucketActive,
    paintBucketForegroundColor: paintBucketState.paintForegroundColor,
    paintBucketBackgroundColor: paintBucketState.paintBackgroundColor,
    paintBucketBehavior: paintBucketState.paintBehavior,
    setPaintBucketColor,
    setPaintBucketStrokeColor,
    swapPaintBucketColors,
    togglePaintBucketBehavior,
    setPaintBucketBehavior,
    togglePaintBucketTool
  }
}
