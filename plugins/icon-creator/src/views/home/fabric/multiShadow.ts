import { Color, config, FabricObject, Group } from 'fabric'
import {
  getShadowEffectsMetadata,
  type AnyFabricObject,
  type ShadowEffectItem
} from './objectMetadata'

/**
 * 多阴影渲染模块：让一个对象同时生效任意数量的投影 / 内阴影。
 *
 * fabric 原生 shadow 只支持单个阴影（ctx.shadowBlur 一次只能挂一组参数），
 * 因此对象拥有多个启用的阴影效果时改为由本模块按 shadowEffects 元数据自绘：
 *
 * - 画布渲染：包装 FabricObject.prototype.drawObject。每个投影先画进离屏图层
 *   （对象 + ctx.shadow* 一次绘制），再以 destination-over 垫到缓存画布底部，
 *   与原生单阴影的半透明填充表现一致；内阴影用「形状 alpha − 偏移模糊 alpha」
 *   的刻削差得到内侧边缘带后叠在对象上。多阴影对象强制走独立缓存
 *   （needsItsOwnCache），并在缓存尺寸上补足阴影外扩，避免阴影被裁剪。
 * - SVG 导出：包装 _createBaseSVGMarkup，把全部阴影合成一个多分支 SVG filter
 *   （每条投影/内阴影独立支路 + feMerge），包一层 <g filter="url(#...)"> 输出。
 *
 * 单一投影仍走 fabric 原生 shadow（见 objectMetadata.applyShadowEffectsToFabricObject），
 * 本模块仅在多阴影 / 内阴影场景接管，保证存量文档渲染零回归。
 */

/** 读取对象当前启用的阴影效果列表（渲染热路径，只读不归一化）。 */
export function getEnabledShadowEffects(obj: FabricObject | null | undefined): ShadowEffectItem[] {
  const metadata = getShadowEffectsMetadata(obj)
  const list = metadata?.shadowEffects
  if (!Array.isArray(list)) return []
  return list.filter((effect): effect is ShadowEffectItem => !!effect && effect.enabled)
}

/**
 * 判断启用效果列表是否需要多阴影渲染：
 * 两个及以上效果，或唯一效果是内阴影（内阴影没有原生 shadow 对应实现）。
 */
export function isMultiShadowEffectList(effects: ShadowEffectItem[]) {
  if (effects.length >= 2) return true
  return effects.length === 1 && effects[0].type === 'inner'
}

/** 对象当前是否处于多阴影渲染接管状态。 */
export function isMultiShadowActive(obj: FabricObject | null | undefined) {
  return isMultiShadowEffectList(getEnabledShadowEffects(obj))
}

/** 单个阴影在对象本地坐标系下的外扩半径：模糊可见半径 + 最大偏移 + 少量余量。 */
function getEffectLocalExtent(effect: ShadowEffectItem) {
  return effect.blur + Math.max(Math.abs(effect.offsetX), Math.abs(effect.offsetY)) + 2
}

/** 从 ctx 变换矩阵取整体缩放（含对象缩放、视口 zoom、retina），用于阴影参数的设备像素换算。 */
function getMatrixScale(matrix: DOMMatrix) {
  return {
    scaleX: Math.hypot(matrix.a, matrix.b) || 1,
    scaleY: Math.hypot(matrix.c, matrix.d) || 1
  }
}

/** 按 fabric _setShadow 同源的缩放语义把阴影参数写到 ctx 上（shadow* 不受 CTM 影响，需手工缩放）。 */
function applyCanvasShadow(ctx: CanvasRenderingContext2D, effect: ShadowEffectItem, matrix: DOMMatrix) {
  const { scaleX, scaleY } = getMatrixScale(matrix)
  ctx.shadowColor = effect.color
  ctx.shadowBlur = effect.blur * (config.browserShadowBlurConstant || 1) * (scaleX + scaleY) / 2
  ctx.shadowOffsetX = effect.offsetX * scaleX
  ctx.shadowOffsetY = effect.offsetY * scaleY
}

function clearCanvasShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = ''
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

// ── 离屏图层池：拖拽等连续重渲染场景复用同尺寸画布，避免每帧反复创建 ──
const layerPool: HTMLCanvasElement[] = []
const MAX_POOLED_LAYERS = 8

function acquireLayer(width: number, height: number) {
  let canvas = layerPool.find(item => item.width === width && item.height === height)
  if (canvas) {
    layerPool.splice(layerPool.indexOf(canvas), 1)
  } else {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('离屏图层 2d 上下文获取失败')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, width, height)
  return { canvas, ctx }
}

