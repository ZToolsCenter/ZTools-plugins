'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const { createCleaner, isInside, measurePath, prepareRoots } = require('../public/preload/core.cjs')
const { platformRoots } = require('../public/preload/roots.cjs')

const testRoot = path.join(process.cwd(), '.test-tmp')

async function fixture(name) {
  const base = path.join(testRoot, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const home = path.join(base, 'home')
  const cache = path.join(home, 'cache')
  const temp = path.join(base, 'temp')
  await fs.mkdir(cache, { recursive: true })
  await fs.mkdir(temp, { recursive: true })
  return { base, home, cache, temp }
}

test.after(async () => { await fs.rm(testRoot, { recursive: true, force: true }) })

test('path containment rejects roots, siblings and traversal', () => {
  assert.equal(isInside('/safe/root', '/safe/root/item'), true)
  assert.equal(isInside('/safe/root', '/safe/root'), false)
  assert.equal(isInside('/safe/root', '/safe/root-other/item'), false)
  assert.equal(isInside('/safe/root', '/safe/item'), false)
})

test('scan only returns immediate safe candidates and skips symlinks', async (t) => {
  const dirs = await fixture('scan')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  const oldDirectory = path.join(dirs.cache, 'old-cache')
  await fs.mkdir(oldDirectory)
  await fs.writeFile(path.join(oldDirectory, 'data.bin'), Buffer.alloc(4096))
  const old = new Date(Date.now() - 20 * 86_400_000)
  await fs.utimes(oldDirectory, old, old)
  await fs.symlink(path.join(dirs.home, 'outside'), path.join(dirs.cache, 'escape-link'))

  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: dirs.temp,
    roots: [{ id: 'cache', label: '缓存', category: 'cache', path: dirs.cache, minAgeDays: 7, defaultSelected: true }],
    now: () => Date.now(),
    trashItem: async () => {}
  })
  const result = await cleaner.scan({ categories: ['cache'] })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].label, 'old-cache')
  assert.equal(result.candidates[0].selectedByDefault, true)
  assert.equal(result.candidates[0].sizeBytes, 4096)
  assert.match(result.candidates[0].location, /^~/)
  assert.equal(JSON.stringify(result).includes(dirs.home), false, 'absolute home path must not reach UI')
})

test('unsafe roots outside home and the home directory itself are ignored', async (t) => {
  const dirs = await fixture('roots')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  await fs.writeFile(path.join(dirs.home, 'personal.txt'), 'keep')
  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: dirs.temp,
    roots: [
      { id: 'home', label: 'home', category: 'cache', path: dirs.home },
      { id: 'outside', label: 'outside', category: 'cache', path: dirs.base }
    ],
    trashItem: async () => {}
  })
  const result = await cleaner.scan()
  assert.equal(result.candidates.length, 0)
})

test('configured cleanup roots reject symlinks into sensitive home directories', async (t) => {
  const dirs = await fixture('root-symlink')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  const documents = path.join(dirs.home, 'Documents')
  const redirectedCache = path.join(dirs.home, '.cache')
  await fs.mkdir(documents, { recursive: true })
  await fs.writeFile(path.join(documents, 'important.txt'), 'keep')
  await fs.symlink(documents, redirectedCache)
  let trashCalls = 0
  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: dirs.temp,
    roots: [{ id: 'cache', label: '缓存', category: 'cache', path: redirectedCache, minAgeDays: 0, defaultSelected: true }],
    trashItem: async () => { trashCalls += 1 },
  })

  const result = await cleaner.scan()
  assert.deepEqual(result.candidates, [])
  assert.equal(trashCalls, 0)
})

test('root preparation rejects lstat-to-realpath identity swaps', async () => {
  const directory = (dev, ino) => ({ dev, ino, isDirectory: () => true, isSymbolicLink: () => false })
  const fakeFs = {
    async realpath(target) {
      if (target === '/home/user') return '/real/home'
      if (target === '/home/user/.cache') return '/real/home/.cache'
      return target
    },
    async lstat(target) {
      if (target === '/home/user/.cache') return directory(1, 10)
      if (target === '/real/home/.cache') return directory(1, 11)
      throw new Error(`unexpected path: ${target}`)
    },
  }
  const prepared = await prepareRoots([{ id: 'cache', label: '缓存', category: 'cache', path: '/home/user/.cache' }], '/home/user', null, 501, fakeFs)
  assert.deepEqual(prepared, [])
})

