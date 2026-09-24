// Shared types across parser, components, preload, and tests.

export interface MavenArtifact {
  id: string              // "g:a"
  g: string               // groupId
  a: string               // artifactId
  latestVersion: string   // latest version (from Solr default rows)
  timestamp: number       // ms epoch from Solr; 0 if placeholder
  source?: string         // 'solr' | 'aliyun' | 'coderead' — which source returned it
}

export interface MavenVersion {
  v: string               // version string
  timestamp: number       // ms epoch; 0 if placeholder
  status: VersionStatus   // classified tag
  isLatest: boolean       // true iff first record w/ timestamp>0
}

export type VersionStatus = 'stable' | 'snapshot' | 'alpha' | 'beta'

// Discriminated union — `kind` is REQUIRED.
export type ParsedQuery =
  | { kind: 'freeText'; freeText: string }
  | { kind: 'scoped'; g?: string; a?: string; v?: string }
  | { kind: 'rawQuery'; rawQuery: string }

export interface PomOptions {
  scope?: string
  classifier?: string
  optional?: boolean
}

// Generic envelope for service responses.
export type SearchResult<T> = {
  data: T[]
  source: 'solr' | 'graphql'
}

// Cache entry — `source: null` allowed for compatibility / untracked fetches.
export type CacheEntry<T> = {
  data: T[]
  source: 'solr' | 'graphql' | null
}