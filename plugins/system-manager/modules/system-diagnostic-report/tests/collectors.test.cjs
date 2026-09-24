'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const {
  collectSystemReport,
  createEmptyReport,
  resolveTimeout,
  runWithTimeout
} = require('../public/preload/collectors/core.cjs')
const {
  normalizeDisplays,
  normalizeMemory,
  normalizeStorage,
  percentage
} = require('../public/preload/collectors/normalizers.cjs')
const {
  collectSystemVolumeStats,
  systemVolumeRoot
} = require('../public/preload/collectors/node-probes.cjs')
const {
  SYSTEM_INFORMATION_METHODS,
  isAllowedSystemInformationMethod,
  projectSystemInformationResult
} = require('../public/preload/collectors/systeminformation-protocol.cjs')
const {
  MAX_COMBINED_OUTPUT_BYTES,
  MAX_CONCURRENT_HELPERS,
  createSystemInformationProcessRunner,
  resolveWindowsTaskkillPath
} = require('../public/preload/collectors/systeminformation-process-client.cjs')
const { executeProbe } = require('../public/preload/collectors/systeminformation-helper.cjs')
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
      manufacturer: 'Example', brand: 'Example M', physicalCores: 4, cores: 8, processors: 1, speed: 3.2,
      serial: 'MUST-NOT-LEAK-FROM-CPU'
    }),
    mem: async () => ({ total: 16 * 1024 ** 3, used: 10 * 1024 ** 3, available: 6 * 1024 ** 3 }),
    fsSize: async () => [{
      fs: '/dev/disk1', type: 'apfs', mount: '/Users/alice/private',
      size: 500 * 1024 ** 3, used: 200 * 1024 ** 3, available: 300 * 1024 ** 3, use: 40, rw: true
    }],
    graphics: async () => ({
      controllers: [{ vendor: 'Example', model: 'Example GPU', vram: 8192, uuid: 'MUST-NOT-LEAK-GPU' }],
      displays: [{ currentResX: 1920, currentResY: 1080, main: true, deviceName: '/Users/alice/private' }]
    }),
    battery: async () => ({
      hasBattery: true, isCharging: false, percent: 72, cycleCount: 42,
      designedCapacity: 5000, maxCapacity: 4500
    }),
    currentLoad: async () => ({ currentLoad: 12.34, currentLoadUser: 8, currentLoadSystem: 4.34 }),
    ...overrides
  }
}

function dependencies(si = workingSystemInformation(), overrides = {}) {
  return {
    si,
    nodeOs: fakeNodeOs(),
    now: () => 0,
    getSystemVolumeStats: async () => [{
      mount: 'system', type: null,
      size: 500 * 1024 ** 3, used: 200 * 1024 ** 3, available: 300 * 1024 ** 3, rw: null
    }],
    getDisplays: async () => [{
      id: 987654,
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
      workArea: { x: 0, y: 0, width: 2560, height: 1380 },
      scaleFactor: 2,
      rotation: 0,
      colorDepth: 30
    }],
    getZToolsVersion: () => '6.2.1',
    processInfo: { versions: { node: '22.14.0', electron: '34.3.0' } },
    ...overrides
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
  assert.equal(report.sources.device.status, 'unavailable')
  assert.equal(report.sources.device.provider, 'not-collected')
  assert.equal(report.device.model, null)
  assert.equal(report.sources.storage.provider, 'node')

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
  assert.equal(report.cpu.brand, 'Example M', 'privacy transformation must not mutate input')
})

test('timeout setting remains within audited bounds', () => {
  assert.equal(resolveTimeout(-1), 10)
  assert.equal(resolveTimeout(50_000), 30_000)
  assert.equal(resolveTimeout(undefined), 4_000)
})

test('health rules mark actionable resource warnings without failing collection', async () => {
  const report = await collectSystemReport({ privacy: 'safe' }, dependencies(workingSystemInformation({
    mem: async () => ({ total: 16 * 1024 ** 3, available: 1 * 1024 ** 3 }),
    battery: async () => ({ hasBattery: true, percent: 65, designedCapacity: 5000, maxCapacity: 3500 }),
    currentLoad: async () => ({ currentLoad: 94, currentLoadUser: 70, currentLoadSystem: 24 })
  }), {
    getSystemVolumeStats: async () => [{
      mount: 'system', size: 500 * 1024 ** 3, available: 10 * 1024 ** 3
    }]
  }))

  assert.equal(report.status, 'warning')
  assert.equal(report.memory.status, 'warning')
  assert.equal(report.storage.status, 'warning')
  assert.equal(report.battery.status, 'warning')
  assert.equal(report.performance.status, 'warning')
  assert.equal(report.warnings.length, 4)
})

