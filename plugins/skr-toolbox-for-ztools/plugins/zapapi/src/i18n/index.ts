import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import en from './locales/en'

function getSystemLocale(): 'zh-CN' | 'zh-TW' | 'en' {
  const lang = navigator.language || (navigator as any).userLanguage || 'en'
  if (lang.startsWith('zh-TW') || lang.startsWith('zh-HK') || lang.startsWith('zh-MO')) return 'zh-TW'
  if (lang.startsWith('zh')) return 'zh-CN'
  return 'en'
}

type SavedLocale = 'zh-CN' | 'zh-TW' | 'en' | 'system'

function getSavedLocale(): SavedLocale {
  try {
    const saved = localStorage.getItem('zapapi-locale')
    if (saved && ['zh-CN', 'zh-TW', 'en', 'system'].includes(saved)) {
      return saved as SavedLocale
    }
  } catch {}
  return 'system'
}

function resolveLocale(): 'zh-CN' | 'zh-TW' | 'en' {
  const saved = getSavedLocale()
  if (saved === 'system') return getSystemLocale()
  return saved
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    'en': en
  }
})

export function setLocale(locale: 'zh-CN' | 'zh-TW' | 'en' | 'system') {
  if (locale === 'system') {
    localStorage.setItem('zapapi-locale', 'system')
    ;(i18n.global as any).locale.value = getSystemLocale()
  } else {
    localStorage.setItem('zapapi-locale', locale)
    ;(i18n.global as any).locale.value = locale
  }
}

export function getLocale(): string {
  try {
    return localStorage.getItem('zapapi-locale') || 'system'
  } catch {
    return 'system'
  }
}
