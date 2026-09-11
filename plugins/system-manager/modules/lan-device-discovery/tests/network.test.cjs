'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  addressScope,
  intToIPv4,
  interfaceKind,
  ipv4ToInt,
  listInterfacesFromNode,
  prefixFromNetmask,
  subnetContains,
} = require('../public/preload/network/interfaces.cjs')
const { generateCandidates, MAX_HOSTS } = require('../public/preload/network/subnet.cjs')
const {
  filterNeighbors,
  parseLinuxIpJson,
  parseLinuxProcArp,
  parseMacArp,
  parseWindowsArp,
  readNeighbors,
} = require('../public/preload/network/neighbors.cjs')
const { cleanHostname } = require('../public/preload/network/hostnames.cjs')
const { lookupVendor, normalizeMac } = require('../public/preload/network/vendors.cjs')
const { pingInvocation, probeHosts, MAX_CONCURRENCY } = require('../public/preload/network/probe.cjs')
const { createLanScanner, mergeDevices } = require('../public/preload/network/scanner.cjs')

const fixture = (name) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
const iface = {
  id: 'fixture', name: 'wlan0', address: '192.168.1.50', cidr: '192.168.1.50/24',
  prefixLength: 24, scope: 'private', kind: 'physical', requiresConfirmation: false, riskReason: null,
}

test('IPv4 helpers reject malformed values and preserve unsigned addresses', () => {
  assert.equal(ipv4ToInt('192.168.1.50'), 3232235826)
  assert.equal(intToIPv4(3232235826), '192.168.1.50')
  assert.equal(ipv4ToInt('999.1.1.1'), null)
  assert.equal(ipv4ToInt('1.2.3'), null)
  assert.equal(prefixFromNetmask('255.255.255.0'), 24)
  assert.equal(prefixFromNetmask('255.0.255.0'), null)
  assert.equal(addressScope('10.2.3.4'), 'private')
  assert.equal(addressScope('100.64.2.3'), 'shared')
})

test('interface inventory includes usable IPv4 only and creates stable opaque ids', () => {
  const os = { networkInterfaces: () => ({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0' }],
    en0: [
      { address: 'fe80::1', family: 'IPv6', internal: false, netmask: 'ffff:ffff::' },
      { address: '192.168.1.50', family: 'IPv4', internal: false, netmask: '255.255.255.0', cidr: '192.168.1.50/24' },
      { address: '169.254.2.1', family: 4, internal: false, netmask: '255.255.0.0' },
    ],
    vpn0: [{ address: '10.2.0.8', family: 4, internal: false, netmask: '255.255.255.0' }],
    public0: [{ address: '203.0.113.8', family: 4, internal: false, netmask: '255.255.255.0' }],
  }) }
  const values = listInterfacesFromNode(os)
  assert.equal(values.length, 2)
  assert.equal(values[0].address, '192.168.1.50')
  assert.match(values[0].id, /^[a-f0-9]{16}$/)
  assert.equal(values[0].cidr, '192.168.1.50/24')
})

test('Linux container and overlay interface names are restricted before scanning', () => {
  assert.equal(interfaceKind('cni0'), 'virtual')
  assert.equal(interfaceKind('flannel.1'), 'virtual')
  assert.equal(interfaceKind('podman0'), 'virtual')

  const os = { networkInterfaces: () => ({
    cni0: [{ address: '10.244.0.1', family: 4, internal: false, netmask: '255.255.0.0' }],
    'flannel.1': [{ address: '10.245.0.1', family: 'IPv4', internal: false, netmask: '255.255.0.0' }],
    podman0: [{ address: '10.88.0.1', family: 4, internal: false, netmask: '255.255.0.0' }],
    custom0: [{ address: '192.168.44.1', family: 4, internal: false, netmask: '255.255.255.0' }],
  }) }
  const values = Object.fromEntries(listInterfacesFromNode(os).map((item) => [item.name, item]))
  for (const name of ['cni0', 'flannel.1', 'podman0']) {
    assert.equal(values[name].kind, 'virtual', name)
    assert.equal(values[name].requiresConfirmation, true, name)
    assert.equal(values[name].riskReason, '虚拟或桥接接口', name)
  }
  assert.equal(values.custom0.kind, 'physical')
  assert.equal(values.custom0.requiresConfirmation, true)
  assert.equal(values.custom0.riskReason, '无法确认接口类型，扫描前需确认')
})

