import { Gradient, Pattern, Shadow, type FabricObject } from 'fabric'

export type AnyFabricObject = FabricObject & Record<string, any>
// fillMode 取值：solid 纯色 / gradient 渐变 / pattern 图案（fabric Pattern fill）。
export type FillMode = 'solid' | 'gradient' | 'pattern'
export type FillGradientType = 'linear' | 'radial'
export type FillGradientStop = {
  color: string
  offset: number
}

/**
 * 渐变的精确坐标快照（percentage 坐标系：1 = 对象宽度/高度的 100%）。
 * 属性面板按角度/中心/半径维护渐变，而精确坐标只有部分能映射回这三个量；
 * 记录精确坐标可让 MCP/程序化生成的渐变在保存、撤销后完全按原样重建。
 */
export type FillGradientCoords = {
  x1: number
  y1: number
  x2: number
  y2: number
  r1?: number
  r2?: number
}

export type FillGradientMetadata = {
  fillMode?: FillMode
  fillGradientType?: FillGradientType
  fillGradientStops?: FillGradientStop[]
  fillGradientAngle?: number
  fillGradientCenterX?: number
  fillGradientCenterY?: number
  fillGradientRadius?: number
  fillGradientCoords?: FillGradientCoords
}

export type KaleidoscopeMetadata = {
  kaleidoscopeEnabled?: boolean
  kaleidoscopeCenterX?: number
  kaleidoscopeCenterY?: number
  kaleidoscopeFollowRotation?: boolean
  kaleidoscopeCount?: number
  kaleidoscopeSourceId?: string
  kaleidoscopeManaged?: boolean
  kaleidoscopeInstanceOf?: string
  kaleidoscopeInstanceIndex?: number
}

export type EndpointSnapMarginMetadata = {
  endpointSnapMargin?: number
}

export type SizeRatioLockMetadata = {
  sizeRatioLocked?: boolean
}

export type ShadowEffectItem = {
  id: string
  enabled: boolean
  type: 'drop' | 'inner'
  offsetX: number
  offsetY: number
  blur: number
  spread: number
  color: string
}

export type ShadowEffectsMetadata = {
  shadowEffects?: ShadowEffectItem[]
}

export type Rotation3DMetadata = {
  // 绕画布平面内 X / Y 轴的立体旋转角（角度制）。绕 Z 轴的旋转沿用 Fabric 原生的 angle。
  rotateX?: number
  rotateY?: number
  rotateZ?: number // 存储用户设置的原始 Z 轴旋转角度，避免投影角度污染
  // 立体旋转前对象自身的缩放，用于让立体旋转与普通缩放可以叠加而互不破坏。
  rotation3dBaseScaleX?: number
  rotation3dBaseScaleY?: number
  // 用户通过面板翻转按钮设置的手动翻转意图。原生 flipX/flipY 会被立体旋转投影
  // 重算整体覆盖（见 applyRotation3DTransformToObject），把翻转意图单独存这里，
  // 重算时 XOR 叠加回去，保证拖拽/缩放等任何触发重算的交互都不会丢失翻转。
  rotation3dFlipX?: boolean
  rotation3dFlipY?: boolean
}

export const DEFAULT_KALEIDOSCOPE_COUNT = 6
export const MIN_KALEIDOSCOPE_COUNT = 1
export const MAX_KALEIDOSCOPE_COUNT = 36
export const EDITOR_OBJECT_ID_PREFIX = 'editor-object-'
export const DEFAULT_FILL_MODE: FillMode = 'solid'
export const DEFAULT_FILL_GRADIENT_TYPE: FillGradientType = 'linear'
export const DEFAULT_FILL_GRADIENT_ANGLE = 0
export const DEFAULT_FILL_GRADIENT_CENTER = 0.5
export const DEFAULT_FILL_GRADIENT_RADIUS = 0.5

