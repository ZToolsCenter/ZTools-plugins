<script setup lang="ts">
import { computed, watch, onMounted, onBeforeUnmount, ref } from 'vue'
import { useConfigStore } from '../../stores/config'

const configStore = useConfigStore()
const theme = computed(() => configStore.config.other.theme)

function getSystemDark(): boolean {
  try {
    return (window as any).ztools?.isDarkColors?.() ?? false
  } catch {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false
  }
}

const systemDark = ref(getSystemDark())

const effectiveTheme = computed(() => {
  if (theme.value === 'auto') return systemDark.value ? 'dark' : 'light'
  return theme.value
})

function toggle() {
  const order: Array<'light' | 'dark' | 'auto'> = ['light', 'dark', 'auto']
  const idx = order.indexOf(theme.value)
  configStore.config.other.theme = order[(idx + 1) % 3]
  configStore.save()
}

const titleMap = { light: '浅色模式', dark: '深色模式', auto: '跟随系统' }
const nextMap = { light: '切换深色模式', dark: '切换自动模式', auto: '切换浅色模式' }

let mediaQuery: MediaQueryList | null = null
let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null

function applyTheme() {
  document.documentElement.setAttribute('data-theme', effectiveTheme.value)
}

watch(effectiveTheme, () => applyTheme(), { immediate: true })

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaHandler = (e: MediaQueryListEvent) => {
      systemDark.value = e.matches
    }
    mediaQuery.addEventListener('change', mediaHandler)
  }
})

onBeforeUnmount(() => {
  if (mediaQuery && mediaHandler) {
    mediaQuery.removeEventListener('change', mediaHandler)
  }
})
</script>

<template>
  <button class="theme-toggle" :title="nextMap[theme]" @click="toggle">
    <svg v-if="theme === 'light'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
    <svg v-else-if="theme === 'dark'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
    <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <circle cx="12" cy="10" r="3" />
      <path d="M12 7a3 3 0 0 1 0 6" />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  color: var(--c-ink-tertiary);
  background: var(--c-surface-raised);
  border: 1px solid var(--c-border);
  box-shadow: var(--shadow-sm);
  transition: background 0.2s var(--ease-out), color 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out), transform 0.2s var(--ease-out);
}

.theme-toggle:hover {
  color: var(--c-accent);
  background: var(--c-accent-soft);
  border-color: var(--c-accent-muted);
  box-shadow: var(--shadow-md);
  transform: scale(1.08);
}
</style>
