'use strict'

const path = require('node:path')

const MINIMUM_VERSION = Object.freeze([2, 4, 0])

function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^[vV]?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
  if (!match) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)]
  return parts.every(Number.isSafeInteger) ? parts : null
}

function getHostCompatibility(api) {
  if (!api) return Object.freeze({ supported: true, detected: false, version: null })
  if (typeof api.getAppVersion !== 'function') {
    return Object.freeze({ supported: false, detected: true, version: null })
  }
  let version = null
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

function resolveSidecarRuntimeDir(api, legacyDataDir) {
  try {
    const pluginData = typeof api?.getPath === 'function' ? api.getPath('pluginData') : null
    if (typeof pluginData === 'string' && path.isAbsolute(pluginData)) {
      return Object.freeze({ path: path.join(pluginData, 'runtime', 'sidecar'), usingPluginData: true })
    }
  } catch {
    // ZTools 2.4--3.1 reject the 3.2-only path name; stay on the legacy
    // runtime cache without changing Provider, credential or override data.
  }
  return Object.freeze({ path: path.join(legacyDataDir, 'runtime', 'sidecar'), usingPluginData: false })
}

module.exports = Object.freeze({ MINIMUM_VERSION, getHostCompatibility, parseVersion, resolveSidecarRuntimeDir })
