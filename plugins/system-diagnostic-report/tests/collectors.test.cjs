'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  collectSystemReport,
  createEmptyReport,
  resolveTimeout
} = require('../public/preload/collectors/core.cjs')
const {
  normalizeDisplays,
  normalizeMemory,
  normalizeStorage,
  percentage
} = require('../public/preload/collectors/normalizers.cjs')
const { applyPrivacy, stripForbiddenFields } = require('../public/preload/privacy.cjs')

function fakeNodeOs(platform = 'darwin') {
  return {
    platform: () => platform,
    arch: () => platform === 'darwin' ? 'arm64' : 'x64',
    release: () => '24.5.0',
    totalmem: () => 16 * 1024 ** 3,
    freemem: () => 6 * 1024 ** 3,
    uptime: () => 12345,
    cpus: () => Array.from({ length: 8 }, () => ({ model: 'Fallback CPU', speed: 3200 }))
  }
}

function workingSystemInformation(overrides = {}) {
  return {
    osInfo: async () => ({
      platform: 'darwin', distro: 'macOS', release: '15.5', kernel: '24.5.0', arch: 'arm64', uefi: true
    }),
    system: async () => ({
      manufacturer: 'Example Corp', model: 'ExampleBook', version: '1', virtual: false,
      serial: 'MUST-NOT-LEAK', uuid: 'MUST-NOT-LEAK-EITHER'
    }),
    cpu: async () => ({
      manufacturer: 'Example', brand: 'Example M', physicalCores: 4, cores: 8, processors: 1, speed: 3.2
    }),
    mem: async () => ({ total: 16 * 1024 ** 3, used: 10 * 1024 ** 3, available: 6 * 1024 ** 3 }),
    fsSize: async () => [{
      fs: '/dev/disk1', type: 'apfs', mount: '/Users/alice/private',
      size: 500 * 1024 ** 3, used: 200 * 1024 ** 3, available: 300 * 1024 ** 3, use: 40, rw: true
    }],
    graphics: async () => ({
      controllers: [{ vendor: 'Example', model: 'Example GPU', vram: 8192 }],
      displays: [{ currentResX: 1920, currentResY: 1080, main: true }]
    }),
    battery: async () => ({
      hasBattery: true, isCharging: false, percent: 72, cycleCount: 42,
      designedCapacity: 5000, maxCapacity: 4500
    }),
    currentLoad: async () => ({ currentLoad: 12.34, currentLoadUser: 8, currentLoadSystem: 4.34 }),
    ...overrides
  }
}

function dependencies(si = workingSystemInformation()) {
  return {
    si,
    nodeOs: fakeNodeOs(),
    now: () => 0,
    getDisplays: async () => [{
      id: 987654,
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workArea: { x: 0, y: 0, width: 2560, height: 1380 },
      scaleFactor: 2,
      rotation: 0,
      colorDepth: 30
    }],
    getZToolsVersion: () => '6.2.1',
    processInfo: { versions: { node: '22.14.0', electron: '34.3.0' } }
  }
}

test('normalizers clamp percentages and derive stable memory/storage values', () => {
  assert.equal(percentage(105), 100)
  assert.equal(percentage(-3), 0)
  assert.equal(percentage('12.34'), 12.3)

  const memory = normalizeMemory({ total: 1000, used: 250, available: 750 })
  assert.deepEqual(memory, {
    totalBytes: 1000,
    availableBytes: 750,
    usedBytes: 250,
    usedPercent: 25,
    swapTotalBytes: null,
    swapUsedBytes: null,
    swapUsedPercent: null
  })

  assert.deepEqual(normalizeStorage([{ size: 100, used: 25, mount: '/', rw: false }])[0], {
    mount: 'system', filesystem: null, type: null, sizeBytes: 100, usedBytes: 25,
    availableBytes: 75, usedPercent: 25, readOnly: true
  })
})

