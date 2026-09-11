/**
 * 标注对象模型与撤销/重做（纯前端，无 DOM 依赖）
 *
 * 坐标约定：全部为**图片像素**（DIP 分辨率，与合成图 dataURL 同坐标系）。
 * 撤销/重做：以「对象数组」为单位做快照栈。
 */

export type ToolKind =
  | 'select'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'highlight'
  | 'text'
  | 'mosaic'
  | 'serial'

export interface Style {
  color: string
  lineWidth: number
  fill?: boolean
}

/** 绘制样式快照（字体随 text 存，避免全局耦合） */
export interface TextStyle {
  color: string
  size: number
  bold: boolean
}

export interface BaseAnno {
  id: string
  type: Exclude<ToolKind, 'select'>
}

export interface Point {
  x: number
  y: number
}

export interface PenAnno extends BaseAnno {
  type: 'pen'
  points: Point[]
  style: Style
}
export interface LineAnno extends BaseAnno {
  type: 'line'
  a: Point
  b: Point
  style: Style
}
export interface ArrowAnno extends BaseAnno {
  type: 'arrow'
  a: Point
  b: Point
  style: Style
}
export interface RectAnno extends BaseAnno {
  type: 'rect'
  rect: { x: number; y: number; w: number; h: number }
  style: Style
}
export interface EllipseAnno extends BaseAnno {
  type: 'ellipse'
  rect: { x: number; y: number; w: number; h: number }
  style: Style
}
export interface HighlightAnno extends BaseAnno {
  type: 'highlight'
  rect: { x: number; y: number; w: number; h: number }
  style: Style
}
export interface TextAnno extends BaseAnno {
  type: 'text'
  pos: Point
  text: string
  textStyle: TextStyle
}
export interface MosaicAnno extends BaseAnno {
  type: 'mosaic'
  /** 涂抹轨迹（逐点打码） */
  points: Point[]
  /** 每格边长（越大马赛克越粗） */
  cell: number
  /** 颗粒形状：rect=方块，round=球状圆点 */
  shape: 'rect' | 'round'
}
export interface SerialAnno extends BaseAnno {
  type: 'serial'
  /** 圆心（图片像素） */
  pos: Point
  /** 序号数字 */
  number: number
  /** 可选说明文字 */
  text: string
  /** 圆半径（图片像素） */
  radius: number
  textStyle: TextStyle
}

export type Annotation =
  | PenAnno
  | LineAnno
  | ArrowAnno
  | RectAnno
  | EllipseAnno
  | HighlightAnno
  | TextAnno
  | MosaicAnno
  | SerialAnno

let idCounter = 1
export function genId(): string {
  return `a${Date.now()}_${idCounter++}`
}

