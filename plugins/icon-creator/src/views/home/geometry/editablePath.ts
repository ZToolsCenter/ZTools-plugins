import { Path, Point } from 'fabric'
import type { TComplexPathData, TSimplePathData } from 'fabric'

type AnyFabricPath = Path & Record<string, any>

export type ArrowHeadShape = 'hollow' | 'solid'
export type ArrowRenderMode = 'standard' | 'hollow-shaft'

export type ArrowHead = {
  enabled: boolean
  shape: ArrowHeadShape
  angle: number
  length: number
}

export type EditablePoint = {
  x: number
  y: number
  selectable?: boolean
  arrowHead?: ArrowHead
}

export type EditablePathSegment =
  | { type: 'line'; to: number; cp1?: EditablePoint; cp2?: EditablePoint }
  | { type: 'cubic'; cp1: EditablePoint; cp2: EditablePoint; to: number }

export type EditablePathContour = {
  closed: boolean
  points: EditablePoint[]
  segments: EditablePathSegment[]
}

export type EditablePathModel = {
  contours: EditablePathContour[]
}

type LegacyEditablePathModel = EditablePathContour

export type EditablePathObject = AnyFabricPath & {
  editablePath: EditablePathModel | LegacyEditablePathModel
  cornerRadius: number
  cornerRadiusOverrides: Array<number | null>
  editablePathVersion: number
  arrowRenderMode?: ArrowRenderMode
  arrowLineWidth?: number
  arrowTipAngle?: number
  arrowSideAngle?: number
}

type BuildSegment = {
  from: number
  to: number
  type: EditablePathSegment['type']
  cp1?: EditablePoint
  cp2?: EditablePoint
}

type RoundedPoint = EditablePoint & {
  index: number
  radius: number
  inPoint: EditablePoint
  outPoint: EditablePoint
  hasRound: boolean
}

type EditablePointRef = {
  contour: EditablePathContour
  contourIndex: number
  point: EditablePoint
  pointIndex: number
  globalIndex: number
}

export type EditableSegmentRef = {
  contour: EditablePathContour
  contourIndex: number
  segment: EditablePathSegment
  segmentIndex: number
  fromPoint: EditablePoint
  toPoint: EditablePoint
  fromPointIndex: number
  toPointIndex: number
  fromGlobalIndex: number
  toGlobalIndex: number
}

const EDITABLE_PATH_VERSION = 2
const KAPPA = 0.5522847498307936

function clonePoint(point: EditablePoint): EditablePoint {
  return {
    x: point.x,
    y: point.y,
    selectable: point.selectable,
    arrowHead: point.arrowHead ? { ...point.arrowHead } : undefined
  }
}

function cloneSegment(segment: EditablePathSegment): EditablePathSegment {
  if (segment.type === 'line') {
    return {
      ...segment,
      cp1: segment.cp1 ? clonePoint(segment.cp1) : undefined,
      cp2: segment.cp2 ? clonePoint(segment.cp2) : undefined
    }
  }
  return { ...segment, cp1: clonePoint(segment.cp1), cp2: clonePoint(segment.cp2) }
}

function cloneContour(contour: EditablePathContour): EditablePathContour {
  return {
    closed: contour.closed,
    points: contour.points.map(clonePoint),
    segments: contour.segments.map(cloneSegment)
  }
}

function cloneModel(model: EditablePathModel): EditablePathModel {
  return {
    contours: model.contours.map(cloneContour)
  }
}

function distance(a: EditablePoint, b: EditablePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function lerp(a: EditablePoint, b: EditablePoint, amount: number): EditablePoint {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount
  }
}

function samePoint(a: EditablePoint, b: EditablePoint) {
  return Math.abs(a.x - b.x) < 0.0001 && Math.abs(a.y - b.y) < 0.0001
}

function isEditablePathContour(value: unknown): value is EditablePathContour {
  return !!value
    && typeof value === 'object'
    && Array.isArray((value as EditablePathContour).points)
    && Array.isArray((value as EditablePathContour).segments)
}

function normalizeContour(value: Partial<EditablePathContour> | null | undefined): EditablePathContour {
  const points = Array.isArray(value?.points) ? value.points : []
  const segments = Array.isArray(value?.segments) ? value.segments : []
  return {
    closed: value?.closed !== false,
    points: points.map(clonePoint),
    segments: segments.map(cloneSegment)
  }
}

function isEditablePathModel(value: unknown): value is EditablePathModel {
  return !!value
    && typeof value === 'object'
    && Array.isArray((value as EditablePathModel).contours)
}

function normalizeModel(model: EditablePathModel | LegacyEditablePathModel | null | undefined): EditablePathModel {
  if (isEditablePathModel(model)) {
    return {
      contours: model.contours
        .filter(isEditablePathContour)
        .map(normalizeContour)
    }
  }
  if (isEditablePathContour(model)) {
    return {
      contours: [normalizeContour(model)]
    }
  }
  return { contours: [] }
}

function getPointCount(model: EditablePathModel) {
  return model.contours.reduce((total, contour) => total + contour.points.length, 0)
}

function getContourStartIndices(model: EditablePathModel) {
  const startIndices: number[] = []
  let startIndex = 0
  model.contours.forEach((contour) => {
    startIndices.push(startIndex)
    startIndex += contour.points.length
  })
  return startIndices
}

function buildSegmentToEditablePathSegment(segment: BuildSegment): EditablePathSegment {
  if (segment.type === 'cubic' && segment.cp1 && segment.cp2) {
    return {
      type: 'cubic',
      cp1: clonePoint(segment.cp1),
      cp2: clonePoint(segment.cp2),
      to: segment.to
    }
  }
  return {
    type: 'line',
    to: segment.to,
    cp1: segment.cp1 ? clonePoint(segment.cp1) : undefined,
    cp2: segment.cp2 ? clonePoint(segment.cp2) : undefined
  }
}

function buildEditableSegmentRef(model: EditablePathModel, contourIndex: number, segmentIndex: number) {
  const contour = model.contours[contourIndex]
  if (!contour) return null
  const segments = getBuildSegments(contour)
  const buildSegment = segments[segmentIndex]
  if (!buildSegment) return null
  const fromPoint = contour.points[buildSegment.from]
  const toPoint = contour.points[buildSegment.to]
  if (!fromPoint || !toPoint) return null
  const contourStartIndex = getContourStartIndices(model)[contourIndex] ?? 0
  return {
    contour,
    contourIndex,
    segment: contour.segments[segmentIndex] ?? buildSegmentToEditablePathSegment(buildSegment),
    segmentIndex,
    fromPoint,
    toPoint,
    fromPointIndex: buildSegment.from,
    toPointIndex: buildSegment.to,
    fromGlobalIndex: contourStartIndex + buildSegment.from,
    toGlobalIndex: contourStartIndex + buildSegment.to
  } satisfies EditableSegmentRef
}

export function resolveEditableSegmentRef(
  obj: EditablePathObject,
  segmentRef: EditableSegmentRef | null | undefined
) {
  if (!segmentRef) return null
  const model = ensureEditablePathObject(obj)
  const liveSegmentRef = buildEditableSegmentRef(model, segmentRef.contourIndex, segmentRef.segmentIndex)
  if (!liveSegmentRef) return null
  if (
    liveSegmentRef.fromPointIndex !== segmentRef.fromPointIndex
    || liveSegmentRef.toPointIndex !== segmentRef.toPointIndex
  ) return null
  return liveSegmentRef
}

function ensureEditablePathObject(obj: EditablePathObject) {
  const normalized = normalizeModel(obj.editablePath)
  const expectedPointCount = getPointCount(normalized)
  const nextOverrides = Array.from({ length: expectedPointCount }, (_, index) => {
    const value = obj.cornerRadiusOverrides?.[index]
    return value == null || !Number.isFinite(value) ? null : Math.max(0, value)
  })

  obj.editablePath = normalized
  obj.cornerRadius = Number.isFinite(obj.cornerRadius) ? Math.max(0, obj.cornerRadius) : 0
  obj.cornerRadiusOverrides = nextOverrides
  obj.editablePathVersion = EDITABLE_PATH_VERSION

  return normalized
}

function flattenEditablePoints(model: EditablePathModel) {
  const result: EditablePointRef[] = []
  let globalIndex = 0
  model.contours.forEach((contour, contourIndex) => {
    contour.points.forEach((point, pointIndex) => {
      result.push({
        contour,
        contourIndex,
        point,
        pointIndex,
        globalIndex
      })
      globalIndex += 1
    })
  })
  return result
}

function resolveEditablePoint(model: EditablePathModel, globalIndex: number) {
  if (!Number.isInteger(globalIndex) || globalIndex < 0) return null
  let startIndex = 0
  for (let contourIndex = 0; contourIndex < model.contours.length; contourIndex += 1) {
    const contour = model.contours[contourIndex]
    const endIndex = startIndex + contour.points.length
    if (globalIndex < endIndex) {
      const pointIndex = globalIndex - startIndex
      return {
        contour,
        contourIndex,
        pointIndex,
        globalIndex,
        point: contour.points[pointIndex]
      } satisfies EditablePointRef
    }
    startIndex = endIndex
  }
  return null
}

function clampRadius(contour: EditablePathContour, index: number, radius: number) {
  if (!Number.isFinite(radius) || radius <= 0) return 0
  if (contour.points[index]?.selectable === false) return 0
  if (!contour.closed && (index === 0 || index === contour.points.length - 1)) return 0
  const prev = contour.points[index - 1] ?? contour.points[contour.points.length - 1]
  const current = contour.points[index]
  const next = contour.points[index + 1] ?? contour.points[0]
  if (!prev || !current || !next) return 0
  const prevLen = distance(prev, current)
  const nextLen = distance(current, next)
  if (prevLen <= 0 || nextLen <= 0) return 0
  return Math.max(0, Math.min(radius, prevLen / 2, nextLen / 2))
}

