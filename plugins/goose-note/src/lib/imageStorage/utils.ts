/**
 * 图片存储工具函数
 */

/**
 * Blob 转 Base64
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Base64 转 Blob
 */
export function base64ToBlob(base64: string): Blob {
  const [match, data] = base64.split(',')
  const mimeType = match?.match(/:(.*?);/)?.[1] || 'image/jpeg'

  const binaryString = atob(data)
  const bytes = new Uint8Array(binaryString.length)

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return new Blob([bytes], { type: mimeType })
}

/**
 * 从 MIME 类型获取文件扩展名
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico'
  }
  return extMap[mimeType] || 'jpg'
}

/**
 * 生成随机文件名
 */
export function generateImageFilename(mimeType: string): string {
  const timestamp = Date.now()
  const random = crypto.randomUUID().slice(0, 8)
  const ext = getExtensionFromMimeType(mimeType)
  return `img_${timestamp}_${random}.${ext}`
}

/**
 * 解析 base64 图片数据
 */
export function parseBase64Image(base64: string): { mimeType: string; extension: string; data: string } | null {
  const match = base64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/)
  if (!match) return null

  const mimeType = match[1]
  const extension = getExtensionFromMimeType(mimeType)
  const data = match[2]

  return { mimeType, extension, data }
}
