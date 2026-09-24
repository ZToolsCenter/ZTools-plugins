'use strict'

const {
  cleanText,
  normalizeBattery,
  normalizeCpu,
  normalizeDevice,
  normalizeDisplays,
  normalizeGraphics,
  normalizeMemory,
  normalizeOs,
  normalizePerformance,
  normalizeStorage,
  percentFromParts
} = require('./normalizers.cjs')
const {
  isAllowedSystemInformationMethod,
  projectSystemInformationResult
} = require('./systeminformation-protocol.cjs')
const { applyPrivacy } = require('../privacy.cjs')

const DEFAULT_TIMEOUT_MS = 4_000
const MIN_TIMEOUT_MS = 10
const MAX_TIMEOUT_MS = 30_000
const GIB = 1024 ** 3
const systemInformationFlights = new WeakMap()

class CollectorTimeoutError extends Error {
  constructor(source, timeoutMs) {
    super(`${source} collector exceeded ${timeoutMs}ms`)
    this.name = 'CollectorTimeoutError'
    this.code = 'COLLECTOR_TIMEOUT'
  }
}

function safeCall(target, methodName, fallback = null) {
  try {
    if (!target || typeof target[methodName] !== 'function') return fallback
    const value = target[methodName]()
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

function nodeFallback(nodeOs) {
  const platform = cleanText(safeCall(nodeOs, 'platform'), 40)
  const arch = cleanText(safeCall(nodeOs, 'arch'), 40)
  const release = cleanText(safeCall(nodeOs, 'release'), 100)
  const total = Number(safeCall(nodeOs, 'totalmem'))
  const free = Number(safeCall(nodeOs, 'freemem'))
  const cpuList = safeCall(nodeOs, 'cpus', [])
  const firstCpu = Array.isArray(cpuList) && cpuList.length ? cpuList[0] : {}
  const totalBytes = Number.isFinite(total) ? Math.max(0, total) : null
  const availableBytes = Number.isFinite(free) ? Math.max(0, free) : null
  const usedBytes = totalBytes != null && availableBytes != null
    ? Math.max(0, totalBytes - availableBytes)
    : null

  return {
    os: normalizeOs({}, { platform, arch, release }),
    cpu: normalizeCpu({
      brand: firstCpu && firstCpu.model,
      cores: Array.isArray(cpuList) ? cpuList.length : null,
      speed: firstCpu && Number.isFinite(firstCpu.speed) ? firstCpu.speed / 1000 : null
    }),
    memory: {
      ...normalizeMemory({ total: totalBytes, available: availableBytes, used: usedBytes }),
      swapTotalBytes: null,
      swapUsedBytes: null,
      swapUsedPercent: null
    },
    systemUptimeSeconds: Number(safeCall(nodeOs, 'uptime')) || null
  }
}

function createEmptyReport(dependencies = {}) {
  const fallback = nodeFallback(dependencies.nodeOs)
  const processInfo = dependencies.processInfo && typeof dependencies.processInfo === 'object'
    ? dependencies.processInfo
    : {}
  const versions = processInfo.versions && typeof processInfo.versions === 'object'
    ? processInfo.versions
    : {}
  const generatedAt = typeof dependencies.generatedAt === 'string'
    ? dependencies.generatedAt
    : new Date().toISOString()

  return {
    overview: {
      schemaVersion: '1.0',
      generatedAt,
      privacy: 'safe',
      platform: fallback.os.platform,
      arch: fallback.os.arch
    },
    os: fallback.os,
    device: normalizeDevice(),
    cpu: fallback.cpu,
    memory: fallback.memory,
    storage: { devices: [] },
    graphics: { controllers: [] },
    displays: [],
    battery: normalizeBattery(),
    runtime: {
      nodeVersion: cleanText(versions.node, 40),
      electronVersion: cleanText(versions.electron, 40),
      ztoolsVersion: null,
      systemUptimeSeconds: fallback.systemUptimeSeconds
    },
    performance: {
      cpuLoadPercent: null,
      cpuUserPercent: null,
      cpuSystemPercent: null,
      memoryUsedPercent: fallback.memory.usedPercent,
      collectionDurationMs: 0
    },
    sources: {},
    warnings: [],
    errors: [],
    status: 'ok'
  }
}

function callSystemInformation(si, methodName) {
  if (!isAllowedSystemInformationMethod(methodName)) {
    const error = new Error('System information method is not allowed')
    error.code = 'METHOD_NOT_ALLOWED'
    return Promise.reject(error)
  }
  if (!si || typeof si[methodName] !== 'function') {
    const error = new Error(`${methodName} is unavailable`)
    error.code = 'SOURCE_UNAVAILABLE'
    return Promise.reject(error)
  }

  let flights = systemInformationFlights.get(si)
  if (!flights) {
    flights = new Map()
    systemInformationFlights.set(si, flights)
  }
  if (flights.has(methodName)) return flights.get(methodName)

  // This injectable path exists for deterministic unit tests. Production uses
  // runSystemInformation, which invokes the dependency in an isolated helper process.
  const flight = Promise.resolve()
    .then(() => si[methodName]())
    .then((value) => projectSystemInformationResult(methodName, value))
  flights.set(methodName, flight)
  const clearFlight = () => {
    if (flights.get(methodName) === flight) flights.delete(methodName)
  }
  flight.then(clearFlight, clearFlight)
  return flight
}

function resolveTimeout(value) {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)))
}

