const STORAGE_KEYS = {
  favorites: 'ascii-art-favorites',
  settings: 'ascii-art-settings',
  theme: 'ascii-art-theme',
  lastFont: 'ascii-art-last-font',
} as const

export interface ArtSettings {
  horizontalLayout: string
  verticalLayout: string
  showFavoritesOnly: boolean
}

const defaultSettings: ArtSettings = {
  horizontalLayout: 'default',
  verticalLayout: 'default',
  showFavoritesOnly: false,
}

function dbGet(key: string): any {
  try {
    return window.ztools?.dbStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function dbSet(key: string, value: any): void {
  try {
    window.ztools?.dbStorage?.setItem(key, value)
  } catch {}
}

export function useStorage() {
  function getFavorites(): string[] {
    return dbGet(STORAGE_KEYS.favorites) ?? []
  }

  function setFavorites(fonts: string[]): void {
    dbSet(STORAGE_KEYS.favorites, fonts)
  }

  function getSettings(): ArtSettings {
    return dbGet(STORAGE_KEYS.settings) ?? { ...defaultSettings }
  }

  function setSettings(settings: ArtSettings): void {
    dbSet(STORAGE_KEYS.settings, settings)
  }

  function getThemeIndex(): number {
    return dbGet(STORAGE_KEYS.theme) ?? 0
  }

  function setThemeIndex(index: number): void {
    dbSet(STORAGE_KEYS.theme, index)
  }

  function getLastFont(): string {
    return dbGet(STORAGE_KEYS.lastFont) ?? 'Standard'
  }

  function setLastFont(font: string): void {
    dbSet(STORAGE_KEYS.lastFont, font)
  }

  return {
    getFavorites,
    setFavorites,
    getSettings,
    setSettings,
    getThemeIndex,
    setThemeIndex,
    getLastFont,
    setLastFont,
  }
}
