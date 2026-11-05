/**
 * Mermaid 渲染与导出工具。
 *
 * 关键约束（基于实际调试结论）：
 * 1. Mermaid 的 HTML 标签会生成 <foreignObject>，跨进 canvas 会污染画布，
 *    导致 toBlob 抛出 "Tainted canvases may not be exported"。
 * 2. 因此导出时把 foreignObject 换成原生 <text>。定位规则：
 *    - foreignObject 自身无 x/y 时，Mermaid 用祖先 transform 定位，
 *      并以标签盒宽度为居中基准，等价于 x = width/2；
 *    - 有 x/y 的标签（如连线标签）直接沿用原坐标。
 * 3. 颜色/字号必须写成内联样式，否则会被 Mermaid 样式表覆盖。
 * 4. viewBox 需要把 foreignObject 的真实范围并入，避免类图文字被裁切。
 */

/** 画布单边上限，避免超大图导致渲染失败 */
const MAX_CANVAS_EDGE = 16000
/** 画布面积上限（像素） */
const MAX_CANVAS_AREA = 120e6

/** 导出中间产物 */
export interface PreparedSvg {
  /** 原始 SVG（可能含 foreignObject，会污染画布） */
  svg: string
  /** 已把 foreignObject 转为 <text> 的安全版本 */
  flatSvg: string | null
  width: number
  height: number
  viewBox: { x: number; y: number; width: number; height: number }
}

/**
 * 按画布限制收敛缩放倍数。
 * @param width 逻辑宽度
 * @param height 逻辑高度
 * @param scale 期望倍数
 * @returns 实际可用倍数（不小于 0.1）
 */
export function clampScale(width: number, height: number, scale: number): number {
  let next = Math.max(0.1, scale)
  next = Math.min(next, MAX_CANVAS_EDGE / Math.max(width, 1))
  next = Math.min(next, MAX_CANVAS_EDGE / Math.max(height, 1))
  next = Math.min(next, Math.sqrt(MAX_CANVAS_AREA / Math.max(width * height, 1)))
  return Math.max(0.1, next)
}