function effectiveRadius(obj: EditablePathObject, index: number) {
  const override = obj.cornerRadiusOverrides?.[index]
  const radius = override == null ? obj.cornerRadius : override
  return Number.isFinite(radius) ? Math.max(0, radius) : 0
}

function getBuildSegments(contour: EditablePathContour): BuildSegment[] {
  if (contour.segments.length) {
    const segments: BuildSegment[] = []
    let from = 0
    for (const segment of contour.segments) {
      segments.push({ from, to: segment.to, type: segment.type, cp1: (segment as any).cp1, cp2: (segment as any).cp2 })
      from = segment.to
    }
    return segments
  }

  const segments: BuildSegment[] = []
  const count = contour.points.length
  const max = contour.closed ? count : count - 1
  for (let i = 0; i < max; i++) {
    segments.push({ from: i, to: (i + 1) % count, type: 'line' })
  }
  return segments
}

function createRoundedPoints(contour: EditablePathContour, obj: EditablePathObject, startIndex: number) {
  const points = contour.points
  return points.map((point, index): RoundedPoint => {
    const radius = clampRadius(contour, index, effectiveRadius(obj, startIndex + index))
    const prev = points[index - 1] ?? points[points.length - 1]
    const next = points[index + 1] ?? points[0]
    const hasRound = radius > 0 && !!prev && !!next
    return {
      ...point,
      index: startIndex + index,
      radius,
      inPoint: hasRound ? lerp(point, prev, radius / distance(point, prev)) : point,
      outPoint: hasRound ? lerp(point, next, radius / distance(point, next)) : point,
      hasRound
    }
  })
}

function pushLine(commands: TComplexPathData, point: EditablePoint) {
  commands.push(['L', point.x, point.y])
}

const DEFAULT_ARROW_HEAD: ArrowHead = { enabled: true, shape: 'hollow', angle: 60, length: 16 }
const DEFAULT_HOLLOW_SHAFT_LINE_WIDTH_RATIO = 0.44
const DEFAULT_HOLLOW_SHAFT_TIP_ANGLE = 81
const DEFAULT_HOLLOW_SHAFT_SIDE_ANGLE = 90

export function createDefaultArrowHead(overrides: Partial<ArrowHead> = {}): ArrowHead {
  return normalizeArrowHead({
    ...DEFAULT_ARROW_HEAD,
    ...overrides
  })
}

function normalizeArrowHead(head: ArrowHead): ArrowHead {
  const angle = Number.isFinite(head.angle) ? Math.max(15, Math.min(150, head.angle)) : DEFAULT_ARROW_HEAD.angle
  const length = Number.isFinite(head.length) ? Math.max(0, head.length) : DEFAULT_ARROW_HEAD.length
  const shape: ArrowHeadShape = head.shape === 'solid' ? 'solid' : 'hollow'
  return { enabled: !!head.enabled, shape, angle, length }
}

function getEndpointTangent(contour: EditablePathContour, isStart: boolean) {
  const points = contour.points
  if (points.length < 2 || contour.closed) return null
  const buildSegments = getBuildSegments(contour)
  if (!buildSegments.length) return null

  const seg = isStart ? buildSegments[0] : buildSegments[buildSegments.length - 1]
  const endpointIndex = isStart ? seg.from : seg.to
  const endpoint = points[endpointIndex]
  if (!endpoint) return null

  const candidates: EditablePoint[] = []
  if (seg.type === 'cubic' && seg.cp1 && seg.cp2) {
    candidates.push(isStart ? seg.cp1 : seg.cp2)
    candidates.push(isStart ? seg.cp2 : seg.cp1)
  }
  candidates.push(points[isStart ? seg.to : seg.from])

  for (const candidate of candidates) {
    if (!candidate) continue
    const dx = endpoint.x - candidate.x
    const dy = endpoint.y - candidate.y
    const len = Math.hypot(dx, dy)
    if (len > 1e-6) return { x: dx / len, y: dy / len }
  }
  return null
}

type ArrowHeadGeometry = {
  shape: ArrowHeadShape
  tip: EditablePoint
  barb1: EditablePoint
  barb2: EditablePoint
}

function computeArrowHeadGeometry(contour: EditablePathContour, isStart: boolean, headRaw: ArrowHead): ArrowHeadGeometry | null {
  const head = normalizeArrowHead(headRaw)
  if (!head.enabled) return null
  if (head.length <= 0) return null
  const tangent = getEndpointTangent(contour, isStart)
  if (!tangent) return null
  const tip = isStart ? contour.points[0] : contour.points[contour.points.length - 1]
  if (!tip) return null

  const halfRad = (head.angle / 2) * Math.PI / 180
  const cosA = Math.cos(halfRad)
  const sinA = Math.sin(halfRad)
  const bx = -tangent.x
  const by = -tangent.y
  const a1x = bx * cosA - by * sinA
  const a1y = bx * sinA + by * cosA
  const a2x = bx * cosA + by * sinA
  const a2y = -bx * sinA + by * cosA

  return {
    shape: head.shape,
    tip: { x: tip.x, y: tip.y },
    barb1: { x: tip.x + head.length * a1x, y: tip.y + head.length * a1y },
    barb2: { x: tip.x + head.length * a2x, y: tip.y + head.length * a2y }
  }
}

function buildArrowHeadCommands(contour: EditablePathContour, isStart: boolean, head: ArrowHead): TComplexPathData | null {
  const geo = computeArrowHeadGeometry(contour, isStart, head)
  if (!geo) return null
  if (geo.shape === 'solid') {
    return [
      ['M', geo.tip.x, geo.tip.y],
      ['L', geo.barb1.x, geo.barb1.y],
      ['L', geo.barb2.x, geo.barb2.y],
      ['Z']
    ]
  }
  return [
    ['M', geo.barb1.x, geo.barb1.y],
    ['L', geo.tip.x, geo.tip.y],
    ['L', geo.barb2.x, geo.barb2.y]
  ]
}

export function getArrowRenderMode(obj: EditablePathObject | null | undefined): ArrowRenderMode {
  return obj?.arrowRenderMode === 'hollow-shaft' ? 'hollow-shaft' : 'standard'
}

export function getHollowShaftArrowLineWidth(obj: EditablePathObject | null | undefined, headRaw?: ArrowHead | null) {
  const raw = Number(obj?.arrowLineWidth)
  if (Number.isFinite(raw) && raw >= 0) return raw
  const head = headRaw ? normalizeArrowHead(headRaw) : null
  const fallbackLength = head?.length ?? DEFAULT_ARROW_HEAD.length
  return Math.max(0, fallbackLength * DEFAULT_HOLLOW_SHAFT_LINE_WIDTH_RATIO)
}

export function getHollowShaftArrowTipAngle(obj: EditablePathObject | null | undefined) {
  const raw = Number(obj?.arrowTipAngle)
  if (!Number.isFinite(raw)) return DEFAULT_HOLLOW_SHAFT_TIP_ANGLE
  return Math.max(15, Math.min(165, raw))
}

export function getHollowShaftArrowSideAngle(obj: EditablePathObject | null | undefined) {
  const raw = Number(obj?.arrowSideAngle)
  if (!Number.isFinite(raw)) return DEFAULT_HOLLOW_SHAFT_SIDE_ANGLE
  return Math.max(15, Math.min(90, raw))
}

