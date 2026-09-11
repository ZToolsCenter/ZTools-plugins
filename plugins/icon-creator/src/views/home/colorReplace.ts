/**
 * 全局颜色替换的纯逻辑模块：颜色归一化、文档颜色扫描与批量替换。
 *
 * 设计取舍：
 * - 不依赖 fabric：对象与渐变全部按结构（duck typing）识别——字符串颜色、
 *   带 colorStops 的渐变实例、带 getObjects() 的编组，保证模块可在 Node 环境单测，
 *   运行时把 fabric 对象直接传入即可工作。
 * - 归一化规则：#rgb/#rgba 按位扩展、rgb()/rgba()（含百分比与现代斜杠写法）折算为
 *   8 位 hex；大小写不敏感；'transparent' 作为独立键参与扫描与替换；
 *   其余取值（'none'、具名颜色、图案等）不参与。
 * - 扫描范围：编组递归取子对象；每个对象读 fill/stroke——字符串颜色直接计数，
 *   渐变实例逐个 colorStops 计数；编组自身的 fill/stroke 无视觉意义（fabric 默认
 *   rgb(0,0,0)），跳过不扫描。使用次数 = 颜色槽位出现次数（fill/stroke/色标各计 1）。
 * - 替换范围：fill/stroke 字符串、渐变 colorStops，以及 fillGradientStops 元数据
 *   （属性面板渐变按元数据重建，只改 live 渐变会在保存/撤销后回退）。
 */

/** 颜色扫描结果条目：key 为归一化键，display 为展示用 hex，count 为出现次数。 */
export type ScannedColorEntry = {
  key: string
  display: string
  count: number
}

/** 颜色替换结果：objectCount 为发生变化的对象数，slotCount 为被替换的颜色槽位数。 */
export type ColorReplaceResult = {
  objectCount: number
  slotCount: number
}

/** 扫描 / 替换的可选项：isExcluded 命中的对象（及其子树）不参与。 */
export type ColorWalkOptions = {
  isExcluded?: (obj: unknown) => boolean
}

/** 8 位 hex 颜色键：#rrggbb(α)，α 为 00-ff 两位。 */
type RgbaBytes = { r: number; g: number; b: number; a: number }

/** 'transparent' 关键字的归一化键，与其余 hex 键区分开。 */
export const TRANSPARENT_COLOR_KEY = 'transparent'

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/
const RGB_COLOR_PATTERN = /^rgba?\(([^)]*)\)$/

/** 把 0-1 alpha 折算为两位 hex 字节。 */
function alphaToHexByte(alpha: number): string {
  if (!Number.isFinite(alpha)) return 'ff'
  const clamped = Math.min(Math.max(alpha, 0), 1)
  return Math.round(clamped * 255).toString(16).padStart(2, '0')
}

