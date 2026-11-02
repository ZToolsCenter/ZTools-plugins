import { ref, watch } from 'vue'
import { getSettings, setSettings } from '../utils/storage'

type Theme = 'light' | 'dark'

const theme = ref<Theme>('light')
let _initialized = false

export function useTheme() {
  async function init() {
    if (_initialized) return
    try {
      const saved = await getSettings()
      if (saved?.theme === 'dark' || saved?.theme === 'light') {
        theme.value = saved.theme
      } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        theme.value = 'dark'
      }
      applyTheme()
      watch(theme, applyTheme)
      _initialized = true
    } catch (error) {
      console.error('Failed to load theme:', error)
      throw error
    }
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

  function reset() {
    theme.value = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  async function persist() {
    try {
      const existing = await getSettings() || {}
      await setSettings({ ...existing, theme: theme.value })
    } catch (error) {
      console.error('Failed to save theme:', error)
      throw error
    }
  }

  return { theme, init, toggle, set, reset, persist }
}
