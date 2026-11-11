import { onMounted, onUnmounted } from 'vue'

export type HostThemeInfo = {
  isDark?: boolean
  primaryColor?: string
  customColor?: string
  windowMaterial?: string
}

const PRIMARY_LIGHT: Record<string, string> = {
  blue: '#0284c7',
  purple: '#7c3aed',
  green: '#059669',
  orange: '#ea580c',
  red: '#dc2626',
  pink: '#db2777',
}

const PRIMARY_DARK: Record<string, string> = {
  blue: '#38bdf8',
  purple: '#a78bfa',
  green: '#34d399',
  orange: '#fb923c',
  red: '#f87171',
  pink: '#f472b6',
}

function resolveAccent(info: HostThemeInfo): string {
  const root = getComputedStyle(document.documentElement)
  const injected = root.getPropertyValue('--plugin-primary-color').trim()
  if (injected) return injected

  if (info.primaryColor === 'custom' && info.customColor && /^#[\da-f]{6}$/i.test(info.customColor)) {
    return info.customColor
  }
  const map = info.isDark ? PRIMARY_DARK : PRIMARY_LIGHT
  return map[info.primaryColor || 'green'] || map.green
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!m) return null
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

export function applyHostTheme(info: HostThemeInfo = {}): void {
  const root = document.documentElement
  const dark = Boolean(info.isDark)
  const accent = resolveAccent(info)

  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-hover', accent)
  root.style.setProperty('--selected', withAlpha(accent, dark ? 0.18 : 0.12))
  root.style.setProperty('--selected-border', withAlpha(accent, dark ? 0.35 : 0.28))
  root.style.setProperty('--badge-bg', withAlpha(accent, dark ? 0.22 : 0.14))
  root.style.setProperty('--badge-fg', accent)

  if (dark) {
    root.style.setProperty('--bg', '#12141a')
    root.style.setProperty('--surface', '#1a1d24')
    root.style.setProperty('--surface-2', '#22262f')
    root.style.setProperty('--text', '#e8eaed')
    root.style.setProperty('--muted', '#9aa3b2')
    root.style.setProperty('--border', '#2e3440')
    root.style.setProperty('--danger', '#f87171')
    root.style.setProperty('--danger-bg', 'rgba(248, 113, 113, 0.12)')
    root.style.setProperty('--danger-border', 'rgba(248, 113, 113, 0.35)')
    root.style.setProperty('--hover', 'rgba(255, 255, 255, 0.04)')
    root.style.setProperty('--input-bg', '#161920')
    root.style.setProperty('--tag-group-fg', '#7dd3fc')
    root.style.setProperty('--tag-group-bg', 'rgba(14, 165, 233, 0.18)')
    root.style.setProperty('--tag-group-border', 'rgba(125, 211, 252, 0.28)')
  } else {
    root.style.setProperty('--bg', '#f3f4f6')
    root.style.setProperty('--surface', '#ffffff')
    root.style.setProperty('--surface-2', '#f8fafc')
    root.style.setProperty('--text', '#1f2937')
    root.style.setProperty('--muted', '#6b7280')
    root.style.setProperty('--border', '#e5e7eb')
    root.style.setProperty('--danger', '#dc2626')
    root.style.setProperty('--danger-bg', '#fef2f2')
    root.style.setProperty('--danger-border', '#fecaca')
    root.style.setProperty('--hover', 'rgba(15, 23, 42, 0.04)')
    root.style.setProperty('--input-bg', '#ffffff')
    root.style.setProperty('--tag-group-fg', '#0369a1')
    root.style.setProperty('--tag-group-bg', 'rgba(14, 165, 233, 0.12)')
    root.style.setProperty('--tag-group-border', 'rgba(14, 165, 233, 0.28)')
  }
}

type ThemeHost = {
  getThemeInfo?: () => HostThemeInfo
  onThemeChange?: (cb: (info: HostThemeInfo) => void) => void
  isDarkColors?: () => boolean
}

function readHost(): ThemeHost | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((globalThis as any).ztools ?? (typeof window !== 'undefined' ? (window as any).ztools : null)) as
    | ThemeHost
    | null
}

/** Bind host theme to CSS variables for the plugin lifetime. */
export function useHostTheme(): void {
  let attached = false

  const refresh = (info?: HostThemeInfo) => {
    const z = readHost()
    if (info) {
      applyHostTheme(info)
      return
    }
    try {
      const fromApi = z?.getThemeInfo?.()
      if (fromApi) {
        applyHostTheme(fromApi)
        return
      }
    } catch {
      // fall through
    }
    applyHostTheme({ isDark: Boolean(z?.isDarkColors?.()) })
  }

  onMounted(() => {
    refresh()
    const z = readHost()
    if (z?.onThemeChange && !attached) {
      attached = true
      try {
        z.onThemeChange((info) => refresh(info))
      } catch {
        // optional
      }
    }
  })

  onUnmounted(() => {
    attached = false
  })
}
