/**
 * 油漆桶网格上色模式的纯几何模块（与 paintRegion.ts 一致，不依赖 fabric，可在 Node 环境单测）。
 *
 * 坐标系约定：网格线自画布 (0,0) 起以 gridSize 等距分布（与 pixel-grid-overlay 的视觉网格一致），
 * 所有矩形均为网格对齐的轴对齐矩形（col/row 为非负整数单元格索引，scene 坐标为单元格边界）。
 *
 * 上色模型的代表性约束（页面层负责维护）：
 * - 同色矩形之间互不重叠：写入区域前先从既有矩形中挖去该区域（subtractGridRect），再写入新矩形；
 * - 合并只在"并集恰好仍是一个矩形"时进行（mergeGridPaintRect 的面积守恒判定），
 *   避免把 L 形等带洞形状用外接矩形填洞、多涂用户未点到的单元格。
 */

/** 网格单元格索引（col/row 均为自画布左上角起的非负整数序号）。 */
export type GridCell = { col: number; row: number }

/** 场景坐标下的轴对齐矩形（网格上色矩形 / 画笔覆盖区域）。 */
export type GridRect = { x: number; y: number; width: number; height: number }

/** 数值容差：网格间距为正整数、坐标为整数运算，仅用于浮点防御。 */
const GRID_EPSILON = 1e-6

/**
 * 求场景点所在的网格单元格锚点；点击在画布外（含负坐标 / 恰好压在下右边界上）返回 null。
 * 网格自画布 (0,0) 起，与画布设置里网格叠加层的视觉线网完全对齐。
 */
export function getGridPaintAnchorCell(
  point: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number,
  gridSize: number
): GridCell | null {
  const step = Math.max(1, gridSize)
  if (!(point.x >= 0) || !(point.y >= 0)) return null
  if (point.x >= canvasWidth - GRID_EPSILON || point.y >= canvasHeight - GRID_EPSILON) return null
  return {
    col: Math.floor(point.x / step),
    row: Math.floor(point.y / step)
  }
}

/**
 * 计算以锚点单元格为左上角的画笔覆盖区域（brushSize × brushSize 个单元格），
 * 并裁剪到画布范围内；画笔大小至少为 1 个单元格。
 */
export function getBrushPaintRegion(
  anchor: GridCell,
  brushSize: number,
  canvasWidth: number,
  canvasHeight: number,
  gridSize: number
): GridRect | null {
  const step = Math.max(1, gridSize)
  const cells = Math.max(1, Math.floor(brushSize))
  const x = anchor.col * step
  const y = anchor.row * step
  const width = Math.min(x + cells * step, canvasWidth) - x
  const height = Math.min(y + cells * step, canvasHeight) - y
  if (width <= GRID_EPSILON || height <= GRID_EPSILON) return null
  return { x, y, width, height }
}

