export const URL = globalThis.URL
export const URLSearchParams = globalThis.URLSearchParams
export function pathToFileURL(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const prefix = normalized.startsWith('//') ? 'file:' : 'file:///'
  return new URL(prefix + encodeURI(normalized).replaceAll('#', '%23').replaceAll('?', '%3F'))
}
