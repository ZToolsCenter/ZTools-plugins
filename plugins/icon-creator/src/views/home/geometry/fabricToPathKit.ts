import { ActiveSelection, Circle, FabricImage, FabricObject, Group, Line, Path, Polygon, Rect, Textbox, Triangle, util } from 'fabric'
import { getPathKit, type PathKitApi, type PathKitPath } from './pathkit'
import { applyDefaultFillGradientMetadata, cloneFillGradientStops, type FillGradientStop, type FillGradientType } from '../fabric/objectMetadata'

type TSimplePathData = Array<
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Q', number, number, number, number]
  | ['Z']
>

type AnyFabricObject = FabricObject & Record<string, any>
type PointLike = { x: number; y: number }

export type FabricBooleanGeometrySource = 'contour' | 'stroke-area'

export type FabricBooleanStyleSnapshot = {
  fill: AnyFabricObject['fill']
  stroke: AnyFabricObject['stroke']
  strokeWidth: number
  strokeDashArray?: number[] | null
  opacity: number
  strokeUniform: boolean
  fillRule: CanvasFillRule
  lastFill?: string
  lastStroke?: string
  lastStrokeWidth?: number
  lastStrokeDashArray?: number[] | null
  fillMode?: 'solid' | 'gradient'
  fillGradientType?: FillGradientType
  fillGradientStops?: FillGradientStop[]
  fillGradientAngle?: number
  fillGradientCenterX?: number
  fillGradientCenterY?: number
  fillGradientRadius?: number
}

export type FabricToPathKitResult = {
  path?: PathKitPath
  error?: string
  geometrySource?: FabricBooleanGeometrySource
  fillRule?: CanvasFillRule
  style?: FabricBooleanStyleSnapshot
}

function isVisiblePaint(value: unknown) {
  if (value == null) return false
  if (typeof value !== 'string') return true
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== 'none' && normalized !== 'transparent'
}

function isClosedPathData(pathData: TSimplePathData) {
  let hasSubpath = false
  let subpathHasDrawing = false
  let subpathClosed = true

  for (const segment of pathData) {
    if (segment[0] === 'M') {
      if (hasSubpath && subpathHasDrawing && !subpathClosed) return false
      hasSubpath = true
      subpathHasDrawing = false
      subpathClosed = false
    } else if (segment[0] === 'Z') {
      if (hasSubpath) subpathClosed = true
    } else {
      hasSubpath = true
      subpathHasDrawing = true
    }
  }

  return hasSubpath && subpathHasDrawing && subpathClosed
}

function isClosedShape(obj: FabricObject) {
  if (obj instanceof Line) return false
  if (obj instanceof Path) return isClosedPathData(obj.path as TSimplePathData)
  return true
}

function matrixToPathKit(matrix: number[]) {
  return [
    matrix[0], matrix[2], matrix[4],
    matrix[1], matrix[3], matrix[5],
    0, 0, 1
  ]
}

function transformPath(path: PathKitPath, matrix: number[]) {
  path.transform(matrixToPathKit(matrix))
  return path
}

function addPathData(target: PathKitPath, pathData: TSimplePathData) {
  for (const segment of pathData) {
    switch (segment[0]) {
      case 'M':
        target.moveTo(segment[1], segment[2])
        break
      case 'L':
        target.lineTo(segment[1], segment[2])
        break
      case 'C':
        target.cubicTo(segment[1], segment[2], segment[3], segment[4], segment[5], segment[6])
        break
      case 'Q':
        target.quadTo(segment[1], segment[2], segment[3], segment[4])
        break
      case 'Z':
        target.closePath()
        break
    }
  }
}

function getCanvasFillRule(obj: FabricObject): CanvasFillRule {
  return obj.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
}

function getPathFillType(pathKit: PathKitApi, obj: FabricObject) {
  return getCanvasFillRule(obj) === 'evenodd' ? pathKit.FillType.EVENODD : pathKit.FillType.WINDING
}

