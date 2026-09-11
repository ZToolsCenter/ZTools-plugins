'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const darwin = require('../public/preload/platform/darwin.cjs')
const win32 = require('../public/preload/platform/win32.cjs')
const linux = require('../public/preload/platform/linux.cjs')
const { MAX_METADATA_BYTES } = require('../public/preload/core/bounded-file.cjs')
const { MAX_INPUT_BYTES, runFile } = require('../public/preload/core/runner.cjs')

const fixtures = path.join(__dirname, 'fixtures')

test('macOS parses Info.plist JSON through fixed plutil invocation', async () => {
  const expected = JSON.parse(fs.readFileSync(path.join(fixtures, 'darwin', 'info.json'), 'utf8'))
  let invocation
  const value = await darwin.readPlist('/Applications/Acme.app/Contents/Info.plist', async (...args) => {
    invocation = args
    return { stdout: JSON.stringify(expected) }
  })
  assert.equal(value.CFBundleIdentifier, 'io.acme.Editor')
  assert.deepEqual(invocation[0], '/usr/bin/plutil')
  assert.deepEqual(invocation[1], ['-convert', 'json', '-o', '-', '/Applications/Acme.app/Contents/Info.plist'])
  const specs = darwin.residualSpecs({ name: 'Acme Editor', bundleId: 'io.acme.Editor' }, '/Users/tester')
  assert.ok(specs.some(([, item]) => item.endsWith('Preferences/io.acme.Editor.plist')))
  assert.ok(specs.every(([, item]) => !item.includes('*')))
})

test('macOS rejects oversized or linked Info.plist before launching plutil', async () => {
  for (const info of [
    { size: MAX_METADATA_BYTES + 1, isFile: () => true, isSymbolicLink: () => false },
    { size: 10, isFile: () => true, isSymbolicLink: () => true },
  ]) {
    let calls = 0
    const warnings = []
    const value = await darwin.readPlist('/Users/tester/Applications/Bad.app/Contents/Info.plist', async () => { calls += 1 }, warnings, 4_000, { lstat: async () => info })
    assert.deepEqual(value, {})
    assert.equal(calls, 0)
    assert.equal(warnings.length, 1)
  }
})

test('macOS plutil parses the bytes captured from the verified file handle', async () => {
  const plist = Buffer.from('{"CFBundleIdentifier":"io.acme.Safe"}')
  const events = []
  let invocation
  const info = { size: plist.length, dev: 1, ino: 2, mtimeMs: 3, isFile: () => true, isSymbolicLink: () => false }
  const fileSystem = {
    async lstat() { events.push('lstat'); return info },
    async readFile() { assert.fail('path-based fallback must not run') },
    async open(file, flags) {
      events.push(`open:${file}:${flags}`)
      return {
        async stat() { events.push('stat'); return info },
        async read(buffer, offset, length, position) {
          events.push(`read:${position}`)
          const bytesRead = Math.min(length, plist.length - position)
          if (bytesRead > 0) plist.copy(buffer, offset, position, position + bytesRead)
          return { bytesRead, buffer }
        },
        async close() { events.push('close') },
      }
    },
  }
  const result = await darwin.readPlist('/Users/test/Applications/Safe.app/Contents/Info.plist', async (...args) => {
    events.push('plutil')
    invocation = args
    return { stdout: plist.toString('utf8') }
  }, null, 4_000, fileSystem)

  assert.equal(result.CFBundleIdentifier, 'io.acme.Safe')
  assert.deepEqual(invocation[1], ['-convert', 'json', '-o', '-', '-'])
  assert.deepEqual(invocation[2].input, plist)
  assert.deepEqual(events, [
    'lstat',
    'open:/Users/test/Applications/Safe.app/Contents/Info.plist:r',
    'stat',
    'read:0',
    `read:${plist.length}`,
    'stat',
    'close',
    'plutil',
  ])
})

