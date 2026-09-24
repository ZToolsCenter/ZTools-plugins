import { Gradient, Shadow } from 'fabric'
import type { DocumentSwatch } from '../documentStyleMeta'
import { isSupportedColorString } from '../documentStyleMeta'
import type { McpGradientSummary, McpShadowSummary } from './mcpGatewayTypes'

/**
 * MCP 属性值解析器：把 AI 传入的 fill/stroke/shadow 值归一化为 fabric 可直接应用的对象。
 *
 * 支持的扩展值语法（仅在值匹配时生效，普通字符串颜色行为完全不变）：
 * - "swatch:名字" 引用文档级命名色板；
 * - 渐变 JSON 对象 { type, stops, x1..y2 / r1 r2 }，构建 fabric.Gradient；
 * - shadow 的 { color, blur, offsetX, offsetY } 对象或 null（清除）。
 */

/** swatch 引用前缀，fill/stroke 值形如 "swatch:主色" 时解析为色板颜色。 */
const SWATCH_REF_PREFIX = 'swatch:'

/** 渐变停止点归一化结果。 */
type ParsedGradientStop = {
  offset: number
  color: string
}

/**
 * 解析 "swatch:名字" 引用。
 * 不是引用时返回 null（调用方继续按原逻辑处理）；引用存在但色板中无此名字时抛中文错误。
 */
export function resolveSwatchRefValue(value: unknown, swatches: DocumentSwatch[]): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith(SWATCH_REF_PREFIX)) return null
  const name = trimmed.slice(SWATCH_REF_PREFIX.length).trim()
  const hit = swatches.find((item) => item.name === name)
  if (!hit) {
    throw new Error(`色板中不存在名为 "${name}" 的颜色，可先执行 list_swatches 查询或用 add_swatch 添加`)
  }
  return hit.color
}

/** 校验必填的有限数字，缺失或非法时抛出带字段名的中文错误。 */
function requireCoordNumber(source: Record<string, unknown>, key: string, label: string): number {
  const parsed = Number(source[key])
  if (!Number.isFinite(parsed)) {
    throw new Error(`渐变缺少有效的 ${label}（${key} 必须是数字）`)
  }
  return parsed
}

/** 校验可选的有限数字，非法时回退默认值。 */
function optionalCoordNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  const parsed = Number(source[key])
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 把 stops 数组归一化为 fabric colorStops；颜色支持 swatch 引用，offset 缺省按序均匀分布。 */
function parseGradientStops(value: unknown, swatches: DocumentSwatch[]): ParsedGradientStop[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('渐变缺少 stops 数组（至少 1 项 { offset: 0-1, color }）')
  }
  const parsed = value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`渐变 stops[${index}] 必须是 { offset, color } 对象`)
    }
    const source = item as Record<string, unknown>
    const rawColor = source.color ?? source.colour
    let color: string | null = null
    const resolvedRef = resolveSwatchRefValue(rawColor, swatches)
    if (resolvedRef !== null) {
      color = resolvedRef
    } else if (typeof rawColor === 'string' && rawColor.trim()) {
      color = rawColor.trim()
    }
    if (!color) {
      throw new Error(`渐变 stops[${index}].color 缺失或非法（支持 hex/rgba 或 "swatch:名字"）`)
    }
    const offset = Number(source.offset)
    return {
      color,
      offset: Number.isFinite(offset) ? Math.min(1, Math.max(0, offset)) : -1
    }
  })
  // offset 缺省（-1 标记）按位置均匀分布：首尾为 0/1，其余均分。
  if (parsed.length === 1) {
    return [{ color: parsed[0].color, offset: 0 }, { color: parsed[0].color, offset: 1 }]
  }
  const step = 1 / (parsed.length - 1)
  return parsed.map((stop, index) => ({
    color: stop.color,
    offset: stop.offset >= 0 ? stop.offset : Math.min(1, step * index)
  }))
}

/**
 * 把渐变 JSON 归一化为 fabric Gradient（percentage 坐标系，1 表示对象宽度/高度的 100%）。
 * linear 需要 x1/y1/x2/y2；radial 需要 x2/y2/r2（x1/y1 缺省等于 x2/y2，r1 缺省 0）。
 * 坐标也兼容写在嵌套 coords 对象里；type 缺省按 linear 处理。
 */