function buildHollowShaftArrowCommands(obj: EditablePathObject, contour: EditablePathContour): TComplexPathData | null {
  if (contour.closed || contour.points.length !== 2) return null
  const segment = getBuildSegments(contour)[0]
  if (!segment || segment.type !== 'line') return null
  const start = contour.points[0]
  const end = contour.points[1]
  if (!start || !end) return null

  const startHead = start.arrowHead ? normalizeArrowHead(start.arrowHead) : null
  const endHead = end.arrowHead ? normalizeArrowHead(end.arrowHead) : null
  if (!startHead?.enabled && !endHead?.enabled) return null

  const dx = end.x - start.x
  const dy = end.y - start.y
  const totalLength = Math.hypot(dx, dy)
  if (totalLength <= 1e-6) return null

  const ux = dx / totalLength
  const uy = dy / totalLength
  const nx = -uy
  const ny = ux
  const fallbackHead = endHead ?? startHead ?? undefined
  const enabledHeads = [startHead, endHead].filter((head): head is ArrowHead => !!head?.enabled && head.length > 0)
  if (!enabledHeads.length) return null

  const shaftHalfHeight = Math.min(
    Math.max(0, getHollowShaftArrowLineWidth(obj, fallbackHead) / 2),
    ...enabledHeads.map((head) => head.length / 2)
  )
  const tipHalfAngle = (getHollowShaftArrowTipAngle(obj) / 2) * Math.PI / 180
  const sideAngle = getHollowShaftArrowSideAngle(obj) * Math.PI / 180

  function createHeadMetrics(head: ArrowHead | null) {
    if (!head?.enabled || head.length <= 0) return null
    const halfHeight = head.length / 2
    const tipDepth = halfHeight / Math.max(Math.tan(tipHalfAngle), 1e-4)
    const sideDepth = Math.abs(halfHeight - shaftHalfHeight) / Math.max(Math.tan(sideAngle), 1e-4)
    return {
      halfHeight,
      headDepth: Math.max(tipDepth, sideDepth),
      sideDepth
    }
  }

  const startMetricsRaw = createHeadMetrics(startHead)
  const endMetricsRaw = createHeadMetrics(endHead)
  const totalHeadDepth = (startMetricsRaw?.headDepth ?? 0) + (endMetricsRaw?.headDepth ?? 0)
  const maxDepth = Math.max(totalLength - 1e-4, 0)
  const headScale = totalHeadDepth > maxDepth && totalHeadDepth > 0 ? maxDepth / totalHeadDepth : 1

  function normalizeHeadMetrics(metrics: { halfHeight: number; headDepth: number; sideDepth: number } | null) {
    if (!metrics) return null
    const headDepth = metrics.headDepth * headScale
    const sideDepth = metrics.sideDepth * headScale
    return {
      halfHeight: metrics.halfHeight,
      headDepth,
      joinDistance: Math.max(headDepth - sideDepth, 0)
    }
  }

  const startMetrics = normalizeHeadMetrics(startMetricsRaw)
  const endMetrics = normalizeHeadMetrics(endMetricsRaw)

  const startTop = { x: start.x + nx * shaftHalfHeight, y: start.y + ny * shaftHalfHeight }
  const startBottom = { x: start.x - nx * shaftHalfHeight, y: start.y - ny * shaftHalfHeight }
  const endTop = { x: end.x + nx * shaftHalfHeight, y: end.y + ny * shaftHalfHeight }
  const endBottom = { x: end.x - nx * shaftHalfHeight, y: end.y - ny * shaftHalfHeight }

  const commands: TComplexPathData = []

  if (startMetrics) {
    const startBase = { x: start.x + ux * startMetrics.headDepth, y: start.y + uy * startMetrics.headDepth }
    const startJoin = { x: start.x + ux * startMetrics.joinDistance, y: start.y + uy * startMetrics.joinDistance }
    commands.push(['M', start.x, start.y])
    commands.push(['L', startBase.x + nx * startMetrics.halfHeight, startBase.y + ny * startMetrics.halfHeight])
    commands.push(['L', startJoin.x + nx * shaftHalfHeight, startJoin.y + ny * shaftHalfHeight])
  } else {
    commands.push(['M', startTop.x, startTop.y])
  }

  if (endMetrics) {
    const endBase = { x: end.x - ux * endMetrics.headDepth, y: end.y - uy * endMetrics.headDepth }
    const endJoin = { x: end.x - ux * endMetrics.joinDistance, y: end.y - uy * endMetrics.joinDistance }
    commands.push(['L', endJoin.x + nx * shaftHalfHeight, endJoin.y + ny * shaftHalfHeight])
    commands.push(['L', endBase.x + nx * endMetrics.halfHeight, endBase.y + ny * endMetrics.halfHeight])
    commands.push(['L', end.x, end.y])
    commands.push(['L', endBase.x - nx * endMetrics.halfHeight, endBase.y - ny * endMetrics.halfHeight])
    commands.push(['L', endJoin.x - nx * shaftHalfHeight, endJoin.y - ny * shaftHalfHeight])
  } else {
    commands.push(['L', endTop.x, endTop.y])
    commands.push(['L', endBottom.x, endBottom.y])
  }

  if (startMetrics) {
    const startBase = { x: start.x + ux * startMetrics.headDepth, y: start.y + uy * startMetrics.headDepth }
    const startJoin = { x: start.x + ux * startMetrics.joinDistance, y: start.y + uy * startMetrics.joinDistance }
    commands.push(['L', startJoin.x - nx * shaftHalfHeight, startJoin.y - ny * shaftHalfHeight])
    commands.push(['L', startBase.x - nx * startMetrics.halfHeight, startBase.y - ny * startMetrics.halfHeight])
    commands.push(['L', start.x, start.y])
  } else {
    commands.push(['L', startBottom.x, startBottom.y])
  }

  commands.push(['Z'])
  return commands
}

function pushCubic(commands: TComplexPathData, from: EditablePoint, cp1: EditablePoint, cp2: EditablePoint, to: EditablePoint) {
  if (samePoint(from, to)) return
  commands.push(['C', cp1.x, cp1.y, cp2.x, cp2.y, to.x, to.y])
}

function buildContourPathData(contour: EditablePathContour, obj: EditablePathObject, startIndex: number): TComplexPathData {
  const points = contour.points
  if (!points.length) return []
  if (points.length === 1) return [['M', points[0].x, points[0].y]]

  if (!contour.closed && getArrowRenderMode(obj) === 'hollow-shaft') {
    const hollowCommands = buildHollowShaftArrowCommands(obj, contour)
    if (hollowCommands) return hollowCommands
  }

  const rounded = createRoundedPoints(contour, obj, startIndex)
  const segments = getBuildSegments(contour)
  const firstIndex = contour.closed ? 0 : segments[0]?.from ?? 0
  const first = rounded[firstIndex]
  const commands: TComplexPathData = [['M', contour.closed && first.hasRound ? first.outPoint.x : first.x, contour.closed && first.hasRound ? first.outPoint.y : first.y]]
  let current: EditablePoint = contour.closed && first.hasRound ? first.outPoint : first

  for (const segment of segments) {
    const to = rounded[segment.to]
    const segmentEnd = to.hasRound ? to.inPoint : to
    if (segment.type === 'cubic' && segment.cp1 && segment.cp2) {
      pushCubic(commands, current, segment.cp1, segment.cp2, segmentEnd)
    } else {
      pushLine(commands, segmentEnd)
    }
    current = segmentEnd
    if (to.hasRound) {
      const cp1 = lerp(to.inPoint, to, KAPPA)
      const cp2 = lerp(to.outPoint, to, KAPPA)
      pushCubic(commands, current, cp1, cp2, to.outPoint)
      current = to.outPoint
    }
  }

  if (contour.closed) commands.push(['Z'])

  if (!contour.closed) {
    const startHead = points[0]?.arrowHead
    const endHead = points[points.length - 1]?.arrowHead
    if (startHead?.enabled) {
      const headCommands = buildArrowHeadCommands(contour, true, startHead)
      if (headCommands) commands.push(...headCommands)
    }
    if (endHead?.enabled) {
      const headCommands = buildArrowHeadCommands(contour, false, endHead)
      if (headCommands) commands.push(...headCommands)
    }
  }
  return commands
}

export function buildEditablePathData(obj: EditablePathObject): TComplexPathData {
  const model = ensureEditablePathObject(obj)
  const commands: TComplexPathData = []
  let startIndex = 0
  model.contours.forEach((contour) => {
    commands.push(...buildContourPathData(contour, obj, startIndex))
    startIndex += contour.points.length
  })
  return commands
}

export function createEditablePathObject(model: EditablePathModel, cornerRadius = 0) {
  const obj = new Path('M 0 0') as EditablePathObject
  obj.editablePath = cloneModel(normalizeModel(model))
  obj.cornerRadius = Math.max(0, cornerRadius)
  obj.cornerRadiusOverrides = Array.from({ length: getPointCount(obj.editablePath as EditablePathModel) }, () => null)
  obj.editablePathVersion = EDITABLE_PATH_VERSION
  rebuildEditablePathObject(obj, true)
  return obj
}

export function isEditablePathObject(obj: unknown): obj is EditablePathObject {
  if (!(obj instanceof Path)) return false
  const editablePath = (obj as AnyFabricPath).editablePath
  return !!editablePath && (
    Array.isArray(editablePath.points) ||
    Array.isArray(editablePath.contours)
  )
}

export function getSelectableEditablePoints(obj: EditablePathObject) {
  const model = ensureEditablePathObject(obj)
  return flattenEditablePoints(model)
    .map(({ point, globalIndex }) => ({ point, index: globalIndex }))
    .filter(({ point }) => point.selectable !== false)
}

export function getEditableSegmentByPointSelection(obj: EditablePathObject, indices: number[]) {
  const model = ensureEditablePathObject(obj)
  const uniqueIndices = Array.from(new Set(indices))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b)
  if (uniqueIndices.length !== 2) return null
  const [firstIndex, secondIndex] = uniqueIndices
  const firstPointRef = resolveEditablePoint(model, firstIndex)
  const secondPointRef = resolveEditablePoint(model, secondIndex)
  if (!firstPointRef || !secondPointRef) return null
  if (firstPointRef.contourIndex !== secondPointRef.contourIndex) return null

  const contour = firstPointRef.contour
  const pointCount = contour.points.length
  if (pointCount < 2) return null
  if (contour.closed && pointCount === 2) return null

  const segments = getBuildSegments(contour)
  const contourStartIndices = getContourStartIndices(model)
  const contourStartIndex = contourStartIndices[firstPointRef.contourIndex] ?? 0
  const segmentIndex = segments.findIndex((segment) => {
    const fromGlobalIndex = contourStartIndex + segment.from
    const toGlobalIndex = contourStartIndex + segment.to
    return (
      (fromGlobalIndex === firstIndex && toGlobalIndex === secondIndex)
      || (fromGlobalIndex === secondIndex && toGlobalIndex === firstIndex)
    )
  })
  if (segmentIndex < 0) return null

  return buildEditableSegmentRef(model, firstPointRef.contourIndex, segmentIndex)
}

export type EditableAnchorHandleRefs = {
  /** 入柄所在段：段终点为该锚点，cubic 段取其 cp2，直线段无 cp（幻影位，拖拽时转曲线） */
  inSegmentRef: EditableSegmentRef | null
  /** 出柄所在段：段起点为该锚点，cubic 段取其 cp1，直线段无 cp（幻影位，拖拽时转曲线） */
  outSegmentRef: EditableSegmentRef | null
}

/**
 * 解析锚点两侧的控制柄所在段，供点位模式选中锚点后展示/拖拽控制柄使用。
 * 与边模式曲线柄语义一致：只要邻段存在就返回引用——cubic 段柄位取真实 cp，
 * 直线段没有 cp，柄显示在 1/3、2/3 幻影位，拖拽时经 setEditableSegmentControlPoint 转为曲线；
 * 开放轮廓的端点缺少入段或出段时对应侧返回 null（该侧没有可控制的曲线）。
 */
