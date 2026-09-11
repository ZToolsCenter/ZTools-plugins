import type { IconItem, OutputFormat } from '../types/icon'

export function iconFileName(icon: IconItem, format: OutputFormat): string {
  const base = `${icon.prefix}-${icon.name}`
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return `${base || 'icon'}.${format}`
}

export async function svgToPngDataUrl(svg: string, size: number): Promise<string> {
  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const objectUrl = URL.createObjectURL(source)

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('SVG 渲染失败'))
      element.src = objectUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前环境不支持 PNG 转换')
    context.clearRect(0, 0, size, size)
    context.drawImage(image, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function fallbackCopyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持剪贴板')
  await navigator.clipboard.writeText(text)
}

async function fallbackCopyPng(dataUrl: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持图片剪贴板')
  }
  const blob = await (await fetch(dataUrl)).blob()
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export async function copyAsset(format: OutputFormat, svg: string, pngDataUrl?: string): Promise<void> {
  if (format === 'svg') {
    if (window.ztools?.copyText) {
      const copied = window.ztools.copyText(svg)
      if (copied !== false) return
    }
    await fallbackCopyText(svg)
    return
  }

  if (!pngDataUrl) throw new Error('PNG 尚未生成')
  if (window.ztools?.copyImage) {
    const copied = window.ztools.copyImage(pngDataUrl)
    if (copied !== false) return
  }
  await fallbackCopyPng(pngDataUrl)
}

function downloadInBrowser(fileName: string, href: string): void {
  const link = document.createElement('a')
  link.download = fileName
  link.href = href
  link.click()
}

export function saveAsset(
  icon: IconItem,
  format: OutputFormat,
  svg: string,
  pngDataUrl?: string
): string | null {
  const fileName = iconFileName(icon, format)

  if (format === 'svg') {
    if (window.iconServices) return window.iconServices.saveTextFile(fileName, svg)
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    downloadInBrowser(fileName, blobUrl)
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    return fileName
  }

  if (!pngDataUrl) throw new Error('PNG 尚未生成')
  if (window.iconServices) return window.iconServices.saveBase64File(fileName, pngDataUrl)
  downloadInBrowser(fileName, pngDataUrl)
  return fileName
}