export const SERIALIZED_OBJECT_PROPS = [
  'name',
  'strokeUniform',
  'lastFill',
  'lastStroke',
  'lastStrokeWidth',
  'lastStrokeDashArray',
  'shapeId',
  'arrowRenderMode',
  'arrowLineWidth',
  'arrowTipAngle',
  'arrowSideAngle',
  'editorObjectId',
  'endpointAttachments',
  'endpointSnapMargin',
  'booleanEligible',
  'fillRule',
  'editablePath',
  'cornerRadius',
  'cornerRadiusOverrides',
  'editablePathVersion',
  'fillMode',
  'fillGradientType',
  'fillGradientStops',
  'fillGradientAngle',
  'fillGradientCenterX',
  'fillGradientCenterY',
  'fillGradientRadius',
  'fillGradientCoords',
  'kaleidoscopeEnabled',
  'kaleidoscopeCenterX',
  'kaleidoscopeCenterY',
  'kaleidoscopeFollowRotation',
  'kaleidoscopeCount',
  'kaleidoscopeSourceId',
  'kaleidoscopeManaged',
  'kaleidoscopeInstanceOf',
  'kaleidoscopeInstanceIndex',
  'sizeRatioLocked',
  'shadowEffects',
  'bitmapFilters',
  // 图案填充回显元数据（fill 本体由 fabric 原生序列化，这里补面板/MCP 需要的来源与参数）
  'fillPatternSrc',
  'fillPatternName',
  'fillPatternRepeat',
  'fillPatternScale',
  'rotateX',
  'rotateY',
  'rotateZ',
  'rotation3dBaseScaleX',
  'rotation3dBaseScaleY',
  // 手动翻转意图随对象一起序列化（撤销/重做/工程保存的 round-trip 不丢翻转）
  'rotation3dFlipX',
  'rotation3dFlipY',
  // 符号实例元数据：挂在实例 Group 上（见 symbols.ts 说明），随 toObject / 工程 JSON round-trip，
  // 撤销 / 重做（loadFromJSON 全量重建）后实例凭 symbolId 保持与定义的关联。
  'symbolId',
  'symbolInstanceId',
  // 网格上色标记：油漆桶网格模式下生成的色块矩形（页面层据此做挖切/合并的增量维护）
  'gridPaintCell'
] as const

function cloneGradientStops(stops: FillGradientStop[]) {
  return stops.map((stop) => ({
    color: stop.color,
    offset: stop.offset
  }))
}

function normalizeGradientColor(value: unknown, fallback = '#000000') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function normalizeGradientOffset(value: unknown, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

function createDefaultGradientStops(color = '#000000') {
  const normalized = normalizeGradientColor(color)
  return [
    { color: normalized, offset: 0 },
    { color: normalized, offset: 1 }
  ]
}

export function getNormalizedGradientOffsetSlots(value: unknown, fallbackColor = '#000000') {
  const stops = Array.isArray(value)
    ? value
        .map((item, index) => {
          if (!item || typeof item !== 'object') return null
          const stop = item as Record<string, unknown>
          return {
            color: normalizeGradientColor(stop.color, fallbackColor),
            offset: normalizeGradientOffset(stop.offset, index === 0 ? 0 : 1)
          }
        })
        .filter((item): item is FillGradientStop => !!item)
        .sort((a, b) => a.offset - b.offset)
    : []
  if (!stops.length) return createDefaultGradientStops(fallbackColor).map((stop) => stop.offset)
  if (stops.length === 1) return [0, 1]
  const offsets = stops.map((stop) => stop.offset)
  offsets[0] = 0
  offsets[offsets.length - 1] = 1
  return offsets
}

function normalizeGradientStops(value: unknown, fallbackColor = '#000000') {
  if (!Array.isArray(value)) return createDefaultGradientStops(fallbackColor)
  const offsets = getNormalizedGradientOffsetSlots(value, fallbackColor)
  const normalized = value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const stop = item as Record<string, unknown>
      return {
        color: normalizeGradientColor(stop.color, fallbackColor),
        offset: normalizeGradientOffset(stop.offset, index === 0 ? 0 : 1)
      }
    })
    .filter((item): item is FillGradientStop => !!item)
    .sort((a, b) => a.offset - b.offset)
  if (!normalized.length) return createDefaultGradientStops(fallbackColor)
  if (normalized.length === 1) {
    const [only] = normalized
    return [
      { color: only.color, offset: 0 },
      { color: only.color, offset: 1 }
    ]
  }
  return normalized.map((stop, index) => ({
    ...stop,
    offset: offsets[index] ?? stop.offset
  }))
}

// fillMode 归一化：接受 solid/gradient/pattern 三种取值，其余回退 fallback。
function normalizeFillMode(value: unknown, fallback: FillMode = DEFAULT_FILL_MODE): FillMode {
  return value === 'gradient' || value === 'solid' || value === 'pattern' ? value : fallback
}

function normalizeFillGradientType(value: unknown, fallback: FillGradientType = DEFAULT_FILL_GRADIENT_TYPE): FillGradientType {
  return value === 'radial' || value === 'linear' ? value : fallback
}

function normalizeAngle(value: unknown, fallback = DEFAULT_FILL_GRADIENT_ANGLE) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const normalized = parsed % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function normalizeUnitInterval(value: unknown, fallback = DEFAULT_FILL_GRADIENT_CENTER) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

function normalizeRadius(value: unknown, fallback = DEFAULT_FILL_GRADIENT_RADIUS) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(2, Math.max(0.05, parsed))
}

function getGradientObjectDimensions(obj: FabricObject | null | undefined) {
  const width = Number(obj?.width)
  const height = Number(obj?.height)
  return {
    width: Math.max(1, Number.isFinite(width) ? width : 1),
    height: Math.max(1, Number.isFinite(height) ? height : 1)
  }
}

