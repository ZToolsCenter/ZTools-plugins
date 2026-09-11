/**
 * 标注画布交互控制器
 *
 * 交互范式：**实时拖动绘制**。
 *   - 选择(select)：由 EditorPanel 接管 → 拖动=移动窗口，不进入这里，不做删除。
 *   - 画笔(pen)：按下起笔、拖动成线、松开提交。
 *   - 区间工具(rect/ellipse/line/arrow/highlight/mosaic)：按下定起点、拖动实时预览、松开成形。
 *   - 文字(text)：点击定位 → 弹输入框（commitText 落地）。
 */
import { Annotation, TextAnno, SerialAnno, ToolKind, drawAnnotation, History, genId, Point } from './annotations'

export interface ToolSettings {
  style: { color: string; lineWidth: number; fill?: boolean }
  textStyle: { color: string; size: number; bold: boolean }
  mosaicCell: number
  mosaicShape: 'rect' | 'round'
}

const DEFAULT_TOOL: ToolKind = 'select'
const DEFAULT_STYLE = { color: '#e5484d', lineWidth: 3 }
const DEFAULT_TEXT_STYLE = { color: '#e5484d', size: 28, bold: false }

/** 区间型（按下拖动实时预览）工具的集合。马赛克为自由涂抹工具，不在其列。 */
const SHAPE_TOOLS: ToolKind[] = ['rect', 'ellipse', 'line', 'arrow', 'highlight']

/** 正在绘制的草稿：a=起点，b=随指针更新的终点；pen 存画笔轨迹 */
interface Draft {
  tool: ToolKind
  a: Point
  b: Point
  pen?: Point[]
}

export class EditorController {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private source: CanvasImageSource

  private list: Annotation[] = []
  private history: History

  currentTool: ToolKind = DEFAULT_TOOL
  settings: ToolSettings = {
    style: { ...DEFAULT_STYLE },
    textStyle: { ...DEFAULT_TEXT_STYLE },
    mosaicCell: 14,
    mosaicShape: 'rect'
  }

  /** 就原框就地编辑请求：Vue 在文字原包围盒位置渲染透明编辑层，输入完调 commitText */
  onTextRequest: ((rect: { x: number; y: number; w: number; h: number }) => void) | null = null
  /** 选中目标变化/文字字号缩放后被调用，用于 Vue 回显工具栏样式 */
  onSelectionChange: (() => void) | null = null

  // ── 实时绘制状态 ──
  private draft: Draft | null = null
  private pendingTextPos: Point | null = null
  /** 选择工具命中的标注 id；用于二次编辑/删除 */
  private selectedId: string | null = null
  /** 正在重新编辑的既有文字标注 id（区别于新建 pendingTextPos） */
  private editingTextId: string | null = null
  /** 正在输入说明文字的序号标注 id（serial 的说明文字） */
  private editingSerialId: string | null = null
  /** 序号标注数字递增器 */
  private serialCounter = 1
  /** 拖动选中标注时是否已记录拖前状态（首次 move 才 push，避免单击命中误记撤销） */
  private draggedOnce = false
  /** 缩放手柄：当前命中的手柄 index 与拖动起始几何快照（-1=未在缩放） */
  private resizeHandle = -1
  private resizeKind: 'box' | 'endpoint' | null = null
  private resizeStart: { x: number; y: number; w: number; h: number; size: number } | null = null
  private resizedOnce = false