export function getEditableAnchorHandleRefs(
  obj: EditablePathObject,
  globalIndex: number
): EditableAnchorHandleRefs {
  const empty: EditableAnchorHandleRefs = { inSegmentRef: null, outSegmentRef: null }
  const model = ensureEditablePathObject(obj)
  const pointRef = resolveEditablePoint(model, globalIndex)
  if (!pointRef) return empty
  const segments = getBuildSegments(pointRef.contour)
  const resolveSegmentRef = (segmentIndex: number) => {
    if (segmentIndex < 0 || !segments[segmentIndex]) return null
    return buildEditableSegmentRef(model, pointRef.contourIndex, segmentIndex)
  }
  return {
    inSegmentRef: resolveSegmentRef(segments.findIndex((segment) => segment.to === pointRef.pointIndex)),
    outSegmentRef: resolveSegmentRef(segments.findIndex((segment) => segment.from === pointRef.pointIndex))
  }
}

function materializeContourSegments(contour: EditablePathContour) {
  return getBuildSegments(contour).map((segment) => buildSegmentToEditablePathSegment(segment))
}

function ensureContourSegments(contour: EditablePathContour) {
  if (!contour.segments.length) {
    contour.segments = materializeContourSegments(contour)
  }
  return contour.segments
}

function createDefaultCubicControlPoints(fromPoint: EditablePoint, toPoint: EditablePoint) {
  return {
    cp1: lerp(fromPoint, toPoint, 1 / 3),
    cp2: lerp(fromPoint, toPoint, 2 / 3)
  }
}

function getPointInParentPlane(obj: EditablePathObject, point: EditablePoint) {
  return new Point(point.x, point.y)
    .subtract(obj.pathOffset)
    .transform(obj.calcOwnMatrix())
}

function rebuildEditablePathObjectKeepingAnchor(
  obj: EditablePathObject,
  anchorPoint: EditablePoint | null,
  anchorPointInParentPlane: Point | null = anchorPoint ? getPointInParentPlane(obj, anchorPoint) : null
) {
  ensureEditablePathObject(obj)
  const path = buildEditablePathData(obj)
  ;(obj as any)._setPath((path.length ? path : [['M', 0, 0]]) as TSimplePathData, false)
  if (anchorPoint && anchorPointInParentPlane) {
    const diff = getPointInParentPlane(obj, anchorPoint).subtract(anchorPointInParentPlane)
    obj.left = (obj.left ?? 0) - diff.x
    obj.top = (obj.top ?? 0) - diff.y
  }
  obj.dirty = true
  obj.setCoords()
}

export function getPointRadius(obj: EditablePathObject, index: number) {
  ensureEditablePathObject(obj)
  return effectiveRadius(obj, index)
}

export type EditablePointEndpointInfo = {
  isEndpoint: boolean
  isStart?: boolean
  contourIndex?: number
  pointIndex?: number
}

export function getEditablePointEndpointInfo(obj: EditablePathObject, globalIndex: number): EditablePointEndpointInfo {
  const model = ensureEditablePathObject(obj)
  const ref = resolveEditablePoint(model, globalIndex)
  if (!ref || ref.contour.closed) return { isEndpoint: false }
  if (ref.contour.points.length < 2) return { isEndpoint: false }
  if (ref.pointIndex === 0) {
    return { isEndpoint: true, isStart: true, contourIndex: ref.contourIndex, pointIndex: ref.pointIndex }
  }
  if (ref.pointIndex === ref.contour.points.length - 1) {
    return { isEndpoint: true, isStart: false, contourIndex: ref.contourIndex, pointIndex: ref.pointIndex }
  }
  return { isEndpoint: false }
}

export function isEditablePointOpenEndpoint(obj: EditablePathObject, globalIndex: number) {
  return getEditablePointEndpointInfo(obj, globalIndex).isEndpoint
}

export function getEditablePointArrowHead(obj: EditablePathObject, globalIndex: number): ArrowHead | null {
  const model = ensureEditablePathObject(obj)
  const ref = resolveEditablePoint(model, globalIndex)
  if (!ref) return null
  return ref.point.arrowHead ? normalizeArrowHead(ref.point.arrowHead) : null
}

export function getEditablePointByIndex(obj: EditablePathObject, globalIndex: number): EditablePoint | null {
  const model = ensureEditablePathObject(obj)
  return resolveEditablePoint(model, globalIndex)?.point ?? null
}

export function pathHasSolidArrowHead(obj: EditablePathObject) {
  const model = ensureEditablePathObject(obj)
  for (const contour of model.contours) {
    if (contour.closed) continue
    const start = contour.points[0]?.arrowHead
    const end = contour.points[contour.points.length - 1]?.arrowHead
    if (start?.enabled && start.shape === 'solid') return true
    if (end?.enabled && end.shape === 'solid') return true
  }
  return false
}

export function setEditablePointsArrowHead(
  obj: EditablePathObject,
  indices: number[],
  partial: Partial<ArrowHead>
) {
  const model = ensureEditablePathObject(obj)
  let touched = false
  const seen = new Set<number>()
  const anchorIndex = Array.from(new Set(indices))
    .filter((globalIndex) => {
      const ref = resolveEditablePoint(model, globalIndex)
      return !!ref && !ref.contour.closed && ref.pointIndex === 0
    })[0] ?? Array.from(new Set(indices))[0] ?? 0
  indices.forEach((globalIndex) => {
    if (seen.has(globalIndex)) return
    seen.add(globalIndex)
    const ref = resolveEditablePoint(model, globalIndex)
    if (!ref || ref.contour.closed) return
    if (ref.contour.points.length < 2) return
    if (ref.pointIndex !== 0 && ref.pointIndex !== ref.contour.points.length - 1) return
    const current = ref.point.arrowHead ? normalizeArrowHead(ref.point.arrowHead) : createDefaultArrowHead()
    const next: ArrowHead = normalizeArrowHead({
      enabled: partial.enabled ?? current.enabled,
      shape: partial.shape ?? current.shape,
      angle: partial.angle ?? current.angle,
      length: partial.length ?? current.length
    })
    ref.point.arrowHead = next
    touched = true
  })
  if (touched) rebuildEditablePathObjectFromPoint(obj, anchorIndex)
}

export function setObjectCornerRadius(obj: EditablePathObject, radius: number) {
  ensureEditablePathObject(obj)
  obj.cornerRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0
  rebuildEditablePathObject(obj)
}

export function setPointCornerRadius(obj: EditablePathObject, index: number, radius: number) {
  const model = ensureEditablePathObject(obj)
  const next = Number.isFinite(radius) ? Math.max(0, radius) : 0
  const overrides = obj.cornerRadiusOverrides ?? Array.from({ length: getPointCount(model) }, () => null)
  if (index < 0 || index >= overrides.length) return
  overrides[index] = next
  obj.cornerRadiusOverrides = overrides
  rebuildEditablePathObject(obj)
}

export function setPointsCornerRadius(obj: EditablePathObject, indices: number[], radius: number) {
  const model = ensureEditablePathObject(obj)
  const next = Number.isFinite(radius) ? Math.max(0, radius) : 0
  const overrides = obj.cornerRadiusOverrides ?? Array.from({ length: getPointCount(model) }, () => null)
  const uniqueIndices = Array.from(new Set(indices))
  uniqueIndices.forEach((index) => {
    if (index >= 0 && index < overrides.length) {
      overrides[index] = next
    }
  })
  obj.cornerRadiusOverrides = overrides
  rebuildEditablePathObject(obj)
}

export function setEditableSegmentType(obj: EditablePathObject, segmentRef: EditableSegmentRef, type: EditablePathSegment['type']) {
  const liveSegmentRef = resolveEditableSegmentRef(obj, segmentRef)
  if (!liveSegmentRef) return
  const segments = ensureContourSegments(liveSegmentRef.contour)
  const segment = segments[liveSegmentRef.segmentIndex]
  if (!segment || segment.to !== liveSegmentRef.toPointIndex) return
  if (type === 'cubic') {
    const controlPoints = segment.cp1 && segment.cp2
      ? { cp1: clonePoint(segment.cp1), cp2: clonePoint(segment.cp2) }
      : createDefaultCubicControlPoints(liveSegmentRef.fromPoint, liveSegmentRef.toPoint)
    segments[liveSegmentRef.segmentIndex] = {
      type: 'cubic',
      to: segment.to,
      cp1: controlPoints.cp1,
      cp2: controlPoints.cp2
    }
  } else {
    segments[liveSegmentRef.segmentIndex] = {
      type: 'line',
      to: segment.to,
      cp1: segment.cp1 ? clonePoint(segment.cp1) : undefined,
      cp2: segment.cp2 ? clonePoint(segment.cp2) : undefined
    }
  }
  rebuildEditablePathObjectKeepingAnchor(obj, liveSegmentRef.fromPoint)
}

export function setEditableSegmentControlPoint(
  obj: EditablePathObject,
  segmentRef: EditableSegmentRef,
  controlPoint: 'cp1' | 'cp2',
  nextPoint: EditablePoint
) {
  const liveSegmentRef = resolveEditableSegmentRef(obj, segmentRef)
  if (!liveSegmentRef) return
  const segments = ensureContourSegments(liveSegmentRef.contour)
  const segment = segments[liveSegmentRef.segmentIndex]
  if (!segment || segment.to !== liveSegmentRef.toPointIndex) return
  let current: EditablePathSegment & { type: 'cubic' }
  if (segment.type === 'cubic') {
    current = segment
  } else {
    const defaults = createDefaultCubicControlPoints(liveSegmentRef.fromPoint, liveSegmentRef.toPoint)
    current = {
      type: 'cubic',
      to: segment.to,
      cp1: segment.cp1 ? clonePoint(segment.cp1) : defaults.cp1,
      cp2: segment.cp2 ? clonePoint(segment.cp2) : defaults.cp2
    }
  }
  segments[liveSegmentRef.segmentIndex] = {
    ...current,
    [controlPoint]: clonePoint(nextPoint)
  }
  rebuildEditablePathObjectKeepingAnchor(obj, liveSegmentRef.fromPoint)
}

