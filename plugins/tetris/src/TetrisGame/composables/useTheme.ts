import { ref, onUnmounted } from 'vue'
import { useStorage } from '../../composables/useStorage'
import { setThemeName } from '../engine'
import type { ThemeName } from '../themes'

const { getItem, setItem } = useStorage()
const STORAGE_KEY = 'tetrisTheme'

export function useTheme() {
  const currentTheme = ref<ThemeName>('modern')

  function loadSavedTheme() {
    const saved = getItem(STORAGE_KEY) as ThemeName | null
    if (saved && ['neon', 'modern', 'retro'].includes(saved)) {
      currentTheme.value = saved
    }
  }

  function setTheme(name: ThemeName) {
    document.body.classList.remove('theme-' + currentTheme.value)
    currentTheme.value = name
    document.body.classList.add('theme-' + name)
    setItem(STORAGE_KEY, name)
    setThemeName(name)
  }

  // Initialize
  loadSavedTheme()
  // Apply initial theme to body safely (preserve host app classes)
  document.body.classList.add('theme-' + currentTheme.value)
  setThemeName(currentTheme.value)

  onUnmounted(() => {
    document.body.classList.remove('theme-' + currentTheme.value)
  })

  return {
    currentTheme,
    setTheme,
  }
}
