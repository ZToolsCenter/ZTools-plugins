'use strict'

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function nonNegativeNumber(value) {
  const number = finiteNumber(value)
  return number == null ? null : Math.max(0, number)
}

function integer(value) {
  const number = finiteNumber(value)
  return number == null ? null : Math.round(number)
}

function percentage(value) {
  const number = finiteNumber(value)
  if (number == null) return null
  return Math.round(Math.min(100, Math.max(0, number)) * 10) / 10
}

function cleanText(value, maxLength = 160) {
  if (value == null) return null
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, maxLength) : null
}

function boolOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

function percentFromParts(used, total) {
  const usedNumber = nonNegativeNumber(used)
  const totalNumber = nonNegativeNumber(total)
  if (usedNumber == null || totalNumber == null || totalNumber === 0) return null
  return percentage((usedNumber / totalNumber) * 100)
}

function normalizeOs(info = {}, fallback = {}) {
  return {
    platform: cleanText(info.platform || fallback.platform, 40),
    distro: cleanText(info.distro, 100),
    release: cleanText(info.release || fallback.release, 100),
    codename: cleanText(info.codename, 100),
    kernel: cleanText(info.kernel, 100),
    arch: cleanText(info.arch || fallback.arch, 40),
    uefi: boolOrNull(info.uefi)
  }
}

function normalizeDevice(info = {}) {
  return {
    manufacturer: cleanText(info.manufacturer, 120),
    model: cleanText(info.model, 160),
    version: cleanText(info.version, 100),
    virtual: boolOrNull(info.virtual)
  }
}

function normalizeCpu(info = {}) {
  return {
    manufacturer: cleanText(info.manufacturer, 100),
    brand: cleanText(info.brand || info.model, 180),
    physicalCores: integer(info.physicalCores),
    cores: integer(info.cores),
    processors: integer(info.processors),
    speedGHz: nonNegativeNumber(info.speed),
    socket: cleanText(info.socket, 80)
  }
}

function normalizeMemory(info = {}) {
  const totalBytes = nonNegativeNumber(info.total)
  const availableBytes = nonNegativeNumber(info.available ?? info.free)
  const measuredUsedBytes = nonNegativeNumber(info.used ?? info.active)
  const usedBytes = totalBytes != null && availableBytes != null
    ? Math.max(0, totalBytes - availableBytes)
    : measuredUsedBytes
  const swapTotalBytes = nonNegativeNumber(info.swaptotal)
  const swapUsedBytes = nonNegativeNumber(info.swapused)

  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usedPercent: percentFromParts(usedBytes, totalBytes),
    swapTotalBytes,
    swapUsedBytes,
    swapUsedPercent: percentFromParts(swapUsedBytes, swapTotalBytes)
  }
}

function normalizeStorage(items) {
  if (!Array.isArray(items)) return []

  const devices = items.map((item = {}) => {
    const sizeBytes = nonNegativeNumber(item.size)
    const usedBytes = nonNegativeNumber(item.used)
    const availableBytes = nonNegativeNumber(
      item.available ?? (sizeBytes != null && usedBytes != null ? sizeBytes - usedBytes : null)
    )

    return {
      mount: cleanText(item.mount, 240),
      filesystem: cleanText(item.type || item.fs, 120),
      type: cleanText(item.type, 80),
      sizeBytes,
      usedBytes,
      availableBytes,
      usedPercent: percentage(item.use) ?? percentFromParts(usedBytes, sizeBytes),
      readOnly: typeof item.rw === 'boolean' ? !item.rw : null
    }
  })

  // The safe MVP reports only the system volume. Enumerating every mount can
  // expose user-chosen volume names, backup paths and network share details.
  const systemDevice = devices.find((device) => device.mount === '/System/Volumes/Data')
    || devices.find((device) => device.mount === '/')
    || devices.find((device) => /^C:\\?$/i.test(device.mount || ''))
    || devices.find((device) => /^[A-Za-z]:\\?$/.test(device.mount || ''))
    || devices[0]

  return systemDevice ? [{ ...systemDevice, mount: 'system' }] : []
}

