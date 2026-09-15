'use strict'

const assert = require('node:assert/strict')
const { readFileSync, readdirSync, statSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const preloadRoot = path.resolve(__dirname, '..', 'public', 'preload')

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name)
    return statSync(target).isDirectory() ? files(target) : [target]
  })
}

test('preload performs no port scanning, remote HTTP, shell execution, or arbitrary command execution', () => {
  const source = files(preloadRoot)
    .filter((file) => /\.(?:c?js)$/.test(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|https?\.request)\s*\(/)
  assert.doesNotMatch(source, /\b(?:createConnection|new\s+net\.Socket|net\.connect)\s*\(/)
  assert.doesNotMatch(source, /\b(?:exec|execSync|spawnSync)\s*\(/)
  assert.doesNotMatch(source, /shell\s*:\s*true/)
  assert.doesNotMatch(source, /\b(?:nmap|masscan|nc|netcat|telnet)\b/i)
  assert.match(source, /shell:\s*false/)
})

test('active discovery is limited to ICMP ping adapters', () => {
  const source = readFileSync(path.join(preloadRoot, 'network', 'probe.cjs'), 'utf8')
    + readFileSync(path.join(preloadRoot, 'network', 'executables.cjs'), 'utf8')
  assert.match(source, /\['arp', 'ping'\]/)
  assert.match(source, /\/sbin\/ping/)
  assert.doesNotMatch(source, /(?:-p|--port|socket|service|vulnerab)/i)
})

test('all child process callsites resolve an absolute allowlisted executable', () => {
  const runner = readFileSync(path.join(preloadRoot, 'network', 'process-runner.cjs'), 'utf8')
  const adapters = readFileSync(path.join(preloadRoot, 'network', 'executables.cjs'), 'utf8')
  assert.match(runner, /path\.posix\.isAbsolute/)
  assert.match(runner, /path\.win32\.isAbsolute/)
  assert.match(adapters, /POSIX_ALLOWLIST/)
  assert.doesNotMatch(adapters, /process\.env\.PATH/)
})

test('local vendor data declares its public source and remains intentionally small', () => {
  const file = path.join(preloadRoot, 'data', 'oui.json')
  const data = JSON.parse(readFileSync(file, 'utf8'))
  assert.match(data.source, /IEEE Registration Authority/)
  assert.match(data.updatedAt, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(Object.keys(data.entries).length >= 20)
  assert.ok(statSync(file).size < 100 * 1024)
})