test('clean requires typed confirmation and accepts only opaque snapshot candidates', async (t) => {
  const dirs = await fixture('clean')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  const target = path.join(dirs.cache, 'old.log')
  await fs.writeFile(target, 'diagnostic')
  const trashed = []
  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: dirs.temp,
    roots: [{ id: 'logs', label: '日志', category: 'logs', path: dirs.cache, minAgeDays: 0 }],
    trashItem: async (value) => { trashed.push(value) }
  })
  const snapshot = await cleaner.scan()
  await assert.rejects(() => cleaner.clean({ snapshotId: snapshot.snapshotId, candidateIds: [snapshot.candidates[0].id] }), /确认/)
  await assert.rejects(() => cleaner.clean({ snapshotId: snapshot.snapshotId, candidateIds: ['/etc/passwd'], confirmation: '移到废纸篓' }), /未知/)
  const result = await cleaner.clean({ snapshotId: snapshot.snapshotId, candidateIds: [snapshot.candidates[0].id], confirmation: '移到废纸篓' })
  assert.equal(result.results[0].status, 'trashed')
  assert.equal(result.movedBytes, Buffer.byteLength('diagnostic'))
  assert.equal('freedBytes' in result, false)
  assert.deepEqual(trashed, [target])
  await assert.rejects(() => cleaner.clean({ snapshotId: snapshot.snapshotId, candidateIds: [snapshot.candidates[0].id], confirmation: '移到废纸篓' }), /过期/)
})

test('scan and clean share one global action gate', async (t) => {
  const dirs = await fixture('global-gate')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  const target = path.join(dirs.cache, 'old-cache')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, 'data.bin'), 'cache')
  let releaseTrash
  const trashGate = new Promise((resolve) => { releaseTrash = resolve })
  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: dirs.temp,
    uid: process.getuid?.(),
    roots: [{ id: 'cache', category: 'cache', label: '缓存', path: dirs.cache, defaultSelected: true, minAgeDays: 0 }],
    trashItem: async () => trashGate,
  })
  const firstSnapshot = await cleaner.scan()
  const secondSnapshot = await cleaner.scan()
  const first = cleaner.clean({ snapshotId: firstSnapshot.snapshotId, candidateIds: [firstSnapshot.candidates[0].id], confirmation: '移到废纸篓' })

  await assert.rejects(cleaner.clean({ snapshotId: secondSnapshot.snapshotId, candidateIds: [secondSnapshot.candidates[0].id], confirmation: '移到废纸篓' }), (error) => error.code === 'CLEANER_BUSY')
  await assert.rejects(cleaner.scan(), (error) => error.code === 'CLEANER_BUSY')
  releaseTrash()
  await first
})

test('fingerprint changes are detected before destructive action', async (t) => {
  const dirs = await fixture('fingerprint')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  const target = path.join(dirs.cache, 'changing.tmp')
  await fs.writeFile(target, 'before')
  let trashCalls = 0
  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: dirs.temp,
    roots: [{ id: 'temp', label: '临时', category: 'temporary', path: dirs.cache, minAgeDays: 0 }],
    trashItem: async () => { trashCalls += 1 }
  })
  const snapshot = await cleaner.scan()
  await fs.writeFile(target, 'after-and-longer')
  const result = await cleaner.clean({ snapshotId: snapshot.snapshotId, candidateIds: [snapshot.candidates[0].id], confirmation: '移到废纸篓' })
  assert.equal(result.results[0].status, 'failed')
  assert.equal(result.results[0].code, 'FINGERPRINT_CHANGED')
  assert.equal(trashCalls, 0)
})

test('deep directory changes are detected before destructive action', async (t) => {
  const dirs = await fixture('tree-fingerprint')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  const target = path.join(dirs.cache, 'nested-cache')
  const nested = path.join(target, 'one', 'two')
  await fs.mkdir(nested, { recursive: true })
  await fs.writeFile(path.join(nested, 'before.bin'), 'before')
  let trashCalls = 0
  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: dirs.temp,
    roots: [{ id: 'cache', label: '缓存', category: 'cache', path: dirs.cache, minAgeDays: 0 }],
    trashItem: async () => { trashCalls += 1 }
  })
  const snapshot = await cleaner.scan()
  await fs.writeFile(path.join(nested, 'important-new-file.txt'), 'keep')
  const result = await cleaner.clean({ snapshotId: snapshot.snapshotId, candidateIds: [snapshot.candidates[0].id], confirmation: '移到废纸篓' })
  assert.equal(result.results[0].status, 'failed')
  assert.equal(result.results[0].code, 'CONTENT_CHANGED')
  assert.equal(trashCalls, 0)
})

test('unreadable or disappearing paths are skipped instead of aborting measurement', async (t) => {
  const dirs = await fixture('disappearing')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  const state = {
    entries: 0,
    unreadable: 0,
    truncated: false,
    missingRoot: false,
    rootDev: null,
    basePath: dirs.cache,
    digest: Buffer.alloc(32),
    deadline: Date.now() + 1_000,
    cancelled: () => false
  }
  assert.equal(await measurePath(path.join(dirs.cache, 'already-gone'), state), 0)
  assert.equal(state.unreadable, 1)
  assert.equal(state.missingRoot, true)
})