function pointSegmentDistance(point: EditablePoint, fromPoint: EditablePoint, toPoint: EditablePoint) {
  const lineX = toPoint.x - fromPoint.x
  const lineY = toPoint.y - fromPoint.y
  const lengthSquared = lineX * lineX + lineY * lineY
  if (lengthSquared < 0.0001) return distance(point, fromPoint)
  const projection = ((point.x - fromPoint.x) * lineX + (point.y - fromPoint.y) * lineY) / lengthSquared
  const t = Math.max(0, Math.min(1, projection))
  return distance(point, {
    x: fromPoint.x + lineX * t,
    y: fromPoint.y + lineY * t
  })
}

function cubicPoint(
  fromPoint: EditablePoint,
  cp1: EditablePoint,
  cp2: EditablePoint,
  toPoint: EditablePoint,
  t: number
): EditablePoint {
  const inverse = 1 - t
  const inverse2 = inverse * inverse
  const inverse3 = inverse2 * inverse
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: inverse3 * fromPoint.x + 3 * inverse2 * t * cp1.x + 3 * inverse * t2 * cp2.x + t3 * toPoint.x,
    y: inverse3 * fromPoint.y + 3 * inverse2 * t * cp1.y + 3 * inverse * t2 * cp2.y + t3 * toPoint.y
  }
}

function cubicSegmentDistance(
  point: EditablePoint,
  fromPoint: EditablePoint,
  cp1: EditablePoint,
  cp2: EditablePoint,
  toPoint: EditablePoint,
  steps = 24
) {
  let minDistance = Math.min(distance(point, fromPoint), distance(point, toPoint))
  let previousPoint = fromPoint
  for (let index = 1; index <= steps; index += 1) {
    const currentPoint = cubicPoint(fromPoint, cp1, cp2, toPoint, index / steps)
    minDistance = Math.min(minDistance, pointSegmentDistance(point, previousPoint, currentPoint))
    previousPoint = currentPoint
  }
  return minDistance
}

export function getEditableSegmentByLocalPoint(
  obj: EditablePathObject,
  point: EditablePoint,
  tolerance = 6
) {
  const model = ensureEditablePathObject(obj)
  let bestMatch: { ref: EditableSegmentRef, distance: number } | null = null
  model.contours.forEach((contour, contourIndex) => {
    const segments = getBuildSegments(contour)
    segments.forEach((segment, segmentIndex) => {
      const fromPoint = contour.points[segment.from]
      const toPoint = contour.points[segment.to]
      if (!fromPoint || !toPoint) return
      const nextDistance = segment.type === 'cubic' && segment.cp1 && segment.cp2
        ? cubicSegmentDistance(point, fromPoint, segment.cp1, segment.cp2, toPoint)
        : pointSegmentDistance(point, fromPoint, toPoint)
      if (nextDistance > tolerance || (bestMatch && nextDistance >= bestMatch.distance)) return
      const ref = buildEditableSegmentRef(model, contourIndex, segmentIndex)
      if (!ref) return
      bestMatch = { ref, distance: nextDistance }
    })
  })
  return bestMatch?.ref ?? null
}

export function getEditableSegments(obj: EditablePathObject): EditableSegmentRef[] {
  const model = ensureEditablePathObject(obj)
  const result: EditableSegmentRef[] = []
  model.contours.forEach((contour, contourIndex) => {
    const segments = getBuildSegments(contour)
    segments.forEach((_segment, segmentIndex) => {
      const ref = buildEditableSegmentRef(model, contourIndex, segmentIndex)
      if (ref) result.push(ref)
    })
  })
  return result
}

export function getEditableSegmentMidpoint(segmentRef: EditableSegmentRef): EditablePoint {
  const segment = segmentRef.segment
  if (segment && segment.type === 'cubic' && segment.cp1 && segment.cp2) {
    return cubicPoint(segmentRef.fromPoint, segment.cp1, segment.cp2, segmentRef.toPoint, 0.5)
  }
  return lerp(segmentRef.fromPoint, segmentRef.toPoint, 0.5)
}

export function isSameEditableSegmentRef(
  a: EditableSegmentRef | null | undefined,
  b: EditableSegmentRef | null | undefined
) {
  if (!a || !b) return false
  return a.contourIndex === b.contourIndex
    && a.segmentIndex === b.segmentIndex
    && a.fromPointIndex === b.fromPointIndex
    && a.toPointIndex === b.toPointIndex
}

export function moveEditablePoint(obj: EditablePathObject, index: number, nextPoint: EditablePoint) {
  const model = ensureEditablePathObject(obj)
  const pointRef = resolveEditablePoint(model, index)
  if (!pointRef) return
  const { contour, pointIndex, point } = pointRef
  const anchorIndex = contour.points.length > 1
    ? (pointIndex > 0 ? pointIndex : contour.points.length) - 1
    : -1
  const anchorPoint = anchorIndex >= 0 ? contour.points[anchorIndex] : null
  const anchorPointInParentPlane = anchorPoint ? getPointInParentPlane(obj, anchorPoint) : null
  point.x = nextPoint.x
  point.y = nextPoint.y
  rebuildEditablePathObjectKeepingAnchor(obj, anchorPoint, anchorPointInParentPlane)
}

/**
 * 批量平移多个 anchor 点位。
 * - 以 leadIndex 这一点的 (leadNextPoint - 当前 local 坐标) 计算统一 delta
 * - 对所有 indices 中存在的 anchor 点应用同一个 delta
 * - 不修改任何 segment 的 cp1 / cp2 控制点
 * - 整批修改完只 rebuild 一次 path
 * - 优先根据未移动的点在父平面的位置补偿 obj.left / obj.top，保证其它点位保持不动
 * - 如果所有点都被移动，则回退到 lead point 补偿，保证被抓住的点跟手
 */
export function moveEditablePoints(
  obj: EditablePathObject,
  indices: number[],
  leadIndex: number,
  leadNextPoint: EditablePoint
) {
  const model = ensureEditablePathObject(obj)
  const leadRef = resolveEditablePoint(model, leadIndex)
  if (!leadRef) return
  const uniqueIndices = Array.from(new Set(indices))
    .filter((index) => Number.isInteger(index) && index >= 0)
  const refs: EditablePointRef[] = []
  const seenPoints = new Set<EditablePoint>()
  for (const index of uniqueIndices) {
    const ref = resolveEditablePoint(model, index)
    if (!ref) continue
    if (seenPoints.has(ref.point)) continue
    seenPoints.add(ref.point)
    refs.push(ref)
  }
  if (!seenPoints.has(leadRef.point)) {
    refs.push(leadRef)
    seenPoints.add(leadRef.point)
  }
  const stationaryRef = flattenEditablePoints(model)
    .find((ref) => !seenPoints.has(ref.point)) ?? null
  const dx = leadNextPoint.x - leadRef.point.x
  const dy = leadNextPoint.y - leadRef.point.y
  if (dx === 0 && dy === 0) return
  // rebuild path 会更新 pathOffset；有未移动点时记录它的父平面位置，避免补偿时带动未选点。
  // 如果所有点均被移动，则记录 lead point 的目标父平面位置，让被抓住的点继续跟手。
  const anchorBefore = stationaryRef
    ? getPointInParentPlane(obj, stationaryRef.point)
    : getPointInParentPlane(obj, leadNextPoint)
  for (const ref of refs) {
    ref.point.x += dx
    ref.point.y += dy
  }
  rebuildEditablePathObjectKeepingAnchor(obj, stationaryRef?.point ?? leadRef.point, anchorBefore)
}

export function editablePointToLocalObjectPoint(obj: EditablePathObject, index: number) {
  const model = ensureEditablePathObject(obj)
  const point = resolveEditablePoint(model, index)?.point
  if (!point) return new Point(0, 0)
  return new Point(point.x, point.y).subtract(obj.pathOffset)
}

export function rebuildEditablePathObject(obj: EditablePathObject, adjustPosition = false) {
  ensureEditablePathObject(obj)
  const path = buildEditablePathData(obj)
  ;(obj as any)._setPath((path.length ? path : [['M', 0, 0]]) as TSimplePathData, adjustPosition)
  obj.dirty = true
  obj.setCoords()
}

export function rebuildEditablePathObjectFromPoint(obj: EditablePathObject, globalIndex: number) {
  const anchorPoint = getEditablePointByIndex(obj, globalIndex)
  rebuildEditablePathObjectKeepingAnchor(obj, anchorPoint)
}

export function polygonEditablePath(points: EditablePoint[], closed = true): EditablePathModel {
  return {
    contours: [{
      closed,
      points: points.map(clonePoint),
      segments: []
    }]
  }
}

export function pathEditableModel(points: EditablePoint[], segments: EditablePathSegment[], closed = true): EditablePathModel {
  return {
    contours: [{
      closed,
      points: points.map(clonePoint),
      segments: segments.map(cloneSegment)
    }]
  }
}

function finalizeParsedContour(contours: EditablePathContour[], contour: EditablePathContour | null) {
  if (!contour || !contour.points.length) return
  if (contour.closed && contour.points.length > 1) {
    const lastPointIndex = contour.points.length - 1
    const lastPoint = contour.points[lastPointIndex]
    const firstPoint = contour.points[0]
    if (samePoint(lastPoint, firstPoint)) {
      const lastSegment = contour.segments[contour.segments.length - 1]
      if (lastSegment?.to === lastPointIndex) {
        lastSegment.to = 0
        contour.points.pop()
      }
    } else {
      contour.segments.push({ type: 'line', to: 0 })
    }
  }
  contours.push(cloneContour(contour))
}

