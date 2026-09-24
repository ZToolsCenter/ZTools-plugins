import type { FabricObject, Group } from 'fabric'
import type { KeylineSafeArea, IconCheckIssue, ParsedCanvasColor } from './types'
import { isTransparentCanvasBg } from './canvasSettings'

type IconCheckContext = {
  canvasBg: string
  canvasWidth: number
  keylineTemplate: string
  keylineSafeArea: KeylineSafeArea
  objects: FabricObject[]
  isBooleanPreviewObject: (obj: FabricObject | null | undefined) => boolean
  isStrokeEnabled: (stroke: unknown, strokeWidth: unknown) => boolean
  getStyleTargets: (obj: FabricObject) => FabricObject[]
  getObjectDisplayName: (obj: FabricObject) => string
}

// 检查对象包围盒是否超出当前安全区，只有启用 Keyline / 安全区模板时才提示。
export function getSafeAreaOverflowIssue(context: IconCheckContext, obj: FabricObject, index: number): IconCheckIssue | null {
  if (context.keylineTemplate === 'none') return null
  const bounds = obj.getBoundingRect()
  const safe = context.keylineSafeArea
  const overflows = bounds.left < safe.x
    || bounds.top < safe.y
    || bounds.left + bounds.width > safe.x + safe.width
    || bounds.top + bounds.height > safe.y + safe.height
  if (!overflows) return null
  const targetName = context.getObjectDisplayName(obj)
  return {
    id: `safe-area-${index}`,
    severity: 'warning',
    title: '对象超出安全区',
    detail: '当前对象边界超出参考线安全区，可能在平台图标裁切或小尺寸显示时被截断。',
    target: obj,
    targetName
  }
}

// 检查细描边在 16px 输出下的近似像素宽度，提前暴露小尺寸图标容易发虚的问题。
export function getThinStrokeIssue(context: IconCheckContext, obj: FabricObject, index: number): IconCheckIssue | null {
  const targets = context.getStyleTargets(obj)
  const hasThinStroke = targets.some((target) => {
    if (!context.isStrokeEnabled(target.stroke, target.strokeWidth)) return false
    const scaledStroke = (target.strokeWidth || 0) * Math.max(Math.abs(target.scaleX || 1), Math.abs(target.scaleY || 1))
    return scaledStroke > 0 && scaledStroke * (16 / context.canvasWidth) < 1
  })
  if (!hasThinStroke) return null
  const targetName = context.getObjectDisplayName(obj)
  return {
    id: `thin-stroke-${index}`,
    severity: 'warning',
    title: '小尺寸描边过细',
    detail: '该对象描边在 16px 预览中可能不足 1 像素，建议加粗或转为填充形状。',
    target: obj,
    targetName
  }
}

// 检查对象边界是否落在非整数坐标上，辅助发现像素对齐问题。
export function getFractionalBoundsIssue(context: IconCheckContext, obj: FabricObject, index: number): IconCheckIssue | null {
  const bounds = obj.getBoundingRect()
  const values = [bounds.left, bounds.top, bounds.width, bounds.height]
  if (values.every((value) => Math.abs(value - Math.round(value)) <= 0.01)) return null
  const targetName = context.getObjectDisplayName(obj)
  return {
    id: `fractional-bounds-${index}`,
    severity: 'info',
    title: '边界存在非整数坐标',
    detail: '对象位置或尺寸未落在整数像素上，小尺寸导出时可能出现轻微模糊。',
    target: obj,
    targetName
  }
}