// ── 绘制 ──

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  anno: Annotation,
  /** 马赛克需要访问原图 */
  source?: CanvasImageSource
): void {
  ctx.save()
  switch (anno.type) {
    case 'pen': {
      if (anno.points.length < 2) break
      ctx.strokeStyle = anno.style.color
      ctx.lineWidth = anno.style.lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(anno.points[0].x, anno.points[0].y)
      for (let i = 1; i < anno.points.length; i++) ctx.lineTo(anno.points[i].x, anno.points[i].y)
      ctx.stroke()
      break
    }
    case 'line':
    case 'arrow': {
      const cp = ctx
      cp.strokeStyle = anno.style.color
      cp.lineWidth = anno.style.lineWidth
      cp.lineCap = 'round'
      cp.beginPath()
      cp.moveTo(anno.a.x, anno.a.y)
      cp.lineTo(anno.b.x, anno.b.y)
      cp.stroke()
      if (anno.type === 'arrow') {
        const ang = Math.atan2(anno.b.y - anno.a.y, anno.b.x - anno.a.x)
        const head = Math.max(10, anno.style.lineWidth * 3)
        const a = head
        cp.beginPath()
        cp.moveTo(anno.b.x, anno.b.y)
        cp.lineTo(
          anno.b.x - Math.cos(ang - 0.5) * a,
          anno.b.y - Math.sin(ang - 0.5) * a
        )
        cp.lineTo(
          anno.b.x - Math.cos(ang + 0.5) * a,
          anno.b.y - Math.sin(ang + 0.5) * a
        )
        cp.closePath()
        cp.fillStyle = anno.style.color
        cp.fill()
      }
      break
    }
    case 'rect': {
      if (anno.style.fill) {
        ctx.fillStyle = anno.style.color
        ctx.globalAlpha = 0.35
        ctx.fillRect(anno.rect.x, anno.rect.y, anno.rect.w, anno.rect.h)
        ctx.globalAlpha = 1
      }
      ctx.strokeStyle = anno.style.color
      ctx.lineWidth = anno.style.lineWidth
      ctx.strokeRect(anno.rect.x, anno.rect.y, anno.rect.w, anno.rect.h)
      break
    }
    case 'ellipse': {
      ctx.beginPath()
      ctx.ellipse(
        anno.rect.x + anno.rect.w / 2,
        anno.rect.y + anno.rect.h / 2,
        anno.rect.w / 2,
        anno.rect.h / 2,
        0,
        0,
        Math.PI * 2
      )
      if (anno.style.fill) {
        ctx.fillStyle = anno.style.color
        ctx.globalAlpha = 0.35
        ctx.fill()
        ctx.globalAlpha = 1
      }
      ctx.strokeStyle = anno.style.color
      ctx.lineWidth = anno.style.lineWidth
      ctx.stroke()
      break
    }
    case 'highlight': {
      ctx.fillStyle = anno.style.color
      ctx.globalAlpha = 0.4
      ctx.fillRect(anno.rect.x, anno.rect.y, anno.rect.w, anno.rect.h)
      ctx.globalAlpha = 1
      break
    }
    case 'text': {
      ctx.font = `${anno.textStyle.bold ? 'bold ' : ''}${anno.textStyle.size}px sans-serif`
      ctx.fillStyle = anno.textStyle.color
      ctx.textBaseline = 'top'
      // 支持多行
      const lines = anno.text.split('\n')
      lines.forEach((ln, i) => {
        ctx.fillText(ln, anno.pos.x, anno.pos.y + i * (anno.textStyle.size * 1.2))
      })
      break
    }
    case 'serial': {
      const r = anno.radius
      // 圆点序号
      ctx.beginPath()
      ctx.arc(anno.pos.x, anno.pos.y, r, 0, Math.PI * 2)
      ctx.fillStyle = anno.textStyle.color
      ctx.fill()
      // 白字居中
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 ${Math.max(10, r)}px sans-serif`
      ctx.fillText(String(anno.number), anno.pos.x, anno.pos.y + 1)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      // 说明文字排右侧
      if (anno.text) {
        ctx.fillStyle = anno.textStyle.color
        ctx.font = `${anno.textStyle.size}px sans-serif`
        ctx.fillText(anno.text, anno.pos.x + r + 8, anno.pos.y + r / 2)
      }
      break
    }
    case 'mosaic': {
      if (!source || !anno.points.length) break
      const cell = anno.cell
      // 涂抹式打码：沿轨迹在每个点处盖一个 cell 大小的颗粒。
      // 圆/方都从**未变色的原图 source** 采样 1px 放大成 cell 颗粒：
      // 若从当前画布采样（旧实现 getImageData），已打码区域会让颜色随区域漂移"乱变色"。
      for (const p of anno.points) {
        if (anno.shape === 'round') {
          ctx.save()
          ctx.beginPath()
          ctx.arc(p.x, p.y, cell / 2, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(source, p.x, p.y, 1, 1, p.x - cell / 2, p.y - cell / 2, cell, cell)
          ctx.restore()
        } else {
          ctx.drawImage(source, p.x, p.y, 1, 1, p.x - cell / 2, p.y - cell / 2, cell, cell)
        }
      }
      break
    }
  }
  ctx.restore()
}

// ── 撤销/重做（快照栈） ──

export class History {
  private undoStack: Annotation[][] = []
  private redoStack: Annotation[][] = []

  constructor(private onChange?: () => void) {
    // 初始空快照作基准：使「新增第一个标注后立即撤销」也能把首个标注撤掉——
    // 若栈首直接是「当前状态」，第一次 undo 弹出等价的当前快照，看起来像"撤不掉"。
    // 基准不算可撤销操作，故 canUndo 以长度 > 1 判断。
    this.undoStack.push([])
  }

  get canUndo(): boolean {
    return this.undoStack.length > 1
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  push(list: Annotation[]): void {
    const snap = clone(list)
    // 去重：若与栈顶快照完全相同（无实际改动），不重复入栈，避免"撤一步没变化"的错觉
    const top = this.undoStack[this.undoStack.length - 1]
    if (top && sameList(top, snap)) return
    this.undoStack.push(snap)
    this.redoStack.length = 0
    this.onChange?.()
  }

  undo(currList: Annotation[]): Annotation[] {
    if (!this.undoStack.length) return currList
    this.redoStack.push(clone(currList))
    const prev = this.undoStack.pop()!
    this.onChange?.()
    return prev
  }

  redo(currList: Annotation[]): Annotation[] {
    if (!this.redoStack.length) return currList
    this.undoStack.push(clone(currList))
    const next = this.redoStack.pop()!
    this.onChange?.()
    return next
  }

  reset(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.onChange?.()
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 两个标注列表是否完全一致（用于历史去重） */
function sameList(a: Annotation[], b: Annotation[]): boolean {
  if (a.length !== b.length) return false
  return JSON.stringify(a) === JSON.stringify(b)
}