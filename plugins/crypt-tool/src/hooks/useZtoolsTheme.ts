import { useEffect, useLayoutEffect, useState } from 'react'

const DEFAULT_PRIMARY = 'rgb(88, 164, 246)'

interface ZtoolsThemeInfo {
  isDark?: boolean
  primaryColor?: string
  customColor?: string
  windowMaterial?: string
}

interface ThemeCapableZtools {
  isDarkColors?: () => boolean
  onThemeChange?: (listener: (info: ZtoolsThemeInfo) => void) => void | (() => void)
}

export interface ZtoolsTheme {
  primaryColor: string
  isDark: boolean
}

function readThemeColorFromCSS(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const style = getComputedStyle(document.documentElement)
    const candidates = [
      '--ztools-primary',
      '--ztools-color-primary',
      '--ztools-theme-color',
      '--theme-primary',
      '--accent-color',
      '--primary-color'
    ]
    for (const name of candidates) {
      const val = style.getPropertyValue(name).trim()
      if (val) return val
    }
  } catch {
    // 宿主未注入主题变量时使用默认色
  }
  return null
}

function parseRgb(color: string): [number, number, number] | null {
  const input = color.trim()
  const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const raw = hex[1]
    const expanded = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16)
    ]
  }
  const rgb = input.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

function relativeLuminance(color: string): number {
  const rgb = parseRgb(color)
  if (!rgb) return 0.5
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function accentInk(color: string): string {
  return relativeLuminance(color) > 0.179 ? '#08131e' : '#f7fafc'
}

function readInitialTheme(): ZtoolsTheme {
  if (typeof window === 'undefined') return { primaryColor: DEFAULT_PRIMARY, isDark: false }
  const ztools = window.ztools as unknown as ThemeCapableZtools | undefined
  const cssColor = readThemeColorFromCSS()
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const isDark = ztools?.isDarkColors?.() ?? prefersDark
  return {
    primaryColor: cssColor || DEFAULT_PRIMARY,
    isDark
  }
}

function applyTheme(theme: ZtoolsTheme) {
  const root = document.documentElement
  root.style.setProperty('--blue', theme.primaryColor)
  root.style.setProperty('--ct-on-accent', accentInk(theme.primaryColor))
  root.classList.toggle('theme-dark', theme.isDark)
  root.classList.toggle('theme-light', !theme.isDark)
}

export function useZtoolsTheme(): ZtoolsTheme {
  const [theme, setTheme] = useState<ZtoolsTheme>(readInitialTheme)

  useLayoutEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const handleSystem = () => {
      const ztools = window.ztools as unknown as ThemeCapableZtools | undefined
      const isDark = ztools?.isDarkColors?.() ?? media?.matches ?? false
      setTheme((prev) => ({ ...prev, isDark }))
    }
    media?.addEventListener('change', handleSystem)

    let unsubscribe: void | (() => void)
    try {
      const ztools = window.ztools as unknown as ThemeCapableZtools | undefined
      unsubscribe = ztools?.onThemeChange?.((info) => {
        setTheme((prev) => ({
          primaryColor: info.primaryColor || prev.primaryColor,
          isDark: typeof info.isDark === 'boolean' ? info.isDark : prev.isDark
        }))
        if (info.customColor) {
          document.documentElement.style.setProperty('--custom-color', info.customColor)
        }
        if (info.windowMaterial) {
          document.documentElement.dataset.windowMaterial = info.windowMaterial
        }
      })
    } catch {
      // 宿主未提供 onThemeChange 扩展时忽略
    }

    return () => {
      media?.removeEventListener('change', handleSystem)
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  return theme
}
