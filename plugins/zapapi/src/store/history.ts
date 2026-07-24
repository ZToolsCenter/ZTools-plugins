import { reactive, watch } from 'vue'

const STORAGE_KEY = 'zapapi_history'
const MAX_HISTORY = 50

export interface HistoryItem {
  id: string
  timestamp: number
  method: string
  url: string
  params: Array<{ key: string; value: string; enabled: boolean }>
  headers: Array<{ key: string; value: string; enabled: boolean }>
  auth: {
    type: string
    token?: string
    username?: string
    password?: string
    apiKey?: string
    apiKeyLocation?: string
    apiKeyHeader?: string
  }
  body: {
    type: string
    kind?: 'none' | 'text' | 'structured' | 'binary' | 'other'
    contentType?: string
    raw?: string
    formData?: Array<{ key: string; value: string; enabled: boolean; isFile: boolean; fileToken?: string }>
    binary?: { fileToken?: string; fileName?: string; fileSize?: number; fileType?: string }
  }
  cookiePolicy?: {
    mode: 'inherit' | 'enable' | 'disable'
  }
  socket?: {
    status: 'disconnected' | 'connecting' | 'connected'
    messages: Array<{ id: string; type: 'sent' | 'received' | 'system'; data: string; time: number }>
    messageType: 'Text' | 'JSON' | 'Binary'
  }
  status?: number
  responseTime?: number
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2)
}

function loadFromStorage(): HistoryItem[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveToStorage(items: HistoryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

const state = reactive({
  items: loadFromStorage() as HistoryItem[]
})

watch(
  () => state.items,
  (val) => saveToStorage(val),
  { deep: true }
)

export function useHistoryStore() {
  function addItem(item: Omit<HistoryItem, 'id' | 'timestamp'>): HistoryItem {
    const newItem: HistoryItem = {
      ...item,
      id: generateId(),
      timestamp: Date.now()
    }
    state.items.unshift(newItem)
    if (state.items.length > MAX_HISTORY) {
      state.items = state.items.slice(0, MAX_HISTORY)
    }
    return newItem
  }

  function updateResult(id: string, status: number, responseTime: number) {
    const item = state.items.find((i) => i.id === id)
    if (item) {
      item.status = status
      item.responseTime = responseTime
    }
  }

  function clearHistory() {
    state.items = []
  }

  function deleteItem(id: string) {
    state.items = state.items.filter((i) => i.id !== id)
  }

  return {
    state,
    addItem,
    updateResult,
    clearHistory,
    deleteItem
  }
}
