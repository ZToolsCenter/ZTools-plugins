import path from 'path-browserify'
const slash = (value: string) => value.replaceAll('\\', '/')
export const basename = (value: string, suffix?: string) => path.basename(slash(value).replace(/^[a-z]:/i, ''), suffix)
export const extname = (value: string) => path.extname(slash(value))
export const dirname = (value: string) => {
  const normalized = slash(value)
  if (/^[a-z]:\/+$/i.test(normalized)) return normalized.slice(0, 3)
  const result = path.dirname(normalized)
  return /^[a-z]:$/i.test(result) && normalized.startsWith(result + '/') ? result + '/' : result
}
export const joinPath = (...values: string[]) => {
  const normalized = values.map(slash)
  const result = path.join(...normalized)
  return normalized[0]?.startsWith('//') && !result.startsWith('//') ? '/' + result : result
}
