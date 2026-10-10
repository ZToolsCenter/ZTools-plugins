import { useEffect, useState } from 'react'

// 默认主题色（与当前 --blue 一致）
const DEFAULT_PRIMARY = 'rgb(88, 164, 246)'

// 尝试从 ztools 注入的 CSS 变量中读取主题色
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
      '--primary-color',
    ]
    for (const name of candidates) {
      const val = style.getPropertyValue(name).trim()
      if (val) return val
    }
  } catch {
    // ignore
  }
  return null
}

export interface ZtoolsTheme {
  /** 主色调 */
  primaryColor: string
  /** 是否为深色模式 */
  isDark: boolean
}

export function useZtoolsTheme(): ZtoolsTheme {
  const [theme, setTheme] = useState<ZtoolsTheme>(() => {
    const isDark = (typeof window !== 'undefined' && window.ztools?.isDarkColors?.()) ?? false
    const cssColor = readThemeColorFromCSS()
    return {
      primaryColor: cssColor && cssColor.length > 0 ? cssColor : DEFAULT_PRIMARY,
      isDark,
    }
  })

  useEffect(() => {
    const cssColor = readThemeColorFromCSS()
    if (cssColor && cssColor.length > 0) {
      document.documentElement.style.setProperty('--blue', cssColor)
      setTheme((prev) => ({ ...prev, primaryColor: cssColor }))
    }

    // 监听系统主题变化
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const isDark = window.ztools?.isDarkColors?.() ?? mq.matches
      setTheme((prev) => ({ ...prev, isDark }))
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return theme
}
