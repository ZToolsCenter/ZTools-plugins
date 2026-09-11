import { isSafeExternalUrl } from '../utils/safeUrl'

export type ConvertWebFormat = 'word' | 'excel' | 'ppt'

export interface WebConvertLink {
  name: string
  url: string
}

export type WebConvertLinks = Record<ConvertWebFormat, WebConvertLink[]>

export const DEFAULT_WEB_CONVERT_LINKS: WebConvertLinks = {
  word: [
    { name: 'pdf.io', url: 'https://pdf.io/cn/pdf2doc/' },
    { name: 'iLovePDF', url: 'https://www.ilovepdf.com/zh-cn/pdf_to_word' },
  ],
  excel: [
    { name: 'pdf.io', url: 'https://pdf.io/cn/pdf2xls/' },
    { name: 'iLovePDF', url: 'https://www.ilovepdf.com/zh-cn/pdf_to_excel' },
  ],
  ppt: [
    { name: 'pdf.io', url: 'https://pdf.io/cn/pdf2ppt/' },
    { name: 'iLovePDF', url: 'https://www.ilovepdf.com/zh-cn/pdf_to_powerpoint' },
  ],
}

export const CONVERT_WEB_FORMAT_LABELS: Record<ConvertWebFormat, string> = {
  word: 'PDF 转 Word',
  excel: 'PDF 转 Excel',
  ppt: 'PDF 转 PPT',
}

function isLink(value: unknown): value is WebConvertLink {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as WebConvertLink).name === 'string' &&
    typeof (value as WebConvertLink).url === 'string'
  )
}

function normalizeList(value: unknown): WebConvertLink[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .filter(isLink)
    .map((item) => ({ name: item.name.trim(), url: item.url.trim() }))
    .filter((item) => item.name && item.url && isSafeExternalUrl(item.url))
}

/** 未配置时用默认；已配置（含空数组）则尊重用户选择 */
export function resolveWebConvertLinks(
  raw?: Partial<WebConvertLinks> | null,
): WebConvertLinks {
  if (!raw) return cloneWebConvertLinks(DEFAULT_WEB_CONVERT_LINKS)

  const result = cloneWebConvertLinks(DEFAULT_WEB_CONVERT_LINKS)
  for (const format of ['word', 'excel', 'ppt'] as ConvertWebFormat[]) {
    const list = normalizeList(raw[format])
    if (list !== undefined) result[format] = list
  }
  return result
}

export function cloneWebConvertLinks(links: WebConvertLinks): WebConvertLinks {
  return {
    word: links.word.map((item) => ({ ...item })),
    excel: links.excel.map((item) => ({ ...item })),
    ppt: links.ppt.map((item) => ({ ...item })),
  }
}
