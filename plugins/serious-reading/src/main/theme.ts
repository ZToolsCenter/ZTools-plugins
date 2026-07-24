import { useEffect } from 'react'
import type { Settings } from '@/shared/types'
import { getSettings, saveSettings } from '@/shared/storage'

const MEDIA = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function resolveTheme(theme: Settings['theme']): 'light' | 'dark' {
  if (theme === 'auto') return MEDIA?.matches ? 'dark' : 'light'
  return theme
}

export function useTheme(settings: Settings, setSettings: (s: Settings) => void) {
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolveTheme(settings.theme) === 'dark')
  }, [settings.theme])

  useEffect(() => {
    if (!MEDIA) return
    const handler = () => {
      if (settings.theme === 'auto') {
        document.documentElement.classList.toggle('dark', MEDIA.matches)
      }
    }
    MEDIA.addEventListener('change', handler)
    return () => MEDIA.removeEventListener('change', handler)
  }, [settings.theme])

  const setTheme = (theme: Settings['theme']) => {
    const next = { ...settings, theme }
    saveSettings(next)
    setSettings(next)
    ;(window as any).services?.sendToReader?.('sr:settings', next)
  }
  return { setTheme }
}

export { getSettings, saveSettings }