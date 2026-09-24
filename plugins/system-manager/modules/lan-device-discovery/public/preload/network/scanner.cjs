'use strict'

const nodeOs = require('node:os')
const { setMaxListeners } = require('node:events')
const { createProcessRunner } = require('./process-runner.cjs')
const { exactInterfaceMatch, listInterfacesFromNode, ipv4ToInt } = require('./interfaces.cjs')
const { generateCandidates } = require('./subnet.cjs')
const { readNeighbors } = require('./neighbors.cjs')
const { probeHosts } = require('./probe.cjs')
const { enrichHostnames } = require('./hostnames.cjs')
const { lookupVendor } = require('./vendors.cjs')

const SCAN_TIMEOUT_MS = 12_000

function publicError(code, message) {
  return { code, message }
}

function mergeDevices(networkInterface, firstNeighbors, secondNeighbors, responsive) {
  const devices = new Map()
  const ensure = (ip) => {
    if (!devices.has(ip)) devices.set(ip, {
      ip,
      hostname: null,
      vendor: null,
      onlineStatus: 'unknown',
      evidence: [],
      isSelf: ip === networkInterface.address,
      __mac: null,
      __neighborState: 'unknown',
    })
    return devices.get(ip)
  }
  const self = ensure(networkInterface.address)
  self.onlineStatus = 'online'
  self.evidence.push('self')
  for (const neighbor of [...(firstNeighbors || []), ...(secondNeighbors || [])]) {
    const item = ensure(neighbor.ip)
    item.__mac = neighbor.mac || item.__mac
    if (neighbor.state === 'reachable') item.__neighborState = 'reachable'
    else if (item.__neighborState !== 'reachable') item.__neighborState = neighbor.state
    if (!item.evidence.includes('neighbor')) item.evidence.push('neighbor')
  }
  for (const ip of responsive || []) {
    const item = ensure(ip)
    item.onlineStatus = 'online'
    if (!item.evidence.includes('icmp')) item.evidence.push('icmp')
  }
  for (const item of devices.values()) {
    if (item.onlineStatus !== 'online') {
      item.onlineStatus = item.__neighborState === 'reachable' ? 'online' : item.__neighborState === 'stale' ? 'recently-seen' : 'unknown'
    }
    item.vendor = lookupVendor(item.__mac)
    delete item.__mac
    delete item.__neighborState
  }
  return [...devices.values()].sort((a, b) => ipv4ToInt(a.ip) - ipv4ToInt(b.ip))
}