test('collector never calls broad identifier or mount-enumeration methods', async () => {
  let broadCalls = 0
  const broadProbe = async () => {
    broadCalls += 1
    throw new Error('broad probe must not run')
  }
  const report = await collectSystemReport({ privacy: 'safe' }, dependencies(workingSystemInformation({
    osInfo: broadProbe,
    system: broadProbe,
    fsSize: broadProbe
  })))

  assert.equal(broadCalls, 0)
  assert.equal(report.os.distro, null)
  assert.equal(report.os.codename, null)
  assert.equal(report.device.model, null)
  assert.equal(report.sources.device.status, 'unavailable')
  assert.equal(report.storage.devices.length, 1)
})

test('systeminformation protocol uses an exact allowlist and projects sensitive fields away', async () => {
  assert.deepEqual(SYSTEM_INFORMATION_METHODS, ['cpu', 'mem', 'graphics', 'battery', 'currentLoad'])
  assert.equal(isAllowedSystemInformationMethod('graphics'), true)
  assert.equal(isAllowedSystemInformationMethod('osInfo'), false)
  assert.equal(isAllowedSystemInformationMethod('system'), false)
  assert.equal(isAllowedSystemInformationMethod('fsSize'), false)
  assert.throws(
    () => projectSystemInformationResult('fsSize', []),
    (error) => error && error.code === 'METHOD_NOT_ALLOWED'
  )

  const projected = projectSystemInformationResult('graphics', {
    controllers: [{ vendor: 'Safe', model: 'GPU', serial: 'SECRET', uuid: 'SECRET' }],
    displays: [{ currentResX: 1920, currentResY: 1080, deviceName: '/Users/alice/Display' }]
  })
  assert.deepEqual(projected.controllers, [{
    vendor: 'Safe', model: 'GPU', bus: undefined, vram: undefined, vramDynamic: undefined
  }])
  assert.doesNotMatch(JSON.stringify(projected), /SECRET|alice|deviceName|serial|uuid/)

  let loaderCalls = 0
  await assert.rejects(
    executeProbe('osInfo', () => {
      loaderCalls += 1
      return {}
    }),
    (error) => error && error.code === 'METHOD_NOT_ALLOWED'
  )
  assert.equal(loaderCalls, 0, 'the helper must reject before loading the dependency')
})

function fakeChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

function completeFakeHelper(child, value = {}) {
  child.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, value })))
  child.emit('close', 0, null)
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('process helper enforces global concurrency and releases a slot only after the POSIX group is gone', async () => {
  assert.equal(MAX_CONCURRENT_HELPERS, 2)
  const children = []
  const goneGroups = new Set()
  const killedGroups = []
  const Spawn = () => {
    const child = fakeChild(41_000 + children.length)
    children.push(child)
    return child
  }
  const kill = (target, signalName) => {
    const group = Math.abs(target)
    if (signalName === 'SIGKILL') {
      killedGroups.push(group)
      return true
    }
    if (signalName === 0 && goneGroups.has(group)) {
      const error = new Error('group is gone')
      error.code = 'ESRCH'
      throw error
    }
    return true
  }
  const runner = createSystemInformationProcessRunner({
    Spawn,
    kill,
    processInfo: { platform: 'linux', execPath: '/usr/bin/node', env: {} }
  })
  const firstAbort = new AbortController()
  const first = runner('cpu', { signal: firstAbort.signal })
  const second = runner('mem')
  const third = runner('currentLoad')

  assert.equal(children.length, 2)
  const firstPid = children[0].pid
  firstAbort.abort(new Error('test timeout'))
  children[0].emit('close', null, 'SIGKILL')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(children.length, 2, 'close alone must not release the concurrency slot')
  assert.deepEqual(killedGroups, [firstPid])

  goneGroups.add(firstPid)
  await assert.rejects(first, /test timeout/)
  await waitFor(() => children.length === 3)

  completeFakeHelper(children[1])
  completeFakeHelper(children[2])
  await Promise.all([second, third])
})

