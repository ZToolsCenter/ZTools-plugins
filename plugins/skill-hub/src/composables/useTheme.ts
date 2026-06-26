import { computed } from 'vue'
import { useSettings } from './useSettings'

export function useTheme() {
  const { settings, updateSettings } = useSettings()

  const isDarkMode = computed(() => {
    if (settings.themeMode === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return settings.themeMode === 'dark'
  })

  function toggleTheme() {
    const next = isDarkMode.value ? 'light' : 'dark'
    updateSettings({ themeMode: next })
  }

  return { isDarkMode, toggleTheme }
}
