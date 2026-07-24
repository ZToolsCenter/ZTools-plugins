import type { Chapter } from '../stores/reader'
import { preprocessText, parseTxt } from './txtParser'

const PALMDB_HEADER_SIZE = 78
const RECORD_INFO_SIZE = 8
const MOBI_HEADER_MIN_SIZE = 16

const TEXT_ENCODING_UTF8 = 65001
const TEXT_ENCODING_CP1252 = 1252

// PalmDOC/MOBI compression types
const COMPRESSION_NONE = 1
const COMPRESSION_PALMDOC = 2
const COMPRESSION_HUFFCDIC = 17480

// PalmDOC/MOBI encryption types (see MobileRead Wiki: "MOBI" -> "MOBI DRM")
const ENCRYPTION_NONE = 0
const ENCRYPTION_OLD_MOBIPOCKET = 1 // single-PID scheme, PC1 stream cipher
const ENCRYPTION_MOBIPOCKET = 2 // multi-PID scheme, much stronger

interface PalmDocHeader {
  compression: number
  textLength: number
  recordCount: number
  recordSize: number
  encryptionType: number
}

interface MobiHeader {
  textEncoding: number
  firstNonBookIndex: number
  fullNameOffset: number
  fullNameLength: number
  language: number
  hasEXTH: boolean
  exthFlags: number
  headerLength: number
  firstImageIndex: number
}

interface EXTHRecord {
  type: number
  raw: Uint8Array
  text: string
}

function readUint8(data: Uint8Array, offset: number): number {
  return data[offset]
}

function readUint16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1]
}

function readUint32BE(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
}

function readString(data: Uint8Array, offset: number, length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    const ch = data[offset + i]
    if (ch === 0) break
    result += String.fromCharCode(ch)
  }
  return result
}

/**
 * The PDB file header (78 bytes) carries the TOTAL number of records in the
 * whole file (text + image + EXTH-adjacent + index records, etc.) in its
 * last 2 bytes. This is different from the PalmDOC header's "record count",
 * which only counts the TEXT records and lives inside record 0's data.
 */
function readTotalPdbRecordCount(data: Uint8Array): number {
  return readUint16BE(data, 76)
}

function getPalmDBRecordOffsets(data: Uint8Array, totalRecordCount: number): number[] {
  const offsets: number[] = []
  const base = PALMDB_HEADER_SIZE
  for (let i = 0; i < totalRecordCount; i++) {
    const recordOffset = base + i * RECORD_INFO_SIZE
    if (recordOffset + 4 > data.length) break
    offsets.push(readUint32BE(data, recordOffset))
  }
  return offsets
}

/**
 * The PalmDOC header lives at the very start of record 0's data (NOT at a
 * fixed absolute file offset) — `recordZeroOffset` must be `recordOffsets[0]`.
 */
function parsePalmDocHeader(data: Uint8Array, recordZeroOffset: number): PalmDocHeader {
  return {
    compression: readUint16BE(data, recordZeroOffset),
    textLength: readUint32BE(data, recordZeroOffset + 4),
    recordCount: readUint16BE(data, recordZeroOffset + 8),
    recordSize: readUint16BE(data, recordZeroOffset + 10),
    encryptionType: readUint16BE(data, recordZeroOffset + 12)
  }
}

/**
 * `recordZeroOffset` is the start of record 0 (same base as parsePalmDocHeader).
 * The 16-byte PalmDOC header comes first, then the MOBI header (whose 'MOBI'
 * magic therefore starts at recordZeroOffset + 16, not at recordZeroOffset).
 */