function quadraticToCubic(from: EditablePoint, control: EditablePoint, to: EditablePoint) {
  return {
    cp1: {
      x: from.x + ((control.x - from.x) * 2) / 3,
      y: from.y + ((control.y - from.y) * 2) / 3
    },
    cp2: {
      x: to.x + ((control.x - to.x) * 2) / 3,
      y: to.y + ((control.y - to.y) * 2) / 3
    }
  }
}

export function editablePathFromPathData(pathData: TSimplePathData): EditablePathModel | null {
  const contours: EditablePathContour[] = []
  let currentContour: EditablePathContour | null = null

  for (const segment of pathData) {
    switch (segment[0]) {
      case 'M':
        finalizeParsedContour(contours, currentContour)
        currentContour = {
          closed: false,
          points: [{ x: segment[1], y: segment[2] }],
          segments: []
        }
        break
      case 'L':
        if (!currentContour?.points.length) break
        currentContour.points.push({ x: segment[1], y: segment[2] })
        currentContour.segments.push({ type: 'line', to: currentContour.points.length - 1 })
        break
      case 'C':
        if (!currentContour?.points.length) break
        currentContour.points.push({ x: segment[5], y: segment[6] })
        currentContour.segments.push({
          type: 'cubic',
          cp1: { x: segment[1], y: segment[2] },
          cp2: { x: segment[3], y: segment[4] },
          to: currentContour.points.length - 1
        })
        break
      case 'Q':
        if (!currentContour?.points.length) break
        const from = currentContour.points[currentContour.points.length - 1]
        const control = { x: segment[1], y: segment[2] }
        const to = { x: segment[3], y: segment[4] }
        currentContour.points.push(to)
        currentContour.segments.push({
          type: 'cubic',
          ...quadraticToCubic(from, control, to),
          to: currentContour.points.length - 1
        })
        break
      case 'Z':
        if (!currentContour) break
        currentContour.closed = true
        finalizeParsedContour(contours, currentContour)
        currentContour = null
        break
    }
  }

  finalizeParsedContour(contours, currentContour)
  return contours.length ? { contours } : null
}

// ── 圆角折叠：检测并还原布尔运算中被“打碎”的圆角结构 ──

type CollapsedRoundedCorner = {
  point: EditablePoint
  radius: number
  outIndex: number
}

function subtractPoints(a: EditablePoint, b: EditablePoint): EditablePoint {
  return {
    x: a.x - b.x,
    y: a.y - b.y
  }
}

function dotProduct(a: EditablePoint, b: EditablePoint) {
  return a.x * b.x + a.y * b.y
}

function crossProduct(a: EditablePoint, b: EditablePoint) {
  return a.x * b.y - a.y * b.x
}

function pointLineDistance(point: EditablePoint, lineStart: EditablePoint, lineEnd: EditablePoint) {
  const line = subtractPoints(lineEnd, lineStart)
  const lineLength = Math.hypot(line.x, line.y)
  if (lineLength < 0.0001) return distance(point, lineStart)
  const toPoint = subtractPoints(point, lineStart)
  return Math.abs(crossProduct(line, toPoint)) / lineLength
}

function lineIntersection(
  a1: EditablePoint,
  a2: EditablePoint,
  b1: EditablePoint,
  b2: EditablePoint
): EditablePoint | null {
  const da = subtractPoints(a2, a1)
  const db = subtractPoints(b2, b1)
  const denominator = crossProduct(da, db)
  if (Math.abs(denominator) < 0.0001) return null
  const delta = subtractPoints(b1, a1)
  const t = crossProduct(delta, db) / denominator
  return {
    x: a1.x + da.x * t,
    y: a1.y + da.y * t
  }
}

function angleBetweenVectors(v1: EditablePoint, v2: EditablePoint): number {
  const dot = dotProduct(v1, v2)
  const len1 = Math.hypot(v1.x, v1.y)
  const len2 = Math.hypot(v2.x, v2.y)
  if (len1 < 0.0001 || len2 < 0.0001) return Math.PI
  const cos = Math.max(-1, Math.min(1, dot / (len1 * len2)))
  return Math.acos(cos)
}

function roundedCornerTolerance(radius: number, hintedRadius: number) {
  const reference = Math.max(radius, hintedRadius, 1)
  return Math.max(0.5, reference * 0.2)
}

function detectCollapsedRoundedCorner(
  prevPoint: EditablePoint,
  inPoint: EditablePoint,
  segment: BuildSegment,
  outPoint: EditablePoint,
  nextPoint: EditablePoint,
  hintedRadius: number
): CollapsedRoundedCorner | null {
  if (segment.type !== 'cubic' || !segment.cp1 || !segment.cp2) return null

  const corner = lineIntersection(inPoint, segment.cp1, outPoint, segment.cp2)
  if (!corner) return null

  const inRadius = distance(inPoint, corner)
  const outRadius = distance(outPoint, corner)
  const radius = (inRadius + outRadius) / 2
  if (radius < 0.0001) return null

  const tolerance = roundedCornerTolerance(radius, hintedRadius)
  if (Math.abs(inRadius - outRadius) > tolerance) return null
  if (pointLineDistance(prevPoint, inPoint, corner) > tolerance) return null
  if (pointLineDistance(nextPoint, outPoint, corner) > tolerance) return null

  const expectedCp1 = lerp(inPoint, corner, KAPPA)
  const expectedCp2 = lerp(outPoint, corner, KAPPA)
  if (distance(expectedCp1, segment.cp1) > tolerance) return null
  if (distance(expectedCp2, segment.cp2) > tolerance) return null

  const incomingDirection = subtractPoints(inPoint, prevPoint)
  const cornerFromInPoint = subtractPoints(corner, inPoint)
  const outgoingDirection = subtractPoints(outPoint, nextPoint)
  const cornerFromOutPoint = subtractPoints(corner, outPoint)
  if (dotProduct(incomingDirection, cornerFromInPoint) <= 0) return null
  if (dotProduct(outgoingDirection, cornerFromOutPoint) <= 0) return null

  const angle = angleBetweenVectors(subtractPoints(inPoint, corner), subtractPoints(outPoint, corner))
  if (angle <= 0.1 || angle >= Math.PI - 0.1) return null

  const snappedRadius = hintedRadius > 0 && Math.abs(radius - hintedRadius) <= tolerance
    ? hintedRadius
    : radius

  return {
    point: {
      x: corner.x,
      y: corner.y,
      selectable: inPoint.selectable === false || outPoint.selectable === false ? false : inPoint.selectable
    },
    radius: snappedRadius,
    outIndex: segment.to
  }
}

function cloneCollapsedPoint(
  points: EditablePoint[],
  collapsedCorners: Map<number, CollapsedRoundedCorner>,
  index: number
) {
  const collapsed = collapsedCorners.get(index)
  return collapsed ? clonePoint(collapsed.point) : clonePoint(points[index])
}

export function collapseRoundedCornersInContour(
  contour: EditablePathContour,
  defaultRadius: number = 0
): { cornerOverrides: Map<number, number>, newContour: EditablePathContour } {
  const segments = getBuildSegments(contour)
  if (!segments.length || contour.points.length < 3) {
    return { cornerOverrides: new Map(), newContour: cloneContour(contour) }
  }

  const hintedRadius = Number.isFinite(defaultRadius) ? Math.max(0, defaultRadius) : 0
  const collapsedCorners = new Map<number, CollapsedRoundedCorner>()
  const skippedPointIndices = new Set<number>()

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment.type !== 'cubic') continue
    if (!contour.closed && (index === 0 || index === segments.length - 1)) continue

    const prevIndex = index > 0 ? index - 1 : segments.length - 1
    const nextIndex = index + 1 < segments.length ? index + 1 : 0
    const prevSegment = segments[prevIndex]
    const nextSegment = segments[nextIndex]
    if (prevSegment.type !== 'line' || nextSegment.type !== 'line') continue

    const prevPoint = contour.points[prevSegment.from]
    const inPoint = contour.points[segment.from]
    const outPoint = contour.points[segment.to]
    const nextPoint = contour.points[nextSegment.to]
    if (!prevPoint || !inPoint || !outPoint || !nextPoint) continue

    const collapsed = detectCollapsedRoundedCorner(
      prevPoint,
      inPoint,
      segment,
      outPoint,
      nextPoint,
      hintedRadius
    )
    if (!collapsed) continue

    collapsedCorners.set(segment.from, collapsed)
    skippedPointIndices.add(segment.to)
  }

  if (!collapsedCorners.size) {
    return { cornerOverrides: new Map(), newContour: cloneContour(contour) }
  }

  const segmentIndexByFrom = new Map<number, number>()
  segments.forEach((segment, index) => {
    segmentIndexByFrom.set(segment.from, index)
  })

  const startIndex = contour.closed
    ? contour.points.findIndex((_point, index) => !skippedPointIndices.has(index))
    : 0
  if (startIndex < 0) {
    return { cornerOverrides: new Map(), newContour: cloneContour(contour) }
  }

  const newPoints: EditablePoint[] = [cloneCollapsedPoint(contour.points, collapsedCorners, startIndex)]
  const newSegments: EditablePathSegment[] = []
  const cornerOverrides = new Map<number, number>()
  const startCorner = collapsedCorners.get(startIndex)
  if (startCorner) {
    cornerOverrides.set(0, startCorner.radius)
  }

  let currentIndex = startIndex
  const maxSteps = segments.length + 1

  for (let step = 0; step < maxSteps; step += 1) {
    const currentSegmentIndex = segmentIndexByFrom.get(currentIndex)
    if (currentSegmentIndex == null) {
      if (contour.closed) {
        return { cornerOverrides: new Map(), newContour: cloneContour(contour) }
      }
      return {
        cornerOverrides,
        newContour: {
          closed: false,
          points: newPoints,
          segments: newSegments
        }
      }
    }

    const currentCorner = collapsedCorners.get(currentIndex)
    const outgoingSegmentIndex = currentCorner
      ? (currentSegmentIndex + 1) % segments.length
      : currentSegmentIndex
    const outgoingSegment = segments[outgoingSegmentIndex]
    if (!outgoingSegment) {
      return { cornerOverrides: new Map(), newContour: cloneContour(contour) }
    }

    if (currentCorner && outgoingSegment.from !== currentCorner.outIndex) {
      return { cornerOverrides: new Map(), newContour: cloneContour(contour) }
    }

    const nextIndex = outgoingSegment.to
    const closesContour = contour.closed && nextIndex === startIndex
    newSegments.push(outgoingSegment.type === 'cubic'
      ? {
          type: 'cubic',
          cp1: clonePoint(outgoingSegment.cp1!),
          cp2: clonePoint(outgoingSegment.cp2!),
          to: closesContour ? 0 : newPoints.length
        }
      : {
          type: 'line',
          to: closesContour ? 0 : newPoints.length
        })

    if (closesContour) {
      return {
        cornerOverrides,
        newContour: {
          closed: true,
          points: newPoints,
          segments: newSegments
        }
      }
    }

    const nextPoint = cloneCollapsedPoint(contour.points, collapsedCorners, nextIndex)
    newPoints.push(nextPoint)
    const nextCorner = collapsedCorners.get(nextIndex)
    if (nextCorner) {
      cornerOverrides.set(newPoints.length - 1, nextCorner.radius)
    }
    currentIndex = nextIndex
  }

  return { cornerOverrides: new Map(), newContour: cloneContour(contour) }
}

