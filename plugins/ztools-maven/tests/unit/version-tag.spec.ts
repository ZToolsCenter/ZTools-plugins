import { describe, it, expect } from 'vitest'
import { tagVersion, hasTimestamp, pickLatest, dedupeVersions, formatTimestamp } from '../../src/lib/version-tag'
import type { MavenVersion } from '../../src/lib/types'

describe('tagVersion', () => {
  it.each([
    ['6.0.0', 'stable'],
    ['6.0.0.RELEASE', 'stable'],
    ['6.0.0.Final', 'stable'],
    ['6.0.0.GA', 'stable'],
    ['1.0.0-alpha', 'alpha'],
    ['1.0.0-alpha.1', 'alpha'],
    ['1.0.0-beta', 'beta'],
    ['2.0.0.Beta', 'beta'],
    ['1.0.0-rc1', 'beta'],
    ['1.0.0.RC1', 'beta'],
    ['1.0.0-rc-1', 'beta'],
    ['1.0.0-M1', 'beta'],
    ['1.0.0-milestone', 'beta'],
    ['1.0.0-SNAPSHOT', 'snapshot'],
    ['9.9.9-weird-thing', 'stable'],
  ])('tags %s as %s', (v, expected) => {
    expect(tagVersion(v)).toBe(expected)
  })
})

describe('hasTimestamp', () => {
  it('returns true when timestamp > 0', () => {
    expect(hasTimestamp({ v: '1.0.0', timestamp: 1000, status: 'stable', isLatest: false })).toBe(true)
  })
  it('returns false when timestamp is 0 (placeholder)', () => {
    expect(hasTimestamp({ v: 'RELEASE', timestamp: 0, status: 'stable', isLatest: false })).toBe(false)
  })
})

describe('pickLatest', () => {
  it('returns the version with max timestamp (excluding placeholders)', () => {
    const v: MavenVersion[] = [
      { v: '2.0.0', timestamp: 1000, status: 'stable', isLatest: false },
      { v: '1.0.0', timestamp: 500, status: 'stable', isLatest: false },
    ]
    expect(pickLatest(v)?.v).toBe('2.0.0')
  })
  it('skips records with timestamp 0', () => {
    const v: MavenVersion[] = [
      { v: 'RELEASE', timestamp: 0, status: 'stable', isLatest: false },
      { v: '1.0.0', timestamp: 500, status: 'stable', isLatest: false },
    ]
    expect(pickLatest(v)?.v).toBe('1.0.0')
  })
  it('returns null if no record has timestamp > 0', () => {
    const v: MavenVersion[] = [{ v: 'RELEASE', timestamp: 0, status: 'stable', isLatest: false }]
    expect(pickLatest(v)).toBeNull()
  })
})

describe('dedupeVersions', () => {
  it('dedupes 1.0.0.RELEASE keeping the canonical 1.0.0 form (max timestamp wins)', () => {
    const v: MavenVersion[] = [
      { v: '1.0.0.RELEASE', timestamp: 1000, status: 'stable', isLatest: false },
      { v: '1.0.0', timestamp: 500, status: 'stable', isLatest: false },
    ]
    const r = dedupeVersions(v)
    expect(r).toHaveLength(1)
    expect(r[0].v).toBe('1.0.0.RELEASE')
    expect(r[0].timestamp).toBe(1000)
  })
  it('keeps higher-timestamp when canonical form wins', () => {
    const v: MavenVersion[] = [
      { v: '1.0.0', timestamp: 1000, status: 'stable', isLatest: false },
      { v: '1.0.0.RELEASE', timestamp: 500, status: 'stable', isLatest: false },
    ]
    const r = dedupeVersions(v)
    expect(r).toHaveLength(1)
    expect(r[0].v).toBe('1.0.0')
  })
  it('preserves unique versions', () => {
    const v: MavenVersion[] = [
      { v: '2.0.0', timestamp: 2000, status: 'stable', isLatest: false },
      { v: '1.0.0', timestamp: 1000, status: 'stable', isLatest: false },
    ]
    expect(dedupeVersions(v)).toHaveLength(2)
  })
  it('treats RELEASE/Final/GA case-insensitively (3-way mixed case)', () => {
    const v: MavenVersion[] = [
      { v: '1.0.0.RELEASE', timestamp: 500, status: 'stable', isLatest: false },
      { v: '1.0.0.final', timestamp: 1000, status: 'stable', isLatest: false },
      { v: '1.0.0.Final', timestamp: 750, status: 'stable', isLatest: false },
    ]
    const r = dedupeVersions(v)
    expect(r).toHaveLength(1)
    expect(r[0].v).toBe('1.0.0.final')
    expect(r[0].timestamp).toBe(1000)
  })
})

describe('formatTimestamp', () => {
  it('formats ms epoch to YYYY-MM', () => {
    expect(formatTimestamp(1718409600000)).toBe('2024-06') // 2024-06-15 UTC
  })
  it('returns "—" for timestamp 0', () => {
    expect(formatTimestamp(0)).toBe('—')
  })
})