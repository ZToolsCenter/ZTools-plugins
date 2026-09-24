'use strict'

const fs = require('node:fs')
const path = require('node:path')

const POSIX_ALLOWLIST = Object.freeze({
  darwin: Object.freeze({ arp: ['/usr/sbin/arp'], ping: ['/sbin/ping'] }),
  linux: Object.freeze({
    ip: ['/usr/sbin/ip', '/sbin/ip', '/usr/bin/ip'],
    ping: ['/bin/ping', '/usr/bin/ping'],
  }),
})

function windowsRoot(environment = process.env) {
  const candidate = String(environment.SystemRoot || environment.WINDIR || '')
  const normalized = path.win32.normalize(candidate)
  return /^[A-Za-z]:\\Windows\\?$/i.test(normalized) ? normalized.replace(/\\$/, '') : 'C:\\Windows'
}

function resolveSystemExecutable(platform, tool, dependencies = {}) {
  if (platform === 'win32') {
    if (!['arp', 'ping'].includes(tool)) throw new Error('Executable is not allowlisted')
    return path.win32.join(windowsRoot(dependencies.environment), 'System32', `${tool.toUpperCase()}.EXE`)
  }
  const candidates = POSIX_ALLOWLIST[platform] && POSIX_ALLOWLIST[platform][tool]
  if (!candidates) throw new Error('Executable is not allowlisted')
  const exists = dependencies.existsSync || fs.existsSync
  return candidates.find((candidate) => {
    try { return exists(candidate) } catch { return false }
  }) || candidates[0]
}

module.exports = { POSIX_ALLOWLIST, resolveSystemExecutable, windowsRoot }
