import { ref, watch } from 'vue'
import { getSettings, setSettings } from '../utils/storage'

type Theme = 'light' | 'dark'

const theme = ref<Theme>('light')
let _initialized = false

export function useTheme() {
  async function init() {
    if (_initialized) return
    _initialized = true
    try {
      const saved = await getSettings()
      if (saved?.theme === 'dark' || saved?.theme === 'light') {
        theme.value = saved.theme
      } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        theme.value = 'dark'
      }
    } catch {}
    applyTheme()
    watch(theme, applyTheme)
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme.value)
  }

  function toggle() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }

  function set(t: Theme) {
    theme.value = t
  }

  async function persist() {
    try {
      const existing = await getSettings() || {}
      await setSettings({ ...existing, theme: theme.value })
    } catch {}
  }

  return { theme, init, toggle, set, persist }
}
