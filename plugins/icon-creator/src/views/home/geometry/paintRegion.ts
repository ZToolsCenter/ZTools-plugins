/**
 * 油漆桶工具的纯几何模块：点击点与对象封闭区域的判定。
 *
 * 设计取舍（与 colorReplace.ts 一致，不依赖 fabric，可在 Node 环境单测）：
 * - 对象按结构识别（duck typing）：带 getObjects() 的视为编组递归；
 *   带 path/paths/points 的视为路径/折线对象；圆/椭圆按 type（fabric）或 radius/rx/ry（朴素对象）识别；
 *   其余带 width/height 的视为包围盒形状。
 * - 坐标系约定：自带 calcTransformMatrix() 的对象（fabric 对象）按 fabric 渲染帧读取本体边界——
 *   以对象中心为原点（矩形 ±w/2、圆心 (0, 0)、路径命令减去 pathOffset），再经该矩阵变换到场景坐标。
 *   fabric 7 默认 originX/originY=center，缩放/旋转/斜切与编组嵌套全部由矩阵承载，判定不依赖 left/top 语义；
 *   不带矩阵的朴素对象沿用"left/top 为包围盒左上角、命令坐标即目标坐标"的直读语义（单测与纯数据场景）。
 * - 判定算法：收集对象的边界线段（含曲线按弦细分折线化），任意方向射线
 *   从点击点射出，统计与线段的有效交点数——奇数为内部（封闭区域），偶数为外部。
 * - 曲线只折线化到与几何比例匹配的精度（细分弦长受包围盒约束），
 *   保证图标级路径的判定在容差内，同时避免数值溢出。
 */

/** 场景坐标点。 */
export type PaintPoint = { x: number; y: number }

/** 可折线化边界（scene 坐标下的一组闭合折线环）。 */
export type PaintBoundaryPolygon = { points: PaintPoint[] }

/** 区域判定结果：inside 表示点击点在对象封闭边界内，outside 表示在外。 */
export type PaintRegionHit = 'inside' | 'outside'

/** 线段折线化的最大细分步数（弦细分用，防退化）。 */
const MAX_CURVE_STEPS = 24
/** 曲线折线化时单条曲线的目标弦长（相对包围盒最长边的比例）。 */
const CURVE_CHORD_RATIO = 0.04
/** 数值容差：用于端点重合/零长度判定，远小于图标场景单位。 */
const GEOMETRY_EPSILON = 1e-7
/** 射线方向与 X 轴的夹角（弧度），取无理数倍数避免与常见水平/垂直边界平行。 */
const RAY_ANGLE = Math.PI * 0.217
/** 折线化曲线时允许的最小包围盒尺寸，低于该值退化为端点直线。 */
const CURVE_MIN_BOUND = 1e-6
/** 曲线折线化的基础细分下限（小曲线也保持足够采样）。 */
const CURVE_MIN_STEPS = 8

/**
 * 判定取值是否为编组类结构（带 getObjects() 方法，如 fabric Group / ActiveSelection）。
 */
function isGroupLikeObject(value: unknown): value is { getObjects: () => unknown[] } {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getObjects?: unknown }).getObjects === 'function'
}

/** 判定取值是否为可绘路径类（fabric Path 及其 EditablePathObject 等变体）。 */
function isPathLikeObject(value: unknown): value is { path: unknown[] } {
  return !!value
    && typeof value === 'object'
    && Array.isArray((value as { path?: unknown }).path)
}

/** 判定取值是否为可序列化折线组（fabric Polyline / Polygon 的 paths 数组）。 */
function isPolylineLikeObject(value: unknown): value is { paths: unknown[] } {
  return !!value
    && typeof value === 'object'
    && Array.isArray((value as { paths?: unknown }).paths)
}

/** 判定取值是否为渐变/图案等非纯色填充（不参与"已填同色可跳过"优化）。 */
function isNonSolidFill(value: unknown): boolean {
  return !!value && typeof value === 'object'
}

