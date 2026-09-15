import type { NpmMeta, SearchResult } from './types'

export interface NpmCache {
  getSearch(key: string): SearchResult | null
  setSearch(key: string, entry: SearchResult): void
  getMeta(key: string): NpmMeta | null
  setMeta(key: string, meta: NpmMeta): void
}

export function createNpmCache(): NpmCache {
  const searchCache = new Map<string, SearchResult>()
  const metaCache = new Map<string, NpmMeta>()
  const trim = (k: string) => k.trim()
  return {
    getSearch(key) { return searchCache.get(trim(key)) ?? null },
    setSearch(key, entry) { searchCache.set(trim(key), entry) },
    getMeta(key) { return metaCache.get(trim(key)) ?? null },
    setMeta(key, meta) { metaCache.set(trim(key), meta) },
  }
}

export function useNpmCache(): NpmCache {
  return createNpmCache()
}
