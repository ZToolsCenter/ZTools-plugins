import type { TodoItem, TodoSettings, TodoState } from './types'

const STORAGE_KEY = 'todo-plugin-state-v1'
const MAX_ITEMS = 500
const MAX_TEXT_LENGTH = 1000

/**
 * 生成默认状态，用于首次加载和数据损坏时的兜底。
 * @returns 规范化的默认状态。
 */
export function createDefaultState(): TodoState {
  return {
    version: 1,
    items: [],
    settings: {
      renderMarkdown: false,
      showCreatedAt: false,
    },
  }
}

/**
 * 读取布尔值，缺失或类型不符时回退到默认值。
 * @param raw 原始值。
 * @param fallback 默认值。
 * @returns 规范化后的布尔值。
 */
function toBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

/**
 * 规范化设置对象，过滤未知字段。
 * @param raw 原始设置。
 * @returns 可用的设置对象。
 */
function sanitizeSettings(raw: unknown): TodoSettings {
  const defaults = createDefaultState().settings
  if (!raw || typeof raw !== 'object') return defaults
  const source = raw as Record<string, unknown>
  return {
    renderMarkdown: toBoolean(source.renderMarkdown, defaults.renderMarkdown),
    showCreatedAt: toBoolean(source.showCreatedAt, defaults.showCreatedAt),
  }
}

/**
 * 规范化单条任务，非法记录直接丢弃。
 * @param raw 原始记录。
 * @returns 合法任务或 null。
 */
function sanitizeItem(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const text = typeof source.text === 'string' ? source.text.trim() : ''
  if (!id || !text || text.length > MAX_TEXT_LENGTH) return null
  const createdAt =
    typeof source.createdAt === 'number' && Number.isFinite(source.createdAt)
      ? source.createdAt
      : Date.now()
  return { id, text, done: source.done === true, createdAt }
}

/**
 * 将任意输入规范化为完整状态，覆盖损坏数据与版本升级场景。
 * @param raw 原始状态。
 * @returns 规范化后的状态。
 */
export function sanitizeState(raw: unknown): TodoState {
  if (!raw || typeof raw !== 'object') return createDefaultState()
  const source = raw as Record<string, unknown>
  const list = Array.isArray(source.items) ? source.items : []
  const items: TodoItem[] = []
  for (const entry of list) {
    const item = sanitizeItem(entry)
    if (!item) continue
    if (items.some((existing) => existing.id === item.id)) continue
    items.push(item)
    if (items.length >= MAX_ITEMS) break
  }
  return {
    version: 1,
    items,
    settings: sanitizeSettings(source.settings),
  }
}

/**
 * 读取原始存储值，优先使用宿主 dbStorage，开发预览时回退 localStorage。
 * @returns 原始值，无数据时返回 null。
 */
function readRaw(): unknown {
  if (typeof window.ztools !== 'undefined' && window.ztools && window.ztools.dbStorage) {
    try {
      const value = window.ztools.dbStorage.getItem(STORAGE_KEY)
      if (value !== undefined && value !== null) return value
    } catch (error) {
      console.warn('[todo] 读取宿主存储失败，尝试本地回退', error)
    }
  }
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === null ? null : JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * 读取并规范化待办状态。
 * @returns 当前状态；无数据或数据损坏时返回默认状态。
 */
export function loadState(): TodoState {
  try {
    const raw = readRaw()
    if (raw === null || raw === undefined) return createDefaultState()
    const normalized = typeof raw === 'string' ? JSON.parse(raw) : raw
    return sanitizeState(normalized)
  } catch (error) {
    console.warn('[todo] 待办数据解析失败，已回退默认状态', error)
    return createDefaultState()
  }
}

/**
 * 持久化待办状态，写入失败时记录警告但不中断交互。
 * @param state 待保存的状态。
 * @returns 无返回值。
 */
export function saveState(state: TodoState): void {
  const payload = sanitizeState(state)
  if (typeof window.ztools !== 'undefined' && window.ztools && window.ztools.dbStorage) {
    try {
      window.ztools.dbStorage.setItem(STORAGE_KEY, payload)
      return
    } catch (error) {
      console.warn('[todo] 写入宿主存储失败，尝试本地回退', error)
    }
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch (error) {
    console.warn('[todo] 写入本地存储失败', error)
  }
}
