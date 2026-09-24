/**
 * 文档级对齐参考线（用户从标尺拖出的辅助线，区别于 Keyline 安全区模板）。
 *
 * 数据归属说明：参考线挂在整个工程（project.guides）而非单个画板——
 * 标尺是随当前视图唯一的一份覆盖层，参考线作为全文档对齐辅助在画板间共享更符合直觉；
 * 且多画板场景下每个画板尺寸不同，共享列表中超出当前画布范围的参考线只是不显示，数据不丢。
 *
 * 持久化与撤销策略：随工程 JSON（guides 字段）与自动草稿 round-trip；
 * 同时以 editorGuides 字段进入撤销快照，参考线的增删改会与画布对象一样入撤销栈
 * （见 useHomeDocument.buildSnapshotPayload / restoreHistorySnapshot）。
 * 本模块只做纯数据归一化与几何辅助，不依赖 fabric / DOM，供工程解析、运行时与 MCP 复用。
 */

/** 参考线方向：horizontal 为水平线（由 Y 位置决定，从顶部标尺拖出），vertical 为垂直线。 */
export type GuideOrientation = 'horizontal' | 'vertical'

/** 单条参考线：position 为画布坐标系下的像素位置（水平线为 y，垂直线为 x）。 */
export type ProjectGuide = {
  id: string
  orientation: GuideOrientation
  position: number
}

/** 参考线数量上限：防止误操作或 AI 调用写入超大列表拖慢渲染。 */
export const MAX_DOCUMENT_GUIDES = 100

let guideIdSeed = 0

/** 生成文档内唯一的参考线 id（自增种子保证单次会话内不重复）。 */
export function createGuideId(): string {
  guideIdSeed += 1
  return `guide-${guideIdSeed}`
}

/** 判断参考线方向值是否合法。 */
export function isGuideOrientation(value: unknown): value is GuideOrientation {
  return value === 'horizontal' || value === 'vertical'
}

/**
 * 把参考线位置夹取到画布有效范围内：水平线夹到 [0, canvasHeight]，垂直线夹到 [0, canvasWidth]。
 * 交互拖拽与 MCP set_guides 统一使用夹取（而非报错），保证落点始终可见可再编辑。
 */
export function clampGuidePosition(
  orientation: GuideOrientation,
  position: number,
  canvasWidth: number,
  canvasHeight: number
): number {
  const max = orientation === 'horizontal' ? canvasHeight : canvasWidth
  if (!Number.isFinite(position)) return 0
  return Math.min(Math.max(position, 0), Math.max(0, max))
}

/**
 * 归一化参考线数组（工程文件读取 / MCP 写入前的兜底校验）：
 * 丢弃非法条目（方向不合法或 position 非有限数字）；缺 id / 重复 id 时补生成新 id；
 * 超出上限时保留先出现的条目。任何非法输入都降级为空数组，绝不抛错。
 */
export function normalizeDocumentGuides(value: unknown): ProjectGuide[] {
  if (!Array.isArray(value)) return []
  const seenIds = new Set<string>()
  const result: ProjectGuide[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    if (!isGuideOrientation(source.orientation)) continue
    const position = Number(source.position)
    if (!Number.isFinite(position)) continue
    const rawId = typeof source.id === 'string' && source.id.trim() ? source.id.trim() : ''
    const id = rawId && !seenIds.has(rawId) ? rawId : createGuideId()
    seenIds.add(id)
    result.push({ id, orientation: source.orientation, position })
    if (result.length >= MAX_DOCUMENT_GUIDES) break
  }
  return result
}

/**
 * 按方向与位置查找容差范围内的已有参考线（命中检测容差为画布坐标单位）：
 * 返回距离最近的一条，未命中返回 null。供按下时抓取已有参考线与落点去重使用。
 */
export function findGuideAt(
  guides: ProjectGuide[],
  orientation: GuideOrientation,
  position: number,
  tolerance: number
): ProjectGuide | null {
  let best: ProjectGuide | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const guide of guides) {
    if (guide.orientation !== orientation) continue
    const distance = Math.abs(guide.position - position)
    if (distance <= tolerance && distance < bestDistance) {
      best = guide
      bestDistance = distance
    }
  }
  return best
}

/**
 * 在不改变传入数组的前提下移动指定参考线，返回新数组；
 * id 不存在时原样返回浅拷贝（调用方无需先判存在性）。
 */
export function moveGuidePosition(list: ProjectGuide[], id: string, position: number): ProjectGuide[] {
  const index = list.findIndex((guide) => guide.id === id)
  if (index < 0) return [...list]
  const next = [...list]
  next[index] = { ...list[index], position }
  return next
}

/** 删除指定 id 的参考线，返回新数组；不存在时原样返回浅拷贝。 */
export function removeGuideById(list: ProjectGuide[], id: string): ProjectGuide[] {
  return list.some((guide) => guide.id === id) ? list.filter((guide) => guide.id !== id) : [...list]
}
