import { parseDslJson } from './dslValidate'
import { normalizeRestPath, validateRestPath } from './restValidate'

export type RestScriptRequest = {
  id: string
  method: string
  path: string
  bodyText: string
  /** 0-based line index of method line in full script */
  headerLine: number
  bodyStartLine: number
  bodyEndLine: number
  startOffset: number
  endOffset: number
}

export type RestScriptMarker = {
  severity: 'error' | 'warning'
  message: string
  /** inclusive start / exclusive end offsets in full script */
  start: number
  end: number
  requestId: string
}

const HEADER_RE = /^(GET|POST|PUT|DELETE|HEAD)\s+(\S+)\s*$/i

export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

export function lineOffsets(text: string): number[] {
  const lines = splitLines(text)
  const offsets: number[] = []
  let pos = 0
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < lines.length; i++) {
    offsets.push(pos)
    pos += lines[i].length
    if (i < lines.length - 1) pos += 1 // \n
  }
  // ensure we use normalized length consistency
  void normalized
  return offsets
}

export function parseRestScript(text: string): RestScriptRequest[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = splitLines(normalized)
  const offsets = lineOffsets(normalized)
  const headers: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_RE.test(lines[i].trim())) headers.push(i)
  }
  if (!headers.length) return []

  const reqs: RestScriptRequest[] = []
  for (let h = 0; h < headers.length; h++) {
    const headerLine = headers[h]
    const nextHeader = h + 1 < headers.length ? headers[h + 1] : lines.length
    const header = lines[headerLine].trim()
    const m = header.match(HEADER_RE)!
    const method = m[1].toUpperCase()
    const path = m[2]
    const bodyLines = lines.slice(headerLine + 1, nextHeader)
    // trim trailing blank lines from body
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop()
    // skip leading blank lines
    let bodyStartLine = headerLine + 1
    while (bodyLines.length && !bodyLines[0].trim()) {
      bodyLines.shift()
      bodyStartLine++
    }
    const bodyText = bodyLines.join('\n')
    const bodyEndLine = bodyText ? bodyStartLine + bodyLines.length - 1 : headerLine
    const startOffset = offsets[headerLine] ?? 0
    const endLine = Math.max(headerLine, bodyEndLine)
    const endOffset =
      (offsets[endLine] ?? normalized.length) + (lines[endLine]?.length ?? 0)
    reqs.push({
      id: `req-${h}-${headerLine}`,
      method,
      path,
      bodyText,
      headerLine,
      bodyStartLine: bodyText ? bodyStartLine : headerLine,
      bodyEndLine,
      startOffset,
      endOffset,
    })
  }
  return reqs
}

function jsonErrorRange(
  bodyText: string,
  bodyStartOffset: number,
  parseError: string,
): { start: number; end: number } {
  // V8: Unexpected token } in JSON at position 12
  const posMatch = parseError.match(/position\s+(\d+)/i)
  if (posMatch) {
    const p = Number(posMatch[1])
    const start = bodyStartOffset + Math.max(0, Math.min(p, Math.max(0, bodyText.length - 1)))
    return { start, end: Math.min(start + 1, bodyStartOffset + bodyText.length) }
  }
  // Firefox-ish: at line 2 column 3
  const lc = parseError.match(/line\s+(\d+)\s+column\s+(\d+)/i)
  if (lc) {
    const line = Number(lc[1]) - 1
    const col = Number(lc[2]) - 1
    const lines = splitLines(bodyText)
    let off = bodyStartOffset
    for (let i = 0; i < lines.length; i++) {
      if (i === line) {
        const start = off + Math.max(0, Math.min(col, lines[i].length))
        return { start, end: Math.min(start + 1, bodyStartOffset + bodyText.length) }
      }
      off += lines[i].length + 1
    }
  }
  return {
    start: bodyStartOffset,
    end: bodyStartOffset + Math.max(1, bodyText.length),
  }
}

