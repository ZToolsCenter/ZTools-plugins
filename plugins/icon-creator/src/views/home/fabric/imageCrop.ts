import { util, type FabricObject } from 'fabric'

/**
 * 位图裁剪的纯几何换算（fabric v6+ cropX/cropY 语义）：
 * 图片的显示区域由 width/height（源像素数）与 cropX/cropY（源像素偏移）共同决定，
 * 裁剪只改这四个标量、不动图片元素本身，因此天然支持连续裁剪与序列化 round-trip。
 * 交互裁剪（覆盖层矩形）与 MCP crop_image（显示包围盒矩形）共用本模块换算。
 */

/** 裁剪矩形（画布显示坐标系，left/top 为左上角）。 */
export type BitmapCropRect = {
  left: number
  top: number
  width: number
  height: number
}

/** 换算结果：图片源像素坐标系中的裁剪区域（可直接写入 cropX/cropY/width/height）。 */
export type BitmapCropSourceRect = {
  cropX: number
  cropY: number
  width: number
  height: number
}

/** 越界判定的像素容差，吸收浮点误差与调用方四舍五入带来的边界抖动。 */
const BOUNDS_EPSILON = 0.5

/** 应用裁剪后源区域的最小边长（像素），低于该值视为面积过小。 */
export const MIN_BITMAP_CROP_SOURCE_SIZE = 1

/** 支持裁剪的位图类型：fabric FabricImage 携带原生 cropX/cropY 字段。 */
type CropCapableObject = FabricObject & { cropX?: number; cropY?: number }

/**
 * 读取位图当前的显示包围盒（angle=0 语义）：
 * 与 MCP 对象摘要的 bboxLeft/bboxTop 同源——以几何中心减去显示尺寸一半计算，
 * 不依赖 origin 假设；位图通常无描边，无需额外外扩。
 */
export function getBitmapDisplayBox(image: FabricObject): BitmapCropRect {
  const center = image.getCenterPoint()
  const width = image.getScaledWidth()
  const height = image.getScaledHeight()
  return {
    left: center.x - width / 2,
    top: center.y - height / 2,
    width,
    height
  }
}

/**
 * 校验显示包围盒坐标系中的裁剪矩形并换算为源像素区域：
 * - 宽高必须大于 0；
 * - 矩形必须完整落在当前显示包围盒内（含容差），越界抛中文错误；
 * - 换算后的源区域任一边不足 1px 视为面积过小并抛错。
 * 返回的源区域直接叠加到既有 cropX/cropY 上，天然支持连续多次裁剪。
 */
export function computeBitmapCropFromDisplayRect(image: CropCapableObject, rect: BitmapCropRect): BitmapCropSourceRect {
  if (!(rect.width > 0) || !(rect.height > 0)) {
    throw new Error(`裁剪矩形宽高必须大于 0，当前为 ${rect.width}×${rect.height}`)
  }
  const box = getBitmapDisplayBox(image)
  const outOfBounds =
    rect.left < box.left - BOUNDS_EPSILON ||
    rect.top < box.top - BOUNDS_EPSILON ||
    rect.left + rect.width > box.left + box.width + BOUNDS_EPSILON ||
    rect.top + rect.height > box.top + box.height + BOUNDS_EPSILON
  if (outOfBounds) {
    throw new Error(
      `裁剪矩形（${rect.left},${rect.top} 起 ${rect.width}×${rect.height}）超出图片显示范围 ` +
        `（${box.left},${box.top} 起 ${box.width}×${box.height}），请缩小或移动裁剪矩形`
    )
  }
  const source = computeSourceRectFromDisplayFractions(image, {
    fx: (rect.left - box.left) / box.width,
    fy: (rect.top - box.top) / box.height,
    fw: rect.width / box.width,
    fh: rect.height / box.height
  })
  assertSourceRectSizeOk(source)
  return source
}

/**
 * 由显示包围盒内的比例区域（0-1）换算源像素裁剪区域：
 * 比例基于"当前显示区域"，叠加既有 cropX/cropY 后即得连续裁剪的绝对源区域。
 */
function computeSourceRectFromDisplayFractions(
  image: CropCapableObject,
  fractions: { fx: number; fy: number; fw: number; fh: number }
): BitmapCropSourceRect {
  const cropX = Number(image.cropX ?? 0)
  const cropY = Number(image.cropY ?? 0)
  const width = Number(image.width ?? 0)
  const height = Number(image.height ?? 0)
  return {
    cropX: cropX + fractions.fx * width,
    cropY: cropY + fractions.fy * height,
    width: fractions.fw * width,
    height: fractions.fh * height
  }
}