test('subnet candidates are bounded and broad networks are reduced to local /24', () => {
  const normal = generateCandidates(iface)
  assert.equal(normal.addresses.length, 253)
  assert.equal(normal.addresses.includes('192.168.1.50'), false)
  assert.equal(normal.addresses.includes('192.168.1.0'), false)
  assert.equal(normal.addresses.includes('192.168.1.255'), false)
  assert.equal(normal.truncated, false)

  const broad = generateCandidates({ ...iface, prefixLength: 16, cidr: '192.168.1.50/16' })
  assert.equal(broad.addresses.length <= MAX_HOSTS, true)
  assert.equal(broad.scanPrefixLength, 24)
  assert.equal(broad.truncated, true)
  assert.ok(broad.addresses.every((ip) => ip.startsWith('192.168.1.')))

  assert.deepEqual(generateCandidates({ ...iface, prefixLength: 32 }).addresses, [])
  assert.equal(generateCandidates({ ...iface, address: '192.168.1.0', prefixLength: 31 }).addresses[0], '192.168.1.1')
  assert.equal(subnetContains(iface, '192.168.1.240'), true)
  assert.equal(subnetContains(iface, '192.168.2.1'), false)
})

test('macOS neighbor fixture rejects incomplete and other-interface rows', () => {
  const values = filterNeighbors(parseMacArp(fixture('macos-arp.txt')), { ...iface, name: 'en0' })
  assert.deepEqual(values.map((item) => item.ip), ['192.168.1.1', '192.168.1.20'])
  assert.equal(values[0].mac, '3C:22:FB:AA:BB:CC')
})

test('Linux proc and iproute fixtures reject failed/incomplete entries', () => {
  const proc = filterNeighbors(parseLinuxProcArp(fixture('linux-proc-arp.txt')), iface)
  assert.deepEqual(proc.map((item) => item.ip), ['192.168.1.1', '192.168.1.22'])
  const json = filterNeighbors(parseLinuxIpJson(fixture('linux-ip-neigh.json')), iface)
  assert.deepEqual(json.map((item) => [item.ip, item.state]), [
    ['192.168.1.1', 'reachable'],
    ['192.168.1.40', 'stale'],
  ])
})

test('Windows neighbor fixture handles English/Chinese sections without trusting broadcast MAC', () => {
  const values = filterNeighbors(parseWindowsArp(fixture('windows-arp.txt')), iface)
  assert.deepEqual(values.map((item) => item.ip), ['192.168.1.1', '192.168.1.61'])
})

test('Windows overlapping CIDR sections retain only the exactly selected source interface', () => {
  const values = filterNeighbors(parseWindowsArp(fixture('windows-overlap-arp.txt')), iface)
  assert.deepEqual(values.map((item) => item.ip), ['192.168.1.10'])
  assert.equal(values[0].interfaceAddress, iface.address)
})

test('Windows neighbor command binds -N to the selected address and validates its output section', async () => {
  let invocation
  const values = await readNeighbors('win32', iface, {
    run: async (file, args) => {
      invocation = { file, args }
      return { code: 0, aborted: false, stdout: fixture('windows-overlap-arp.txt') }
    },
    executableDependencies: { environment: { SystemRoot: 'D:\\Windows' } },
  })
  assert.deepEqual(invocation, {
    file: 'D:\\Windows\\System32\\ARP.EXE',
    args: ['-a', '-N', iface.address],
  })
  assert.deepEqual(values.map((item) => item.ip), ['192.168.1.10'])

  await assert.rejects(readNeighbors('win32', iface, {
    run: async () => ({ code: 0, aborted: false, stdout: 'Interface: 192.168.1.60 --- 0x9\n' }),
  }), (error) => error.code === 'NEIGHBOR_SOURCE_UNAVAILABLE')
})

test('vendor lookup normalizes addresses and distinguishes randomized MACs', () => {
  assert.equal(normalizeMac('b8-27-eb-01-02-03'), 'B8:27:EB:01:02:03')
  assert.equal(lookupVendor('b8:27:eb:01:02:03'), 'Raspberry Pi')
  assert.equal(lookupVendor('02:11:22:33:44:55'), '随机或本地管理地址')
  assert.equal(lookupVendor('ff:ff:ff:ff:ff:ff'), null)
  assert.equal(lookupVendor('00:11:22:33:44:55'), null)
})

test('hostname sanitizer strips controls, trailing dot and caps length', () => {
  assert.equal(cleanHostname(' printer.local.\u0000 '), 'printer.local')
  assert.equal(cleanHostname('x'.repeat(300)).length, 253)
  assert.equal(cleanHostname('  '), null)
})

