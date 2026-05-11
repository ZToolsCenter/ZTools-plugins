import { reactive, watch } from 'vue'

const STORAGE_KEY = 'zapapi_collections'

export interface CollectionRequest {
  id: string
  name: string
  method: string
  url: string
  params: Array<{ key: string; value: string; enabled: boolean }>
  headers: Array<{ key: string; value: string; enabled: boolean }>
  auth: {
    type: 'none' | 'bearer' | 'basic' | 'apikey' | 'jwt-bearer' | 'digest'
    token?: string
    username?: string
    password?: string
    apiKey?: string
    apiKeyLocation?: 'header' | 'query'
    apiKeyHeader?: string
    jwtSecret?: string
    jwtAlgorithm?: 'HS256' | 'HS384' | 'HS512'
    jwtHeaderPrefix?: string
    jwtHeader?: string
    jwtPayload?: string
    jwtAutoIat?: boolean
    jwtAutoExp?: boolean
    jwtExpSeconds?: string
    digestUsername?: string
    digestPassword?: string
    digestAlgorithm?: 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess'
  }
  body: {
    type: 'none' | 'json' | 'formdata' | 'urlencoded' | 'raw'
    kind?: 'none' | 'text' | 'structured' | 'binary' | 'other'
    contentType?: string
    raw?: string
    formData?: Array<{ key: string; value: string; enabled: boolean; isFile: boolean; fileToken?: string }>
    binary?: { fileToken?: string; fileName?: string; fileSize?: number; fileType?: string }
  }
  cookiePolicy?: {
    mode: 'inherit' | 'enable' | 'disable'
  }
  socket: {
    status: 'disconnected' | 'connecting' | 'connected'
    messages: Array<{ id: string; type: 'sent' | 'received' | 'system'; data: string; time: number }>
    messageType: 'Text' | 'JSON' | 'Binary'
  }}

export interface Collection {
  id: string
  name: string
  auth: {
    type: 'none' | 'bearer' | 'basic' | 'apikey' | 'jwt-bearer' | 'digest'
    token?: string
    username?: string
    password?: string
    apiKey?: string
    apiKeyLocation?: 'header' | 'query'
    apiKeyHeader?: string
    jwtSecret?: string
    jwtAlgorithm?: 'HS256' | 'HS384' | 'HS512'
    jwtHeaderPrefix?: string
    jwtHeader?: string
    jwtPayload?: string
    jwtAutoIat?: boolean
    jwtAutoExp?: boolean
    jwtExpSeconds?: string
    digestUsername?: string
    digestPassword?: string
    digestAlgorithm?: 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess'
  }
  requests: CollectionRequest[]
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2)
}

function loadFromStorage(): Collection[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function saveToStorage(collections: Collection[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collections))
}

const state = reactive({
  collections: loadFromStorage() as Collection[]
})

watch(
  () => state.collections,
  (val) => saveToStorage(val),
  { deep: true }
)

export function useCollectionsStore() {
  function createCollection(name: string): Collection {
    const collection: Collection = {
      id: generateId(),
      name,
      auth: { type: 'none' },
      requests: []
    }
    state.collections.push(collection)
    return collection
  }

  function updateCollection(id: string, data: Partial<Collection>) {
    const index = state.collections.findIndex((c) => c.id === id)
    if (index !== -1) {
      state.collections[index] = { ...state.collections[index], ...data }
    }
  }

  function deleteCollection(id: string) {
    state.collections = state.collections.filter((c) => c.id !== id)
  }

  function addRequest(collectionId: string, request: Omit<CollectionRequest, 'id'>): CollectionRequest {
    const collection = state.collections.find((c) => c.id === collectionId)
    if (collection) {
      const newRequest: CollectionRequest = { ...request, id: generateId() }
      collection.requests.push(newRequest)
      return newRequest
    }
    throw new Error('Collection not found')
  }

  function updateRequest(collectionId: string, requestId: string, data: Partial<CollectionRequest>) {
    const collection = state.collections.find((c) => c.id === collectionId)
    if (collection) {
      const request = collection.requests.find((r) => r.id === requestId)
      if (request) {
        Object.assign(request, data)
      }
    }
  }

  function deleteRequest(collectionId: string, requestId: string) {
    const collection = state.collections.find((c) => c.id === collectionId)
    if (collection) {
      collection.requests = collection.requests.filter((r) => r.id !== requestId)
    }
  }

  return {
    state,
    createCollection,
    updateCollection,
    deleteCollection,
    addRequest,
    updateRequest,
    deleteRequest
  }
}
