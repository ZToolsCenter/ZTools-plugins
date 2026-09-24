import { Canvas, FabricObject, Point } from 'fabric'

type VerticalLine = {
  x: number
  y1: number
  y2: number
}

type HorizontalLine = {
  y: number
  x1: number
  x2: number
}

type SceneBounds = {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
}

type VerticalAnchor = 'left' | 'right' | 'centerX'

type HorizontalAnchor = 'top' | 'bottom' | 'centerY'

type VerticalSnapMatch = {
  delta: number
  line: VerticalLine
  anchor: VerticalAnchor
}

type HorizontalSnapMatch = {
  delta: number
  line: HorizontalLine
  anchor: HorizontalAnchor
}

type SnapState<TAnchor extends string> = {
  guide: number
  anchor: TAnchor
}

type AligningLineColor = string | (() => string)

export type AligningGuidelinesOptions = {
  margin?: number
  width?: number
  color?: AligningLineColor
  offset?: number
  getObjectsByTarget?: (target: FabricObject) => Iterable<FabricObject>
}

type FabricDragTransform = {
  action?: string
  actionHandler?: (eventData: Event, transform: FabricDragTransform, x: number, y: number) => boolean
  offsetX: number
  offsetY: number
  target: FabricObject
}

type FabricBeforeTransformEvent = {
  transform?: FabricDragTransform
}

export class AligningGuidelines {
  private readonly canvas: Canvas
  private readonly ctx: CanvasRenderingContext2D
  private readonly getObjectsByTarget?: (target: FabricObject) => Iterable<FabricObject>
  private readonly aligningLineOffset: number
  private readonly aligningLineMargin: number
  private readonly aligningLineWidth: number
  private readonly aligningLineColor: AligningLineColor
  private zoom = 1
  private readonly verticalLines: VerticalLine[] = []
  private readonly horizontalLines: HorizontalLine[] = []
  private verticalSnapState: SnapState<VerticalAnchor> | null = null
  private horizontalSnapState: SnapState<HorizontalAnchor> | null = null

  constructor(canvas: Canvas, options: AligningGuidelinesOptions = {}) {
    this.canvas = canvas
    this.ctx = canvas.getSelectionContext?.() ?? canvas.getTopContext()
    this.getObjectsByTarget = options.getObjectsByTarget
    this.aligningLineOffset = options.offset ?? 5
    this.aligningLineMargin = options.margin ?? 4
    this.aligningLineWidth = options.width ?? 1
    this.aligningLineColor = options.color ?? 'rgb(0,255,0)'

    this.handleMouseDown = this.handleMouseDown.bind(this)
    this.handleBeforeTransform = this.handleBeforeTransform.bind(this)
    this.handleObjectDragging = this.handleObjectDragging.bind(this)
    this.handleBeforeRender = this.handleBeforeRender.bind(this)
    this.handleAfterRender = this.handleAfterRender.bind(this)
    this.handleMouseUp = this.handleMouseUp.bind(this)

    this.canvas.on('mouse:down', this.handleMouseDown)
    this.canvas.on('before:transform', this.handleBeforeTransform)
    this.canvas.on('before:render', this.handleBeforeRender)
    this.canvas.on('after:render', this.handleAfterRender)
    this.canvas.on('mouse:up', this.handleMouseUp)
  }

  dispose() {
    this.canvas.off('mouse:down', this.handleMouseDown)
    this.canvas.off('before:transform', this.handleBeforeTransform)
    this.canvas.off('before:render', this.handleBeforeRender)
    this.canvas.off('after:render', this.handleAfterRender)
    this.canvas.off('mouse:up', this.handleMouseUp)
    this.verticalLines.length = 0
    this.horizontalLines.length = 0
    if (this.canvas.contextTop) {
      this.canvas.clearContext(this.canvas.contextTop)
      this.canvas.requestRenderAll()
    }
  }

  private handleMouseDown() {
    this.syncViewport()
    this.verticalSnapState = null
    this.horizontalSnapState = null
  }

  private handleBeforeTransform(event: FabricBeforeTransformEvent) {
    if (event.transform?.action !== 'drag') return
    event.transform.actionHandler = this.handleObjectDragging
  }