// 解析常见画布背景色格式，供规范检查判断深浅背景风险；无法识别时返回 null 避免误报。
export function parseCanvasColor(value: unknown): ParsedCanvasColor | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'none' || normalized === 'transparent') return null

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hexMatch) {
    const raw = hexMatch[1]
    const expanded = raw.length === 3 || raw.length === 4
      ? raw.split('').map((char) => char + char).join('')
      : raw
    const r = Number.parseInt(expanded.slice(0, 2), 16)
    const g = Number.parseInt(expanded.slice(2, 4), 16)
    const b = Number.parseInt(expanded.slice(4, 6), 16)
    const a = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
    return [r, g, b, a].every(Number.isFinite) ? { r, g, b, a } : null
  }

  const rgbaMatch = normalized.match(/^rgba?\(([^)]+)\)$/)
  if (!rgbaMatch) return null
  const parts = rgbaMatch[1].split(',').map((part) => part.trim())
  if (parts.length < 3) return null
  const channels = parts.slice(0, 3).map((part) => Number(part.replace('%', '')))
  if (channels.some((channel) => !Number.isFinite(channel))) return null
  const alpha = parts[3] == null ? 1 : Number(parts[3])
  return {
    r: Math.min(255, Math.max(0, channels[0])),
    g: Math.min(255, Math.max(0, channels[1])),
    b: Math.min(255, Math.max(0, channels[2])),
    a: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1
  }
}

// 计算背景色感知亮度，帮助检查面板提示纯白、纯黑或高饱和背景对图标交付的影响。
export function getCanvasColorLuminance(color: ParsedCanvasColor) {
  const linear = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

// 检查画布背景是否需要在导出时特别确认：透明背景、极深/极浅背景和无法解析的自定义色都给出轻量提示。
export function getCanvasBackgroundIssue(canvasBg: string): IconCheckIssue | null {
  if (isTransparentCanvasBg(canvasBg)) {
    return {
      id: 'transparent-background',
      severity: 'info',
      title: '当前使用透明背景',
      detail: '请确认目标平台或导出预设允许透明背景。'
    }
  }

  const parsed = parseCanvasColor(canvasBg)
  if (!parsed) {
    return {
      id: 'custom-background-color',
      severity: 'info',
      title: '背景色需要人工确认',
      detail: '当前背景色格式无法自动判断深浅，请确认导出时是否需要保留背景层。'
    }
  }

  if (parsed.a < 1) {
    return {
      id: 'translucent-background-color',
      severity: 'info',
      title: '背景色带透明度',
      detail: '半透明背景在不同平台合成后可能改变图标观感，导出前建议确认目标底色。'
    }
  }

  const luminance = getCanvasColorLuminance(parsed)
  if (luminance > 0.92) {
    return {
      id: 'light-background-color',
      severity: 'info',
      title: '浅色背景可能影响白色图形',
      detail: '当前背景接近白色，若图标包含浅色元素，小尺寸或透明导出时可能不易辨认。'
    }
  }
  if (luminance < 0.08) {
    return {
      id: 'dark-background-color',
      severity: 'info',
      title: '深色背景可能影响深色图形',
      detail: '当前背景接近黑色，若图标包含深色元素，小尺寸或透明导出时可能不易辨认。'
    }
  }
  return null
}

// 汇总画布级和对象级规范检查结果，结果仅用于右侧检查面板，不修改画布内容。
export function buildIconCheckIssues(context: IconCheckContext): IconCheckIssue[] {
  const issues: IconCheckIssue[] = []
  const backgroundIssue = getCanvasBackgroundIssue(context.canvasBg)
  if (backgroundIssue) issues.push(backgroundIssue)
  const colorSet = new Set<string>()
  const objects = context.objects.filter((obj) => !context.isBooleanPreviewObject(obj))
  objects.forEach((obj, index) => {
    const safeIssue = getSafeAreaOverflowIssue(context, obj, index)
    if (safeIssue) issues.push(safeIssue)
    const strokeIssue = getThinStrokeIssue(context, obj, index)
    if (strokeIssue) issues.push(strokeIssue)
    const fractionalIssue = getFractionalBoundsIssue(context, obj, index)
    if (fractionalIssue) issues.push(fractionalIssue)
    context.getStyleTargets(obj).forEach((target) => {
      ;[target.fill, target.stroke].forEach((value) => {
        if (typeof value !== 'string') return
        const normalized = value.trim().toLowerCase()
        if (!normalized || normalized === 'none' || normalized === 'transparent') return
        colorSet.add(normalized)
      })
    })
  })
  if (colorSet.size > 6) {
    issues.push({
      id: 'many-colors',
      severity: 'info',
      title: '颜色数量较多',
      detail: `当前检测到 ${colorSet.size} 种颜色，图标风格统一性可能受影响。`
    })
  }
  return issues
}
