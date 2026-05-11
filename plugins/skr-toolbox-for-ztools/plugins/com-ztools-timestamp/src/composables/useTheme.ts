import { ref, watchEffect } from 'vue'

export type Theme = 'light' | 'dark'

const theme = ref<Theme>('light')

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

export function useTheme() {
  function initTheme() {
    try {
      if (window.ztools?.isDarkColors?.()) {
        theme.value = 'dark'
      } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        theme.value = 'dark'
      }
    } catch {
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        theme.value = 'dark'
      }
    }
    applyTheme(theme.value)
  }

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    applyTheme(theme.value)
  }

  watchEffect(() => applyTheme(theme.value))

  return { theme, initTheme, toggleTheme }
}
