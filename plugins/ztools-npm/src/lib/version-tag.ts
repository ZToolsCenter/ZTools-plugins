import type { NpmVersion, VersionStatus } from './types'

const QUALIFIER_GROUPS: [string[], VersionStatus][] = [
  [['canary', 'dev', 'nightly', 'insiders', 'experimental', 'snapshot', 'next', 'future'], 'dev'],
  [['alpha'], 'alpha'],
  [['beta', 'milestone'], 'beta'],
  [['rc'], 'rc'],
]

function classifyQualifier(seg: string): VersionStatus | null {
  const lower = seg.toLowerCase()
  for (const [keys, status] of QUALIFIER_GROUPS) {
    if (keys.some(k => lower === k || lower.startsWith(k))) return status
  }
  return null
}

export function tagVersion(v: string): VersionStatus {
  // +build 元数据与语义版本无关，先剥离再分类（与 canonicalize 保持一致）
  const pre = v.split('+')[0]
  const segments = pre.split(/[-.]/)
  for (const seg of segments) {
    const status = classifyQualifier(seg)
    if (status) return status
  }
  return 'stable'
}

export function hasTimestamp(rec: NpmVersion): boolean {
  return (rec.time ?? 0) > 0
}

export function pickLatest(versions: NpmVersion[]): NpmVersion | null {
  let best: NpmVersion | null = null
  for (const v of versions) {
    if (!hasTimestamp(v)) continue
    if (!best || (v.time ?? 0) > (best.time ?? 0)) best = v
  }
  return best
}

// npm 语义化版本：剥离 +build 元数据后作为去重键（1.0.0 与 1.0.0+build.2 视为同一版本）
function canonicalize(v: string): string {
  return v.split('+')[0]
}

export function dedupeVersions(versions: NpmVersion[]): NpmVersion[] {
  const groups = new Map<string, NpmVersion>()
  for (const v of versions) {
    const key = canonicalize(v.v)
    const existing = groups.get(key)
    if (!existing || (v.time ?? 0) > (existing.time ?? 0)) {
      groups.set(key, { ...v, v: key })
    }
  }
  return Array.from(groups.values())
}

export function formatTimestamp(ts: number): string {
  if (ts <= 0) return '—'
  const d = new Date(ts)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}

export function applyDistTags(versions: NpmVersion[], distTags: Record<string, string>): NpmVersion[] {
  // 与 dedupeVersions 一致：dist-tag 值与版本号都剥离 +build 元数据后再匹配
  const values = Object.values(distTags).map(v => v.split('+')[0])
  const tagged = versions.map(v => ({
    ...v,
    isDistTag: values.includes(v.v.split('+')[0]),
  }))
  const latest = distTags.latest
  if (latest) {
    const idx = tagged.findIndex(v => v.v.split('+')[0] === latest.split('+')[0])
    if (idx >= 0) tagged[idx] = { ...tagged[idx], isLatest: true }
  }
  return tagged
}