/** 判定取值是否为顶点数组对象（fabric Polyline / Polygon 的 points: {x, y}[]）。 */
function isPointListObject(value: unknown): value is { points: unknown[] } {
  return !!value
    && typeof value === 'object'
    && Array.isArray((value as { points?: unknown }).points)
}

/** fabric 仿射变换矩阵结构 [a, b, c, d, e, f]。 */
export type PaintTransformMatrix = [number, number, number, number, number, number]

/** 对点应用仿射变换（fabric 矩阵约定：x' = a*x + c*y + e, y' = b*x + d*y + f）。 */
function transformPointByMatrix(matrix: PaintTransformMatrix, point: PaintPoint): PaintPoint {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
  }
}

/**
 * 判定对象是否自带变换矩阵（fabric 对象均实现 calcTransformMatrix()）。
 * 该判定决定本体边界采用哪套坐标语义：有矩阵按 fabric 渲染帧（中心原点），无矩阵按朴素直读语义。
 */
function hasOwnTransform(value: unknown): value is { calcTransformMatrix: () => unknown } {
  return !!value
    && typeof value === 'object'
    && typeof (value as { calcTransformMatrix?: unknown }).calcTransformMatrix === 'function'
}

/**
 * 读取对象自身的本体→场景变换矩阵；非 fabric 对象或矩阵不合法（不足 6 个有限数）时返回 null。
 * fabric 的 calcTransformMatrix() 已复合父编组变换，编组子对象直接调用即得场景矩阵。
 */
function readObjectTransformMatrix(obj: unknown): PaintTransformMatrix | null {
  if (!hasOwnTransform(obj)) return null
  const matrix = obj.calcTransformMatrix()
  if (!Array.isArray(matrix) || matrix.length < 6) return null
  const values = matrix.slice(0, 6).map((value) => Number(value))
  if (values.some((value) => !Number.isFinite(value))) return null
  return values as PaintTransformMatrix
}

/**
 * 读取路径/折线对象的 pathOffset（fabric 渲染时把命令坐标减去该偏移后再套对象矩阵）；
 * 朴素对象没有该字段时视为 (0, 0)，命令坐标原样作为边界坐标。
 */
function readPathOffset(obj: unknown): PaintPoint {
  const offset = (obj as { pathOffset?: { x?: unknown; y?: unknown } | null }).pathOffset
  const x = Number(offset?.x ?? 0)
  const y = Number(offset?.y ?? 0)
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 }
}

/** 把折线环整体平移（用于减去 pathOffset，把命令坐标换算到以对象中心为原点的本体帧）。 */
function shiftPolygon(polygon: PaintBoundaryPolygon, dx: number, dy: number): PaintBoundaryPolygon {
  if (dx === 0 && dy === 0) return polygon
  return { points: polygon.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
}

/** 读取 fabric 对象类型名（小写，如 circle/ellipse/rect）；朴素对象无类型时返回空串。 */
function readObjectType(obj: Record<string, any>): string {
  return typeof obj.type === 'string' ? obj.type.toLowerCase() : ''
}

/**
 * 判定对象是否为圆/椭圆：fabric 对象按 type 精确识别（避免带圆角 rx/ry 的 Rect 被误判为椭圆）；
 * 朴素对象按字段识别——有 radius，或同时有 rx/ry。
 */
function isEllipseLikeObject(obj: Record<string, any>): boolean {
  const type = readObjectType(obj)
  if (type) return type === 'circle' || type === 'ellipse'
  return Number.isFinite(Number(obj.radius))
    || (Number.isFinite(Number(obj.rx)) && Number.isFinite(Number(obj.ry)))
}

/**
 * 读取圆/椭圆的边界环（参数化采样为 48 边形）。
 * centered=true 时按 fabric 渲染帧以 (0, 0) 为圆心（fabric Circle/Ellipse 的 _render 均在中心帧绘制，
 * 半径为未缩放本体值，缩放由对象矩阵承载）；否则沿用朴素对象语义：left/top 为包围盒左上角，圆心在 (left+rx, top+ry)。
 */
function readCircleBounds(obj: Record<string, any>, centered: boolean): PaintBoundaryPolygon | null {
  const rx = Number(obj.rx ?? obj.radius)
  const ry = Number(obj.ry ?? obj.radius)
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 0 || ry <= 0) return null
  let centerX = 0
  let centerY = 0
  if (!centered) {
    const left = Number(obj.left ?? 0)
    const top = Number(obj.top ?? 0)
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null
    centerX = left + rx
    centerY = top + ry
  }
  const steps = 48
  const points: PaintPoint[] = []
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    points.push({ x: centerX + Math.cos(angle) * rx, y: centerY + Math.sin(angle) * ry })
  }
  return { points }
}