function releaseLayer(canvas: HTMLCanvasElement) {
  if (layerPool.length >= MAX_POOLED_LAYERS) return
  layerPool.push(canvas)
}

type MultiShadowDrawContext = { zoomX?: number; zoomY?: number } & Record<string, unknown>

/**
 * 多阴影对象的 drawObject 替身：
 * 1. 每个投影画一层「对象 + 单阴影」的离屏图层后垫到目标画布底部（destination-over），
 *    阴影之间、阴影与下层对象之间的叠放次序与 Figma 等编辑器一致（效果列表靠前者在上）；
 * 2. 对象本体按原逻辑绘制；
 * 3. 每个内阴影生成内侧边缘带图层叠在对象上。
 */
function drawObjectWithMultiShadow(
  obj: AnyFabricObject,
  ctx: CanvasRenderingContext2D,
  effects: ShadowEffectItem[],
  forClipping: boolean,
  context: MultiShadowDrawContext
) {
  const width = Math.max(1, ctx.canvas.width)
  const height = Math.max(1, ctx.canvas.height)
  // 缓存路径下这是 cacheTranslation+zoom 的矩阵，直接路径下是视口×对象变换；
  // 图层内容与目标画布共用同一矩阵，最后以恒等矩阵 1:1 贴回。
  const baseMatrix = ctx.getTransform()
  const isCachePath = context?.zoomX != null
  const drops = effects.filter(effect => effect.type === 'drop')
  const inners = effects.filter(effect => effect.type === 'inner')

  // destination-over 把新图层垫到已有内容之下（先画者在顶），source-over 相反（后画者在顶）；
  // 两种合成模式各自需要相反的绘制次序，最终都保证「效果列表靠前的投影叠在上层」。
  const dropOrder = drops.map((_, index) => index)
  for (const index of isCachePath ? dropOrder : dropOrder.slice().reverse()) {
    const effect = drops[index]
    const layer = acquireLayer(width, height)
    layer.ctx.setTransform(baseMatrix)
    applyCanvasShadow(layer.ctx, effect, baseMatrix)
    ORIGINAL_DRAW_OBJECT.call(obj, layer.ctx, forClipping, context)
    clearCanvasShadow(layer.ctx)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // 缓存画布初始为空，destination-over 把投影垫到底部且不打扰后续对象绘制；
    // 非缓存兜底路径目标画布已有其他对象，改用剪影擦除避免阴影盖住更下层的对象。
    if (isCachePath) {
      ctx.globalCompositeOperation = 'destination-over'
    } else {
      layer.ctx.globalCompositeOperation = 'destination-out'
      ORIGINAL_DRAW_OBJECT.call(obj, layer.ctx, forClipping, context)
      layer.ctx.globalCompositeOperation = 'source-over'
    }
    ctx.drawImage(layer.canvas, 0, 0)
    ctx.restore()
    releaseLayer(layer.canvas)
  }

  ORIGINAL_DRAW_OBJECT.call(obj, ctx, forClipping, context)

  // 内阴影叠在对象之上（source-over 后画者在顶），倒序绘制保证列表靠前者在上。
  for (let index = inners.length - 1; index >= 0; index--) {
    const layer = createInnerShadowLayer(obj, width, height, baseMatrix, inners[index], forClipping, context)
    if (!layer) continue
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(layer.canvas, 0, 0)
    ctx.restore()
    releaseLayer(layer.canvas)
  }
}

/**
 * 生成内阴影图层：形状 alpha 减去「偏移 + 高斯模糊」后的 alpha 得到内侧边缘带，再染阴影色。
 * 模糊剪影用经典 shadow 技巧取得（把对象画到画面外足够远处，其 shadowBlur 阴影正好落回
 * 偏移位置），不依赖 ctx.filter，浏览器兼容性与投影一致。
 * 返回的画布由调用方 composite 后负责 releaseLayer。
 */