function getGradientDisplayDimensions(obj: FabricObject | null | undefined) {
  const scaledWidth = Number(obj?.getScaledWidth?.())
  const scaledHeight = Number(obj?.getScaledHeight?.())
  return {
    width: Math.max(1, Number.isFinite(scaledWidth) ? scaledWidth : getGradientObjectDimensions(obj).width),
    height: Math.max(1, Number.isFinite(scaledHeight) ? scaledHeight : getGradientObjectDimensions(obj).height)
  }
}

function getGradientRadiusBasis(obj: FabricObject | null | undefined) {
  const { width, height } = getGradientDisplayDimensions(obj)
  return Math.max(1, Math.hypot(width, height))
}

function isGradientLikeFill(value: unknown): value is {
  type?: unknown
  coords?: Record<string, unknown>
  colorStops?: unknown
  gradientUnits?: unknown
} {
  return !!value && typeof value === 'object' && 'type' in value && 'colorStops' in value && 'coords' in value
}

function extractGradientType(fill: unknown): FillGradientType | null {
  if (!isGradientLikeFill(fill)) return null
  return fill.type === 'radial' ? 'radial' : fill.type === 'linear' ? 'linear' : null
}

function extractGradientStops(fill: unknown) {
  if (!isGradientLikeFill(fill)) return null
  return Array.isArray(fill.colorStops) ? fill.colorStops : null
}

function extractGradientAngle(fill: unknown) {
  if (!isGradientLikeFill(fill) || fill.type !== 'linear') return null
  const coords = fill.coords ?? {}
  const x1 = Number(coords.x1)
  const y1 = Number(coords.y1)
  const x2 = Number(coords.x2)
  const y2 = Number(coords.y2)
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null
  return Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
}

function extractGradientCenter(fill: unknown, obj: FabricObject | null | undefined) {
  if (!isGradientLikeFill(fill) || fill.type !== 'radial') return null
  const coords = fill.coords ?? {}
  const x = Number(coords.x2)
  const y = Number(coords.y2)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (fill.gradientUnits === 'percentage') return { x, y }
  const { width, height } = getGradientObjectDimensions(obj)
  return {
    x: x / width,
    y: y / height
  }
}

function extractGradientRadius(fill: unknown, obj: FabricObject | null | undefined) {
  if (!isGradientLikeFill(fill) || fill.type !== 'radial') return null
  const coords = fill.coords ?? {}
  const radius = Number(coords.r2)
  if (!Number.isFinite(radius)) return null
  if (fill.gradientUnits === 'percentage') return radius
  return radius / getGradientRadiusBasis(obj)
}

export function normalizeFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeKaleidoscopeCount(value: unknown) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_KALEIDOSCOPE_COUNT
  return Math.min(MAX_KALEIDOSCOPE_COUNT, Math.max(MIN_KALEIDOSCOPE_COUNT, parsed))
}

export function getFillGradientMetadata(obj: FabricObject | null | undefined) {
  return obj ? (obj as AnyFabricObject & FillGradientMetadata) : null
}

export function applyDefaultFillGradientMetadata(obj: FabricObject | null | undefined) {
  const target = getFillGradientMetadata(obj)
  if (!target) return
  const fallbackColor = typeof target.lastFill === 'string' && target.lastFill.trim()
    ? target.lastFill
    : '#000000'
  const fillType = extractGradientType(target.fill)
  // 图案填充（fill 为 fabric Pattern）时 fillMode 保持 pattern，避免被元数据补默认值覆盖回纯色。
  const fillModeFallback: FillMode = fillType
    ? 'gradient'
    : target.fill instanceof Pattern
      ? 'pattern'
      : DEFAULT_FILL_MODE
  target.fillMode = normalizeFillMode(target.fillMode, fillModeFallback)
  target.fillGradientType = normalizeFillGradientType(target.fillGradientType, fillType ?? DEFAULT_FILL_GRADIENT_TYPE)
  target.fillGradientStops = normalizeGradientStops(target.fillGradientStops ?? extractGradientStops(target.fill), fallbackColor)
  target.fillGradientAngle = normalizeAngle(target.fillGradientAngle, normalizeAngle(extractGradientAngle(target.fill), DEFAULT_FILL_GRADIENT_ANGLE))
  const center = extractGradientCenter(target.fill, target)
  target.fillGradientCenterX = normalizeUnitInterval(target.fillGradientCenterX, normalizeUnitInterval(center?.x, DEFAULT_FILL_GRADIENT_CENTER))
  target.fillGradientCenterY = normalizeUnitInterval(target.fillGradientCenterY, normalizeUnitInterval(center?.y, DEFAULT_FILL_GRADIENT_CENTER))
  target.fillGradientRadius = normalizeRadius(target.fillGradientRadius, normalizeRadius(extractGradientRadius(target.fill, target), DEFAULT_FILL_GRADIENT_RADIUS))
}

