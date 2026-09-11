/**
 * 文档级样式元数据：命名色板与自定义样式预设。
 *
 * 数据结构与工程文件解耦：序列化时挂在工程 JSON 顶层 meta 字段，
 * 同时随撤销快照以 editorMeta 字段进入历史 JSON，保证存/读与撤销回滚都能还原。
 * 本模块只做纯数据归一化与校验，不依赖 fabric，供工程解析、运行时与 MCP 网关共同复用。
 */

/** 命名色板条目：name 在文档内唯一，重复添加按 upsert 语义覆盖颜色。 */
export type DocumentSwatch = {
  name: string
  color: string
}

/**
 * 样式预设可包含的样式组合。
 * fill/stroke 允许保存 "swatch:名字" 引用或渐变 JSON 对象（应用时再解析），
 * shadow 允许保存 { color, blur, offsetX, offsetY } 对象或 null（清除阴影）。
 */
export type DocumentStylePresetStyle = {
  fill?: unknown
  stroke?: unknown
  strokeWidth?: number
  cornerRadius?: number
  shadow?: unknown
  opacity?: number
}

/** 文档级自定义样式预设。 */
export type DocumentStylePreset = {
  name: string
  style: DocumentStylePresetStyle
}

/** 预设来源：builtin 为代码内置（不可删除不可覆盖），custom 为文档内保存。 */
export type DocumentStylePresetSource = 'builtin' | 'custom'

/** 带来源标记的预设（list_style_presets 的返回结构）。 */
export type DocumentStylePresetSummary = DocumentStylePreset & {
  source: DocumentStylePresetSource
}

/** 文档级样式元数据整体结构（工程 JSON 的 meta 字段）。 */
export type DocumentStyleMeta = {
  swatches: DocumentSwatch[]
  stylePresets: DocumentStylePreset[]
}

/** 预设样式允许出现的键，其余键在归一化时丢弃。 */
const PRESET_STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'cornerRadius', 'shadow', 'opacity'] as const

type PresetStyleKey = (typeof PRESET_STYLE_KEYS)[number]

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_COLOR_PATTERN = /^rgba?\(([^)]*)\)$/i
const RGB_COMPONENT_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)%?$/

/**
 * 校验是否为可存储的颜色字符串：接受 hex（3/4/6/8 位）与 rgb()/rgba() 表达式。
 * 返回 true 表示合法，调用方据此向 AI 报"非法颜色"错误。
 */
export function isSupportedColorString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (HEX_COLOR_PATTERN.test(trimmed)) return true
  const rgbMatch = trimmed.match(RGB_COLOR_PATTERN)
  if (!rgbMatch) return false
  const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return false
  return parts.every((part) => RGB_COMPONENT_PATTERN.test(part))
}

/**
 * 按名称把色板条目合并进列表（不改变传入数组）：同名覆盖颜色，否则追加。
 * 返回新数组，供响应式状态整体替换触发更新。
 */
export function upsertDocumentSwatch(list: DocumentSwatch[], name: string, color: string): DocumentSwatch[] {
  const trimmedName = name.trim()
  const trimmedColor = color.trim()
  const existingIndex = list.findIndex((item) => item.name === trimmedName)
  if (existingIndex < 0) return [...list, { name: trimmedName, color: trimmedColor }]
  const next = [...list]
  next[existingIndex] = { name: trimmedName, color: trimmedColor }
  return next
}

/** 按名称移除色板条目，不存在时原样返回浅拷贝。 */
export function removeDocumentSwatchByName(list: DocumentSwatch[], name: string): DocumentSwatch[] {
  const trimmedName = name.trim()
  return list.filter((item) => item.name !== trimmedName)
}

/**
 * 归一化色板数组：丢弃无名/非法颜色/重复名条目（重复名以后写入者为准），
 * 用于工程文件读取时把损坏数据降到安全状态。
 */
export function normalizeDocumentSwatches(value: unknown): DocumentSwatch[] {
  if (!Array.isArray(value)) return []
  let result: DocumentSwatch[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    const color = typeof source.color === 'string' ? source.color.trim() : ''
    if (!name || !isSupportedColorString(color)) continue
    result = upsertDocumentSwatch(result, name, color)
  }
  return result
}

/**
 * 归一化单个预设样式对象：仅保留白名单键，数值键必须是有限数字，
 * 至少包含一个有效键时返回样式对象，否则返回 null（表示该预设无效）。
 */
