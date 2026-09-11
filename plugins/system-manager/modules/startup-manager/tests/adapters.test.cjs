'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const darwin = require('../public/preload/adapters/darwin.cjs')
const win32 = require('../public/preload/adapters/win32.cjs')
const linux = require('../public/preload/adapters/linux.cjs')

const fixture = (...parts) => fs.readFileSync(path.join(__dirname, 'fixtures', ...parts), 'utf8')
const asyncDirectory = (entries) => ({ async *[Symbol.asyncIterator]() { yield* entries } })

test('macOS plist parser preserves launch policy and rejects non-objects', () => {
  const parsed = darwin.parsePlistJson(fixture('darwin', 'user-agent.json'))
  assert.equal(parsed.Label, 'com.example.sync')
  assert.equal(parsed.RunAtLoad, true)
  assert.throws(() => darwin.parsePlistJson('[]'), /Invalid plist/)
})

test('Windows rows normalize singleton and array output across localized hosts', () => {
  const rows = win32.parseRows(fixture('win32', 'startup-rows.json'))
  assert.equal(rows.length, 3)
  assert.equal(win32.parseRows(JSON.stringify(rows[0])).length, 1)
  assert.equal(rows[2].running, true)
})

test('Windows scan manages user tasks while Run keys and services stay read-only', async () => {
  const runner = { async runFile(file, args) {
    assert.equal(file.endsWith('powershell.exe'), true)
    assert.ok(args.includes('-EncodedCommand'))
    return { stdout: fixture('win32', 'startup-rows.json'), stderr: '' }
  } }
  const result = await win32.scan({ runner, home: 'C:\\Users\\demo' })
  assert.equal(result.items.length, 3)
  assert.equal(result.items[0].action.canToggle, false)
  assert.equal(result.items[1].action.canToggle, true)
  assert.equal(result.items[2].action.canToggle, false)
  assert.equal(result.items[0].commandSummary.includes('demo'), false)
  assert.deepEqual(Object.keys(result.items[1].internal.row).sort(), ['kind', 'location', 'name', 'taskPath'])
  assert.equal(Object.hasOwn(result.items[1].internal.row, 'taskXml'), false)
})

test('Linux desktop parser handles Hidden and preserves later sections when toggled', () => {
  const source = fixture('linux', 'user.desktop')
  const entry = linux.parseDesktopEntry(source)
  assert.equal(entry.Name, 'Cloud Sync')
  assert.equal(entry.Exec.includes('%U'), true)
  const disabled = linux.setDesktopEnabled(source, false)
  assert.match(disabled, /Hidden=true/)
  assert.match(disabled, /X-GNOME-Autostart-enabled=false/)
  assert.match(disabled, /\[Desktop Action Settings]/)
  assert.equal(linux.parseDesktopEntry(disabled).Hidden, 'true')
  assert.equal(linux.parseDesktopEntry(disabled)['X-GNOME-Autostart-enabled'], 'false')
  const enabled = linux.setDesktopEnabled(fixture('linux', 'disabled.desktop'), true)
  assert.equal(linux.parseDesktopEntry(enabled).Hidden, 'false')
  assert.equal(linux.parseDesktopEntry(enabled)['X-GNOME-Autostart-enabled'], 'true')
})

test('Linux systemd parser distinguishes enabled, masked, and static services', () => {
  const units = linux.parseSystemdList(fixture('linux', 'systemd.txt'))
  assert.deepEqual(units.map((unit) => unit.state), ['enabled', 'masked', 'static'])
  assert.equal(units.some((unit) => unit.unit.includes(';')), false)
  assert.deepEqual(linux.parseSystemdList('-malicious.service enabled'), [])
  assert.equal(linux.isManageableSystemdState('enabled'), true)
  assert.equal(linux.isManageableSystemdState('disabled'), true)
  for (const state of ['enabled-runtime', 'linked', 'linked-runtime', 'masked', 'masked-runtime', 'indirect', 'alias', 'static', 'bad']) {
    assert.equal(linux.isManageableSystemdState(state), false, state)
  }
})

test('launchctl and systemd running-state parsers use bounded bulk output', () => {
  const launch = darwin.parseLaunchctlList('PID Status Label\n123 0 com.example.sync\n- 0 com.example.idle')
  assert.deepEqual([...launch.loaded], ['com.example.sync', 'com.example.idle'])
  assert.deepEqual([...launch.running], ['com.example.sync'])
  assert.equal(darwin.parseDisabled('disabled services = { "com.example.sync" => true }').get('com.example.sync'), true)
  assert.deepEqual([...linux.parseActiveUnits('cloud-sync.service loaded active running Cloud sync\nidle.service loaded inactive dead Idle')], ['cloud-sync.service'])
})

