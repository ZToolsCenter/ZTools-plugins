'use strict'

const { isUsableUnicast, subnetContains } = require('./interfaces.cjs')
const { resolveSystemExecutable } = require('./executables.cjs')

const MAX_CONCURRENCY = 12
const DEFAULT_HOST_TIMEOUT_MS = 700

function pingInvocation(platform, ip, timeoutMs = DEFAULT_HOST_TIMEOUT_MS, networkInterface, dependencies = {}) {
  if (!isUsableUnicast(ip)) throw new TypeError('Invalid ICMP target')
  if (!networkInterface || !isUsableUnicast(networkInterface.address) || !subnetContains(networkInterface, ip)) {
    throw new TypeError('ICMP target is not bound to the selected interface')
  }
  const bounded = Math.min(2_000, Math.max(250, Math.round(timeoutMs)))
  const file = resolveSystemExecutable(platform, 'ping', dependencies)
  if (platform === 'win32') return { file, args: ['-n', '1', '-w', String(bounded), '-S', networkInterface.address, ip] }
  if (platform === 'darwin') return { file, args: ['-n', '-c', '1', '-W', String(bounded), '-S', networkInterface.address, ip] }
  if (platform === 'linux') return { file, args: ['-n', '-c', '1', '-W', String(Math.max(1, Math.ceil(bounded / 1000))), '-I', networkInterface.address, ip] }
  throw new Error('Unsupported platform')
}

async function probeHosts(options) {
  const {
    addresses = [],
    networkInterface,
    platform,
    run,
    signal,
    timeoutMs = DEFAULT_HOST_TIMEOUT_MS,
  } = options || {}
  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(options?.concurrency || MAX_CONCURRENCY)))
  const targets = addresses
    .filter((ip) => typeof ip === 'string' && subnetContains(networkInterface, ip))
    .slice(0, 254)
  const responsive = new Set()
  let scannedHostCount = 0
  let cursor = 0

  async function worker() {
    while (!signal?.aborted) {
      const index = cursor
      cursor += 1
      if (index >= targets.length) return
      const ip = targets[index]
      try {
        const invocation = pingInvocation(platform, ip, timeoutMs, networkInterface, options.executableDependencies)
        const output = await run(invocation.file, invocation.args, { timeoutMs: timeoutMs + 250, signal })
        scannedHostCount += 1
        if (!output.aborted && !output.timedOut && output.code === 0) responsive.add(ip)
      } catch {
        scannedHostCount += 1
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()))
  return { responsive, scannedHostCount }
}

module.exports = { DEFAULT_HOST_TIMEOUT_MS, MAX_CONCURRENCY, pingInvocation, probeHosts }