/** 把 RGB 字节序列组装成 8 位 hex 键。 */
function toHexKey({ r, g, b, a }: RgbaBytes): string {
  const byte = (value: number) => Math.round(Math.min(Math.max(value, 0), 255)).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}${a >= 1 ? '' : alphaToHexByte(a)}`
}

/** 把 3/4 位短 hex 按位扩展成 6/8 位。 */
function expandShortHex(short: string): string {
  return short.split('').map((ch) => ch + ch).join('')
}

/**
 * 解析 rgb()/rgba() 表达式分量（兼容逗号、空格与 "/ 0.5" 现代写法），
 * 分量支持 0-255 数字或百分比；非法表达式返回 null。
 */
function parseRgbExpression(value: string): RgbaBytes | null {
  const match = value.trim().match(RGB_COLOR_PATTERN)
  if (!match) return null
  const parts = match[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return null
  const channels: number[] = []
  for (let index = 0; index < 3; index += 1) {
    const raw = parts[index]
    const isPercent = raw.endsWith('%')
    const parsed = Number(raw.slice(0, isPercent ? -1 : undefined))
    if (!Number.isFinite(parsed)) return null
    channels.push(isPercent ? (parsed / 100) * 255 : parsed)
  }
  let alpha = 1
  if (parts.length === 4) {
    const isPercent = parts[3].endsWith('%')
    alpha = Number(parts[3].slice(0, isPercent ? -1 : undefined))
    if (!Number.isFinite(alpha)) return null
    if (isPercent) alpha = alpha / 100
  }
  return { r: channels[0], g: channels[1], b: channels[2], a: alpha }
}

/**
 * 把任意颜色取值归一化为比较键：
 * - 'transparent' → 'transparent'
 * - hex（3/4/6/8 位，大小写不敏感）→ 6/8 位小写 hex
 * - rgb()/rgba() 表达式 → 6/8 位小写 hex（alpha=1 时省略 alpha 段）
 * - 其余（'none'、具名颜色、非字符串等）→ null，不参与扫描与替换
 */
export function normalizeColorKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed === 'transparent') return TRANSPARENT_COLOR_KEY
  const hexMatch = trimmed.match(HEX_COLOR_PATTERN)
  if (hexMatch) {
    const body = trimmed.slice(1)
    if (body.length === 3 || body.length === 4) {
      const expanded = expandShortHex(body)
      return `#${expanded.slice(0, 6)}${expanded.length === 8 ? expanded.slice(6) : ''}`
    }
    return `#${body.slice(0, 6)}${body.length === 8 ? body.slice(6) : ''}`
  }
  const rgb = parseRgbExpression(trimmed)
  if (rgb) return toHexKey(rgb)
  return null
}

/** 判断取值是否为“渐变样式”结构（带 colorStops 数组的对象，如 fabric Gradient 实例）。 */
export function isGradientLikeColor(value: unknown): value is { colorStops: Array<{ color?: unknown }> } {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray((value as { colorStops?: unknown }).colorStops)
}

/** 判断对象是否为编组类结构（带 getObjects() 方法，如 fabric Group / ActiveSelection）。 */
function isGroupLikeObject(value: unknown): value is { getObjects: () => unknown[] } {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getObjects?: unknown }).getObjects === 'function'
}

/** 读取单个颜色槽位的归一化键：字符串返回键，渐变返回 null（色标单独遍历）。 */
function readColorSlotKey(value: unknown): string | null {
  if (typeof value === 'string') return normalizeColorKey(value)
  return null
}

/**
 * 汇总一个对象（含编组子树）上出现的所有颜色槽位键：
 * fill/stroke 的字符串颜色与渐变 colorStops 的颜色各占一个槽位。
 * entries 为输出收集器，返回本次对象自身（不含子树）贡献的槽位数。
 */
function collectObjectColorKeys(obj: unknown, entries: string[], options?: ColorWalkOptions): number {
  if (options?.isExcluded?.(obj)) return 0
  let count = 0
  if (isGroupLikeObject(obj)) {
    // 编组自身 fill/stroke 无视觉意义（fabric 默认 rgb(0,0,0)），只递归子对象
    for (const child of obj.getObjects()) {
      count += collectObjectColorKeys(child, entries, options)
    }
    return count
  }
  const source = obj as { fill?: unknown; stroke?: unknown } | null
  if (!source) return 0
  for (const prop of ['fill', 'stroke'] as const) {
    const value = source[prop]
    if (isGradientLikeColor(value)) {
      for (const stop of value.colorStops) {
        const key = normalizeColorKey(stop?.color)
        if (key) {
          entries.push(key)
          count += 1
        }
      }
      continue
    }
    const key = readColorSlotKey(value)
    if (key) {
      entries.push(key)
      count += 1
    }
  }
  return count
}

/**
 * 扫描对象列表中出现的全部颜色，按使用次数降序（次数相同按键名升序）返回去重条目。
 * 编组会递归展开，isExcluded 命中的对象及其子树跳过（运行时用它排除布尔预览对象）。
 */
