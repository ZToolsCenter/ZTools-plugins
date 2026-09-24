import { lineOffsets, validateRestScript } from './restScript'
import { isSearchPath, validateSearchBodySchema } from './searchSchemaValidate'

/** Extend validateRestScript with _search JSON Schema issues. */
export function validateRestScriptWithSchema(text: string): ReturnType<typeof validateRestScript> {
  const base = validateRestScript(text)
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const offsets = lineOffsets(normalized)

  for (const req of base.requests) {
    if (!isSearchPath(req.path) || !req.bodyText.trim()) continue
    let body: unknown
    try {
      body = JSON.parse(req.bodyText)
    } catch {
      continue
    }
    const issues = validateSearchBodySchema(body)
    const bodyStart = offsets[req.bodyStartLine] ?? req.startOffset
    for (const issue of issues) {
      const bodyEnd = bodyStart + req.bodyText.length
      base.markers.push({
        severity: issue.severity,
        message: `_search schema: ${issue.message}`,
        start: bodyStart,
        end: Math.max(bodyStart + 1, bodyEnd),
        requestId: req.id,
      })
    }
  }
  return base
}
