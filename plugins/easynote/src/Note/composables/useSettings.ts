import { ref, watch } from 'vue'

export type EditMode = 'wysiwyg' | 'split'

export interface Settings {
  /** 编辑模式：所见即所得 / 双栏 */
  mode: EditMode
  /** 字号（px） */
  fontSize: number
}

const KEY = 'easynote:settings'
const DEFAULT: Settings = { mode: 'wysiwyg', fontSize: 15 }

function load(): Settings {
  try {
    const raw = window.ztools.dbStorage.getItem(KEY)
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT }
}

// 模块级单例：同一渲染进程内共享（主窗口、便利贴窗口各自一份，但都读同一 dbStorage）
const settings = ref<Settings>(load())

let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(
  settings,
  (v) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      try {
        window.ztools.dbStorage.setItem(KEY, JSON.stringify(v))
      } catch {
        /* ignore */
      }
    }, 300)
  },
  { deep: true }
)

export function useSettings() {
  function setMode(m: EditMode) {
    settings.value.mode = m
  }

  function setFontSize(v: number) {
    settings.value.fontSize = Math.min(28, Math.max(12, Math.round(v)))
  }

  /** 滚轮调字号：delta>0 缩小，delta<0 放大 */
  function adjustFontSize(delta: number) {
    setFontSize(settings.value.fontSize + (delta > 0 ? -1 : 1))
  }

  return { settings, setMode, setFontSize, adjustFontSize }
}
