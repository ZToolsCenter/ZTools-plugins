'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')
const { createEngine, JOURNAL_TTL_MS, JOURNAL_VERSION } = require('../public/preload/core/engine.cjs')
const { assertCanonicalSafeUserPath, assertSafeUserPath, isInside, snapshotDirectory } = require('../public/preload/core/safety.cjs')

const tempRoot = path.join(__dirname, '.tmp')

async function fixture(t) {
  await fs.mkdir(tempRoot, { recursive: true })
  const root = await fs.mkdtemp(path.join(tempRoot, 'safety-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const target = path.join(home, '.config', 'Acme')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'settings.json'), '{}')
  const adapter = {
    async scanApps(ctx) {
      return [{ id: `app_${ctx.secret.slice(0, 20)}`, platform: 'linux', name: 'Acme', version: null, publisher: null, appKey: 'Acme', install: { kind: 'desktop', path: null, scope: 'user' }, uninstall: { mode: 'trash', requiresElevation: false, supported: true }, protected: false }]
    },
    async inspectApp() { return [{ path: target, category: 'config', confidence: 'exact', reason: 'fixture', selectedByDefault: true, ownership: 'user', deletable: true }] },
  }
  return { root, home, target, adapter }
}

test('path boundary rejects home, traversal and system roots', async (t) => {
  const { home } = await fixture(t)
  assert.throws(() => assertSafeUserPath(home, { platform: 'linux', home, env: {} }), /受保护目录/)
  assert.throws(() => assertSafeUserPath(path.join(home, '.config', '..', '..', 'etc'), { platform: 'linux', home, env: {} }), /允许的用户目录/)
  assert.throws(() => assertSafeUserPath('/etc', { platform: 'linux', home, env: {} }), /受保护目录|允许的用户目录/)
  assert.equal(isInside(path.join(home, '.config'), path.join(home, '.config', 'app')), true)
  const darwinOptions = { platform: 'darwin', home, env: {} }
  assert.throws(() => assertSafeUserPath(path.join(home, 'Library'), darwinOptions), /允许的用户目录/)
  assert.throws(() => assertSafeUserPath(path.join(home, 'Library', 'Preferences'), darwinOptions), /允许的用户目录/)
  assert.throws(() => assertSafeUserPath(path.join(home, 'Library', 'Mobile Documents', 'shared'), darwinOptions), /允许的用户目录/)
  assert.equal(assertSafeUserPath(path.join(home, 'Library', 'Preferences', 'io.acme.App.plist'), darwinOptions), path.join(home, 'Library', 'Preferences', 'io.acme.App.plist'))
  assert.equal(assertSafeUserPath(path.join(home, 'Library', 'Caches', 'io.acme.App'), darwinOptions), path.join(home, 'Library', 'Caches', 'io.acme.App'))
})

test('opaque plan requires exact app confirmation and allowlisted candidate ids', async (t) => {
  const { home, adapter } = await fixture(t)
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async () => {} })
  const scan = await engine.scanApps()
  const plan = await engine.inspectApp(scan.apps[0].id)
  await assert.rejects(engine.executePlan({ planId: plan.id, selectedIds: ['item_forged'], confirmation: 'Acme' }), /不属于/)
  await assert.rejects(engine.executePlan({ planId: plan.id, selectedIds: plan.candidates.map((item) => item.id), confirmation: 'acme' }), /完整应用名称/)
})

test('execution revalidates fingerprint and refuses a TOCTOU replacement', async (t) => {
  const { home, target, adapter } = await fixture(t)
  const trashed = []
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async (item) => trashed.push(item) })
  const scan = await engine.scanApps()
  const plan = await engine.inspectApp(scan.apps[0].id)
  await fs.writeFile(path.join(target, 'new-file'), 'changed')
  const result = await engine.executePlan({ planId: plan.id, selectedIds: [plan.candidates[0].id], confirmation: 'Acme' })
  assert.equal(result.results[0].status, 'failed')
  assert.match(result.results[0].message, /发生变化/)
  assert.deepEqual(trashed, [])
})

