import { MORANDI_THEMES, FONT_SIZES } from '../types'
import type { AppSettings, MorandiTheme, ThemeMode, FontSize, MotionPreference } from '../types'

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!m) return null
  const r = parseInt(m[1], 16) / 255
  const g = parseInt(m[2], 16) / 255
  const b = parseInt(m[3], 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function getThemeHue(settings: AppSettings): number {
  if (settings.themeColor.startsWith('#')) {
    const hsl = hexToHsl(settings.themeColor)
    return hsl ? hsl.h : 210
  }
  const t = MORANDI_THEMES.find((t) => t.id === settings.themeColor)
  return t ? t.hue : 210
}

function getThemeSaturation(settings: AppSettings): number {
  if (settings.themeColor.startsWith('#')) {
    const hsl = hexToHsl(settings.themeColor)
    return hsl ? hsl.s : 35
  }
  const t = MORANDI_THEMES.find((t) => t.id === settings.themeColor)
  return t ? t.saturation : 35
}

function resolveMode(settings: AppSettings): 'light' | 'dark' {
  if (settings.themeMode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return settings.themeMode
}

export function applyTheme(settings: AppSettings): void {
  const root = document.documentElement
  const mode = resolveMode(settings)
  const hue = getThemeHue(settings)
  const sat = getThemeSaturation(settings)
  const fontVal = FONT_SIZES[settings.fontSize] || '16px'
  const basePx = parseInt(fontVal, 10)
  const ratio = basePx / 16
  const isDark = mode === 'dark'

  root.setAttribute('data-theme', mode)
  root.style.setProperty('--theme-hue', String(hue))
  root.style.setProperty('--theme-saturation', `${sat}%`)
  root.style.setProperty('--theme-lightness-offset', isDark ? '40%' : '55%')
  root.style.setProperty('--primary', `${hue} ${sat}% 55%`)
  root.style.setProperty('--base-font-size', fontVal)
  root.style.fontSize = fontVal
  root.style.setProperty('--app-zoom', String(ratio))

  if (settings.compactMode) {
    root.setAttribute('data-compact', '')
  } else {
    root.removeAttribute('data-compact')
  }

  applyMotion(settings.motionPreference)
  applyBackground(settings)
}

export function applyMotion(pref: MotionPreference): void {
  const root = document.documentElement
  root.setAttribute('data-motion', pref)
}

export function applyBackground(settings: AppSettings): void {
  const root = document.documentElement
  const el = document.querySelector('.app-background') as HTMLElement | null
  if (!el) return
  if (settings.backgroundImage && settings.backgroundImageEnabled) {
    root.setAttribute('data-has-bg', '')
    el.style.backgroundImage = `url("${settings.backgroundImage.replace(/"/g, '\\"')}")`
    el.style.opacity = String(settings.backgroundOpacity / 100)
    el.style.filter = settings.backgroundBlur > 0 ? `blur(${settings.backgroundBlur}px)` : ''
    el.style.display = 'block'
  } else {
    root.removeAttribute('data-has-bg')
    el.style.display = 'none'
    el.style.backgroundImage = ''
    el.style.opacity = ''
    el.style.filter = ''
  }
}

export function getMandiThemes(): MorandiTheme[] {
  return MORANDI_THEMES
}

export { hexToHsl }
