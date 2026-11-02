import type { Ref } from 'vue'
import type { HistoryEntry, PromptItem } from '../types'
import { loadHistory, loadPrompts, saveHistory, savePrompts } from '../utils/storage'

const DEBOUNCE_MS = 300

interface PromptPersistenceState {
  rawItems: Ref<PromptItem[]>
  historyItems: Ref<HistoryEntry[]>
  isLoading: Ref<boolean>
  persistError: Ref<string>
}

function cloneItems<T>(items: T[]): T[] {
  return JSON.parse(JSON.stringify(items)) as T[]
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '本地存储写入失败'
}

export function createPromptPersistence(state: PromptPersistenceState) {
  let initPromise: Promise<void> | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  async function saveCurrentPrompts() {
    try {
      await savePrompts(state.rawItems.value)
      state.persistError.value = ''
    } catch (error) {
      state.persistError.value = toErrorMessage(error)
      throw error
    }
  }

  function schedulePromptPersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void saveCurrentPrompts().catch(() => {})
    }, DEBOUNCE_MS)
  }

  async function persistAll() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    await saveCurrentPrompts()
  }

  async function flushPendingPersist() {
    if (!persistTimer) return
    clearTimeout(persistTimer)
    persistTimer = null
    await saveCurrentPrompts()
  }

  async function commitPromptMutation(mutate: () => void) {
    await flushPendingPersist()
    const previous = cloneItems(state.rawItems.value)
    mutate()
    try {
      await saveCurrentPrompts()
    } catch (error) {
      state.rawItems.value = previous
      throw error
    }
  }

  async function commitHistoryMutation(mutate: () => void) {
    const previous = cloneItems(state.historyItems.value)
    mutate()
    try {
      await saveHistory(state.historyItems.value)
    } catch (error) {
      state.historyItems.value = previous
      throw error
    }
  }

  async function ensureReady() {
    if (!initPromise) {
      initPromise = (async () => {
        state.isLoading.value = true
        try {
          state.rawItems.value = await loadPrompts()
          state.historyItems.value = await loadHistory()
        } finally {
          state.isLoading.value = false
        }
      })()
    }

    try {
      await initPromise
    } catch (error) {
      initPromise = null
      throw error
    }
  }

  return {
    ensureReady,
    persistAll,
    flushPendingPersist,
    schedulePromptPersist,
    commitPromptMutation,
    commitHistoryMutation,
  }
}