test('home-external temp root is rejected when ownership cannot be verified', async (t) => {
  const dirs = await fixture('shared-temp')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  await fs.writeFile(path.join(dirs.temp, 'other-user.tmp'), 'keep')
  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: dirs.temp,
    uid: null,
    roots: [{ id: 'shared-temp', label: '共享临时目录', category: 'temporary', path: dirs.temp, minAgeDays: 0, requireOwnership: true }],
    trashItem: async () => { throw new Error('must not be called') }
  })
  const result = await cleaner.scan()
  assert.equal(result.candidates.length, 0)
})

test('home-contained Windows-style temp remains available without POSIX uid', async (t) => {
  const dirs = await fixture('home-temp')
  t.after(() => fs.rm(dirs.base, { recursive: true, force: true }))
  const userTemp = path.join(dirs.home, 'AppData', 'Local', 'Temp')
  await fs.mkdir(userTemp, { recursive: true })
  await fs.writeFile(path.join(userTemp, 'safe-user.tmp'), 'cache')
  const cleaner = createCleaner({
    home: dirs.home,
    tempRoot: userTemp,
    uid: null,
    roots: [{ id: 'user-temp', label: '用户临时文件', category: 'temporary', path: userTemp, minAgeDays: 0, requireOwnership: true }],
    trashItem: async () => {}
  })
  const result = await cleaner.scan()
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].label, 'safe-user.tmp')
})

test('ownership traversal rejects a current-user directory containing a foreign-owned descendant', async () => {
  const root = path.join(path.sep, 'shared', 'current-user-dir')
  const child = path.join(root, 'foreign.bin')
  const makeStat = ({ directory, uid, ino }) => ({
    dev: 7,
    ino,
    uid,
    size: directory ? 64 : 5,
    mtimeMs: 100,
    mode: directory ? 0o40700 : 0o100600,
    isDirectory: () => directory,
    isSymbolicLink: () => false
  })
  const fakeFs = {
    async lstat(target) {
      if (target === root) return makeStat({ directory: true, uid: 501, ino: 1 })
      if (target === child) return makeStat({ directory: false, uid: 502, ino: 2 })
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    async opendir(target) {
      assert.equal(target, root)
      return { async *[Symbol.asyncIterator]() { yield { name: 'foreign.bin' } } }
    }
  }
  const state = {
    fs: fakeFs,
    entries: 0,
    unreadable: 0,
    truncated: false,
    missingRoot: false,
    foreignOwner: false,
    rootDev: 7,
    requiredUid: 501,
    basePath: root,
    digest: Buffer.alloc(32),
    deadline: Date.now() + 1_000,
    cancelled: () => false
  }
  await measurePath(root, state)
  assert.equal(state.foreignOwner, true)
})

test('platform policies expose conservative roots for macOS, Windows and Linux', () => {
  const mac = platformRoots('darwin', { home: '/Users/test', temp: '/private/var/folders/ab/abcdefghijk/T', env: {} })
  const win = platformRoots('win32', { home: 'C:\\Users\\test', temp: 'C:\\Users\\test\\Documents', env: { LOCALAPPDATA: 'C:\\Users\\test\\Documents', TEMP: 'C:\\Users\\test\\Documents' } })
  const linux = platformRoots('linux', { home: '/home/test', temp: '/home/test/Documents', env: { TMPDIR: '/home/test/Documents' } })
  assert.deepEqual(new Set(mac.map((item) => item.category)), new Set(['cache', 'logs', 'temporary']))
  assert.ok(win.some((item) => /CrashDumps/i.test(item.path)))
  assert.ok(linux.some((item) => item.path === '/home/test/.cache'))
  assert.equal(win.find((item) => item.id === 'user-temp').path, 'C:\\Users\\test\\AppData\\Local\\Temp')
  assert.equal(win.some((item) => item.path.includes('Documents')), false)
  assert.equal(linux.find((item) => item.id === 'user-temp').path, '/tmp')
  assert.equal(platformRoots('darwin', { home: '/Users/test', temp: '/Users/test/Documents' }).some((item) => item.id === 'user-temp'), false)
  assert.equal(mac.some((item) => item.category === 'trash'), false)
  assert.equal(linux.some((item) => item.category === 'trash'), false)
  assert.equal(win.find((item) => item.id === 'user-temp').requireOwnership, true)
  for (const roots of [mac, win, linux]) assert.ok(roots.every((item) => !/[?*]/.test(item.path)))
})
