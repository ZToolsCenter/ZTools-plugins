'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
function loadWithHost(ztools) {
  global.window = { ztools }
  delete require.cache[require.resolve('../preload/services.cjs')]
  return require('../preload/services.cjs')
}
test('manifest declarations and preload registrations use the same short MCP name', () => {
  const calls = new Map()
  const service = loadWithHost({ registerTool(name, handler) { calls.set(name, handler) } })
  const manifest = require('../plugin.json')
  assert.deepEqual(Object.keys(manifest.tools), Object.values(service.TOOL_NAMES))
  assert.deepEqual([...calls.keys()], Object.values(service.TOOL_NAMES))
  delete global.window
})
test('legacy or failing registerTool hosts retain the renderer bridge', () => {
  loadWithHost({ registerTool() { throw new Error('unsupported') } })
  assert.equal(typeof global.window.gitWorktreeCockpit.chooseRepository, 'function')
  assert.equal(typeof global.window.gitWorktreeCockpit.inspectGrant, 'function')
  delete global.window
})
test('the single plugin-out callback emits only a path-free renderer session-ended signal', () => {
  let pluginOut; const events = []
  const service = loadWithHost({ onPluginOut(handler) { assert.equal(pluginOut, undefined); pluginOut = handler } })
  global.window.dispatchEvent = event => { events.push(event); return true }
  pluginOut()
  assert.equal(events.length, 1)
  assert.equal(events[0].type, service.__test.RENDERER_SESSION_ENDED)
  assert.equal(events[0].detail, undefined)
  assert.equal(Object.keys(global.window.gitWorktreeCockpit).includes('clearSession'), false)
  delete global.window
})
test('MCP snapshot returns only a changed-entry count even for a large status fixture', () => {
  const service = loadWithHost({})
  const rawPaths = Array.from({ length: 5000 }, (_, index) => `/secret/root/file-${index}`)
  const value = service.sanitizedSnapshot({ repository: '/approved/repo', worktrees: [{ path: '/approved/repo', head: 'abc', branch: 'main', status: { head: 'main', oid: 'abc', upstream: null, ahead: 0, behind: 0, dirty: true, entries: rawPaths.length, files: rawPaths } }] })
  assert.equal(value.repository, 'repository-1')
  assert.equal(value.totalWorktrees, 1)
  assert.equal(value.worktrees[0].label, 'worktree-1')
  assert.equal(value.worktrees[0].branch, 'branch-1')
  assert.equal(value.worktrees[0].status.changedEntryCount, 5000)
  assert.equal(value.worktrees[0].status.files, undefined)
  for (const secret of ['/secret/root', '/approved/repo', 'main', 'abc']) assert.equal(JSON.stringify(value).includes(secret), false)
  delete global.window
})
test('human Markdown localizes anonymous labels while JSON keeps stable machine values', () => {
  const service = loadWithHost({})
  const snapshot = { repository: '/private/repo', worktrees: [{ path: '/private/repo', branch: 'main', detached: false, bare: false, locked: false, prunable: false, status: { ahead: 0, behind: 0, dirty: false, entries: 0 } }] }
  const markdown = service.__test.stringifySnapshot(snapshot, 'markdown')
  assert.match(markdown, /仓库：仓库-1/)
  assert.match(markdown, /工作树-1/)
  assert.match(markdown, /分支-1/)
  assert.doesNotMatch(markdown, /repository-1|worktree-1|branch-1/)
  const json = JSON.parse(service.__test.stringifySnapshot(snapshot, 'json'))
  assert.equal(json.repository, 'repository-1')
  assert.equal(json.worktrees[0].label, 'worktree-1')
  assert.equal(json.worktrees[0].branch, 'branch-1')
  assert.doesNotMatch(JSON.stringify(json), /仓库-1|工作树-1|分支-1/)
  delete global.window
})
test('MCP snapshot calls the real handler for the latest UI grant and strips absolute paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-mcp-'))
  let repository = path.join(directory, 'approved-repository')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [repository], registerTool(name, handler) { calls.set(name, handler) } })
  await assert.rejects(calls.get(service.TOOL_NAMES.snapshotApproved)({}), (error) => error.code === 'UI_APPROVAL_REQUIRED')
  const chosen = await global.window.gitWorktreeCockpit.chooseRepository()
  assert.equal(typeof service.__test.grant(chosen.grantId).ctimeMs, 'number')
  const result = await calls.get(service.TOOL_NAMES.snapshotApproved)({})
  assert.equal(result.repository, 'repository-1')
  assert.equal(result.worktrees.length, 1)
  assert.equal(result.worktrees[0].label, 'worktree-1')
  for (const secret of [directory, repository, 'approved-repository']) assert.equal(JSON.stringify(result).includes(secret), false)
  await assert.rejects(calls.get(service.TOOL_NAMES.snapshotApproved)({ path: repository }), (error) => error.code === 'INVALID_TOOL_INPUT')
  const hostile = JSON.parse('{"__proto__":{"polluted":true}}')
  await assert.rejects(calls.get(service.TOOL_NAMES.snapshotApproved)(hostile), (error) => error.code === 'INVALID_TOOL_INPUT')
  let getterCalled = false
  const accessor = {}; Object.defineProperty(accessor, 'path', { enumerable: true, get() { getterCalled = true; return repository } })
  await assert.rejects(calls.get(service.TOOL_NAMES.snapshotApproved)(accessor), (error) => error.code === 'INVALID_TOOL_INPUT')
  assert.equal(getterCalled, false)
  const symbolInput = {}; symbolInput[Symbol('hidden')] = true
  await assert.rejects(calls.get(service.TOOL_NAMES.snapshotApproved)(symbolInput), (error) => error.code === 'INVALID_TOOL_INPUT')
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('human inspection performs a post-Git identity check and revokes on mismatch', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-human-postcheck-'))
  let repository = path.join(directory, 'approved-repository')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  const service = loadWithHost({ showOpenDialog: async () => [repository] })
  const chosen = await global.window.gitWorktreeCockpit.chooseRepository()
  const originalStat = fs.stat
  let repositoryChecks = 0
  fs.stat = async function patchedStat(value, ...rest) {
    const result = await originalStat.call(this, value, ...rest)
    if (path.resolve(String(value)) === repository) {
      repositoryChecks += 1
      if (repositoryChecks === 2) return { ...result, ctimeMs: result.ctimeMs + 1 }
    }
    return result
  }
  try {
    await assert.rejects(global.window.gitWorktreeCockpit.inspectGrant(chosen.grantId), /重新选择/)
  } finally {
    fs.stat = originalStat
  }
  assert.equal(repositoryChecks, 2)
  assert.equal(service.__test.activeGrantId(), null)
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('MCP inspection performs a post-Git identity check, revokes, and keeps errors path-free', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-mcp-postcheck-'))
  let repository = path.join(directory, 'approved-repository')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [repository], registerTool(name, handler) { calls.set(name, handler) } })
  await global.window.gitWorktreeCockpit.chooseRepository()
  const originalStat = fs.stat
  let repositoryChecks = 0
  fs.stat = async function patchedStat(value, ...rest) {
    const result = await originalStat.call(this, value, ...rest)
    if (path.resolve(String(value)) === repository) {
      repositoryChecks += 1
      if (repositoryChecks === 2) return { ...result, ctimeMs: result.ctimeMs + 1 }
    }
    return result
  }
  try {
    await assert.rejects(calls.get(service.TOOL_NAMES.snapshotApproved)({}), (error) => {
      assert.equal(error.code, 'APPROVED_REPOSITORY_FAILED')
      assert.equal(error.message.includes(directory), false)
      assert.equal(error.message.includes(repository), false)
      return true
    })
  } finally {
    fs.stat = originalStat
  }
  assert.equal(repositoryChecks, 2)
  assert.equal(service.__test.activeGrantId(), null)
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('ctime detects a same-directory identity rewrite even when mtime is restored', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-ctime-'))
  let repository = path.join(directory, 'approved-repository')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  const service = loadWithHost({ showOpenDialog: async () => [repository] })
  const chosen = await global.window.gitWorktreeCockpit.chooseRepository()
  const grant = service.__test.grant(chosen.grantId)
  const before = await fs.stat(repository)
  const marker = path.join(repository, 'identity-marker')
  await fs.writeFile(marker, 'x')
  await fs.rm(marker)
  await fs.utimes(repository, before.atime, before.mtime)
  const changed = await fs.stat(repository)
  grant.mtimeMs = changed.mtimeMs
  assert.equal(changed.dev, grant.dev)
  assert.equal(changed.ino, grant.ino)
  assert.notEqual(changed.ctimeMs, grant.ctimeMs)
  await assert.rejects(global.window.gitWorktreeCockpit.inspectGrant(chosen.grantId), /重新选择/)
  assert.equal(service.__test.activeGrantId(), null)
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('copy and save use an independent anonymous projection and refuse existing targets', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-share-'))
  let repository = path.join(directory, 'alice-private-project')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  const destination = path.join(directory, 'snapshot.json')
  const existing = path.join(directory, 'existing.md')
  await fs.writeFile(existing, 'keep-me')
  const copied = []
  let savePath = destination
  loadWithHost({ showOpenDialog: async () => [repository], showSaveDialog: async () => ({ canceled: false, filePath: savePath }), copyText(value) { copied.push(value); return true } })
  const chosen = await global.window.gitWorktreeCockpit.chooseRepository()
  await global.window.gitWorktreeCockpit.inspectGrant(chosen.grantId)
  await global.window.gitWorktreeCockpit.copySnapshot(chosen.grantId, 'markdown')
  await global.window.gitWorktreeCockpit.copySnapshot(chosen.grantId, 'json')
  await global.window.gitWorktreeCockpit.saveSnapshot(chosen.grantId, 'json')
  const saved = await fs.readFile(destination, 'utf8')
  for (const output of [...copied, saved]) {
    for (const secret of [directory, repository, 'alice-private-project', os.userInfo().username]) assert.equal(output.includes(secret), false)
  }
  assert.match(copied[0], /仓库-1/)
  assert.match(copied[0], /工作树-1/)
  assert.doesNotMatch(copied[0], /repository-1|worktree-1|branch-1/)
  for (const output of [copied[1], saved]) assert.match(output, /repository-1[\s\S]*worktree-1/)
  savePath = existing
  await assert.rejects(global.window.gitWorktreeCockpit.saveSnapshot(chosen.grantId, 'markdown'), (error) => error.code === 'DESTINATION_EXISTS' && /不能覆盖已有文件/.test(error.message))
  assert.equal(await fs.readFile(existing, 'utf8'), 'keep-me')
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('Windows and POSIX saves share the same atomic no-overwrite creation contract', async () => {
  const service = loadWithHost({})
  let options; const files = new Map(); let nextInode = 1
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  const io = {
    async lstat(value) { if (!files.has(value)) throw missing; return files.get(value).stat },
    async open(destination, flag, mode) {
      assert.match(destination, /snapshot\.json\.[a-f0-9]{24}\.tmp$/); assert.equal(flag, 'wx'); assert.equal(mode, 0o600); options = { flag, mode }
      if (files.has(destination)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      const record = { content: '', stat: { dev: 1, ino: nextInode++ } }; files.set(destination, record)
      return { async stat() { return record.stat }, async writeFile(content, value) { assert.equal(content, '{}\n'); assert.deepEqual(value, { encoding: 'utf8' }); record.content = content }, async close() {} }
    },
    async link(source, destination) { if (files.has(destination)) throw Object.assign(new Error('exists'), { code: 'EEXIST' }); files.set(destination, files.get(source)) },
    async unlink(value) { files.delete(value) }
  }
  await service.__test.writeNewFile('C:\\reports\\snapshot.json', '{}\n', io)
  assert.equal(options.flag, 'wx'); assert.equal(options.mode, 0o600)
  assert.equal(files.get('C:\\reports\\snapshot.json').content, '{}\n')
  await assert.rejects(service.__test.writeNewFile('/reports/existing.md', 'new', { async lstat() { return { isFile: () => true } }, async open() { throw new Error('must not open') } }), (error) => error.code === 'DESTINATION_EXISTS')
  await assert.rejects(service.__test.writeNewFile('/reports/raced.md', 'new', { async lstat(value) { if (value === '/reports/raced.md') throw missing; return { dev: 1, ino: 1 } }, async open() { return { async stat() { return { dev: 1, ino: 1 } }, async writeFile() {}, async close() {} } }, async link() { throw Object.assign(new Error('exists'), { code: 'EEXIST' }) }, async unlink() {} }), (error) => error.code === 'DESTINATION_EXISTS')
  delete global.window
})
test('a stale save operation removes its temporary or just-linked output', async () => {
  const service = loadWithHost({})
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  for (const staleAfter of ['write', 'link', 'cleanup']) {
    const files = new Map(); let current = true
    const io = {
      async lstat(value) { if (!files.has(value)) throw missing; return files.get(value).stat },
      async open(value) { const record = { content: '', stat: { dev: 1, ino: 1 } }; files.set(value, record); return { async stat() { return record.stat }, async writeFile(content) { record.content = content; if (staleAfter === 'write') current = false }, async close() {} } },
      async link(source, destination) { files.set(destination, files.get(source)); if (staleAfter === 'link') current = false },
      async unlink(value) { files.delete(value); if (staleAfter === 'cleanup' && value.endsWith('.tmp')) current = false }
    }
    await assert.rejects(service.__test.writeNewFile('/reports/snapshot.json', '{}\n', io, () => { if (!current) throw Object.assign(new Error('ended'), { code: 'SESSION_ENDED' }) }), error => error.code === 'SESSION_ENDED')
    assert.equal(files.size, 0)
  }
  delete global.window
})
test('temporary unlink failure rolls back only this operation destination and clears its temp', async () => {
  const service = loadWithHost({}); const files = new Map(); const missing = Object.assign(new Error('missing'), { code: 'ENOENT' }); let failTempUnlink = true
  const io = {
    async lstat(value) { if (!files.has(value)) throw missing; return files.get(value).stat },
    async open(value) { const record = { content: '', stat: { dev: 1, ino: 10 } }; files.set(value, record); return { async stat() { return record.stat }, async writeFile(content) { record.content = content }, async close() {} } },
    async link(source, destination) { files.set(destination, files.get(source)) },
    async unlink(value) { if (value.endsWith('.tmp') && failTempUnlink) { failTempUnlink = false; throw Object.assign(new Error('/secret/temp: busy'), { code: 'EBUSY' }) } files.delete(value) }
  }
  await assert.rejects(service.__test.writeNewFile('/reports/snapshot.json', '{}\n', io), error => error.code === 'SAVE_FAILED' && !error.message.includes('/secret/temp'))
  assert.equal(files.size, 0)
  delete global.window
})
test('rollback failure is path-free and never unlinks a destination replaced by another writer', async () => {
  const service = loadWithHost({}); const files = new Map(); const missing = Object.assign(new Error('missing'), { code: 'ENOENT' }); let temporary; let temporaryUnlinkAttempts = 0
  const foreign = { content: 'other-writer', stat: { dev: 9, ino: 99 } }
  const io = {
    async lstat(value) { if (!files.has(value)) throw missing; return files.get(value).stat },
    async open(value) { temporary = value; const record = { content: '', stat: { dev: 1, ino: 10 } }; files.set(value, record); return { async stat() { return record.stat }, async writeFile(content) { record.content = content }, async close() {} } },
    async link(source, destination) { files.set(destination, files.get(source)) },
    async unlink(value) {
      if (value === temporary) {
        temporaryUnlinkAttempts += 1
        if (temporaryUnlinkAttempts === 1) { files.set('/reports/snapshot.json', foreign); throw Object.assign(new Error('/private/secret/temp busy'), { code: 'EBUSY' }) }
      }
      files.delete(value)
    }
  }
  await assert.rejects(service.__test.writeNewFile('/reports/snapshot.json', '{}\n', io), error => error.code === 'SAVE_FAILED' && !error.message.includes('/private/secret'))
  assert.equal(files.get('/reports/snapshot.json'), foreign)
  assert.equal([...files.keys()].some(value => value.endsWith('.tmp')), false)
  delete global.window
})
test('a colliding temporary name is never claimed or unlinked before exclusive open succeeds', async () => {
  const service = loadWithHost({}); const missing = Object.assign(new Error('missing'), { code: 'ENOENT' }); let opened = 0; let unlinked = 0
  const io = {
    async lstat() { throw missing },
    async open() { opened += 1; throw Object.assign(new Error('already exists'), { code: 'EEXIST' }) },
    async unlink() { unlinked += 1 }
  }
  await assert.rejects(service.__test.writeNewFile('/reports/snapshot.json', '{}\n', io), error => error.code === 'SAVE_FAILED')
  assert.equal(opened, 1); assert.equal(unlinked, 0)
  delete global.window
})
test('dialog and clipboard host errors use stable Chinese errors without paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-host-errors-'))
  let repository = path.join(directory, 'approved-repository'); execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' }); repository = await fs.realpath(repository)
  let phase = 'save'
  const service = loadWithHost({ showOpenDialog: async () => [repository], showSaveDialog: async () => { throw new Error('/private/secret/save-path') }, copyText: async () => { throw new Error('/private/secret/clipboard') } })
  const chosen = await global.window.gitWorktreeCockpit.chooseRepository(); await global.window.gitWorktreeCockpit.inspectGrant(chosen.grantId)
  await assert.rejects(global.window.gitWorktreeCockpit.saveSnapshot(chosen.grantId, 'json'), error => error.code === 'SAVE_FAILED' && !error.message.includes('/private/secret'))
  phase = 'copy'
  await assert.rejects(global.window.gitWorktreeCockpit.copySnapshot(chosen.grantId, 'json'), error => error.code === 'COPY_FAILED' && !error.message.includes('/private/secret'))
  assert.equal(phase, 'copy')
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('MCP snapshot revokes a deleted repository grant without leaking its absolute path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-mcp-deleted-'))
  let repository = path.join(directory, 'deleted-repository')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [repository], registerTool(name, handler) { calls.set(name, handler) } })
  await global.window.gitWorktreeCockpit.chooseRepository()
  await fs.rm(repository, { recursive: true, force: true })
  await assert.rejects(calls.get(service.TOOL_NAMES.snapshotApproved)({}), (error) => {
    assert.equal(error.code, 'APPROVED_REPOSITORY_FAILED')
    assert.equal(error.message.includes(directory), false)
    assert.equal(error.message.includes(repository), false)
    return true
  })
  assert.equal(service.__test.activeGrantId(), null)
  await assert.rejects(calls.get(service.TOOL_NAMES.snapshotApproved)({}), (error) => error.code === 'UI_APPROVAL_REQUIRED')
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('renderer bridge only accepts authorization ids, not repository or executable paths', () => {
  global.window = { ztools: {} }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const api = global.window.gitWorktreeCockpit
  assert.equal(typeof api.inspectGrant, 'function')
  assert.equal(api.inspect, undefined)
  assert.equal(api.resolveGit, undefined)
  assert.equal(api.gitCandidates, undefined)
  delete global.window
})
test('showOpenDialog accepts official string array result', async () => {
  global.window = { ztools: { showOpenDialog: async () => ['/definitely-not-a-repository'] } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  await assert.rejects(global.window.gitWorktreeCockpit.chooseRepository(), error => error.code === 'REPOSITORY_UNAVAILABLE' && !error.message.includes('/definitely-not-a-repository'))
  delete global.window
})
test('a directory chooser that resolves after plugin out cannot restore its grant', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-session-choose-'))
  let repository = path.join(directory, 'approved-repository')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  let resolveDialog
  const dialog = new Promise(resolve => { resolveDialog = resolve })
  const service = loadWithHost({ showOpenDialog: () => dialog })
  const pending = global.window.gitWorktreeCockpit.chooseRepository()
  service.__test.clearSession()
  resolveDialog([repository])
  await assert.rejects(pending, error => error.code === 'SESSION_ENDED')
  assert.equal(service.__test.activeGrantId(), null)
  assert.equal(service.__test.grant('anything'), undefined)
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('a save dialog that resolves after plugin out cannot create its selected file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-session-save-'))
  let repository = path.join(directory, 'approved-repository')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  const destination = path.join(directory, 'must-not-exist.json')
  let resolveDialog
  const dialog = new Promise(resolve => { resolveDialog = resolve })
  const service = loadWithHost({ showOpenDialog: async () => [repository], showSaveDialog: () => dialog })
  const chosen = await global.window.gitWorktreeCockpit.chooseRepository()
  await global.window.gitWorktreeCockpit.inspectGrant(chosen.grantId)
  const pending = global.window.gitWorktreeCockpit.saveSnapshot(chosen.grantId, 'json')
  service.__test.clearSession()
  resolveDialog({ canceled: false, filePath: destination })
  await assert.rejects(pending, error => error.code === 'SESSION_ENDED' && !error.message.includes(directory))
  await assert.rejects(fs.lstat(destination), error => error.code === 'ENOENT')
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
test('human and MCP snapshots started before plugin out never return stale results', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-session-mcp-'))
  let repository = path.join(directory, 'approved-repository')
  execFileSync('git', ['init', '-q', repository], { stdio: 'ignore' })
  repository = await fs.realpath(repository)
  const calls = new Map()
  const service = loadWithHost({ showOpenDialog: async () => [repository], registerTool(name, handler) { calls.set(name, handler) } })
  const chosen = await global.window.gitWorktreeCockpit.chooseRepository()
  const human = global.window.gitWorktreeCockpit.inspectGrant(chosen.grantId)
  service.__test.clearSession()
  await assert.rejects(human, /重新选择/)
  assert.equal(service.__test.activeGrantId(), null)
  const chosenAgain = await global.window.gitWorktreeCockpit.chooseRepository()
  const mcp = calls.get(service.TOOL_NAMES.snapshotApproved)({})
  service.__test.clearSession()
  await assert.rejects(mcp, error => error.code === 'APPROVED_REPOSITORY_FAILED' && !error.message.includes(repository))
  assert.equal(service.__test.activeGrantId(), null)
  assert.equal(service.__test.grant(chosenAgain.grantId), undefined)
  delete global.window
  await fs.rm(directory, { recursive: true, force: true })
})
