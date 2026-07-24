import { computed, onMounted, onUnmounted, ref } from 'vue'

export function useColorScheme() {
  const isDark = ref(false)
  let mediaQuery: MediaQueryList | null = null

  const update = () => {
    isDark.value = !!mediaQuery?.matches
  }

  onMounted(() => {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    update()
    mediaQuery.addEventListener('change', update)
  })

  onUnmounted(() => {
    mediaQuery?.removeEventListener('change', update)
  })

  return {
    isDark: computed(() => isDark.value),
  }
}
