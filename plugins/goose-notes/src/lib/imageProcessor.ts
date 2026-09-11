/**
 * 图片处理工具：压缩、转换、存储
 *
 * 规则：
 * - 非 SVG 统一输出 WebP@80%
 * - 已是 WebP（含 MIME 为空但文件头是 WebP）不再二次压缩
 * - 不做 JPEG / 多档质量 / dataURL 等兜底
 * - 复制与下载时再转 PNG
 */

import type { StorageConfig } from './imageStorage/types'
import {
  DEFAULT_STORAGE_CONFIG,
  MAX_IMAGE_STORE_BYTES,
} from './imageStorage/types'

const WEBP_MIME = 'image/webp'
const PNG_MIME = 'image/png'
const SVG_MIME = 'image/svg+xml'

type RasterMime = 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/bmp'

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  // 项目锁 ES2022，不能用 Promise.withResolvers
  return new Promise((resolve) => {
    if (typeof quality === 'number') {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality)
      return
    }
    canvas.toBlob((blob) => resolve(blob), mimeType)
  })
}

function resolveTargetSize(
  origW: number,
  origH: number,
  maxEdge: number,
): { width: number; height: number } {
  if (Math.max(origW, origH) <= maxEdge) {
    return { width: origW, height: origH }
  }

  if (origW >= origH) {
    return {
      width: maxEdge,
      height: Math.max(1, Math.round((origH / origW) * maxEdge)),
    }
  }

  return {
    width: Math.max(1, Math.round((origW / origH) * maxEdge)),
    height: maxEdge,
  }
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false
  }
  return true
}

/** 用文件头识别真实图片类型；剪贴板 File.type 经常为空或错误 */
function detectRasterMime(bytes: Uint8Array, declaredType: string): RasterMime | null {
  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return WEBP_MIME
  }

  // PNG
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return PNG_MIME
  }

  // JPEG
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }

  // GIF
  if (
    startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'image/gif'
  }

  // BMP
  if (startsWithBytes(bytes, [0x42, 0x4d])) {
    return 'image/bmp'
  }

  if (
    declaredType === WEBP_MIME ||
    declaredType === PNG_MIME ||
    declaredType === 'image/jpeg' ||
    declaredType === 'image/jpg' ||
    declaredType === 'image/gif' ||
    declaredType === 'image/bmp'
  ) {
    return declaredType === 'image/jpg' ? 'image/jpeg' : (declaredType as RasterMime)
  }

  return null
}

/**
 * 将剪贴板/上传文件固化为带正确 MIME 的 Blob。
 * Electron/uTools 大图粘贴时，延迟读取的 File 可能失效；先读完字节再处理。
 */
export async function materializeImageBlob(
  input: Blob | File,
  preferredMime?: string,
): Promise<Blob> {
  const buffer = await input.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new Error('剪贴板图片为空，请重新复制后再粘贴')
  }

  const bytes = new Uint8Array(buffer)
  const declared =
    (input.type && input.type.startsWith('image/') ? input.type : '') ||
    (preferredMime && preferredMime.startsWith('image/') ? preferredMime : '') ||
    ''

  if (declared === SVG_MIME || input.type === SVG_MIME) {
    return new Blob([buffer], { type: SVG_MIME })
  }

  const detected = detectRasterMime(bytes, declared)
  if (!detected) {
    throw new Error(
      `无法识别的图片格式（${declared || 'unknown'}，${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB）`,
    )
  }

  return new Blob([buffer], { type: detected })
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('当前环境不支持图片解码（缺少 createImageBitmap）')
  }

  try {
    return await createImageBitmap(blob)
  } catch {
    throw new Error(
      `图片解码失败（${blob.type || 'unknown'}，${(blob.size / (1024 * 1024)).toFixed(1)}MB），请确认不是损坏文件`,
    )
  }
}

async function encodeWebp(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const size = resolveTargetSize(bitmap.width, bitmap.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('无法创建画布，图片处理失败')
  }

  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()

  const encoded = await canvasToBlob(canvas, WEBP_MIME, quality)
  if (!encoded || encoded.size === 0) {
    throw new Error('WebP 编码失败')
  }
  return encoded
}

/**
 * 统一压缩入口：只输出 WebP@80%
 */
export async function compressIfNeeded(
  input: Blob | File,
  cfg: StorageConfig = DEFAULT_STORAGE_CONFIG,
): Promise<Blob> {
  // 调用方可能已 materialize；这里再保证一次字节与 MIME 正确
  const source =
    input.type === SVG_MIME
      ? input
      : await materializeImageBlob(input)

  if (source.type === SVG_MIME) {
    return source
  }

  // 已是 WebP：不二次压缩
  if (source.type === WEBP_MIME) {
    if (source.size > MAX_IMAGE_STORE_BYTES) {
      throw new Error(
        `图片过大（约 ${(source.size / (1024 * 1024)).toFixed(1)}MB），超过 ${Math.floor(MAX_IMAGE_STORE_BYTES / (1024 * 1024))}MB 上限`,
      )
    }
    return source
  }

  const maxEdge = cfg.maxEdge ?? DEFAULT_STORAGE_CONFIG.maxEdge
  const quality = cfg.compressQuality ?? DEFAULT_STORAGE_CONFIG.compressQuality
  const bitmap = await decodeBitmap(source)
  const encoded = await encodeWebp(bitmap, maxEdge, quality)

  if (encoded.size > MAX_IMAGE_STORE_BYTES) {
    throw new Error(
      `图片过大（约 ${(encoded.size / (1024 * 1024)).toFixed(1)}MB），压缩后仍超过 ${Math.floor(MAX_IMAGE_STORE_BYTES / (1024 * 1024))}MB 上限`,
    )
  }

  return encoded
}

/**
 * 复制剪贴板 / 下载：统一转 PNG
 */
export async function convertImageBlobToPng(input: Blob): Promise<Blob> {
  const source =
    input.type === SVG_MIME
      ? input
      : await materializeImageBlob(input)

  if (source.type === SVG_MIME) {
    return source
  }
  if (source.type === PNG_MIME) {
    return source
  }

  const bitmap = await decodeBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('无法创建画布，PNG 转换失败')
  }

  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const png = await canvasToBlob(canvas, PNG_MIME)
  if (!png || png.size === 0) {
    throw new Error('转换为 PNG 失败')
  }
  return png
}

/**
 * 压缩图片（向后兼容薄封装）
 */
export async function compressImage(
  file: File,
  quality = DEFAULT_STORAGE_CONFIG.compressQuality,
): Promise<Blob> {
  return compressIfNeeded(file, {
    ...DEFAULT_STORAGE_CONFIG,
    compressQuality: quality,
  })
}

/**
 * 文件/Blob 转 base64
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      resolve(reader.result as string)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * 从剪切板事件提取图片文件
 */
export function getImageFromClipboard(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items
  if (!items) return null

  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      return item.getAsFile()
    }
  }

  return null
}

/**
 * 校验是否为有效的图片 URL
 */
export function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:'
  } catch {
    return false
  }
}
