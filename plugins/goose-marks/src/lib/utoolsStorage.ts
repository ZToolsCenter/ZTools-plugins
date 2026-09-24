import { emitStorageSync, getDbStorage, getDoc, isUToolsDbAvailable, putDocWithRetry, removeDoc } from '@/lib/utoolsDb'

interface StorageDoc {
  value: string
  updatedAt: number
}

const STORAGE_DOC_PREFIX = 'gm:storage:'
const LEGACY_FALLBACK_DOC_PREFIX = 'goose-marks:storage:'

const storageDocId = (key: string) => `${STORAGE_DOC_PREFIX}${key}`
const legacyFallbackDocId = (key: string) => `${LEGACY_FALLBACK_DOC_PREFIX}${key}`

const readLocalValue = (key: string): string | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const removeLocalValue = (key: string): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {}
}

const readLegacyValue = (key: string): string | null => {
  try {
    const raw = getDbStorage()?.getItem(key)
    if (typeof raw === 'string') return raw
  } catch {}

  const fallback = getDoc<string | StorageDoc>(legacyFallbackDocId(key))?.data
  if (typeof fallback === 'string') return fallback
  if (fallback && typeof fallback.value === 'string') return fallback.value

  return readLocalValue(key)
}

const cleanupLegacyValue = (key: string): void => {
  try {
    getDbStorage()?.removeItem(key)
  } catch {}
  removeDoc(legacyFallbackDocId(key))
  removeLocalValue(key)
}

export const utoolsStorage = {
  getItem(key: string): string | null {
    const current = getDoc<StorageDoc>(storageDocId(key))?.data
    if (current && typeof current.value === 'string') return current.value

    const legacy = readLegacyValue(key)
    if (legacy === null) return null

    if (isUToolsDbAvailable()) {
      const result = putDocWithRetry(storageDocId(key), { value: legacy, updatedAt: Date.now() } satisfies StorageDoc)
      if (result.ok !== false) cleanupLegacyValue(key)
    }

    return legacy
  },

  setItem(key: string, value: string): void {
    if (!isUToolsDbAvailable()) {
      console.warn(`[utoolsStorage] 跳过写入，uTools db 不可用: ${key}`)
      return
    }
    const result = putDocWithRetry(storageDocId(key), { value, updatedAt: Date.now() } satisfies StorageDoc)
    if (result.ok === false) {
      console.error(`[utoolsStorage] ${key} 写入失败`, result.error)
      return
    }
    cleanupLegacyValue(key)
    emitStorageSync(key, value)
  },

  removeItem(key: string): void {
    removeDoc(storageDocId(key))
    cleanupLegacyValue(key)
    emitStorageSync(key, null)
  },

  flushItem(_key: string): void {}
}

export const getPersistentItem = (key: string, legacyKeys: string[] = []): string | null => {
  const current = utoolsStorage.getItem(key)
  if (current !== null) return current

  for (const legacyKey of legacyKeys.filter((candidate) => candidate !== key)) {
    const legacyValue = readLegacyValue(legacyKey)
    if (legacyValue === null) continue
    if (isUToolsDbAvailable()) {
      utoolsStorage.setItem(key, legacyValue)
      cleanupLegacyValue(legacyKey)
    }
    return legacyValue
  }

  return null
}

export const removePersistentItem = (key: string, legacyKeys: string[] = []): void => {
  utoolsStorage.removeItem(key)
  legacyKeys.forEach(cleanupLegacyValue)
}
