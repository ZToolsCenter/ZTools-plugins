export function detectDark(): boolean {
  // Authoritative source: ZTools host. Check presence (not truthiness),
  // so a `false` return is respected instead of falling through to matchMedia.
  if (typeof window !== 'undefined' && (window as any).ztools?.isDarkColors) {
    return !!(window as any).ztools.isDarkColors()
  }
  // Fallback: prefers-color-scheme media query.
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return true
  }
  return false
}

export function applyTheme(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = detectDark() ? 'dark' : 'light'
}

// Per spec §11: no listeners, no broadcast; apply once on mount.
export function useTheme() {
  applyTheme()
}