test('macOS scan reports LaunchAgents without exposing mutation capability', async () => {
  const contents = new Map([
    ['/Users/demo/Library/LaunchAgents/user.plist', fixture('darwin', 'user-agent.json')],
    ['/Library/LaunchDaemons/system.plist', fixture('darwin', 'system-daemon.json')],
  ])
  const fakeFs = {
    async opendir(dir) { return asyncDirectory([...contents.keys()].filter((file) => path.dirname(file) === dir).map((file) => ({ name: path.basename(file), isFile: () => true }))) },
    async readFile(file) { return Buffer.from(contents.get(file)) },
    async stat(file) { return { size: Buffer.byteLength(contents.get(file)), mtimeMs: 1 } },
    async lstat(file) { const isFile = contents.has(file); return { size: isFile ? Buffer.byteLength(contents.get(file)) : 0, mtimeMs: 1, dev: 1, ino: file.length, mode: isFile ? 0o100644 : 0o40755, isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false } },
    async realpath(file) { return file },
  }
  const runner = { async runFile(file, args) {
    if (file.endsWith('/plutil')) return { stdout: contents.get(args.at(-1)), stderr: '' }
    if (file.endsWith('/launchctl') && args[0] === 'list') return { stdout: 'PID Status Label\n123 0 com.example.sync\n', stderr: '' }
    if (file.endsWith('/launchctl') && args[0] === 'print-disabled') return { stdout: 'disabled services = {}', stderr: '' }
    throw Object.assign(new Error('not loaded'), { code: 1 })
  } }
  const result = await darwin.scan({ fs: fakeFs, runner, home: '/Users/demo', uid: 501, locations: [
    { dir: '/Users/demo/Library/LaunchAgents', scope: 'user', kind: 'launch-agent', label: '用户 LaunchAgents' },
    { dir: '/Library/LaunchDaemons', scope: 'system', kind: 'launch-daemon', label: '系统 LaunchDaemons' },
  ] })
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].action.canToggle, false)
  assert.match(result.items[0].action.reason, /可信绑定|仅支持查看/)
  assert.equal(result.items[0].running, true)
  assert.equal(result.items[0].commandSummary.includes('/Users/demo'), false)
  assert.deepEqual(Object.keys(result.items[0].internal), ['label'])
  assert.equal(result.items[1].action.canToggle, false)
  assert.equal(result.items[1].impact.level, 'high')
})

test('macOS launchctl state failure becomes unknown warning and disables toggle', async () => {
  const file = '/Users/demo/Library/LaunchAgents/user.plist'
  const source = fixture('darwin', 'user-agent.json')
  const fakeFs = {
    async opendir() { return asyncDirectory([{ name: 'user.plist', isFile: () => true }]) },
    async readFile() { return Buffer.from(source) },
    async lstat(value) { const isFile = value.endsWith('.plist'); return { size: isFile ? Buffer.byteLength(source) : 0, mtimeMs: 1, dev: 1, ino: 2, mode: isFile ? 0o100644 : 0o40755, isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false } },
    async realpath(value) { return value },
  }
  const runner = { async runFile(command) { if (command.endsWith('/plutil')) return { stdout: source }; throw new Error('launchctl unavailable') } }
  const result = await darwin.scan({ fs: fakeFs, runner, home: '/Users/demo', uid: 501, locations: [{ dir: path.dirname(file), scope: 'user', kind: 'launch-agent', label: '用户 LaunchAgents' }] })
  assert.equal(result.items[0].enabled, null)
  assert.equal(result.items[0].running, null)
  assert.equal(result.items[0].action.canToggle, false)
  assert.equal(result.warnings.length >= 2, true)
})

test('duplicate macOS LaunchAgent labels are read-only conflicts', async () => {
  const directory = '/Users/demo/Library/LaunchAgents'
  const source = fixture('darwin', 'user-agent.json')
  const fakeFs = {
    async opendir() { return asyncDirectory(['one.plist', 'two.plist'].map((name) => ({ name, isFile: () => true }))) },
    async readFile() { return Buffer.from(source) },
    async lstat(file) { const isFile = file.endsWith('.plist'); return { size: isFile ? Buffer.byteLength(source) : 0, mtimeMs: 1, dev: 1, ino: file.length, mode: isFile ? 0o100644 : 0o40755, isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false } },
    async realpath(value) { return value },
  }
  const runner = { async runFile(command, args) { if (command.endsWith('/plutil')) return { stdout: source }; if (args[0] === 'list') return { stdout: 'PID Status Label\n' }; return { stdout: 'disabled services = {}' } } }
  const result = await darwin.scan({ fs: fakeFs, runner, home: '/Users/demo', uid: 501, locations: [{ dir: directory, scope: 'user', kind: 'launch-agent', label: '用户 LaunchAgents' }] })
  assert.equal(result.items.length, 2)
  assert.equal(result.items.every((item) => !item.action.canToggle), true)
  assert.match(result.warnings.join(' '), /Label 冲突/)
})