/**
 * 读取矩形类对象（Rect/文本/图片等一切包围盒形状）的轴对齐边界环。
 * centered=true 时按 fabric 渲染帧取 (-w/2, -h/2) ~ (w/2, h/2)（width/height 为未缩放本体尺寸，缩放由对象矩阵承载）；
 * 否则沿用朴素对象语义：left/top 为包围盒左上角。
 */
function readRectBounds(obj: Record<string, any>, centered: boolean): PaintBoundaryPolygon | null {
  const width = Number(obj.width)
  const height = Number(obj.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const left = centered ? -width / 2 : Number(obj.left ?? 0)
  const top = centered ? -height / 2 : Number(obj.top ?? 0)
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null
  const right = left + width
  const bottom = top + height
  return {
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ]
  }
}

/** 把顶点数组（{x, y}[]）转为闭合折线环；有效顶点少于 3 个时无可用边界。 */
function pointListToPolygon(points: unknown[]): PaintBoundaryPolygon | null {
  const result: PaintPoint[] = []
  for (const raw of points) {
    if (!raw || typeof raw !== 'object') continue
    const x = Number((raw as { x?: unknown }).x)
    const y = Number((raw as { y?: unknown }).y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    result.push({ x, y })
  }
  return result.length >= 3 ? { points: result } : null
}

/**
 * 把路径命令序列折线化为闭合折线环。
 * 支持 M/L/C/Q/Z（SVG 路径子集，fabric path 元素格式：[命令, ...数字参数]）；
 * C/Q 曲线按包围盒比例弦细分；不支持的命令跳过。返回 null 表示该对象无可用边界。
 */
function pathCommandsToPolygon(path: unknown[]): PaintBoundaryPolygon | null {
  const points: PaintPoint[] = []
  let current: PaintPoint | null = null
  let hasCurve = false
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const track = (point: PaintPoint) => {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const pushPoint = (point: PaintPoint) => {
    points.push(point)
    current = point
    track(point)
  }
  for (const raw of path) {
    if (!Array.isArray(raw) || raw.length === 0) continue
    const command = String(raw[0]).toUpperCase()
    const numbers = raw.slice(1).map((value) => Number(value))
    if (numbers.some((value) => !Number.isFinite(value))) continue
    if (command === 'M' || command === 'L' || command === 'T') {
      pushPoint({ x: numbers[0], y: numbers[1] })
    } else if (command === 'C') {
      // 三次贝塞尔：起 current，控制 cp1/cp2，终点 end。
      if (!current) continue
      hasCurve = true
      const [cp1x, cp1y, cp2x, cp2y, endX, endY] = numbers
      track({ x: cp1x, y: cp1y })
      track({ x: cp2x, y: cp2y })
      track({ x: endX, y: endY })
      const end: PaintPoint = { x: endX, y: endY }
      points.push(...flattenCubic(current, { x: cp1x, y: cp1y }, { x: cp2x, y: cp2y }, end))
      current = end
    } else if (command === 'Q') {
      // 二次贝塞尔：升阶为三次后按同一套细分处理。
      if (!current) continue
      hasCurve = true
      const [cx, cy, endX, endY] = numbers
      track({ x: cx, y: cy })
      track({ x: endX, y: endY })
      const end: PaintPoint = { x: endX, y: endY }
      const cp1 = { x: current.x + (2 / 3) * (cx - current.x), y: current.y + (2 / 3) * (cy - current.y) }
      const cp2 = { x: end.x + (2 / 3) * (cx - end.x), y: end.y + (2 / 3) * (cy - end.y) }
      points.push(...flattenCubic(current, cp1, cp2, end))
      current = end
    } else if (command === 'Z') {
      // 闭合：回到首点；多环路径时按序列继续累积（外环+内环都会参与射线计数，偶奇规则自然处理洞）。
      if (points.length) {
        const first = points[0]
        pushPoint({ x: first.x, y: first.y })
      }
    } else if (command === 'V' || command === 'H') {
      // fabric 内部 path 不产出 V/H（解析期已展开为 L），保守处理：
      if (command === 'V' && current) pushPoint({ x: current.x, y: numbers[0] })
      if (command === 'H' && current) pushPoint({ x: numbers[0], y: current.y })
    } else {
      continue
    }
  }
  if (points.length < 3) return null
  // 首尾重合时去掉重复闭合点，闭合逻辑由判定阶段统一补环。
  const last = points[points.length - 1]
  const first = points[0]
  if (Math.abs(last.x - first.x) < GEOMETRY_EPSILON && Math.abs(last.y - first.y) < GEOMETRY_EPSILON) {
    points.pop()
  }
  if (points.length < 3) return null
  void hasCurve
  void minX
  void minY
  void maxX
  void maxY
  return { points }
}

/**
 * 把三次贝塞尔按目标弦长折线化：步数由包围盒尺寸与固定比例推得，限制在 [1, MAX_CURVE_STEPS]。
 * 返回不含起点的中间点序列（调用方以 current 为起点拼接）。
 */
function flattenCubic(
  from: PaintPoint,
  cp1: PaintPoint,
  cp2: PaintPoint,
  to: PaintPoint
): PaintPoint[] {
  const boundX = Math.max(Math.abs(to.x - from.x), Math.abs(cp1.x - from.x), Math.abs(cp2.x - from.x))
  const boundY = Math.max(Math.abs(to.y - from.y), Math.abs(cp1.y - from.y), Math.abs(cp2.y - from.y))
  const bound = Math.max(boundX, boundY)
  // 包围盒过小时退化为直线段；其余按包围盒尺寸取 8~16 步细分。
  const stepCount = bound < CURVE_MIN_BOUND
    ? 1
    : Math.min(MAX_CURVE_STEPS, Math.max(CURVE_MIN_STEPS, Math.ceil(bound / Math.max(bound * CURVE_CHORD_RATIO, GEOMETRY_EPSILON))))
  const result: PaintPoint[] = []
  for (let i = 1; i <= stepCount; i += 1) {
    const t = i / stepCount
    const inverse = 1 - t
    const x = inverse * inverse * inverse * from.x + 3 * inverse * inverse * t * cp1.x + 3 * inverse * t * t * cp2.x + t * t * t * to.x
    const y = inverse * inverse * inverse * from.y + 3 * inverse * inverse * t * cp1.y + 3 * inverse * t * t * cp2.y + t * t * t * to.y
    if (i < stepCount) result.push({ x, y })
  }
  result.push({ x: to.x, y: to.y })
  return result
}

/**
 * 从单个对象读取可判定的封闭边界（本体帧，未应用对象变换）：
 * - 路径类：折线化 path 命令并减去 pathOffset；
 * - 折线组 / 顶点数组：paths 展开为多个环、points 直接成环，同样减去 pathOffset；
 * - 圆/椭圆：参数化采样为多边形；
 * - 包围盒形状（含文本/图片等）：退化为矩形包围盒（可填充语义近似为整体内部）；
 * - 编组：递归展开子对象（各子对象处于自己的本体帧，需逐子对象变换上屏，见 toScenePolygon）。
 *
 * 本体帧的含义取决于对象是否自带矩阵：fabric 对象（有 calcTransformMatrix）以对象中心为原点，
 * 与 fabric _render 的绘制帧一致，经 calcTransformMatrix 即得场景坐标；
 * 朴素对象无矩阵，left/top 视为包围盒左上角、命令坐标原样使用，本体帧即目标坐标系。
 */
export function extractObjectBoundary(obj: unknown): PaintBoundaryPolygon[] {
  if (obj == null || typeof obj !== 'object') return []
  if (isGroupLikeObject(obj)) {
    const result: PaintBoundaryPolygon[] = []
    for (const child of obj.getObjects()) {
      result.push(...extractObjectBoundary(child))
    }
    return result
  }
  const offset = readPathOffset(obj)
  if (isPathLikeObject(obj)) {
    const polygon = pathCommandsToPolygon(obj.path)
    return polygon ? [shiftPolygon(polygon, -offset.x, -offset.y)] : []
  }
  if (isPolylineLikeObject(obj)) {
    const result: PaintBoundaryPolygon[] = []
    for (const entry of obj.paths) {
      if (Array.isArray(entry)) {
        const polygon = pathCommandsToPolygon(entry)
        if (polygon) result.push(shiftPolygon(polygon, -offset.x, -offset.y))
      }
    }
    return result
  }
  if (isPointListObject(obj)) {
    const polygon = pointListToPolygon(obj.points)
    return polygon ? [shiftPolygon(polygon, -offset.x, -offset.y)] : []
  }
  const record = obj as Record<string, any>
  const centered = hasOwnTransform(obj)
  if (isEllipseLikeObject(record)) {
    const circle = readCircleBounds(record, centered)
    if (circle) return [circle]
  }
  const rect = readRectBounds(record, centered)
  return rect ? [rect] : []
}

/**
 * 读取对象的封闭边界并统一变换到场景坐标：
 * - 显式传入 matrix 时按传入矩阵变换本体帧边界（如把编组子对象的本体坐标变换到编组场景坐标；
 *   仅适用于本体帧一致的单个对象或朴素编组）；
 * - 缺省取对象自身的 calcTransformMatrix（fabric 的"上屏场景坐标"，已复合父编组变换）；
 *   编组无显式矩阵时逐子对象递归上屏——每个叶子各自套自己的场景矩阵，嵌套编组自然覆盖；
 * - 对象没有矩阵（朴素对象）时本体帧即场景帧，原样返回。
 * 对象无可判定边界时返回空数组。
 */
export function toScenePolygon(obj: unknown, matrix?: PaintTransformMatrix): PaintBoundaryPolygon[] {
  if (obj == null || typeof obj !== 'object') return []
  if (!matrix && isGroupLikeObject(obj)) {
    const result: PaintBoundaryPolygon[] = []
    for (const child of obj.getObjects()) {
      result.push(...toScenePolygon(child))
    }
    return result
  }
  const transform = matrix ?? readObjectTransformMatrix(obj)
  if (!transform) return extractObjectBoundary(obj)
  return extractObjectBoundary(obj).map((ring) => ({
    points: ring.points.map((point) => transformPointByMatrix(transform, point))
  }))
}

/**
 * 射线法判定点是否在单个闭合折线环内（含边界上的点按内部处理）。
 * - 射线方向取 RAY_ANGLE（无理数倍数），规避与水平/垂直边平行的退化情形；
 * - 逐边做射线-线段求交，端点重合抖动由方向选择规避；奇数交点为内部；
 * - 点恰在边上是封闭区域的合法组成部分，返回 true。
 */
function isPointInRing(point: PaintPoint, ring: PaintPoint[]): boolean {
  const rayDx = Math.cos(RAY_ANGLE)
  const rayDy = Math.sin(RAY_ANGLE)
  let crossings = 0
  const count = ring.length
  for (let i = 0; i < count; i += 1) {
    const a = ring[i]
    const b = ring[(i + 1) % count]
    // 先做“点在边矩形扩展容差内且点到线段距离近”的快速边界命中判定
    if (isPointOnSegment(point, a, b)) return true
    // 射线参数化：P + t*D 与线段 A + s*(B-A) 求交
    const edgeDx = b.x - a.x
    const edgeDy = b.y - a.y
    const denominator = rayDx * edgeDy - rayDy * edgeDx
    if (Math.abs(denominator) < GEOMETRY_EPSILON) continue
    const offset = { x: a.x - point.x, y: a.y - point.y }
    const t = (offset.x * edgeDy - offset.y * edgeDx) / denominator
    const s = (offset.x * rayDy - offset.y * rayDx) / denominator
    // t>0 只看射线正向；s ∈ [0,1) 命中该边（半开区间避免端点双计数）
    if (t > GEOMETRY_EPSILON && s >= 0 && s < 1) crossings += 1
  }
  return crossings % 2 === 1
}

/** 点是否落在线段上（含端点），点到线段距离 < epsilon 判定。 */
function isPointOnSegment(point: PaintPoint, a: PaintPoint, b: PaintPoint): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq < GEOMETRY_EPSILON * GEOMETRY_EPSILON) {
    return Math.hypot(point.x - a.x, point.y - a.y) < GEOMETRY_EPSILON
  }
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq
  const clamped = Math.min(1, Math.max(0, t))
  const nearestX = a.x + clamped * dx
  const nearestY = a.y + clamped * dy
  return Math.hypot(point.x - nearestX, point.y - nearestY) < GEOMETRY_EPSILON
}

