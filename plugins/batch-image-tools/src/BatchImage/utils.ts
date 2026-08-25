export function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

export function savingsPercent(input: number, output: number) {
  if (!input) return 0
  return Math.round(((input - output) / input) * 100)
}

export function pathBasename(filePath: string) {
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

export function resolveEnterPaths(action: {
  type?: string
  payload?: string | Array<{ path: string }>
}) {
  if (action.type === 'files' && Array.isArray(action.payload)) {
    return action.payload.map((item) => item.path)
  }
  if (action.type === 'img' && typeof action.payload === 'string') {
    const saved = window.services.saveBase64Image(action.payload)
    return [saved]
  }
  return []
}