test('process helper uses exact Windows taskkill tree arguments and a minimal environment', async () => {
  assert.equal(resolveWindowsTaskkillPath({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\taskkill.exe')
  for (const invalidRoot of [
    '\\\\server\\Windows',
    'C:/Windows',
    'C:\\Windows\\',
    'C:\\Windows\\..',
    'C:\\Other'
  ]) {
    assert.equal(resolveWindowsTaskkillPath({ SystemRoot: invalidRoot }), null)
  }

  const calls = []
  let targetChild
  const Spawn = (command, args, options) => {
    const isTaskkill = /taskkill\.exe$/i.test(command)
    const child = fakeChild(isTaskkill ? 55_001 : 55_000)
    calls.push({ command, args, options, child, isTaskkill })
    if (isTaskkill) setImmediate(() => child.emit('close', 0, null))
    else targetChild = child
    return child
  }
  const runner = createSystemInformationProcessRunner({
    Spawn,
    kill: () => { throw new Error('POSIX kill must not run on Windows') },
    processInfo: {
      platform: 'win32',
      execPath: 'C:\\Program Files\\ZTools\\ZTools.exe',
      env: {
        SystemRoot: 'C:\\Windows',
        SystemDrive: 'C:',
        HOME: 'MUST-NOT-PASS',
        NODE_OPTIONS: '--require hostile.cjs',
        PATH: 'C:\\untrusted'
      }
    }
  })

  const abortController = new AbortController()
  const reason = new Error('windows timeout')
  const probe = runner('graphics', { signal: abortController.signal })
  assert.ok(targetChild)
  abortController.abort(reason)
  let settled = false
  probe.then(() => { settled = true }, () => { settled = true })
  await nextTurn()
  assert.equal(settled, false, 'taskkill completion without target close must not settle')

  targetChild.emit('close', null, 'SIGKILL')
  await assert.rejects(probe, (error) => error === reason)
  assert.equal(calls.length, 2)
  const [helperCall, taskkillCall] = calls
  assert.equal(helperCall.command, 'C:\\Program Files\\ZTools\\ZTools.exe')
  assert.equal(helperCall.options.shell, false)
  assert.equal(helperCall.options.detached, false)
  assert.equal(helperCall.options.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(helperCall.options.env.HOME, undefined)
  assert.equal(helperCall.options.env.NODE_OPTIONS, undefined)
  assert.doesNotMatch(helperCall.options.env.PATH, /untrusted/i)
  assert.equal(taskkillCall.command, 'C:\\Windows\\System32\\taskkill.exe')
  assert.deepEqual(taskkillCall.args, ['/PID', '55000', '/T', '/F'])
  assert.equal(taskkillCall.options.shell, false)
  assert.equal(taskkillCall.options.detached, false)

  await assert.rejects(
    runner('fsSize'),
    (error) => error && error.code === 'METHOD_NOT_ALLOWED'
  )
  assert.equal(calls.length, 2, 'disallowed methods must not spawn a helper')
})

test('process helper kills the POSIX helper and grandchild before timeout settles', {
  skip: process.platform === 'win32'
}, async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-diagnostic-process-'))
  const pidFile = path.join(temporaryDirectory, 'pids.json')
  const fixture = path.join(__dirname, 'fixtures', 'blocking-process-tree.cjs')
  const spawnCalls = []
  let pids = null

  const Spawn = (command, args, options) => {
    spawnCalls.push({ command, args, options })
    return spawn(process.execPath, [fixture, pidFile], options)
  }
  const runner = createSystemInformationProcessRunner({
    Spawn,
    kill: process.kill.bind(process),
    processInfo: { platform: process.platform, execPath: process.execPath, env: {} }
  })

  try {
    await assert.rejects(
      runWithTimeout(
        'graphics',
        (signal) => runner('graphics', { signal }),
        150,
        Date.now,
        { awaitAbortSettlement: runner.waitsForProcessExit }
      ),
      (error) => error && error.code === 'COLLECTOR_TIMEOUT'
    )
    pids = JSON.parse(await fs.readFile(pidFile, 'utf8'))
    for (const pid of [pids.helperPid, pids.grandchildPid]) {
      assert.throws(
        () => process.kill(pid, 0),
        (error) => error && error.code === 'ESRCH',
        `PID ${pid} must be gone before timeout settles`
      )
    }
    assert.throws(
      () => process.kill(-pids.helperPid, 0),
      (error) => error && error.code === 'ESRCH',
      'the complete process group must be gone before timeout settles'
    )

    assert.equal(spawnCalls.length, 1)
    assert.equal(spawnCalls[0].command, process.execPath)
    assert.equal(spawnCalls[0].args[1], 'graphics')
    assert.equal(spawnCalls[0].options.shell, false)
    assert.equal(spawnCalls[0].options.detached, true)
    assert.deepEqual(Object.keys(spawnCalls[0].options.env).sort(), [
      'ELECTRON_RUN_AS_NODE', 'LANG', 'LC_ALL', 'NODE_NO_WARNINGS', 'PATH'
    ])
  } finally {
    if (pids && Number.isSafeInteger(pids.helperPid) && pids.helperPid > 0) {
      try { process.kill(-pids.helperPid, 'SIGKILL') } catch {}
    }
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
})

test('combined helper output has a hard limit and triggers confirmed group cleanup', async () => {
  const child = fakeChild(56_000)
  let groupGone = false
  let sigkillCalls = 0
  const runner = createSystemInformationProcessRunner({
    Spawn: () => child,
    kill: (target, signalName) => {
      assert.equal(target, -56_000)
      if (signalName === 'SIGKILL') {
        sigkillCalls += 1
        groupGone = true
        return
      }
      if (signalName === 0 && groupGone) {
        const error = new Error('gone')
        error.code = 'ESRCH'
        throw error
      }
    },
    processInfo: { platform: 'linux', execPath: '/usr/bin/node', env: {} }
  })

  const probe = runner('cpu')
  child.stdout.emit('data', Buffer.alloc(Math.floor(MAX_COMBINED_OUTPUT_BYTES / 2) + 1))
  child.stdout.emit('data', Buffer.alloc(Math.ceil(MAX_COMBINED_OUTPUT_BYTES / 2)))
  child.emit('close', null, 'SIGKILL')
  await assert.rejects(probe, (error) => error && error.code === 'COLLECTOR_FAILED')
  assert.equal(sigkillCalls, 1)
})

test('system volume probe targets one canonical root without mount enumeration', async () => {
  const targets = []
  const result = await collectSystemVolumeStats({
    processInfo: { platform: 'linux', execPath: '/usr/bin/node' },
    fsApi: {
      statfs: async (target) => {
        targets.push(target)
        return { bsize: 4096, blocks: 100, bfree: 40, bavail: 30 }
      }
    }
  })

  assert.deepEqual(targets, ['/'])
  assert.deepEqual(result, [{
    mount: 'system', size: 409600, used: 245760, available: 122880, type: null, rw: null
  }])
})

test('Windows system volume comes only from validated OS environment fields', async () => {
  assert.equal(systemVolumeRoot({
    platform: 'win32',
    execPath: 'D:\\Portable\\ZTools.exe',
    env: { SystemRoot: 'C:\\Windows' }
  }), 'C:\\')
  assert.equal(systemVolumeRoot({
    platform: 'win32',
    execPath: '\\\\server\\share\\ZTools.exe',
    env: { SystemDrive: 'C:' }
  }), 'C:\\')

  const targets = []
  await collectSystemVolumeStats({
    processInfo: {
      platform: 'win32',
      execPath: '\\\\server\\share\\ZTools.exe',
      env: { SystemRoot: 'C:\\Windows' }
    },
    fsApi: {
      statfs: async (target) => {
        targets.push(target)
        return { bsize: 1, blocks: 100, bfree: 40, bavail: 30 }
      }
    }
  })
  assert.deepEqual(targets, ['C:\\'])

  let statfsCalls = 0
  await assert.rejects(
    collectSystemVolumeStats({
      processInfo: {
        platform: 'win32',
        execPath: '\\\\server\\share\\ZTools.exe',
        env: { SystemDrive: '\\\\server', SystemRoot: '\\\\server\\Windows' }
      },
      fsApi: {
        statfs: async () => {
          statfsCalls += 1
          return {}
        }
      }
    }),
    (error) => error && error.code === 'SOURCE_UNAVAILABLE'
  )
  assert.equal(statfsCalls, 0, 'UNC and relative roots must be rejected before statfs')
})

const processClientModulePath = require.resolve(
  '../public/preload/collectors/systeminformation-process-client.cjs'
)
const originalProcessClientCacheEntry = require.cache[processClientModulePath]

async function withFreshProcessClient(callback) {
  delete require.cache[processClientModulePath]
  const freshClient = require(processClientModulePath)
  try {
    return await callback(freshClient)
  } finally {
    delete require.cache[processClientModulePath]
    if (originalProcessClientCacheEntry) {
      require.cache[processClientModulePath] = originalProcessClientCacheEntry
    }
  }
}

async function settleWithin(promise, timeoutMs = 1_000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('cleanup watchdog did not settle jobs')), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

test('Windows cleanup watchdog fail-closes on taskkill throw, nonzero exit, and no exit', async (t) => {
  for (const mode of ['throw', 'nonzero', 'no-exit']) {
    await t.test(mode, async () => withFreshProcessClient(async ({ createSystemInformationProcessRunner }) => {
      const helperChildren = []
      const spawnCalls = []
      const Spawn = (command, args, options) => {
        const taskkill = /taskkill\.exe$/i.test(command)
        spawnCalls.push({ command, args, options, taskkill })
        if (taskkill && mode === 'throw') throw new Error('taskkill unavailable')

        const child = fakeChild(taskkill ? 62_000 + spawnCalls.length : 61_000 + helperChildren.length)
        if (taskkill) {
          if (mode === 'nonzero') setImmediate(() => child.emit('close', 1, null))
          return child
        }
        helperChildren.push(child)
        return child
      }
      const runner = createSystemInformationProcessRunner({
        Spawn,
        kill: () => { throw new Error('POSIX kill must not run on Windows') },
        cleanupWatchdogMs: 40,
        processInfo: {
          platform: 'win32',
          execPath: 'C:\\Program Files\\ZTools\\ZTools.exe',
          env: { SystemRoot: 'C:\\Windows' }
        }
      })
      const abortController = new AbortController()
      const first = runner('cpu', { signal: abortController.signal })
      const second = runner('mem')
      const queued = runner('graphics')
      const allSettled = Promise.allSettled([first, second, queued])

      assert.equal(helperChildren.length, 2)
      let firstSettled = false
      first.then(() => { firstSettled = true }, () => { firstSettled = true })
      abortController.abort(new Error('cleanup test timeout'))
      helperChildren[0].emit('close', null, 'SIGKILL')
      await nextTurn()
      assert.equal(firstSettled, false, `${mode} taskkill must not count as confirmed cleanup`)

      const results = await settleWithin(allSettled)
      assert.ok(results.every((result) =>
        result.status === 'rejected' && result.reason && result.reason.name === 'HelperSchedulerUnavailableError'))
      assert.equal(helperChildren.length, 2, 'the queued job must never spawn after the fuse opens')
      const spawnCountAfterFuse = spawnCalls.length

      await assert.rejects(
        runner('battery'),
        (error) => error && error.name === 'HelperSchedulerUnavailableError'
      )
      assert.equal(helperChildren.length, 2, 'future jobs must not spawn after the fuse opens')
      assert.equal(spawnCalls.length, spawnCountAfterFuse, 'future jobs must not spawn any process after the fuse opens')
      assert.ok(spawnCalls.some((call) => call.taskkill), 'tree cleanup must be attempted before fail-closed')
    }))
  }
})

test('POSIX cleanup confirmation failure fuses running, queued, and future helper work', async () => {
  await withFreshProcessClient(async ({ createSystemInformationProcessRunner }) => {
    const helperChildren = []
    let killGroupCalls = 0
    let confirmCalls = 0
    const runner = createSystemInformationProcessRunner({
      Spawn: () => {
        const child = fakeChild(63_000 + helperChildren.length)
        helperChildren.push(child)
        return child
      },
      kill: (target, signalName) => {
        assert.ok(target < 0)
        if (signalName === 'SIGKILL') killGroupCalls += 1
        if (signalName === 0) confirmCalls += 1
        // Returning from signal 0 means the group still exists forever.
        return true
      },
      cleanupWatchdogMs: 40,
      processInfo: { platform: 'linux', execPath: '/usr/bin/node', env: {} }
    })
    const abortController = new AbortController()
    const first = runner('cpu', { signal: abortController.signal })
    const second = runner('mem')
    const queued = runner('currentLoad')
    const allSettled = Promise.allSettled([first, second, queued])

    assert.equal(helperChildren.length, 2)
    let firstSettled = false
    first.then(() => { firstSettled = true }, () => { firstSettled = true })
    abortController.abort(new Error('cleanup test timeout'))
    helperChildren[0].emit('close', null, 'SIGKILL')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(firstSettled, false, 'a live PGID must not be treated as confirmed cleanup')
    assert.ok(confirmCalls > 0)

    const results = await settleWithin(allSettled)
    assert.ok(results.every((result) =>
      result.status === 'rejected' && result.reason && result.reason.name === 'HelperSchedulerUnavailableError'))
    assert.ok(killGroupCalls >= 2, 'the fuse must best-effort terminate every active group')
    assert.equal(helperChildren.length, 2, 'queued work must not spawn after cleanup becomes unprovable')

    await assert.rejects(
      runner('battery'),
      (error) => error && error.name === 'HelperSchedulerUnavailableError'
    )
    assert.equal(helperChildren.length, 2, 'future work must remain fail-closed')
  })
})
