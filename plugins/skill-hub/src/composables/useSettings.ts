import { reactive } from 'vue'
import type { AppSettings, ThemeMode, FontSize, MotionPreference } from '../types'
import { storage } from '../utils/storage'
import { applyTheme } from '../utils/theme'

const state = reactive<AppSettings>(storage.getSettings())

function patch(patch: Partial<AppSettings>) {
  const next = { ...state, ...patch }
  Object.assign(state, next)
  try {
    storage.saveSettings(next)
  } catch (e) {
    console.error('[useSettings] saveSettings failed:', e)
  }
  applyTheme(next)
}

export function useSettings() {
  return { settings: state, updateSettings: patch }
}
