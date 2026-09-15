'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { createItem } = require('../public/preload/core/model.cjs')
const { readMutableRoot, readState } = require('../public/preload/core/file-state.cjs')
const darwin = require('../public/preload/adapters/darwin.cjs')
const linux = require('../public/preload/adapters/linux.cjs')
const win32 = require('../public/preload/adapters/win32.cjs')

function memoryFs(initial) {
  const files = new Map(Object.entries(initial).map(([key, value]) => [key, Buffer.from(value)]))
  const mtimes = new Map([...files.keys()].map((key) => [key, 1]))
  const inodes = new Map([...files.keys()].map((key, index) => [key, index + 10]))
  let nextInode = 100
  return {
    files,
    async opendir(directory) { const entries = [...files.keys()].filter((file) => path.dirname(file) === directory).map((file) => ({ name: path.basename(file), isFile: () => true })); return { async *[Symbol.asyncIterator]() { yield* entries } } },
    async readFile(file) { if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return Buffer.from(files.get(file)) },
    async stat(file) { return this.lstat(file) },
    async lstat(file) { const content = files.get(file); if (!content) { if (file === '/Users/demo' || file === '/home/demo' || [...files.keys()].some((key) => key.startsWith(`${file}/`))) return { size: 0, mtimeMs: 1, dev: 1, ino: file.length, mode: 0o40755, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false }; throw new Error('missing') } return { size: content.length, mtimeMs: mtimes.get(file), dev: 1, ino: inodes.get(file), mode: 0o100644, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false } },
    async realpath(file) { return file },
    async writeFile(file, content, options) { if (options?.flag === 'wx' && files.has(file)) throw new Error('exists'); files.set(file, Buffer.from(content)); mtimes.set(file, 2); inodes.set(file, nextInode++) },
    async chmod() {},
    async rename(from, to) { files.set(to, files.get(from)); files.delete(from); inodes.set(to, inodes.get(from)); inodes.delete(from); mtimes.set(to, (mtimes.get(to) || 1) + 1) },
    async unlink(file) { files.delete(file) },
  }
}

test('macOS LaunchAgent mutations are read-only and never invoke launchctl', async () => {
  let calls = 0
  const deps = { runner: { async runFile() { calls += 1 } } }
  await assert.rejects(darwin.applyEnabled({}, false, deps), (error) => error.code === 'READ_ONLY')
  await assert.rejects(darwin.undo({}, {}, deps), (error) => error.code === 'READ_ONLY')
  assert.equal(calls, 0)
})

test('Linux desktop toggle is atomic and undo refuses external changes', async () => {
  const file = '/home/demo/.config/autostart/test.desktop'
  const source = '[Desktop Entry]\nName=Test\nExec=/bin/test\nHidden=false\n'
  const fakeFs = memoryFs({ [file]: source })
  const fileEvidence = await readState(file, fakeFs)
  const rootEvidence = await readMutableRoot(path.dirname(file), '/home/demo', fakeFs)
  const target = createItem({ key: 'x', name: 'test', scope: 'user', kind: 'desktop-autostart', source: { label: 'x', location: file }, enabled: true, action: { canToggle: true }, internal: { file, evidence: fileEvidence, rootEvidence } }, '/home/demo')
  const rollback = await linux.applyEnabled(target, false, { fs: fakeFs })
  assert.match(fakeFs.files.get(file).toString(), /Hidden=true/)
  await linux.undo(target, rollback, { fs: fakeFs })
  assert.equal(fakeFs.files.get(file).toString(), source)

  const second = await linux.applyEnabled(target, false, { fs: fakeFs })
  fakeFs.files.set(file, Buffer.from('externally changed'))
  await assert.rejects(linux.undo(target, second, { fs: fakeFs }), (error) => error.code === 'ITEM_CHANGED')
})

test('Linux desktop undo does not adopt a raced external edit as its write baseline', async () => {
  const file = '/home/demo/.config/autostart/raced-undo.desktop'
  const source = '[Desktop Entry]\nName=Race\nExec=/bin/true\nHidden=false\n'
  const external = '[Desktop Entry]\nName=External change\nExec=/bin/false\nHidden=true\n'
  const fakeFs = memoryFs({ [file]: source })
  const evidence = await readState(file, fakeFs)
  const rootEvidence = await readMutableRoot(path.dirname(file), '/home/demo', fakeFs)
  const target = createItem({ key: 'race-undo', name: 'Race', scope: 'user', kind: 'desktop-autostart', source: { label: 'x', location: file }, enabled: true, action: { canToggle: true }, internal: { file, evidence, rootEvidence } }, '/home/demo')
  const rollback = await linux.applyEnabled(target, false, { fs: fakeFs })

  const readFile = fakeFs.readFile.bind(fakeFs)
  let raced = false
  fakeFs.readFile = async (targetFile) => {
    const content = await readFile(targetFile)
    if (!raced && targetFile === file) {
      raced = true
      fakeFs.files.set(file, Buffer.from(external))
    }
    return content
  }

  await assert.rejects(linux.undo(target, rollback, { fs: fakeFs }), (error) => error.code === 'ITEM_CHANGED')
  assert.equal(fakeFs.files.get(file).toString(), external)
})

