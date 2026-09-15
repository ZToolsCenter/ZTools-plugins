import { Path } from 'fabric'
import type { TSimplePathData } from 'fabric'
import type { FabricBooleanStyleSnapshot } from './fabricToPathKit'
import {
  createEditablePathObject,
  editablePathFromPathData,
  collapseRoundedCorners,
  rebuildEditablePathObject,
  type EditablePathModel,
  type EditablePathObject
} from './editablePath'
import type { PathKitBounds, PathKitPath } from './pathkit'
import { applyDefaultFillGradientMetadata, applyDefaultKaleidoscopeMetadata, createGradientFromMetadata, type AnyFabricObject } from '../fabric/objectMetadata'

export type PathKitToFabricOptions = {
  name?: string
  shapeId?: string
  style: FabricBooleanStyleSnapshot
  preview?: boolean
  sourceCornerRadius?: number | null
}

type AnyFabricPath = Path & AnyFabricObject

type EditableCornerRadiusState = {
  cornerRadius: number
  overrides: Array<number | null>
}

function getPathBounds(path: PathKitPath): PathKitBounds | null {
  const bounds = path.computeTightBounds?.() || path.getBounds()
  if (!bounds) return null
  const values = [bounds.fLeft, bounds.fTop, bounds.fRight, bounds.fBottom]
  return values.every((value) => Number.isFinite(value)) ? bounds : null
}

function translatePath(path: PathKitPath, tx: number, ty: number) {
  path.transform([1, 0, tx, 0, 1, ty, 0, 0, 1])
  return path
}

function normalizePositiveRadius(value: number | null | undefined) {
  return Number.isFinite(value) && value! > 0 ? value! : null
}

function radiusTolerance(radius: number) {
  return Math.max(0.75, radius * 0.15)
}

function getCollapsedCornerRadii(
  model: EditablePathModel,
  overridesByContour: Map<number, Map<number, number>>
) {
  const radii: Array<number | null> = []
  model.contours.forEach((contour, contourIndex) => {
    const contourOverrides = overridesByContour.get(contourIndex)
    contour.points.forEach((_point, pointIndex) => {
      radii.push(normalizePositiveRadius(contourOverrides?.get(pointIndex)))
    })
  })
  return radii
}

function resolveEditableCornerRadiusState(
  radii: Array<number | null>,
  hintedRadius: number | null | undefined
): EditableCornerRadiusState {
  const positiveRadii = radii.filter((value): value is number => value != null && value > 0)
  if (!positiveRadii.length) {
    return {
      cornerRadius: 0,
      overrides: radii.map(() => null)
    }
  }

  const hint = normalizePositiveRadius(hintedRadius)
  let cornerRadius = 0

  if (hint && positiveRadii.every((value) => Math.abs(value - hint) <= radiusTolerance(Math.max(value, hint)))) {
    cornerRadius = hint
  } else {
    const baseline = positiveRadii[0]
    if (positiveRadii.every((value) => Math.abs(value - baseline) <= radiusTolerance(Math.max(value, baseline)))) {
      cornerRadius = positiveRadii.reduce((sum, value) => sum + value, 0) / positiveRadii.length
    }
  }

  return {
    cornerRadius,
    overrides: radii.map((value) => {
      if (value == null || value <= 0) return cornerRadius > 0 ? 0 : null
      if (cornerRadius > 0 && Math.abs(value - cornerRadius) <= radiusTolerance(Math.max(value, cornerRadius))) {
        return null
      }
      return value
    })
  }
}

function createEditableBooleanResult(
  svgPath: string,
  sourceCornerRadius: number | null | undefined
): EditablePathObject | null {
  const parsed = editablePathFromPathData(new Path(svgPath).path as TSimplePathData)
  if (!parsed) return null

  const collapsed = collapseRoundedCorners(parsed, sourceCornerRadius ?? 0)
  const result = createEditablePathObject(collapsed.model, 0)
  const radiusState = resolveEditableCornerRadiusState(
    getCollapsedCornerRadii(collapsed.model, collapsed.overridesByContour),
    sourceCornerRadius
  )

  result.cornerRadius = radiusState.cornerRadius
  result.cornerRadiusOverrides = radiusState.overrides
  rebuildEditablePathObject(result)
  return result
}