function createInnerShadowLayer(
  obj: AnyFabricObject,
  width: number,
  height: number,
  baseMatrix: DOMMatrix,
  effect: ShadowEffectItem,
  forClipping: boolean,
  context: MultiShadowDrawContext
) {
  const { scaleX, scaleY } = getMatrixScale(baseMatrix)
  const offsetXDevice = effect.offsetX * scaleX
  const offsetYDevice = effect.offsetY * scaleY
  const blurDevice = effect.blur * (config.browserShadowBlurConstant || 1) * (scaleX + scaleY) / 2

  // ① 形状层：完整对象外观，其 alpha 即形状剪影
  const shape = acquireLayer(width, height)
  shape.ctx.setTransform(baseMatrix)
  ORIGINAL_DRAW_OBJECT.call(obj, shape.ctx, forClipping, context)

  // ② 刻削层：本体左移出画面，阴影（设备像素偏移，不受 CTM 影响）落在「原位 + 效果偏移」处，
  //    得到偏移且模糊的剪影
  const carve = acquireLayer(width, height)
  const shiftDevice = width + blurDevice + Math.abs(offsetXDevice) + 8
  carve.ctx.setTransform(baseMatrix)
  carve.ctx.translate(-shiftDevice / Math.max(0.0001, scaleX), 0)
  carve.ctx.shadowColor = '#000000'
  carve.ctx.shadowBlur = blurDevice
  carve.ctx.shadowOffsetX = shiftDevice + offsetXDevice
  carve.ctx.shadowOffsetY = offsetYDevice
  ORIGINAL_DRAW_OBJECT.call(obj, carve.ctx, forClipping, context)
  clearCanvasShadow(carve.ctx)

  // ③ 从形状层刻掉模糊剪影 → 剩下内侧边缘带（仍被形状 alpha 约束在内侧）
  shape.ctx.save()
  shape.ctx.setTransform(1, 0, 0, 1, 0, 0)
  shape.ctx.globalCompositeOperation = 'destination-out'
  shape.ctx.drawImage(carve.canvas, 0, 0)
  shape.ctx.restore()
  releaseLayer(carve.canvas)

  // ④ 染色：source-in 让阴影色只落在边缘带的既有 alpha 上
  shape.ctx.save()
  shape.ctx.globalCompositeOperation = 'source-in'
  shape.ctx.fillStyle = effect.color
  shape.ctx.fillRect(0, 0, width, height)
  shape.ctx.restore()
  return shape
}

// ── 原型方法补丁 ──

type DrawObjectFn = (
  this: FabricObject,
  ctx: CanvasRenderingContext2D,
  forClipping: boolean,
  context: MultiShadowDrawContext
) => void
type CacheCanvasDimensions = { width: number; height: number; zoomX: number; zoomY: number; x: number; y: number }

const ORIGINAL_DRAW_OBJECT = FabricObject.prototype.drawObject as unknown as DrawObjectFn
// Group 覆写了 drawObject（逐个渲染子对象），必须单独保留原始实现并单独打补丁
const ORIGINAL_GROUP_DRAW_OBJECT = Group.prototype.drawObject as unknown as DrawObjectFn
const ORIGINAL_GET_CACHE_CANVAS_DIMENSIONS = FabricObject.prototype._getCacheCanvasDimensions as unknown as
  ((this: FabricObject) => CacheCanvasDimensions)
const ORIGINAL_NEEDS_ITS_OWN_CACHE = FabricObject.prototype.needsItsOwnCache as unknown as
  ((this: FabricObject) => boolean)
const ORIGINAL_CREATE_BASE_SVG_MARKUP = FabricObject.prototype._createBaseSVGMarkup as unknown as
  ((this: FabricObject, objectMarkup: string[], options?: Record<string, unknown>) => string)

/** 递归收集组内子对象（含嵌套组）的阴影本地外扩半径最大值，用于组缓存补边。 */
function getDescendantShadowExtent(obj: AnyFabricObject, depth: number): number {
  if (depth > 8) return 0
  const children = obj._objects as AnyFabricObject[] | undefined
  if (!Array.isArray(children)) return 0
  let max = 0
  for (const child of children) {
    const scale = Math.max(Math.abs(Number(child.scaleX) || 1), Math.abs(Number(child.scaleY) || 1))
    const effects = getEnabledShadowEffects(child)
    const own = effects.length ? Math.max(...effects.map(getEffectLocalExtent)) : 0
    max = Math.max(max, own * scale, getDescendantShadowExtent(child, depth + 1) * scale)
  }
  return max
}

/** 缓存位图需要为阴影外扩补足的设备像素（单边），上限 2048 防止极端参数撑爆画布。 */
function getShadowPaddingDevicePixels(obj: AnyFabricObject, zoomX: number, zoomY: number) {
  const effects = getEnabledShadowEffects(obj)
  const own = effects.length ? Math.max(...effects.map(getEffectLocalExtent)) : 0
  const descendant = getDescendantShadowExtent(obj, 0)
  const localExtent = Math.max(own, descendant)
  if (localExtent <= 0) return { x: 0, y: 0 }
  return {
    x: Math.min(2048, localExtent * zoomX),
    y: Math.min(2048, localExtent * zoomY)
  }
}

let supportInstalled = false

