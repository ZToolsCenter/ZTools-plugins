/**
 * 封面图片处理：把大幅面高清封面归一化为适合书架/信息卡展示的缩略图。
 *
 * 背景：EPUB/MOBI 封面原图经常是 1000px+ 的高清图，而书架卡片（约 130~250px 宽）
 * 和书籍信息弹窗缩略图（80x112px）都很小。直接把原始大图塞进 <img> 交给 Chromium
 * 用 CSS 缩小，超大缩小倍率下会出现明显的锯齿/摩尔纹/颗粒感（线条断裂、噪点）。
 * 这里在封面落库前用 canvas 高质量重采样，限制最长边，既消除显示伪影，
 * 也大幅减小 IndexedDB 占用与首屏解码内存。
 */

/** 封面最长边上限（px）。书架卡片约 130~250px 宽、高约 190~370px，信息弹窗缩略图 112px，480 已足够 */
const COVER_MAX_EDGE = 480
/**
 * base64 长度阈值：小于它直接原样返回，避免对小图做无谓的解码与重编码。
 * 120KB base64 对应约 90KB 的图片，已足以容纳 480px 封面所需细节。
 */
const COVER_OVER_SIZE_LEN = 120 * 1024

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('封面解码失败'))
    img.src = src
  })
}

/** 检测画布是否包含有效透明像素（决定输出 PNG 或 JPEG） */
function hasTransparency(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true
  }
  return false
}

/**
 * 对封面 data URL 做尺寸归一化。图片本身较小或解码失败时原样返回，
 * 保证任何情况下都不破坏现有封面。
 */
export async function optimizeCover(dataUrl: string): Promise<string> {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl
  // GIF（可能为动图）与 SVG 不适合走 canvas，保持原样
  if (/^data:image\/(gif|svg\+xml)/i.test(dataUrl)) return dataUrl
  if (dataUrl.length < COVER_OVER_SIZE_LEN) return dataUrl

  try {
    const img = await loadImage(dataUrl)
    const srcW = img.naturalWidth
    const srcH = img.naturalHeight
    if (!srcW || !srcH) return dataUrl
    if (Math.max(srcW, srcH) <= COVER_MAX_EDGE) return dataUrl

    const scale = Math.min(COVER_MAX_EDGE / srcW, COVER_MAX_EDGE / srcH)
    const tw = Math.max(1, Math.round(srcW * scale))
    const th = Math.max(1, Math.round(srcH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return dataUrl
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, tw, th)

    if (hasTransparency(ctx, tw, th)) return canvas.toDataURL('image/png')
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return dataUrl
  }
}

/** 判断封面 data URL 是否超过大小阈值、值得重采样（用于一次性迁移） */
export function isCoverOversized(dataUrl: string | undefined): boolean {
  return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') && dataUrl.length >= COVER_OVER_SIZE_LEN
}