function applyFillType(pathKit: PathKitApi, path: PathKitPath, obj: FabricObject) {
  path.setFillType(getPathFillType(pathKit, obj))
}

function createRectPath(pathKit: PathKitApi, obj: Rect) {
  const width = obj.width || 0
  const height = obj.height || 0
  const left = -width / 2
  const top = -height / 2
  const rx = Math.max(0, Math.min(obj.rx || 0, width / 2))
  const ry = Math.max(0, Math.min(obj.ry || 0, height / 2))
  const path = pathKit.NewPath()

  if (rx <= 0 || ry <= 0) {
    path.rect(left, top, width, height)
    return path
  }

  const right = left + width
  const bottom = top + height
  const k = 0.5522847498307936
  path.moveTo(left + rx, top)
  path.lineTo(right - rx, top)
  path.cubicTo(right - rx + rx * k, top, right, top + ry - ry * k, right, top + ry)
  path.lineTo(right, bottom - ry)
  path.cubicTo(right, bottom - ry + ry * k, right - rx + rx * k, bottom, right - rx, bottom)
  path.lineTo(left + rx, bottom)
  path.cubicTo(left + rx - rx * k, bottom, left, bottom - ry + ry * k, left, bottom - ry)
  path.lineTo(left, top + ry)
  path.cubicTo(left, top + ry - ry * k, left + rx - rx * k, top, left + rx, top)
  path.closePath()
  return path
}

function createCirclePath(pathKit: PathKitApi, obj: Circle) {
  const radius = obj.radius || Math.min(obj.width || 0, obj.height || 0) / 2
  const path = pathKit.NewPath()
  path.ellipse(0, 0, radius, radius, 0, 0, Math.PI * 2, false)
  path.closePath()
  return path
}

function createTrianglePath(pathKit: PathKitApi, obj: Triangle) {
  const width = obj.width || 0
  const height = obj.height || 0
  const path = pathKit.NewPath()
  path.moveTo(-width / 2, height / 2)
  path.lineTo(0, -height / 2)
  path.lineTo(width / 2, height / 2)
  path.closePath()
  return path
}

function createPolygonPath(pathKit: PathKitApi, obj: Polygon) {
  const path = pathKit.NewPath()
  const points = obj.points || []
  const offset = obj.pathOffset || { x: 0, y: 0 }
  points.forEach((point: PointLike, index: number) => {
    const x = point.x - offset.x
    const y = point.y - offset.y
    if (index === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  })
  path.closePath()
  return path
}

function createLinePath(pathKit: PathKitApi, obj: Line) {
  const points = obj.calcLinePoints()
  const path = pathKit.NewPath()
  path.moveTo(points.x1, points.y1)
  path.lineTo(points.x2, points.y2)
  return path
}

function createPathPath(pathKit: PathKitApi, obj: Path) {
  const path = pathKit.NewPath()
  const offset = obj.pathOffset
  const pathData = util.transformPath(obj.path, [1, 0, 0, 1, 0, 0], offset) as TSimplePathData
  addPathData(path, pathData)
  return path
}

function createLocalPath(pathKit: PathKitApi, obj: FabricObject) {
  if (obj instanceof Rect) return createRectPath(pathKit, obj)
  if (obj instanceof Circle) return createCirclePath(pathKit, obj)
  if (obj instanceof Triangle) return createTrianglePath(pathKit, obj)
  if (obj instanceof Polygon) return createPolygonPath(pathKit, obj)
  if (obj instanceof Line) return createLinePath(pathKit, obj)
  if (obj instanceof Path) return createPathPath(pathKit, obj)
  return null
}

function strokeCap(pathKit: PathKitApi, obj: FabricObject) {
  if (obj.strokeLineCap === 'round') return pathKit.StrokeCap.ROUND
  if (obj.strokeLineCap === 'square') return pathKit.StrokeCap.SQUARE
  return pathKit.StrokeCap.BUTT
}

function strokeJoin(pathKit: PathKitApi, obj: FabricObject) {
  if (obj.strokeLineJoin === 'round') return pathKit.StrokeJoin.ROUND
  if (obj.strokeLineJoin === 'bevel') return pathKit.StrokeJoin.BEVEL
  return pathKit.StrokeJoin.MITER
}

function strokePath(pathKit: PathKitApi, path: PathKitPath, obj: FabricObject) {
  const result = path.stroke({
    width: obj.strokeWidth || 1,
    cap: strokeCap(pathKit, obj),
    join: strokeJoin(pathKit, obj),
    miter_limit: obj.strokeMiterLimit || 4
  })
  return result ? path : null
}

function getLastStrokeWidth(obj: AnyFabricObject) {
  const lastStrokeWidth = Number(obj.lastStrokeWidth)
  return Number.isFinite(lastStrokeWidth) ? lastStrokeWidth : undefined
}

function normalizeStrokeDashArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const numeric = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
  if (!numeric.length) return null
  return [numeric[0], numeric[1] ?? numeric[0]]
}

