import { THEME_COLORS, type ThemeColorKey } from './storage'

/**
 * 主题系统工具类
 */
export class ThemeSystem {
  private static instance: ThemeSystem
  private currentTheme: ThemeColorKey = 'blue'

  private constructor() {}

  static getInstance(): ThemeSystem {
    if (!ThemeSystem.instance) {
      ThemeSystem.instance = new ThemeSystem()
    }
    return ThemeSystem.instance
  }

  /**
   * 应用主题颜色
   */
  applyTheme(themeKey: ThemeColorKey): void {
    this.currentTheme = themeKey
    const theme = THEME_COLORS[themeKey]

    if (!theme) {
      console.warn(`Theme ${themeKey} not found, falling back to blue`)
      this.applyTheme('blue')
      return
    }

    // 设置 CSS 自定义属性
    const root = document.documentElement

    // Element Plus 主题颜色变量
    root.style.setProperty('--el-color-primary', theme.primary)
    root.style.setProperty('--el-color-primary-light-1', this.lighten(theme.primary, 0.1))
    root.style.setProperty('--el-color-primary-light-2', this.lighten(theme.primary, 0.2))
    root.style.setProperty('--el-color-primary-light-3', this.lighten(theme.primary, 0.3))
    root.style.setProperty('--el-color-primary-light-4', this.lighten(theme.primary, 0.4))
    root.style.setProperty('--el-color-primary-light-5', this.lighten(theme.primary, 0.5))
    root.style.setProperty('--el-color-primary-light-6', this.lighten(theme.primary, 0.6))
    root.style.setProperty('--el-color-primary-light-7', this.lighten(theme.primary, 0.7))
    root.style.setProperty('--el-color-primary-light-8', this.lighten(theme.primary, 0.8))
    root.style.setProperty('--el-color-primary-light-9', this.lighten(theme.primary, 0.9))

    // 深色变体
    root.style.setProperty('--el-color-primary-dark-1', this.darken(theme.primary, 0.1))
    root.style.setProperty('--el-color-primary-dark-2', this.darken(theme.primary, 0.2))

    // 自定义主题变量
    root.style.setProperty('--theme-primary', theme.primary)
    root.style.setProperty('--theme-primary-light', theme.primaryLight)
    root.style.setProperty('--theme-primary-dark', theme.primaryDark)

    // 为应用组件设置数据属性
    root.setAttribute('data-theme-color', themeKey)
  }

  /**
   * 获取当前主题
   */
  getCurrentTheme(): ThemeColorKey {
    return this.currentTheme
  }

  /**
   * 获取当前主题配置
   */
  getCurrentThemeConfig() {
    return THEME_COLORS[this.currentTheme]
  }

  /**
   * 颜色变亮
   */
  private lighten(color: string, amount: number): string {
    return this.adjustBrightness(color, amount)
  }

  /**
   * 颜色变暗
   */
  private darken(color: string, amount: number): string {
    return this.adjustBrightness(color, -amount)
  }

  /**
   * 调整颜色亮度
   */
  private adjustBrightness(color: string, amount: number): string {
    // 移除 # 前缀
    const hex = color.replace('#', '')
    
    // 转换为 RGB
    const num = parseInt(hex, 16)
    const r = (num >> 16) & 255
    const g = (num >> 8) & 255
    const b = num & 255

    // 计算新的颜色值
    const newR = Math.max(0, Math.min(255, Math.round(r + (255 - r) * amount)))
    const newG = Math.max(0, Math.min(255, Math.round(g + (255 - g) * amount)))
    const newB = Math.max(0, Math.min(255, Math.round(b + (255 - b) * amount)))

    // 转换回十六进制
    const newHex = ((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')
    return `#${newHex}`
  }

  /**
   * 重置为默认主题
   */
  resetToDefault(): void {
    this.applyTheme('blue')
  }

  /**
   * 获取所有可用主题
   */
  getAllThemes() {
    return Object.entries(THEME_COLORS).map(([key, config]) => ({
      key: key as ThemeColorKey,
      ...config
    }))
  }
}

// 导出单例实例
export const themeSystem = ThemeSystem.getInstance()

// 导出便捷函数
export const applyTheme = (themeKey: ThemeColorKey) => themeSystem.applyTheme(themeKey)
export const getCurrentTheme = () => themeSystem.getCurrentTheme()
export const getCurrentThemeConfig = () => themeSystem.getCurrentThemeConfig()
export const resetTheme = () => themeSystem.resetToDefault()


