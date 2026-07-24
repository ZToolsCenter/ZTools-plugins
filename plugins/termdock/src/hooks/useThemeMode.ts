import { useEffect, useState } from 'react'

export type ResolvedThemeMode = 'default-dark' | 'default-light'
export type ThemeMode = 'system' | ResolvedThemeMode

function resolveSystemTheme(): ResolvedThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'default-light'
  }
  return 'default-dark'
}

export function useThemeMode(themeName: ThemeMode = 'system') {
  const [systemTheme, setSystemTheme] = useState<ResolvedThemeMode>(() => resolveSystemTheme())
  const resolvedTheme = themeName === 'system' ? systemTheme : themeName

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return undefined
    }

    const media = window.matchMedia('(prefers-color-scheme: light)')
    const update = () => setSystemTheme(media.matches ? 'default-light' : 'default-dark')
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themePreference = themeName
    document.documentElement.style.colorScheme = resolvedTheme === 'default-light' ? 'light' : 'dark'
    return () => {
      if (document.documentElement.dataset.theme === resolvedTheme) {
        delete document.documentElement.dataset.theme
      }
      if (document.documentElement.dataset.themePreference === themeName) {
        delete document.documentElement.dataset.themePreference
      }
      if (document.documentElement.style.colorScheme === (resolvedTheme === 'default-light' ? 'light' : 'dark')) {
        document.documentElement.style.removeProperty('color-scheme')
      }
    }
  }, [resolvedTheme, themeName])

  return resolvedTheme
}