test('deep directory additions invalidate the preview snapshot', async (t) => {
  const { home, target, adapter } = await fixture(t)
  const deep = path.join(target, 'existing', 'deep')
  await fs.mkdir(deep, { recursive: true })
  await fs.writeFile(path.join(deep, 'before.txt'), 'before')
  const trashed = []
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async (item) => trashed.push(item) })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  await fs.writeFile(path.join(deep, 'important-after-preview.txt'), 'important')
  const result = await engine.executePlan({ planId: plan.id, selectedIds: [plan.candidates[0].id], confirmation: 'Acme' })
  assert.equal(result.results[0].status, 'failed')
  assert.match(result.results[0].message, /发生变化/)
  assert.deepEqual(trashed, [])
})

test('ancestor symlink escaping a canonical safe root is preview-only', async (t) => {
  const { root, home, adapter } = await fixture(t)
  const outside = path.join(root, 'outside', 'Acme')
  await fs.mkdir(outside, { recursive: true })
  const redirect = path.join(home, '.config', 'redirect')
  await fs.symlink(path.join(root, 'outside'), redirect)
  const escaped = path.join(redirect, 'Acme')
  adapter.inspectApp = async () => [{ path: escaped, category: 'config', confidence: 'exact', reason: 'fixture', selectedByDefault: true, ownership: 'user', deletable: true }]
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async () => assert.fail('must not trash') })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  assert.equal(plan.candidates[0].deletable, false)
  assert.match(plan.candidates[0].reason, /真实路径越过/)
})

test('safe root itself cannot be a symlink even when it resolves inside Home', async (t) => {
  const { home, adapter } = await fixture(t)
  const realCache = path.join(home, 'real-cache')
  const cacheRoot = path.join(home, '.cache')
  const target = path.join(cacheRoot, 'Acme')
  await fs.mkdir(path.join(realCache, 'Acme'), { recursive: true })
  await fs.symlink(realCache, cacheRoot)
  adapter.inspectApp = async () => [{ path: target, category: 'cache', confidence: 'exact', reason: 'fixture', selectedByDefault: true, ownership: 'user', deletable: true }]
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async () => assert.fail('must not trash') })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  assert.equal(plan.candidates[0].deletable, false)
  assert.match(plan.candidates[0].reason, /允许根目录不能是符号链接/)
})

test('canonical safe root must remain inside real Home, including Windows redirection', async () => {
  const directoryInfo = { isSymbolicLink: () => false, isDirectory: () => true }
  const linuxFs = {
    realpath: async (target) => ({ '/home/user': '/real/home', '/home/user/.config': '/outside/config', '/home/user/.config/Acme': '/outside/config/Acme' }[target]),
    lstat: async () => directoryInfo,
  }
  await assert.rejects(assertCanonicalSafeUserPath('/home/user/.config/Acme', { platform: 'linux', home: '/home/user', env: {} }, linuxFs), /越过用户 Home/)
  const windowsFs = {
    realpath: async (target) => ({ 'C:\\Users\\user': 'C:\\Users\\user', 'D:\\Redirected\\AppData': 'D:\\Redirected\\AppData', 'D:\\Redirected\\AppData\\Acme': 'D:\\Redirected\\AppData\\Acme' }[target]),
    lstat: async () => directoryInfo,
  }
  await assert.rejects(assertCanonicalSafeUserPath('D:\\Redirected\\AppData\\Acme', { platform: 'win32', home: 'C:\\Users\\user', env: { APPDATA: 'D:\\Redirected\\AppData' } }, windowsFs), /路径不在允许|越过用户 Home/)
})

