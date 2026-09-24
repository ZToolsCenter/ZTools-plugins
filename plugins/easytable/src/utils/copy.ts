/** 复制文本：优先 ztools，失败则 clipboard，再失败返回 false。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const ztools = (window as any).ztools
    if (ztools?.copyText) {
      await Promise.resolve().then(() => ztools.copyText(text))
      return true
    }
  } catch {
    // fall through
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }
  return false
}

export async function openExternal(url: string): Promise<void> {
  const ztools = (window as any).ztools
  try {
    if (ztools?.shellOpenExternal) {
      ztools.shellOpenExternal(url)
      return
    }
  } catch {
    // fall through
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
