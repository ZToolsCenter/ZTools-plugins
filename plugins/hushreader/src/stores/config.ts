import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface HushreaderConfig {
  hushreaderWidth: number
  hushreaderHeight: number
  hushreaderX: number
  hushreaderY: number
  hideOnMouseLeave: 'off' | 'show-progress' | 'hide-all'
  mouseEnterDelay: number
  showHushreaderMeta: boolean
  wheelTurnPage: boolean
  prevPageKey: string
  nextPageKey: string
  addBookmarkKey: string
  destroyKey: string
  opacity: number
  bgOpacity: number
  bgColor: string
  textColor: string
  fontSize: number
  fontFamily: string
  lineHeight: number
  letterSpacing: number
  autoFlipEnabled: boolean
  autoFlipInterval: number
  continuousFlip: boolean
  progressMode: 'chapter' | 'percent'
}

export interface AppearanceConfig {
  fontSize: number
  fontFamily: string
  lineHeight: number
  letterSpacing: number
  textColor: string
  bgColor: string
  bgOpacity: number
  windowWidth: number
  windowHeight: number
}

export interface FunctionConfig {
  scrollWheelEnabled: boolean
  scrollWheelDelay: number
  nextPageKeys: string[]
  prevPageKeys: string[]
  nextChapterKeys: string[]
  prevChapterKeys: string[]
  autoFlipEnabled: boolean
  autoFlipInterval: number
  mouseHideEnabled: boolean
  windowMovable: boolean
  windowSizeLocked: boolean
}

export interface OtherConfig {
  configName: string
  plainTextCover: boolean
  listMode: boolean
  chapterRegex: string
  customFonts: string[]
  theme: 'light' | 'dark' | 'auto'
  timerEnabled: boolean
  timerMinutes: number
  showImages: boolean
}

export interface ReaderConfig {
  hushreader: HushreaderConfig
  function: FunctionConfig
  other: OtherConfig
  appearance: AppearanceConfig
}

const DEFAULT_CONFIG: ReaderConfig = {
  hushreader: {
    hushreaderWidth: 700,
    hushreaderHeight: 100,
    hushreaderX: 0,
    hushreaderY: 0,
    hideOnMouseLeave: 'hide-all',
    mouseEnterDelay: 0,
    showHushreaderMeta: true,
    wheelTurnPage: true,
    prevPageKey: 'ArrowLeft',
    nextPageKey: 'ArrowRight',
    addBookmarkKey: 'Shift+F',
    destroyKey: 'Shift+D',
    opacity: 82,
    bgOpacity: 100,
    bgColor: '#1e1f22',
    textColor: '#cccccc',
    fontSize: 16,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    lineHeight: 1.8,
    letterSpacing: 0,
    autoFlipEnabled: false,
    autoFlipInterval: 5000,
    continuousFlip: false,
    progressMode: 'percent'
  },
  function: {
    scrollWheelEnabled: true,
    scrollWheelDelay: 300,
    nextPageKeys: ['ArrowRight', 'PageDown'],
    prevPageKeys: ['ArrowLeft', 'PageUp'],
    nextChapterKeys: ['Ctrl+ArrowRight'],
    prevChapterKeys: ['Ctrl+ArrowLeft'],
    autoFlipEnabled: false,
    autoFlipInterval: 5000,
    mouseHideEnabled: true,
    windowMovable: true,
    windowSizeLocked: false
  },
  other: {
    configName: '配置',
    plainTextCover: false,
    listMode: false,
    chapterRegex: '',
    customFonts: [],
    theme: 'auto',
    timerEnabled: false,
    timerMinutes: 30,
    showImages: false
  },
  appearance: {
    fontSize: 16,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    lineHeight: 1.8,
    letterSpacing: 0,
    textColor: '#333333',
    bgColor: '#ffffff',
    bgOpacity: 1,
    windowWidth: 700,
    windowHeight: 500
  }
}

function storageGet(key: string): string | null {
  try {
    const zStorage = (window as any).ztools?.dbStorage
    if (zStorage?.getItem) {
      const val = zStorage.getItem(key)
      if (val != null) return typeof val === 'string' ? val : JSON.stringify(val)
    }
  } catch { }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string) {
  try {
    const zStorage = (window as any).ztools?.dbStorage
    if (zStorage?.setItem) {
      zStorage.setItem(key, value)
      return
    }
  } catch { }
  try {
    window.localStorage.setItem(key, value)
  } catch { }
}