export function parseGradientSpec(value: Record<string, unknown>, swatches: DocumentSwatch[]): Gradient<'linear' | 'radial'> {
  const type = value.type === 'radial' ? 'radial' : 'linear'
  const nested = value.coords && typeof value.coords === 'object' && !Array.isArray(value.coords)
    ? value.coords as Record<string, unknown>
    : {}
  // 扁平键优先，兼容嵌套 coords 写法。
  const coords: Record<string, unknown> = { ...nested }
  for (const key of ['x1', 'y1', 'x2', 'y2', 'r1', 'r2']) {
    if (value[key] !== undefined) coords[key] = value[key]
  }
  const stops = parseGradientStops(value.stops, swatches)

  let gradientCoords: Record<string, number>
  if (type === 'linear') {
    gradientCoords = {
      x1: requireCoordNumber(coords, 'x1', '线性渐变起点'),
      y1: requireCoordNumber(coords, 'y1', '线性渐变起点'),
      x2: requireCoordNumber(coords, 'x2', '线性渐变终点'),
      y2: requireCoordNumber(coords, 'y2', '线性渐变终点')
    }
  } else {
    const x2 = requireCoordNumber(coords, 'x2', '径向渐变外圆圆心')
    const y2 = requireCoordNumber(coords, 'y2', '径向渐变外圆圆心')
    gradientCoords = {
      x1: optionalCoordNumber(coords, 'x1', x2),
      y1: optionalCoordNumber(coords, 'y1', y2),
      r1: optionalCoordNumber(coords, 'r1', 0),
      x2,
      y2,
      r2: requireCoordNumber(coords, 'r2', '径向渐变外圆半径')
    }
  }

  return new Gradient({
    type,
    gradientUnits: 'percentage',
    colorStops: stops,
    coords: gradientCoords
  } as unknown as ConstructorParameters<typeof Gradient>[0])
}

/**
 * 把 shadow 值归一化为 fabric Shadow。
 * 接受 { color, blur, offsetX, offsetY }（color 支持 swatch 引用）；
 * 传 null 或字符串 'none' 时返回 null 表示清除阴影；结构非法时抛中文错误。
 */
export function parseShadowSpec(value: unknown, swatches: DocumentSwatch[]): Shadow | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    if (value.trim().toLowerCase() === 'none') return null
    throw new Error('shadow 仅支持对象 { color, blur, offsetX, offsetY }、null（清除）或字符串 "none"')
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('shadow 仅支持对象 { color, blur, offsetX, offsetY }、null（清除）或字符串 "none"')
  }
  const source = value as Record<string, unknown>
  let color = 'rgba(0, 0, 0, 0.25)'
  if (source.color !== undefined && source.color !== null) {
    const resolvedRef = resolveSwatchRefValue(source.color, swatches)
    if (resolvedRef !== null) {
      color = resolvedRef
    } else if (isSupportedColorString(source.color)) {
      color = source.color.trim()
    } else {
      throw new Error('shadow.color 非法（支持 hex/rgba 或 "swatch:名字"）')
    }
  }
  const blur = Math.max(0, optionalCoordNumber(source, 'blur', 0))
  const offsetX = optionalCoordNumber(source, 'offsetX', 0)
  const offsetY = optionalCoordNumber(source, 'offsetY', 0)
  return new Shadow({ color, blur, offsetX, offsetY })
}

/**
 * 属性值归一化入口：按属性名把扩展值语法解析为 fabric 对象。
 * fill/stroke 支持对象渐变 JSON（新建对象）；fill/stroke/shadow 支持 swatch 引用字符串；
 * shadow 另支持 { color, blur, offsetX, offsetY } 与 null；其余属性值原样返回。
 */
export function normalizeStylePropValue(prop: string, value: unknown, swatches: DocumentSwatch[]): unknown {
  if (prop === 'fill' || prop === 'stroke') {
    const resolvedRef = resolveSwatchRefValue(value, swatches)
    if (resolvedRef !== null) return resolvedRef
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return parseGradientSpec(value as Record<string, unknown>, swatches)
    }
    return value
  }
  if (prop === 'shadow') {
    const resolvedRef = resolveSwatchRefValue(value, swatches)
    if (resolvedRef !== null) return resolvedRef
    return parseShadowSpec(value, swatches)
  }
  return value
}

/**
 * 把渐变实例序列化为可读 JSON（MCP 摘要用）：type/gradientUnits/coords/stops。
 * 非渐变值返回 null。
 */
export function serializeGradientSummary(value: unknown): McpGradientSummary | null {
  if (!(value instanceof Gradient)) return null
  const coords = (value.coords ?? {}) as Record<string, unknown>
  const normalizedCoords: Record<string, number> = {}
  for (const [key, raw] of Object.entries(coords)) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) normalizedCoords[key] = parsed
  }
  return {
    type: value.type === 'radial' ? 'radial' : 'linear',
    gradientUnits: value.gradientUnits === 'percentage' ? 'percentage' : 'pixels',
    coords: normalizedCoords,
    stops: (value.colorStops ?? []).map((stop) => ({
      offset: Number(stop.offset) || 0,
      color: String(stop.color)
    }))
  }
}

/**
 * 摘要中的 fill/stroke 序列化：字符串原样返回，渐变实例输出可读 JSON，其余返回 null。
 */
export function serializeStyleFillSummary(value: unknown): string | McpGradientSummary | null {
  if (typeof value === 'string') return value
  return serializeGradientSummary(value)
}

/** 把 shadow 值序列化为可读 JSON 摘要，无阴影时返回 null。 */
export function serializeShadowSummary(value: unknown): McpShadowSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const shadow = value as Shadow
  return {
    color: String(shadow.color ?? ''),
    blur: Number(shadow.blur ?? 0),
    offsetX: Number(shadow.offsetX ?? 0),
    offsetY: Number(shadow.offsetY ?? 0)
  }
}