export function validateRestScript(text: string): {
  requests: RestScriptRequest[]
  markers: RestScriptMarker[]
} {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const offsets = lineOffsets(normalized)
  const requests = parseRestScript(normalized)
  const markers: RestScriptMarker[] = []

  if (!normalized.trim()) {
    return { requests, markers }
  }

  if (!requests.length) {
    markers.push({
      severity: 'error',
      message:
        '\u672a\u8bc6\u522b\u5230\u8bf7\u6c42\uff1a\u6bcf\u4e2a\u8bf7\u6c42\u9700\u4ee5 GET|POST|PUT|DELETE|HEAD \u548c\u8def\u5f84\u5f00\u5934',
      start: 0,
      end: Math.min(1, normalized.length) || 0,
      requestId: '',
    })
    return { requests, markers }
  }

  for (const req of requests) {
    const headerStart = offsets[req.headerLine] ?? req.startOffset
    const headerLineText = splitLines(normalized)[req.headerLine] ?? ''
    const headerEnd = headerStart + headerLineText.length

    const pathHints = validateRestPath(req.path)
    for (const h of pathHints) {
      if (h.severity === 'info') continue
      // underline path portion of header after method
      const methodLen = req.method.length
      const pathStartInLine = headerLineText.indexOf(req.path)
      const start =
        pathStartInLine >= 0 ? headerStart + pathStartInLine : headerStart + methodLen + 1
      const end = pathStartInLine >= 0 ? start + req.path.length : headerEnd
      markers.push({
        severity: h.severity === 'error' ? 'error' : 'warning',
        message: h.message,
        start,
        end: Math.max(start + 1, end),
        requestId: req.id,
      })
    }

    const body = req.bodyText.trim()
    if (!body) {
      continue
    }

    if (req.method === 'HEAD') {
      const bodyStart = offsets[req.bodyStartLine] ?? req.startOffset
      const bodyEnd = (offsets[req.bodyEndLine] ?? bodyStart) + (splitLines(normalized)[req.bodyEndLine]?.length ?? 0)
      markers.push({
        severity: 'warning',
        message: 'HEAD \u4e0d\u5e94\u643a\u5e26 Body\uff0c\u53d1\u9001\u65f6\u4f1a\u5ffd\u7565 Body',
        start: bodyStart,
        end: Math.max(bodyStart + 1, bodyEnd),
        requestId: req.id,
      })
    }

    const parsed = parseDslJson(body)
    if (parsed.error) {
      const bodyStart = offsets[req.bodyStartLine] ?? req.startOffset
      const range = jsonErrorRange(req.bodyText, bodyStart, parsed.error)
      markers.push({
        severity: 'error',
        message: `Body JSON \u65e0\u6548\uff1a${parsed.error}`,
        start: range.start,
        end: range.end,
        requestId: req.id,
      })
    } else if (parsed.value !== null && typeof parsed.value !== 'object') {
      const bodyStart = offsets[req.bodyStartLine] ?? req.startOffset
      const bodyEnd = bodyStart + req.bodyText.length
      markers.push({
        severity: 'warning',
        message: 'Body \u5efa\u8bae\u4f7f\u7528 JSON \u5bf9\u8c61\u6216\u6570\u7ec4',
        start: bodyStart,
        end: Math.max(bodyStart + 1, bodyEnd),
        requestId: req.id,
      })
    }
  }

  return { requests, markers }
}

export function requestHasError(markers: RestScriptMarker[], requestId: string): boolean {
  return markers.some((m) => m.requestId === requestId && m.severity === 'error')
}

export function buildRequestPayload(req: RestScriptRequest): {
  method: string
  path: string
  body?: unknown
  error?: string
} {
  const method = req.method.toUpperCase()
  const path = normalizeRestPath(req.path)
  const trimmed = req.bodyText.trim()
  // HEAD never sends a body; GET may (ES _search).
  if (!trimmed || method === 'HEAD') return { method, path }
  const parsed = parseDslJson(trimmed)
  if (parsed.error) return { method, path, error: parsed.error }
  return { method, path, body: parsed.value }
}

