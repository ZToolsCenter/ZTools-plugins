import { computed, ref, watch } from 'vue'
import Fuse from 'fuse.js'
import type { HistoryEntry, PromptItem } from '../types'
import { generateId } from '../utils/index'
import { useAppSettings } from './app'
import {
  collectTags,
  selectLiveItems,
  selectRecentItems,
  selectSortedHistory,
  selectSpaceItems,
  type PromptSortBy,
  type PromptSpaceTab,
  type SortDirection,
} from './prompt-collections'
import { createPromptPersistence } from './prompt-persistence'

const rawItems = ref<PromptItem[]>([])
const historyItems = ref<HistoryEntry[]>([])
const isLoading = ref(false)
const persistError = ref('')

const spaceTab = ref<PromptSpaceTab>('recent')
const query = ref('')
const filterTag = ref('')
const filterProjectId = ref('')
const activePromptId = ref('')
const sortBy = ref<PromptSortBy>('createdAt')
const sortDir = ref<SortDirection>('desc')
const historySortDir = ref<SortDirection>('desc')

const phase = ref<'search' | 'fill'>('search')
const selectedPrompt = ref<PromptItem | null>(null)
const variableValues = ref<Record<string, string>>({})
const keyboardIndex = ref(0)

const persistence = createPromptPersistence({ rawItems, historyItems, isLoading, persistError })

export function usePromptStore() {
  const liveItems = computed(() => selectLiveItems(rawItems.value))
  const recentItems = computed(() => selectRecentItems(liveItems.value))
  const sortedHistoryItems = computed(() => selectSortedHistory(historyItems.value, historySortDir.value))
  const favoriteItems = computed(() => liveItems.value.filter(item => item.favorite))
  const assetItems = computed(() => liveItems.value.filter(item => !item.projectId))
  const trashItems = computed(() => rawItems.value.filter(item => item.deleted))

  const spaceItems = computed(() => selectSpaceItems({
    tab: spaceTab.value,
    tag: filterTag.value,
    projectId: filterProjectId.value,
    sortBy: sortBy.value,
    sortDir: sortDir.value,
    liveItems: liveItems.value,
    recentItems: recentItems.value,
    favoriteItems: favoriteItems.value,
    assetItems: assetItems.value,
    trashItems: trashItems.value,
  }))

  const allTags = computed(() => collectTags(liveItems.value))
  const fuseIndex = ref<Fuse<PromptItem> | null>(null)

  watch(spaceItems, () => { fuseIndex.value = null })

  const filteredCallItems = computed(() => {
    const currentQuery = query.value.trim()
    if (!currentQuery) return spaceItems.value
    if (!fuseIndex.value) {
      fuseIndex.value = new Fuse(spaceItems.value, {
        keys: [
          { name: 'title', weight: 0.5 },
          { name: 'content', weight: 0.3 },
          { name: 'tags', weight: 0.2 },
        ],
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true,
        minMatchCharLength: 1,
      })
    }
    return fuseIndex.value.search(currentQuery).map(result => result.item)
  })

  const activeItem = computed(() => {
    if (!filteredCallItems.value.length) return null
    return filteredCallItems.value[keyboardIndex.value] || filteredCallItems.value[0]
  })

  function moveSelection(direction: 'up' | 'down') {
    if (!filteredCallItems.value.length) return
    if (direction === 'down' && keyboardIndex.value < filteredCallItems.value.length - 1) keyboardIndex.value++
    if (direction === 'up' && keyboardIndex.value > 0) keyboardIndex.value--
  }

  function selectActive() {
    const item = activeItem.value
    if (!item) return
    selectedPrompt.value = item
    phase.value = 'fill'
    variableValues.value = {}
    for (const variable of item.variables || []) {
      variableValues.value[variable.name] = variable.defaultValue || ''
    }
  }

  function resetSelection() {
    query.value = ''
    phase.value = 'search'
    keyboardIndex.value = 0
    selectedPrompt.value = null
    variableValues.value = {}
  }

  async function addHistory(entry: Omit<HistoryEntry, 'id' | 'usedAt'>) {
    const record: HistoryEntry = { id: generateId(), ...entry, usedAt: Date.now() }
    await persistence.commitHistoryMutation(() => {
      historyItems.value.unshift(record)
      const maxHistory = useAppSettings().settings.value.maxHistory || 200
      if (historyItems.value.length > maxHistory) historyItems.value = historyItems.value.slice(0, maxHistory)
    })
  }

  async function clearHistory() {
    await persistence.commitHistoryMutation(() => { historyItems.value = [] })
  }

  async function deleteHistoryEntry(id: string) {
    await persistence.commitHistoryMutation(() => {
      historyItems.value = historyItems.value.filter(item => item.id !== id)
    })
  }

  async function recordUsage(id: string) {
    await persistence.commitPromptMutation(() => {
      const item = rawItems.value.find(candidate => candidate.id === id)
      if (!item) return
      item.usageCount = (item.usageCount || 0) + 1
      item.lastUsedAt = Date.now()
    })
  }

  function toggleFavorite(id: string) {
    const item = rawItems.value.find(candidate => candidate.id === id)
    if (!item) return
    item.favorite = !item.favorite
    persistence.schedulePromptPersist()
  }

  async function softDelete(id: string) {
    await persistence.commitPromptMutation(() => {
      const item = rawItems.value.find(candidate => candidate.id === id)
      if (item) { item.deleted = true; item.updatedAt = Date.now() }
    })
  }

  async function restore(id: string) {
    await persistence.commitPromptMutation(() => {
      const item = rawItems.value.find(candidate => candidate.id === id)
      if (item) { item.deleted = false; item.updatedAt = Date.now() }
    })
  }

  async function hardDelete(id: string) {
    await persistence.commitPromptMutation(() => {
      rawItems.value = rawItems.value.filter(item => item.id !== id)
    })
  }

  async function addItem(item: PromptItem) {
    await persistence.commitPromptMutation(() => { rawItems.value.push(item) })
  }

  async function updateItem(id: string, patch: Partial<PromptItem>) {
    await persistence.commitPromptMutation(() => {
      const index = rawItems.value.findIndex(item => item.id === id)
      if (index !== -1) rawItems.value[index] = { ...rawItems.value[index], ...patch, updatedAt: Date.now() }
    })
  }

  return {
    rawItems, historyItems, isLoading, persistError,
    spaceTab, query, filterTag, filterProjectId, activePromptId,
    sortBy, sortDir, historySortDir,
    phase, selectedPrompt, variableValues, keyboardIndex,
    liveItems, recentItems, favoriteItems, assetItems, trashItems,
    sortedHistoryItems, spaceItems, allTags, filteredCallItems, activeItem,
    moveSelection, selectActive, resetSelection,
    init: persistence.ensureReady,
    ensureReady: persistence.ensureReady,
    persistAll: persistence.persistAll,
    flushPendingPersist: persistence.flushPendingPersist,
    recordUsage, addHistory, clearHistory, deleteHistoryEntry,
    toggleFavorite, softDelete, restore, hardDelete, addItem, updateItem,
  }
}
