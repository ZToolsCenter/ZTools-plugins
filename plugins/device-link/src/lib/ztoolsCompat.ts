const minimumVersion = [2, 4, 0] as const

type ZToolsHostLike = { getAppVersion?: () => unknown }

export interface ZToolsHostCompatibility {
  mode: 'browser-preview' | 'supported' | 'upgrade-required'
  version?: string
  requiresUpgrade: boolean
  reason: 'browser-preview' | 'supported' | 'below-minimum' | 'version-unavailable' | 'version-invalid'
}

function parseVersion(value: unknown): { parts: number[]; prerelease: boolean } | null {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?([+-][0-9A-Za-z.-]+)?$/u.exec(value.trim())
  if (!match) return null
  const parts = [match[1], match[2], match[3] ?? '0'].map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => !Number.isSafeInteger(part))) return null
  return { parts, prerelease: Boolean(match[4]?.startsWith('-')) }
}

export function detectZToolsHostCompatibility(ztools: ZToolsHostLike | undefined): ZToolsHostCompatibility {
  if (ztools === undefined) {
    return { mode: 'browser-preview', requiresUpgrade: false, reason: 'browser-preview' }
  }

  let value: unknown
  try {
    if (typeof ztools.getAppVersion !== 'function') {
      return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-unavailable' }
    }
    value = ztools.getAppVersion()
  } catch {
    return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-unavailable' }
  }

  const version = typeof value === 'string' ? value.trim() : ''
  if (!parseVersion(version)) {
    return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-invalid' }
  }
  if (requiresZToolsUpgrade(version)) {
    return { mode: 'upgrade-required', version, requiresUpgrade: true, reason: 'below-minimum' }
  }
  return { mode: 'supported', version, requiresUpgrade: false, reason: 'supported' }
}

export function requiresZToolsUpgrade(value: unknown): boolean {
  const actual = parseVersion(value)
  if (!actual) return false
  for (let index = 0; index < minimumVersion.length; index += 1) {
    if ((actual.parts[index] || 0) === minimumVersion[index]) continue
    return (actual.parts[index] || 0) < minimumVersion[index]
  }
  return actual.prerelease
}
