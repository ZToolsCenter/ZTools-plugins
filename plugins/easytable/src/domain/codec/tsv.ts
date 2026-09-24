/**
 * TSV / 通用分隔文本编解码。
 * 规则：列用 delimiter（默认 \t），含 delimiter/换行/引号 时 CSV 式双引号包裹。
 * 正反方向必须可往返。
 */

export function encodeCell(value: string, delimiter = '\t'): string {
  if (value === '') return ''
  const needsQuote =
    value.includes(delimiter) ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes('"')
  if (!needsQuote) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function encodeRow(cells: string[], delimiter = '\t'): string {
  return cells.map((c) => encodeCell(c, delimiter)).join(delimiter)
}

export function encodeTable(rows: string[][], delimiter = '\t'): string {
  return rows.map((r) => encodeRow(r, delimiter)).join('\n')
}

/** 解析分隔文本为二维数组。支持引号包裹、"" 转义、CRLF。 */
export function parseDelimited(text: string, delimiter = '\t'): string[][] {
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0

  const pushCell = () => {
    row.push(cell)
    cell = ''
  }
  const pushRow = () => {
    pushCell()
    // 跳过完全空行
    if (!(row.length === 1 && row[0] === '')) out.push(row)
    row = []
  }

  while (i < src.length) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === delimiter) {
      pushCell()
      i += 1
      continue
    }
    if (ch === '\n') {
      pushRow()
      i += 1
      continue
    }
    cell += ch
    i += 1
  }
  // 末尾无换行
  if (cell !== '' || row.length > 0) pushRow()
  return out
}

export function encodeTsv(rows: string[][]): string {
  return encodeTable(rows, '\t')
}

export function parseTsv(text: string): string[][] {
  return parseDelimited(text, '\t')
}

export function encodeCsv(rows: string[][]): string {
  // UTF-8 BOM，Excel 双击打开不乱码
  return '﻿' + encodeTable(rows, ',')
}

export function parseCsv(text: string): string[][] {
  const body = text.startsWith('﻿') ? text.slice(1) : text
  return parseDelimited(body, ',')
}