/**
 * 安装多阴影渲染支持（幂等，模块导入时自动执行一次）。
 * 补丁挂在 FabricObject.prototype 与 Group.prototype（Group 覆写了 drawObject）上，
 * 子类（含 Text 的 super 调用）自动生效，clone / loadFromJSON 重建的对象无需重新安装。
 */
export function applyMultiShadowSupport() {
  if (supportInstalled) return
  supportInstalled = true

  // 缓存尺寸：多阴影对象补足阴影外扩，组对象还要补足子对象阴影的 blit 裁剪余量
  FabricObject.prototype._getCacheCanvasDimensions = function (this: FabricObject) {
    const dims = ORIGINAL_GET_CACHE_CANVAS_DIMENSIONS.call(this)
    const padding = getShadowPaddingDevicePixels(this as AnyFabricObject, dims.zoomX, dims.zoomY)
    if (padding.x > 0 || padding.y > 0) {
      dims.width = Math.ceil(dims.width + padding.x * 2)
      dims.height = Math.ceil(dims.height + padding.y * 2)
      // x/y 参与缓存平移居中计算，同步外扩保持对象居中
      dims.x += padding.x * 2
      dims.y += padding.y * 2
    }
    return dims
  } as unknown as typeof FabricObject.prototype._getCacheCanvasDimensions

  // 多阴影对象强制独立缓存：影子合成必须发生在空缓存画布上（destination-over），
  // 且组内子对象自缓存后阴影烘焙进自身位图，不依赖组级阴影支持
  FabricObject.prototype.needsItsOwnCache = function (this: FabricObject) {
    if (ORIGINAL_NEEDS_ITS_OWN_CACHE.call(this)) return true
    return isMultiShadowActive(this)
  } as unknown as typeof FabricObject.prototype.needsItsOwnCache

  const installPatchedDrawObject = (target: object, original: DrawObjectFn) => {
    Object.defineProperty(target, 'drawObject', {
      configurable: true,
      writable: true,
      value: function (
        this: FabricObject,
        ctx: CanvasRenderingContext2D,
        forClipping: boolean,
        context: MultiShadowDrawContext
      ) {
        const effects = forClipping ? [] : getEnabledShadowEffects(this)
        if (!isMultiShadowEffectList(effects)) {
          original.call(this, ctx, forClipping, context)
          return
        }
        drawObjectWithMultiShadow(this as AnyFabricObject, ctx, effects, forClipping, context)
      } as unknown as DrawObjectFn
    })
  }
  installPatchedDrawObject(FabricObject.prototype, ORIGINAL_DRAW_OBJECT)
  installPatchedDrawObject(Group.prototype, ORIGINAL_GROUP_DRAW_OBJECT)

  // SVG 导出：把全部阴影合成一个多分支 filter，包一层 <g filter="url(#...)"> 输出
  FabricObject.prototype._createBaseSVGMarkup = function (
    this: FabricObject,
    objectMarkup: string[],
    options?: Record<string, unknown>
  ) {
    const svg = ORIGINAL_CREATE_BASE_SVG_MARKUP.call(this, objectMarkup, options)
    if (!isMultiShadowActive(this)) return svg
    const filter = buildMultiShadowFilterMarkup(this as AnyFabricObject)
    if (!filter) return svg
    return `<g filter="url(#${filter.id})">\n${filter.def}${svg}</g>\n`
  } as unknown as typeof FabricObject.prototype._createBaseSVGMarkup
}

// ── SVG filter 构建 ──

let svgFilterSeed = 0

function formatSvgNumber(value: number) {
  return String(Number(value.toFixed(4)))
}

/** 把 rgba/hex 等颜色解析为 flood-color 属性值与透明度，非法颜色回退黑色。 */
function parseShadowColor(color: string) {
  try {
    const parsed = new Color(color)
    return { rgb: parsed.toRgb().replace(/\s/g, ''), alpha: parsed.getAlpha() }
  } catch {
    return { rgb: 'rgb(0,0,0)', alpha: 1 }
  }
}

/**
 * 把对象全部启用的阴影效果合成为一个多分支 SVG filter：
 * 每条投影独立走 模糊→偏移→上色 支路，内阴影走 偏移→模糊→α相减→上色→内侧裁剪 支路，
 * 最后 feMerge 按画布同样的叠放次序合并（投影在对象下、内阴影在对象上、列表靠前者在上）。
 * 偏移按对象角度反向旋转并补偿翻转，与 fabric 原生 Shadow.toSVG 保持一致。
 */