function normalizeGraphics(info = {}) {
  const controllers = Array.isArray(info.controllers) ? info.controllers : []

  return {
    controllers: controllers.map((controller = {}) => {
      const vramMiB = nonNegativeNumber(controller.vram)
      return {
        vendor: cleanText(controller.vendor, 120),
        model: cleanText(controller.model, 180),
        bus: cleanText(controller.bus, 60),
        vramBytes: vramMiB == null ? null : Math.round(vramMiB * 1024 * 1024),
        dynamicMemory: boolOrNull(controller.vramDynamic)
      }
    })
  }
}

function normalizeDisplays(items) {
  if (!Array.isArray(items)) return []

  return items.map((display = {}, index) => {
    const bounds = display.bounds && typeof display.bounds === 'object' ? display.bounds : {}
    const workArea = display.workArea && typeof display.workArea === 'object' ? display.workArea : {}
    const size = display.size && typeof display.size === 'object' ? display.size : {}
    const rawScaleFactor = nonNegativeNumber(display.scaleFactor)
    const scaleFactor = rawScaleFactor != null && rawScaleFactor > 0 ? rawScaleFactor : null
    const multiplier = scaleFactor || 1
    const directWidth = integer(display.currentResX ?? display.resolutionX)
    const directHeight = integer(display.currentResY ?? display.resolutionY)
    const boundedWidth = integer(bounds.width ?? size.width)
    const boundedHeight = integer(bounds.height ?? size.height)
    const logicalWidth = boundedWidth ?? (directWidth == null ? null : Math.round(directWidth / multiplier))
    const logicalHeight = boundedHeight ?? (directHeight == null ? null : Math.round(directHeight / multiplier))
    const logicalWorkAreaWidth = integer(workArea.width)
    const logicalWorkAreaHeight = integer(workArea.height)

    return {
      index: index + 1,
      width: directWidth ?? (logicalWidth == null ? null : Math.round(logicalWidth * multiplier)),
      height: directHeight ?? (logicalHeight == null ? null : Math.round(logicalHeight * multiplier)),
      logicalWidth,
      logicalHeight,
      workAreaWidth: logicalWorkAreaWidth == null ? null : Math.round(logicalWorkAreaWidth * multiplier),
      workAreaHeight: logicalWorkAreaHeight == null ? null : Math.round(logicalWorkAreaHeight * multiplier),
      logicalWorkAreaWidth,
      logicalWorkAreaHeight,
      scaleFactor,
      rotation: integer(display.rotation),
      colorDepth: integer(display.colorDepth ?? display.pixelDepth ?? display.pixeldepth),
      refreshRateHz: nonNegativeNumber(display.currentRefreshRate),
      primary: typeof display.primary === 'boolean'
        ? display.primary
        : typeof display.main === 'boolean'
          ? display.main
          : index === 0,
      internal: typeof display.internal === 'boolean'
        ? display.internal
        : typeof display.builtin === 'boolean'
          ? display.builtin
          : null
    }
  })
}

function normalizeBattery(info = {}) {
  const present = typeof info.hasBattery === 'boolean' ? info.hasBattery : false
  const designedCapacity = nonNegativeNumber(info.designedCapacity)
  const currentCapacity = nonNegativeNumber(info.maxCapacity ?? info.currentCapacity)

  return {
    present,
    charging: present ? boolOrNull(info.isCharging) : null,
    percent: present ? percentage(info.percent) : null,
    cycleCount: present ? integer(info.cycleCount) : null,
    timeRemainingMinutes: present ? integer(info.timeRemaining) : null,
    voltage: present ? nonNegativeNumber(info.voltage) : null,
    designedCapacity,
    currentCapacity,
    healthPercent: present ? percentFromParts(currentCapacity, designedCapacity) : null
  }
}

function normalizePerformance(info = {}, memoryUsedPercent = null) {
  return {
    cpuLoadPercent: percentage(info.currentLoad),
    cpuUserPercent: percentage(info.currentLoadUser),
    cpuSystemPercent: percentage(info.currentLoadSystem),
    memoryUsedPercent: percentage(memoryUsedPercent)
  }
}

module.exports = {
  boolOrNull,
  cleanText,
  finiteNumber,
  integer,
  nonNegativeNumber,
  normalizeBattery,
  normalizeCpu,
  normalizeDevice,
  normalizeDisplays,
  normalizeGraphics,
  normalizeMemory,
  normalizeOs,
  normalizePerformance,
  normalizeStorage,
  percentage,
  percentFromParts
}
