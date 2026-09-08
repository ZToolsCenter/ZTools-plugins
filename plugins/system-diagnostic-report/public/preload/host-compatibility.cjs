'use strict'

const MINIMUM_VERSION = Object.freeze([2, 4, 0])

function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^[vV]?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
  if (!match) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
  return parts.every(Number.isSafeInteger) ? parts : null
}

function getHostCompatibility(hostWindow) {
  const api = hostWindow?.ztools
  if (!api) return Object.freeze({ supported: true, detected: false, version: null })
  if (typeof api.getAppVersion !== 'function') {
    return Object.freeze({ supported: false, detected: true, version: null })
  }
  let version
  try { version = api.getAppVersion() } catch {
    return Object.freeze({ supported: false, detected: true, version: null })
  }
  const parsed = parseVersion(version)
  if (!parsed) return Object.freeze({ supported: false, detected: true, version: null })
  const difference = parsed.findIndex((part, index) => part !== MINIMUM_VERSION[index])
  const minimumPrerelease = difference === -1 && /^[vV]?\d+\.\d+(?:\.\d+)?-/.test(String(version).trim())
  const supported = !minimumPrerelease && (difference === -1 || parsed[difference] > MINIMUM_VERSION[difference])
  return Object.freeze({ supported, detected: true, version: `${parsed[0]}.${parsed[1]}.${parsed[2]}` })
}

module.exports = Object.freeze({ MINIMUM_VERSION, getHostCompatibility, parseVersion })
