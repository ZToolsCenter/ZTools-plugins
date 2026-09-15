/**
 * 位图滤镜与混合模式的纯数据模型（不依赖 fabric）：
 * 属性面板、MCP 调度层与运行时共用同一份类型、常量与归一化逻辑，
 * 保证 UI 展示、MCP 入参校验与对象元数据三处语义一致。
 * 本文件禁止 import fabric，以免破坏 MCP 调度层的 Node 测试链路。
 */

/** 位图滤镜类型（与 fabric 滤镜一一对应，命名采用 UI/MCP 侧小写约定）。 */
export type BitmapFilterType = 'grayscale' | 'invert' | 'sepia' | 'blur' | 'brightness' | 'contrast' | 'saturation'

/** 位图滤镜的可调参数键：blur 用 strength，其余颜色类滤镜用同名键。 */
export type BitmapFilterParamKey = 'strength' | 'brightness' | 'contrast' | 'saturation'

/**
 * 单条滤镜设置（UI 与 MCP 共用数据结构，即对象 bitmapFilters 元数据的条目）：
 * enabled 为 false 时条目保留（参数不丢失）但不参与渲染。
 */
export interface BitmapFilterSetting {
  type: BitmapFilterType
  enabled: boolean
  /** blur 强度（0-1，默认 0.1）。 */
  strength?: number
  /** 亮度（-1~1，默认 0）。 */
  brightness?: number
  /** 对比度（-1~1，默认 0）。 */
  contrast?: number
  /** 饱和度（-1~1，默认 0）。 */
  saturation?: number
}

/** 全部受支持的滤镜类型，顺序即属性面板展示与写入对象的固定顺序。 */
export const BITMAP_FILTER_TYPES: BitmapFilterType[] = [
  'grayscale',
  'invert',
  'sepia',
  'blur',
  'brightness',
  'contrast',
  'saturation'
]

/** 滤镜中文名（属性面板与 MCP 错误提示共用）。 */
export const BITMAP_FILTER_LABELS: Record<BitmapFilterType, string> = {
  grayscale: '灰度',
  invert: '反色',
  sepia: '褐色',
  blur: '模糊',
  brightness: '亮度',
  contrast: '对比度',
  saturation: '饱和度'
}

/** 各滤镜的可调参数配置；无参滤镜（灰度/反色/褐色）为 null。 */
export const BITMAP_FILTER_PARAM_CONFIG: Record<BitmapFilterType, { key: BitmapFilterParamKey; min: number; max: number } | null> = {
  grayscale: null,
  invert: null,
  sepia: null,
  blur: { key: 'strength', min: 0, max: 1 },
  brightness: { key: 'brightness', min: -1, max: 1 },
  contrast: { key: 'contrast', min: -1, max: 1 },
  saturation: { key: 'saturation', min: -1, max: 1 }
}

/** 滑杆步进：与现有面板滑杆一致，全部滤镜参数统一 0.01。 */
export const BITMAP_FILTER_PARAM_STEP = 0.01

/** 滤镜参数在属性面板中的中文标签（blur 为强度，颜色类滤镜统一为数值）。 */
export const BITMAP_FILTER_PARAM_LABELS: Record<BitmapFilterParamKey, string> = {
  strength: '强度',
  brightness: '数值',
  contrast: '数值',
  saturation: '数值'
}

/** 启用 blur 滤镜时的默认强度；0 对 fabric 而言是中性状态（无视觉效果），故取 0.1。 */
export const DEFAULT_BLUR_STRENGTH = 0.1

/** 全部受支持的混合模式值（normal 映射 fabric 的 source-over，其余与 canvas 合成模式同名）。 */
export const BLEND_MODES: string[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity'
]

/** 混合模式下拉选项（value 为对外约定的混合模式名，normal 表示正常）。 */
export const BLEND_MODE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '正常', value: 'normal' },
  { label: '正片叠底', value: 'multiply' },
  { label: '滤色', value: 'screen' },
  { label: '叠加', value: 'overlay' },
  { label: '变暗', value: 'darken' },
  { label: '变亮', value: 'lighten' },
  { label: '颜色减淡', value: 'color-dodge' },
  { label: '差值', value: 'difference' },
  { label: '排除', value: 'exclusion' },
  { label: '色相', value: 'hue' },
  { label: '饱和度', value: 'saturation' },
  { label: '颜色', value: 'color' },
  { label: '明度', value: 'luminosity' }
]

/** 校验混合模式名，合法返回原名，非法返回 null。 */
export function normalizeBlendMode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return BLEND_MODES.includes(trimmed) ? trimmed : null
}

/** 把对外约定的混合模式名换算为 fabric 的 globalCompositeOperation 值。 */
export function blendModeToCompositeOperation(mode: string): string {
  return mode === 'normal' ? 'source-over' : mode
}

/** 把 fabric 的 globalCompositeOperation 值换算回对外约定的混合模式名。 */
export function compositeOperationToBlendMode(operation: unknown): string {
  if (typeof operation !== 'string' || operation === '' || operation === 'source-over') return 'normal'
  return operation
}

