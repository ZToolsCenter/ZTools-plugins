import { Pattern, util, type FabricObject } from 'fabric'
import type { AnyFabricObject } from './objectMetadata'

/**
 * 图案填充（fabric Pattern fill）的数据模型与构建/应用助手：
 * 属性面板、运行时与 MCP 共用同一份类型与归一化逻辑。
 *
 * 序列化实证结论（fabric 7.3.1）：
 * - Pattern.toObject() 会输出 source（source 为 HTMLImageElement 时取 element.src，
 *   即 dataURL 字符串）/repeat/patternTransform/offsetX/offsetY；
 * - 若直接把字符串传给 new Pattern({ source })，sourceToString() 会返回空串导致序列化丢图，
 *   因此构建时必须先用 util.loadImage 把 dataURL/http URL 加载为图片元素；
 * - patternTransform（缩放）随 toObject/fromObject 完整 round-trip，
 *   canvas.toObject 序列化的 Pattern fill 也能经 enliven 还原为 Pattern 实例。
 */

/** 图案平铺方式（与 CSS background-repeat 同名约定）。 */
export type PatternFillRepeat = 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'

/** 全部受支持的平铺方式，顺序即下拉展示顺序。 */
export const PATTERN_FILL_REPEATS: PatternFillRepeat[] = ['repeat', 'repeat-x', 'repeat-y', 'no-repeat']

/** 平铺方式中文名（属性面板下拉与错误提示共用）。 */
export const PATTERN_FILL_REPEAT_LABELS: Record<PatternFillRepeat, string> = {
  repeat: '重复',
  'repeat-x': '横向平铺',
  'repeat-y': '纵向平铺',
  'no-repeat': '不重复'
}

export const DEFAULT_PATTERN_FILL_REPEAT: PatternFillRepeat = 'repeat'
export const DEFAULT_PATTERN_FILL_SCALE = 1
export const MIN_PATTERN_FILL_SCALE = 0.05
export const MAX_PATTERN_FILL_SCALE = 20

/** 图案填充回显元数据：记住来源/名称/平铺/缩放，供面板与 MCP 摘要在不解析 fill 的情况下读取。 */
export type PatternFillMetadata = {
  fillPatternSrc?: string
  fillPatternName?: string
  fillPatternRepeat?: PatternFillRepeat
  fillPatternScale?: number
}

/** 校验平铺方式名，合法返回原名，非法返回 null。 */
export function normalizePatternFillRepeat(value: unknown): PatternFillRepeat | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return PATTERN_FILL_REPEATS.includes(trimmed as PatternFillRepeat)
    ? (trimmed as PatternFillRepeat)
    : null
}

/**
 * 校验并收敛图案缩放倍数：非有限数返回 null；越界值收敛到 [0.05, 20]。
 * 与位图滤镜参数一致采取"收敛不报错"策略，便于 MCP 传参略超出区间时仍可应用。
 */
export function normalizePatternFillScale(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(MAX_PATTERN_FILL_SCALE, Math.max(MIN_PATTERN_FILL_SCALE, parsed))
}

/** 读取对象上的图案填充元数据容器（不做归一化）。 */
export function getPatternFillMetadata(obj: FabricObject | null | undefined) {
  return obj ? (obj as AnyFabricObject & PatternFillMetadata) : null
}

/** 归一化对象的图案填充元数据：缺失字段补默认值，非法值收敛，保证面板回显稳定。 */
export function applyDefaultPatternFillMetadata(obj: FabricObject | null | undefined) {
  const target = getPatternFillMetadata(obj)
  if (!target) return
  target.fillPatternSrc = typeof target.fillPatternSrc === 'string' ? target.fillPatternSrc : ''
  target.fillPatternName = typeof target.fillPatternName === 'string' ? target.fillPatternName : ''
  target.fillPatternRepeat = normalizePatternFillRepeat(target.fillPatternRepeat) ?? DEFAULT_PATTERN_FILL_REPEAT
  target.fillPatternScale = normalizePatternFillScale(target.fillPatternScale) ?? DEFAULT_PATTERN_FILL_SCALE
}