  private handleObjectDragging(eventData: Event, transform: FabricDragTransform, x: number, y: number) {
    const activeObject = transform.target
    if (!activeObject) return false

    this.syncViewport()
    this.verticalLines.length = 0
    this.horizontalLines.length = 0

    const currentLeft = activeObject.left ?? 0
    const currentTop = activeObject.top ?? 0
    const rawLeft = activeObject.lockMovementX ? currentLeft : x - transform.offsetX
    const rawTop = activeObject.lockMovementY ? currentTop : y - transform.offsetY
    const currentBounds = this.getSceneBounds(activeObject)

    if (!currentBounds) {
      this.verticalSnapState = null
      this.horizontalSnapState = null
      return this.moveObject(activeObject, rawLeft, rawTop, eventData, transform, x, y)
    }

    const rawBounds = this.translateSceneBounds(
      currentBounds,
      rawLeft - currentLeft,
      rawTop - currentTop
    )

    const verticalMatch = activeObject.lockMovementX ? null : this.findBestVerticalMatch(activeObject, rawBounds)
    const horizontalMatch = activeObject.lockMovementY ? null : this.findBestHorizontalMatch(activeObject, rawBounds)

    const resolvedVerticalMatch = activeObject.lockMovementX
      ? (this.verticalSnapState = null)
      : this.resolveVerticalSnapMatch(verticalMatch, rawBounds)
    const resolvedHorizontalMatch = activeObject.lockMovementY
      ? (this.horizontalSnapState = null)
      : this.resolveHorizontalSnapMatch(horizontalMatch, rawBounds)

    const nextLeft = rawLeft + (resolvedVerticalMatch?.delta ?? 0)
    const nextTop = rawTop + (resolvedHorizontalMatch?.delta ?? 0)

    if (resolvedVerticalMatch) {
      this.verticalLines.push(resolvedVerticalMatch.line)
    }
    if (resolvedHorizontalMatch) {
      this.horizontalLines.push(resolvedHorizontalMatch.line)
    }

    return this.moveObject(activeObject, nextLeft, nextTop, eventData, transform, x, y)
  }

  private moveObject(
    activeObject: FabricObject,
    nextLeft: number,
    nextTop: number,
    eventData: Event,
    transform: FabricDragTransform,
    x: number,
    y: number
  ) {
    const moveX = !activeObject.lockMovementX && activeObject.left !== nextLeft
    const moveY = !activeObject.lockMovementY && activeObject.top !== nextTop

    if (moveX) activeObject.set('left', nextLeft)
    if (moveY) activeObject.set('top', nextTop)

    if (moveX || moveY) {
      activeObject.setCoords()
      this.fireObjectMoving(eventData, transform, x, y)
    }

    return moveX || moveY
  }

  private fireObjectMoving(eventData: Event, transform: FabricDragTransform, x: number, y: number) {
    const target = transform.target
    const options = {
      e: eventData,
      transform,
      pointer: new Point(x, y)
    }
    this.canvas.fire('object:moving', {
      ...options,
      target
    } as any)
    target.fire('moving', options as any)
  }

  private handleBeforeRender() {
    if (this.canvas.contextTop) {
      this.canvas.clearContext(this.canvas.contextTop)
    }
  }

  private handleAfterRender() {
    for (let i = this.verticalLines.length - 1; i >= 0; i--) {
      this.drawVerticalLine(this.verticalLines[i])
    }
    for (let i = this.horizontalLines.length - 1; i >= 0; i--) {
      this.drawHorizontalLine(this.horizontalLines[i])
    }
    this.verticalLines.length = 0
    this.horizontalLines.length = 0
  }

  private handleMouseUp() {
    this.verticalLines.length = 0
    this.horizontalLines.length = 0
    this.verticalSnapState = null
    this.horizontalSnapState = null
    this.canvas.requestRenderAll()
  }

  private syncViewport() {
    this.zoom = this.canvas.getZoom() || 1
  }

  private findBestVerticalMatch(activeObject: FabricObject, activeBounds: SceneBounds) {
    const canvasObjects = this.resolveCanvasObjects(activeObject)
    let bestVerticalMatch: VerticalSnapMatch | null = null

    for (let i = canvasObjects.length - 1; i >= 0; i--) {
      const object = canvasObjects[i]
      if (object === activeObject) continue

      const objectBounds = this.getSceneBounds(object)
      if (!objectBounds) continue

      bestVerticalMatch = this.pickBetterVerticalMatch(bestVerticalMatch, {
        delta: objectBounds.left - activeBounds.right,
        line: this.createVerticalLine(objectBounds.left),
        anchor: 'right'
      })
      bestVerticalMatch = this.pickBetterVerticalMatch(bestVerticalMatch, {
        delta: objectBounds.right - activeBounds.left,
        line: this.createVerticalLine(objectBounds.right),
        anchor: 'left'
      })
      bestVerticalMatch = this.pickBetterVerticalMatch(bestVerticalMatch, {
        delta: objectBounds.centerX - activeBounds.centerX,
        line: this.createVerticalLine(objectBounds.centerX),
        anchor: 'centerX'
      })
      bestVerticalMatch = this.pickBetterVerticalMatch(bestVerticalMatch, {
        delta: objectBounds.left - activeBounds.left,
        line: this.createVerticalLine(objectBounds.left),
        anchor: 'left'
      })
      bestVerticalMatch = this.pickBetterVerticalMatch(bestVerticalMatch, {
        delta: objectBounds.right - activeBounds.right,
        line: this.createVerticalLine(objectBounds.right),
        anchor: 'right'
      })
    }

    return this.pickBetterVerticalMatch(bestVerticalMatch, {
      delta: this.getSceneCanvasWidth() / 2 - activeBounds.centerX,
      line: this.createVerticalLine(this.getSceneCanvasWidth() / 2),
      anchor: 'centerX'
    })
  }