test('streaming directory snapshots enforce entries, depth, deadline and device limits', async (t) => {
  const { root } = await fixture(t)
  const snapshotRoot = path.join(root, 'snapshot')
  await fs.mkdir(path.join(snapshotRoot, 'nested'), { recursive: true })
  await fs.writeFile(path.join(snapshotRoot, 'one'), '1')
  await fs.writeFile(path.join(snapshotRoot, 'two'), '2')
  const rootInfo = await fs.lstat(snapshotRoot)
  await assert.rejects(snapshotDirectory(snapshotRoot, fs, { rootDev: rootInfo.dev, maxEntries: 1 }), /项目超过安全上限/)
  await assert.rejects(snapshotDirectory(snapshotRoot, fs, { rootDev: rootInfo.dev, maxDepth: 0 }), /深度超过安全上限/)
  let clock = 0
  await assert.rejects(snapshotDirectory(snapshotRoot, fs, { rootDev: rootInfo.dev, deadlineMs: 1, now: () => { clock += 2; return clock } }), /超过安全时限/)
  const fakeFs = {
    opendir: async () => ({ async *[Symbol.asyncIterator]() { yield { name: 'mounted' } } }),
    lstat: async () => ({ dev: 2, ino: 1, size: 0, mtimeMs: 0, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true }),
  }
  await assert.rejects(snapshotDirectory('/safe', fakeFs, { rootDev: 1 }), /跨设备挂载/)
})

test('ancestor replaced by an escaping symlink after preview is blocked at execution', async (t) => {
  const { root, home, adapter } = await fixture(t)
  const parent = path.join(home, '.config', 'parent')
  const target = path.join(parent, 'Acme')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'settings.json'), '{}')
  adapter.inspectApp = async () => [{ path: target, category: 'config', confidence: 'exact', reason: 'fixture', selectedByDefault: true, ownership: 'user', deletable: true }]
  const trashed = []
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async (item) => trashed.push(item) })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  const original = path.join(home, '.config', 'parent-original')
  const outside = path.join(root, 'outside')
  await fs.rename(parent, original)
  await fs.mkdir(path.join(outside, 'Acme'), { recursive: true })
  await fs.symlink(outside, parent)
  const result = await engine.executePlan({ planId: plan.id, selectedIds: [plan.candidates[0].id], confirmation: 'Acme' })
  assert.equal(result.results[0].status, 'failed')
  assert.match(result.results[0].message, /真实路径越过/)
  assert.deepEqual(trashed, [])
})

test('validated candidate is passed to trash exactly once', async (t) => {
  const { home, target, adapter } = await fixture(t)
  const trashed = []
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async (item) => trashed.push(item) })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  const result = await engine.executePlan({ planId: plan.id, selectedIds: [plan.candidates[0].id], confirmation: 'Acme' })
  assert.deepEqual(trashed, [target])
  assert.equal(result.results[0].status, 'trashed')
})

test('mutable Windows registered uninstall command is rejected without execution', async (t) => {
  const { home, target, adapter } = await fixture(t)
  adapter.scanApps = async (ctx) => [{ id: `app_${ctx.secret.slice(0, 20)}`, platform: 'win32', name: 'Acme', version: null, publisher: null, appKey: 'Acme', rawUninstallCommand: 'C:\\Apps\\Acme\\uninstall.exe', install: { kind: 'registry', path: null, scope: 'user' }, uninstall: { mode: 'registered', requiresElevation: false, supported: true }, protected: false }]
  const trashed = []
  let execCalls = 0
  const engine = createEngine({ platform: 'win32', home, env: { APPDATA: path.join(home, '.config'), LOCALAPPDATA: path.join(home, '.cache'), SystemRoot: 'C:\\Windows' }, adapter, secret: 'secret', execFile: async () => { execCalls += 1 }, trashItem: async (item) => trashed.push(item) })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  // The fixture path uses POSIX semantics and is intentionally preview-only under the win32 boundary.
  const result = await engine.executePlan({ planId: plan.id, selectedIds: plan.candidates.map((item) => item.id), confirmation: 'Acme' })
  assert.equal(result.results[0].status, 'failed')
  assert.match(result.results[0].message, /自动执行已禁用/)
  assert.ok(result.results.slice(1).every((item) => item.status === 'skipped'))
  assert.deepEqual(trashed, [])
  assert.equal(execCalls, 0)
  assert.ok(target)
})

