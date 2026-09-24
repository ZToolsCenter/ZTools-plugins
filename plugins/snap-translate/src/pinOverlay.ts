/**
 * 贴图译文覆盖：按 OCR 原框定位，用不透明底盖住原文再写入译文。
 */

export interface PinOverlayLine {
  text: string
  left: number
  top: number
  right: number
  bottom: number
  fill?: string
  color?: string
  /** 图像像素字号（显示时按贴图缩放）。 */
  fontSize?: number
  /** 已排好的译文字行；覆盖层直接逐行渲染，避免浏览器重新换行导致裁切/糊块。 */
  lines?: string[]
}

function aabbFromPoints(
  pts: Array<number[] | { x: number; y: number }>
): { left: number; top: number; right: number; bottom: number } | null {
  const xs: number[] = []
  const ys: number[] = []
  for (const p of pts) {
    const x = Array.isArray(p) ? Number(p[0]) : Number((p as { x: number }).x)
    const y = Array.isArray(p) ? Number(p[1]) : Number((p as { y: number }).y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    xs.push(x)
    ys.push(y)
  }
  if (!xs.length) return null
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys)
  }
}

export function boxFromOcrLine(line: {
  text?: string
  left?: number
  top?: number
  right?: number
  bottom?: number
  boxPoints?: { x: number; y: number }[]
  box?: number[][] | { x: number; y: number }[]
}): PinOverlayLine | null {
  const text = String(line?.text ?? '').trim()
  if (!text) return null
  const pts = line.boxPoints || line.box
  let rect = Array.isArray(pts) && pts.length >= 2 ? aabbFromPoints(pts) : null
  if (!rect) {
    const left = Number(line.left)
    const top = Number(line.top)
    const right = Number(line.right)
    const bottom = Number(line.bottom)
    if ([left, top, right, bottom].every((n) => Number.isFinite(n))) {
      rect = { left, top, right, bottom }
    }
  }
  if (!rect) return null
  if (rect.right - rect.left < 2 || rect.bottom - rect.top < 2) return null
  return { text, ...rect }
}

export function expandBox(b: PinOverlayLine, imgW: number, imgH: number): PinOverlayLine {
  const w = b.right - b.left
  const h = b.bottom - b.top
  const px = Math.max(1, Math.round(w * 0.04))
  const py = Math.max(1, Math.round(h * 0.1))
  const maxW = imgW > 1 ? imgW : b.right + px
  const maxH = imgH > 1 ? imgH : b.bottom + py
  return {
    ...b,
    left: Math.max(0, b.left - px),
    top: Math.max(0, b.top - py),
    right: Math.min(maxW, b.right + px),
    bottom: Math.min(maxH, b.bottom + py)
  }
}

export function hasRealBoxes(lines: PinOverlayLine[]): boolean {
  return lines.some((l) => l.right - l.left > 2 && l.bottom - l.top > 2)
}

/** 译文行数对不齐时，按原文长度比例切到各个原框，避免整段堆在第一行。 */
export function mapTranslationToLines(
  source: string[],
  translatedSplit: string[],
  translatedText: string
): string[] {
  const n = source.length
  if (!n) return []
  const parts = translatedSplit.map((s) => String(s ?? ''))
  if (parts.length === n) return parts
  if (parts.length === n + 1 && !parts[n].trim()) return parts.slice(0, n)
  const full = String(translatedText || parts.join('')).replace(/\n/g, '')
  if (!full) return source.map(() => '')
  const weights = source.map((s) => Math.max(String(s).length, 1))
  const total = weights.reduce((a, b) => a + b, 0) || n
  const out: string[] = []
  let offset = 0
  for (let i = 0; i < n; i++) {
    const take = i === n - 1 ? full.length - offset : Math.max(1, Math.round((full.length * weights[i]) / total))
    out.push(full.slice(offset, offset + take))
    offset += take
  }
  return out
}