function createLanScanner(dependencies = {}) {
  const osApi = dependencies.nodeOs || nodeOs
  const platform = dependencies.platform || process.platform
  const run = dependencies.run || createProcessRunner(dependencies.spawn)
  const clock = dependencies.clock || Date.now
  const read = dependencies.readNeighbors || ((iface, context) => readNeighbors(platform, iface, {
    run,
    readFile: dependencies.readFile,
    signal: context.signal,
    executableDependencies: dependencies.executableDependencies,
  }))
  const probe = dependencies.probeHosts || probeHosts
  const hostnameEnricher = dependencies.enrichHostnames || enrichHostnames
  const scanTimeoutMs = Number.isFinite(dependencies.scanTimeoutMs)
    ? Math.min(SCAN_TIMEOUT_MS, Math.max(10, Math.round(dependencies.scanTimeoutMs)))
    : SCAN_TIMEOUT_MS
  let inventory = new Map()
  let active = null
  let generation = 0

  function listInterfaces() {
    const values = listInterfacesFromNode(osApi)
    inventory = new Map(values.map((item) => [item.id, item]))
    return Promise.resolve(values)
  }

  function cancelScan() {
    if (!active || active.controller.signal.aborted) return false
    active.abortReason = 'user'
    active.controller.abort()
    return true
  }

  function scan(options = {}) {
    const interfaceId = typeof options.interfaceId === 'string' ? options.interfaceId : ''
    const selectedSnapshot = inventory.get(interfaceId)
    if (!selectedSnapshot) return Promise.reject(Object.assign(new Error('Please refresh and select a valid interface'), { code: 'INVALID_INTERFACE' }))
    if (active) {
      if (active.interfaceId === interfaceId) return active.promise
      return Promise.reject(Object.assign(new Error('Another scan is already running'), { code: 'SCAN_BUSY' }))
    }

    // Never trust a stale UI inventory. Re-enumerate synchronously immediately
    // before scan creation and require an exact identity match.
    const freshInterfaces = listInterfacesFromNode(osApi)
    inventory = new Map(freshInterfaces.map((item) => [item.id, item]))
    const networkInterface = inventory.get(interfaceId)
    if (!exactInterfaceMatch(selectedSnapshot, networkInterface)) {
      return Promise.reject(Object.assign(new Error('Selected interface changed'), { code: 'INTERFACE_CHANGED' }))
    }
    if (networkInterface.requiresConfirmation && options.confirmRestrictedInterface !== true) {
      return Promise.reject(Object.assign(new Error('Restricted interface confirmation required'), { code: 'CONFIRMATION_REQUIRED' }))
    }

    const controller = new AbortController()
    // Up to twelve ping children legitimately observe the same cancellation
    // signal. Raise only this signal's listener allowance to avoid a false
    // EventTarget leak warning while retaining the hard concurrency cap.
    try { setMaxListeners(16, controller.signal) } catch { /* Node runtime fallback */ }
    const scanGeneration = ++generation
    const scanId = `scan-${scanGeneration}`
    const started = clock()
    const state = { interfaceId, controller, promise: null, abortReason: null }
    const timeout = setTimeout(() => {
      state.abortReason = 'timeout'
      controller.abort()
    }, scanTimeoutMs)
    const interfaceMonitor = setInterval(() => {
      const current = listInterfacesFromNode(osApi).find((item) => item.id === interfaceId)
      if (!exactInterfaceMatch(networkInterface, current)) {
        state.abortReason = 'interface-changed'
        controller.abort()
      }
    }, 500)
    const promise = (async () => {
      const warnings = []
      const errors = []
      let neighborWarningAdded = false
      const safeReadNeighbors = async () => {
        try {
          return await read(networkInterface, { signal: controller.signal })
        } catch {
          if (!neighborWarningAdded && !controller.signal.aborted) {
            warnings.push('系统邻居表暂不可用，结果将仅依据 ICMP 响应')
            neighborWarningAdded = true
          }
          return []
        }
      }
      const candidateResult = generateCandidates(networkInterface)
      if (candidateResult.truncated) warnings.push('网段较大，本次仅探测本机所在的 /24 范围（最多 254 个地址）')
      const firstNeighbors = await safeReadNeighbors()
      const probeResult = await probe({
        addresses: candidateResult.addresses,
        networkInterface,
        platform,
        run,
        signal: controller.signal,
        concurrency: 12,
        timeoutMs: 700,
        executableDependencies: dependencies.executableDependencies,
      })
      let secondNeighbors = []
      if (!controller.signal.aborted) secondNeighbors = await safeReadNeighbors()
      // probeHosts only records responses from children that completed before
      // cancellation; successful earlier responses remain valid evidence.
      let devices = mergeDevices(networkInterface, firstNeighbors, secondNeighbors, probeResult.responsive)
      if (!controller.signal.aborted && options.resolveHostnames === true) {
        devices = await hostnameEnricher(devices, { signal: controller.signal, concurrency: 8, timeoutMs: 400 })
      }
      const durationMs = Math.max(0, Math.round(clock() - started))
      const cancelled = controller.signal.aborted && state.abortReason === 'user'
      const interfaceChanged = controller.signal.aborted && state.abortReason === 'interface-changed'
      const timedOut = controller.signal.aborted && state.abortReason === 'timeout'
      if (timedOut) warnings.push('扫描达到 12 秒上限，已返回当前发现的部分结果')
      if (devices.length === 1 && !cancelled && !interfaceChanged) warnings.push('未发现其他设备；防火墙、访客网络或 AP 隔离可能阻止响应')
      return {
        scanId,
        status: cancelled || interfaceChanged ? 'cancelled' : timedOut ? 'partial' : 'completed',
        interface: networkInterface,
        devices,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date(clock()).toISOString(),
        durationMs,
        scannedHostCount: probeResult.scannedHostCount,
        truncated: candidateResult.truncated,
        warnings,
        errors: interfaceChanged
          ? [publicError('INTERFACE_CHANGED', '网络接口在扫描期间发生变化，扫描已取消')]
          : errors,
      }
    })().catch((error) => {
      if (controller.signal.aborted) {
        const interfaceChanged = state.abortReason === 'interface-changed'
        return {
          scanId,
          status: state.abortReason === 'user' || interfaceChanged ? 'cancelled' : 'partial',
          interface: networkInterface,
          devices: mergeDevices(networkInterface, [], [], new Set()),
          startedAt: new Date(started).toISOString(),
          finishedAt: new Date(clock()).toISOString(),
          durationMs: Math.max(0, Math.round(clock() - started)),
          scannedHostCount: 0,
          truncated: false,
          warnings: state.abortReason === 'user' || interfaceChanged ? [] : ['扫描达到时间上限，已停止剩余探测'],
          errors: interfaceChanged
            ? [publicError('INTERFACE_CHANGED', '网络接口在扫描期间发生变化，扫描已取消')]
            : [],
        }
      }
      return {
        scanId,
        status: 'partial',
        interface: networkInterface,
        devices: mergeDevices(networkInterface, [], [], new Set()),
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date(clock()).toISOString(),
        durationMs: Math.max(0, Math.round(clock() - started)),
        scannedHostCount: 0,
        truncated: false,
        warnings: [],
        errors: [publicError(error && error.code === 'UNSUPPORTED_PLATFORM' ? 'UNSUPPORTED_PLATFORM' : 'SCAN_FAILED', '扫描未能完整执行')],
      }
    }).finally(() => {
      clearTimeout(timeout)
      clearInterval(interfaceMonitor)
      if (active === state) active = null
    })
    state.promise = promise
    active = state
    return promise
  }

  return { listInterfaces, scan, cancelScan }
}

module.exports = { SCAN_TIMEOUT_MS, createLanScanner, mergeDevices }