export function pathKitToEditablePathObject(path: PathKitPath) {
  const bounds = getPathBounds(path)
  if (!bounds) return null

  const normalizedPath = path.copy()
  try {
    translatePath(normalizedPath, -bounds.fLeft, -bounds.fTop)
    const svgPath = normalizedPath.toSVGString()
    if (!svgPath.trim()) return null

    const parsed = editablePathFromPathData(new Path(svgPath).path as TSimplePathData)
    if (!parsed) return null

    const result = createEditablePathObject(parsed, 0)
    result.set({
      left: bounds.fLeft,
      top: bounds.fTop,
      originX: 'left',
      originY: 'top',
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
      opacity: 0,
      visible: false,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false
    })
    const custom = result as AnyFabricPath
    custom.shapeId = 'snap-outline-helper'
    custom.booleanEligible = false
    custom.excludeFromExport = true
    applyDefaultKaleidoscopeMetadata(result)
    result.setCoords()
    return result
  } finally {
    normalizedPath.delete()
  }
}

export function pathKitToFabricPath(path: PathKitPath, options: PathKitToFabricOptions) {
  const bounds = getPathBounds(path)
  if (!bounds) return null

  const normalizedPath = path.copy()
  try {
    translatePath(normalizedPath, -bounds.fLeft, -bounds.fTop)
    const svgPath = normalizedPath.toSVGString()
    if (!svgPath.trim()) return null

    const fillRule = path.getFillTypeString?.() || options.style.fillRule || 'nonzero'
    const pathOptions = {
      left: bounds.fLeft,
      top: bounds.fTop,
      originX: 'left',
      originY: 'top',
      fill: (options.style.fill ?? 'transparent') as any,
      stroke: (options.style.stroke ?? 'transparent') as any,
      strokeWidth: Number.isFinite(options.style.strokeWidth) ? options.style.strokeWidth : 0,
      strokeDashArray: options.style.strokeDashArray ? [...options.style.strokeDashArray] : null,
      strokeUniform: options.style.strokeUniform,
      fillRule,
      opacity: options.style.opacity ?? 1
    } as const

    const result = !options.preview
      ? createEditableBooleanResult(svgPath, options.sourceCornerRadius)
      : new Path(svgPath)
    if (!result) return null

    result.set(pathOptions)

    const custom = result as AnyFabricPath
    custom.name = options.preview ? '布尔预览' : (options.name || '')
    custom.lastFill = options.style.lastFill
    custom.lastStroke = options.style.lastStroke
    custom.lastStrokeWidth = options.style.lastStrokeWidth
    custom.lastStrokeDashArray = options.style.lastStrokeDashArray ? [...options.style.lastStrokeDashArray] : undefined
    custom.fillMode = options.style.fillMode ?? 'solid'
    custom.fillGradientType = options.style.fillGradientType
    custom.fillGradientStops = options.style.fillGradientStops ? options.style.fillGradientStops.map((stop) => ({ ...stop })) : undefined
    custom.fillGradientAngle = options.style.fillGradientAngle
    custom.fillGradientCenterX = options.style.fillGradientCenterX
    custom.fillGradientCenterY = options.style.fillGradientCenterY
    custom.fillGradientRadius = options.style.fillGradientRadius
    custom.shapeId = options.preview ? 'boolean-preview' : (options.shapeId || 'boolean-result')
    custom.booleanEligible = !options.preview
    custom.booleanPreview = !!options.preview
    custom.excludeFromExport = !!options.preview
    applyDefaultFillGradientMetadata(result)
    if (custom.fillMode === 'gradient') {
      result.set('fill', createGradientFromMetadata(result))
    }
    applyDefaultKaleidoscopeMetadata(result)
    result.setCoords()
    return result
  } finally {
    normalizedPath.delete()
  }
}