test('malicious Flatpak target never reaches execFile during execution', async () => {
  let execCalls = 0
  const adapter = {
    scanApps: async () => [{
      id: 'app_flatpak', platform: 'linux', name: 'Bad Flatpak', version: null, publisher: null,
      appKey: '--delete-data', flatpakTarget: '--delete-data', flatpakExecutable: '/usr/bin/flatpak',
      install: { kind: 'flatpak', path: null, scope: 'user' },
      uninstall: { mode: 'package-manager', requiresElevation: false, supported: true }, protected: false,
    }],
    inspectApp: async () => [],
  }
  const engine = createEngine({ platform: 'linux', home: '/tmp/user', adapter, secret: 'secret', execFile: async () => { execCalls += 1 } })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  const result = await engine.executePlan({ planId: plan.id, selectedIds: [], confirmation: 'Bad Flatpak' })
  assert.equal(result.results[0].status, 'failed')
  assert.match(result.results[0].message, /包管理器自动卸载已禁用/)
  assert.equal(execCalls, 0)
})

test('symbol links are preview-only and never passed to trash', async (t) => {
  const { root, home, target, adapter } = await fixture(t)
  const link = path.join(home, '.config', 'Link')
  await fs.symlink(target, link)
  adapter.inspectApp = async () => [{ path: link, category: 'config', confidence: 'exact', reason: 'fixture', selectedByDefault: true, ownership: 'user', deletable: true }]
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async () => assert.fail('must not trash') })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  assert.equal(plan.candidates[0].deletable, false)
  assert.match(plan.candidates[0].reason, /符号链接/)
  assert.ok(root)
})

test('plan is single-use and expires', async (t) => {
  const { home, adapter } = await fixture(t)
  let now = 1_000
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', now: () => now, trashItem: async () => {} })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  await engine.executePlan({ planId: plan.id, selectedIds: [], confirmation: 'Acme' })
  await assert.rejects(engine.executePlan({ planId: plan.id, selectedIds: [], confirmation: 'Acme' }), /已使用/)
  const second = await engine.inspectApp(scan.apps[0].id); now += 121_000
  await assert.rejects(engine.executePlan({ planId: second.id, selectedIds: [], confirmation: 'Acme' }), /已过期/)
})

test('a new preview invalidates the previous hidden plan', async (t) => {
  const { home, adapter } = await fixture(t)
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret' })
  const scan = await engine.scanApps()
  const first = await engine.inspectApp(scan.apps[0].id)
  const second = await engine.inspectApp(scan.apps[0].id)

  assert.notEqual(first.id, second.id)
  await assert.rejects(engine.executePlan({ planId: first.id, selectedIds: [], confirmation: 'Acme' }), /不存在或已失效/)
})

test('a failed replacement inspection still invalidates the hidden plan', async (t) => {
  const { home, adapter } = await fixture(t)
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret' })
  const scan = await engine.scanApps()
  const first = await engine.inspectApp(scan.apps[0].id)
  adapter.inspectApp = async () => { throw new Error('inspection failed') }

  await assert.rejects(engine.inspectApp(scan.apps[0].id), /inspection failed/)
  await assert.rejects(engine.executePlan({ planId: first.id, selectedIds: [], confirmation: 'Acme' }), /不存在或已失效/)
})

test('concurrent scans are single-flight', async () => {
  let calls = 0
  let resolveScan
  const pending = new Promise((resolve) => { resolveScan = resolve })
  const adapter = { scanApps: async () => { calls += 1; await pending; return [] }, inspectApp: async () => [] }
  const engine = createEngine({ platform: 'linux', home: '/tmp/user', adapter, secret: 'secret' })
  const left = engine.scanApps(); const right = engine.scanApps()
  resolveScan()
  await Promise.all([left, right])
  assert.equal(calls, 1)
})

