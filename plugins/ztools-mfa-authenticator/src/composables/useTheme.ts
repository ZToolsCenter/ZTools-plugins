import { ref } from 'vue'

export type ThemeMode = 'dark' | 'light' | 'system'
export type IndicatorMode = 'ring' | 'bar'

const STORAGE_KEY = 'theme_preference'
const INDICATOR_KEY = 'indicator_preference'
const mode = ref<ThemeMode>('dark')
const indicatorMode = ref<IndicatorMode>('ring')

let mediaQuery: MediaQueryList | null = null

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme() {
  const resolved = mode.value === 'system' ? getSystemTheme() : mode.value
  document.documentElement.setAttribute('data-theme', resolved)
}

function onSystemChange() {
  if (mode.value === 'system') applyTheme()
}

export function useTheme() {
  function initialize() {
    try {
      const stored = window.ztools.dbStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        mode.value = stored
      }
      const storedIndicator = window.ztools.dbStorage.getItem(INDICATOR_KEY)
      if (storedIndicator === 'ring' || storedIndicator === 'bar') {
        indicatorMode.value = storedIndicator
      }
    } catch {
      // fall back to defaults
    }

    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', onSystemChange)

    applyTheme()
  }

  function setMode(newMode: ThemeMode) {
    mode.value = newMode
    applyTheme()
    try {
      window.ztools.dbStorage.setItem(STORAGE_KEY, mode.value)
    } catch {
      // ignore
    }
  }

  function setIndicator(newMode: IndicatorMode) {
    indicatorMode.value = newMode
    try {
      window.ztools.dbStorage.setItem(INDICATOR_KEY, newMode)
    } catch {
      // ignore
    }
  }

  return {
    mode,
    indicatorMode,
    initialize,
    setMode,
    setIndicator,
  }
}