export function collapseRoundedCorners(
  model: EditablePathModel,
  defaultRadius: number = 0
): { model: EditablePathModel, overridesByContour: Map<number, Map<number, number>> } {
  const overridesByContour = new Map<number, Map<number, number>>()
  const newContours: EditablePathContour[] = []

  for (let c = 0; c < model.contours.length; c += 1) {
    const contour = model.contours[c]
    const { cornerOverrides, newContour } = collapseRoundedCornersInContour(contour, defaultRadius)
    if (cornerOverrides.size > 0) {
      overridesByContour.set(c, cornerOverrides)
    }
    newContours.push(newContour)
  }

  return {
    model: { contours: newContours },
    overridesByContour
  }
}

// ── 锚点插入/删除：贝塞尔分割与段合并的纯几何实现 ──

export type SegmentClosestParameter = {
  /** 最近点对应的段参数，范围 [0, 1] */
  t: number
  /** 最近点坐标 */
  point: EditablePoint
}

export type CubicBezierSplit = {
  /** 分割点（新锚点位置） */
  point: EditablePoint
  /** 前半段控制柄（起点不变，终点为分割点） */
  left: { cp1: EditablePoint, cp2: EditablePoint }
  /** 后半段控制柄（起点为分割点，终点不变） */
  right: { cp1: EditablePoint, cp2: EditablePoint }
}

/**
 * 求轮廓可保留的最少锚点数量：闭合轮廓 3 点、开放轮廓 2 点。
 */
export function getContourMinPointCount(contour: EditablePathContour) {
  return contour.closed ? 3 : 2
}

/**
 * 求三次贝塞尔在参数 t 处的点坐标（贝塞尔多项式直接求值）。
 */
export function evalCubicBezierAt(
  from: EditablePoint,
  cp1: EditablePoint,
  cp2: EditablePoint,
  to: EditablePoint,
  t: number
): EditablePoint {
  return cubicPoint(from, cp1, cp2, to, t)
}

/**
 * 用 de Casteljau 算法在参数 t 处分割三次贝塞尔：
 * 每阶把控制多边形各边按 t 分位取点，得到的两个子控制多边形
 * （from → q0 → r0 → point 与 point → r1 → q2 → to）描绘的曲线与原曲线完全一致。
 */
export function splitCubicBezierAt(
  from: EditablePoint,
  cp1: EditablePoint,
  cp2: EditablePoint,
  to: EditablePoint,
  t: number
): CubicBezierSplit {
  const clamped = Math.min(1, Math.max(0, t))
  // 一阶细分：三条边各取 t 分位点
  const q0 = lerp(from, cp1, clamped)
  const q1 = lerp(cp1, cp2, clamped)
  const q2 = lerp(cp2, to, clamped)
  // 二阶细分：两条边再取 t 分位点
  const r0 = lerp(q0, q1, clamped)
  const r1 = lerp(q1, q2, clamped)
  // 三阶细分：分割点本身
  const point = lerp(r0, r1, clamped)
  return {
    point,
    left: { cp1: q0, cp2: r0 },
    right: { cp1: r1, cp2: q2 }
  }
}

/**
 * 直线段按参数 t 线性插值取点；t 超出 [0, 1] 时钳制到端点。
 */
export function lerpPointOnLine(from: EditablePoint, to: EditablePoint, t: number): EditablePoint {
  return lerp(from, to, Math.min(1, Math.max(0, t)))
}

/**
 * 点到直线段的最近点：正交投影并钳制到 [0, 1]；退化线段（零长度）返回起点。
 */
export function getClosestParameterOnLineSegment(
  target: EditablePoint,
  from: EditablePoint,
  to: EditablePoint
): SegmentClosestParameter {
  const lineX = to.x - from.x
  const lineY = to.y - from.y
  const lengthSquared = lineX * lineX + lineY * lineY
  if (lengthSquared < 1e-8) {
    return { t: 0, point: clonePoint(from) }
  }
  const projection = ((target.x - from.x) * lineX + (target.y - from.y) * lineY) / lengthSquared
  const t = Math.min(1, Math.max(0, projection))
  return { t, point: lerp(from, to, t) }
}

/**
 * 点到三次贝塞尔段的最近点：先按 steps 均匀采样取粗解，再在粗解附近两轮局部加密细化。
 * 采样法对锚点插入场景精度足够，且避免解一元四次方程的复杂度。
 */
export function getClosestParameterOnCubicSegment(
  target: EditablePoint,
  from: EditablePoint,
  cp1: EditablePoint,
  cp2: EditablePoint,
  to: EditablePoint,
  steps = 36
): SegmentClosestParameter {
  const sampleDistance = (t: number) => distance(target, cubicPoint(from, cp1, cp2, to, t))
  let bestT = 0
  let bestDistance = sampleDistance(0)
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps
    const nextDistance = sampleDistance(t)
    if (nextDistance < bestDistance) {
      bestDistance = nextDistance
      bestT = t
    }
  }
  // 局部细化：在当前最佳 t 左右各一个采样步长的窗口内加密采样，逐轮收缩窗口
  let windowHalf = 1 / steps
  for (let round = 0; round < 2; round += 1) {
    const lower = Math.max(0, bestT - windowHalf)
    const upper = Math.min(1, bestT + windowHalf)
    const subdivisions = 12
    for (let index = 1; index < subdivisions; index += 1) {
      const t = lower + ((upper - lower) * index) / subdivisions
      const nextDistance = sampleDistance(t)
      if (nextDistance < bestDistance) {
        bestDistance = nextDistance
        bestT = t
      }
    }
    windowHalf /= subdivisions
  }
  return { t: bestT, point: cubicPoint(from, cp1, cp2, to, bestT) }
}

/**
 * 查询轮廓指定段上离目标点最近的参数位置；自动区分曲线段（采样最近点）与直线段（投影）。
 */
export function getContourSegmentParameterAt(
  contour: EditablePathContour,
  segmentIndex: number,
  target: EditablePoint
): SegmentClosestParameter | null {
  const buildSegment = getBuildSegments(contour)[segmentIndex]
  if (!buildSegment) return null
  const from = contour.points[buildSegment.from]
  const to = contour.points[buildSegment.to]
  if (!from || !to) return null
  return buildSegment.type === 'cubic' && buildSegment.cp1 && buildSegment.cp2
    ? getClosestParameterOnCubicSegment(target, from, buildSegment.cp1, buildSegment.cp2, to)
    : getClosestParameterOnLineSegment(target, from, to)
}

/**
 * 在轮廓指定段的参数 t 处插入新锚点（就地修改 contour），返回新锚点及其局部索引。
 * - 曲线段按 de Casteljau 分割，两段控制柄保证曲线形状不变；
 * - 直线段线性插值；
 * - t 钳制到 (0.001, 0.999)，避免新锚点与端点重合产生退化段；
 * - 闭合轮廓绕回起点的收尾段插入时新锚点直接追加到点数组末尾，不影响既有点索引。
 */
