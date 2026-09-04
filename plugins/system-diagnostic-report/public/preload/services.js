'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { getHostCompatibility } = require('./host-compatibility.cjs')

const compatibility = getHostCompatibility(typeof window === 'undefined' ? undefined : window)
// systeminformation and the collector graph may spawn probes. Do not even
// require them until a real host has positively identified itself as 2.4+.
const nodeOs = compatibility.supported ? require('node:os') : null
const systeminformation = compatibility.supported ? require('systeminformation') : null
const collectSystemReport = compatibility.supported
  ? require('./collectors/core.cjs').collectSystemReport
  : null

const MAX_REPORT_BYTES = 20 * 1024 * 1024
const DRAG_GRANT_TTL_MS = 5 * 60 * 1000
const collectionFlights = new Map()
const dragGrants = new Map()

function hostApi() {
  return window && window.ztools ? window.ztools : null
}

function getZToolsVersion() {
  const api = hostApi()
  if (!api || typeof api.getAppVersion !== 'function') return null
  try {
    const value = api.getAppVersion()
    return value == null ? null : String(value).slice(0, 40)
  } catch {
    return null
  }
}

function getDisplays() {
  const api = hostApi()
  if (!api || typeof api.getAllDisplays !== 'function') return []
  try {
    return api.getAllDisplays()
  } catch {
    return []
  }
}

function collect(options = {}) {
  if (!compatibility.supported || !collectSystemReport) {
    return Promise.reject(new Error('ZTools 2.4.0 or newer is required'))
  }
  const privacy = options && options.privacy === 'fingerprint-minimal'
    ? 'fingerprint-minimal'
    : 'safe'
  if (collectionFlights.has(privacy)) return collectionFlights.get(privacy)

  const flight = collectSystemReport(
    { privacy },
    {
      si: systeminformation,
      nodeOs,
      getDisplays,
      getZToolsVersion,
      processInfo: { versions: process.versions }
    }
  )
  collectionFlights.set(privacy, flight)
  const clearFlight = () => {
    if (collectionFlights.get(privacy) === flight) collectionFlights.delete(privacy)
  }
  flight.then(clearFlight, clearFlight)
  return flight
}

async function copyText(text) {
  if (!compatibility.supported) return false
  if (typeof text !== 'string') return false
  const api = hostApi()
  if (!api || typeof api.copyText !== 'function') return false
  try {
    return api.copyText(text) !== false
  } catch {
    return false
  }
}

function safeDefaultName(value, format) {
  const extension = format === 'json' ? '.json' : '.md'
  const base = path.basename(String(value || `system-report${extension}`))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .slice(0, 160)
  if (base.toLowerCase().endsWith(extension)) return base
  return `${base || 'system-report'}${extension}`
}

async function saveReport(options = {}) {
  if (!compatibility.supported) throw new Error('ZTools 2.4.0 or newer is required')
  const format = options.format === 'json' ? 'json' : options.format === 'markdown' ? 'markdown' : null
  if (!format) throw new TypeError('Unsupported report format')
  if (typeof options.content !== 'string') throw new TypeError('Report content must be text')
  if (Buffer.byteLength(options.content, 'utf8') > MAX_REPORT_BYTES) {
    throw new RangeError('Report is too large')
  }

  const api = hostApi()
  if (!api || typeof api.showSaveDialog !== 'function') {
    throw new Error('Save dialog is unavailable')
  }

  const fileName = safeDefaultName(options.defaultName, format)
  const selection = await api.showSaveDialog({
    title: 'Save system diagnostic report',
    defaultPath: fileName,
    filters: [{
      name: format === 'json' ? 'JSON' : 'Markdown',
      extensions: [format === 'json' ? 'json' : 'md']
    }]
  })
  const filePath = typeof selection === 'string'
    ? selection
    : selection && !selection.canceled
      ? selection.filePath
      : null

  if (!filePath) return { canceled: true }
  await fs.writeFile(filePath, options.content, { encoding: 'utf8' })
  const realPath = await fs.realpath(filePath)
  dragGrants.clear()
  dragGrants.set(realPath, Date.now() + DRAG_GRANT_TTL_MS)
  return { canceled: false, filePath }
}

async function startDrag(filePath) {
  if (!compatibility.supported) return false
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false
  const api = hostApi()
  if (!api || typeof api.startDrag !== 'function') return false
  try {
    const realPath = await fs.realpath(filePath)
    const expiresAt = dragGrants.get(realPath)
    if (!expiresAt || expiresAt < Date.now()) {
      dragGrants.delete(realPath)
      return false
    }
    const stat = await fs.stat(realPath)
    if (!stat.isFile()) return false
    dragGrants.delete(realPath)
    api.startDrag(realPath)
    return true
  } catch {
    return false
  }
}

window.systemReport = Object.freeze({
  collect,
  copyText,
  saveReport,
  startDrag
})