  constructor(
    canvas: HTMLCanvasElement,
    source: CanvasImageSource,
    width: number,
    height: number,
    onDirty?: () => void
  ) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    canvas.width = width
    canvas.height = height
    this.source = source
    this.history = new History(onDirty)
  }

  get annotations(): Annotation[] {
    return this.list
  }
  get canvasElement(): HTMLCanvasElement {
    return this.canvas
  }
  get canUndo(): boolean {
    return this.history.canUndo
  }
  get canRedo(): boolean {
    return this.history.canRedo
  }
  /** 是否正在实时绘制（指针按下未松开） */
  get hasDrawing(): boolean {
    return this.draft !== null
  }

  // ── 工具栏指令 ──

  setTool(tool: ToolKind): void {
    this.currentTool = tool
    this.clearDraft()
    this.render()
  }
  setColor(color: string): void {
    this.settings.style.color = color
    this.settings.textStyle.color = color
  }
  setLineWidth(w: number): void {
    this.settings.style.lineWidth = w
  }
  setFill(fill: boolean): void {
    this.settings.style.fill = fill
  }
  setMosaicCell(c: number): void {
    this.settings.mosaicCell = c
  }
  setMosaicShape(s: 'rect' | 'round'): void {
    this.settings.mosaicShape = s
  }
  setTextSize(size: number): void {
    this.settings.textStyle.size = size
  }
  setTextBold(bold: boolean): void {
    this.settings.textStyle.bold = bold
  }

  undo(): void {
    this.clearPending()
    this.list = this.history.undo(this.list)
    this.render()
  }
  redo(): void {
    this.list = this.history.redo(this.list)
    this.render()
  }

  // ── 实时绘制交互 ──

  /** 指针按下：按当前工具开始（select 由 EditorPanel 接管移窗，不调用） */
  pointerDown(x: number, y: number): void {
    const t = this.currentTool
    if (t === 'select') return
    if (t === 'text') {
      this.pendingTextPos = { x, y }
      this.onTextRequest?.({ x, y, w: 0, h: 0 })
      return
    }
    if (t === 'serial') {
      this.createSerial({ x, y })
      return
    }
    // pen / mosaic：按自由轨迹绘制（mosaic 即涂抹打码）
    if (t === 'pen' || t === 'mosaic') {
      this.draft = { tool: t, a: { x, y }, b: { x, y }, pen: [{ x, y }] }
    } else if (SHAPE_TOOLS.includes(t)) {
      this.draft = { tool: t, a: { x, y }, b: { x, y } }
    }
    this.render()
  }

  /** 指针移动：更新草稿端点 / 画笔轨迹 */
  pointerMove(x: number, y: number): void {
    const d = this.draft
    if (!d) return
    if (d.tool === 'pen') {
      const p = d.pen!
      const last = p[p.length - 1]
      if (Math.abs(last.x - x) + Math.abs(last.y - y) >= 1) p.push({ x, y })
    } else if (d.tool === 'mosaic') {
      // 涂抹：以格径一半为步长在轨迹上插值补点，保证拖动连续无缝隙
      const p = d.pen!
      const last = p[p.length - 1]
      const dx = x - last.x
      const dy = y - last.y
      const dist = Math.hypot(dx, dy)
      const step = Math.max(2, Math.round(this.settings.mosaicCell / 2))
      if (dist >= step) {
        const n = Math.ceil(dist / step)
        for (let i = 1; i <= n; i++) p.push({ x: last.x + (dx * i) / n, y: last.y + (dy * i) / n })
      }
    }
    d.b = { x, y }
    this.render()
  }

  /** 指针松开：提交当前草稿入栈 */
  pointerUp(): void {
    const d = this.draft
    if (!d) return
    this.draft = null
    if (d.tool === 'pen') {
      this.finishPen(d.pen ?? [{ ...d.a }])
    } else if (d.tool === 'mosaic') {
      this.finishMosaic(d.pen ?? [{ ...d.a }])
    } else {
      this.completeShape(d.tool, d.a, d.b)
    }
    this.render()
  }

  // ── 选择/二次编辑 ──

  /** 选择工具单击：命中标注→选中；未命中→清空选中。返回是否命中 */
  selectAt(x: number, y: number): boolean {
    const idx = this.lastAt(x, y)
    if (idx < 0) {
      this.selectedId = null
      this.render()
      this.onSelectionChange?.()
      return false
    }
    this.selectedId = this.list[idx].id
    this.render()
    this.onSelectionChange?.()
    return true
  }

  /** 当前选中的标注（无则 null） */
  get selected(): Annotation | null {
    return this.selectedId ? (this.list.find((a) => a.id === this.selectedId) ?? null) : null
  }

  /** 删除当前选中的标注 */
  deleteSelected(): void {
    if (!this.selectedId) return
    this.list = this.list.filter((a) => a.id !== this.selectedId)
    this.selectedId = null
    this.history.push(this.list)
    this.render()
    this.onSelectionChange?.()
  }

  /** 若选中的是文字/序号说明，触发就原框就地编辑（交出精确包围盒与回填文字，Vue 在其原位置渲染编辑层） */
  startEditSelectedText(): void {
    const sel = this.selected
    if (!sel || (sel.type !== 'text' && sel.type !== 'serial')) return
    if (sel.type === 'text') {
      this.editingTextId = sel.id
      const tb = this.textBounds(sel)
      this.onTextRequest?.({
        x: tb.x,
        y: tb.y,
        w: Math.max(tb.w, sel.textStyle.size),
        h: Math.max(tb.h, sel.textStyle.size)
      })
      this.render()
      return
    }
    this.editingSerialId = sel.id
    const sb = this.serialBounds(sel)
    this.onTextRequest?.({ x: sb.x, y: sb.y, w: sb.w, h: sb.h })
    this.render()
  }

  /** 把文字样式(字号/粗体/颜色)部分应用到选中的文字/序号。返回是否实际改动。 */
  applyStyleToSelected(partial: Partial<{ size: number; bold: boolean; color: string }>): boolean {
    const sel = this.selected
    if (!sel || (sel.type !== 'text' && sel.type !== 'serial')) return false
    const next = { ...sel.textStyle, ...partial }
    if (next.size === sel.textStyle.size && next.bold === sel.textStyle.bold && next.color === sel.textStyle.color) return false
    this.history.push(this.list)
    this.list = this.list.map((a) => {
      if (a.id !== sel.id) return a
      if (a.type === 'serial' && next.size !== a.textStyle.size) {
        const k = next.size / Math.max(a.textStyle.size, 1)
        return { ...a, textStyle: next, radius: Math.max(6, Math.round(a.radius * k)) } as Annotation
      }
      if (a.type === 'text' || a.type === 'serial') return { ...a, textStyle: next } as Annotation
      return a
    })
    this.render()
    return true
  }

  /** 当前选中文字/序号的样式，供工具栏回显；非文字返回 null。 */
  getSelectedTextStyle(): { size: number; bold: boolean; color: string } | null {
    const sel = this.selected
    return sel && (sel.type === 'text' || sel.type === 'serial')
      ? { size: sel.textStyle.size, bold: sel.textStyle.bold, color: sel.textStyle.color }
      : null
  }

  /** 判断点是否命中当前选中的标注（select 拖动手势分派用） */
  hitSelectedAt(x: number, y: number): boolean {
    const sel = this.selected
    return sel ? this.hitTest(sel, x, y) : false
  }

  /** 命中选中标注并开始拖动。返回是否命中启动。拖前状态在首次 move 时入栈（见 moveSelectedBy）。 */
  beginDragSelected(x: number, y: number): boolean {
    const sel = this.selected
    if (!sel) return false
    if (!this.hitTest(sel, x, y)) return false
    this.draggedOnce = false
    return true
  }

  /** 平移当前选中的标注（整体移动 dx,dy 像素；纯本地改坐标，零 IPC、不掉帧） */
  moveSelectedBy(dx: number, dy: number): void {
    const id = this.selected?.id
    if (!id) return
    if (!this.draggedOnce) {
      this.draggedOnce = true
      this.history.push(this.list)
    }
    this.list = this.list.map((a) => {
      if (a.id !== id) return a
      switch (a.type) {
        case 'text':
          return { ...a, pos: { x: a.pos.x + dx, y: a.pos.y + dy } } as Annotation
        case 'serial':
          return { ...a, pos: { x: a.pos.x + dx, y: a.pos.y + dy } } as Annotation
        case 'pen':
        case 'mosaic':
          return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } as Annotation
        case 'line':
        case 'arrow':
          return {
            ...a,
            a: { x: a.a.x + dx, y: a.a.y + dy },
            b: { x: a.b.x + dx, y: a.b.y + dy }
          } as Annotation
        default:
          return {
            ...a,
            rect: { x: a.rect.x + dx, y: a.rect.y + dy, w: a.rect.w, h: a.rect.h }
          } as Annotation
      }
    })
    this.render()
  }

  /** 选中标注拖动结束（拖前状态已在首次 move 时入栈，无需额外记录） */
  endDragSelected(): void {
    this.draggedOnce = false
  }

  // ── 缩放手柄（改变标注大小/缩放文字） ──

  /**
   * 选中标注的缩放手柄位置（画布像素）。
   *  rect/ellipse/highlight/mosaic: 8 点 —— 4 角(nw,ne,se,sw) + 4 边中点(n,e,s,w)，可单边拖拽；
   *  text/pen: 4 个角（对角等比缩放）；line/arrow: 两个端点(a,b)。未选中返回 []。
   */
  handlePositions(sel: Annotation): Point[] {
    switch (sel.type) {
      case 'line':
      case 'arrow':
        return [{ ...sel.a }, { ...sel.b }]
      default: {
        const b = this.annoBounds(sel)
        if (!b) return []
        const pts = [
          { x: b.x, y: b.y }, // 0 nw
          { x: b.x + b.w, y: b.y }, // 1 ne
          { x: b.x + b.w, y: b.y + b.h }, // 2 se
          { x: b.x, y: b.y + b.h } // 3 sw
        ]
        if (sel.type === 'text' || sel.type === 'pen' || sel.type === 'serial' || sel.type === 'mosaic') return pts
        const mx = b.x + b.w / 2
        const my = b.y + b.h / 2
        pts.push(
          { x: mx, y: b.y }, // 4 n
          { x: b.x + b.w, y: my }, // 5 e
          { x: mx, y: b.y + b.h }, // 6 s
          { x: b.x, y: my } // 7 w
        )
        return pts
      }
    }
  }

  /** 点是否命中当前选中标注的任一手柄（命中才能拖拽缩放） */
  hitHandleAt(x: number, y: number): boolean {
    const sel = this.selected
    if (!sel) return false
    const tol = 8
    return this.handlePositions(sel).some(
      (h) => Math.abs(h.x - x) <= tol && Math.abs(h.y - y) <= tol
    )
  }

  /** 命中手柄并开始缩放（须已选中；未命中则忽略）。返回命中的手柄 index，-1 表示未命中。 */
  beginResize(x: number, y: number): boolean {
    const sel = this.selected
    if (!sel) return false
    const hl = this.handlePositions(sel)
    const tol = 8
    let idx = -1
    for (let i = 0; i < hl.length; i++) {
      if (Math.abs(hl[i].x - x) <= tol && Math.abs(hl[i].y - y) <= tol) {
        idx = i
        break
      }
    }
    if (idx < 0) return false
    this.resizeHandle = idx
    this.resizeKind = sel.type === 'line' || sel.type === 'arrow' ? 'endpoint' : 'box'
    const b = this.annoBounds(sel)!
    this.resizeStart = { x: b.x, y: b.y, w: b.w, h: b.h, size: sel.type === 'text' ? sel.textStyle.size : 0 }
    this.resizedOnce = false
    return true
  }

  /** 缩放更新：指针在画布像素里的新坐标。所有缩放均在首次 move 时把拖前状态入撤销栈。 */
  resizeTo(nx: number, ny: number): void {
    const sel = this.selected
    const s = this.resizeStart
    if (!sel || !s || this.resizeHandle < 0) return
    // line/arrow：端点跟随（另一端点不动）
    if (this.resizeKind === 'endpoint') {
      if (!this.resizedOnce) {
        this.resizedOnce = true
        this.history.push(this.list)
      }
      const target = this.resizeHandle === 0 ? 'a' : 'b'
      this.list = this.list.map((a) =>
        a.id !== sel.id ? a : target === 'a' ? { ...a, a: { x: nx, y: ny } } : { ...a, b: { x: nx, y: ny } }
      ) as Annotation[]
      this.render()
      return
    }
    // text：等比缩放字号（角对称锚点）。用锚点→指针距离比原锚→起始手柄距离
    if (sel.type === 'text') {
      const anchor = this.resizeAnchor(s, this.resizeHandle)
      const d0 = Math.hypot(s.x + s.w - anchor.x, s.y + s.h - anchor.y)
      const d1 = Math.hypot(nx - anchor.x, ny - anchor.y)
      const newSize = Math.max(8, Math.round(sel.textStyle.size * (d1 / Math.max(d0, 0.001))))
      if (!this.resizedOnce) {
        this.resizedOnce = true
        this.history.push(this.list)
      }
      this.list = this.list.map((a) =>
        a.id === sel.id && a.type === 'text' ? { ...a, textStyle: { ...a.textStyle, size: newSize } } : a
      )
      this.render()
      this.onSelectionChange?.()
      return
    }
    // serial：整体等比缩放圆点半径（含说明文字字号），对角对称锚点
    if (sel.type === 'serial') {
      const anchor = this.resizeAnchor(s, this.resizeHandle)
      const d0 = Math.hypot(s.x + s.w - anchor.x, s.y + s.h - anchor.y)
      const d1 = Math.hypot(nx - anchor.x, ny - anchor.y)
      const k = d1 / Math.max(d0, 0.001)
      if (!this.resizedOnce) {
        this.resizedOnce = true
        this.history.push(this.list)
      }
      this.list = this.list.map((a) =>
        a.id === sel.id && a.type === 'serial' ? { ...a, radius: Math.max(6, Math.round(a.radius * k)), textStyle: { ...a.textStyle, size: Math.max(10, Math.round(a.textStyle.size * k)) } } : a
      )
      this.render()
      this.onSelectionChange?.()
      return
    }
    // box 系(rect/ellipse/highlight)：对角固定的 W/H 缩放
    // pen / mosaic：整体等比缩放 points
    if (!this.resizedOnce) {
      this.resizedOnce = true
      this.history.push(this.list)
    }
    if (sel.type === 'pen' || sel.type === 'mosaic') {
      const anchor = this.resizeAnchor(s, this.resizeHandle)
      const startH = { x: s.x + (this.resizeHandle === 1 || this.resizeHandle === 2 ? s.w : 0), y: s.y + (this.resizeHandle >= 2 ? s.h : 0) }
      const k = (Math.abs(nx - anchor.x) + Math.abs(ny - anchor.y)) / Math.max((Math.abs(startH.x - anchor.x) + Math.abs(startH.y - anchor.y)) || 1, 1)
      this.list = this.list.map((a) =>
        (a.id === sel.id) && (a.type === 'pen' || a.type === 'mosaic')
          ? { ...a, points: a.points.map((p) => ({ x: anchor.x + (p.x - anchor.x) * k, y: anchor.y + (p.y - anchor.y) * k })) }
          : a
      )
      this.render()
      return
    }
    // rect 系：按命中手柄改 bbox（对角线上的对角 / 单边锚定对边）
    let nx0 = s.x
    let ny0 = s.y
    let nw = s.w
    let nh = s.h
    const min = 2
    switch (this.resizeHandle) {
      case 0: // nw：右下固定
        nw = s.x + s.w - nx
        nh = s.y + s.h - ny
        nx0 = nx
        ny0 = ny
        break
      case 1: // ne：左下固定
        nw = nx - s.x
        nh = s.y + s.h - ny
        ny0 = ny
        break
      case 2: // se：左上固定
        nw = nx - s.x
        nh = ny - s.y
        break
      case 3: // sw：右上固定
        nw = s.x + s.w - nx
        nh = ny - s.y
        nx0 = nx
        break
      case 4: // n：下边固定，只动上边
        nh = s.y + s.h - ny
        ny0 = ny
        break
      case 5: // e：左边固定，只动右边
        nw = nx - s.x
        break
      case 6: // s：上边固定，只动下边
        nh = ny - s.y
        break
      case 7: // w：右边固定，只动左边
        nw = s.x + s.w - nx
        nx0 = nx
        break
    }
    nw = Math.max(min, nw)
    nh = Math.max(min, nh)
    this.list = this.list.map((a) =>
      a.id === sel.id ? { ...a, rect: { x: nx0, y: ny0, w: nw, h: nh } } : a
    ) as Annotation[]
    this.render()
  }

  /** 缩放结束（拖前状态已在首次 move 时入栈；未实际缩放则无副作用） */
  endResize(): void {
    this.resizeHandle = -1
    this.resizeKind = null
    this.resizeStart = null
    this.resizedOnce = false
  }

  /** 对角缩放的锚点：与命中角相对的那一角（固定不动） */
  private resizeAnchor(s: { x: number; y: number; w: number; h: number }, handle: number): Point {
    // handle: 0=nw,1=ne,2=se,3=sw → 锚点是对角
    switch (handle) {
      case 0:
        return { x: s.x + s.w, y: s.y + s.h }
      case 1:
        return { x: s.x, y: s.y + s.h }
      case 3:
        return { x: s.x + s.w, y: s.y }
      default:
        return { x: s.x, y: s.y }
    }
  }

  private lastAt(x: number, y: number): number {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.hitTest(this.list[i], x, y)) return i
    }
    return -1
  }

  private hitTest(a: Annotation, x: number, y: number): boolean {
    const tol = 6
    switch (a.type) {
      case 'text': {
        const tb = this.textBounds(a)
        return x >= tb.x - tol && x <= tb.x + tb.w + tol && y >= tb.y - tol && y <= tb.y + tb.h + tol
      }
      case 'serial': {
        const b = this.serialBounds(a)
        return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol
      }
      case 'pen':
        return a.points.some((p) => Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol)
      case 'line':
      case 'arrow':
        return distToSeg(x, y, a.a, a.b) <= Math.max(tol, a.style.lineWidth)
      case 'rect':
      case 'ellipse':
      case 'highlight':
        return (
          x >= a.rect.x - tol &&
          x <= a.rect.x + a.rect.w + tol &&
          y >= a.rect.y - tol &&
          y <= a.rect.y + a.rect.h + tol
        )
      case 'mosaic': {
        // 涂抹打码：命中的是任一轨迹点附近（格半径 + tol）
        const r = a.cell / 2 + tol
        return a.points.some((p) => Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r)
      }
    }
  }

  // ── 文字输入落地 ──

  /** serial 工具：在 pos 处创建一个序号标注，半径跟随字号，并弹出说明文字输入 */
  private createSerial(pos: Point): void {
    const size = this.settings.textStyle.size
    const radius = Math.max(10, size * 0.55)
    this.list = [
      ...this.list,
      {
        id: genId(),
        type: 'serial',
        pos: { ...pos },
        number: this.serialCounter++,
        text: '',
        radius,
        textStyle: { ...this.settings.textStyle, size: Math.max(12, Math.round(size * 0.6)) }
      }
    ]
    this.history.push(this.list)
    this.selectedId = this.list[this.list.length - 1].id
    this.render()
    this.onSelectionChange?.()
    // 立即请求输入说明文字（就原框就地编辑）
    const sel = this.selected
    if (sel && sel.type === 'serial') {
      this.editingSerialId = sel.id
      const sb = this.serialBounds(sel)
      this.onTextRequest?.({ x: sb.x, y: sb.y, w: sb.w, h: sb.h })
      this.render()
    }
  }

  /** 更新序号标注的说明文字（commit 时不含序号数字本身，避免误改数字） */
  private commitSerialText(id: string, text: string): void {
    const found = this.list.find((a) => a.id === id && a.type === 'serial')
    if (!found || found.type !== 'serial') return
    if (found.text === text) return
    this.list = this.list.map((a) => (a.id === id && a.type === 'serial' ? { ...a, text } : a))
    this.history.push(this.list)
    this.render()
    this.onSelectionChange?.()
  }

  commitText(text: string): void {
    // 序号说明文字提交
    if (this.editingSerialId) {
      const id = this.editingSerialId
      this.editingSerialId = null
      this.commitSerialText(id, text)
      return
    }
    // 重新编辑既有文字（覆盖原内容，保留位置/样式）
    if (this.editingTextId) {
      const id = this.editingTextId
      this.editingTextId = null
      this.list = this.list.map((a) =>
        a.id === id && a.type === 'text' ? { ...a, text } : a
      )
      this.history.push(this.list)
      this.render()
      return
    }
    // 新建文字
    if (!this.pendingTextPos) return
    const pos = this.pendingTextPos
    this.pendingTextPos = null
    if (!text.trim()) return
    this.list = [
      ...this.list,
      { id: genId(), type: 'text', pos: { ...pos }, text, textStyle: { ...this.settings.textStyle } }
    ]
    this.history.push(this.list)
    this.render()
  }
  cancelText(): void {
    this.pendingTextPos = null
    this.editingTextId = null
    this.editingSerialId = null
    this.render()
  }

  private clearDraft(): void {
    this.draft = null
  }
  private clearPending(): void {
    this.draft = null
    this.pendingTextPos = null
  }

  // ── 提交与命中 ──

  private finishPen(pts: Point[]): void {
    if (pts.length < 2) return
    this.list = [
      ...this.list,
      { id: genId(), type: 'pen', points: pts.map((p) => ({ ...p })), style: { ...this.settings.style } }
    ]
    this.history.push(this.list)
  }

  private finishMosaic(pts: Point[]): void {
    if (!pts.length) return
    this.list = [
      ...this.list,
      {
        id: genId(),
        type: 'mosaic',
        points: pts.map((p) => ({ ...p })),
        cell: this.settings.mosaicCell,
        shape: this.settings.mosaicShape
      }
    ]
    this.history.push(this.list)
  }

  private completeShape(t: ToolKind, a: Point, b: Point): void {
    const s = this.settings
    const baseId = genId()
    let anno: Annotation
    switch (t) {
      case 'line':
        anno = { id: baseId, type: 'line', a: { ...a }, b: { ...b }, style: { ...s.style } }
        break
      case 'arrow':
        anno = { id: baseId, type: 'arrow', a: { ...a }, b: { ...b }, style: { ...s.style } }
        break
      case 'rect': {
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        anno = {
          id: baseId,
          type: 'rect',
          rect: { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) },
          style: { ...s.style, fill: s.style.fill }
        }
        break
      }
      case 'ellipse': {
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        anno = {
          id: baseId,
          type: 'ellipse',
          rect: { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) },
          style: { ...s.style, fill: s.style.fill }
        }
        break
      }
      case 'highlight': {
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        anno = {
          id: baseId,
          type: 'highlight',
          rect: { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) },
          style: { ...s.style }
        }
        break
      }
      default:
        return
    }
    if (this.isMeaningful(anno)) {
      this.list = [...this.list, anno]
      this.history.push(this.list)
    }
  }

  // ── 渲染 ──

  private isMeaningful(a: Annotation): boolean {
    if (a.type === 'pen') return a.points.length >= 2
    if (a.type === 'mosaic') return a.points.length >= 1
    if (a.type === 'text') return a.text.length > 0
    if ('rect' in a) return a.rect.w >= 2 && a.rect.h >= 2
    if (a.type === 'line' || a.type === 'arrow') {
      return Math.abs(a.b.x - a.a.x) + Math.abs(a.b.y - a.a.y) >= 2
    }
    return true
  }

  /** 文字按内容实测的像素包围盒（多行：各行宽取最大、高按行数），与 drawAnnotation 渲染一致 */
  private textBounds(a: TextAnno): { x: number; y: number; w: number; h: number } {
    const lines = a.text.split('\n')
    this.ctx.font = `${a.textStyle.bold ? 'bold ' : ''}${a.textStyle.size}px sans-serif`
    let width = 0
    for (const ln of lines) width = Math.max(width, this.ctx.measureText(ln).width)
    const height = lines.length * a.textStyle.size * 1.2
    return { x: a.pos.x, y: a.pos.y, w: Math.max(width, 4), h: Math.max(height, a.textStyle.size) }
  }

  /** 序号标注包围盒（圆点+说明文字，含 padding） */
  private serialBounds(a: SerialAnno): { x: number; y: number; w: number; h: number } {
    let right = a.pos.x + a.radius * 2
    let bottom = a.pos.y + a.radius * 2
    if (a.text) {
      this.ctx.font = `${a.textStyle.size}px sans-serif`
      const tw = this.ctx.measureText(a.text).width
      right = Math.max(right, a.pos.x + a.radius + 8 + tw)
      bottom = Math.max(bottom, a.pos.y + a.textStyle.size)
    }
    return { x: a.pos.x - a.radius, y: a.pos.y - a.radius, w: right - (a.pos.x - a.radius), h: bottom - (a.pos.y - a.radius) }
  }

  /** 标注包围盒（供选中高亮） */
  private annoBounds(a: Annotation): { x: number; y: number; w: number; h: number } | null {
    switch (a.type) {
      case 'serial': {
        const sb = this.serialBounds(a)
        return { x: sb.x - 2, y: sb.y - 2, w: sb.w, h: sb.h }
      }
      case 'text': {
        const tb = this.textBounds(a)
        return { x: tb.x - 2, y: tb.y - 2, w: tb.w, h: tb.h }
      }
      case 'pen': {
        if (!a.points.length) return null
        let x1 = a.points[0].x
        let y1 = a.points[0].y
        let x2 = a.points[0].x
        let y2 = a.points[0].y
        for (const p of a.points) {
          x1 = Math.min(x1, p.x)
          y1 = Math.min(y1, p.y)
          x2 = Math.max(x2, p.x)
          y2 = Math.max(y2, p.y)
        }
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
      }
      case 'mosaic': {
        if (!a.points.length) return null
        const pad = a.cell / 2
        let x1 = a.points[0].x
        let y1 = a.points[0].y
        let x2 = a.points[0].x
        let y2 = a.points[0].y
        for (const p of a.points) {
          x1 = Math.min(x1, p.x)
          y1 = Math.min(y1, p.y)
          x2 = Math.max(x2, p.x)
          y2 = Math.max(y2, p.y)
        }
        return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + a.cell, h: y2 - y1 + a.cell }
      }
      case 'line':
      case 'arrow':
        return {
          x: Math.min(a.a.x, a.b.x),
          y: Math.min(a.a.y, a.b.y),
          w: Math.abs(a.b.x - a.a.x),
          h: Math.abs(a.b.y - a.a.y)
        }
      default:
        return { x: a.rect.x, y: a.rect.y, w: a.rect.w, h: a.rect.h }
    }
  }

  render(): void {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(this.source, 0, 0, w, h)
    for (const a of this.list) {
      // 就原框就地编辑期间：跳过该标注（文字由 DOM 编辑层「所见即所得」显示在原图上，避免重影）
      if (a.id === this.editingTextId || a.id === this.editingSerialId) continue
      drawAnnotation(ctx, a, this.source)
    }

    // 选中标注高亮（虚线蓝框）
    const sel = this.selected
    if (sel) {
      const b = this.annoBounds(sel)
      if (b) {
        ctx.save()
        ctx.setLineDash([5, 4])
        ctx.strokeStyle = '#3a76f0'
        ctx.lineWidth = 1.5
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8)
        ctx.restore()
      }
      // 缩放手柄（白色实心小方块，可供拖拽改大小/端点）
      ctx.save()
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#3a76f0'
      ctx.lineWidth = 1
      const hs = 4
      for (const h of this.handlePositions(sel)) {
        ctx.beginPath()
        ctx.rect(h.x - hs, h.y - hs, hs * 2, hs * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }

    // 绘制中的草稿预览
    const d = this.draft
    if (!d) return
    if (d.tool === 'pen') {
      const pts = d.pen!
      if (pts.length >= 2) {
        ctx.save()
        ctx.strokeStyle = this.settings.style.color
        ctx.lineWidth = this.settings.style.lineWidth
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()
        ctx.restore()
      }
      return
    }
    if (d.tool === 'mosaic') {
      // 涂抹预览：逐点实时画块（所见即所得）
      const pts = d.pen!
      if (pts.length) {
        drawAnnotation(ctx, {
          id: '',
          type: 'mosaic',
          points: pts.map((p) => ({ ...p })),
          cell: this.settings.mosaicCell,
          shape: this.settings.mosaicShape
        }, this.source)
      }
      return
    }
    const a = d.a
    const b = d.b
    const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
    let tmp: Annotation | null = null
    switch (d.tool) {
      case 'line':
        tmp = { id: '', type: 'line', a: { ...a }, b: { ...b }, style: { ...this.settings.style } }
        break
      case 'arrow':
        tmp = { id: '', type: 'arrow', a: { ...a }, b: { ...b }, style: { ...this.settings.style } }
        break
      case 'highlight':
        tmp = { id: '', type: 'highlight', rect: { ...r }, style: { ...this.settings.style } }
        break
      case 'rect':
        tmp = {
          id: '',
          type: 'rect',
          rect: { ...r },
          style: { ...this.settings.style, fill: this.settings.style.fill }
        }
        break
      case 'ellipse':
        tmp = {
          id: '',
          type: 'ellipse',
          rect: { ...r },
          style: { ...this.settings.style, fill: this.settings.style.fill }
        }
        break
      default:
        break
    }
    if (tmp) drawAnnotation(ctx, tmp, this.source)
  }
}

function distToSeg(x: number, y: number, a: Point, b: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  if (len2 === 0) return Math.hypot(x - a.x, y - a.y)
  let t = ((x - a.x) * vx + (y - a.y) * vy) / len2
  t = Math.max(0, Math.min(1, t))
  const px = a.x + t * vx
  const py = a.y + t * vy
  return Math.hypot(x - px, y - py)
}