export function glyphWidthFactor(text: string): number {
  const t = text || ''
  if (!t.length) return 1
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length
  return (cjk * 1 + (t.length - cjk) * 0.58) / t.length
}

export function preferredOverlayFontSize(boxH: number): number {
  return Math.max(12, Math.round(Math.max(8, boxH) * 0.88))
}

export function minReadableOverlayFontSize(boxH: number): number {
  return Math.max(12, Math.round(Math.max(8, boxH) * 0.72))
}

export function readableOverlayLayout(
  box: PinOverlayLine,
  text: string,
  imgW: number,
  imgH: number,
  opts?: { maxHeight?: number }
): PinOverlayLine & { fontSize: number; lines: string[] } {
  const t = String(text || '').trim()
  const srcH = Math.max(8, box.bottom - box.top)
  const srcW = Math.max(8, box.right - box.left)
  const preferred = preferredOverlayFontSize(srcH)
  const minFont = minReadableOverlayFontSize(srcH)
  const pad = Math.max(6, Math.round(preferred * 0.35))
  const maxW = imgW > 1 ? Math.max(srcW, imgW - box.left) : Math.max(srcW * 4, 240)
  const factor = glyphWidthFactor(t || '字')
  const capH = opts?.maxHeight && opts.maxHeight > 0 ? Math.max(8, opts.maxHeight) : Infinity

  let fontSize = preferred
  let width = srcW
  const needed = t ? t.length * fontSize * factor + pad : srcW
  if (needed > srcW) width = Math.min(maxW, needed)

  const layoutAt = (size: number, w: number) => {
    if (!t) return { lines: [] as string[], height: srcH }
    if (t.length * size * factor + pad <= w) return { lines: [t], height: srcH }
    const lines = wrapOverlayLines(t, size, w)
    return { lines, height: Math.max(srcH, lines.length * size * 1.18 + 4) }
  }

  let laid = layoutAt(fontSize, width)
  if (laid.lines.length > 3) {
    width = Math.min(maxW, Math.max(width, srcW * 2.4))
    laid = layoutAt(fontSize, width)
  }
  while (laid.lines.length > 3 && fontSize > minFont) {
    fontSize -= 1
    laid = layoutAt(fontSize, width)
  }

  // 给定上下行槽高度时，尽量塞进槽内；只有多行文本才通过加宽/缩字号重排，避免单行时被撑成整块空条。
  if (Number.isFinite(capH) && laid.height > capH) {
    if (laid.lines.length <= 1) {
      fontSize = Math.max(9, Math.min(fontSize, Math.floor((capH - 4) / 1.18)))
      laid = { lines: laid.lines, height: Math.max(8, capH) }
    } else {
      let best: { size: number; width: number; lines: string[]; height: number } | null = null
      const widths = width < maxW ? [width, maxW] : [maxW]
      for (const w of widths) {
        for (let size = preferred; size >= 9; size--) {
          const cand = layoutAt(size, w)
          if (cand.height <= capH) {
            if (!best || size > best.size || (size === best.size && w > best.width)) {
              best = { size, width: w, lines: cand.lines, height: cand.height }
            }
            break
          }
        }
      }
      if (best) {
        fontSize = best.size
        width = best.width
        laid = { lines: best.lines, height: best.height }
      } else {
        laid = { lines: laid.lines, height: Math.max(8, capH) }
      }
    }
  }

  let left = box.left
  let top = box.top
  let right = left + width
  let bottom = top + laid.height
  if (imgW > 1 && right > imgW) {
    left = Math.max(0, imgW - width)
    right = imgW
  }
  if (imgH > 1 && bottom > imgH) {
    top = Math.max(0, imgH - laid.height)
    bottom = imgH
  }
  return {
    ...box,
    text: t,
    fontSize,
    lines: laid.lines,
    left,
    top,
    right,
    bottom
  }
}