test('atomic desktop write rejects inode swaps and symbolic links', async () => {
  const file = '/home/demo/.config/autostart/race.desktop'
  const source = '[Desktop Entry]\nName=Race\nExec=/bin/true\nHidden=false\n'
  const fakeFs = memoryFs({ [file]: source })
  const original = await readState(file, fakeFs)
  const originalWrite = fakeFs.writeFile.bind(fakeFs)
  fakeFs.writeFile = async (target, content, options) => { await originalWrite(target, content, options); if (target !== file) fakeFs.files.set(file, Buffer.from(source + '# swapped')) }
  await assert.rejects(linux.writeAtomic(file, source, original, fakeFs), (error) => error.code === 'ITEM_CHANGED')

  const symlinkFs = { async lstat() { return { isSymbolicLink: () => true, isFile: () => false } } }
  await assert.rejects(readState(file, symlinkFs), (error) => error.code === 'UNSAFE_FILE')
})

test('Linux user systemd validates unit state before mutation', async () => {
  const calls = []
  let state = 'enabled'
  const runner = { async runFile(command, args) { calls.push(args); if (args[1] === 'is-enabled') return { stdout: `${state}\n` }; if (args[1] === 'disable') state = 'disabled'; return { stdout: '', stderr: '' } } }
  const target = createItem({ key: 'x', name: 'sync.service', scope: 'user', kind: 'systemd-unit', source: { label: 'systemd', location: 'sync.service' }, enabled: true, action: { canToggle: true }, internal: { unit: 'sync.service', user: true, unitState: 'enabled', toolPath: '/usr/bin/systemctl' } })
  const result = await linux.applyEnabled(target, false, { runner, fs: { async access() {} } })
  assert.deepEqual(result.state, { enabled: false, running: true })
  assert.deepEqual(calls, [['--user', 'is-enabled', '--', 'sync.service'], ['--user', 'disable', '--', 'sync.service'], ['--user', 'is-enabled', '--', 'sync.service'], ['--user', 'is-active', '--quiet', '--', 'sync.service']])
})

test('Linux systemd rejects exact-state drift before mutation', async () => {
  const calls = []
  const runner = { async runFile(command, args) { calls.push(args); return { stdout: 'linked\n' } } }
  const target = createItem({ key: 'drift', name: 'sync.service', scope: 'user', kind: 'systemd-unit', source: { label: 'systemd', location: 'sync.service' }, enabled: true, action: { canToggle: true }, internal: { unit: 'sync.service', user: true, unitState: 'enabled', toolPath: '/usr/bin/systemctl' } })

  await assert.rejects(linux.applyEnabled(target, false, { runner, fs: { async access() {} } }), (error) => error.code === 'ITEM_CHANGED')
  assert.deepEqual(calls, [['--user', 'is-enabled', '--', 'sync.service']])
})

test('Linux systemd restores and verifies the exact original state when mutation applies then rejects', async () => {
  const calls = []
  let state = 'enabled'
  const runner = { async runFile(command, args) {
    calls.push(args)
    if (args[1] === 'is-enabled') return { stdout: `${state}\n` }
    if (args[1] === 'disable') { state = 'disabled'; throw new Error('command failed after applying') }
    if (args[1] === 'enable') state = 'enabled'
    return { stdout: '', stderr: '' }
  } }
  const target = createItem({ key: 'applied-then-rejected', name: 'sync.service', scope: 'user', kind: 'systemd-unit', source: { label: 'systemd', location: 'sync.service' }, enabled: true, action: { canToggle: true }, internal: { unit: 'sync.service', user: true, unitState: 'enabled', toolPath: '/usr/bin/systemctl' } })

  await assert.rejects(linux.applyEnabled(target, false, { runner, fs: { async access() {} } }), (error) => error.message === 'command failed after applying' && error.rollbackRestored === true)
  assert.equal(state, 'enabled')
  assert.deepEqual(calls, [['--user', 'is-enabled', '--', 'sync.service'], ['--user', 'disable', '--', 'sync.service'], ['--user', 'enable', '--', 'sync.service'], ['--user', 'is-enabled', '--', 'sync.service']])
})