/** 判断填充值是否为 fabric Pattern 实例。 */
export function isPatternFill(fill: unknown): fill is Pattern {
  return fill instanceof Pattern
}

/**
 * 读取对象当前的图案填充状态（供属性面板与 MCP 回显）：
 * 优先取 fill 实例上的实时参数，缺失时回退元数据；active 表示当前 fill 是 Pattern。
 */
export function readPatternFillState(obj: FabricObject | null | undefined): {
  active: boolean
  source: string
  name: string
  repeat: PatternFillRepeat
  scale: number
} {
  applyDefaultPatternFillMetadata(obj)
  const target = getPatternFillMetadata(obj)
  const fill = obj?.fill
  if (!target || !isPatternFill(fill)) {
    return {
      active: false,
      source: target?.fillPatternSrc ?? '',
      name: target?.fillPatternName ?? '',
      repeat: target?.fillPatternRepeat ?? DEFAULT_PATTERN_FILL_REPEAT,
      scale: target?.fillPatternScale ?? DEFAULT_PATTERN_FILL_SCALE
    }
  }
  const source = fill.isImageSource() ? String(fill.source.src ?? '') : target.fillPatternSrc ?? ''
  const transformScale = Array.isArray(fill.patternTransform) ? Number(fill.patternTransform[0]) : NaN
  return {
    active: true,
    source,
    name: target.fillPatternName ?? '',
    repeat: normalizePatternFillRepeat(fill.repeat) ?? target.fillPatternRepeat ?? DEFAULT_PATTERN_FILL_REPEAT,
    scale: normalizePatternFillScale(transformScale) ?? target.fillPatternScale ?? DEFAULT_PATTERN_FILL_SCALE
  }
}

/** 由缩放倍数构建 patternTransform 矩阵；倍数为 1 时返回 undefined（省略序列化字段）。 */
export function buildPatternTransform(scale: number): [number, number, number, number, number, number] | undefined {
  const normalized = normalizePatternFillScale(scale) ?? DEFAULT_PATTERN_FILL_SCALE
  if (normalized === DEFAULT_PATTERN_FILL_SCALE) return undefined
  return [normalized, 0, 0, normalized, 0, 0]
}

/** 图案源图片元素缓存：dataURL 解码成本高，按源字符串缓存已加载元素，重复应用（调平铺/缩放）零开销。 */
const patternSourceCache = new Map<string, HTMLImageElement>()
const PATTERN_SOURCE_CACHE_LIMIT = 32

/**
 * 加载图案源（dataURL 或 http(s) URL）为图片元素：
 * 命中缓存直接复用；加载失败抛错由调用方转为可读提示。
 * 必须以"图片元素"作为 Pattern.source（见文件头实证结论），字符串 source 会序列化丢图。
 */
export async function loadPatternSourceElement(source: string): Promise<HTMLImageElement> {
  const cached = patternSourceCache.get(source)
  if (cached) return cached
  const img = await util.loadImage(source)
  if (patternSourceCache.size >= PATTERN_SOURCE_CACHE_LIMIT) {
    const oldest = patternSourceCache.keys().next().value
    if (oldest !== undefined) patternSourceCache.delete(oldest)
  }
  patternSourceCache.set(source, img)
  return img
}

/**
 * 由源字符串 + 平铺/缩放构建 fabric Pattern 实例：
 * 异步因为需要先加载图片；构建失败（URL 非法/加载失败）抛错由调用方兜底。
 */
export async function createPatternFromSource(
  source: string,
  repeat: PatternFillRepeat,
  scale: number
): Promise<Pattern> {
  const img = await loadPatternSourceElement(source)
  return new Pattern({
    source: img,
    repeat,
    patternTransform: buildPatternTransform(scale)
  })
}

/** 校验图案源字符串：仅接受 dataURL 图片与 http(s) URL，其余抛中文错误。 */
export function validatePatternSourceString(source: string) {
  const trimmed = source.trim()
  const isDataUrl = /^data:image\//i.test(trimmed)
  const isHttpUrl = /^https?:\/\//i.test(trimmed)
  if (!isDataUrl && !isHttpUrl) {
    throw new Error('source 必须是 dataURL 图片（data:image/...）或 http(s) 图片 URL')
  }
  return trimmed
}