test('ping adapters use fixed executables and argument arrays only', () => {
  const executableDependencies = { existsSync: () => true, environment: {} }
  assert.deepEqual(pingInvocation('win32', '192.168.1.1', 700, iface, executableDependencies), {
    file: 'C:\\Windows\\System32\\PING.EXE',
    args: ['-n', '1', '-w', '700', '-S', iface.address, '192.168.1.1'],
  })
  assert.deepEqual(pingInvocation('darwin', '192.168.1.1', 700, iface, executableDependencies), {
    file: '/sbin/ping', args: ['-n', '-c', '1', '-W', '700', '-S', iface.address, '192.168.1.1'],
  })
  assert.deepEqual(pingInvocation('linux', '192.168.1.1', 700, iface, executableDependencies), {
    file: '/bin/ping', args: ['-n', '-c', '1', '-W', '1', '-I', iface.address, '192.168.1.1'],
  })
  assert.throws(() => pingInvocation('linux', '192.168.1.1; rm -rf x', 700, iface), /Invalid/)
  assert.throws(() => pingInvocation('linux', '10.0.0.1', 700, iface), /not bound/)
})

test('probe scheduler enforces concurrency <=12 and excludes out-of-subnet targets', async () => {
  let active = 0
  let peak = 0
  const seen = []
  const addresses = Array.from({ length: 40 }, (_, index) => `192.168.1.${index + 1}`).concat('10.0.0.1')
  const run = async (_file, args) => {
    active += 1
    peak = Math.max(peak, active)
    seen.push(args.at(-1))
    await new Promise((resolve) => setTimeout(resolve, 2))
    active -= 1
    return { code: 0, aborted: false, timedOut: false }
  }
  const output = await probeHosts({ addresses, networkInterface: iface, platform: 'linux', run, concurrency: 99 })
  assert.equal(peak <= MAX_CONCURRENCY, true)
  assert.equal(seen.includes('10.0.0.1'), false)
  assert.equal(output.responsive.size, 40)
})

test('probe cancellation stops scheduling new work', async () => {
  const controller = new AbortController()
  let calls = 0
  const run = async () => {
    calls += 1
    if (calls === 1) controller.abort()
    return { code: 1, aborted: true, timedOut: false }
  }
  const output = await probeHosts({
    addresses: Array.from({ length: 100 }, (_, index) => `192.168.1.${index + 1}`),
    networkInterface: iface,
    platform: 'linux',
    run,
    signal: controller.signal,
    concurrency: 12,
  })
  assert.equal(calls <= 12, true)
  assert.equal(output.responsive.size, 0)
})

test('probe keeps confirmed pre-cancel responses and rejects late child results', async () => {
  const controller = new AbortController()
  let calls = 0
  const output = await probeHosts({
    addresses: ['192.168.1.1', '192.168.1.2'],
    networkInterface: iface,
    platform: 'linux',
    signal: controller.signal,
    concurrency: 1,
    run: async () => {
      calls += 1
      if (calls === 1) return { code: 0, aborted: false, timedOut: false }
      controller.abort()
      return { code: 0, aborted: true, timedOut: false }
    },
  })
  assert.deepEqual([...output.responsive], ['192.168.1.1'])
})

test('device merge represents evidence without calling ICMP failure offline', () => {
  const devices = mergeDevices(
    iface,
    [{ ip: '192.168.1.1', mac: '50:C7:BF:11:22:33', state: 'stale' }],
    [{ ip: '192.168.1.2', mac: '00:15:5D:11:22:33', state: 'reachable' }],
    new Set(['192.168.1.3']),
  )
  assert.deepEqual(devices.map((item) => [item.ip, item.onlineStatus]), [
    ['192.168.1.1', 'recently-seen'],
    ['192.168.1.2', 'online'],
    ['192.168.1.3', 'online'],
    ['192.168.1.50', 'online'],
  ])
  assert.equal(devices[0].vendor, 'TP-Link')
  assert.equal('__mac' in devices[0], false)
})

test('scanner is user-triggered, validates interface ids and coalesces same-interface scans', async () => {
  let probeCalls = 0
  let release
  const deferred = new Promise((resolve) => { release = resolve })
  const scanner = createLanScanner({
    platform: 'linux',
    nodeOs: { networkInterfaces: () => ({ wlan0: [{ family: 'IPv4', internal: false, address: iface.address, netmask: '255.255.255.0' }] }) },
    readNeighbors: async () => [],
    probeHosts: async () => { probeCalls += 1; await deferred; return { responsive: new Set(), scannedHostCount: 253 } },
    enrichHostnames: async (values) => values,
    clock: () => 1_000,
  })
  assert.equal(probeCalls, 0, 'listing interfaces must never start a scan')
  const [networkInterface] = await scanner.listInterfaces()
  await assert.rejects(scanner.scan({ interfaceId: 'attacker-controlled' }), (error) => error.code === 'INVALID_INTERFACE')
  const first = scanner.scan({ interfaceId: networkInterface.id })
  const second = scanner.scan({ interfaceId: networkInterface.id })
  assert.equal(first, second)
  assert.equal(probeCalls, 0, 'probe begins asynchronously')
  release()
  const output = await first
  assert.equal(probeCalls, 1)
  assert.equal(output.status, 'completed')
})

