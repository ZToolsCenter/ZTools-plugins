import type { Settings, TriggerKey } from './types'

/** 存储键前缀 */
export const DB_PREFIX = 'serious_reading/'

/** 触发动作的可选项（用于设置面板勾选） */
export const TRIGGER_OPTIONS: { key: TriggerKey; label: string }[] = [
  { key: 'dblclick', label: '双击' },
  { key: 'middleClick', label: '中键' },
  { key: 'rightClick', label: '右键' },
  { key: 'escape', label: 'Esc' },
  { key: 'mouseleave', label: '鼠标离开边缘' },
  { key: 'mouseenter', label: '鼠标进入边缘' },
]

/** 三功能之间的冲突判定：同一触发键不能被多个功能同时启用 */
export function detectConflicts(hide: Settings['hide']): Record<TriggerKey, string | null> {
  const assigned: Record<string, string> = {}
  for (const k of hide.stealthHide) assigned[k] = assigned[k] ? assigned[k] + '/隐身' : '隐身'
  for (const k of hide.stealthShow) assigned[k] = assigned[k] ? assigned[k] + '/显示' : '显示'
  for (const k of hide.realHide) assigned[k] = assigned[k] ? assigned[k] + '/真隐藏' : '真隐藏'
  const out = {} as Record<TriggerKey, string | null>
  for (const k of Object.keys(assigned) as TriggerKey[]) {
    out[k] = assigned[k].includes('/') ? assigned[k] : null
  }
  return out
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  window: { width: 520, height: 780, x: -1, y: -1 },
  reader: {
    bgColor: '#f5f5f5',
    textColor: '#1a1a1a',
    opacity: 1,
    fontSize: 17,
    lineHeight: 1.85,
    fontFamily: 'default',
    fontWeight: 400,
    cleanEmptyLines: false,
  },
  page: { arrow: true, wheel: true, click: true, pgupdn: true, space: false, transition: 'none' },
  hide: {
    stealthHide: ['escape', 'mouseleave'],
    stealthShow: ['middleClick'],
    realHide: ['rightClick'],
  },
  autoPage: { interval: 0, pauseOnStealth: true },
  showProgressBar: true,
}

export const SUPPORTED_EXTS = ['txt', 'epub', 'pdf']

export const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: "'Microsoft YaHei', '微软雅黑', sans-serif", label: '微软雅黑' },
  { value: "'SimSun', '宋体', serif", label: '宋体' },
  { value: "'SimHei', '黑体', sans-serif", label: '黑体' },
  { value: "'KaiTi', '楷体', serif", label: '楷体' },
  { value: "'FangSong', '仿宋', serif", label: '仿宋' },
  { value: "'PingFang SC', '苹方', sans-serif", label: '苹方' },
  { value: "'Source Han Sans SC', '思源黑体', sans-serif", label: '思源黑体' },
  { value: "'Source Han Serif SC', '思源宋体', serif", label: '思源宋体' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  { value: "'JetBrains Mono', 'Cascadia Code', monospace", label: 'JetBrains Mono' },
  { value: "Consolas, 'Cascadia Code', monospace", label: 'Consolas' },
  { value: "'SF Mono', 'JetBrains Mono', monospace", label: 'SF Mono' },
  { value: "'Cascadia Code', Consolas, monospace", label: 'Cascadia Code' },
  { value: "Menlo, 'SF Mono', monospace", label: 'Menlo' },
]