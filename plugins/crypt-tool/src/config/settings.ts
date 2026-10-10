import type { AlgorithmModule } from '../registry/types'

export const SETTINGS_KEY = 'crypt-tool:settings'

export interface Settings {
  enabled: Record<string, boolean>
  prefs: { defaultOutputEncoding: 'base64' | 'hex' | 'text' }
}

export function defaultSettings(modules: AlgorithmModule[]): Settings {
  const enabled: Record<string, boolean> = {}
  for (const m of modules) enabled[m.meta.id] = m.meta.defaultEnabled
  return { enabled, prefs: { defaultOutputEncoding: 'base64' } }
}

export function loadSettings(modules: AlgorithmModule[]): Settings {
  const defaults = defaultSettings(modules)
  try {
    const raw = window.ztools.dbStorage.getItem(SETTINGS_KEY)
    if (!raw || typeof raw !== 'object') return defaults
    const saved = raw as Partial<Settings>
    const enabled: Record<string, boolean> = { ...defaults.enabled }
    if (saved.enabled && typeof saved.enabled === 'object') {
      for (const m of modules) {
        const v = (saved.enabled as Record<string, unknown>)[m.meta.id]
        if (typeof v === 'boolean') enabled[m.meta.id] = v
      }
    }
    const prefs = {
      defaultOutputEncoding:
        saved.prefs?.defaultOutputEncoding === 'hex' ||
        saved.prefs?.defaultOutputEncoding === 'text'
          ? saved.prefs.defaultOutputEncoding
          : defaults.prefs.defaultOutputEncoding
    }
    return { enabled, prefs }
  } catch {
    return defaults
  }
}

export function saveSettings(s: Settings): void {
  window.ztools.dbStorage.setItem(SETTINGS_KEY, s)
}

export function setEnabled(
  id: string,
  on: boolean,
  modules: AlgorithmModule[]
): Settings {
  const s = loadSettings(modules)
  s.enabled[id] = on
  saveSettings(s)
  return s
}
