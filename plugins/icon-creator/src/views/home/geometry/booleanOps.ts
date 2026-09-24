import { Canvas, FabricObject } from 'fabric'
import { fabricObjectToPathKit, type FabricBooleanStyleSnapshot, type FabricToPathKitResult } from './fabricToPathKit'
import { getPathKit, type PathKitPath } from './pathkit'
import { pathKitToFabricPath } from './pathKitToFabric'

export type BooleanOperation = 'union' | 'intersect' | 'subtract' | 'xor'
export type SubtractDirection = 'forward' | 'reverse'

type ApplyOptions = {
  canvas: Canvas
  operation: BooleanOperation
  objects: FabricObject[]
  makeName: (label: string) => string
  subtractDirection?: SubtractDirection
}

type ComputeOptions = {
  canvas: Canvas
  operation: BooleanOperation
  objects: FabricObject[]
  subtractDirection?: SubtractDirection
  includePreviewRemovedPath?: boolean
}

export type ComputedBooleanResult = {
  orderedObjects: FabricObject[]
  baseObject: FabricObject
  style: FabricBooleanStyleSnapshot
  path: PathKitPath
  removedPath?: PathKitPath | null
  sourceCornerRadius?: number | null
}

type ConvertedBooleanObject = FabricToPathKitResult & {
  path: PathKitPath
  style: FabricBooleanStyleSnapshot
  geometrySource: 'contour' | 'stroke-area'
}

type AnyFabricObject = FabricObject & Record<string, any>

function hasConvertedPath(result: FabricToPathKitResult): result is ConvertedBooleanObject {
  return !!result.path && !!result.style && !!result.geometrySource
}

function labelForOperation(operation: BooleanOperation) {
  switch (operation) {
    case 'union': return '并集'
    case 'intersect': return '交集'
    case 'subtract': return '差集'
    case 'xor': return '异或'
  }
}

function isEmptyPath(path: PathKitPath) {
  return path.toSVGString().trim() === ''
}

function replaceObjects(canvas: Canvas, objects: FabricObject[], base: FabricObject, result: FabricObject) {
  const canvasObjects = canvas.getObjects()
  const baseIndex = Math.max(0, canvasObjects.indexOf(base))
  canvas.discardActiveObject()
  objects.forEach((obj) => canvas.remove(obj as AnyFabricObject))
  canvas.insertAt(Math.min(baseIndex, canvas.getObjects().length), result)
  canvas.setActiveObject(result)
  result.setCoords()
  canvas.requestRenderAll()
}

function applyPathOp(target: PathKitPath, source: PathKitPath, op: unknown) {
  return !!target.op(source, op)
}

export async function computeBooleanResult(options: ComputeOptions): Promise<{ result?: ComputedBooleanResult; error?: string }> {
  const { canvas, operation, objects, subtractDirection = 'forward', includePreviewRemovedPath = false } = options
  if (objects.length < 2) return { error: '请至少选择 2 个对象' }

  const canvasObjects = canvas.getObjects()
  const ordered = objects
    .filter((obj) => canvasObjects.includes(obj))
    .sort((a, b) => canvasObjects.indexOf(a) - canvasObjects.indexOf(b))

  if (ordered.length < 2) return { error: '请至少选择 2 个对象' }

  const pathKit = await getPathKit()
  const converted: ConvertedBooleanObject[] = []
  let accumulator: PathKitPath | null = null
  let cutter: PathKitPath | null = null
  let removedPreviewPath: PathKitPath | null = null

  try {
    for (const obj of ordered) {
      const convertedObject = await fabricObjectToPathKit(obj)
      if (convertedObject.error) {
        return { error: convertedObject.error }
      }
      if (!hasConvertedPath(convertedObject)) {
        return { error: '对象无法转换为布尔运算路径' }
      }
      converted.push(convertedObject)
    }

    if (includePreviewRemovedPath) {
      removedPreviewPath = converted[0].path.copy()
      for (let i = 1; i < converted.length; i++) {
        if (!applyPathOp(removedPreviewPath, converted[i].path, pathKit.PathOp.UNION)) return { error: '布尔运算失败' }
      }
    }

    const reverseSubtract = operation === 'subtract' && subtractDirection === 'reverse' && ordered.length === 2
    const baseIndex = reverseSubtract ? 1 : 0
    const base = ordered[baseIndex]
    const donor = converted[baseIndex]
    accumulator = donor.path.copy()

    if (operation === 'subtract') {
      cutter = converted[reverseSubtract ? 0 : 1].path.copy()
      if (!reverseSubtract) {
        for (let i = 2; i < converted.length; i++) {
          if (!applyPathOp(cutter, converted[i].path, pathKit.PathOp.UNION)) return { error: '布尔运算失败' }
        }
      }
      if (!applyPathOp(accumulator, cutter, pathKit.PathOp.DIFFERENCE)) return { error: '布尔运算失败' }
    } else {
      const op = operation === 'union'
        ? pathKit.PathOp.UNION
        : operation === 'intersect'
          ? pathKit.PathOp.INTERSECT
          : pathKit.PathOp.XOR
      for (let i = 1; i < converted.length; i++) {
        if (!applyPathOp(accumulator, converted[i].path, op)) return { error: '布尔运算失败' }
      }
    }

    if (!accumulator.simplify()) return { error: '布尔运算失败' }
    if (isEmptyPath(accumulator)) return { error: '运算结果为空' }

    if (removedPreviewPath) {
      if (!applyPathOp(removedPreviewPath, accumulator, pathKit.PathOp.DIFFERENCE)) return { error: '布尔运算失败' }
      if (!removedPreviewPath.simplify()) return { error: '布尔运算失败' }
      if (isEmptyPath(removedPreviewPath)) {
        removedPreviewPath.delete()
        removedPreviewPath = null
      }
    }

    const path = accumulator
    const previewRemovedPath = removedPreviewPath
    accumulator = null
    removedPreviewPath = null

    // 提取源对象的 cornerRadius
    const AnyFabricObject = FabricObject as { new(...args: any[]): FabricObject & Record<string, any> }
    let sourceCornerRadius: number | null = null
    for (const obj of ordered) {
      const typedObj = obj as AnyFabricObject
      if (typeof typedObj.cornerRadius === 'number' && typedObj.cornerRadius > 0) {
        sourceCornerRadius = typedObj.cornerRadius
        break
      }
    }

    return {
      result: {
        orderedObjects: ordered,
        baseObject: base,
        style: donor.style,
        path,
        removedPath: previewRemovedPath,
        sourceCornerRadius
      }
    }
  } catch (error: any) {
    return { error: error?.message || '布尔运算失败' }
  } finally {
    converted.forEach((item) => item.path.delete())
    cutter?.delete()
    accumulator?.delete()
    removedPreviewPath?.delete()
  }
}

export async function applyBooleanOperation(options: ApplyOptions): Promise<{ result?: FabricObject; error?: string }> {
  const { canvas, operation, objects, makeName, subtractDirection } = options
  const { result: computed, error } = await computeBooleanResult({
    canvas,
    operation,
    objects,
    subtractDirection
  })
  if (error || !computed) return { error: error || '布尔运算失败' }

  try {
    const result = pathKitToFabricPath(computed.path, {
      name: makeName(labelForOperation(operation)),
      shapeId: 'boolean-result',
      style: computed.style,
      sourceCornerRadius: computed.sourceCornerRadius
    })
    if (!result) return { error: '运算结果为空' }

    replaceObjects(canvas, computed.orderedObjects, computed.baseObject, result)
    return { result }
  } finally {
    computed.path.delete()
  }
}