/** 校验精确坐标快照是否完整可用：线性需 x1..y2，径向还需 r2。 */
function isValidFillGradientCoords(coords: FillGradientCoords | null | undefined, type: FillGradientType): coords is FillGradientCoords {
  if (!coords) return false
  const base = [coords.x1, coords.y1, coords.x2, coords.y2].every((value) => Number.isFinite(value))
  if (!base) return false
  if (type === 'radial') return Number.isFinite(coords.r2)
  return true
}

/**
 * 从 percentage 坐标系的渐变实例中提取精确坐标快照。
 * pixels 单位渐变（界面构建）不提取——其坐标依赖对象尺寸，继续走角度/中心/半径元数据。
 */
function getFillGradientCoordsFromGradient(gradient: Gradient<'linear' | 'radial'>): FillGradientCoords | null {
  if (gradient.gradientUnits !== 'percentage') return null
  const source = (gradient.coords ?? {}) as Record<string, unknown>
  const numberOr = (key: string, fallback = NaN) => {
    const parsed = Number(source[key])
    return Number.isFinite(parsed) ? parsed : fallback
  }
  if (gradient.type === 'radial') {
    const x2 = numberOr('x2')
    const y2 = numberOr('y2')
    const r2 = numberOr('r2')
    if (![x2, y2, r2].every(Number.isFinite)) return null
    return {
      x1: numberOr('x1', x2),
      y1: numberOr('y1', y2),
      r1: numberOr('r1', 0),
      x2,
      y2,
      r2
    }
  }
  const coords: FillGradientCoords = {
    x1: numberOr('x1'),
    y1: numberOr('y1'),
    x2: numberOr('x2'),
    y2: numberOr('y2')
  }
  return isValidFillGradientCoords(coords, 'linear') ? coords : null
}

/**
 * 把渐变实例的完整信息同步到对象的渐变元数据：
 * 类型/停止点/精确坐标直接来自实例；角度、中心、半径作为近似值供属性面板滑杆展示。
 * 坐标为 percentage 单位时才会写入精确快照，否则保留既有元数据语义。
 */
export function syncFillGradientMetadataFromGradient(target: FabricObject | null | undefined, gradient: Gradient<'linear' | 'radial'>) {
  const metadata = getFillGradientMetadata(target)
  if (!metadata || !(gradient instanceof Gradient)) return
  const type: FillGradientType = gradient.type === 'radial' ? 'radial' : 'linear'
  const stops = (gradient.colorStops ?? []).map((stop) => ({
    color: String(stop.color),
    offset: Math.min(1, Math.max(0, Number(stop.offset) || 0))
  }))
  const coords = getFillGradientCoordsFromGradient(gradient)
  metadata.fillMode = 'gradient'
  metadata.fillGradientType = type
  metadata.fillGradientStops = stops.length ? stops : createDefaultGradientStops()
  metadata.fillGradientCoords = coords ?? undefined
  if (coords) {
    if (type === 'linear') {
      const angle = Math.atan2(coords.y2 - coords.y1, coords.x2 - coords.x1) * 180 / Math.PI
      metadata.fillGradientAngle = normalizeAngle(angle)
    } else {
      metadata.fillGradientCenterX = Math.min(1, Math.max(0, coords.x2))
      metadata.fillGradientCenterY = Math.min(1, Math.max(0, coords.y2))
      metadata.fillGradientRadius = Math.min(2, Math.max(0.05, coords.r2 ?? DEFAULT_FILL_GRADIENT_RADIUS))
    }
    return
  }
  // 像素单位渐变：按既有反提逻辑回填近似元数据，精确坐标快照清除。
  metadata.fillGradientAngle = undefined
  metadata.fillGradientCenterX = undefined
  metadata.fillGradientCenterY = undefined
  metadata.fillGradientRadius = undefined
  applyDefaultFillGradientMetadata(target)
}

/**
 * 由渐变元数据构建 fabric Gradient 实例。
 * 存在精确坐标快照（percentage 坐标系）时优先按快照重建，保证保存/撤销后视觉完全一致；
 * 否则按角度（线性）或中心/半径（径向）的既有语义构建。
 */
