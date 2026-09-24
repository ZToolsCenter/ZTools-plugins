/** Parse GET /_alias body into index → alias names. */
export function aliasesByIndex(body: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out
  for (const [index, meta] of Object.entries(body as Record<string, unknown>)) {
    if (!meta || typeof meta !== 'object') continue
    const aliases = (meta as { aliases?: Record<string, unknown> }).aliases
    if (!aliases || typeof aliases !== 'object') continue
    out[index] = Object.keys(aliases).sort()
  }
  return out
}

/** Stable pastel-ish chip color from alias name. */
export function aliasChipColor(name: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    bg: `hsl(${hue} 55% 42%)`,
    fg: '#fff',
  }
}

export function validateIndexName(name: string): string | null {
  const n = name.trim()
  if (!n) return '索引名称不能为空'
  if (!/^[a-z0-9][a-z0-9._\-]*$/.test(n)) {
    return '索引名须小写，以字母或数字开头，可含 . _ -'
  }
  if (n.startsWith('.') || n.startsWith('_')) return '索引名不能以 . 或 _ 开头'
  return null
}