test('macOS plist parsing is concurrency-bounded and over-limit sources are truncated', async () => {
  const directory = '/Users/demo/Library/LaunchAgents'
  const count = darwin.MAX_FILES_PER_LOCATION + 1
  const source = '{"Label":"com.example.fixture","RunAtLoad":true}'
  let active = 0
  let maxActive = 0
  const fakeFs = {
    async opendir() { return asyncDirectory(Array.from({ length: count }, (_, index) => ({ name: `${index}.plist`, isFile: () => true }))) },
    async readFile() { return Buffer.from(source) },
    async lstat(file) { const isFile = file.endsWith('.plist'); return { size: isFile ? Buffer.byteLength(source) : 0, mtimeMs: 1, dev: 1, ino: file.length, mode: isFile ? 0o100644 : 0o40755, isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false } },
    async realpath(value) { return value },
  }
  const runner = { async runFile(command, args) {
    if (command.endsWith('/launchctl')) return args[0] === 'list' ? { stdout: 'PID Status Label\n' } : { stdout: 'disabled services = {}' }
    active += 1; maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setImmediate(resolve))
    active -= 1
    return { stdout: source }
  } }
  const result = await darwin.scan({ fs: fakeFs, runner, home: '/Users/demo', uid: 501, locations: [{ dir: directory, scope: 'user', kind: 'launch-agent', label: '用户 LaunchAgents' }] })
  assert.equal(maxActive <= darwin.IO_CONCURRENCY, true)
  assert.equal(result.items.length, darwin.MAX_FILES_PER_LOCATION)
  assert.equal(result.items.every((item) => !item.action.canToggle), true)
  assert.match(result.warnings.join(' '), /超过/)
})

test('mutable roots reject symlink and canonical realHome escape fixtures', async () => {
  const macRoot = '/Users/demo/Library/LaunchAgents'
  const macFs = {
    async lstat() { return { isSymbolicLink: () => true, isDirectory: () => false } },
    async realpath(value) { return value },
  }
  const macRunner = { async runFile(command, args) { return args[0] === 'list' ? { stdout: 'PID Status Label\n' } : { stdout: 'disabled services = {}' } } }
  const mac = await darwin.scan({ fs: macFs, runner: macRunner, home: '/Users/demo', uid: 501, locations: [{ dir: macRoot, scope: 'user', kind: 'launch-agent', label: '用户 LaunchAgents' }] })
  assert.equal(mac.items.length, 0)
  assert.match(mac.warnings.join(' '), /根目录/)

  const linuxRoot = '/home/demo/.config/autostart'
  const linuxFs = {
    async lstat() { return { dev: 1, ino: 2, isSymbolicLink: () => false, isDirectory: () => true } },
    async realpath(value) { return value === '/home/demo' ? '/real/home/demo' : '/outside/autostart' },
    async access() { throw new Error('missing tools') },
  }
  const linuxResult = await linux.scan({ fs: linuxFs, runner: { async runFile() { throw new Error('unused') } }, home: '/home/demo', desktopLocations: [{ dir: linuxRoot, scope: 'user', label: '用户 XDG Autostart' }] })
  assert.equal(linuxResult.items.some((item) => item.kind === 'desktop-autostart'), false)
  assert.match(linuxResult.warnings.join(' '), /realHome/)
})

test('Linux desktop opendir stops at limit+1 and makes incomplete user roots read-only', async () => {
  const root = '/home/demo/.config/autostart'
  const source = '[Desktop Entry]\nName=Fixture\nExec=/bin/true\nHidden=false\n'
  const count = 401
  const fakeFs = {
    async lstat(value) { const isFile = value.endsWith('.desktop'); return { size: isFile ? Buffer.byteLength(source) : 0, mtimeMs: 1, dev: 1, ino: value.length, mode: isFile ? 0o100644 : 0o40755, isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => false } },
    async realpath(value) { return value },
    async readFile() { return Buffer.from(source) },
    async opendir() { return asyncDirectory(Array.from({ length: count }, (_, index) => ({ name: `${index}.desktop`, isFile: () => true }))) },
    async access() { throw new Error('missing tools') },
  }
  const result = await linux.scan({ fs: fakeFs, runner: { async runFile() { throw new Error('unused') } }, home: '/home/demo', desktopLocations: [{ dir: root, scope: 'user', label: '用户 XDG Autostart' }] })
  const desktop = result.items.filter((item) => item.kind === 'desktop-autostart')
  assert.equal(desktop.length, 400)
  assert.equal(desktop.every((item) => !item.action.canToggle), true)
  assert.equal(desktop.some((item) => Object.hasOwn(item.internal.evidence, 'content')), false)
  assert.match(result.warnings.join(' '), /超过400项/)
})