export function createGradientFromMetadata(obj: FabricObject | null | undefined) {
  const target = getFillGradientMetadata(obj)
  if (!target) return null
  applyDefaultFillGradientMetadata(target)
  if (target.fillMode !== 'gradient') return null
  const type = target.fillGradientType ?? DEFAULT_FILL_GRADIENT_TYPE
  const colorStops = cloneGradientStops(target.fillGradientStops ?? createDefaultGradientStops(target.lastFill))
  if (isValidFillGradientCoords(target.fillGradientCoords, type)) {
    const coords = target.fillGradientCoords
    return new Gradient({
      type,
      gradientUnits: 'percentage',
      colorStops,
      coords: type === 'radial'
        ? {
            x1: coords.x1,
            y1: coords.y1,
            r1: coords.r1 ?? 0,
            x2: coords.x2,
            y2: coords.y2,
            r2: coords.r2
          }
        : {
            x1: coords.x1,
            y1: coords.y1,
            x2: coords.x2,
            y2: coords.y2
          }
    })
  }
  if (type === 'radial') {
    const { width, height } = getGradientObjectDimensions(target)
    const centerX = normalizeUnitInterval(target.fillGradientCenterX)
    const centerY = normalizeUnitInterval(target.fillGradientCenterY)
    const radius = normalizeRadius(target.fillGradientRadius)
    const x = centerX * width
    const y = centerY * height
    return new Gradient({
      type: 'radial',
      gradientUnits: 'pixels',
      colorStops,
      coords: {
        x1: x,
        y1: y,
        r1: 0,
        x2: x,
        y2: y,
        r2: radius * getGradientRadiusBasis(target)
      }
    })
  }
  const angle = normalizeAngle(target.fillGradientAngle)
  const radians = angle * Math.PI / 180
  const dx = Math.cos(radians) * 0.5
  const dy = Math.sin(radians) * 0.5
  return new Gradient({
    type: 'linear',
    gradientUnits: 'percentage',
    colorStops,
    coords: {
      x1: 0.5 - dx,
      y1: 0.5 - dy,
      x2: 0.5 + dx,
      y2: 0.5 + dy
    }
  })
}

export function cloneFillGradientStops(stops: FillGradientStop[] | null | undefined) {
  return cloneGradientStops(normalizeGradientStops(stops))
}

export function clearFillGradientMetadata(obj: FabricObject | null | undefined) {
  const target = getFillGradientMetadata(obj)
  if (!target) return
  target.fillMode = DEFAULT_FILL_MODE
  target.fillGradientType = DEFAULT_FILL_GRADIENT_TYPE
  target.fillGradientStops = createDefaultGradientStops(target.lastFill)
  target.fillGradientAngle = DEFAULT_FILL_GRADIENT_ANGLE
  target.fillGradientCenterX = DEFAULT_FILL_GRADIENT_CENTER
  target.fillGradientCenterY = DEFAULT_FILL_GRADIENT_CENTER
  target.fillGradientRadius = DEFAULT_FILL_GRADIENT_RADIUS
}

