import { ref } from 'vue'
import { getSettings, setSettings } from '../utils/storage'

export interface AppSettings {
  closeAfterCopy: boolean
  autoFocus: boolean
  maxHistory: number
}

const DEFAULT_SETTINGS: AppSettings = {
  closeAfterCopy: true,
  autoFocus: true,
  maxHistory: 200,
}

const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })

export function useAppSettings() {
  async function load() {
    try {
      const saved = await getSettings()
      if (saved && typeof saved === 'object') {
        if (typeof saved.closeAfterCopy === 'boolean') settings.value.closeAfterCopy = saved.closeAfterCopy
        if (typeof saved.autoFocus === 'boolean') settings.value.autoFocus = saved.autoFocus
        if (typeof saved.maxHistory === 'number' && saved.maxHistory > 0) settings.value.maxHistory = saved.maxHistory
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }

  async function save() {
    try {
      // 合并写入，避免覆盖 theme 等其他字段（与 theme.persist 保持一致）
      const existing = await getSettings() || {}
      await setSettings({ ...existing, ...settings.value })
    } catch (e) {
      console.error('Failed to save settings:', e)
    }
  }

  return { settings, load, save }
}