function runWithTimeout(source, task, timeoutMs, clock = Date.now, options = {}) {
  const startedAt = clock()
  const abortController = new AbortController()
  const awaitAbortSettlement = Boolean(options && options.awaitAbortSettlement)

  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    let timeoutError = null

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      callback(value)
    }
    const timeoutId = setTimeout(() => {
      timedOut = true
      timeoutError = new CollectorTimeoutError(source, timeoutMs)
      abortController.abort(timeoutError)
      // Process-isolated probes settle only after their helper process group is
      // confirmed gone. Other collectors keep the ordinary prompt timeout.
      if (!awaitAbortSettlement) finish(reject, timeoutError)
    }, timeoutMs)

    Promise.resolve()
      .then(() => task(abortController.signal))
      .then(
        (value) => {
          if (timedOut) {
            finish(reject, timeoutError)
            return
          }
          finish(resolve, { value, durationMs: Math.max(0, clock() - startedAt) })
        },
        (error) => finish(reject, timedOut ? timeoutError : error)
      )
  })
}

function getRuntime(dependencies) {
  const processInfo = dependencies.processInfo && typeof dependencies.processInfo === 'object'
    ? dependencies.processInfo
    : {}
  const versions = processInfo.versions && typeof processInfo.versions === 'object'
    ? processInfo.versions
    : {}
  let ztoolsVersion = null
  try {
    ztoolsVersion = typeof dependencies.getZToolsVersion === 'function'
      ? dependencies.getZToolsVersion()
      : null
  } catch {
    ztoolsVersion = null
  }

  return {
    nodeVersion: cleanText(versions.node, 40),
    electronVersion: cleanText(versions.electron, 40),
    ztoolsVersion: cleanText(ztoolsVersion, 40)
  }
}