/** 把参数值收敛到该滤镜的合法区间；非有限数返回 undefined（表示未提供）。 */
export function clampBitmapFilterParam(type: BitmapFilterType, key: BitmapFilterParamKey, value: unknown): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const config = BITMAP_FILTER_PARAM_CONFIG[type]
  if (!config || config.key !== key) return undefined
  return Math.min(config.max, Math.max(config.min, parsed))
}

/**
 * 创建指定类型的默认滤镜设置：参数取启用默认值（blur 0.1、颜色类 0），
 * enabled 可指定初始开关态（面板未配置行的禁用态也用它生成，保证再次启用时参数合理）。
 */
export function createDefaultBitmapFilterSetting(type: BitmapFilterType, enabled = true): BitmapFilterSetting {
  return normalizeBitmapFilterSetting({ type, enabled })!
}

/**
 * 归一化单条滤镜设置：类型非法返回 null；enabled 仅接受真实布尔（缺省视为启用）；
 * 参数按各自区间收敛，未提供的参数取启用默认值（blur 0.1、颜色类 0），保证开关后立即有可感知效果。
 */
export function normalizeBitmapFilterSetting(raw: unknown): BitmapFilterSetting | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  const rawType = typeof entry.type === 'string' ? entry.type.trim() : ''
  if (!BITMAP_FILTER_TYPES.includes(rawType as BitmapFilterType)) return null
  const type = rawType as BitmapFilterType
  const setting: BitmapFilterSetting = { type, enabled: entry.enabled !== false }
  const strength = clampBitmapFilterParam(type, 'strength', entry.strength)
  if (strength !== undefined) setting.strength = strength
  else if (type === 'blur') setting.strength = DEFAULT_BLUR_STRENGTH
  const brightness = clampBitmapFilterParam(type, 'brightness', entry.brightness)
  if (brightness !== undefined) setting.brightness = brightness
  else if (type === 'brightness') setting.brightness = 0
  const contrast = clampBitmapFilterParam(type, 'contrast', entry.contrast)
  if (contrast !== undefined) setting.contrast = contrast
  else if (type === 'contrast') setting.contrast = 0
  const saturation = clampBitmapFilterParam(type, 'saturation', entry.saturation)
  if (saturation !== undefined) setting.saturation = saturation
  else if (type === 'saturation') setting.saturation = 0
  return setting
}

/**
 * 归一化滤镜设置列表并按面板固定顺序重建：同类型条目后项覆盖前项（UI 每类型只有一行，
 * 固定顺序保证设置、渲染与序列化三处一致）。非法条目跳过；非数组输入返回空列表。
 */
export function normalizeBitmapFilterSettings(raw: unknown): BitmapFilterSetting[] {
  if (!Array.isArray(raw)) return []
  const byType = new Map<BitmapFilterType, BitmapFilterSetting>()
  for (const item of raw) {
    const setting = normalizeBitmapFilterSetting(item)
    if (setting) byType.set(setting.type, setting)
  }
  return BITMAP_FILTER_TYPES
    .filter((type) => byType.has(type))
    .map((type) => byType.get(type)!)
}

/** 读取对象上的滤镜元数据容器（不做归一化；非对象返回 null）。 */
export function getBitmapFiltersMeta(obj: unknown): { bitmapFilters?: BitmapFilterSetting[] } | null {
  return obj && typeof obj === 'object' ? (obj as { bitmapFilters?: BitmapFilterSetting[] }) : null
}

/**
 * 读取对象当前生效的滤镜设置列表（供属性面板与 MCP 摘要回显）：
 * 优先读 bitmapFilters 元数据；元数据缺失时回退到对象原生 filters 数组（按 type 识别），保证
 * 程序化创建（绕过本编辑器写入路径）的位图也能被正确识别。
 */
export function readBitmapFilterSettings(obj: unknown): BitmapFilterSetting[] {
  const target = getBitmapFiltersMeta(obj)
  if (!target) return []
  if (Array.isArray(target.bitmapFilters)) {
    return normalizeBitmapFilterSettings(target.bitmapFilters)
  }
  const nativeFilters = (target as { filters?: unknown }).filters
  if (!Array.isArray(nativeFilters)) return []
  return normalizeBitmapFilterSettings(nativeFilters.map(mapNativeFilterRecord))
}

/**
 * 把 fabric 原生滤镜的序列化形态（type 为 'Blur' 等首字母大写、blur 参数名）
 * 映射为本模型的设置条目（type 小写、blur 映射为 strength），供元数据缺失时回退识别。
 */
function mapNativeFilterRecord(filter: unknown): Record<string, unknown> | null {
  if (!filter || typeof filter !== 'object') return null
  const record = filter as Record<string, unknown>
  const nativeType = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  if (nativeType === 'blur') {
    return { type: 'blur', enabled: true, strength: record.blur }
  }
  if (nativeType === 'grayscale' || nativeType === 'invert' || nativeType === 'sepia') {
    return { type: nativeType, enabled: true }
  }
  return { ...record, type: nativeType }
}
