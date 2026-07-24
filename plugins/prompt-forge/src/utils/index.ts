import type { Variable } from '../types'

/** 从文本中提取 {{name}} 或 ${name} 变量 */
export function extractVariables(text: string): Variable[] {
  const regex = /(?:\{\{|\$\{)([a-zA-Z0-9_-]+)(?:=([^}]+))?(?:\}\}|\})/g
  const vars: Variable[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const name = match[1]
    const defaultVal = match[2] || ''
    if (!seen.has(name)) {
      seen.add(name)
      vars.push({ name, required: !defaultVal, defaultValue: defaultVal || undefined })
    }
  }
  return vars
}

/** 替换文本中的变量为实际值 */
export function renderVariables(text: string, values: Record<string, string>): string {
  if (!text) return ''
  return text.replace(/(?:\{\{|\$\{)([a-zA-Z0-9_-]+)(?:=[^}]+)?(?:\}\}|\})/g, (_, name) => {
    return values[name] ?? `{{${name}}}`
  })
}

/** 二元组相似度 */
function bigramSimilarity(a: string, b: string): number {
  const getBigrams = (s: string) => {
    const lower = s.toLowerCase().replace(/\s+/g, '')
    const set = new Set<string>()
    for (let i = 0; i < lower.length - 1; i++) set.add(lower.slice(i, i + 2))
    return set
  }
  const aSet = getBigrams(a)
  const bSet = getBigrams(b)
  if (aSet.size === 0 || bSet.size === 0) return 0
  let intersection = 0
  for (const bg of bSet) if (aSet.has(bg)) intersection++
  return intersection / (aSet.size + bSet.size - intersection)
}

/** 生成 UUID */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** 自动从正文推断标题 */
export function inferTitle(body: string): string {
  if (!body) return '未命名'
  const lines = body.split('\n')
  let firstLine = ''
  for (const line of lines) { const t = line.trim(); if (t) { firstLine = t; break } }
  if (!firstLine) return '未命名'
  let title = firstLine.replace(/^#+\s*/, '').trim().replace(/\s+/g, ' ')
  if (title.length > 25) return title.slice(0, 25) + '…'
  return title
}

/** 检测重复 */
export async function detectDuplicate(
  existing: Array<{ content: string; id: string }>,
  newContent: string,
  newId: string
): Promise<{ phase: 'normal' | 'exact' | 'similar'; exactId?: string; similarItems: Array<{ id: string; score: number }> }> {
  const exact = existing.find(e => e.id !== newId && e.content === newContent)
  if (exact) return { phase: 'exact', exactId: exact.id, similarItems: [] }
  const similar: Array<{ id: string; score: number }> = []
  for (const item of existing) {
    if (item.id === newId) continue
    const score = bigramSimilarity(newContent, item.content)
    if (score >= 0.8) similar.push({ id: item.id, score })
  }
  similar.sort((a, b) => b.score - a.score)
  return { phase: similar.length ? 'similar' : 'normal', similarItems: similar.slice(0, 3) }
}