/** 矩形面积（负宽高按 0 处理，防御退化输入）。 */
export function gridRectArea(rect: GridRect) {
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

/** 两矩形的交集面积（不相交时为 0）。 */
export function gridRectIntersectionArea(a: GridRect, b: GridRect) {
  const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (overlapWidth <= GRID_EPSILON || overlapHeight <= GRID_EPSILON) return 0
  return overlapWidth * overlapHeight
}

/**
 * 从 target 中挖去 hole 覆盖的部分，返回剩余矩形（0-4 个）：
 * 上下两条保留 target 全宽，左右两条只保留 hole 垂直跨度内的部分，保证互不重叠且拼合后等于挖除前的 target。
 */
export function subtractGridRect(target: GridRect, hole: GridRect): GridRect[] {
  const overlapWidth = Math.min(target.x + target.width, hole.x + hole.width) - Math.max(target.x, hole.x)
  const overlapHeight = Math.min(target.y + target.height, hole.y + hole.height) - Math.max(target.y, hole.y)
  if (overlapWidth <= GRID_EPSILON || overlapHeight <= GRID_EPSILON) return [target]

  const pieces: GridRect[] = []
  const holeTop = Math.max(target.y, hole.y)
  const holeBottom = Math.min(target.y + target.height, hole.y + hole.height)
  const holeLeft = Math.max(target.x, hole.x)
  const holeRight = Math.min(target.x + target.width, hole.x + hole.width)

  if (holeTop - target.y > GRID_EPSILON) {
    pieces.push({ x: target.x, y: target.y, width: target.width, height: holeTop - target.y })
  }
  if (target.y + target.height - holeBottom > GRID_EPSILON) {
    pieces.push({ x: target.x, y: holeBottom, width: target.width, height: target.y + target.height - holeBottom })
  }
  if (holeLeft - target.x > GRID_EPSILON) {
    pieces.push({ x: target.x, y: holeTop, width: holeLeft - target.x, height: holeBottom - holeTop })
  }
  if (target.x + target.width - holeRight > GRID_EPSILON) {
    pieces.push({ x: holeRight, y: holeTop, width: target.x + target.width - holeRight, height: holeBottom - holeTop })
  }
  return pieces
}

/**
 * 判断 region 是否被 rects 完全覆盖。前提：rects 之间互不重叠（上色模型的不变量），
 * 于是覆盖判定退化为相交面积之和等于 region 面积。
 */
export function isGridRegionCovered(region: GridRect, rects: GridRect[]) {
  let covered = 0
  for (const rect of rects) covered += gridRectIntersectionArea(region, rect)
  return covered >= gridRectArea(region) - GRID_EPSILON
}

/**
 * 贪心合并：把 rect 与 others 中可"无缝拼成矩形"的同色矩形两两合并。
 * 仅当两矩形并集面积等于外接矩形面积（即并集恰好是矩形、无空洞）时才合并，
 * 返回合并后的矩形与被吞并项在 others 中的下标（调用方据此删除对应对象）。
 */
export function mergeGridPaintRect(
  rect: GridRect,
  others: GridRect[]
): { merged: GridRect; consumed: number[] } {
  let merged: GridRect = { ...rect }
  const consumed: number[] = []
  let mergedAgain = true
  while (mergedAgain) {
    mergedAgain = false
    for (let index = 0; index < others.length; index += 1) {
      if (consumed.includes(index)) continue
      const other = others[index]
      const union = {
        x: Math.min(merged.x, other.x),
        y: Math.min(merged.y, other.y),
        width: Math.max(merged.x + merged.width, other.x + other.width) - Math.min(merged.x, other.x),
        height: Math.max(merged.y + merged.height, other.y + other.height) - Math.min(merged.y, other.y)
      }
      const combined = gridRectArea(merged) + gridRectArea(other) - gridRectIntersectionArea(merged, other)
      if (combined >= gridRectArea(union) - GRID_EPSILON) {
        merged = union
        consumed.push(index)
        mergedAgain = true
      }
    }
  }
  return { merged, consumed }
}

/** 网格上色的核心增量写入算法（纯函数，页面层只负责把 remove/add 计划同步到画布对象）：
 * 1. region 已被同色块完整覆盖 → 无动作（changed=false），重复点击/拖动不产生冗余对象；
 * 2. 否则从每个相交色块中挖去 region（面积守恒，保持"色块互不重叠"不变量），
 *    写入 region 的新色块，再与相邻同色块（含本次挖切产生的同色残块）贪心合并；
 *    合并只在"并集恰好仍是一个矩形"时发生，绝不把 L 形等带洞形状外接填洞，
 *    因此连续上色时每个被扫过的单元格都是满色整格，不会出现半格拖影。
 */
export function planGridPaintWrite<T extends { rect: GridRect; color: string }>(
  shapes: T[],
  region: GridRect,
  color: string
): { remove: T[]; add: Array<{ rect: GridRect; color: string }>; changed: boolean } {
  const isSameColor = (value: string) => value.trim().toLowerCase() === color.trim().toLowerCase()
  const intersecting = shapes.filter((shape) => gridRectIntersectionArea(shape.rect, region) > 0)
  if (
    intersecting.length > 0
    && intersecting.every((shape) => isSameColor(shape.color))
    && isGridRegionCovered(region, intersecting.map((shape) => shape.rect))
  ) {
    return { remove: [], add: [], changed: false }
  }

  const remove: T[] = [...intersecting]
  const add: Array<{ rect: GridRect; color: string }> = []
  for (const shape of intersecting) {
    for (const piece of subtractGridRect(shape.rect, region)) {
      if (gridRectArea(piece) <= GRID_EPSILON) continue
      add.push({ rect: piece, color: shape.color })
    }
  }

  // 合并候选：本次挖切产生的同色残块 + 未被移除的既有同色块。
  const addMergeCandidates: number[] = []
  add.forEach((shape, index) => {
    if (isSameColor(shape.color)) addMergeCandidates.push(index)
  })
  const keepMergeCandidates = shapes.filter((shape) => !remove.includes(shape) && isSameColor(shape.color))
  const candidateRects = [
    ...addMergeCandidates.map((index) => add[index].rect),
    ...keepMergeCandidates.map((shape) => shape.rect)
  ]
  const { merged, consumed } = mergeGridPaintRect(region, candidateRects)
  if (consumed.length > 0) {
    // 被吞并的同色残块从 add 中剔除（倒序 splice 保证下标有效）
    for (let k = consumed.length - 1; k >= 0; k -= 1) {
      const consumedIndex = consumed[k]
      if (consumedIndex < addMergeCandidates.length) {
        add.splice(addMergeCandidates[consumedIndex], 1)
      } else {
        remove.push(keepMergeCandidates[consumedIndex - addMergeCandidates.length])
      }
    }
  }
  add.push({ rect: merged, color })
  return { remove, add, changed: true }
}