function parseMobiHeader(data: Uint8Array, recordZeroOffset: number): MobiHeader | null {
  const mobiStart = recordZeroOffset + 16

  if (mobiStart + MOBI_HEADER_MIN_SIZE > data.length) return null

  const magic = readString(data, mobiStart, 4)
  if (magic !== 'MOBI') return null

  const headerLength = readUint32BE(data, mobiStart + 4)
  const textEncoding = readUint32BE(data, mobiStart + 12)

  let firstNonBookIndex = 0
  let fullNameOffset = 0
  let fullNameLength = 0
  let language = 0
  let hasEXTH = false
  let exthFlags = 0
  let firstImageIndex = 0

  if (recordZeroOffset + 84 <= data.length) {
    firstNonBookIndex = readUint32BE(data, recordZeroOffset + 80)
  }
  if (recordZeroOffset + 88 <= data.length) {
    fullNameOffset = readUint32BE(data, recordZeroOffset + 84)
  }
  if (recordZeroOffset + 92 <= data.length) {
    fullNameLength = readUint32BE(data, recordZeroOffset + 88)
  }
  if (recordZeroOffset + 96 <= data.length) {
    language = readUint32BE(data, recordZeroOffset + 92)
  }
  if (recordZeroOffset + 112 <= data.length) {
    firstImageIndex = readUint32BE(data, recordZeroOffset + 108)
  }
  if (recordZeroOffset + 132 <= data.length) {
    exthFlags = readUint32BE(data, recordZeroOffset + 128)
    hasEXTH = (exthFlags & 0x40) !== 0
  }

  return {
    textEncoding,
    firstNonBookIndex,
    fullNameOffset,
    fullNameLength,
    language,
    hasEXTH,
    exthFlags,
    headerLength,
    firstImageIndex
  }
}

function parseEXTHRecords(data: Uint8Array, offset: number): EXTHRecord[] {
  const records: EXTHRecord[] = []
  if (offset + 12 > data.length) return records

  const magic = readString(data, offset, 4)
  if (magic !== 'EXTH') return records

  const recordCount = readUint32BE(data, offset + 8)

  let pos = offset + 12
  for (let i = 0; i < recordCount && pos + 8 <= data.length; i++) {
    const recordType = readUint32BE(data, pos)
    const recordLength = readUint32BE(data, pos + 4)
    if (recordLength < 8 || pos + recordLength > data.length) break

    const dataLength = recordLength - 8
    const raw = data.slice(pos + 8, pos + 8 + dataLength)
    let text = ''
    try {
      text = new TextDecoder('utf-8', { fatal: false }).decode(raw)
    } catch {
      text = readString(data, pos + 8, dataLength)
    }

    records.push({ type: recordType, raw, text })
    pos += recordLength
  }

  return records
}

function findExthRecord(records: EXTHRecord[], type: number): EXTHRecord | undefined {
  return records.find(r => r.type === type)
}

// Some EXTH records (cover offset, thumb offset, version numbers, ...) hold a
// raw big-endian integer rather than text — decoding them as UTF-8 text and
// then `parseInt`-ing the (often unprintable) result does not work.
function exthRawToUint(raw: Uint8Array): number {
  let value = 0
  for (let i = 0; i < raw.length; i++) {
    value = (value << 8) | raw[i]
  }
  return value >>> 0
}

function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  return null
}

/**
 * Cover art is stored as a separate, un-encrypted resource record — EXTH 201
 * gives an index that's added to the MOBI header's "first image index" field
 * to find the PDB record holding the cover JPEG/PNG/GIF bytes. Since this is
 * outside the encrypted text stream, it works for protected books too.
 */
function extractCoverUrl(
  data: Uint8Array,
  recordOffsets: number[],
  firstImageIndex: number,
  exthRecords: EXTHRecord[]
): string | undefined {
  try {
    const coverRecord = findExthRecord(exthRecords, 201)
    if (!coverRecord) return undefined

    if (firstImageIndex === 0xffffffff) return undefined
    const coverRecordIndex = firstImageIndex + exthRawToUint(coverRecord.raw)
    const start = recordOffsets[coverRecordIndex]
    const end = recordOffsets[coverRecordIndex + 1] ?? data.length
    if (start === undefined || start >= data.length || end > data.length || start >= end) return undefined

    const imageBytes = data.slice(start, end)
    const mime = detectImageMime(imageBytes)
    if (!mime) return undefined

    // 同步转换为 Base64，确保可以被 IndexedDB 永久缓存
    let binary = ''
    const len = imageBytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(imageBytes[i])
    }
    return `data:${mime};base64,${btoa(binary)}`
  } catch {
    return undefined
  }
}

function decompressPalmDoc(compressed: Uint8Array): Uint8Array {
  const output: number[] = []
  let i = 0

  while (i < compressed.length) {
    const byte = compressed[i++]

    if (byte === 0) {
      output.push(0)
    } else if (byte >= 1 && byte <= 8) {
      for (let j = 0; j < byte && i < compressed.length; j++) {
        output.push(compressed[i++])
      }
    } else if (byte >= 9 && byte <= 0x7f) {
      output.push(byte)
    } else if (byte >= 0x80 && byte <= 0xbf) {
      const next = compressed[i++] || 0
      const distance = (((byte << 8) | next) >> 3) & 0x7ff
      const length = (next & 0x7) + 3

      for (let j = 0; j < length; j++) {
        const srcIdx = output.length - distance
        if (srcIdx >= 0 && srcIdx < output.length) {
          output.push(output[srcIdx])
        } else {
          output.push(0x20)
        }
      }
    } else if (byte >= 0xc0) {
      output.push(0x20)
      output.push(byte ^ 0x80)
    }
  }

  return new Uint8Array(output)
}