test('scan, inspect, and execute share one bounded action gate', async () => {
  let inspectCalls = 0
  let releaseInspect
  const inspectGate = new Promise((resolve) => { releaseInspect = resolve })
  const base = { platform: 'linux', version: null, publisher: null, appKey: 'fixture', install: { kind: 'desktop', path: null, scope: 'user' }, uninstall: { mode: 'manual', requiresElevation: false, supported: false }, protected: false }
  const adapter = {
    scanApps: async () => [
      { ...base, id: 'app_first', name: 'First' },
      { ...base, id: 'app_second', name: 'Second' },
    ],
    inspectApp: async () => { inspectCalls += 1; await inspectGate; return [] },
  }
  const engine = createEngine({ platform: 'linux', home: '/tmp/user', adapter, secret: 'secret' })
  const scan = await engine.scanApps()
  const first = engine.inspectApp(scan.apps[0].id)
  const coalesced = engine.inspectApp(scan.apps[0].id)

  await assert.rejects(engine.inspectApp(scan.apps[1].id), (error) => error.code === 'ENGINE_BUSY')
  const coalescedAfterConflict = engine.inspectApp(scan.apps[0].id)
  await assert.rejects(engine.scanApps(), (error) => error.code === 'ENGINE_BUSY')
  releaseInspect()
  const [left, right, afterConflict] = await Promise.all([first, coalesced, coalescedAfterConflict])
  assert.equal(left.id, right.id)
  assert.equal(left.id, afterConflict.id)
  assert.equal(inspectCalls, 1)
})

test('only one execute action can revalidate or trash at a time', async (t) => {
  const { home, adapter } = await fixture(t)
  let releaseTrash
  const trashGate = new Promise((resolve) => { releaseTrash = resolve })
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret', trashItem: async () => trashGate })
  const scan = await engine.scanApps()
  const firstPlan = await engine.inspectApp(scan.apps[0].id)
  const first = engine.executePlan({ planId: firstPlan.id, selectedIds: [firstPlan.candidates[0].id], confirmation: 'Acme' })

  await assert.rejects(engine.executePlan({ planId: firstPlan.id, selectedIds: [firstPlan.candidates[0].id], confirmation: 'Acme' }), (error) => error.code === 'ENGINE_BUSY')
  await assert.rejects(engine.scanApps(), (error) => error.code === 'ENGINE_BUSY')
  releaseTrash()
  await first
})

test('uninstall journal records each in-progress item before moving it', async (t) => {
  const { home, adapter } = await fixture(t)
  const storage = new Map()
  const journalStore = {
    async get(key) { return storage.get(key) || null },
    async set(key, value) { storage.set(key, value) },
    async remove(key) { storage.delete(key) },
  }
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const engine = createEngine({ platform: 'linux', home, adapter, storage: journalStore, secret: 'journal', trashItem: async () => gate })
  const scan = await engine.scanApps()
  const plan = await engine.inspectApp(scan.apps[0].id)
  const execution = engine.executePlan({ planId: plan.id, selectedIds: [plan.candidates[0].id], confirmation: 'Acme' })
  let journal
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    journal = JSON.parse(storage.get('application-uninstall-v1'))
    if (journal.entries[0].status === 'in-progress') break
  }
  assert.equal(journal.status, 'in-progress')
  assert.equal(journal.entries[0].status, 'in-progress')
  release()
  await execution
  const completed = JSON.parse(storage.get('application-uninstall-v1'))
  assert.equal(completed.status, 'completed')
})

