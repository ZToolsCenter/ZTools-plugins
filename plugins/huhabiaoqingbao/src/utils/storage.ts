import { fileSystemService } from './fileSystem'

// 本地存储的key常量
export const STORAGE_KEYS = {
  DARK_MODE: 'darkMode',
  THEME_MODE: 'themeMode',
  APP_LANGUAGE: 'appLanguage',
  SIDEBAR_STATE: 'sidebarState',
  THEME_COLOR: 'themeColor',
  GITHUB_GIST_BACKUP: 'githubGistBackup',
  BAIDU_TRANSLATE: 'baiduTranslateCredentials',
  COZE_AI: 'cozeAiCredentials'
} as const

// 预定义主题颜色配置
export const THEME_COLORS = {
  blue: {
    name: '静谧蓝',
    primary: '#5B9BD5',
    primaryLight: '#8BB8E8',
    primaryDark: '#4A7BA7'
  },
  green: {
    name: '清新绿',
    primary: '#42be77',
    primaryLight: '#6FD199',
    primaryDark: '#359A5F'
  },
  purple: {
    name: '优雅紫',
    primary: '#A569BD',
    primaryLight: '#C39BD3',
    primaryDark: '#8E44AD'
  },
  orange: {
    name: '温暖橙',
    primary: '#F39C12',
    primaryLight: '#F8C471',
    primaryDark: '#D68910'
  },
  red: {
    name: '柔和红',
    primary: '#E74C3C',
    primaryLight: '#EC7063',
    primaryDark: '#C0392B'
  },
  cyan: {
    name: '清澈青',
    primary: '#48C9B0',
    primaryLight: '#76D7C4',
    primaryDark: '#17A2B8'
  },
  indigo: {
    name: '深邃靛',
    primary: '#5D6D7E',
    primaryLight: '#85929E',
    primaryDark: '#34495E'
  },
  pink: {
    name: '甜美粉',
    primary: '#F1948A',
    primaryLight: '#F5B7B1',
    primaryDark: '#CD6155'
  }
} as const

export type ThemeColorKey = keyof typeof THEME_COLORS
export type ThemeMode = 'system' | 'light' | 'dark'
export type AppLanguage = 'zh-CN' | 'en-US'

// 设置缓存，避免频繁读取文件
let settingsCache: Record<string, any> | null = null
let cacheInitialized = false

// 初始化设置缓存
async function initCache(): Promise<void> {
  if (cacheInitialized) return

  try {
    settingsCache = await fileSystemService.readSettings()
    cacheInitialized = true
  } catch (error) {
    console.error('Failed to initialize settings cache:', error)
    settingsCache = {}
    cacheInitialized = true
  }
}

// 获取本地存储的值
export async function getStorageItem<T>(key: string, defaultValue: T): Promise<T> {
  await initCache()

  if (settingsCache && settingsCache.hasOwnProperty(key)) {
    return settingsCache[key] as T
  }
  return defaultValue
}

// 设置本地存储的值
export async function setStorageItem<T>(key: string, value: T): Promise<void> {
  await initCache()

  if (!settingsCache) {
    settingsCache = {}
  }

  settingsCache[key] = value

  try {
    await fileSystemService.saveSettings(settingsCache)
  } catch (error) {
    console.error('Failed to save settings:', error)
    throw error
  }
}

// 同步版本的函数，用于向后兼容
export function getStorageItemSync<T>(key: string, defaultValue: T): T {
  // 先尝试从缓存读取
  if (settingsCache && settingsCache.hasOwnProperty(key)) {
    return settingsCache[key] as T
  }

  // 如果缓存未初始化，尝试同步初始化（仅在 ZTools 环境中）
  if (!cacheInitialized && fileSystemService.isInZToolsEnvironment()) {
    try {
      // 尝试同步读取设置文件
      const settingsPath = fileSystemService.getSettingsFilePath()
      if (window.preload?.fs.existsSync(settingsPath)) {
        const content = window.preload.fs.readFileSync(settingsPath, 'utf8')
        settingsCache = JSON.parse(content as string)
        cacheInitialized = true

        if (settingsCache && settingsCache.hasOwnProperty(key)) {
          return settingsCache[key] as T
        }
      }
    } catch (error) {
      console.error('Failed to sync read settings:', error)
    }
  }

  // 最后降级到 localStorage
  const item = localStorage.getItem(key)
  return item ? JSON.parse(item) : defaultValue
}

// 同步版本的设置函数
export function setStorageItemSync<T>(key: string, value: T): void {
  // 同时更新缓存和文件
  if (!settingsCache) {
    settingsCache = {}
  }
  settingsCache[key] = value

  // 异步保存到文件系统
  fileSystemService.saveSettings(settingsCache).catch(error => {
    console.error('Failed to save settings (sync):', error)
  })

  // 同时保存到 localStorage 作为降级
  localStorage.setItem(key, JSON.stringify(value))
}
