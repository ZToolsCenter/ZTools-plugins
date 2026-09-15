export function detectDark(): boolean {
  if (typeof window !== 'undefined' && (window as any).ztools?.isDarkColors) {
    return !!(window as any).ztools.isDarkColors()
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return true
  }
  return false
}

export function applyTheme(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = detectDark() ? 'dark' : 'light'
}

export function useTheme() {
  applyTheme()
}
