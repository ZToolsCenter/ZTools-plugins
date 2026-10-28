export function normalizePath(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

export function isPathLike(value: string): boolean {
  const path = normalizePath(value)
  return /^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]{2}/.test(path)
}

export function basename(filePath: string): string {
  return normalizePath(filePath).split(/[\\/]/).pop() || filePath
}