test('storage normalizer selects only the canonical system volume on every platform', () => {
  const gib = 1024 ** 3
  const mac = normalizeStorage([
    { mount: '/', size: 100 * gib },
    { mount: '/System/Volumes/Data', size: 200 * gib },
    { mount: '/Volumes/Private', size: 300 * gib }
  ])
  const linux = normalizeStorage([
    { mount: '/home', size: 300 * gib },
    { mount: '/', size: 120 * gib }
  ])
  const windows = normalizeStorage([
    { mount: 'D:', size: 300 * gib },
    { mount: 'C:', size: 240 * gib }
  ])

  assert.equal(mac.length, 1)
  assert.equal(mac[0].mount, 'system')
  assert.equal(mac[0].sizeBytes, 200 * gib)
  assert.equal(linux[0].sizeBytes, 120 * gib)
  assert.equal(windows[0].sizeBytes, 240 * gib)
})

test('display normalizer keeps DIP bounds and reports physical HiDPI dimensions', () => {
  const [display] = normalizeDisplays([{
    bounds: { width: 2560, height: 1440 },
    workArea: { width: 2500, height: 1380 },
    scaleFactor: 2
  }])
  assert.equal(display.width, 5120)
  assert.equal(display.height, 2880)
  assert.equal(display.logicalWidth, 2560)
  assert.equal(display.logicalHeight, 1440)
  assert.equal(display.workAreaWidth, 5000)
  assert.equal(display.logicalWorkAreaWidth, 2500)

  const [directResolution] = normalizeDisplays([{
    bounds: { width: 960, height: 540 },
    currentResX: 1920,
    currentResY: 1080,
    scaleFactor: 2
  }])
  assert.equal(directResolution.width, 1920)
  assert.equal(directResolution.logicalWidth, 960)
})

test('empty report has the complete stable top-level schema and Node fallbacks', () => {
  const report = createEmptyReport({
    nodeOs: fakeNodeOs(), generatedAt: '1970-01-01T00:00:00.000Z',
    processInfo: { versions: { node: '22.14.0' } }
  })
  assert.deepEqual(Object.keys(report), [
    'overview', 'os', 'device', 'cpu', 'memory', 'storage', 'graphics', 'displays',
    'battery', 'runtime', 'performance', 'sources', 'warnings', 'errors', 'status'
  ])
  assert.equal(report.os.platform, 'darwin')
  assert.equal(report.cpu.cores, 8)
  assert.equal(report.memory.totalBytes, 16 * 1024 ** 3)
})

test('Node fallbacks preserve the stable schema on Windows and Linux', () => {
  for (const platform of ['win32', 'linux']) {
    const report = createEmptyReport({ nodeOs: fakeNodeOs(platform) })
    assert.equal(report.overview.schemaVersion, '1.0')
    assert.equal(report.overview.platform, platform)
    assert.equal(report.os.platform, platform)
    assert.equal(report.os.arch, 'x64')
    assert.equal(report.cpu.cores, 8)
    assert.deepEqual(report.storage, { devices: [] })
  }
})

test('collector assembles successful sources without forbidden identifiers', async () => {
  const report = await collectSystemReport({ privacy: 'safe' }, dependencies())
  assert.equal(report.status, 'ok')
  assert.equal(report.overview.generatedAt, '1970-01-01T00:00:00.000Z')
  assert.equal(report.cpu.brand, 'Example M')
  assert.equal(report.memory.usedPercent, 62.5)
  assert.equal(report.displays[0].width, 5120)
  assert.equal(report.displays[0].logicalWidth, 2560)
  assert.equal(report.battery.healthPercent, 90)
  assert.equal(report.sources.cpu.status, 'ok')

  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /MUST-NOT-LEAK/)
  assert.doesNotMatch(serialized, /987654/)
  assert.doesNotMatch(serialized, /\/Users\/alice/)
  assert.match(serialized, /"mount":"system"/)
})

