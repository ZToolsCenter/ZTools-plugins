import { describe, it, expect } from 'vitest'
import { createMavenCache } from '../../src/lib/useMavenCache'

describe('createMavenCache', () => {
  it('returns null on miss', () => {
    const cache = createMavenCache()
    expect(cache.getSearch('spring')).toBeNull()
  })

  it('stores and retrieves search entries', () => {
    const cache = createMavenCache()
    const entry = { data: [{ id: 'a', g: 'g', a: 'a', latestVersion: '1', timestamp: 1000 }], source: 'solr' as const }
    cache.setSearch('g:a', entry)
    expect(cache.getSearch('g:a')).toEqual(entry)
  })

  it('stores and retrieves version entries', () => {
    const cache = createMavenCache()
    const entry = { data: [{ v: '1.0.0', timestamp: 1000, status: 'stable' as const, isLatest: true }], source: 'solr' as const }
    cache.setVersions('g:a', entry)
    expect(cache.getVersions('g:a')).toEqual(entry)
  })

  it('isolates search and version caches by key', () => {
    const cache = createMavenCache()
    const searchEntry = { data: [], source: 'solr' as const }
    const versionEntry = { data: [], source: 'solr' as const }
    cache.setSearch('same', searchEntry)
    cache.setVersions('same', versionEntry)
    expect(cache.getSearch('same')).toEqual(searchEntry)
    expect(cache.getVersions('same')).toEqual(versionEntry)
  })

  it('overwrites on duplicate key', () => {
    const cache = createMavenCache()
    cache.setSearch('k', { data: [], source: 'solr' })
    cache.setSearch('k', { data: [{ id: 'new', g: 'g', a: 'a', latestVersion: '1', timestamp: 1000 }], source: 'graphql' })
    const got = cache.getSearch('k')
    expect(got?.source).toBe('graphql')
  })

  it('normalizes whitespace in key (trim)', () => {
    const cache = createMavenCache()
    const entry = { data: [], source: 'solr' as const }
    cache.setSearch('  spring-core  ', entry)
    expect(cache.getSearch('spring-core')).toEqual(entry)
  })

  it('versions cache source is independent from search cache source', () => {
    const cache = createMavenCache()
    cache.setVersions('g:a', { data: [], source: 'solr' })
    const got = cache.getVersions('g:a')
    expect(got?.source).toBe('solr')
  })
})