export function normalizeDocumentStylePresetStyle(value: unknown): DocumentStylePresetStyle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const style: DocumentStylePresetStyle = {}
  for (const key of PRESET_STYLE_KEYS) {
    const raw = source[key]
    if (raw === undefined) continue
    if (key === 'strokeWidth' || key === 'cornerRadius' || key === 'opacity') {
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) continue
      style[key] = parsed
      continue
    }
    style[key as 'fill' | 'stroke' | 'shadow'] = raw
  }
  return Object.keys(style).length ? style : null
}

/**
 * 按名称把预设合并进列表（不改变传入数组）：同名覆盖样式，否则追加。
 */
export function upsertDocumentStylePreset(
  list: DocumentStylePreset[],
  name: string,
  style: DocumentStylePresetStyle
): DocumentStylePreset[] {
  const trimmedName = name.trim()
  const existingIndex = list.findIndex((item) => item.name === trimmedName)
  if (existingIndex < 0) return [...list, { name: trimmedName, style: { ...style } }]
  const next = [...list]
  next[existingIndex] = { name: trimmedName, style: { ...style } }
  return next
}

/** 按名称移除自定义预设，不存在时原样返回浅拷贝。 */
export function removeDocumentStylePresetByName(list: DocumentStylePreset[], name: string): DocumentStylePreset[] {
  const trimmedName = name.trim()
  return list.filter((item) => item.name !== trimmedName)
}

/** 归一化自定义预设数组：丢弃无 name / style 非法的条目，重复 name 以后写入者为准。 */
export function normalizeDocumentStylePresets(value: unknown): DocumentStylePreset[] {
  if (!Array.isArray(value)) return []
  let result: DocumentStylePreset[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const source = item as Record<string, unknown>
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    if (!name) continue
    const style = normalizeDocumentStylePresetStyle(source.style)
    if (!style) continue
    result = upsertDocumentStylePreset(result, name, style)
  }
  return result
}

/** 归一化文档样式元数据整体（工程 meta 字段或撤销快照 editorMeta），任何非法输入都降级为空结构。 */
export function normalizeDocumentStyleMeta(value: unknown): DocumentStyleMeta {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    swatches: normalizeDocumentSwatches(source.swatches),
    stylePresets: normalizeDocumentStylePresets(source.stylePresets)
  }
}

/** 判断元数据是否为空，空时不写入工程 JSON / 撤销快照，保持旧文件结构不变。 */
export function isEmptyDocumentStyleMeta(meta: DocumentStyleMeta | null | undefined): boolean {
  if (!meta) return true
  return meta.swatches.length === 0 && meta.stylePresets.length === 0
}

/**
 * 内置样式预设：代码常量，随 list_style_presets 输出并带 source='builtin' 标记，
 * 不可被 save_style_preset 覆盖，也不可被 remove_style_preset 删除。
 */
export const BUILTIN_STYLE_PRESETS: DocumentStylePresetSummary[] = [
  {
    name: 'flat-fill',
    source: 'builtin',
    style: { fill: '#000000', stroke: 'transparent', strokeWidth: 0 }
  },
  {
    name: 'stroke-only',
    source: 'builtin',
    style: { fill: 'transparent', stroke: '#333333', strokeWidth: 2 }
  },
  {
    name: 'soft-shadow',
    source: 'builtin',
    style: { shadow: { color: 'rgba(0, 0, 0, 0.25)', blur: 12, offsetX: 0, offsetY: 4 } }
  },
  {
    name: 'rounded-card',
    source: 'builtin',
    style: { fill: '#FFFFFF', cornerRadius: 24 }
  }
]

/**
 * 按名称查找预设：先查内置再查自定义列表。
 * 找不到返回 null，调用方据此向 AI 报"预设不存在"错误。
 */
export function findDocumentStylePreset(
  customPresets: DocumentStylePreset[],
  name: string
): DocumentStylePresetSummary | null {
  const trimmedName = name.trim()
  const builtin = BUILTIN_STYLE_PRESETS.find((item) => item.name === trimmedName)
  if (builtin) return builtin
  const custom = customPresets.find((item) => item.name === trimmedName)
  return custom ? { ...custom, source: 'custom' } : null
}

/** 合并内置与自定义预设为完整列表（内置在前，与 apply 时的查找优先级一致）。 */
export function listDocumentStylePresets(customPresets: DocumentStylePreset[]): DocumentStylePresetSummary[] {
  return [
    ...BUILTIN_STYLE_PRESETS.map((item) => ({ ...item, style: { ...item.style } })),
    ...customPresets.map((item) => ({ name: item.name, style: { ...item.style }, source: 'custom' as const }))
  ]
}
