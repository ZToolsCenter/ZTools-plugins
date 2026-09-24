'use strict'

const fs = require('node:fs/promises')

function numeric(value) {
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 ? result : null
}

function multiply(left, right) {
  const leftNumber = numeric(left)
  const rightNumber = numeric(right)
  if (leftNumber == null || rightNumber == null) return null
  const result = leftNumber * rightNumber
  return Number.isFinite(result) ? result : null
}

function systemVolumeRoot(processInfo = process) {
  if (!processInfo || processInfo.platform !== 'win32') return '/'
  const environment = processInfo.env && typeof processInfo.env === 'object'
    ? processInfo.env
    : {}
  const systemRoot = typeof environment.SystemRoot === 'string' ? environment.SystemRoot : ''
  const rootMatch = systemRoot.match(/^([A-Za-z]):\\Windows$/i)
  if (rootMatch) return `${rootMatch[1].toUpperCase()}:\\`

  const systemDrive = typeof environment.SystemDrive === 'string' ? environment.SystemDrive : ''
  if (/^[A-Za-z]:$/.test(systemDrive)) return `${systemDrive[0].toUpperCase()}:\\`

  const error = new Error('Windows system volume root is unavailable')
  error.code = 'SOURCE_UNAVAILABLE'
  throw error
}

async function collectSystemVolumeStats(options = {}) {
  const fsApi = options.fsApi || fs
  if (!fsApi || typeof fsApi.statfs !== 'function') {
    const error = new Error('System volume statistics are unavailable')
    error.code = 'SOURCE_UNAVAILABLE'
    throw error
  }

  const stats = await fsApi.statfs(systemVolumeRoot(options.processInfo))
  const blockSize = stats && (stats.bsize ?? stats.frsize)
  const size = multiply(stats && stats.blocks, blockSize)
  const free = multiply(stats && stats.bfree, blockSize)
  const available = multiply(stats && (stats.bavail ?? stats.bfree), blockSize)
  const used = size != null && free != null ? Math.max(0, size - free) : null

  if (size == null || available == null) {
    const error = new Error('System volume statistics are unavailable')
    error.code = 'SOURCE_UNAVAILABLE'
    throw error
  }

  // statfs targets exactly one canonical root and does not enumerate mount
  // names, user volumes or network shares.
  return [{
    mount: 'system',
    size,
    used,
    available,
    type: null,
    rw: null
  }]
}

module.exports = {
  collectSystemVolumeStats,
  systemVolumeRoot
}