test('new session treats pending uninstall entries as recovery-required without retrying', async (t) => {
  const { home, target, adapter } = await fixture(t)
  const values = new Map([['application-uninstall-v1', JSON.stringify({
    version: JOURNAL_VERSION,
    operationId: 'operation-pending',
    status: 'running',
    startedAt: new Date().toISOString(),
    entries: [{ candidateId: 'candidate-pending', path: target, status: 'pending', result: null }],
  })]])
  const storage = {
    async get(key) { return values.get(key) || null },
    async set(key, value) { values.set(key, value) },
    async remove(key) { values.delete(key) },
  }
  const engine = createEngine({ platform: 'linux', home, adapter, storage, secret: 'pending' })
  const scan = await engine.scanApps()
  assert.match(scan.warnings.join(' '), /未完成.*未自动重试/)
  const reconciled = JSON.parse(values.get('application-uninstall-v1'))
  assert.equal(reconciled.status, 'recovery-required')
})

test('expired uninstall journal is removed during the next inventory scan', async (t) => {
  const { home, adapter } = await fixture(t)
  const values = new Map([['application-uninstall-v1', JSON.stringify({
    version: JOURNAL_VERSION,
    operationId: 'operation-expired',
    status: 'completed',
    startedAt: new Date(Date.now() - JOURNAL_TTL_MS - 1).toISOString(),
    completedAt: new Date(Date.now() - JOURNAL_TTL_MS - 1).toISOString(),
    entries: [],
  })]])
  const storage = {
    async get(key) { return values.get(key) || null },
    async set(key, value) { values.set(key, value) },
    async remove(key) { values.delete(key) },
  }
  const engine = createEngine({ platform: 'linux', home, adapter, storage, secret: 'expired' })
  const scan = await engine.scanApps()
  assert.match(scan.warnings.join(' '), /过期.*清理/)
  assert.equal(values.has('application-uninstall-v1'), false)
})

test('shutdown rejects a new uninstall write', async (t) => {
  const { home, adapter } = await fixture(t)
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'shutdown' })
  const scan = await engine.scanApps()
  const plan = await engine.inspectApp(scan.apps[0].id)
  await engine.shutdown()
  await assert.rejects(engine.executePlan({ planId: plan.id, selectedIds: [plan.candidates[0].id], confirmation: 'Acme' }), (error) => error.code === 'SHUTTING_DOWN')
})

test('duplicate adapter IDs are filtered before public rows can diverge from the inspect map', async () => {
  const base = { id: 'app_duplicate', platform: 'linux', version: null, publisher: null, appKey: 'duplicate', install: { kind: 'desktop', path: null, scope: 'user' }, uninstall: { mode: 'manual', requiresElevation: false, supported: false }, protected: false }
  const adapter = {
    scanApps: async () => [{ ...base, name: 'First' }, { ...base, name: 'Second' }],
    inspectApp: async () => [],
  }
  const engine = createEngine({ platform: 'linux', home: '/tmp/user', adapter, secret: 'secret' })
  const scan = await engine.scanApps()
  assert.deepEqual(scan.apps.map((app) => app.name), ['First'])
  assert.ok(scan.warnings.some((warning) => warning.includes('重复')))
  const plan = await engine.inspectApp(scan.apps[0].id)
  assert.equal(plan.app.name, 'First')
})

test('adapter scan failures remain visible as structured warnings', async () => {
  const adapter = { scanApps: async () => ({ apps: [], warnings: ['读取应用目录失败'] }), inspectApp: async () => [] }
  const engine = createEngine({ platform: 'linux', home: '/tmp/user', adapter, secret: 'secret' })
  const result = await engine.scanApps()
  assert.deepEqual(result.apps, [])
  assert.deepEqual(result.warnings, ['读取应用目录失败'])
})

test('strong name-only candidates produce a plan warning and stay unselected', async (t) => {
  const { home, target, adapter } = await fixture(t)
  adapter.inspectApp = async () => [{ path: target, category: 'config', confidence: 'strong', reason: '通用显示名 Helper', selectedByDefault: false, ownership: 'user', deletable: true }]
  const engine = createEngine({ platform: 'linux', home, adapter, secret: 'secret' })
  const scan = await engine.scanApps(); const plan = await engine.inspectApp(scan.apps[0].id)
  assert.equal(plan.candidates[0].selectedByDefault, false)
  assert.ok(plan.warnings.some((warning) => warning.includes('同名应用')))
})
