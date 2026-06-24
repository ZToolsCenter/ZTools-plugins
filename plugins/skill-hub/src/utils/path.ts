export function normalizePath(p: string): string {
  return (p || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .replace(/^\.\//, '')
}