/** Pretty-print JSON bodies in a Dev Tools script; skip bodies that fail to parse. */
export function formatRestScript(text: string): { text: string; skipped: number } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const requests = parseRestScript(normalized)
  if (!requests.length) return { text: normalized, skipped: 0 }

  const lines = splitLines(normalized)
  let skipped = 0
  const out: string[] = []
  let cursor = 0

  for (const req of requests) {
    // lines before this request header
    while (cursor < req.headerLine) {
      out.push(lines[cursor])
      cursor++
    }
    out.push(lines[req.headerLine])
    cursor = req.headerLine + 1

    const nextHeader = (() => {
      const idx = requests.indexOf(req)
      return idx + 1 < requests.length ? requests[idx + 1].headerLine : lines.length
    })()

    const rawBodyLines = lines.slice(req.headerLine + 1, nextHeader)
    // preserve leading blank lines after header
    let lead = 0
    while (lead < rawBodyLines.length && !rawBodyLines[lead].trim()) lead++
    let trailStart = rawBodyLines.length
    while (trailStart > lead && !rawBodyLines[trailStart - 1].trim()) trailStart--
    const bodySlice = rawBodyLines.slice(lead, trailStart)
    const bodyText = bodySlice.join('\n')

    for (let i = 0; i < lead; i++) out.push('')

    if (bodyText.trim()) {
      try {
        const pretty = JSON.stringify(JSON.parse(bodyText), null, 2)
        out.push(...pretty.split('\n'))
      } catch {
        skipped++
        out.push(...bodySlice)
      }
    }

    for (let i = trailStart; i < rawBodyLines.length; i++) out.push('')
    cursor = nextHeader
  }

  while (cursor < lines.length) {
    out.push(lines[cursor])
    cursor++
  }

  return { text: out.join('\n'), skipped }
}

/** Build highlighted HTML with underlines; escapes text and wraps marker ranges. */
export function buildHighlightHtml(text: string, markers: RestScriptMarker[]): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized) return '\n'
  const actionable = markers
    .filter((m) => m.end > m.start)
    .sort((a, b) => a.start - b.start || b.end - a.end)

  // merge overlapping by severity priority error > warning
  type Seg = { start: number; end: number; severity: 'error' | 'warning'; message: string }
  const segs: Seg[] = []
  for (const m of actionable) {
    const start = Math.max(0, Math.min(m.start, normalized.length))
    const end = Math.max(start, Math.min(m.end, normalized.length))
    if (end <= start) continue
    segs.push({ start, end, severity: m.severity, message: m.message })
  }

  let html = ''
  let cursor = 0
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  // simple non-overlapping walk: if overlap, prefer error and skip covered
  const used: boolean[] = Array(normalized.length).fill(false)
  const marks: Seg[] = []
  for (const s of segs.sort((a, b) => a.start - b.start || (a.severity === 'error' ? -1 : 1))) {
    let start = s.start
    while (start < s.end && used[start]) start++
    let end = s.end
    while (end > start && used[end - 1]) end--
    if (end <= start) continue
    for (let i = start; i < end; i++) used[i] = true
    marks.push({ ...s, start, end })
  }
  marks.sort((a, b) => a.start - b.start)

  for (const mark of marks) {
    if (cursor < mark.start) html += escape(normalized.slice(cursor, mark.start))
    const cls = mark.severity === 'error' ? 'mark-error' : 'mark-warn'
    const title = escape(mark.message)
    html += `<span class="${cls}" title="${title}">${escape(normalized.slice(mark.start, mark.end))}</span>`
    cursor = mark.end
  }
  if (cursor < normalized.length) html += escape(normalized.slice(cursor))
  // keep trailing newline so overlay height matches textarea
  if (!html.endsWith('\n')) html += '\n'
  return html
}

export const DEFAULT_REST_SCRIPT = `GET /_cluster/health

GET /cms_notice/_search
{
  "query": {
    "match_all": {}
  },
  "size": 20
}
`