test('Linux systemd reports rollback failure when exact original state cannot be restored', async () => {
  const calls = []
  let state = 'enabled'
  const runner = { async runFile(command, args) {
    calls.push(args)
    if (args[1] === 'is-enabled') return { stdout: `${state}\n` }
    if (args[1] === 'disable') state = 'masked'
    return { stdout: '', stderr: '' }
  } }
  const target = createItem({ key: 'ineffective-rollback', name: 'sync.service', scope: 'user', kind: 'systemd-unit', source: { label: 'systemd', location: 'sync.service' }, enabled: true, action: { canToggle: true }, internal: { unit: 'sync.service', user: true, unitState: 'enabled', toolPath: '/usr/bin/systemctl' } })

  await assert.rejects(linux.applyEnabled(target, false, { runner, fs: { async access() {} } }), (error) => error.code === 'ROLLBACK_FAILED' && error.expectedState === 'enabled' && error.actualState === 'masked' && error.cause?.code === 'VERIFY_FAILED')
  assert.equal(state, 'masked')
  assert.deepEqual(calls, [['--user', 'is-enabled', '--', 'sync.service'], ['--user', 'disable', '--', 'sync.service'], ['--user', 'is-enabled', '--', 'sync.service'], ['--user', 'enable', '--', 'sync.service'], ['--user', 'is-enabled', '--', 'sync.service']])
})

test('Windows scheduled-task toggle checks state and keeps targets out of command arguments', async () => {
  const calls = []
  const definition = { principal: 'S-1-test', uri: '\\Vendor\\Unique Sync Fixture', taskXml: '<Task><Settings><Enabled>true</Enabled></Settings><Actions><Exec>sync.exe</Exec></Actions></Task>', command: 'sync.exe ' }
  const runner = { async runFile(command, args, options) {
    calls.push({ command, args, env: options.env })
    if (calls.length === 1) return { stdout: JSON.stringify({ ...definition, enabled: true, running: false }) }
    if (calls.length === 3) return { stdout: JSON.stringify({ ...definition, enabled: false, running: false }) }
    return { stdout: '' }
  } }
  const row = { kind: 'scheduled-task', scope: 'user', ownerIsCurrent: true, ...definition, name: 'Unique Sync Fixture', location: '\\Vendor\\', taskPath: '\\Vendor\\', enabled: true }
  const target = createItem({ key: win32.rowKey(row), name: row.name, scope: 'user', kind: 'scheduled-task', source: { label: 'Task Scheduler', location: row.location }, enabled: true, action: { canToggle: true }, internal: { row, fingerprint: win32.taskFingerprint(row) } })
  const rollback = await win32.applyEnabled(target, false, { runner })
  assert.equal(rollback.enabled, true)
  assert.equal(calls[0].args.includes(row.name), false)
  assert.equal(calls[0].env.ZTOOLS_NAME, row.name)
  assert.equal(calls[1].env.ZTOOLS_MODE, 'disable')
})

test('Windows task fingerprint rejects changed principal, URI, actions, or XML', async () => {
  const row = { kind: 'scheduled-task', scope: 'user', ownerIsCurrent: true, principal: 'S-1-good', uri: '\\Vendor\\Task', taskXml: '<Task><Settings><Enabled>true</Enabled></Settings><Actions><Exec>good.exe</Exec></Actions></Task>', command: 'good.exe ', name: 'Task', location: '\\Vendor\\', taskPath: '\\Vendor\\', enabled: true }
  const target = createItem({ key: win32.rowKey(row), name: row.name, scope: 'user', kind: 'scheduled-task', source: { label: 'Task', location: row.location }, enabled: true, action: { canToggle: true }, internal: { row, fingerprint: win32.taskFingerprint(row) } })
  const changed = { ...row, enabled: true, principal: 'S-1-other' }
  const runner = { async runFile(command, args, options) { return { stdout: JSON.stringify(changed) } } }
  await assert.rejects(win32.applyEnabled(target, false, { runner, powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }), (error) => error.code === 'ITEM_CHANGED')
  for (const [field, value] of [['principal', 'S-1-other'], ['uri', '\\Other\\Task'], ['command', 'evil.exe '], ['taskXml', row.taskXml.replace('good.exe', 'evil.exe')]]) {
    assert.notEqual(win32.taskFingerprint(row), win32.taskFingerprint({ ...row, [field]: value }), field)
  }
})