function runSystemInformationProbe(dependencies, methodName, signal) {
  if (!isAllowedSystemInformationMethod(methodName)) {
    const error = new Error('System information method is not allowed')
    error.code = 'METHOD_NOT_ALLOWED'
    return Promise.reject(error)
  }
  if (typeof dependencies.runSystemInformation === 'function') {
    return Promise.resolve().then(() => dependencies.runSystemInformation(methodName, { signal }))
  }
  const flight = callSystemInformation(dependencies.si, methodName)
  if (!signal || typeof signal.addEventListener !== 'function') return flight
  if (signal.aborted) return Promise.reject(signal.reason)

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    flight.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function unavailableError(message) {
  const error = new Error(message)
  error.code = 'SOURCE_UNAVAILABLE'
  return error
}

function buildCollectors(dependencies) {
  const fallback = nodeFallback(dependencies.nodeOs)
  const awaitSystemInformationSettlement = Boolean(
    dependencies.runSystemInformation && dependencies.runSystemInformation.waitsForProcessExit === true
  )
  return [
    {
      source: 'os',
      provider: 'node',
      run: async () => fallback.os,
      assign(report, value) {
        report.os = value
        report.overview.platform = value.platform
        report.overview.arch = value.arch
      }
    },
    {
      source: 'device',
      provider: 'not-collected',
      successStatus: 'unavailable',
      run: async () => normalizeDevice(),
      assign(report, value) { report.device = value }
    },
    {
      source: 'cpu',
      provider: 'systeminformation',
      awaitAbortSettlement: awaitSystemInformationSettlement,
      run: async (signal) => normalizeCpu(await runSystemInformationProbe(dependencies, 'cpu', signal)),
      assign(report, value) { report.cpu = value }
    },
    {
      source: 'memory',
      provider: 'systeminformation',
      awaitAbortSettlement: awaitSystemInformationSettlement,
      run: async (signal) => normalizeMemory(await runSystemInformationProbe(dependencies, 'mem', signal)),
      assign(report, value) {
        report.memory = value
        report.performance.memoryUsedPercent = value.usedPercent
      }
    },
    {
      source: 'storage',
      provider: 'node',
      run: async () => {
        if (typeof dependencies.getSystemVolumeStats !== 'function') {
          throw unavailableError('System volume statistics are unavailable')
        }
        return { devices: normalizeStorage(await dependencies.getSystemVolumeStats()) }
      },
      assign(report, value) { report.storage = value }
    },
    {
      source: 'graphics',
      provider: 'systeminformation',
      awaitAbortSettlement: awaitSystemInformationSettlement,
      run: async (signal) => {
        const value = await runSystemInformationProbe(dependencies, 'graphics', signal)
        return {
          graphics: normalizeGraphics(value),
          displayFallback: normalizeDisplays(value && value.displays)
        }
      },
      assign(report, value) {
        report.graphics = value.graphics
        report.__displayFallback = value.displayFallback
      }
    },
    {
      source: 'displays',
      provider: 'ztools',
      run: async () => {
        if (typeof dependencies.getDisplays !== 'function') {
          const error = new Error('getDisplays is unavailable')
          error.code = 'SOURCE_UNAVAILABLE'
          throw error
        }
        return normalizeDisplays(await dependencies.getDisplays())
      },
      assign(report, value) { report.displays = value }
    },
    {
      source: 'battery',
      provider: 'systeminformation',
      awaitAbortSettlement: awaitSystemInformationSettlement,
      run: async (signal) => normalizeBattery(await runSystemInformationProbe(dependencies, 'battery', signal)),
      assign(report, value) { report.battery = value }
    },
    {
      source: 'runtime',
      provider: 'node/ztools',
      run: async () => getRuntime(dependencies),
      assign(report, value) { report.runtime = { ...report.runtime, ...value } }
    },
    {
      source: 'performance',
      provider: 'systeminformation',
      awaitAbortSettlement: awaitSystemInformationSettlement,
      run: async (signal) => normalizePerformance(await runSystemInformationProbe(dependencies, 'currentLoad', signal)),
      assign(report, value) {
        report.performance = {
          ...report.performance,
          ...value,
          memoryUsedPercent: report.memory.usedPercent
        }
      }
    }
  ]
}

function errorCode(error) {
  if (error && error.code === 'COLLECTOR_TIMEOUT') return 'COLLECTOR_TIMEOUT'
  if (error && error.code === 'SOURCE_UNAVAILABLE') return 'SOURCE_UNAVAILABLE'
  return 'COLLECTOR_FAILED'
}

function evaluateHealth(report) {
  const memoryAvailableRatio = report.memory.totalBytes > 0 && report.memory.availableBytes != null
    ? report.memory.availableBytes / report.memory.totalBytes
    : null
  report.memory.status = memoryAvailableRatio == null
    ? 'unavailable'
    : memoryAvailableRatio < 0.1
      ? 'warning'
      : 'ok'
  if (report.memory.status === 'warning') {
    report.warnings.push(`可用内存不足总容量的 10%（当前约 ${Math.round(memoryAvailableRatio * 100)}%）`)
  }

  const systemVolume = report.storage.devices[0]
  if (!systemVolume || systemVolume.sizeBytes == null || systemVolume.availableBytes == null) {
    report.storage.status = 'unavailable'
  } else {
    const freeRatio = systemVolume.sizeBytes > 0 ? systemVolume.availableBytes / systemVolume.sizeBytes : null
    report.storage.status = systemVolume.availableBytes < 20 * GIB || (freeRatio != null && freeRatio < 0.1)
      ? 'warning'
      : 'ok'
    if (report.storage.status === 'warning') {
      report.warnings.push('系统盘可用空间较低，建议至少保留 20 GB 或总容量的 10%')
    }
  }

  report.battery.status = !report.battery.present
    ? 'unavailable'
    : report.battery.healthPercent != null && report.battery.healthPercent < 80
      ? 'warning'
      : 'ok'
  if (report.battery.status === 'warning') {
    report.warnings.push(`电池健康度约为 ${Math.round(report.battery.healthPercent)}%，续航可能明显缩短`)
  }

  report.performance.status = report.performance.cpuLoadPercent == null
    ? 'unavailable'
    : report.performance.cpuLoadPercent >= 90
      ? 'warning'
      : 'ok'
  if (report.performance.status === 'warning') {
    report.warnings.push(`采集时 CPU 使用率约为 ${Math.round(report.performance.cpuLoadPercent)}%，可稍后重新检查`)
  }
}

function finalizeReport(report, successfulCollectors, collectionDurationMs) {
  if (!report.displays.length && Array.isArray(report.__displayFallback) && report.__displayFallback.length) {
    report.displays = report.__displayFallback
    report.sources.displays = {
      ...report.sources.displays,
      status: 'fallback',
      provider: 'systeminformation'
    }
  }
  delete report.__displayFallback

  report.performance.memoryUsedPercent = report.memory.usedPercent
  report.performance.collectionDurationMs = Math.max(0, Math.round(collectionDurationMs))
  report.overview.platform = report.os.platform
  report.overview.arch = report.os.arch
  evaluateHealth(report)
  report.status = report.errors.length === 0
    ? report.warnings.length > 0 ? 'warning' : 'ok'
    : successfulCollectors === 0
      ? 'failed'
      : 'partial'
  return report
}

async function collectSystemReport(options = {}, dependencies = {}) {
  const clock = typeof dependencies.clock === 'function' ? dependencies.clock : Date.now
  const startedAt = clock()
  const timeoutMs = resolveTimeout(options.timeoutMs)
  const report = createEmptyReport({
    ...dependencies,
    generatedAt: typeof dependencies.now === 'function'
      ? new Date(dependencies.now()).toISOString()
      : undefined
  })
  const collectors = buildCollectors(dependencies)

  const results = await Promise.allSettled(
    collectors.map((collector) => runWithTimeout(
      collector.source,
      collector.run,
      timeoutMs,
      clock,
      { awaitAbortSettlement: collector.awaitAbortSettlement }
    ))
  )

  let successfulCollectors = 0
  results.forEach((result, index) => {
    const collector = collectors[index]
    if (result.status === 'fulfilled') {
      const status = collector.successStatus || 'ok'
      if (status === 'ok') successfulCollectors += 1
      collector.assign(report, result.value.value)
      report.sources[collector.source] = {
        status,
        provider: collector.provider,
        durationMs: Math.round(result.value.durationMs)
      }
      return
    }

    const code = errorCode(result.reason)
    report.sources[collector.source] = {
      status: code === 'COLLECTOR_TIMEOUT' ? 'timeout' : 'unavailable',
      provider: collector.provider,
      durationMs: code === 'COLLECTOR_TIMEOUT' ? timeoutMs : Math.max(0, Math.round(clock() - startedAt))
    }
    report.errors.push({
      source: collector.source,
      code,
      message: code === 'COLLECTOR_TIMEOUT'
        ? 'Collection timed out'
        : 'Collection failed'
    })
  })

  finalizeReport(report, successfulCollectors, clock() - startedAt)
  return applyPrivacy(report, options.privacy)
}

module.exports = {
  CollectorTimeoutError,
  DEFAULT_TIMEOUT_MS,
  buildCollectors,
  callSystemInformation,
  collectSystemReport,
  createEmptyReport,
  finalizeReport,
  evaluateHealth,
  nodeFallback,
  resolveTimeout,
  runSystemInformationProbe,
  runWithTimeout
}