/** 校验源裁剪区域尺寸，过小抛中文错误（供 MCP 路径直接返回可读错误）。 */
function assertSourceRectSizeOk(source: BitmapCropSourceRect) {
  if (
    source.width < MIN_BITMAP_CROP_SOURCE_SIZE ||
    source.height < MIN_BITMAP_CROP_SOURCE_SIZE
  ) {
    throw new Error(
      `裁剪区域过小：换算为源图后为 ${source.width.toFixed(2)}×${source.height.toFixed(2)} 像素，` +
        `至少需要 ${MIN_BITMAP_CROP_SOURCE_SIZE}×${MIN_BITMAP_CROP_SOURCE_SIZE} 像素`
    )
  }
}

/**
 * 由交互裁剪覆盖层矩形换算源像素裁剪区域：
 * 覆盖层与图片共享同一变换矩阵（角度/缩放/斜切一致），
 * 因此把覆盖层中心点逆变换回图片本地坐标、再按图片缩放折算本地尺寸即可得到本地矩形；
 * 随后夹取到当前显示区域范围内（交互拖拽允许轻微越界，应用时收敛）。
 * 区域小到不足最小尺寸时返回 null，由调用方提示用户后保留裁剪会话。
 */
export function computeBitmapCropFromOverlayRect(image: CropCapableObject, overlay: FabricObject): BitmapCropSourceRect | null {
  const matrix = image.calcTransformMatrix()
  const inverse = util.invertTransform(matrix)
  const centerLocal = util.transformPoint(overlay.getCenterPoint(), inverse)
  const imageScaleX = Math.abs(Number(image.scaleX ?? 1)) || 1
  const imageScaleY = Math.abs(Number(image.scaleY ?? 1)) || 1
  const localWidth = overlay.getScaledWidth() / imageScaleX
  const localHeight = overlay.getScaledHeight() / imageScaleY
  const width = Number(image.width ?? 0)
  const height = Number(image.height ?? 0)
  // 图片本地坐标以中心为原点：显示区域左边缘 = -width/2，源像素 u 对应本地 x = u - width/2。
  const u0 = centerLocal.x + width / 2 - localWidth / 2
  const v0 = centerLocal.y + height / 2 - localHeight / 2
  const u1 = u0 + localWidth
  const v1 = v0 + localHeight
  const clampedU0 = Math.min(Math.max(u0, 0), width)
  const clampedU1 = Math.min(Math.max(u1, 0), width)
  const clampedV0 = Math.min(Math.max(v0, 0), height)
  const clampedV1 = Math.min(Math.max(v1, 0), height)
  const source = {
    cropX: Number(image.cropX ?? 0) + clampedU0,
    cropY: Number(image.cropY ?? 0) + clampedV0,
    width: clampedU1 - clampedU0,
    height: clampedV1 - clampedV0
  }
  if (
    source.width < MIN_BITMAP_CROP_SOURCE_SIZE ||
    source.height < MIN_BITMAP_CROP_SOURCE_SIZE
  ) {
    return null
  }
  return source
}

/**
 * 把源像素裁剪区域应用到图片：仅更新 cropX/cropY/width/height，图片元素与缩放/角度等变换不动。
 * 同时补偿 left/top，让被保留的裁剪区域在画布上的视觉位置保持不变（区域"原地"留下）。
 */
export function applyBitmapCropSourceRect(image: CropCapableObject, source: BitmapCropSourceRect) {
  const matrix = image.calcTransformMatrix()
  // 裁剪后新区域的中心（以裁剪前的本地坐标表示）。
  const regionCenterLocal = {
    x: source.cropX + source.width / 2 - Number(image.width ?? 0) / 2,
    y: source.cropY + source.height / 2 - Number(image.height ?? 0) / 2
  }
  // 该中心点当前所在的画布位置——裁剪后应保持不动。
  const regionCenterCanvas = util.transformPoint(regionCenterLocal, matrix)
  image.set({
    cropX: source.cropX,
    cropY: source.cropY,
    width: source.width,
    height: source.height
  })
  image.dirty = true
  image.setCoords()
  const delta = {
    x: regionCenterCanvas.x - image.getCenterPoint().x,
    y: regionCenterCanvas.y - image.getCenterPoint().y
  }
  if (delta.x || delta.y) {
    image.set({
      left: Number(image.left ?? 0) + delta.x,
      top: Number(image.top ?? 0) + delta.y
    })
    image.setCoords()
  }
}
