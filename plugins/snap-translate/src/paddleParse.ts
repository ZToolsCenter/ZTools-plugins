/**
 * 解析 PaddleOCR-json / RapidOCR 命令行 stdout（shipped，供测试与 preload 对齐）。
 */
export function parsePaddleOutput(stdout: string): {
  text: string
  blocks: string[]
  confidence?: number
  boxes: { text: string; left: number; top: number; right: number; bottom: number }[]
} {
  const raw = String(stdout || '').trim()
  if (!raw) throw new Error('Paddle OCR 无输出')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Paddle OCR 未返回 JSON: ' + raw.slice(0, 160))
  let json: any
  try {
    json = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new Error('Paddle OCR JSON 解析失败: ' + raw.slice(0, 160))
  }
  const items: any[] = Array.isArray(json.data)
    ? json.data
    : Array.isArray(json.result)
      ? json.result
      : Array.isArray(json)
        ? json
        : []
  if (json.code != null && json.code !== 100 && json.code !== 0 && items.length === 0) {
    throw new Error('Paddle OCR 错误码 ' + json.code + ': ' + (json.data || json.msg || ''))
  }
  const blocks: string[] = []
  const boxes: { text: string; left: number; top: number; right: number; bottom: number }[] = []
  let scoreSum = 0
  let scoreN = 0
  for (const it of items) {
    const t =
      typeof it === 'string'
        ? it
        : it && typeof it.text === 'string'
          ? it.text
          : it && typeof it.label === 'string'
            ? it.label
            : ''
    const s = String(t).trim()
    if (s) blocks.push(s)
    const sc = Number(it && (it.score ?? it.confidence))
    if (!Number.isNaN(sc) && sc > 0) {
      scoreSum += sc
      scoreN++
    }
    const rawBox = it && (it.box || it.points || it.rect)
    if (s && Array.isArray(rawBox) && rawBox.length >= 4) {
      const xs = rawBox.map((p: any) => (Array.isArray(p) ? Number(p[0]) : Number(p.x)))
      const ys = rawBox.map((p: any) => (Array.isArray(p) ? Number(p[1]) : Number(p.y)))
      const left = Math.min(...xs)
      const right = Math.max(...xs)
      const top = Math.min(...ys)
      const bottom = Math.max(...ys)
      if (right - left > 2 && bottom - top > 2) {
        boxes.push({ text: s, left, top, right, bottom })
      }
    }
  }
  return {
    text: blocks.join('\n'),
    blocks,
    confidence: scoreN ? scoreSum / scoreN : undefined,
    boxes
  }
}
