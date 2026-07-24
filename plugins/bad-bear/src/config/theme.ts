import { useZtoolsTheme } from 'ztools-ui'

let themeInitialized = false

function ensureThemeBridge(): void {
  if (typeof window.ztools.getThemeInfo !== 'function') {
    window.ztools.getThemeInfo = () => window.services.getThemeInfo()
  }

  if (typeof window.ztools.onThemeChange !== 'function') {
    window.ztools.onThemeChange = (callback) => window.services.onThemeChange(callback)
  }

  if (typeof window.ztools.internal.getPlatform !== 'function') {
    window.ztools.internal.getPlatform = () => window.services.getSystemInfo().platform
  }
}

export function useTheme() {
  ensureThemeBridge()

  if (themeInitialized) {
    return
  }

  useZtoolsTheme()
  themeInitialized = true
}
