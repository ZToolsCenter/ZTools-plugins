'use strict'

const fs = require('node:fs/promises')
const { isUsableUnicast, subnetContains } = require('./interfaces.cjs')
const { normalizeMac } = require('./vendors.cjs')
const { resolveSystemExecutable } = require('./executables.cjs')

function cleanState(value) {
  const state = String(value || '').trim().toLowerCase().replace(/\s+/g, '-')
  if (['reachable', 'permanent'].includes(state)) return 'reachable'
  if (['stale', 'delay', 'probe'].includes(state)) return 'stale'
  return 'unknown'
}

function record(ip, mac, state = 'unknown', interfaceName = null, interfaceAddress = null) {
  const normalizedMac = normalizeMac(mac)
  if (!isUsableUnicast(ip) || !normalizedMac) return null
  return { ip, mac: normalizedMac, state: cleanState(state), interfaceName, interfaceAddress }
}

function parseMacArp(text) {
  const result = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([^\s]+)(?:\s+on\s+([^\s]+))?/i)
    if (!match || /incomplete/i.test(match[2])) continue
    const item = record(match[1], match[2], 'stale', match[3] || null)
    if (item) result.push(item)
  }
  return result
}

function parseLinuxProcArp(text) {
  const result = []
  const lines = String(text || '').trim().split(/\r?\n/).slice(1)
  for (const line of lines) {
    const columns = line.trim().split(/\s+/)
    const flags = Number.parseInt(columns[2], 16)
    if (columns.length < 6 || !Number.isFinite(flags) || (flags & 0x2) === 0) continue
    const item = record(columns[0], columns[3], 'stale', columns[5])
    if (item) result.push(item)
  }
  return result
}

function parseLinuxIpJson(text) {
  let values
  try { values = JSON.parse(String(text || '[]')) } catch { return [] }
  if (!Array.isArray(values)) values = [values]
  return values.flatMap((value) => {
    if (!value || ['FAILED', 'INCOMPLETE'].includes(String(value.state || '').toUpperCase())) return []
    const item = record(value.dst, value.lladdr, value.state, value.dev || null)
    return item ? [item] : []
  })
}

function parseWindowsArp(text) {
  const result = []
  let interfaceAddress = null
  for (const line of String(text || '').split(/\r?\n/)) {
    const header = line.match(/^\s*(?:[^:]+:\s*)?(\d{1,3}(?:\.\d{1,3}){3})\s+---/i)
    if (header) {
      interfaceAddress = isUsableUnicast(header[1]) ? header[1] : null
      continue
    }
    const match = line.match(/^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\S+)/i)
    if (!match || !interfaceAddress) continue
    // `arp -a` does not prove current reachability. Both dynamic and static
    // rows are passive evidence only and must not be labelled online.
    const item = record(match[1], match[2], 'stale', null, interfaceAddress)
    if (item) result.push(item)
  }
  return result
}

function filterNeighbors(items, networkInterface) {
  const deduped = new Map()
  for (const item of items || []) {
    if (!item || !subnetContains(networkInterface, item.ip)) continue
    if (item.interfaceName && item.interfaceName !== networkInterface.name) continue
    if (item.interfaceAddress && item.interfaceAddress !== networkInterface.address) continue
    const prior = deduped.get(item.ip)
    if (!prior || (prior.state !== 'reachable' && item.state === 'reachable')) deduped.set(item.ip, item)
  }
  return [...deduped.values()]
}

async function readNeighbors(platform, networkInterface, dependencies = {}) {
  const run = dependencies.run
  if (typeof run !== 'function') throw Object.assign(new Error('Neighbor command runner unavailable'), { code: 'NEIGHBOR_SOURCE_UNAVAILABLE' })
  try {
    if (platform === 'darwin') {
      const executable = resolveSystemExecutable(platform, 'arp', dependencies.executableDependencies)
      const output = await run(executable, ['-an', '-i', networkInterface.name], { timeoutMs: 2_000, signal: dependencies.signal })
      if (!output || (output.code !== 0 && !output.aborted)) throw new Error('arp failed')
      return filterNeighbors(parseMacArp(output.stdout), networkInterface)
    }
    if (platform === 'win32') {
      const executable = resolveSystemExecutable(platform, 'arp', dependencies.executableDependencies)
      const output = await run(executable, ['-a', '-N', networkInterface.address], { timeoutMs: 2_000, signal: dependencies.signal })
      if (!output || (output.code !== 0 && !output.aborted)) throw new Error('arp failed')
      const parsed = parseWindowsArp(output.stdout)
      const hasSelectedSection = parsed.some((item) => item.interfaceAddress === networkInterface.address)
        || new RegExp(`(?:^|\\n)\\s*(?:[^:]+:\\s*)?${networkInterface.address.replace(/\./g, '\\.')}\\s+---`, 'i').test(output.stdout)
      if (!hasSelectedSection) throw new Error('arp output did not prove selected interface binding')
      return filterNeighbors(parsed, networkInterface)
    }
    if (platform === 'linux') {
      try {
        const text = await (dependencies.readFile || fs.readFile)('/proc/net/arp', 'utf8')
        const parsed = filterNeighbors(parseLinuxProcArp(text), networkInterface)
        if (parsed.length) return parsed
      } catch { /* fall through to iproute2 */ }
      const executable = resolveSystemExecutable(platform, 'ip', dependencies.executableDependencies)
      const output = await run(executable, ['-j', 'neigh', 'show', 'dev', networkInterface.name], {
        timeoutMs: 2_000,
        signal: dependencies.signal,
      })
      if (!output || (output.code !== 0 && !output.aborted)) throw new Error('ip neigh failed')
      return filterNeighbors(parseLinuxIpJson(output.stdout), networkInterface)
    }
    throw new Error('unsupported platform')
  } catch (error) {
    if (dependencies.signal?.aborted) return []
    throw Object.assign(new Error('Neighbor table unavailable'), { code: 'NEIGHBOR_SOURCE_UNAVAILABLE', cause: error })
  }
}

module.exports = {
  filterNeighbors,
  parseLinuxIpJson,
  parseLinuxProcArp,
  parseMacArp,
  parseWindowsArp,
  readNeighbors,
}
