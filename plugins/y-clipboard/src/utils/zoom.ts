/**
 * 全屏图片预览的缩放 / 平移数学。
 *
 * 抽成纯函数是为了能被 design/check-zoom.mts 直接测 —— "锚点缩放 + 边界夹取"
 * 这类东西肉眼看画面验不出来：差几十像素的表现就是"图片怎么越滚越飘"，
 * 但截图上根本看不出所以然。
 *
 * 约定：图片先由 CSS 的 max-width/max-height 缩到"适应窗口"的尺寸 baseW×baseH，
 * 之后所有变换都走 `transform: translate(offset) scale(zoom)`。
 * 所以 zoom = 1 就是"适应窗口"，缩放不改动布局尺寸（不影响虚拟列表之类的度量）。
 *
 * 坐标系：offset 与鼠标位置都以**容器中心为原点**，右/下为正。
 */

/** 缩放下限：再小就看不清了（也防止一滚就缩成一个点） */
export const MIN_ZOOM = 0.2
/** 缩放上限：截图像素有限，放到 12 倍已经全是马赛克 */
export const MAX_ZOOM = 12
/** 双击在「适应」与「这个倍数」之间来回切 */
export const DBLCLICK_ZOOM = 2
/** 点 +/- 按钮每档的倍数（连点 4 下正好 2.44 倍，手感与滚轮接近） */
export const STEP_ZOOM = 1.25

export interface Vec {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z) || z <= 0) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/**
 * 把不同浏览器的滚轮量统一成像素。
 * deltaMode：0=像素（Chrome/Safari 约 ±100）、1=行（Firefox 约 ±3）、2=页。
 */
export function wheelDelta(e: { deltaY: number; deltaMode?: number }): number {
  const d = e.deltaY
  switch (e.deltaMode) {
    case 1:
      return d * 16
    case 2:
      return d * 400
    default:
      return d
  }
}

/** 每像素滚轮的缩放强度 */
const ZOOM_PER_PX = 0.0018

/**
 * 滚轮缩放：向上滚（deltaY < 0）放大。
 * 用指数而不是加减固定值 —— 倍数缩放的手感才不会在 0.3 倍和 8 倍之间忽大忽小。
 */
export function zoomByWheel(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY * ZOOM_PER_PX))
}

/**
 * 以 (mx, my) 为锚点缩放：鼠标底下那一点缩放前后停在原地。
 * 不做锚点的话，放大后图片会朝中心跑，用户想看的局部一下就漂走了。
 *
 * 推导：缩放前后鼠标对应的图片坐标不变
 *   (m - offset) / zoom === (m - offset') / zoom'
 * ⇒ offset' = m - (m - offset) * (zoom' / zoom)
 */
export function zoomAt(offset: Vec, zoom: number, next: number, mx: number, my: number): Vec {
  const k = next / zoom
  return {
    x: mx - (mx - offset.x) * k,
    y: my - (my - offset.y) * k,
  }
}

/**
 * 限制平移范围：
 * - 图片比容器大：最多把图片边缘拖到容器边缘（不至于拖出去留一大块空白）
 * - 图片比容器小：锁死居中（否则能拖出一整片背景）
 */
export function clampOffset(offset: Vec, zoom: number, base: Size, stage: Size): Vec {
  const maxX = Math.max(0, (base.w * zoom - stage.w) / 2)
  const maxY = Math.max(0, (base.h * zoom - stage.h) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  }
}

/**
 * CSS 的 max-width/max-height: 100% 的效果：等比缩到能塞进容器，但不放大。
 * 用来兜底 —— 图片还没显示出来（display:none）时量不到布局尺寸，
 * 此时按原始像素算基准尺寸，缩放/平移照样正确。
 */
export function fitSize(natural: Size, stage: Size): Size {
  if (!natural.w || !natural.h || !stage.w || !stage.h) return { w: 0, h: 0 }
  const k = Math.min(1, stage.w / natural.w, stage.h / natural.h)
  return { w: natural.w * k, h: natural.h * k }
}

/** 当前是否还有得拖（有溢出才平移，否则拖了没反应会让人以为卡住了） */
export function canPan(zoom: number, base: Size, stage: Size): boolean {
  return base.w * zoom > stage.w + 0.5 || base.h * zoom > stage.h + 0.5
}

/**
 * 1:1 原始像素：base 是"适应窗口"后的显示宽度。
 * 图片本来就不比窗口大的时候，1:1 就等于不缩放（显示 100%）。
 */
export function actualZoom(naturalW: number, baseW: number): number {
  if (!naturalW || !baseW) return 1
  return clampZoom(naturalW / baseW)
}
