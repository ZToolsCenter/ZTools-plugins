import type {
  Settings,
  ReadingProgress,
  RecentBook,
  ShelfBook,
  Preset,
} from './types'
import { DB_PREFIX, DEFAULT_SETTINGS } from './constants'

/** 安全获取 ztools 全局（开发期可能未注入） */
function zt() {
  return typeof window !== 'undefined' ? window.ztools : undefined
}

const SET_KEY = DB_PREFIX + 'settings'
const HIST_KEY = DB_PREFIX + 'history'
const WINPOS_KEY = DB_PREFIX + 'winpos'
const BOOKS_DOC_ID = DB_PREFIX + 'books'

/* ---------------- KV（dbStorage） ---------------- */

export function getSettings(): Settings {
  const z = zt()
  const raw = z ? z.dbStorage.getItem(SET_KEY) : null
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  // 合并默认值，避免新增字段缺失
  return { ...DEFAULT_SETTINGS, ...raw, reader: { ...DEFAULT_SETTINGS.reader, ...raw.reader } }
}

export function saveSettings(s: Settings) {
  zt()?.dbStorage.setItem(SET_KEY, s)
}

/* ---------------- 预设（多套配置） ---------------- */

const PRESETS_KEY = DB_PREFIX + 'presets'

export function getPresets(): Preset[] {
  return zt()?.dbStorage.getItem(PRESETS_KEY) ?? []
}

export function addPreset(name: string, settings: Settings): Preset {
  const list = getPresets()
  const preset: Preset = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, settings: JSON.parse(JSON.stringify(settings)) }
  list.push(preset)
  zt()?.dbStorage.setItem(PRESETS_KEY, list)
  return preset
}

export function updatePreset(id: string, settings: Settings) {
  const list = getPresets().map((p) => p.id === id ? { ...p, settings: JSON.parse(JSON.stringify(settings)) } : p)
  zt()?.dbStorage.setItem(PRESETS_KEY, list)
}

export function deletePreset(id: string) {
  zt()?.dbStorage.setItem(PRESETS_KEY, getPresets().filter((p) => p.id !== id))
}

export function autoPresetName(): string {
  const list = getPresets()
  let n = 1
  while (list.some((p) => p.name === `配置${n}`)) n++
  return `配置${n}`
}

export function getWindowPos(): { x: number; y: number; width: number; height: number } | null {
  return zt()?.dbStorage.getItem(WINPOS_KEY) ?? null
}

export function saveWindowPos(b: { x: number; y: number; width: number; height: number }) {
  zt()?.dbStorage.setItem(WINPOS_KEY, b)
}

export function getProgress(filePath: string): ReadingProgress | null {
  return zt()?.dbStorage.getItem(DB_PREFIX + 'progress/' + filePath) ?? null
}

export function saveProgress(p: ReadingProgress) {
  zt()?.dbStorage.setItem(DB_PREFIX + 'progress/' + p.filePath, p)
}

export function getHistory(): RecentBook[] {
  return zt()?.dbStorage.getItem(HIST_KEY) ?? []
}

export function addRecentBook(b: RecentBook) {
  const list = getHistory()
  const i = list.findIndex((x) => x.filePath === b.filePath)
  if (i >= 0) list.splice(i, 1)
  list.unshift(b)
  zt()?.dbStorage.setItem(HIST_KEY, list.slice(0, 20))
}

/* ---------------- 文档（db） ---------------- */

/** 书架列表：单文档，data 为 ShelfBook 数组 */
export function getShelf(): ShelfBook[] {
  const z = zt()
  if (!z) return []
  const doc = z.db.get(BOOKS_DOC_ID)
  return (doc?.data as ShelfBook[]) ?? []
}

export function saveShelf(list: ShelfBook[]) {
  const z = zt()
  if (!z) return
  const existing = z.db.get(BOOKS_DOC_ID)
  const doc = existing ?? { _id: BOOKS_DOC_ID }
  doc.data = list
  z.db.put(doc)
}

export function addBookToShelf(book: ShelfBook): boolean {
  const list = getShelf()
  if (list.some((b) => b.path === book.path)) return false
  list.push(book)
  saveShelf(list)
  return true
}

export function removeBookFromShelf(id: string) {
  const list = getShelf().filter((b) => b.id !== id)
  saveShelf(list)
}

export function updateBookInShelf(id: string, patch: Partial<ShelfBook>) {
  const list = getShelf().map((b) => (b.id === id ? { ...b, ...patch } : b))
  saveShelf(list)
}

/** 封面附件 id（按 nativeId 隔离） */
export function coverId(bookId: string): string {
  const z = zt()
  const native = z ? z.getNativeId() : 'dev'
  return `${native}/${bookId}/cover`
}

export function saveCover(bookId: string, buf: ArrayBuffer | Buffer | Uint8Array, mime = 'image/png') {
  // 运行期 Buffer 经结构化克隆到渲染进程后通常为 Uint8Array，postAttachment 兼容
  zt()?.db.postAttachment(coverId(bookId), buf as any, mime)
}

export function getCover(bookId: string): Buffer | null {
  return zt()?.db.getAttachment(coverId(bookId)) ?? null
}

export function removeCover(bookId: string) {
  try {
    zt()?.db.remove(coverId(bookId))
  } catch {
    /* 封面可能未存，忽略 */
  }
}

/** Buffer 转 data URL（用于 <img> 显示） */
export function bufferToDataUrl(buf: Buffer | ArrayBuffer, mime = 'image/png'): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any)
  }
  return `data:${mime};base64,${btoa(bin)}`
}