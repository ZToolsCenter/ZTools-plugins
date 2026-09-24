import type { MavenVersion, VersionStatus } from './types'

function classifyQualifier(q: string): VersionStatus | null {
  const lower = q.toLowerCase()
  if (lower.startsWith('snapshot')) return 'snapshot'
  if (lower.startsWith('alpha')) return 'alpha'
  if (lower.startsWith('beta') || lower.startsWith('rc') || lower.startsWith('m') || lower === 'milestone') {
    return 'beta'
  }
  if (lower === 'release' || lower === 'final' || lower === 'ga') {
    return 'stable'
  }
  return null
}

export function tagVersion(v: string): VersionStatus {
  const segments = v.split(/[-.]/)
  for (const seg of segments) {
    const status = classifyQualifier(seg)
    if (status) return status
  }
  return 'stable' // fallback per spec §8
}

export function hasTimestamp(rec: MavenVersion): boolean {
  return rec.timestamp > 0
}

export function pickLatest(versions: MavenVersion[]): MavenVersion | null {
  let best: MavenVersion | null = null
  for (const v of versions) {
    if (!hasTimestamp(v)) continue
    if (!best || v.timestamp > best.timestamp) best = v
  }
  return best
}

const CANONICAL_STRIP_RE = /\.(RELEASE|Final|GA|release|final|ga)$/

function canonicalize(v: string): string {
  return v.replace(CANONICAL_STRIP_RE, '')
}

export function dedupeVersions(versions: MavenVersion[]): MavenVersion[] {
  const groups = new Map<string, MavenVersion>()
  for (const v of versions) {
    const key = canonicalize(v.v)
    const existing = groups.get(key)
    if (!existing || v.timestamp > existing.timestamp) {
      groups.set(key, v)
    }
  }
  return Array.from(groups.values())
}

// UTC pinned to match Solr timestamp semantics
export function formatTimestamp(ts: number): string {
  if (ts <= 0) return '—'
  const d = new Date(ts)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}