export function buildMultiShadowFilterMarkup(obj: AnyFabricObject): { id: string; def: string } | null {
  const effects = getEnabledShadowEffects(obj)
  if (!isMultiShadowEffectList(effects)) return null

  const width = Math.max(1, Number(obj.width) || 1)
  const height = Math.max(1, Number(obj.height) || 1)
  const radians = -(Number(obj.angle) || 0) * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  type ShadowBranch = {
    dx: number
    dy: number
    stdDeviation: number
    rgb: string
    alpha: number
    type: 'drop' | 'inner'
  }
  const branches: ShadowBranch[] = []
  let extendX = 20
  let extendY = 20

  effects.forEach((effect) => {
    let dx = effect.offsetX * cos - effect.offsetY * sin
    let dy = effect.offsetX * sin + effect.offsetY * cos
    if (obj.flipX) dx = -dx
    if (obj.flipY) dy = -dy
    const { rgb, alpha } = parseShadowColor(effect.color)
    // filter 区域外扩与原生 Shadow.toSVG 同源：(|偏移| + 模糊) / 尺寸 × 100% + 20%
    extendX = Math.max(extendX, (Math.abs(dx) + effect.blur) / width * 100 + 20)
    extendY = Math.max(extendY, (Math.abs(dy) + effect.blur) / height * 100 + 20)
    branches.push({ dx, dy, stdDeviation: effect.blur ? effect.blur / 2 : 0, rgb, alpha, type: effect.type })
  })

  const id = `MSVGID_${++svgFilterSeed}`
  const region = ` x="${formatSvgNumber(-extendX)}%" y="${formatSvgNumber(-extendY)}%" width="${formatSvgNumber(100 + extendX * 2)}%" height="${formatSvgNumber(100 + extendY * 2)}%"`
  const body = branches.map((branch, index) => {
    const dx = formatSvgNumber(branch.dx)
    const dy = formatSvgNumber(branch.dy)
    const blur = formatSvgNumber(branch.stdDeviation)
    if (branch.type === 'drop') {
      return [
        `\t<feGaussianBlur in="SourceAlpha" stdDeviation="${blur}" result="msBlur${index}"/>`,
        `\t<feOffset in="msBlur${index}" dx="${dx}" dy="${dy}" result="msOff${index}"/>`,
        `\t<feFlood flood-color="${branch.rgb}" flood-opacity="${branch.alpha}" result="msFlood${index}"/>`,
        `\t<feComposite in="msFlood${index}" in2="msOff${index}" operator="in" result="msShadow${index}"/>`
      ].join('\n')
    }
    return [
      `\t<feOffset in="SourceAlpha" dx="${dx}" dy="${dy}" result="msIOff${index}"/>`,
      `\t<feGaussianBlur in="msIOff${index}" stdDeviation="${blur}" result="msIBlur${index}"/>`,
      `\t<feComposite in="SourceAlpha" in2="msIBlur${index}" operator="out" result="msIBand${index}"/>`,
      `\t<feFlood flood-color="${branch.rgb}" flood-opacity="${branch.alpha}" result="msIFlood${index}"/>`,
      `\t<feComposite in="msIFlood${index}" in2="msIBand${index}" operator="in" result="msIColor${index}"/>`,
      `\t<feComposite in="msIColor${index}" in2="SourceAlpha" operator="in" result="msInner${index}"/>`
    ].join('\n')
  }).join('\n')

  // feMerge 先列的在下：投影倒序垫底 → 对象本体 → 内阴影倒序置顶
  const mergeNodes = [
    ...branches.map((_, index) => index).filter(index => branches[index].type === 'drop').reverse(),
    ...branches.map((_, index) => index).filter(index => branches[index].type === 'inner').reverse()
  ]
  const merge = mergeNodes.map((index) => {
    return branches[index].type === 'drop'
      ? `\t\t<feMergeNode in="msShadow${index}"/>`
      : `\t\t<feMergeNode in="msInner${index}"/>`
  })
  const sourceGraphicIndex = branches.filter(branch => branch.type === 'drop').length
  merge.splice(sourceGraphicIndex, 0, '\t\t<feMergeNode in="SourceGraphic"/>')

  const def = [
    `<filter id="${id}"${region} color-interpolation-filters="sRGB">`,
    body,
    `\t<feMerge>`,
    merge.join('\n'),
    `\t</feMerge>`,
    `</filter>`
  ].join('\n') + '\n'
  return { id, def }
}

// 模块导入即安装，保证所有引入方（运行时、导出模块、测试）行为一致
applyMultiShadowSupport()

// 导入即安装：渲染补丁挂在原型上，画布创建先后无影响
applyMultiShadowSupport()
