'use strict'

const path = require('node:path')

const MINIMUM_VERSION = [2, 4, 0]

function parseHostVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?([+-][0-9A-Za-z.-]+)?$/u.exec(value.trim())
  if (!match) return null
  const parts = [match[1], match[2], match[3] || '0'].map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => !Number.isSafeInteger(part))) return null
  return { parts, prerelease: Boolean(match[4]?.startsWith('-')) }
}

function isBelowMinimumVersion(parsed) {
  for (let index = 0; index < MINIMUM_VERSION.length; index += 1) {
    if (parsed.parts[index] === MINIMUM_VERSION[index]) continue
    return parsed.parts[index] < MINIMUM_VERSION[index]
  }
  return parsed.prerelease
}

function detectHostCompatibility(ztools) {
  if (ztools === undefined) {
    return { mode: 'browser-preview', requiresUpgrade: false, reason: 'browser-preview' }
  }
  let value
  try {
    if (typeof ztools?.getAppVersion !== 'function') {
      return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-unavailable' }
    }
    value = ztools.getAppVersion()
  } catch {
    return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-unavailable' }
  }
  const version = typeof value === 'string' ? value.trim() : ''
  const parsed = parseHostVersion(version)
  if (!parsed) return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-invalid' }
  if (isBelowMinimumVersion(parsed)) {
    return { mode: 'upgrade-required', version, requiresUpgrade: true, reason: 'below-minimum' }
  }
  return { mode: 'supported', version, requiresUpgrade: false, reason: 'supported' }
}

function pathFromHost(ztools, name) {
  try {
    const value = ztools?.getPath?.(name)
    return typeof value === 'string' && value.trim() ? value : ''
  } catch {
    return ''
  }
}

function resolveDataDirectories(ztools) {
  const userData = pathFromHost(ztools, 'userData')
  if (!userData) throw new Error('ZTools userData path is unavailable')
  const legacyDataDir = path.join(userData, 'device-link')
  const pluginDataDir = pathFromHost(ztools, 'pluginData')
  return {
    dataDir: pluginDataDir || legacyDataDir,
    legacyDataDir,
    usingPluginData: Boolean(pluginDataDir),
  }
}

module.exports = { detectHostCompatibility, resolveDataDirectories }