export function scanDocumentColors(objects: unknown[], options?: ColorWalkOptions): ScannedColorEntry[] {
  const counter = new Map<string, number>()
  const keys: string[] = []
  for (const obj of objects) {
    collectObjectColorKeys(obj, keys, options)
  }
  for (const key of keys) {
    counter.set(key, (counter.get(key) ?? 0) + 1)
  }
  return Array.from(counter.entries())
    .map(([key, count]) => ({ key, display: key, count }))
    .sort((a, b) => (b.count - a.count) || (a.key < b.key ? -1 : 1))
}

/**
 * 把对象单个颜色属性槽位替换为目标色，返回是否发生替换：
 * 字符串颜色按键比较；渐变实例逐个 colorStops 比较，命中时生成新的 colorStops 数组写回。
 */
function replaceColorInSlot(
  target: { fill?: unknown; stroke?: unknown; fillGradientStops?: Array<{ color?: unknown }> },
  prop: 'fill' | 'stroke',
  fromKey: string,
  replacement: string
): number {
  const value = target[prop]
  if (isGradientLikeColor(value)) {
    let replaced = 0
    // 就地替换 colorStops（保持渐变实例身份不变——fabric 对象的 fill 必须仍是
    // 原渐变实例，换成普通对象会导致渲染与序列化行为改变），仅重写命中色标。
    const nextStops = value.colorStops.map((stop) => {
      const key = normalizeColorKey(stop?.color)
      if (key !== fromKey) return stop
      replaced += 1
      return { ...stop, color: replacement }
    })
    if (replaced > 0) {
      value.colorStops = nextStops
    }
    return replaced
  }
  if (readColorSlotKey(value) === fromKey) {
    target[prop] = replacement
    return 1
  }
  return 0
}

/**
 * 把对象上与源色相等的填充渐变色标元数据替换为目标色：
 * 属性面板与工程加载会按 fillGradientStops 重建渐变，不同步会导致替换结果回退。
 */
function replaceColorInGradientMetadata(
  target: { fillGradientStops?: Array<{ color?: unknown }> },
  fromKey: string,
  replacement: string
): number {
  const stops = target.fillGradientStops
  if (!Array.isArray(stops)) return 0
  let replaced = 0
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index]
    const key = normalizeColorKey(stop?.color)
    if (key !== fromKey) continue
    stops[index] = { ...stop, color: replacement }
    replaced += 1
  }
  return replaced
}

/**
 * 把对象（含编组子树）中等于源色的 fill/stroke、渐变色标与渐变元数据替换为目标色。
 * @param from 源色（任意可归一化写法，内部归一化后比较）
 * @param to 目标色（归一化后的 hex 写入对象，保证工程序列化一致）
 * @returns 替换统计；源色与目标色相同或源色非法时返回全 0
 */
export function replaceDocumentColor(
  objects: unknown[],
  from: string,
  to: string,
  options?: ColorWalkOptions
): ColorReplaceResult {
  const fromKey = normalizeColorKey(from)
  const toKey = normalizeColorKey(to)
  if (!fromKey || !toKey || fromKey === toKey) return { objectCount: 0, slotCount: 0 }
  const replacement = toKey
  let objectCount = 0
  let slotCount = 0
  /**
   * 递归替换单个对象；返回该对象（含子树）是否发生了变化。
   */
  const walk = (obj: unknown): boolean => {
    if (options?.isExcluded?.(obj)) return false
    if (isGroupLikeObject(obj)) {
      let childChanged = false
      for (const child of obj.getObjects()) {
        if (walk(child)) childChanged = true
      }
      return childChanged
    }
    const target = obj as
      | { fill?: unknown; stroke?: unknown; fillGradientStops?: Array<{ color?: unknown }> }
      | null
    if (!target) return false
    let replaced = 0
    for (const prop of ['fill', 'stroke'] as const) {
      replaced += replaceColorInSlot(target, prop, fromKey, replacement)
    }
    replaced += replaceColorInGradientMetadata(target, fromKey, replacement)
    if (replaced > 0) slotCount += replaced
    return replaced > 0
  }
  for (const obj of objects) {
    if (walk(obj)) objectCount += 1
  }
  return { objectCount, slotCount }
}
