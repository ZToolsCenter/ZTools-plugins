/** Only https: URLs may be opened via shellOpenExternal / recommend links. */

export function assertSafeExternalUrl(url: string): string {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('链接无效')
  }
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new Error('链接无效')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('仅允许 https 链接')
  }
  return parsed.toString()
}

export function isSafeExternalUrl(url: string): boolean {
  try {
    assertSafeExternalUrl(url)
    return true
  } catch {
    return false
  }
}