test('collector uses allSettled degradation for failures and timeouts', async () => {
  const si = workingSystemInformation({
    cpu: async () => { throw new Error('/Users/private-user secret failure') },
    graphics: async () => new Promise(() => {})
  })
  const report = await collectSystemReport(
    { privacy: 'safe', timeoutMs: 12 },
    dependencies(si)
  )

  assert.equal(report.status, 'partial')
  assert.equal(report.cpu.brand, 'Fallback CPU')
  assert.equal(report.sources.cpu.status, 'unavailable')
  assert.equal(report.sources.graphics.status, 'timeout')
  assert.ok(report.errors.some((error) => error.source === 'cpu' && error.code === 'COLLECTOR_FAILED'))
  assert.ok(report.errors.some((error) => error.source === 'graphics' && error.code === 'COLLECTOR_TIMEOUT'))
  assert.equal(report.warnings.length, 0, 'collector failures must not be counted again as warnings')
  assert.doesNotMatch(JSON.stringify(report.errors), /private-user|secret failure/)
})

test('timed-out systeminformation probes stay single-flight until the underlying call settles', async () => {
  let resolveGraphics
  let graphicsCalls = 0
  const graphicsResult = new Promise((resolve) => { resolveGraphics = resolve })
  const si = workingSystemInformation({
    graphics: () => {
      graphicsCalls += 1
      return graphicsResult
    }
  })
  const collectorDependencies = dependencies(si)

  await collectSystemReport({ privacy: 'safe', timeoutMs: 10 }, collectorDependencies)
  await collectSystemReport({ privacy: 'safe', timeoutMs: 10 }, collectorDependencies)
  assert.equal(graphicsCalls, 1)

  resolveGraphics({ controllers: [], displays: [] })
  await new Promise((resolve) => setImmediate(resolve))
  await collectSystemReport({ privacy: 'safe', timeoutMs: 10 }, collectorDependencies)
  assert.equal(graphicsCalls, 2, 'a settled probe must be eligible for a fresh collection')
})

test('privacy helpers strip forbidden fields and minimal mode reduces fingerprinting', async () => {
  const stripped = stripForbiddenFields({
    hostname: 'private-host',
    nested: {
      username: 'alice',
      serialNumber: 'secret',
      message: 'contact me@example.com at 192.168.1.2 from /home/alice/project'
    }
  })
  assert.deepEqual(Object.keys(stripped), ['nested'])
  assert.doesNotMatch(JSON.stringify(stripped), /alice|example\.com|192\.168/)

  const report = await collectSystemReport({ privacy: 'safe' }, dependencies())
  const minimal = applyPrivacy(report, 'fingerprint-minimal')
  assert.equal(minimal.overview.privacy, 'fingerprint-minimal')
  assert.equal(minimal.device.model, null)
  assert.equal(minimal.cpu.brand, 'arm64 CPU')
  assert.equal(minimal.storage.devices[0].mount, '[redacted]')
  assert.equal(minimal.runtime.nodeVersion, '22')
  assert.equal(report.device.model, 'ExampleBook', 'privacy transformation must not mutate input')
})

test('timeout setting remains within audited bounds', () => {
  assert.equal(resolveTimeout(-1), 10)
  assert.equal(resolveTimeout(50_000), 30_000)
  assert.equal(resolveTimeout(undefined), 4_000)
})

test('health rules mark actionable resource warnings without failing collection', async () => {
  const report = await collectSystemReport({ privacy: 'safe' }, dependencies(workingSystemInformation({
    mem: async () => ({ total: 16 * 1024 ** 3, available: 1 * 1024 ** 3 }),
    fsSize: async () => [{ mount: '/', type: 'apfs', size: 500 * 1024 ** 3, available: 10 * 1024 ** 3 }],
    battery: async () => ({ hasBattery: true, percent: 65, designedCapacity: 5000, maxCapacity: 3500 }),
    currentLoad: async () => ({ currentLoad: 94, currentLoadUser: 70, currentLoadSystem: 24 })
  })))

  assert.equal(report.status, 'warning')
  assert.equal(report.memory.status, 'warning')
  assert.equal(report.storage.status, 'warning')
  assert.equal(report.battery.status, 'warning')
  assert.equal(report.performance.status, 'warning')
  assert.equal(report.warnings.length, 4)
})
