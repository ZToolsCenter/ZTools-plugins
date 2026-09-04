export type ZToolsCompatibility = {
  supported: boolean
  detected: boolean
  version: string | null
}

const MINIMUM_VERSION = Object.freeze([2, 4, 0])

function parseVersion(value: unknown): number[] | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^[vV]?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
  if (!match) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
  return parts.every(Number.isSafeInteger) ? parts : null
}

export function getZToolsCompatibility(value: unknown): ZToolsCompatibility {
  const parsed = parseVersion(value)
  if (!parsed) return { supported: false, detected: true, version: null }
  const difference = parsed.findIndex((part, index) => part !== MINIMUM_VERSION[index])
  const minimumPrerelease = difference === -1 && /^[vV]?\d+\.\d+(?:\.\d+)?-/.test(String(value).trim())
  const supported = !minimumPrerelease && (difference === -1 || parsed[difference] > MINIMUM_VERSION[difference])
  return { supported, detected: true, version: `${parsed[0]}.${parsed[1]}.${parsed[2]}` }
}

export function hostCompatibility(): ZToolsCompatibility {
  if (!window.ztools) return { supported: true, detected: false, version: null }
  if (typeof window.ztools.getAppVersion !== 'function') {
    return { supported: false, detected: true, version: null }
  }
  try {
    return getZToolsCompatibility(window.ztools.getAppVersion())
  } catch {
    return { supported: false, detected: true, version: null }
  }
}