test('process runner pipes bounded captured input without a shell', async () => {
  const result = await runFile(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { encoding: 'utf8', input: 'captured plist' })
  assert.equal(result.stdout, 'captured plist')
  await assert.rejects(runFile(process.execPath, ['-e', ''], { input: Buffer.alloc(MAX_INPUT_BYTES + 1) }), /safe limit/)
})

test('macOS system plutil accepts the verified plist bytes on stdin', { skip: process.platform !== 'darwin' }, async () => {
  const xml = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.acme.Stdin</string></dict></plist>')
  const result = await runFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { encoding: 'utf8', input: xml, timeout: 4_000, maxBuffer: 1024 * 1024 })
  assert.equal(JSON.parse(result.stdout).CFBundleIdentifier, 'io.acme.Stdin')
})

test('Windows registry fixture is inventory-only and never enables declared uninstall commands', () => {
  const entries = JSON.parse(fs.readFileSync(path.join(fixtures, 'windows', 'registry.json'), 'utf8'))
  const apps = win32.registryEntriesToApps(entries, 'test-secret')
  assert.equal(apps.length, 2)
  assert.equal(apps[0].name, 'Acme Editor')
  assert.equal(apps[0].uninstall.supported, false)
  assert.equal(apps[0].uninstall.mode, 'manual')
  assert.equal(Object.hasOwn(apps[0], 'rawUninstallCommand'), false)
  assert.equal(apps[1].uninstall.mode, 'manual')
  assert.equal(apps[1].uninstall.requiresElevation, true)
})

test('Windows collector does not ingest mutable uninstall command payloads', () => {
  assert.doesNotMatch(win32.REGISTRY_SCRIPT, /UninstallString|QuietUninstallString/)
  assert.match(win32.REGISTRY_SCRIPT, /\$origin=\$_\.Path.*Origin=\$origin/s)
  assert.match(win32.REGISTRY_SCRIPT, /Select-Object -First 5001/)
  assert.equal(typeof win32.parseRegisteredCommand, 'undefined')
})

test('Windows registry consumer caps sentinel rows before app retention and sorting', async () => {
  const origin = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  const entries = Array.from({ length: win32.MAX_REGISTRY_ROWS + 100 }, (_, index) => ({
    Origin: origin,
    Key: `App-${index}`,
    DisplayName: `App ${String(index).padStart(5, '0')}`,
  }))
  assert.equal(win32.registryEntriesToApps(entries, 'test-secret').length, win32.MAX_PLATFORM_APPS)

  const result = await win32.scanApps({
    env: { SystemRoot: 'C:\\Windows' },
    secret: 'test-secret',
    execFile: async () => ({ stdout: JSON.stringify(entries) }),
  })
  assert.equal(result.apps.length, win32.MAX_PLATFORM_APPS)
  assert.ok(result.warnings.some((warning) => warning.includes(`安全上限 ${win32.MAX_PLATFORM_APPS}`)))
})

test('Windows registry identity includes exact origin and raw subkey', () => {
  const native = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  const wow = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  const apps = win32.registryEntriesToApps([
    { Origin: native, Key: 'Shared Key', DisplayName: 'Native' },
    { Origin: wow, Key: 'Shared Key', DisplayName: 'WOW64' },
    { Origin: native, Key: 'Shared  Key', DisplayName: 'Whitespace-distinct' },
  ], 'secret')
  assert.equal(apps.length, 3)
  assert.equal(new Set(apps.map((app) => app.id)).size, 3)
})

test('Windows residual roots are fixed under the trusted home, not environment redirects', async () => {
  const checked = []
  await win32.inspectApp({ appKey: 'Acme', name: 'Acme' }, {
    home: 'C:\\Users\\demo',
    env: { LOCALAPPDATA: 'C:\\Users\\demo\\Documents', APPDATA: 'C:\\Users\\demo\\Pictures' },
    fs: { async lstat(target) { checked.push(target); throw Object.assign(new Error('missing'), { code: 'ENOENT' }) } },
  })
  assert.deepEqual(checked, [
    'C:\\Users\\demo\\AppData\\Local\\Acme',
    'C:\\Users\\demo\\AppData\\Roaming\\Acme',
  ])
})