export function insertEditablePointIntoContour(
  contour: EditablePathContour,
  segmentIndex: number,
  t: number
): { point: EditablePoint, pointIndex: number } | null {
  const segments = ensureContourSegments(contour)
  const buildSegment = getBuildSegments(contour)[segmentIndex]
  if (!buildSegment) return null
  const from = contour.points[buildSegment.from]
  const to = contour.points[buildSegment.to]
  if (!from || !to) return null
  const clampedT = Math.min(0.999, Math.max(0.001, t))

  let newPoint: EditablePoint
  let firstSegment: EditablePathSegment
  let secondSegment: EditablePathSegment
  if (buildSegment.type === 'cubic' && buildSegment.cp1 && buildSegment.cp2) {
    const split = splitCubicBezierAt(from, buildSegment.cp1, buildSegment.cp2, to, clampedT)
    newPoint = split.point
    firstSegment = { type: 'cubic', cp1: split.left.cp1, cp2: split.left.cp2, to: 0 }
    secondSegment = { type: 'cubic', cp1: split.right.cp1, cp2: split.right.cp2, to: 0 }
  } else {
    newPoint = lerpPointOnLine(from, to, clampedT)
    firstSegment = { type: 'line', to: 0 }
    secondSegment = { type: 'line', to: 0 }
  }

  if (contour.closed && buildSegment.to === 0) {
    const newPointIndex = contour.points.length
    contour.points.push(newPoint)
    firstSegment.to = newPointIndex
    secondSegment.to = 0
    segments[segmentIndex] = firstSegment
    segments.splice(segmentIndex + 1, 0, secondSegment)
    return { point: newPoint, pointIndex: newPointIndex }
  }

  const insertAt = buildSegment.to
  contour.points.splice(insertAt, 0, newPoint)
  // 所有指向插入位及之后的段终点索引 +1，维持点索引映射一致
  segments.forEach((segment) => {
    if (segment.to >= insertAt) segment.to += 1
  })
  firstSegment.to = insertAt
  secondSegment.to = insertAt + 1
  segments.splice(segmentIndex, 1, firstSegment, secondSegment)
  return { point: newPoint, pointIndex: insertAt }
}

/**
 * 把一段"存活锚点 → 若干被删锚点 → 存活锚点"的段链合并为一段。
 * 控制柄策略：合并段的 cp1 取链路第一段的 cp2（被删点一侧的入柄）、cp2 取最后一段的 cp1（被删点另一侧的出柄），
 * 使合并段尽量保留被删锚点附近的走向；某一侧为直线段（无柄）时，用链路端部被删锚点的位置充当该侧柄，
 * 仍能保持两端点的切线方向；整条链路均为直线段时合并为直线段。
 */
function buildMergedContourSegment(
  chain: BuildSegment[],
  points: EditablePoint[],
  toNewIndex: number
): EditablePathSegment {
  const first = chain[0]
  const last = chain[chain.length - 1]
  const isCubic = (segment: BuildSegment): segment is BuildSegment & { type: 'cubic' } =>
    segment.type === 'cubic' && !!segment.cp1 && !!segment.cp2
  if (chain.length === 1 && isCubic(first)) {
    return { type: 'cubic', cp1: clonePoint(first.cp1), cp2: clonePoint(first.cp2), to: toNewIndex }
  }
  const allLines = chain.every((segment) => !isCubic(segment))
  if (allLines) {
    return { type: 'line', to: toNewIndex }
  }
  // 链路第一段的终点（第一个被删锚点）：其所在侧为直线段时充当 cp1，保持起点切线
  const firstDeletedPoint = points[first.to]
  const cp1 = isCubic(first)
    ? clonePoint(first.cp2)
    : { x: firstDeletedPoint.x, y: firstDeletedPoint.y }
  // 链路最后一段的起点（最后一个被删锚点）：其所在侧为直线段时充当 cp2，保持终点切线
  const lastDeletedPoint = points[last.from]
  const cp2 = isCubic(last)
    ? clonePoint(last.cp1)
    : { x: lastDeletedPoint.x, y: lastDeletedPoint.y }
  return { type: 'cubic', cp1, cp2, to: toNewIndex }
}

/**
 * 从轮廓中删除一批锚点并把被删点两侧的段合并为一段（就地修改 contour）。
 * - 违反最少点数约束（闭合 3 点 / 开放 2 点）时不做任何修改并返回 false；
 * - 支持一次删除多个（含相邻）锚点：被删链路整体合并为一段；
 * - 存活锚点保留原有顺序（闭合轮廓从最小索引的存活点起沿环排列）。
 */
export function removeEditablePointsFromContour(
  contour: EditablePathContour,
  pointIndices: number[]
): boolean {
  const points = contour.points
  const deleteSet = new Set(
    pointIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < points.length)
  )
  if (!deleteSet.size) return false
  if (points.length - deleteSet.size < getContourMinPointCount(contour)) return false

  const build = getBuildSegments(contour)
  const nextPoints: EditablePoint[] = []
  const nextIndexByOld = new Map<number, number>()
  points.forEach((point, index) => {
    if (deleteSet.has(index)) return
    nextIndexByOld.set(index, nextPoints.length)
    nextPoints.push(point)
  })

  // 每个点的出段索引（物化后的段链 from 唯一，可放心建映射）
  const outIndexByFrom = new Map<number, number>()
  build.forEach((segment, index) => {
    outIndexByFrom.set(segment.from, index)
  })

  const survivingList = Array.from(nextIndexByOld.keys())
  const nextSegments: EditablePathSegment[] = []
  for (let index = 0; index < survivingList.length; index += 1) {
    const fromOld = survivingList[index]
    const isLastSurviving = index === survivingList.length - 1
    // 开放轮廓最后一个存活点是终点，没有出段；闭合轮廓则绕回第一个存活点
    if (!contour.closed && isLastSurviving) break
    const toOld = contour.closed
      ? survivingList[(index + 1) % survivingList.length]
      : survivingList[index + 1]
    const chain: BuildSegment[] = []
    let cursor = fromOld
    // 沿出段链走到下一个存活点；guard 防御脏数据导致的死循环
    let guard = 0
    while (cursor !== toOld && guard <= points.length) {
      guard += 1
      const segmentIndex = outIndexByFrom.get(cursor)
      if (segmentIndex == null) break
      chain.push(build[segmentIndex])
      cursor = build[segmentIndex].to
    }
    if (!chain.length || cursor !== toOld) return false
    nextSegments.push(buildMergedContourSegment(chain, points, nextIndexByOld.get(toOld) ?? 0))
  }

  contour.points = nextPoints
  contour.segments = nextSegments
  return true
}

/**
 * 在路径对象的指定段上插入锚点：分割段保持曲线形状，圆角覆盖数组同步插入空位并重建路径。
 * 返回新锚点的全局索引，段引用失效或插入失败时返回 null。
 */
export function insertEditablePointOnObjectSegment(
  obj: EditablePathObject,
  segmentRef: EditableSegmentRef,
  t: number
): number | null {
  // resolveEditableSegmentRef 内部已完成 ensureEditablePathObject，
  // 这里不能再重复 ensure（会重新克隆模型导致后续修改落到游离副本上）
  const liveSegmentRef = resolveEditableSegmentRef(obj, segmentRef)
  if (!liveSegmentRef) return null
  // 目标轮廓之前的点数不受本次插入影响，可安全作为全局索引基准
  const contourStartIndex = getContourStartIndices(obj.editablePath as EditablePathModel)[liveSegmentRef.contourIndex] ?? 0
  const inserted = insertEditablePointIntoContour(liveSegmentRef.contour, liveSegmentRef.segmentIndex, t)
  if (!inserted) return null
  const overrides = Array.isArray(obj.cornerRadiusOverrides) ? [...obj.cornerRadiusOverrides] : []
  overrides.splice(contourStartIndex + inserted.pointIndex, 0, null)
  obj.cornerRadiusOverrides = overrides
  rebuildEditablePathObjectKeepingAnchor(obj, inserted.point)
  return contourStartIndex + inserted.pointIndex
}

/**
 * 从路径对象删除一批锚点（支持跨轮廓多选）：相邻段合并、圆角覆盖数组同步收缩并重建路径。
 * 任一轮廓低于最少点数即整体失败返回 false，不做任何修改，保证多选删除的原子性。
 */
export function removeEditablePointsFromObject(obj: EditablePathObject, indices: number[]): boolean {
  const model = ensureEditablePathObject(obj)
  const uniqueIndices = Array.from(new Set(indices))
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b)
  if (!uniqueIndices.length) return false

  // 按轮廓分组本地索引；任一轮廓越界或低于最少点数即整体失败
  const localIndicesByContour = new Map<number, number[]>()
  for (const globalIndex of uniqueIndices) {
    const ref = resolveEditablePoint(model, globalIndex)
    if (!ref) return false
    const list = localIndicesByContour.get(ref.contourIndex) ?? []
    list.push(ref.pointIndex)
    localIndicesByContour.set(ref.contourIndex, list)
  }
  for (const [contourIndex, localIndices] of localIndicesByContour) {
    const contour = model.contours[contourIndex]
    if (!contour || contour.points.length - localIndices.length < getContourMinPointCount(contour)) {
      return false
    }
  }

  // 以受影响轮廓中第一个未删除锚点为位置基准，保证重建后其它点在画布上保持不动
  const deletedGlobal = new Set(uniqueIndices)
  let anchorPoint: EditablePoint | null = null
  for (const [contourIndex, localIndices] of localIndicesByContour) {
    const contour = model.contours[contourIndex]
    const localDeleted = new Set(localIndices)
    const survivor = contour?.points.find((_point, index) => !localDeleted.has(index))
    if (survivor) {
      anchorPoint = survivor
      break
    }
  }
  if (!anchorPoint) {
    anchorPoint = flattenEditablePoints(model)
      .find((ref) => !deletedGlobal.has(ref.globalIndex))?.point ?? null
  }
  if (!anchorPoint) return false

  let changed = false
  for (const [contourIndex, localIndices] of localIndicesByContour) {
    const contour = model.contours[contourIndex]
    if (contour && removeEditablePointsFromContour(contour, localIndices)) {
      changed = true
    }
  }
  if (!changed) return false

  // 按全局索引过滤被删锚点的圆角覆盖，保持其余覆盖与锚点的对应关系
  obj.cornerRadiusOverrides = (obj.cornerRadiusOverrides ?? [])
    .filter((_value, index) => !deletedGlobal.has(index))

  rebuildEditablePathObjectKeepingAnchor(obj, anchorPoint)
  return true
}
