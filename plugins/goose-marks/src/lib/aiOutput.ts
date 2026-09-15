export function truncateAIText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : ''
  return Array.from(text).slice(0, maxLength).join('')
}

export function normalizeAIConfidence(value: unknown, fallback = 0.5) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(1, Math.max(0, number))
}

/**
 * 从模型原始文本中解析 JSON 对象。
 * 兼容：纯 JSON、```json 代码块、前后夹杂说明文字。
 */
export function parseAIJsonObject(raw: string): Record<string, unknown> {
  const text = (raw || '').trim()
  if (!text) {
    throw new SyntaxError('AI 返回为空')
  }

  const candidates: string[] = [text]

  // ```json ... ``` / ``` ... ```
  const fenceMatch = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim())
  }

  // 截取首个 { ... } 或 [ ... ] 平衡片段
  const objectSlice = extractBalancedJsonSlice(text, '{', '}')
  if (objectSlice) candidates.push(objectSlice)
  const arraySlice = extractBalancedJsonSlice(text, '[', ']')
  if (arraySlice) candidates.push(arraySlice)

  let lastError: unknown = null
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      // 少数模型会直接返回数组；包一层便于调用方取字段时失败更清晰
      if (Array.isArray(parsed)) {
        return { items: parsed }
      }
    } catch (err) {
      lastError = err
    }
  }

  throw lastError instanceof Error ? lastError : new SyntaxError('AI 返回不是有效 JSON')
}

function extractBalancedJsonSlice(text: string, open: '{' | '[', close: '}' | ']'): string | null {
  const start = text.indexOf(open)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
