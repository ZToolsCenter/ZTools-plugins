import { ref } from 'vue'

/**
 * 历史记录单例：跨组件共享同一份历史列表。
 *
 * - Recognize / Translate 完成识别/翻译后，由 Manage 调用 pushHistory 写入。
 * - HistoryView 读取 historyList 渲染左侧缩略列表与右侧详情面板。
 * - 持久化到 window.ztools.dbStorage（key: `history.list`），最多保留 100 条。
 *
 * 与 useNativeEngine 同构的「模块级单例」模式：切 tab 卸载组件时数据不丢，
 * 重新挂载仍读到同一份列表。
 */

/** dbStorage 中存储历史记录的 key。 */
const STORAGE_KEY = 'history.list'

/** 最多保留的历史记录条数。超出自动淘汰最旧的（数组末尾）。 */
const MAX_ITEMS = 100

// ─── 模块级单例（进程内唯一，跨组件共享）────────────────────────────────
const historyList = ref<HistoryItem[]>([])

/**
 * 是否已完成首次载入。
 *
 * 历史记录单例是模块级 ref，进程内始终存活，无需每次 Manage 重新挂载都重读
 * dbStorage。更关键的是：若在 pushHistory（写入内存 + 触发异步写盘）之后
 * Manage 被卸载重建触发 loadHistory，会用 dbStorage 里的旧快照覆盖内存中
 * 刚写入的新记录，导致历史丢失。故 loadHistory 只在模块首次加载时执行一次，
 * 后续重复调用直接跳过。
 */
let loaded = false

/** 从 dbStorage 载入历史记录到单例 ref。仅在模块首次加载时执行一次。 */
function loadHistory(): void {
  if (loaded) return
  loaded = true
  try {
    const stored = window.ztools.dbStorage.getItem<HistoryItem[]>(STORAGE_KEY)
    historyList.value = Array.isArray(stored) ? stored : []
  } catch (e) {
    // dbStorage 不可用等异常：保持空列表，不阻塞 UI；记录原因便于排查
    console.warn('[useHistory] loadHistory 读取 dbStorage 失败:', e)
    historyList.value = []
  }
}

/** 同步当前单例列表到 dbStorage。 */
function persist(): void {
  try {
    // historyList 是 ref，读出的 value 及嵌套元素是 Vue 响应式 Proxy；
    // dbStorage.setItem 底层走 Electron 同步 IPC 的结构化克隆，无法克隆 Proxy，
    // 会抛 "An object could not be cloned" 导致历史记录丢失。
    // 这里经 JSON 序列化一次，剥离 Proxy 得到纯数据再写入。
    const plain = JSON.parse(JSON.stringify(historyList.value))
    window.ztools.dbStorage.setItem(STORAGE_KEY, plain)
  } catch (e) {
    // 写入失败不阻塞 UI，但输出告警：便于排查（如 OCR data URI 过大触发写盘失败）
    console.warn('[useHistory] persist 写入 dbStorage 失败:', e)
  }
}

/**
 * 新增一条历史记录：unshift 到头部，超 MAX_ITEMS 条尾裁剪，并同步到 dbStorage。
 * @param item 不含 id / ts 的条目，由本函数补全。
 */
function pushHistory(item: HistoryEmitItem): void {
  const full: HistoryItem = {
    ...item,
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10),
    ts: Date.now()
  }
  historyList.value.unshift(full)
  if (historyList.value.length > MAX_ITEMS) {
    historyList.value.length = MAX_ITEMS
  }
  persist()
}

/** 删除指定 id 的历史记录。 */
function removeHistory(id: string): void {
  historyList.value = historyList.value.filter((it) => it.id !== id)
  persist()
}

/** 清空全部历史记录。 */
function clearHistory(): void {
  historyList.value = []
  persist()
}

export function useHistory() {
  return {
    historyList,
    loadHistory,
    pushHistory,
    removeHistory,
    clearHistory
  }
}
