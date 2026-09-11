'use strict'

const BLOCKED_KEYS = new Set([
  'username',
  'userName',
  'hostname',
  'hostName',
  'serial',
  'serialNumber',
  'uuid',
  'mac',
  'macAddress',
  'ip',
  'ipAddress',
  'environment',
  'env',
  'processes',
  'installedSoftware',
  'applications',
  'packages'
])

function redactSensitiveText(value) {
  if (typeof value !== 'string') return value

  return value
    .replace(/\b[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){5}\b/g, '[redacted-mac]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .replace(/\b[A-Z]:\\Users\\[^\\/\s]+/gi, (match) => `${match.slice(0, 9)}[redacted]`)
    .replace(/\/(Users|home)\/[^/\s]+/g, '/$1/[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
}

function stripForbiddenFields(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (value == null || typeof value !== 'object') return value
  if (seen.has(value)) return null

  seen.add(value)
  if (Array.isArray(value)) {
    return value.map((item) => stripForbiddenFields(item, seen))
  }

  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) continue
    result[key] = stripForbiddenFields(item, seen)
  }
  return result
}

function bucketBytes(value, stepGiB) {
  if (!Number.isFinite(value) || value < 0) return null
  const step = stepGiB * 1024 ** 3
  return Math.round(value / step) * step
}

function majorVersion(value) {
  if (typeof value !== 'string' || !value) return value ?? null
  const match = value.match(/^v?(\d+)/)
  return match ? match[1] : null
}

function genericMount(value) {
  if (value === '/' || /^[A-Za-z]:\\?$/.test(value || '')) return 'system'
  return value ? '[redacted]' : null
}

function applyFingerprintMinimal(report) {
  report.overview.generatedAt = report.overview.generatedAt
    ? report.overview.generatedAt.replace(/:\d{2}(?:\.\d{3})?Z$/, ':00Z')
    : null

  report.os.release = majorVersion(report.os.release)
  report.os.kernel = null
  report.os.codename = null

  report.device.manufacturer = null
  report.device.model = null
  report.device.version = null

  report.cpu.manufacturer = null
  report.cpu.brand = report.os.arch ? `${report.os.arch} CPU` : 'CPU'
  report.cpu.speedGHz = Number.isFinite(report.cpu.speedGHz)
    ? Math.round(report.cpu.speedGHz * 2) / 2
    : null
  report.cpu.socket = null

  report.memory.totalBytes = bucketBytes(report.memory.totalBytes, 4)
  report.memory.availableBytes = null
  report.memory.usedBytes = null
  report.memory.swapTotalBytes = bucketBytes(report.memory.swapTotalBytes, 4)
  report.memory.swapUsedBytes = null

  report.storage.devices = report.storage.devices.map((device) => ({
    ...device,
    mount: genericMount(device.mount),
    filesystem: null,
    sizeBytes: bucketBytes(device.sizeBytes, 50),
    usedBytes: null,
    availableBytes: null
  }))

  report.graphics.controllers = report.graphics.controllers.map((controller) => ({
    ...controller,
    vendor: null,
    model: null,
    bus: null,
    vramBytes: bucketBytes(controller.vramBytes, 2)
  }))

  report.battery.cycleCount = null
  report.battery.voltage = null
  report.battery.designedCapacity = null
  report.battery.currentCapacity = null

  report.runtime.nodeVersion = majorVersion(report.runtime.nodeVersion)
  report.runtime.electronVersion = majorVersion(report.runtime.electronVersion)
  report.runtime.ztoolsVersion = majorVersion(report.runtime.ztoolsVersion)
  return report
}

function applyPrivacy(input, mode = 'safe') {
  const privacy = mode === 'fingerprint-minimal' ? mode : 'safe'
  const report = stripForbiddenFields(input)
  report.overview.privacy = privacy

  return privacy === 'fingerprint-minimal' ? applyFingerprintMinimal(report) : report
}

module.exports = {
  BLOCKED_KEYS,
  applyPrivacy,
  bucketBytes,
  majorVersion,
  redactSensitiveText,
  stripForbiddenFields
}