test('scanner cancel propagates abort and reports cancelled', async () => {
  let capturedSignal
  const scanner = createLanScanner({
    platform: 'linux',
    nodeOs: { networkInterfaces: () => ({ wlan0: [{ family: 'IPv4', internal: false, address: iface.address, netmask: '255.255.255.0' }] }) },
    readNeighbors: async () => [],
    probeHosts: async ({ signal }) => {
      capturedSignal = signal
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      return { responsive: new Set(), scannedHostCount: 1 }
    },
    enrichHostnames: async (values) => values,
  })
  const [networkInterface] = await scanner.listInterfaces()
  const flight = scanner.scan({ interfaceId: networkInterface.id })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(scanner.cancelScan(), true)
  const result = await flight
  assert.equal(capturedSignal.aborted, true)
  assert.equal(result.status, 'cancelled')
  assert.equal(scanner.cancelScan(), false)
})

test('scanner global deadline aborts work and returns a partial safe snapshot', async () => {
  const scanner = createLanScanner({
    platform: 'linux',
    scanTimeoutMs: 10,
    nodeOs: { networkInterfaces: () => ({ wlan0: [{ family: 'IPv4', internal: false, address: iface.address, netmask: '255.255.255.0' }] }) },
    readNeighbors: async () => [],
    probeHosts: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      return { responsive: new Set(), scannedHostCount: 4 }
    },
    enrichHostnames: async (values) => values,
  })
  const [networkInterface] = await scanner.listInterfaces()
  const result = await scanner.scan({ interfaceId: networkInterface.id })
  assert.equal(result.status, 'partial')
  assert.ok(result.warnings.some((warning) => warning.includes('12 秒')))
})

test('scanner re-enumerates immediately and rejects a stale selected interface identity', async () => {
  let calls = 0
  const scanner = createLanScanner({
    platform: 'linux',
    nodeOs: { networkInterfaces: () => {
      calls += 1
      const address = calls === 1 ? iface.address : '192.168.1.51'
      return { wlan0: [{ family: 'IPv4', internal: false, address, netmask: '255.255.255.0' }] }
    } },
    readNeighbors: async () => [],
    probeHosts: async () => ({ responsive: new Set(), scannedHostCount: 0 }),
  })
  const [selected] = await scanner.listInterfaces()
  await assert.rejects(scanner.scan({ interfaceId: selected.id }), (error) => error.code === 'INTERFACE_CHANGED')
})

test('scanner cancels an active scan when the exact interface identity changes', async () => {
  let calls = 0
  const scanner = createLanScanner({
    platform: 'linux',
    scanTimeoutMs: 2_000,
    nodeOs: { networkInterfaces: () => {
      calls += 1
      const address = calls <= 2 ? iface.address : '192.168.1.51'
      return { wlan0: [{ family: 'IPv4', internal: false, address, netmask: '255.255.255.0' }] }
    } },
    readNeighbors: async () => [],
    probeHosts: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      return { responsive: new Set(), scannedHostCount: 2 }
    },
  })
  const [selected] = await scanner.listInterfaces()
  const result = await scanner.scan({ interfaceId: selected.id })
  assert.equal(result.status, 'cancelled')
  assert.deepEqual(result.errors, [{ code: 'INTERFACE_CHANGED', message: '网络接口在扫描期间发生变化，扫描已取消' }])
})

test('virtual, VPN and CGNAT interfaces require an explicit second confirmation', async () => {
  const scanner = createLanScanner({
    platform: 'linux',
    nodeOs: { networkInterfaces: () => ({
      bridge0: [{ family: 'IPv4', internal: false, address: '192.168.2.1', netmask: '255.255.255.0' }],
    }) },
    readNeighbors: async () => [],
    probeHosts: async () => ({ responsive: new Set(), scannedHostCount: 0 }),
    enrichHostnames: async (values) => values,
  })
  const [selected] = await scanner.listInterfaces()
  assert.equal(selected.kind, 'virtual')
  assert.equal(selected.requiresConfirmation, true)
  await assert.rejects(scanner.scan({ interfaceId: selected.id }), (error) => error.code === 'CONFIRMATION_REQUIRED')
  const result = await scanner.scan({ interfaceId: selected.id, confirmRestrictedInterface: true })
  assert.equal(result.status, 'completed')
})