  private findBestHorizontalMatch(activeObject: FabricObject, activeBounds: SceneBounds) {
    const canvasObjects = this.resolveCanvasObjects(activeObject)
    let bestHorizontalMatch: HorizontalSnapMatch | null = null

    for (let i = canvasObjects.length - 1; i >= 0; i--) {
      const object = canvasObjects[i]
      if (object === activeObject) continue

      const objectBounds = this.getSceneBounds(object)
      if (!objectBounds) continue

      bestHorizontalMatch = this.pickBetterHorizontalMatch(bestHorizontalMatch, {
        delta: objectBounds.top - activeBounds.bottom,
        line: this.createHorizontalLine(objectBounds.top),
        anchor: 'bottom'
      })
      bestHorizontalMatch = this.pickBetterHorizontalMatch(bestHorizontalMatch, {
        delta: objectBounds.bottom - activeBounds.top,
        line: this.createHorizontalLine(objectBounds.bottom),
        anchor: 'top'
      })
      bestHorizontalMatch = this.pickBetterHorizontalMatch(bestHorizontalMatch, {
        delta: objectBounds.centerY - activeBounds.centerY,
        line: this.createHorizontalLine(objectBounds.centerY),
        anchor: 'centerY'
      })
      bestHorizontalMatch = this.pickBetterHorizontalMatch(bestHorizontalMatch, {
        delta: objectBounds.top - activeBounds.top,
        line: this.createHorizontalLine(objectBounds.top),
        anchor: 'top'
      })
      bestHorizontalMatch = this.pickBetterHorizontalMatch(bestHorizontalMatch, {
        delta: objectBounds.bottom - activeBounds.bottom,
        line: this.createHorizontalLine(objectBounds.bottom),
        anchor: 'bottom'
      })
    }

    return this.pickBetterHorizontalMatch(bestHorizontalMatch, {
      delta: this.getSceneCanvasHeight() / 2 - activeBounds.centerY,
      line: this.createHorizontalLine(this.getSceneCanvasHeight() / 2),
      anchor: 'centerY'
    })
  }

  private resolveCanvasObjects(target: FabricObject) {
    const source = this.getObjectsByTarget?.(target)
    if (!source) return this.canvas.getObjects()
    return Array.from(new Set(Array.from(source).filter(Boolean)))
  }

  private getSceneBounds(object: FabricObject): SceneBounds | null {
    const points = object.getCoords()
    if (!points.length) return null

    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity

    points.forEach((point) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
      left = Math.min(left, point.x)
      right = Math.max(right, point.x)
      top = Math.min(top, point.y)
      bottom = Math.max(bottom, point.y)
    })

    if (![left, right, top, bottom].every(Number.isFinite)) return null