test('Windows scan uses absolute System32 PowerShell and a controlled PATH', async () => {
  let invocation
  const env = {
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\attacker',
    Path: 'C:\\also-attacker',
    windir: 'D:\\fake-windows',
    PSModulePath: 'C:\\Users\\demo\\Documents\\Modules',
    KEEP_ME: 'yes',
  }
  const result = await win32.scanApps({
    env,
    secret: 'test-secret',
    execFile: async (...args) => { invocation = args; return { stdout: '[]' } },
  })
  assert.deepEqual(result, { apps: [], warnings: [] })
  assert.equal(invocation[0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.deepEqual(invocation[1].slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
  assert.equal(invocation[2].timeout, 12000)
  assert.equal(invocation[2].maxBuffer, 8 * 1024 * 1024)
  assert.equal(invocation[2].windowsHide, true)
  assert.equal(invocation[2].env.PATH, 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0')
  assert.equal(invocation[2].env.Path, undefined)
  assert.equal(invocation[2].env.SystemRoot, 'C:\\Windows')
  assert.equal(invocation[2].env.WINDIR, 'C:\\Windows')
  assert.equal(invocation[2].env.PSModulePath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules')
  assert.equal(invocation[2].env.KEEP_ME, 'yes')
})

test('malicious SystemRoot and polluted PATH cannot choose the scan executable', async () => {
  const invalidRoots = [
    '', 'Windows', 'C:/Windows', 'C:\\Windows\\', 'C:\\Windows\\..\\Temp',
    'C:\\Windows\\System32', '\\\\server\\share\\Windows', '\\\\?\\C:\\Windows',
  ]
  for (const SystemRoot of invalidRoots) {
    let calls = 0
    const result = await win32.scanApps({
      env: { SystemRoot, PATH: 'C:\\attacker', Path: 'C:\\attacker-two' },
      secret: 'x',
      execFile: async () => { calls += 1; return { stdout: '[]' } },
    })
    assert.equal(calls, 0, SystemRoot)
    assert.deepEqual(result.apps, [])
    assert.ok(result.warnings[0].includes('PowerShell'))
  }
  assert.equal(win32.resolveSystemRoot({ SystemRoot: 'D:\\Windows' }), 'D:\\Windows')
})

test('all metadata-derived residuals require explicit selection', async () => {
  const app = { id: 'app', name: 'Helper', bundleId: 'io.acme.Helper', install: { path: '/Applications/Helper.app', scope: 'system' }, protected: false }
  const candidates = await darwin.inspectApp(app, { home: '/Users/tester', fs: { lstat: async () => ({}) } })
  const exact = candidates.filter((item) => item.confidence === 'exact' && item.category !== 'application')
  const inferred = candidates.filter((item) => item.confidence === 'strong')
  assert.ok(exact.length > 0)
  assert.ok(inferred.length > 0)
  assert.ok(exact.every((item) => !item.selectedByDefault && item.reason.includes('应用声明')))
  assert.ok(inferred.every((item) => !item.selectedByDefault && item.reason.includes('同名应用')))
})

test('Linux parses AppImage and Flatpak desktop fixtures without turning metadata into commands', () => {
  const appImage = linux.parseDesktop(fs.readFileSync(path.join(fixtures, 'linux', 'acme.desktop'), 'utf8'))
  assert.equal(appImage.Name, 'Acme Editor')
  assert.equal(linux.commandToken(appImage.Exec), '/home/tester/Applications/Acme.AppImage')
  const flatpak = linux.parseDesktop(fs.readFileSync(path.join(fixtures, 'linux', 'flatpak.desktop'), 'utf8'))
  assert.equal(flatpak['X-Flatpak'], 'io.acme.Notes')
  assert.equal(typeof linux.uninstallCommand, 'undefined')
})

test('desktop and platform metadata fields are clamped before app inventory retention', () => {
  const crowded = ['[Desktop Entry]', `Name=${'N'.repeat(10_000)}`, `Exec=${'E'.repeat(10_000)}`, ...Array.from({ length: 200 }, (_, index) => `K${index}=${'V'.repeat(10_000)}`)].join('\n')
  const parsed = linux.parseDesktop(crowded)
  assert.ok(Object.keys(parsed).length <= linux.MAX_DESKTOP_FIELDS)
  assert.ok(Object.values(parsed).every((value) => value.length <= linux.MAX_DESKTOP_VALUE_LENGTH))
  assert.equal(linux.cleanMetadataText(parsed.Name, 240).length, 240)
  assert.equal(linux.commandToken(parsed.Exec), null)
  assert.equal(darwin.cleanMetadataText('A\u0000'.repeat(500), 'Fallback', 120).length <= 120, true)
  const windows = win32.registryEntriesToApps([{ Origin: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', Scope: 'user', Key: 'SafeKey', DisplayName: 'W'.repeat(10_000) }], 'secret')
  assert.equal(windows[0].name.length, 240)
})

test('desktop-declared AppImage paths stay manual and cannot become application delete candidates', async () => {
  let opened = 0
  const desktop = fs.readFileSync(path.join(fixtures, 'linux', 'acme.desktop'), 'utf8')
  const fakeFs = {
    opendir: async () => {
      const entries = opened++ === 0 ? [{ name: 'acme.desktop', isFile: () => true }] : []
      return { async *[Symbol.asyncIterator]() { yield* entries } }
    },
    readFile: async () => desktop,
    lstat: async (target) => {
      if (target.endsWith('.desktop')) return { size: Buffer.byteLength(desktop), isFile: () => true, isSymbolicLink: () => false }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
  }
  const result = await linux.scanApps({ home: '/home/tester', fs: fakeFs, secret: 'secret' })
  assert.equal(result.apps.length, 1)
  assert.equal(result.apps[0].install.kind, 'appimage')
  assert.equal(result.apps[0].uninstall.mode, 'manual')
  assert.equal(result.apps[0].uninstall.supported, false)
  const candidates = await linux.inspectApp(result.apps[0], { home: '/home/tester', fs: fakeFs })
  assert.equal(candidates.some((candidate) => candidate.category === 'application'), false)
})

test('oversized Linux desktop metadata is skipped before readFile allocation', async () => {
  let opened = 0
  let reads = 0
  const fakeFs = {
    opendir: async () => {
      const entries = opened++ === 0 ? [{ name: 'oversized.desktop', isFile: () => true }] : []
      return { async *[Symbol.asyncIterator]() { yield* entries } }
    },
    lstat: async () => ({ size: MAX_METADATA_BYTES + 1, isFile: () => true, isSymbolicLink: () => false }),
    readFile: async () => { reads += 1; return '' },
  }
  const result = await linux.scanApps({ home: '/home/tester', fs: fakeFs, secret: 'secret' })
  assert.deepEqual(result.apps, [])
  assert.equal(reads, 0)
  assert.ok(result.warnings.some((warning) => warning.includes('oversized.desktop')))
})

test('Flatpak targets follow strict ID/app-ref grammar and reject options', () => {
  const valid = ['io.acme.Notes', 'org.gnome.Builder', 'app/io.acme.Notes/x86_64/stable']
  const malicious = [
    '--all', '--delete-data', '-org.acme.App', ' io.acme.Notes', 'io.acme.Notes ',
    'io.acme.Notes\n--all', 'app/io.acme.Notes/x86_64/stable/extra',
    'app/io.acme.Notes/../../stable', 'runtime/io.acme.Platform/x86_64/stable',
    'io/acme/Notes', 'io..Notes', 'io.acme.Bad-Name',
  ]
  for (const target of valid) assert.equal(linux.isValidFlatpakTarget(target), true, target)
  for (const target of malicious) assert.equal(linux.isValidFlatpakTarget(target), false, target)
})

test('duplicate macOS Bundle IDs still produce distinct path-bound app IDs', async () => {
  let opened = 0
  const fakeFs = {
    opendir: async () => {
      const entries = opened++ === 0
        ? ['First.app', 'Second.app'].map((name) => ({ name, isDirectory: () => true }))
        : []
      return { async *[Symbol.asyncIterator]() { yield* entries } }
    },
  }
  const result = await darwin.scanApps({
    home: '/Users/tester',
    fs: fakeFs,
    execFile: async () => ({ stdout: JSON.stringify({ CFBundleIdentifier: 'io.acme.Shared' }) }),
    secret: 'secret',
  })
  assert.equal(result.apps.length, 2)
  assert.equal(new Set(result.apps.map((app) => app.id)).size, 2)
  assert.notEqual(result.apps[0].install.path, result.apps[1].install.path)
})

test('malicious macOS metadata cannot create traversal residuals', () => {
  for (const value of ['../Preferences', 'io.acme/Bad', 'io..Bad', '.io.acme', 'io.acme.-bad', `io.acme.Bad\0`]) {
    assert.equal(darwin.normalizeBundleId(value), null, value)
  }
  assert.equal(darwin.normalizeBundleId('io.acme.Valid-2'), 'io.acme.Valid-2')
  assert.equal(darwin.normalizeResidualName('../Preferences'), null)
  assert.deepEqual(darwin.residualSpecs({ name: '../Preferences', bundleId: '../Preferences' }, '/Users/tester'), [])
})

test('Flatpak entries from both user desktop roots are manual and path-bound', async () => {
  let opened = 0
  const desktop = '[Desktop Entry]\nName=Notes\nExec=/usr/bin/flatpak run io.acme.Notes\nX-Flatpak=io.acme.Notes\n'
  const fakeFs = {
    opendir: async () => {
      const entries = opened++ < 2 ? [{ name: 'io.acme.Notes.desktop', isFile: () => true }] : []
      return { async *[Symbol.asyncIterator]() { yield* entries } }
    },
    readFile: async () => desktop,
  }
  const result = await linux.scanApps({ home: '/home/tester', fs: fakeFs, secret: 'secret' })
  assert.equal(result.apps.length, 2)
  assert.equal(new Set(result.apps.map((app) => app.id)).size, 2)
  assert.ok(result.apps.every((app) => app.uninstall.mode === 'manual' && app.uninstall.supported === false))
  assert.ok(result.warnings.some((warning) => warning.includes('Flatpak')))
})

test('malicious X-Flatpak desktop entry becomes manual during scan', async () => {
  const desktop = fs.readFileSync(path.join(fixtures, 'linux', 'malicious-flatpak.desktop'), 'utf8')
  let opened = 0
  const fakeFs = {
    access: async (target) => { if (target !== '/usr/bin/flatpak') throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
    opendir: async () => {
      const entries = opened++ === 0 ? [{ name: 'malicious.desktop', isFile: () => true }] : []
      return { async *[Symbol.asyncIterator]() { yield* entries } }
    },
    readFile: async () => desktop,
  }
  const result = await linux.scanApps({ home: '/home/tester', fs: fakeFs, secret: 'x' })
  assert.equal(result.apps.length, 1)
  assert.equal(result.apps[0].install.kind, 'flatpak')
  assert.equal(result.apps[0].uninstall.supported, false)
  assert.equal(result.apps[0].uninstall.mode, 'manual')
  assert.equal(result.apps[0].flatpakTarget, null)
  assert.ok(result.warnings.some((warning) => warning.includes('格式异常')))
})

test('Linux desktop parser ignores localized payload outside Desktop Entry', () => {
  const value = linux.parseDesktop('[Other]\nName=Wrong\n[Desktop Entry]\nName=Right\nExec="/tmp/a b.AppImage" %F\n')
  assert.equal(value.Name, 'Right')
  assert.equal(linux.commandToken(value.Exec), '/tmp/a b.AppImage')
})

test('all platform adapters surface root scan failures as warnings', async () => {
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
  const unreadableFs = { opendir: async () => { throw denied }, access: async () => { throw denied } }
  const mac = await darwin.scanApps({ home: '/Users/tester', fs: unreadableFs, execFile: async () => ({ stdout: '{}' }), secret: 'x' })
  assert.deepEqual(mac.apps, [])
  assert.ok(mac.warnings.length >= 1)
  const lin = await linux.scanApps({ home: '/home/tester', fs: unreadableFs, secret: 'x' })
  assert.deepEqual(lin.apps, [])
  assert.ok(lin.warnings.length >= 1)
  const win = await win32.scanApps({ execFile: async () => { throw denied }, secret: 'x' })
  assert.deepEqual(win.apps, [])
  assert.ok(win.warnings[0].includes('PowerShell'))
})

test('macOS and Linux platform scans stream entries and stop at their cap', async () => {
  const entries = ['One', 'Two', 'Three'].map((name) => ({ name: `${name}.app`, isDirectory: () => true, isFile: () => true }))
  const streamFs = {
    access: async (target) => { if (target !== '/usr/bin/flatpak') throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
    opendir: async () => ({ async *[Symbol.asyncIterator]() { yield* entries } }),
    readFile: async (target) => `[Desktop Entry]\nName=${path.basename(target, '.desktop')}\nExec=/home/tester/Applications/Test.AppImage\n`,
  }
  const mac = await darwin.scanApps({ home: '/Users/tester', fs: streamFs, execFile: async () => ({ stdout: '{}' }), secret: 'x', maxApps: 2 })
  assert.equal(mac.apps.length, 2)
  assert.ok(mac.warnings.some((item) => item.includes('上限 2')))
  const desktopEntries = ['one.desktop', 'two.desktop', 'three.desktop'].map((name) => ({ name, isDirectory: () => false, isFile: () => true }))
  streamFs.opendir = async () => ({ async *[Symbol.asyncIterator]() { yield* desktopEntries } })
  const lin = await linux.scanApps({ home: '/home/tester', fs: streamFs, secret: 'x', maxApps: 10, maxEntries: 2 })
  assert.equal(lin.apps.length, 2)
  assert.ok(lin.warnings.some((item) => item.includes('目录条目上限 2')))
})

test('macOS and Linux scans stop on the shared total deadline with partial results', async () => {
  let macClock = 0
  const macEntries = ['One.app', 'Two.app'].map((name) => ({ name, isDirectory: () => true }))
  const macFs = { opendir: async () => ({ async *[Symbol.asyncIterator]() { yield* macEntries } }) }
  const mac = await darwin.scanApps({ home: '/Users/tester', fs: macFs, execFile: async () => { macClock += 10; return { stdout: '{}' } }, secret: 'x', scanDeadlineMs: 15, now: () => macClock })
  assert.equal(mac.apps.length, 1)
  assert.ok(mac.warnings.some((warning) => warning.includes('总时限 15ms')))

  let linuxClock = 0
  let opened = 0
  const desktopEntries = ['one.desktop', 'two.desktop'].map((name) => ({ name, isFile: () => true }))
  const linuxFs = {
    access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
    opendir: async () => ({ async *[Symbol.asyncIterator]() { if (opened++ === 0) yield* desktopEntries } }),
    readFile: async (target) => { linuxClock += 10; return `[Desktop Entry]\nName=${path.basename(target, '.desktop')}\nExec=/usr/bin/example\n` },
  }
  const lin = await linux.scanApps({ home: '/home/tester', fs: linuxFs, secret: 'x', scanDeadlineMs: 15, now: () => linuxClock })
  assert.equal(lin.apps.length, 1)
  assert.ok(lin.warnings.some((warning) => warning.includes('总时限 15ms')))
})