/**
 * 判定点击点相对对象封闭区域的命中结果：
 * 对象（含编组子树）上屏后的全部边界环中，点在任意一环内部/边上即视为 inside。
 * 没有可判定边界或点在所有环外部时返回 outside。
 * 边界经 toScenePolygon 统一到场景坐标——fabric 对象套自身矩阵（覆盖中心原点、缩放、旋转与编组嵌套），
 * 朴素对象原样使用；调用方传入的 point 需为场景坐标（Fabric 的 scenePoint）。
 */
export function resolvePaintRegionHit(point: PaintPoint, obj: unknown): PaintRegionHit {
  const rings = toScenePolygon(obj)
  if (!rings.length) return 'outside'
  for (const ring of rings) {
    if (isPointInRing(point, ring.points)) return 'inside'
  }
  return 'outside'
}

/**
 * 汇总点击点位于其封闭区域内的全部对象。
 * objects 为画布对象列表（顶层顺序），返回其中区域包含该点的对象（含编组整组命中，
 * 若需要编组内精确子对象定位，调用方可对编组自行展开后传入子对象列表）。
 * 判定不依赖对象的 fill 状态：透明/未开启填充的对象只要几何区域包含点击点即命中，
 * 油漆桶据此对其自动开启填充并上色。
 */
export function collectObjectsContainingPoint(point: PaintPoint, objects: unknown[]): unknown[] {
  return objects.filter((obj) => resolvePaintRegionHit(point, obj) === 'inside')
}

/** 判断对象填充是否已是目标纯色（跳过重复上色；渐变/图案/透明不视为同色）。 */
export function isSolidFillMatched(obj: unknown, color: string): boolean {
  if (obj == null || typeof obj !== 'object') return false
  if (isGroupLikeObject(obj)) return false
  const fill = (obj as Record<string, any>).fill
  if (isNonSolidFill(fill)) return false
  return typeof fill === 'string' && fill.trim().toLowerCase() === color.trim().toLowerCase()
}

/** 判断对象描边是否已是目标纯色（跳过重复上色；渐变等非字符串描边不视为同色）。 */
export function isSolidStrokeMatched(obj: unknown, color: string): boolean {
  if (obj == null || typeof obj !== 'object') return false
  if (isGroupLikeObject(obj)) return false
  const stroke = (obj as Record<string, any>).stroke
  if (isNonSolidFill(stroke)) return false
  return typeof stroke === 'string' && stroke.trim().toLowerCase() === color.trim().toLowerCase()
}