function getStyleSnapshot(obj: FabricObject): FabricBooleanStyleSnapshot {
  const target = obj as AnyFabricObject
  applyDefaultFillGradientMetadata(target)
  const hasVisibleFill = typeof obj.fill === 'string' && isVisiblePaint(obj.fill)
  const hasVisibleStroke = typeof obj.stroke === 'string' && isVisiblePaint(obj.stroke) && Number(obj.strokeWidth || 0) > 0
  return {
    fill: obj.fill,
    stroke: obj.stroke,
    strokeWidth: Number(obj.strokeWidth || 0),
    strokeDashArray: normalizeStrokeDashArray(obj.strokeDashArray),
    opacity: obj.opacity ?? 1,
    strokeUniform: obj.strokeUniform ?? false,
    fillRule: getCanvasFillRule(obj),
    lastFill: typeof target.lastFill === 'string'
      ? target.lastFill
      : hasVisibleFill
        ? obj.fill as string
        : undefined,
    lastStroke: typeof target.lastStroke === 'string'
      ? target.lastStroke
      : hasVisibleStroke
        ? obj.stroke as string
        : undefined,
    lastStrokeWidth: getLastStrokeWidth(target) ?? (hasVisibleStroke ? Number(obj.strokeWidth || 0) : undefined),
    lastStrokeDashArray: normalizeStrokeDashArray(target.lastStrokeDashArray),
    fillMode: target.fillMode === 'gradient' ? 'gradient' : 'solid',
    fillGradientType: target.fillGradientType,
    fillGradientStops: cloneFillGradientStops(target.fillGradientStops),
    fillGradientAngle: Number(target.fillGradientAngle),
    fillGradientCenterX: Number(target.fillGradientCenterX),
    fillGradientCenterY: Number(target.fillGradientCenterY),
    fillGradientRadius: Number(target.fillGradientRadius)
  }
}

function createObjectPath(pathKit: PathKitApi, obj: FabricObject): FabricToPathKitResult {
  if (obj instanceof Textbox || obj instanceof FabricImage || obj instanceof ActiveSelection) {
    return { error: '文字和图片暂不支持布尔运算' }
  }
  if (obj instanceof Group) {
    return { error: '成组对象暂不支持布尔运算，请先解组' }
  }

  const closed = isClosedShape(obj)
  const hasFill = closed && isVisiblePaint(obj.fill)
  const hasStroke = isVisiblePaint(obj.stroke) && (obj.strokeWidth || 0) > 0
  if (!hasFill && !hasStroke) {
    return { error: '对象没有可参与布尔运算的填充或描边' }
  }

  const localPath = createLocalPath(pathKit, obj)
  if (!localPath) return { error: '该对象类型暂不支持布尔运算' }

  const created: PathKitPath[] = [localPath]
  const style = getStyleSnapshot(obj)
  if (!closed && style.strokeDashArray?.length) {
    localPath.delete()
    return { error: '虚线描边暂不支持布尔运算，请先改为实线' }
  }
  try {
    if (closed) {
      const contourPath = localPath.copy()
      created.push(contourPath)
      applyFillType(pathKit, contourPath, obj)
      transformPath(contourPath, obj.calcTransformMatrix())
      return {
        path: contourPath.copy(),
        geometrySource: 'contour',
        fillRule: style.fillRule,
        style
      }
    }

    const strokeOutline = localPath.copy()
    created.push(strokeOutline)
    if (obj.strokeUniform) {
      transformPath(strokeOutline, obj.calcTransformMatrix())
      if (!strokePath(pathKit, strokeOutline, obj)) {
        return { error: '描边轮廓转换失败' }
      }
    } else {
      if (!strokePath(pathKit, strokeOutline, obj)) {
        return { error: '描边轮廓转换失败' }
      }
      transformPath(strokeOutline, obj.calcTransformMatrix())
    }

    return {
      path: strokeOutline.copy(),
      geometrySource: 'stroke-area',
      fillRule: style.fillRule,
      style
    }
  } finally {
    created.forEach((path) => path.delete())
  }
}