export function normalizeEndpointSnapMargin(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

export function getKaleidoscopeMetadata(obj: FabricObject | null | undefined) {
  return obj ? (obj as AnyFabricObject & KaleidoscopeMetadata) : null
}

export function applyDefaultKaleidoscopeMetadata(obj: FabricObject | null | undefined) {
  const target = getKaleidoscopeMetadata(obj)
  if (!target) return
  target.kaleidoscopeEnabled = target.kaleidoscopeEnabled === true
  target.kaleidoscopeCenterX = normalizeFiniteNumber(target.kaleidoscopeCenterX)
  target.kaleidoscopeCenterY = normalizeFiniteNumber(target.kaleidoscopeCenterY)
  target.kaleidoscopeFollowRotation = target.kaleidoscopeFollowRotation === true
  target.kaleidoscopeCount = normalizeKaleidoscopeCount(target.kaleidoscopeCount)
  target.kaleidoscopeSourceId = typeof target.kaleidoscopeSourceId === 'string' ? target.kaleidoscopeSourceId : ''
  target.kaleidoscopeManaged = target.kaleidoscopeManaged === true
  target.kaleidoscopeInstanceOf = typeof target.kaleidoscopeInstanceOf === 'string' ? target.kaleidoscopeInstanceOf : ''
  target.kaleidoscopeInstanceIndex = Math.max(0, Math.round(normalizeFiniteNumber(target.kaleidoscopeInstanceIndex)))
}

export function clearKaleidoscopeMetadata(obj: FabricObject | null | undefined) {
  const target = getKaleidoscopeMetadata(obj)
  if (!target) return
  target.kaleidoscopeEnabled = false
  target.kaleidoscopeCenterX = 0
  target.kaleidoscopeCenterY = 0
  target.kaleidoscopeFollowRotation = false
  target.kaleidoscopeCount = DEFAULT_KALEIDOSCOPE_COUNT
  target.kaleidoscopeSourceId = ''
  target.kaleidoscopeManaged = false
  target.kaleidoscopeInstanceOf = ''
  target.kaleidoscopeInstanceIndex = 0
}

export function getEndpointSnapMarginMetadata(obj: FabricObject | null | undefined) {
  return obj ? (obj as AnyFabricObject & EndpointSnapMarginMetadata) : null
}

export function applyDefaultEndpointSnapMargin(obj: FabricObject | null | undefined) {
  const target = getEndpointSnapMarginMetadata(obj)
  if (!target) return
  target.endpointSnapMargin = normalizeEndpointSnapMargin(target.endpointSnapMargin)
}

export function getObjectEndpointSnapMargin(obj: FabricObject | null | undefined) {
  applyDefaultEndpointSnapMargin(obj)
  return getEndpointSnapMarginMetadata(obj)?.endpointSnapMargin ?? 0
}

export function getSizeRatioLockMetadata(obj: FabricObject | null | undefined) {
  return obj ? (obj as AnyFabricObject & SizeRatioLockMetadata) : null
}

/**
 * 统一补齐对象的宽高比例锁定元数据；未显式标记时按未锁定处理，供创建、序列化和恢复链路共享。
 */
export function applyDefaultSizeRatioLockMetadata(obj: FabricObject | null | undefined) {
  const target = getSizeRatioLockMetadata(obj)
  if (!target) return
  target.sizeRatioLocked = target.sizeRatioLocked === true
}

/**
 * 标记对象默认采用等比缩放；属性面板仍可通过后续开关改写此状态。
 */
export function markObjectSizeRatioLocked(obj: FabricObject | null | undefined, locked = true) {
  const target = getSizeRatioLockMetadata(obj)
  if (!target) return
  target.sizeRatioLocked = locked === true
}

/**
 * 读取对象当前的宽高比例锁定状态；缺失元数据时会先回填默认值，避免调用方重复做空值判断。
 */
export function isObjectSizeRatioLocked(obj: FabricObject | null | undefined) {
  applyDefaultSizeRatioLockMetadata(obj)
  return getSizeRatioLockMetadata(obj)?.sizeRatioLocked === true
}

export function getShadowEffectsMetadata(obj: FabricObject | null | undefined) {
  return obj ? (obj as AnyFabricObject & ShadowEffectsMetadata) : null
}

function normalizeShadowEffect(effect: any): ShadowEffectItem | null {
  if (!effect || typeof effect !== 'object') return null
  return {
    id: typeof effect.id === 'string' && effect.id ? effect.id : String(Date.now() + Math.random()),
    enabled: effect.enabled !== false,
    type: effect.type === 'inner' ? 'inner' : 'drop',
    offsetX: normalizeFiniteNumber(effect.offsetX, 0),
    offsetY: normalizeFiniteNumber(effect.offsetY, 4),
    blur: Math.max(0, normalizeFiniteNumber(effect.blur, 8)),
    spread: normalizeFiniteNumber(effect.spread, 0),
    color: typeof effect.color === 'string' && effect.color.trim() ? effect.color : 'rgba(0, 0, 0, 0.25)'
  }
}

export function applyDefaultShadowEffectsMetadata(obj: FabricObject | null | undefined) {
  const target = getShadowEffectsMetadata(obj)
  if (!target) return

  if (Array.isArray(target.shadowEffects)) {
    target.shadowEffects = target.shadowEffects
      .map(normalizeShadowEffect)
      .filter((item): item is ShadowEffectItem => item !== null)
  } else {
    target.shadowEffects = []
  }
}

export function applyShadowEffectsToFabricObject(obj: FabricObject | null | undefined) {
  const target = getShadowEffectsMetadata(obj)
  if (!target) return

  applyDefaultShadowEffectsMetadata(target)

  const anyObj = obj as any
  const enabledEffects = (target.shadowEffects ?? []).filter(effect => effect.enabled)

  if (enabledEffects.length === 1 && enabledEffects[0].type === 'drop') {
    const firstEffect = enabledEffects[0]
    // 必须包装为 fabric.Shadow 实例：直接赋值普通对象会绕过 set() 的类型包装，
    // 后续 toObject 序列化（快照/保存/克隆）调用 shadow.toObject() 时抛错，
    // 并在拖拽松手的 object:modified 链路中中断 fabric 的拖拽清理，导致元素持续跟随鼠标。
    anyObj.shadow = new Shadow({
      color: firstEffect.color,
      blur: firstEffect.blur,
      offsetX: firstEffect.offsetX,
      offsetY: firstEffect.offsetY
    })
  } else {
    // 0 个启用效果 → 无阴影；多个效果或含内阴影 → 原生 shadow 只支持单个投影，
    // 置空后交给 multiShadow 模块按 shadowEffects 元数据自绘（渲染与 SVG 导出全量生效）。
    anyObj.shadow = null
  }
  // 阴影状态变化必须触发缓存重绘；缓存尺寸因阴影外扩变化时由 _updateCacheCanvas 自动重建
  obj.dirty = true
}

export function createDefaultShadowEffect(): ShadowEffectItem {
  return {
    id: String(Date.now() + Math.random()),
    enabled: true,
    type: 'drop',
    offsetX: 0,
    offsetY: 4,
    blur: 8,
    spread: 0,
    color: 'rgba(0, 0, 0, 0.25)'
  }
}

// 透视投影中相机到平面的归一化距离，值越大透视越弱（越接近正交投影）。
const ROTATION_3D_PERSPECTIVE = 4

export function getRotation3DMetadata(obj: FabricObject | null | undefined) {
  return obj ? (obj as AnyFabricObject & Rotation3DMetadata) : null
}

export function applyDefaultRotation3DMetadata(obj: FabricObject | null | undefined) {
  const target = getRotation3DMetadata(obj)
  if (!target) return
  target.rotateX = normalizeRotation3DAngle(target.rotateX)
  target.rotateY = normalizeRotation3DAngle(target.rotateY)
  target.rotateZ = normalizeRotation3DAngle(target.rotateZ)
  target.rotation3dBaseScaleX = normalizeFiniteNumber(target.rotation3dBaseScaleX, 1)
  target.rotation3dBaseScaleY = normalizeFiniteNumber(target.rotation3dBaseScaleY, 1)
  // rotation3dFlipX 尚未初始化（undefined）说明该对象的翻转意图从未被面板写入或
  // 序列化恢复——此时原生 flipX/flipY 减去投影镜像成分后就是用户意图（旧工程载入、
  // 导入自带翻转的 SVG 等）。收编进意图位，避免下一次投影重算把它们当作投影残留冲掉。
  if (target.rotation3dFlipX === undefined) {
    const projection = computeRotation3DTransform(
      target.rotateX ?? 0,
      target.rotateY ?? 0,
      0,
      1,
      1
    )
    target.rotation3dFlipX = projection.flipX !== (target.flipX === true)
    target.rotation3dFlipY = projection.flipY !== (target.flipY === true)
  } else {
    // 翻转意图只认 true，避免 falsy 歧义
    target.rotation3dFlipX = target.rotation3dFlipX === true
    target.rotation3dFlipY = target.rotation3dFlipY === true
  }
}

export function clearRotation3DMetadata(obj: FabricObject | null | undefined) {
  const target = getRotation3DMetadata(obj)
  if (!target) return
  target.rotateX = 0
  target.rotateY = 0
  target.rotateZ = 0
  target.rotation3dBaseScaleX = 1
  target.rotation3dBaseScaleY = 1
  target.rotation3dFlipX = false
  target.rotation3dFlipY = false
}

// 旋转角统一归一化到 [0, 360)，与平面旋转滑杆保持一致的取值范围。
export function normalizeRotation3DAngle(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  const mod = parsed % 360
  return mod < 0 ? mod + 360 : mod
}

type Vec3 = [number, number, number]

function rotateAroundX([x, y, z]: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [x, y * c - z * s, y * s + z * c]
}

function rotateAroundY([x, y, z]: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [x * c + z * s, y, -x * s + z * c]
}

// 透视投影：把 3D 点投影到 z=0 平面，z 越靠近相机（越大）放大越多。
function projectPerspective([x, y, z]: Vec3): { x: number; y: number } {
  const factor = ROTATION_3D_PERSPECTIVE / (ROTATION_3D_PERSPECTIVE - z)
  return { x: x * factor, y: y * factor }
}

export type Rotation3DTransform = {
  scaleX: number
  scaleY: number
  skewX: number
  skewY: number
  angle: number
  flipX: boolean
  flipY: boolean
}

/**
 * 把三轴旋转角度（角度制）连同基础缩放分解为 Fabric 的 2D 变换组合。
 *
 * 设计要点：绕 Z 轴的旋转就是平面内旋转，等价于 Fabric 的 angle，作为最外层叠加；
 * 绕 X / Y 轴的旋转通过对单位基向量做 3D 旋转 + 透视投影来模拟立体翻转，
 * 再用 QR 式分解反解出 scaleX / scaleY / skewX。三个轴因此都"对照旋转"来实现。
 *
 * baseScaleX / baseScaleY 是对象自身缩放（拖拽改变尺寸得到的值），与投影系数相乘后再分解，
 * 保证立体旋转与普通缩放可以叠加而互不破坏。
 */
export function computeRotation3DTransform(
  rotateX: number,
  rotateY: number,
  rotateZ: number,
  baseScaleX = 1,
  baseScaleY = 1
): Rotation3DTransform {
  const rx = (rotateX * Math.PI) / 180
  const ry = (rotateY * Math.PI) / 180

  // 仅用 X / Y 轴旋转构造投影后的两条基向量；Z 轴旋转留到最后以纯角度叠加。
  const project = (v: Vec3) => projectPerspective(rotateAroundY(rotateAroundX(v, rx), ry))
  const ux = project([1, 0, 0])
  const uy = project([0, 1, 0])

  // 叠加基础缩放：相当于先对局部坐标缩放，再投影。
  const a = ux.x * baseScaleX
  const b = ux.y * baseScaleX
  const c = uy.x * baseScaleY
  const d = uy.y * baseScaleY

  // QR 式分解：从 col0 取旋转角与 scaleX，再据此求 skewX 与 scaleY。
  const denom = Math.hypot(a, b) || 1e-6
  let scaleX = denom
  const shear = (a * c + b * d) / (denom * denom)
  let scaleY = (a * d - b * c) / denom
  let projAngle = Math.atan2(b, a)

  let flipX = false
  let flipY = false
  if (scaleX < 0) {
    scaleX = -scaleX
    flipX = true
  }
  if (scaleY < 0) {
    scaleY = -scaleY
    flipY = true
  }

  // 当发生 flipY 时，调整投影角度以保持视觉一致性
  // flipY 意味着对象在 Y 轴上翻转了，此时投影角度会跳变约 180°
  // 我们需要补偿这个跳变，使得 Z 轴旋转保持稳定
  if (flipY) {
    projAngle = projAngle + Math.PI
  }

  return {
    scaleX,
    scaleY,
    skewX: (Math.atan(shear) * 180) / Math.PI,
    skewY: 0,
    // 平面旋转（rotateZ）作为最外层旋转，与投影自身产生的微小角度相加。
    angle: rotateZ + (projAngle * 180) / Math.PI,
    flipX,
    flipY
  }
}

/**
 * 把三轴旋转元数据应用到 Fabric 对象上，将其物理变换设为对应的投影结果。
 *
 * 投影分解出的 flipX/flipY 只表达立体旋转自身的镜像（无 3D 旋转时恒为 false），
 * 用户通过翻转按钮设置的意图存于 rotation3dFlipX/Y，这里 XOR 叠加到投影结果上，
 * 避免任何触发重算的交互（拖拽、缩放、改 3D 角度等）冲掉手动翻转。
 */
export function applyRotation3DTransformToObject(obj: FabricObject | null | undefined) {
  const target = getRotation3DMetadata(obj)
  if (!target || !obj) return
  applyDefaultRotation3DMetadata(target)

  const rotateX = target.rotateX ?? 0
  const rotateY = target.rotateY ?? 0
  const rotateZ = target.rotateZ ?? 0  // 使用存储的原始 Z 轴角度
  const baseScaleX = target.rotation3dBaseScaleX ?? 1
  const baseScaleY = target.rotation3dBaseScaleY ?? 1

  const transform = computeRotation3DTransform(rotateX, rotateY, rotateZ, baseScaleX, baseScaleY)

  obj.set({
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    skewX: transform.skewX,
    skewY: transform.skewY,
    angle: transform.angle,
    flipX: transform.flipX !== (target.rotation3dFlipX === true),
    flipY: transform.flipY !== (target.rotation3dFlipY === true)
  })
}

/**
 * 从 Fabric 对象当前变换反推出基础缩放（未应用立体旋转投影前的真实缩放）。
 *
 * 用于在用户拖拽缩放手柄后，把新的 scaleX/scaleY 写回 rotation3dBaseScaleX/Y，
 * 再重新应用立体旋转，这样缩放与立体旋转保持独立可叠加。
 *
 * 同时把两样手势产物回写元数据，防止随后的 applyRotation3DTransformToObject 覆盖丢失：
 * - 原生 angle 中的平面旋转角 → rotateZ（鼠标旋转手势只改 angle，不经过 rotateZ）；
 * - 原生 flipX/flipY 与已存翻转意图的差异 → rotation3dFlipX/Y（fabric 部分交互
 *   （如缩放越过零点）会直接翻转原生 flip，这里把物理翻转收编为用户意图）。
 */
export function extractRotation3DBaseScalesFromObject(obj: FabricObject | null | undefined) {
  const target = getRotation3DMetadata(obj)
  if (!target || !obj) return
  applyDefaultRotation3DMetadata(target)

  const rotateX = target.rotateX ?? 0
  const rotateY = target.rotateY ?? 0

  // 计算只有 X/Y 旋转时的投影系数（不含基础缩放）。
  const unitTransform = computeRotation3DTransform(rotateX, rotateY, 0, 1, 1)

  // 当前 Fabric scaleX/Y 是 基础缩放 × 投影系数，反推基础缩放。
  const currentScaleX = Math.abs(obj.scaleX ?? 1)
  const currentScaleY = Math.abs(obj.scaleY ?? 1)
  const baseScaleX = Math.abs(unitTransform.scaleX) > 1e-6 ? currentScaleX / unitTransform.scaleX : 1
  const baseScaleY = Math.abs(unitTransform.scaleY) > 1e-6 ? currentScaleY / unitTransform.scaleY : 1

  target.rotation3dBaseScaleX = baseScaleX
  target.rotation3dBaseScaleY = baseScaleY
  // 鼠标旋转手势只改原生 angle；投影自带的偏角会被随后的重算清除，
  // 先把纯平面角收进 rotateZ（unitTransform 以 rotateZ=0 计算，其 angle 即投影偏角）。
  target.rotateZ = normalizeRotation3DAngle((obj.angle ?? 0) - (unitTransform.angle ?? 0))
  // 物理翻转 ⊕ 投影翻转 = 用户意图，把手势期间产生的原生翻转差异收编进意图位。
  target.rotation3dFlipX = unitTransform.flipX !== (obj.flipX === true)
  target.rotation3dFlipY = unitTransform.flipY !== (obj.flipY === true)
}