export function wrapOverlayLines(text: string, fontSize: number, maxW: number): string[] {
  const t = String(text || '').trim()
  if (!t) return []
  const factor = glyphWidthFactor(t)
  const maxChars = Math.max(1, Math.floor((maxW - 6) / Math.max(fontSize * factor, 1)))
  const lines: string[] = []
  let rest = t
  while (rest) {
    if (rest.length <= maxChars) {
      lines.push(rest)
      break
    }
    let cut = maxChars
    const slice = rest.slice(0, maxChars)
    const sp = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('，'), slice.lastIndexOf('。'))
    if (sp >= Math.floor(maxChars * 0.45)) cut = sp + 1
    lines.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  return lines
}

export function layoutOverlayText(
  text: string,
  boxW: number,
  boxH: number
): { fontSize: number; lines: string[] } {
  const t = String(text || '').trim()
  if (!t || boxW < 4 || boxH < 4) {
    return { fontSize: preferredOverlayFontSize(boxH), lines: t ? [t] : [] }
  }
  const maxSize = preferredOverlayFontSize(boxH)
  const minSize = minReadableOverlayFontSize(boxH)
  const factor = glyphWidthFactor(t)
  for (let size = maxSize; size >= minSize; size--) {
    if (t.length * size * factor <= boxW - 6) return { fontSize: size, lines: [t] }
  }
  return { fontSize: minSize, lines: wrapOverlayLines(t, minSize, boxW) }
}

/** 按译文把原 OCR 框向右、向下撑开，优先保字号，避免覆盖后文字被裁切。 */
export function fitOverlayBox(
  box: PinOverlayLine,
  text: string,
  imgW: number,
  imgH: number
): PinOverlayLine {
  return readableOverlayLayout(box, text, imgW, imgH)
}

/** 取样亮度只用来决定浅底/深底，填色本身必须实心，不能用原文像素均值。 */
export function coverFillFromSample(r: number, g: number, b: number): { fill: string; color: string } {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (lum >= 0.45) return { fill: '#f3f4f6', color: '#111111' }
  return { fill: '#1a1a1a', color: '#f5f5f5' }
}

export function zipOverlay(
  boxes: PinOverlayLine[],
  translated: string[],
  imgW: number,
  imgH: number
): PinOverlayLine[] {
  if (!hasRealBoxes(boxes)) return []
  const texts = mapTranslationToLines(
    boxes.map((b) => b.text),
    translated,
    translated.join('')
  )
  const expanded = boxes.map((src) => expandBox(src, imgW, imgH))
  const order = expanded
    .map((box, i) => ({ box, i }))
    .sort((a, b) => a.box.top - b.box.top)

  // 先用原文行间隙把上下相邻的扩展框拆开，避免相邻译文覆盖框严丝合缝粘成一片。
  for (let k = 0; k < order.length - 1; k++) {
    const a = order[k]
    const b = order[k + 1]
    if (boxes[a.i].bottom <= boxes[b.i].top + 1) {
      const split = (boxes[a.i].bottom + boxes[b.i].top) / 2
      if (a.box.bottom > split) a.box.bottom = Math.floor(split)
      if (b.box.top < split) b.box.top = Math.ceil(split)
    }
  }

  const out = new Array<PinOverlayLine>(boxes.length)
  for (let k = 0; k < order.length; k++) {
    const { box, i } = order[k]
    const next = order[k + 1]
    const stacked = !!next && boxes[i].bottom <= boxes[next.i].top + 1
    const maxBottom = stacked ? next.box.top : imgH
    const text = (texts[i] || '').trim() || boxes[i].text
    out[i] = readableOverlayLayout({ ...box, text }, text, imgW, imgH, {
      maxHeight: Math.max(8, maxBottom - box.top - 3)
    })
  }
  return out
}

type SampleImage = { naturalWidth: number; naturalHeight: number; complete?: boolean }

