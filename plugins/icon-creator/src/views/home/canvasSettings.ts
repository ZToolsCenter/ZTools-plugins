import {
  DEFAULT_KEYLINE_MARGIN,
  DEFAULT_KEYLINE_OPACITY,
  DEFAULT_PIXEL_GRID_SIZE,
  DEFAULT_PIXEL_PAINT_BRUSH_SIZE,
  MAX_KEYLINE_MARGIN,
  MAX_KEYLINE_OPACITY,
  MAX_PIXEL_GRID_SIZE,
  MAX_PIXEL_PAINT_BRUSH_SIZE,
  MIN_KEYLINE_MARGIN,
  MIN_KEYLINE_OPACITY,
  MIN_PIXEL_GRID_SIZE,
  MIN_PIXEL_PAINT_BRUSH_SIZE
} from './constants'
import type { KeylineTemplate } from './types'

// 将用户配置的网格间距限制在可用范围内，避免过小网格导致渲染密集或过大网格失去参考意义。
export function normalizePixelGridSize(value: unknown) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_PIXEL_GRID_SIZE
  return Math.min(MAX_PIXEL_GRID_SIZE, Math.max(MIN_PIXEL_GRID_SIZE, parsed))
}

// 将网格上色画笔大小（N × N 格）限制在可用范围内，兼容旧工程缺省与手写非法值。
export function normalizePixelPaintBrushSize(value: unknown) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_PIXEL_PAINT_BRUSH_SIZE
  return Math.min(MAX_PIXEL_PAINT_BRUSH_SIZE, Math.max(MIN_PIXEL_PAINT_BRUSH_SIZE, parsed))
}

// 规范参考线模板值，避免旧工程或手写工程文件中的未知值让界面处于不可控状态。
export function normalizeKeylineTemplate(value: unknown): KeylineTemplate {
  return value === 'material' || value === 'ios' || value === 'favicon' || value === 'custom'
    ? value
    : 'none'
}

// 将自定义安全区边距限制在合理范围内，防止参考线因负值或过大值完全不可见。
export function normalizeKeylineMargin(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_KEYLINE_MARGIN
  return Math.min(MAX_KEYLINE_MARGIN, Math.max(MIN_KEYLINE_MARGIN, parsed))
}

// 统一限制参考线透明度范围，兼容旧工程缺省值并避免非法值导致 overlay 意外全隐或超出预期。
export function normalizeKeylineOpacity(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_KEYLINE_OPACITY
  return Math.min(MAX_KEYLINE_OPACITY, Math.max(MIN_KEYLINE_OPACITY, parsed))
}

// 判断画布背景是否等价于透明，兼容旧工程中的空字符串、none 和 transparent 写法。
export function isTransparentCanvasBg(value: unknown) {
  if (value == null) return true
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '' || normalized === 'none' || normalized === 'transparent'
}

// 标准化画布背景字段，透明背景统一写成 transparent，其他颜色保留原始字符串。
export function normalizeCanvasBg(value: unknown) {
  return isTransparentCanvasBg(value) ? 'transparent' : String(value)
}