/** 序列化为带 XML 声明的 SVG 字符串 */
function serialize(node: Element): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(node)}`
}

/** 解析 translate(x, y) */
function parseTranslate(value: string | null): [number, number] | null {
  if (!value) return null
  const match = value.match(/translate\(\s*(-?[\d.]+)\s*[, ]?\s*(-?[\d.]+)?\s*\)/)
  if (!match) return null
  return [Number(match[1]) || 0, Number(match[2]) || 0]
}

/**
 * 把 foreignObject 标签转换为原生 <text>，使其可以被 canvas 安全栅格化。
 * @param clone 导出副本
 * @returns 处理后的副本
 */
function flattenLabels(clone: Element): Element {
  const ns = 'http://www.w3.org/2000/svg'
  clone.querySelectorAll('foreignObject').forEach((fo) => {
    const text = document.createElementNS(ns, 'text')
    let fontSize = 0
    let fill = ''

    const inner = fo.querySelector('div, span, p') || fo
    try {
      const style = getComputedStyle(inner)
      fontSize = Number.parseFloat(style.fontSize) || 0
      if (style.color && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(style.color)) {
        fill = style.color
      }
    } catch {
      // 元素已脱离文档时忽略样式读取失败
    }

    const foX = fo.getAttribute('x')
    const foY = fo.getAttribute('y')
    if (foX !== null || foY !== null) {
      text.setAttribute('x', foX || '0')
      text.setAttribute('y', foY || '0')
    } else {
      // 无 x/y 时，Mermaid 以标签盒宽度作为居中基准
      const boxWidth = Number.parseFloat(fo.getAttribute('width') || '') || 0
      text.setAttribute('x', String(boxWidth / 2))
      text.setAttribute('y', '0')
    }

    text.style.textAnchor = 'middle'
    text.style.dominantBaseline = 'central'
    if (fontSize) text.style.fontSize = `${fontSize}px`
    text.style.fill = fill || '#333333'
    text.style.fontFamily = '"Inter","Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif'
    text.textContent = (fo.textContent || '').replace(/\s+/g, ' ').trim()
    fo.replaceWith(text)
  })
  clone.querySelectorAll('*').forEach((el) => el.removeAttribute('html'))
  return clone
}

/**
 * 把计算样式回填为属性，保证脱离页面后样式一致。
 * @param clone 目标副本（结构需与 live 一致）
 * @param live 页面中的实时 SVG
 * @returns 处理后的副本
 */
function solidifyStyles(clone: Element, live: Element): Element {
  const selector = 'rect,circle,ellipse,polygon,path,text,tspan,line,polyline'
  const liveNodes = live.querySelectorAll(selector)
  const cloneNodes = clone.querySelectorAll(selector)
  // 结构已变化（例如标签被替换）时跳过，避免错位覆盖
  if (liveNodes.length !== cloneNodes.length) return clone

  const props = [
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-dasharray',
    'opacity'
  ]

  for (let i = 0; i < cloneNodes.length; i += 1) {
    let style: CSSStyleDeclaration
    try {
      style = getComputedStyle(liveNodes[i])
    } catch {
      continue
    }
    const target = cloneNodes[i] as SVGElement
    for (const prop of props) {
      const value = style.getPropertyValue(prop)
      if (!value) continue
      if ((prop === 'fill' || prop === 'stroke') && /rgba\(0,\s*0,\s*0,\s*0\)/.test(value)) {
        if (prop === 'fill') target.setAttribute('fill', 'none')
        continue
      }
      target.style.setProperty(prop, value)
    }
  }
  return clone
}

/**
 * 准备可导出的 SVG：计算画布尺寸、补充背景、生成安全副本。
 * @param source 页面中已渲染的 <svg> 元素
 * @param background 背景色；空字符串表示透明
 * @returns 导出中间产物；尺寸无效时返回 null
 */
export function prepareSvg(source: SVGSVGElement, background: string): PreparedSvg | null {
  const viewBox = source.viewBox.baseVal
  const rect = source.getBoundingClientRect()
  if (!rect.width || !rect.height) return null

  const clone = source.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')

  // 隐藏容器：让 #id 选择器生效并测量真实几何
  const stage = document.createElement('div')
  stage.style.cssText =
    'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;'
  document.body.appendChild(stage)
  const probe = clone.cloneNode(true) as SVGSVGElement
  stage.appendChild(probe)

  try {
    const box = probe.getBBox()
    const base =
      box && box.width
        ? { x: box.x, y: box.y, width: box.width, height: box.height }
        : { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height }

    const probeRect = probe.getBoundingClientRect()
    const scaleX = probeRect.width / (viewBox.width || 1) || 1
    const scaleY = probeRect.height / (viewBox.height || 1) || 1

    // getBBox 不含 foreignObject 内的 HTML 文本，这里并入其真实范围
    let minX = base.x
    let minY = base.y
    let maxX = base.x + base.width
    let maxY = base.y + base.height
    probe.querySelectorAll('foreignObject').forEach((fo) => {
      const r = fo.getBoundingClientRect()
      if (!r.width && !r.height) return
      const left = viewBox.x + (r.left - probeRect.left) / scaleX
      const top = viewBox.y + (r.top - probeRect.top) / scaleY
      minX = Math.min(minX, left)
      minY = Math.min(minY, top)
      maxX = Math.max(maxX, left + r.width / scaleX)
      maxY = Math.max(maxY, top + r.height / scaleY)
    })

    const pad = 8
    const offsetX = Math.floor(minX - pad)
    const offsetY = Math.floor(minY - pad)
    const width = Math.max(1, Math.ceil(maxX - minX + pad * 2))
    const height = Math.max(1, Math.ceil(maxY - minY + pad * 2))

    clone.setAttribute('viewBox', `${offsetX} ${offsetY} ${width} ${height}`)
    clone.setAttribute('width', String(width))
    clone.setAttribute('height', String(height))
    clone.style.removeProperty('transform')
    clone.style.removeProperty('max-width')
    clone.style.background = 'transparent'
    // 保留根 id：#id 是 Mermaid 样式选择器的前缀，删除会导致样式全失效

    clone.querySelectorAll('[style*="animation"]').forEach((node) => {
      ;(node as SVGElement).style.animation = 'none'
    })

    // 统一字体，保证外部渲染一致
    let styleTag = clone.querySelector('style') as unknown as SVGStyleElement | null
    const extraCss =
      'text{font-family:"Inter","Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}'
    if (styleTag) {
      styleTag.textContent = `${styleTag.textContent || ''}\n${extraCss}`
    } else {
      const created = document.createElementNS('http://www.w3.org/2000/svg', 'style')
      created.textContent = extraCss
      styleTag = created
      clone.insertBefore(created, clone.firstChild)
    }

    if (background) {
      const rect2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      rect2.setAttribute('x', String(offsetX))
      rect2.setAttribute('y', String(offsetY))
      rect2.setAttribute('width', String(width))
      rect2.setAttribute('height', String(height))
      rect2.setAttribute('fill', background)
      clone.insertBefore(rect2, clone.firstChild)
    }

    let flatSvg: string | null = null
    if (clone.querySelector('foreignObject')) {
      const flat = flattenLabels(clone.cloneNode(true) as SVGSVGElement)
      flatSvg = serialize(solidifyStyles(flat, source))
    }

    return {
      svg: serialize(clone),
      flatSvg,
      width,
      height,
      viewBox: { x: offsetX, y: offsetY, width, height }
    }
  } finally {
    stage.remove()
  }
}

/**
 * 把 SVG 字符串栅格化为 PNG。
 * @param svg 已消毒的 SVG 文本
 * @param width 逻辑宽度
 * @param height 逻辑高度
 * @param scale 缩放倍数
 * @param background 背景色；空字符串表示透明
 * @returns PNG Blob
 */
export function svgToPngBlob(
  svg: string,
  width: number,
  height: number,
  scale: number,
  background: string
): Promise<Blob> {
  const ratio = clampScale(width, height, scale)
  const pixelWidth = Math.max(1, Math.round(width * ratio))
  const pixelHeight = Math.max(1, Math.round(height * ratio))
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = pixelWidth
        canvas.height = pixelHeight
        const context = canvas.getContext('2d')
        if (!context) {
          URL.revokeObjectURL(url)
          reject(new Error('无法创建画布'))
          return
        }
        if (background) {
          context.fillStyle = background
          context.fillRect(0, 0, pixelWidth, pixelHeight)
        }
        context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
        // toBlob 遇到污染画布会同步抛 SecurityError，必须放在 try 内
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url)
          if (blob) resolve(blob)
          else reject(new Error('canvas 导出失败'))
        }, 'image/png')
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 转图片失败'))
    }
    image.src = url
  })
}

/**
 * 生成导出用 PNG。
 * Mermaid 必然输出 foreignObject，它会污染画布，因此只要存在已转换的副本，
 * 就优先用它直接栅格化，避免先失败再回退。
 * @param prepared 导出中间产物
 * @param scale 缩放倍数
 * @param background 背景色
 * @returns PNG Blob
 */
export async function rasterize(
  prepared: PreparedSvg,
  scale: number,
  background: string
): Promise<Blob> {
  if (prepared.flatSvg) {
    return svgToPngBlob(prepared.flatSvg, prepared.width, prepared.height, scale, background)
  }
  try {
    return await svgToPngBlob(prepared.svg, prepared.width, prepared.height, scale, background)
  } catch (error) {
    if (/taint/i.test((error as Error).message)) {
      throw new Error('画布被跨域内容污染，无法导出该格式')
    }
    throw error
  }
}

/**
 * Blob 转 base64（去掉 data URI 前缀）。
 * @param blob 二进制内容
 * @returns 纯 base64 字符串
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const index = result.indexOf(',')
      resolve(index >= 0 ? result.slice(index + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取二进制内容失败'))
    reader.readAsDataURL(blob)
  })
}

/**
 * 文本转 base64（UTF-8 安全）。
 * @param text 文本内容
 * @returns base64 字符串
 */
export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

/**
 * 依据画布尺寸与纸张参数生成 PDF。
 * 采用 300 DPI 位图嵌入，避免不同阅读器对 SVG 直嵌的兼容问题。
 * @param png 图表 PNG
 * @param options 纸张与排版参数
 * @returns PDF Blob
 */
export async function buildPdf(
  png: Blob,
  options: {
    paper: 'a4' | 'a3' | 'letter' | 'auto'
    orientation: 'portrait' | 'landscape' | 'auto'
    marginMm: number
    pixelWidth: number
    pixelHeight: number
  }
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const papers: Record<string, [number, number]> = {
    a4: [210, 297],
    a3: [297, 420],
    letter: [215.9, 279.4]
  }

  const base64 = await blobToBase64(png)
  const imageRatio = options.pixelWidth / Math.max(1, options.pixelHeight)

  let paperWidth: number
  let paperHeight: number

  if (options.paper === 'auto') {
    // 自适应：图片按 96 DPI 折算尺寸，四周留边距
    const margin = options.marginMm
    paperWidth = (options.pixelWidth / 96) * 25.4 + margin * 2
    paperHeight = (options.pixelHeight / 96) * 25.4 + margin * 2
    const doc = new jsPDF({
      orientation: paperWidth > paperHeight ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [paperWidth, paperHeight]
    })
    doc.addImage(base64, 'PNG', margin, margin, paperWidth - margin * 2, paperHeight - margin * 2)
    return doc.output('blob')
  }

  ;[paperWidth, paperHeight] = papers[options.paper] || papers.a4
  const landscape =
    options.orientation === 'landscape' ||
    (options.orientation === 'auto' && imageRatio > 1)
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: options.paper
  })

  const pageWidth = landscape ? paperHeight : paperWidth
  const pageHeight = landscape ? paperWidth : paperHeight
  const margin = options.marginMm
  const availableWidth = Math.max(1, pageWidth - margin * 2)
  const availableHeight = Math.max(1, pageHeight - margin * 2)

  // 等比缩放并居中
  let drawWidth = availableWidth
  let drawHeight = drawWidth / imageRatio
  if (drawHeight > availableHeight) {
    drawHeight = availableHeight
    drawWidth = drawHeight * imageRatio
  }
  const offsetX = (pageWidth - drawWidth) / 2
  const offsetY = (pageHeight - drawHeight) / 2

  doc.addImage(base64, 'PNG', offsetX, offsetY, drawWidth, drawHeight)
  return doc.output('blob')
}