export function fabricObjectToPathKitWithApi(pathKit: PathKitApi, obj: FabricObject): FabricToPathKitResult {
  return createObjectPath(pathKit, obj)
}

// 将对象当前描边转换为 PathKit 填充路径，供“描边转轮廓”在不改变原填充的前提下生成可编辑轮廓。
export function fabricStrokeToPathKitWithApi(pathKit: PathKitApi, obj: FabricObject): FabricToPathKitResult {
  if (obj instanceof Textbox || obj instanceof FabricImage || obj instanceof ActiveSelection) {
    return { error: '文字和图片暂不支持描边转轮廓' }
  }
  if (obj instanceof Group) {
    return { error: '成组对象暂不支持描边转轮廓，请先解组' }
  }
  const style = getStyleSnapshot(obj)
  const hasStroke = isVisiblePaint(obj.stroke) && (obj.strokeWidth || 0) > 0
  if (!hasStroke) return { error: '对象没有可转换的可见描边' }
  if (style.strokeDashArray?.length) return { error: '虚线描边暂不支持转轮廓，请先改为实线' }

  const localPath = createLocalPath(pathKit, obj)
  if (!localPath) return { error: '该对象类型暂不支持描边转轮廓' }

  const created: PathKitPath[] = [localPath]
  try {
    const strokeOutline = localPath.copy()
    created.push(strokeOutline)
    if (obj.strokeUniform) {
      transformPath(strokeOutline, obj.calcTransformMatrix())
      if (!strokePath(pathKit, strokeOutline, obj)) return { error: '描边轮廓转换失败' }
    } else {
      if (!strokePath(pathKit, strokeOutline, obj)) return { error: '描边轮廓转换失败' }
      transformPath(strokeOutline, obj.calcTransformMatrix())
    }
    return {
      path: strokeOutline.copy(),
      geometrySource: 'stroke-area',
      fillRule: style.fillRule,
      style
    }
  } finally {
    created.forEach((path) => path.delete())
  }
}

export async function fabricObjectToPathKit(obj: FabricObject): Promise<FabricToPathKitResult> {
  const pathKit = await getPathKit()
  return fabricObjectToPathKitWithApi(pathKit, obj)
}

export async function canConvertToPathKit(obj: FabricObject): Promise<boolean> {
  const result = await fabricObjectToPathKit(obj)
  if (result.path) {
    result.path.delete()
    return true
  }
  return false
}

export function isBooleanCandidate(obj: FabricObject) {
  if (obj instanceof Textbox || obj instanceof FabricImage || obj instanceof Group || obj instanceof ActiveSelection) return false
  if (!(obj instanceof Rect || obj instanceof Circle || obj instanceof Triangle || obj instanceof Polygon || obj instanceof Line || obj instanceof Path)) return false

  const hasStrokeArea = isVisiblePaint(obj.stroke) && (obj.strokeWidth || 0) > 0
  if (!isClosedShape(obj)) return hasStrokeArea
  return isVisiblePaint(obj.fill) || hasStrokeArea
}