export function sampleBorderColor(
  img: SampleImage | null | undefined,
  box: PinOverlayLine,
  imgW: number,
  imgH: number
): { r: number; g: number; b: number } {
  const fallback = { r: 245, g: 245, b: 245 }
  if (!img || !img.naturalWidth) return fallback
  try {
    const c = document.createElement('canvas')
    c.width = Math.max(1, img.naturalWidth)
    c.height = Math.max(1, img.naturalHeight)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return fallback
    ctx.drawImage(img as CanvasImageSource, 0, 0)
    const w = Math.max(1, box.right - box.left)
    const h = Math.max(1, box.bottom - box.top)
    const pts: Array<[number, number]> = [
      [box.left - 2, box.top + h / 2],
      [box.right + 2, box.top + h / 2],
      [box.left + w / 2, box.top - 2],
      [box.left + w / 2, box.bottom + 2],
      [box.left, box.top],
      [box.right, box.top],
      [box.left, box.bottom],
      [box.right, box.bottom]
    ]
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (const [x, y] of pts) {
      const px = Math.min(imgW - 1, Math.max(0, Math.round(x)))
      const py = Math.min(imgH - 1, Math.max(0, Math.round(y)))
      const d = ctx.getImageData(px, py, 1, 1).data
      r += d[0]
      g += d[1]
      b += d[2]
      n++
    }
    if (!n) return fallback
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
  } catch (_) {
    return fallback
  }
}

export function drawPinOverlay(
  ctx: CanvasRenderingContext2D,
  lines: PinOverlayLine[],
  source?: SampleImage | null
): void {
  const imgW = source?.naturalWidth || ctx.canvas.width
  const imgH = source?.naturalHeight || ctx.canvas.height
  for (const box of lines) {
    const w = box.right - box.left
    const h = box.bottom - box.top
    if (w < 2 || h < 2 || !box.text) continue
    const sampled = box.fill
      ? { r: 245, g: 245, b: 245 }
      : sampleBorderColor(source, box, imgW, imgH)
    const colors = box.fill && box.color ? { fill: box.fill, color: box.color } : coverFillFromSample(sampled.r, sampled.g, sampled.b)
    ctx.save()
    ctx.fillStyle = colors.fill
    ctx.fillRect(box.left, box.top, w, h)
    const fontSize = box.fontSize || layoutOverlayText(box.text, w, h).fontSize
    const layout = {
      fontSize,
      lines: wrapOverlayLines(box.text, fontSize, w)
    }
    if (layout.lines.length === 0) layout.lines = [box.text]
    ctx.fillStyle = colors.color
    ctx.font = `700 ${layout.fontSize}px "Segoe UI","Microsoft YaHei UI","Noto Sans SC",sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const lineH = layout.fontSize * 1.12
    const totalH = lineH * layout.lines.length
    let y = box.top + (h - totalH) / 2 + lineH / 2
    const x = box.left + 3
    const maxW = Math.max(4, w - 6)
    for (const row of layout.lines) {
      ctx.fillText(row, x, y, maxW)
      y += lineH
    }
    ctx.restore()
  }
}

export function coverChipStyle(
  line: PinOverlayLine,
  imgW: number,
  imgH: number,
  stageW: number,
  stageH: number
): Record<string, string> {
  const bw = line.right - line.left
  const bh = line.bottom - line.top
  const imgFont = line.fontSize || preferredOverlayFontSize(bh)
  const fontPx = Math.max(9, (imgFont / Math.max(imgH, 1)) * stageH)
  const colors = line.fill && line.color ? { fill: line.fill, color: line.color } : { fill: '#f3f4f6', color: '#111111' }
  return {
    left: `${(line.left / imgW) * 100}%`,
    top: `${(line.top / imgH) * 100}%`,
    width: `${(bw / imgW) * 100}%`,
    height: `${(bh / imgH) * 100}%`,
    background: colors.fill,
    color: colors.color,
    fontSize: `${fontPx}px`,
    overflow: 'hidden'
  }
}
