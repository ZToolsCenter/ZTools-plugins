import type { Chapter } from '../stores/reader'

const DEFAULT_CHAPTER_REGEX = /^(第[零一二三四五六七八九十百千万\d]+[章节卷集部][\s\S]*?)$/m

export function preprocessText(text: string): string {
  let result = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
  return result
}

function isTocLike(lines: string[], start: number, end: number, regex: RegExp): boolean {
  let matchCount = 0
  let nonEmptyCount = 0
  for (let i = start; i < end; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    nonEmptyCount++
    if (regex.test(trimmed) && trimmed.length < 60) {
      matchCount++
    }
  }
  return nonEmptyCount > 0 && matchCount / nonEmptyCount >= 0.5
}

function findTocEnd(lines: string[], regex: RegExp): number {
  const windowSize = 20
  for (let i = 0; i <= lines.length - windowSize; i++) {
    if (isTocLike(lines, i, i + windowSize, regex)) {
      let end = i + windowSize
      while (end < lines.length) {
        const trimmed = lines[end].trim()
        if (trimmed && !regex.test(trimmed) && trimmed.length < 60) {
          let matchAfter = 0
          let nonEmptyAfter = 0
          for (let j = end + 1; j < Math.min(end + 11, lines.length); j++) {
            const t = lines[j].trim()
            if (!t) continue
            nonEmptyAfter++
            if (regex.test(t) && t.length < 60) matchAfter++
          }
          if (nonEmptyAfter === 0 || matchAfter / nonEmptyAfter < 0.5) break
        }
        end++
      }
      return end
    }
  }
  return 0
}

export function parseTxt(text: string, customRegex?: string): Chapter[] {
  const normalized = preprocessText(text)

  let regex: RegExp
  try {
    regex = customRegex ? new RegExp(customRegex, 'm') : DEFAULT_CHAPTER_REGEX
  } catch {
    regex = DEFAULT_CHAPTER_REGEX
  }

  const lines = normalized.split('\n')
  const tocEnd = findTocEnd(lines, regex)
  const contentLines = tocEnd > 0 ? lines.slice(tocEnd) : lines

  const chapters: Chapter[] = []
  let current: { title: string; lines: string[] } | null = null

  for (const line of contentLines) {
    const trimmed = line.trim()
    if (regex.test(trimmed) && trimmed.length < 60) {
      if (current) {
        chapters.push({
          index: chapters.length,
          title: current.title,
          content: current.lines.join('\n').trim()
        })
      }
      current = { title: trimmed, lines: [] }
    } else {
      if (!current) {
        current = { title: '正文', lines: [] }
      }
      current.lines.push(line)
    }
  }

  if (current) {
    chapters.push({
      index: chapters.length,
      title: current.title,
      content: current.lines.join('\n').trim()
    })
  }

  if (chapters.length === 0) {
    return [{
      index: 0,
      title: '全文',
      content: contentLines.join('\n').trim()
    }]
  }

  return chapters
}

export interface PageSlice {
  lines: string[]
  startIndex: number
  endIndex: number
}

export function getVisualPage(
  content: string,
  startIndex: number,
  lineLength: number,
  lineCount: number
): PageSlice {
  const safeLineLength = Math.max(1, Math.round(lineLength))
  const safeLineCount = Math.max(1, Math.round(lineCount))
  const start = Math.max(0, Math.min(startIndex, content.length))
  const lines: string[] = []
  let cursor = start

  while (cursor < content.length && lines.length < safeLineCount) {
    let line = ''
    let columns = 0

    while (cursor < content.length && columns < safeLineLength) {
      const char = content[cursor]
      if (char === '\n') {
        cursor += 1
        break
      }
      line += char
      cursor += 1
      columns += 1
    }

    if (columns >= safeLineLength && content[cursor] === '\n') {
      cursor += 1
    }

    lines.push(line)
  }

  return { lines, startIndex: start, endIndex: cursor }
}

export function buildPageStarts(
  content: string,
  lineLength: number,
  lineCount: number
): number[] {
  const safeLineLength = Math.max(1, Math.round(lineLength))
  const safeLineCount = Math.max(1, Math.round(lineCount))
  const starts = [0]
  let cursor = 0

  while (cursor < content.length) {
    const startCursor = cursor
    let lineIdx = 0

    while (cursor < content.length && lineIdx < safeLineCount) {
      let columns = 0
      while (cursor < content.length && columns < safeLineLength) {
        if (content[cursor] === '\n') {
          cursor += 1
          break
        }
        cursor += 1
        columns += 1
      }
      if (columns >= safeLineLength && content[cursor] === '\n') {
        cursor += 1
      }
      lineIdx += 1
    }

    if (cursor <= startCursor) break
    if (cursor < content.length) starts.push(cursor)
  }

  return starts
}

export function getPageIndexForStart(index: number, starts: number[]): number {
  let low = 0
  let high = Math.max(0, starts.length - 1)
  let result = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (starts[mid] <= index) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return result
}

export function getPreviousPageStart(index: number, starts: number[]): number {
  const pageIndex = getPageIndexForStart(index, starts)
  if (starts[pageIndex] === index) return starts[Math.max(0, pageIndex - 1)] ?? 0
  return starts[pageIndex] ?? 0
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as string ?? '')
    reader.onerror = reject
    reader.readAsText(file, 'utf-8')
  })
}

export async function readFileAutoEncoding(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(buffer)
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return text
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}