function decodeMobiText(raw: Uint8Array, encoding: number): string {
  if (encoding === TEXT_ENCODING_UTF8) {
    return new TextDecoder('utf-8').decode(raw)
  }
  return new TextDecoder('windows-1252').decode(raw)
}

function stripHtmlTags(html: string): string {
  let text = html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/<[^>]+>/g, '')
  return text
}

function splitChaptersFromHtml(html: string): { title: string; content: string }[] {
  const chapterPattern = /<\s*(h[1-6]|body|mbp:pagebreak|div\s+class\s*=\s*["']chapter)/gi
  const parts: { title: string; content: string }[] = []

  const matches: { index: number; tag: string }[] = []
  let m: RegExpExecArray | null
  while ((m = chapterPattern.exec(html)) !== null) {
    matches.push({ index: m.index, tag: m[1].toLowerCase() })
  }

  if (matches.length === 0) {
    const text = stripHtmlTags(html)
    const cleaned = preprocessText(text)
    if (cleaned.trim().length > 0) {
      return [{ title: '全文', content: cleaned }]
    }
    return []
  }

  const segments: string[] = []
  let lastIdx = 0
  for (const match of matches) {
    if (match.index > lastIdx) {
      segments.push(html.slice(lastIdx, match.index))
    }
    lastIdx = match.index
  }
  if (lastIdx < html.length) {
    segments.push(html.slice(lastIdx))
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const text = stripHtmlTags(seg)
    const cleaned = preprocessText(text)
    if (cleaned.trim().length < 10) continue

    const headingMatch = seg.match(/<\s*h[1-6][^>]*>([\s\S]*?)<\/\s*h[1-6]>/i)
    const title = headingMatch
      ? stripHtmlTags(headingMatch[1]).trim()
      : `第 ${parts.length + 1} 章`

    parts.push({ title, content: cleaned })
  }

  return parts
}

function encryptionAdvisory(type: number): string {
  if (type === ENCRYPTION_OLD_MOBIPOCKET) {
    return '该书使用旧版 Mobipocket（单 PID）DRM 加密，正文受版权保护，本应用无法解密阅读；已读取到的仅为标题、作者、封面等元数据。'
  }
  if (type === ENCRYPTION_MOBIPOCKET) {
    return '该书使用 Mobipocket/Kindle DRM 加密，正文受版权保护，本应用无法解密阅读；已读取到的仅为标题、作者、封面等元数据。'
  }
  return '该书已加密，正文内容无法解析；已读取到的仅为标题、作者、封面等元数据。'
}

export async function parseMobi(file: File): Promise<{
  title: string
  author: string
  description: string
  chapters: Chapter[]
  coverUrl?: string
  encrypted?: boolean
  error?: string
}> {
  const buffer = await file.arrayBuffer()
  const data = new Uint8Array(buffer)

  if (data.length < PALMDB_HEADER_SIZE + RECORD_INFO_SIZE) {
    return { title: '', author: '', description: '', chapters: [], error: '文件太小，不是有效的MOBI文件' }
  }

  // The PDB header's own record count (not the PalmDOC "text record count")
  // is what's needed to enumerate every record (text + image + EXTH, etc.).
  const totalPdbRecordCount = readTotalPdbRecordCount(data)
  const recordOffsets = getPalmDBRecordOffsets(data, totalPdbRecordCount)

  if (recordOffsets.length === 0) {
    return { title: '', author: '', description: '', chapters: [], error: '无法读取MOBI文件的记录索引' }
  }

  const firstRecordOffset = recordOffsets[0]
  if (firstRecordOffset + 16 > data.length) {
    return { title: '', author: '', description: '', chapters: [], error: 'MOBI文件格式损坏或记录偏移越界' }
  }
  const palmDocHeader = parsePalmDocHeader(data, firstRecordOffset)
  const mobiHeader = parseMobiHeader(data, firstRecordOffset)

  // ---- Metadata: title / author / cover. None of this is encrypted, even
  // ---- when the book's text content is DRM-protected, so it always works. ----
  let title = file.name.replace(/\.mobi$/i, '')
  let author = ''
  let description = ''
  let exthRecords: EXTHRecord[] = []

  if (mobiHeader) {
    if (mobiHeader.fullNameLength > 0 && mobiHeader.fullNameOffset > 0) {
      try {
        const nameOffset = firstRecordOffset + mobiHeader.fullNameOffset
        if (nameOffset + mobiHeader.fullNameLength <= data.length) {
          const nameSlice = data.slice(nameOffset, nameOffset + mobiHeader.fullNameLength)
          title = new TextDecoder('utf-8', { fatal: false }).decode(nameSlice).replace(/\0/g, '') || title
        }
      } catch { }
    }

    if (mobiHeader.hasEXTH) {
      const exthOffset = firstRecordOffset + 16 + mobiHeader.headerLength
      exthRecords = parseEXTHRecords(data, exthOffset)

      const authorRecord = findExthRecord(exthRecords, 100) // EXTH 100 = author/creator
      if (authorRecord && authorRecord.text.trim()) {
        author = authorRecord.text.trim()
      }

      const descRecord = findExthRecord(exthRecords, 101) // EXTH 101 = description
      if (descRecord && descRecord.text.trim()) {
        description = descRecord.text.trim()
      }
    }
  }

  const coverUrl = mobiHeader
    ? extractCoverUrl(data, recordOffsets, mobiHeader.firstImageIndex, exthRecords)
    : undefined

  // ---- Encrypted books: stop here. We deliberately do not attempt to
  // ---- decrypt DRM-protected text — only the metadata above is returned. ----
  if (palmDocHeader.encryptionType !== ENCRYPTION_NONE) {
    return {
      title,
      author,
      description,
      chapters: [],
      coverUrl,
      encrypted: true,
      error: encryptionAdvisory(palmDocHeader.encryptionType)
    }
  }

  if (palmDocHeader.compression === COMPRESSION_HUFFCDIC) {
    return {
      title,
      author,
      description,
      chapters: [],
      coverUrl,
      error: '该书使用 HUFF/CDIC 高压缩格式，当前暂不支持解析正文（这与加密无关，是另一种压缩方案）。'
    }
  }

  // ---- Unencrypted: parse the actual text content as before. ----
  const textRecordStart = 1
  const textRecordEnd = mobiHeader
    ? Math.min(mobiHeader.firstNonBookIndex || recordOffsets.length, recordOffsets.length)
    : Math.min(palmDocHeader.recordCount + 1, recordOffsets.length)

  const textChunks: Array<Uint8Array<ArrayBuffer>> = []
  for (let i = textRecordStart; i < textRecordEnd; i++) {
    const start = recordOffsets[i]
    const end = recordOffsets[i + 1] ?? data.length
    if (start === undefined || start >= data.length || end > data.length || start >= end) continue

    const recordSlice = data.slice(start, end)
    let recordData = new Uint8Array(recordSlice.buffer as ArrayBuffer, recordSlice.byteOffset, recordSlice.byteLength)

    if (palmDocHeader.compression === COMPRESSION_PALMDOC) {
      try {
        const decompressed = decompressPalmDoc(recordData)
        recordData = new Uint8Array(decompressed.buffer as ArrayBuffer)
      } catch {
        // If decompression fails, use raw data
      }
    }

    textChunks.push(recordData)
  }

  const fullRaw = new Uint8Array(textChunks.reduce((sum, c) => sum + c.length, 0))
  let offset = 0
  for (const chunk of textChunks) {
    fullRaw.set(chunk, offset)
    offset += chunk.length
  }

  const encoding = mobiHeader?.textEncoding || TEXT_ENCODING_CP1252
  const fullText = decodeMobiText(fullRaw, encoding)

  const isHtml = /<html|<body|<p[\s>]/i.test(fullText)

  let chapters: Chapter[]

  if (isHtml) {
    const parts = splitChaptersFromHtml(fullText)
    chapters = parts.map((p, i) => ({
      index: i,
      title: p.title,
      content: p.content
    }))
  } else {
    chapters = parseTxt(fullText)
  }

  if (chapters.length === 0) {
    const cleaned = preprocessText(stripHtmlTags(fullText))
    if (cleaned.trim().length > 0) {
      chapters = [{ index: 0, title: '全文', content: cleaned }]
    }
  }

  return { title, author, description, chapters, coverUrl }
}