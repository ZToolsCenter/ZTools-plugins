// 图标套装导出预设
export const ICON_PACK_PRESETS = [
  {
    id: 'favicon',
    name: 'Favicon 套装',
    description: '网站图标标准尺寸',
    formats: ['png', 'ico'],
    sizes: [16, 32, 48, 64, 128, 256]
  },
  {
    id: 'pwa',
    name: 'PWA Icons',
    description: 'Progressive Web App 图标',
    formats: ['png'],
    sizes: [72, 96, 128, 144, 152, 192, 384, 512]
  },
  {
    id: 'android',
    name: 'Android Launcher',
    description: 'Android 应用图标',
    formats: ['png'],
    sizes: [48, 72, 96, 144, 192, 512]
  },
  {
    id: 'ios',
    name: 'iOS App Icon',
    description: 'iOS 应用图标',
    formats: ['png'],
    sizes: [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024]
  },
  {
    id: 'electron',
    name: 'Electron Icon',
    description: 'Electron 桌面应用图标',
    formats: ['png', 'ico'],
    sizes: [16, 24, 32, 48, 64, 128, 256, 512, 1024]
  }
] as const

export type IconPackPresetId = typeof ICON_PACK_PRESETS[number]['id']

export function getIconPackPreset(id: IconPackPresetId) {
  return ICON_PACK_PRESETS.find(p => p.id === id)
}
