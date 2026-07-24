import { ref, computed } from 'vue'
import Fuse from 'fuse.js'
import type { PromptItem, HistoryEntry } from '../types'
import { loadPrompts, savePrompts, loadHistory, saveHistory } from '../utils/storage'
import { useAppSettings } from './app'
import { generateId } from '../utils/index'

const rawItems = ref<PromptItem[]>([])
const historyItems = ref<HistoryEntry[]>([])
const isLoading = ref(false)
let _initPromise: Promise<void> | null = null

// 筛选 & 排序状态（模块级，确保所有组件共享同一份）
const spaceTab = ref<'all' | 'recent' | 'favorite' | 'project' | 'asset' | 'history' | 'trash'>('recent')
const query = ref('')
const filterTag = ref('')
const filterProjectId = ref('')
const activePromptId = ref('')
const sortBy = ref<'createdAt' | 'updatedAt' | 'title' | 'usageCount'>('createdAt')
const sortDir = ref<'desc' | 'asc'>('desc')
const historySortDir = ref<'desc' | 'asc'>('desc')

// 调用阶段
const phase = ref<'search' | 'fill'>('search')
const selectedPrompt = ref<PromptItem | null>(null)
const variableValues = ref<Record<string, string>>({})
const keyboardIndex = ref(0)