export const useConfigStore = defineStore('config', () => {
  const config = ref<ReaderConfig>(structuredClone(DEFAULT_CONFIG))
  const configList = ref<{ name: string; config: ReaderConfig }[]>([
    { name: '默认配置', config: structuredClone(DEFAULT_CONFIG) }
  ])
  const activeConfigIndex = ref(0)

  function load() {
    const data = storageGet('hushreader_config')
    if (data) {
      try {
        const saved = JSON.parse(data)
        if (saved?.hushreader?.hideOnMouseLeave === true) {
          saved.hushreader.hideOnMouseLeave = 'hide-all'
        } else if (saved?.hushreader?.hideOnMouseLeave === false) {
          saved.hushreader.hideOnMouseLeave = 'off'
        }
        config.value = deepMerge(structuredClone(DEFAULT_CONFIG), saved)
      } catch { }
    }
    const listData = storageGet('hushreader_config_list')
    if (listData) {
      try {
        const parsed = JSON.parse(listData)
        if (Array.isArray(parsed) && parsed.length > 0) {
          configList.value = parsed
        }
      } catch { }
    }
    const idxData = storageGet('hushreader_active_config')
    if (idxData) {
      const idx = parseInt(idxData, 10)
      if (Number.isFinite(idx) && idx >= 0 && idx < configList.value.length) {
        activeConfigIndex.value = idx
      }
    }
    if (configList.value.length > 0) {
      const active = configList.value[activeConfigIndex.value]
      if (active?.config) {
        config.value = deepMerge(structuredClone(DEFAULT_CONFIG), active.config)
      }
    }
  }

  function save() {
    storageSet('hushreader_config', JSON.stringify(config.value))
    if (configList.value[activeConfigIndex.value]) {
      configList.value[activeConfigIndex.value].config = JSON.parse(JSON.stringify(config.value))
      configList.value[activeConfigIndex.value].name = config.value.other.configName || configList.value[activeConfigIndex.value].name
    }
    storageSet('hushreader_config_list', JSON.stringify(configList.value))
    storageSet('hushreader_active_config', String(activeConfigIndex.value))
  }

  function resetToDefault() {
    config.value = structuredClone(DEFAULT_CONFIG)
    save()
  }

  function switchConfig(index: number) {
    if (index < 0 || index >= configList.value.length) return
    if (configList.value[activeConfigIndex.value]) {
      configList.value[activeConfigIndex.value].config = JSON.parse(JSON.stringify(config.value))
    }
    activeConfigIndex.value = index
    const target = configList.value[index]
    config.value = deepMerge(structuredClone(DEFAULT_CONFIG), target.config)
    save()
  }

  function addConfig(name: string) {
    const newConfig = structuredClone(DEFAULT_CONFIG)
    newConfig.other.configName = name
    configList.value.push({ name, config: newConfig })
    const newIndex = configList.value.length - 1
    switchConfig(newIndex)
  }

  function removeConfig(index: number) {
    if (configList.value.length <= 1) return
    configList.value.splice(index, 1)
    if (activeConfigIndex.value >= configList.value.length) {
      activeConfigIndex.value = configList.value.length - 1
    } else if (activeConfigIndex.value === index) {
      activeConfigIndex.value = Math.min(index, configList.value.length - 1)
    } else if (activeConfigIndex.value > index) {
      activeConfigIndex.value--
    }
    const target = configList.value[activeConfigIndex.value]
    config.value = deepMerge(structuredClone(DEFAULT_CONFIG), target.config)
    save()
  }

  function renameConfig(index: number, name: string) {
    if (configList.value[index]) {
      configList.value[index].name = name
      if (index === activeConfigIndex.value) {
        config.value.other.configName = name
      }
      save()
    }
  }

  return {
    config, configList, activeConfigIndex,
    load, save, resetToDefault,
    switchConfig, addConfig, removeConfig, renameConfig, DEFAULT_CONFIG
  }
})

function deepMerge(target: any, source: any): any {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor') continue
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {}
      deepMerge(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}
