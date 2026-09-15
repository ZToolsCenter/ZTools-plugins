import { ref } from 'vue'
import type { TerminalInfo, TerminalType } from './types'

// ---------- 数据结构（与 IMPLEMENTATION_PLAN.md 4.4 基本一致） ----------

export interface FolderItem {
  id: string
  path: string
  terminal?: TerminalType // 用户为该条目固定的终端（不设 = 跟随默认终端设置）
  addedAt: number
}

export interface Settings {
  defaultTerminal: 'auto' | TerminalType
  gitBashPath?: string
}

const FOLDERS_KEY = 'qt-folders'
const SETTINGS_KEY = 'qt-settings'

interface StorageData {
  folders: FolderItem[]
  settings: Settings
}

// ---------- 共享状态 ----------

function normalizeData(folders: FolderItem[], s: Partial<Settings>): StorageData {
  return {
    folders: folders.map((f) => ({ ...f })),
    settings: { defaultTerminal: s.defaultTerminal || 'auto', gitBashPath: s.gitBashPath }
  }
}

function loadAll(): StorageData {
  // 主：dbStorage（官方存储接口，键值必须为可结构化克隆的纯对象）
  try {
    const f = window.ztools.dbStorage.getItem<FolderItem[]>(FOLDERS_KEY) || []
    const s = window.ztools.dbStorage.getItem<Partial<Settings>>(SETTINGS_KEY) || {}
    if (f.length || s.defaultTerminal) {
      return normalizeData(f, s)
    }
  } catch {
    // dbStorage 读取失败，尝试从本地文件迁移
  }
  // 迁移：本地文件方案期间的数据（quickterm-storage.json）→ 写回 dbStorage
  try {
    const file = window.services.loadStorage()
    if (file && Array.isArray(file.folders) && file.folders.length) {
      const data = normalizeData(file.folders as FolderItem[], (file.settings || {}) as Partial<Settings>)
      persistData(data)
      return data
    }
  } catch {
    // 无文件数据，使用默认值
  }
  return { folders: [], settings: { defaultTerminal: 'auto' } }
}

const initial = loadAll()

export const folders = ref<FolderItem[]>(initial.folders)
export const settings = ref<Settings>(initial.settings)
export const terminals = ref<TerminalInfo[]>([])

// ---------- 操作 ----------

// dbStorage 底层走 Electron IPC（结构化克隆），Vue 的响应式 Proxy 无法通过，
// 必须先转成纯对象，否则报 "An object could not be cloned"
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function persistData(data: StorageData) {
  window.ztools.dbStorage.setItem(FOLDERS_KEY, toPlain(data.folders))
  window.ztools.dbStorage.setItem(SETTINGS_KEY, toPlain(data.settings))
}

export function saveFolders() {
  try {
    persistData({ folders: folders.value, settings: settings.value })
  } catch (e) {
    console.warn('[QuickTerm] 保存数据失败:', e)
  }
}

export function saveSettings() {
  saveFolders()
}

export function addFolder(p: string): boolean {
  const target = p.trim()
  if (!target) return false
  if (folders.value.some((f) => f.path.toLowerCase() === target.toLowerCase())) return false
  folders.value.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    path: target,
    addedAt: Date.now()
  })
  saveFolders()
  return true
}

export function removeFolder(id: string) {
  folders.value = folders.value.filter((f) => f.id !== id)
  saveFolders()
}

export function clearFolders() {
  folders.value = []
  saveFolders()
}

export function refreshTerminals() {
  terminals.value = window.services.detectTerminals()
}

// 默认终端下拉用的展示名（'terminal' / 'iterm' 仅 macOS，Windows 上探测不到不会展示）
export const TERMINAL_LABELS: Record<string, string> = {
  wt: 'Windows Terminal',
  pwsh: 'PowerShell 7',
  powershell: 'Windows PowerShell',
  cmd: 'CMD',
  gitbash: 'Git Bash',
  terminal: 'Terminal (系统终端)',
  iterm: 'iTerm2'
}

// 取路径最后一段作为展示名（兼容 \ 和 /）
export function displayName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
}
