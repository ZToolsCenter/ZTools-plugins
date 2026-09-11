import type { MavenArtifact, MavenVersion, CacheEntry } from './types'

export interface MavenCache {
  getSearch(key: string): CacheEntry<MavenArtifact> | null
  setSearch(key: string, entry: CacheEntry<MavenArtifact>): void
  getVersions(key: string): CacheEntry<MavenVersion> | null
  setVersions(key: string, entry: CacheEntry<MavenVersion>): void
}

export function createMavenCache(): MavenCache {
  const searchCache = new Map<string, CacheEntry<MavenArtifact>>()
  const versionCache = new Map<string, CacheEntry<MavenVersion>>()

  const trim = (k: string) => k.trim()

  return {
    getSearch(key) {
      return searchCache.get(trim(key)) ?? null
    },
    setSearch(key, entry) {
      searchCache.set(trim(key), entry)
    },
    getVersions(key) {
      return versionCache.get(trim(key)) ?? null
    },
    setVersions(key, entry) {
      versionCache.set(trim(key), entry)
    },
  }
}

// Vue composable wrapper — instance-bound to component lifecycle.
export function useMavenCache(): MavenCache {
  return createMavenCache()
}
