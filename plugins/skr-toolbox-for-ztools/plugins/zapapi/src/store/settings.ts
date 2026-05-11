import { ref, watch } from 'vue'

export type ThemeMode = 'system' | 'dark' | 'light'

interface SettingsState {
  theme: ThemeMode
  onboardingSeen: boolean
  shortcutsEnabled: boolean
  cookiesEnabled: boolean
  persistSessionCookies: boolean
}

const STORAGE_KEY = 'zapapi-settings'

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light'
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        theme: isThemeMode(parsed.theme) ? parsed.theme : 'system',
        onboardingSeen: Boolean(parsed.onboardingSeen),
        shortcutsEnabled: parsed.shortcutsEnabled !== false,
        cookiesEnabled: parsed.cookiesEnabled !== false,
        persistSessionCookies: parsed.persistSessionCookies === true
      }
    }
  } catch {}

  return {
    theme: 'system',
    onboardingSeen: false,
    shortcutsEnabled: true,
    cookiesEnabled: true,
    persistSessionCookies: false
  }
}

function saveSettings(state: SettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement
  if (theme === 'system') {
    root.setAttribute('data-theme', getSystemTheme())
    return
  }

  root.setAttribute('data-theme', theme)
}

function getSystemTheme(): 'dark' | 'light' {
  try {
    if (typeof window !== 'undefined' && window.ztools?.isDarkColors) {
      return window.ztools.isDarkColors() ? 'dark' : 'light'
    }
  } catch {}

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const state = ref<SettingsState>(loadSettings())

applyTheme(state.value.theme)

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.value.theme === 'system') {
    applyTheme('system')
  }
})

export function useSettingsStore() {
  function setTheme(theme: ThemeMode): void {
    state.value.theme = theme
    applyTheme(theme)
    saveSettings(state.value)
  }

  function getTheme(): ThemeMode {
    return state.value.theme
  }

  function getActualTheme(): 'dark' | 'light' {
    if (state.value.theme === 'system') {
      return getSystemTheme()
    }

    return state.value.theme
  }

  function hasSeenOnboarding(): boolean {
    return state.value.onboardingSeen
  }

  function setOnboardingSeen(seen: boolean): void {
    state.value.onboardingSeen = seen
    saveSettings(state.value)
  }

  function isShortcutsEnabled(): boolean {
    return state.value.shortcutsEnabled
  }

  function setShortcutsEnabled(enabled: boolean): void {
    state.value.shortcutsEnabled = enabled
    saveSettings(state.value)
  }

  function isCookiesEnabled(): boolean {
    return state.value.cookiesEnabled
  }

  function setCookiesEnabled(enabled: boolean): void {
    state.value.cookiesEnabled = enabled
    saveSettings(state.value)
  }

  function shouldPersistSessionCookies(): boolean {
    return state.value.persistSessionCookies
  }

  function setPersistSessionCookies(enabled: boolean): void {
    state.value.persistSessionCookies = enabled
    saveSettings(state.value)
  }

  return {
    state,
    setTheme,
    getTheme,
    getActualTheme,
    hasSeenOnboarding,
    setOnboardingSeen,
    isShortcutsEnabled,
    setShortcutsEnabled,
    isCookiesEnabled,
    setCookiesEnabled,
    shouldPersistSessionCookies,
    setPersistSessionCookies
  }
}