export function usePromptStore() {
  /** 不含已删除项 */
  const liveItems = computed(() => rawItems.value.filter(i => !i.deleted))

  /** 最近使用（按 lastUsedAt 降序） */
  const recentItems = computed(() =>
    [...liveItems.value]
      .filter(i => i.lastUsedAt)
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
      .slice(0, 20)
  )

  /** 历史记录列表（按时间排序） */
  const sortedHistoryItems = computed(() => {
    const items = [...historyItems.value]
    items.sort((a, b) => {
      const dir = historySortDir.value === 'desc' ? -1 : 1
      return dir * (a.usedAt - b.usedAt)
    })
    return items
  })

  /** 收藏 */
  const favoriteItems = computed(() => liveItems.value.filter(i => i.favorite))

  /** 资产（prompt + snippet + template + constraint，不在项目中） */
  const assetItems = computed(() => liveItems.value.filter(i => !i.projectId))

  /** 回收站 */
  const trashItems = computed(() => rawItems.value.filter(i => i.deleted))

  /** 当前空间页显示的列表 */
  const spaceItems = computed(() => {
    const currentTab = spaceTab.value
    const currentFilterTag = filterTag.value
    const currentFilterProjectId = filterProjectId.value
    const currentSortBy = sortBy.value
    const currentSortDir = sortDir.value

    let items: PromptItem[]
    switch (currentTab) {
      case 'all': items = liveItems.value; break
      case 'recent': items = recentItems.value; break
      case 'favorite': items = favoriteItems.value; break
      case 'project': items = currentFilterProjectId
        ? liveItems.value.filter(i => i.projectId === currentFilterProjectId)
        : liveItems.value.filter(i => i.projectId)
        break
      case 'asset': items = assetItems.value; break
      case 'trash': items = trashItems.value; break
      default: items = liveItems.value
    }
    // 标签筛选
    if (currentFilterTag) items = items.filter(i => i.tags.includes(currentFilterTag))
    // 排序
    items = [...items].sort((a, b) => {
      const dir = currentSortDir === 'desc' ? -1 : 1
      if (currentSortBy === 'title') return dir * (a.title || '').localeCompare(b.title || '')
      if (currentSortBy === 'usageCount') return dir * ((a.usageCount || 0) - (b.usageCount || 0))
      return dir * ((a[currentSortBy] as number || 0) - (b[currentSortBy] as number || 0))
    })
    return items
  })

  /** 所有标签 */
  const allTags = computed(() => {
    const set = new Set<string>()
    for (const i of liveItems.value) for (const t of i.tags) set.add(t)
    return [...set].sort()
  })

  // ====== Fuse.js 模糊搜索 ======
  const fuseInstance = computed(() => new Fuse(spaceItems.value, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'content', weight: 0.3 },
      { name: 'tags', weight: 0.2 },
    ],
    threshold: 0.4,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 1,
  }))

  const filteredCallItems = computed(() => {
    const q = query.value.trim()
    if (!q) return spaceItems.value
    return fuseInstance.value.search(q).map(r => r.item)
  })

  const activeItem = computed(() => {
    if (filteredCallItems.value.length === 0) return null
    return filteredCallItems.value[keyboardIndex.value] || filteredCallItems.value[0]
  })

  // ====== 操作 ======

  function moveSelection(dir: 'up' | 'down') {
    const items = filteredCallItems.value
    if (!items.length) return
    if (dir === 'down') { if (keyboardIndex.value < items.length - 1) keyboardIndex.value++ }
    else { if (keyboardIndex.value > 0) keyboardIndex.value-- }
  }

  function selectActive() {
    const item = activeItem.value
    if (!item) return
    selectedPrompt.value = item
    phase.value = 'fill'
    variableValues.value = {}
    if (item.variables) for (const v of item.variables) variableValues.value[v.name] = v.defaultValue || ''
  }

  function resetSelection() {
    query.value = ''
    phase.value = 'search'
    keyboardIndex.value = 0
    selectedPrompt.value = null
    variableValues.value = {}
  }

  async function init() {
    if (_initPromise) return _initPromise
    _initPromise = (async () => {
      isLoading.value = true
      rawItems.value = await loadPrompts()
      historyItems.value = await loadHistory()
      isLoading.value = false
    })()
    return _initPromise
  }

  async function ensureReady() { await init() }

  async function persistAll() { await savePrompts(rawItems.value) }

  async function addHistory(entry: Omit<HistoryEntry, 'id' | 'usedAt'>) {
    const record: HistoryEntry = {
      id: generateId(),
      ...entry,
      usedAt: Date.now(),
    }
    historyItems.value.unshift(record)
    const max = useAppSettings().settings.value.maxHistory || 200
    if (historyItems.value.length > max) {
      historyItems.value = historyItems.value.slice(0, max)
    }
    await saveHistory(historyItems.value)
  }

  async function clearHistory() {
    historyItems.value = []
    await saveHistory(historyItems.value)
  }

  async function deleteHistoryEntry(id: string) {
    historyItems.value = historyItems.value.filter(h => h.id !== id)
    await saveHistory(historyItems.value)
  }

  async function recordUsage(id: string) {
    const item = rawItems.value.find(i => i.id === id)
    if (item) {
      item.usageCount = (item.usageCount || 0) + 1
      item.lastUsedAt = Date.now()
      await persistAll()
    }
  }

  function toggleFavorite(id: string) {
    const item = rawItems.value.find(i => i.id === id)
    if (item) { item.favorite = !item.favorite; persistAll() }
  }

  function softDelete(id: string) {
    const item = rawItems.value.find(i => i.id === id)
    if (item) { item.deleted = true; item.updatedAt = Date.now(); persistAll() }
  }

  function restore(id: string) {
    const item = rawItems.value.find(i => i.id === id)
    if (item) { item.deleted = false; item.updatedAt = Date.now(); persistAll() }
  }

  function hardDelete(id: string) {
    rawItems.value = rawItems.value.filter(i => i.id !== id)
    persistAll()
  }

  function addItem(item: PromptItem) {
    rawItems.value.push(item)
    persistAll()
  }

  function updateItem(id: string, patch: Partial<PromptItem>) {
    const idx = rawItems.value.findIndex(i => i.id === id)
    if (idx !== -1) {
      rawItems.value[idx] = { ...rawItems.value[idx], ...patch, updatedAt: Date.now() }
      persistAll()
    }
  }

  return {
    rawItems, historyItems, isLoading,
    spaceTab, query, filterTag, filterProjectId, activePromptId,
    sortBy, sortDir, historySortDir,
    phase, selectedPrompt, variableValues, keyboardIndex,
    liveItems, recentItems, favoriteItems, assetItems, trashItems,
    sortedHistoryItems,
    spaceItems, allTags, filteredCallItems, activeItem,
    moveSelection, selectActive, resetSelection,
    init, ensureReady, persistAll, recordUsage,
    addHistory, clearHistory, deleteHistoryEntry,
    toggleFavorite, softDelete, restore, hardDelete,
    addItem, updateItem,
  }
}