    return {
      left,
      right,
      top,
      bottom,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2
    }
  }

  private translateSceneBounds(bounds: SceneBounds, deltaX: number, deltaY: number): SceneBounds {
    return {
      left: bounds.left + deltaX,
      right: bounds.right + deltaX,
      top: bounds.top + deltaY,
      bottom: bounds.bottom + deltaY,
      centerX: bounds.centerX + deltaX,
      centerY: bounds.centerY + deltaY
    }
  }

  private getSceneCanvasWidth() {
    return this.canvas.getWidth() / this.zoom
  }

  private getSceneCanvasHeight() {
    return this.canvas.getHeight() / this.zoom
  }

  private createVerticalLine(x: number): VerticalLine {
    return {
      x,
      y1: -this.aligningLineOffset,
      y2: this.getSceneCanvasHeight() + this.aligningLineOffset
    }
  }

  private createHorizontalLine(y: number): HorizontalLine {
    return {
      y,
      x1: -this.aligningLineOffset,
      x2: this.getSceneCanvasWidth() + this.aligningLineOffset
    }
  }

  private pickBetterVerticalMatch(current: VerticalSnapMatch | null, next: VerticalSnapMatch) {
    if (!this.isInRange(0, next.delta)) return current
    if (!current) return next
    return Math.abs(next.delta) < Math.abs(current.delta) ? next : current
  }

  private pickBetterHorizontalMatch(current: HorizontalSnapMatch | null, next: HorizontalSnapMatch) {
    if (!this.isInRange(0, next.delta)) return current
    if (!current) return next
    return Math.abs(next.delta) < Math.abs(current.delta) ? next : current
  }

  private resolveVerticalSnapMatch(match: VerticalSnapMatch | null, activeBounds: SceneBounds) {
    this.verticalSnapState = this.resolveVerticalSnapState(this.verticalSnapState, match, activeBounds)
    if (!this.verticalSnapState) return null
    return {
      delta: this.verticalSnapState.guide - this.getVerticalAnchorValue(activeBounds, this.verticalSnapState.anchor),
      line: this.createVerticalLine(this.verticalSnapState.guide),
      anchor: this.verticalSnapState.anchor
    }
  }

  private resolveHorizontalSnapMatch(match: HorizontalSnapMatch | null, activeBounds: SceneBounds) {
    this.horizontalSnapState = this.resolveHorizontalSnapState(this.horizontalSnapState, match, activeBounds)
    if (!this.horizontalSnapState) return null
    return {
      delta: this.horizontalSnapState.guide - this.getHorizontalAnchorValue(activeBounds, this.horizontalSnapState.anchor),
      line: this.createHorizontalLine(this.horizontalSnapState.guide),
      anchor: this.horizontalSnapState.anchor
    }
  }

  private resolveVerticalSnapState(
    state: SnapState<VerticalAnchor> | null,
    match: VerticalSnapMatch | null,
    activeBounds: SceneBounds
  ): SnapState<VerticalAnchor> | null {
    if (state) {
      const delta = state.guide - this.getVerticalAnchorValue(activeBounds, state.anchor)
      if (this.isInRange(0, delta)) return state
    }
    if (!match) return null
    return {
      guide: match.line.x,
      anchor: match.anchor
    }
  }

  private resolveHorizontalSnapState(
    state: SnapState<HorizontalAnchor> | null,
    match: HorizontalSnapMatch | null,
    activeBounds: SceneBounds
  ): SnapState<HorizontalAnchor> | null {
    if (state) {
      const delta = state.guide - this.getHorizontalAnchorValue(activeBounds, state.anchor)
      if (this.isInRange(0, delta)) return state
    }
    if (!match) return null
    return {
      guide: match.line.y,
      anchor: match.anchor
    }
  }

  private getVerticalAnchorValue(bounds: SceneBounds, anchor: VerticalAnchor) {
    if (anchor === 'left') return bounds.left
    if (anchor === 'right') return bounds.right
    return bounds.centerX
  }

  private getHorizontalAnchorValue(bounds: SceneBounds, anchor: HorizontalAnchor) {
    if (anchor === 'top') return bounds.top
    if (anchor === 'bottom') return bounds.bottom
    return bounds.centerY
  }

  private drawVerticalLine(coords: VerticalLine) {
    this.drawLine(
      coords.x + 0.5,
      coords.y1 > coords.y2 ? coords.y2 : coords.y1,
      coords.x + 0.5,
      coords.y2 > coords.y1 ? coords.y2 : coords.y1
    )
  }

  private drawHorizontalLine(coords: HorizontalLine) {
    this.drawLine(
      coords.x1 > coords.x2 ? coords.x2 : coords.x1,
      coords.y + 0.5,
      coords.x2 > coords.x1 ? coords.x2 : coords.x1,
      coords.y + 0.5
    )
  }

  private drawLine(x1: number, y1: number, x2: number, y2: number) {
    const viewportTransform = this.canvas.viewportTransform
    if (!viewportTransform) return

    this.ctx.save()
    this.ctx.transform(...viewportTransform)
    this.ctx.lineWidth = this.aligningLineWidth / this.zoom
    this.ctx.strokeStyle = typeof this.aligningLineColor === 'function' ? this.aligningLineColor() : this.aligningLineColor
    this.ctx.beginPath()
    this.ctx.moveTo(x1, y1)
    this.ctx.lineTo(x2, y2)
    this.ctx.stroke()
    this.ctx.restore()
  }

  private isInRange(value1: number, value2: number) {
    return Math.abs(value1 - value2) <= this.aligningLineMargin / this.zoom
  }
}
