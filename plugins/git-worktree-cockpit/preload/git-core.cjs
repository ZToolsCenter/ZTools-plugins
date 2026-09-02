'use strict'
const path = require('node:path')
const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')
const MAX_OUTPUT = 4 * 1024 * 1024
const MAX_ARGS = 24
const MAX_REPOS = 30
const MAX_WORKTREES = 50
function platformPath(platform) { return platform === 'win32' ? path.win32 : path }
function isAbsolute(value, platform) { return typeof value === 'string' && value.length > 0 && value.length < 4096 && platformPath(platform).isAbsolute(value) }
function gitCandidates(platform, env) {
  const p = platformPath(platform); const separator = platform === 'win32' ? ';' : ':'
  const names = platform === 'win32' ? ['git.exe'] : ['git']
  const pathEntries = String((env || process.env).PATH || '').split(separator).filter(Boolean)
  const common = platform === 'win32' ? ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe'] : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']
  return [...new Set([...pathEntries.flatMap(dir => names.map(name => p.join(dir, name))), ...common])]
}
function parseWorktreeList(payload) {
  const records = String(payload || '').split('\0').filter(Boolean); const result = []; let current
  for (const record of records) {
    const space = record.indexOf(' '); const key = space < 0 ? record : record.slice(0, space); const value = space < 0 ? '' : record.slice(space + 1)
    if (key === 'worktree') { if (current) result.push(current); current = { path: value, head: null, branch: null, detached: false, bare: false, locked: null, prunable: null } }
    else if (current && key === 'HEAD') current.head = value
    else if (current && key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (current && key === 'detached') current.detached = true
    else if (current && key === 'bare') current.bare = true
    else if (current && key === 'locked') current.locked = value || true
    else if (current && key === 'prunable') current.prunable = value || true
  }
  if (current) result.push(current); if (result.length > MAX_WORKTREES) throw new RangeError('Git 工作树数量超过限制。'); return result
}
function parseStatus(payload) {
  const values = String(payload || '').split('\0'); const status = { head: null, oid: null, upstream: null, ahead: 0, behind: 0, dirty: false, entries: 0 }
  for (let index = 0; index < values.length; index += 1) {
    const line = values[index]
    if (!line) continue
    if (line.startsWith('# branch.head ')) status.head = line.slice(14)
    else if (line.startsWith('# branch.oid ')) status.oid = line.slice(13)
    else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) { const match = line.match(/\+(\d+)\s+-(\d+)/); if (match) { status.ahead = Number(match[1]); status.behind = Number(match[2]) } }
    else if (!line.startsWith('#')) {
      status.dirty = true; status.entries += 1
      if (line.startsWith('2 ')) index += 1
    }
  }
  return status
}
function repositoryInputError() { return Object.assign(new Error('仓库路径必须是绝对路径。'), { code: 'REPOSITORY_INVALID' }) }
function repositoryInvalidError() { return Object.assign(new Error('所选目录不是可用的 Git 仓库目录。'), { code: 'REPOSITORY_INVALID' }) }
function repositoryUnavailableError() { return Object.assign(new Error('无法访问或验证所选仓库，请重新选择。'), { code: 'REPOSITORY_UNAVAILABLE' }) }
async function authorizeRepository(candidate, dependencies) {
  const io = dependencies || fs
  try {
    if (!isAbsolute(candidate, process.platform)) throw repositoryInputError()
    const entry = await io.lstat(candidate); if (!entry.isDirectory() || entry.isSymbolicLink()) throw repositoryInvalidError()
    const real = await io.realpath(candidate); if (path.relative(real, candidate).startsWith('..')) throw repositoryInvalidError()
    const gitDir = path.join(real, '.git'); const gitEntry = await io.lstat(gitDir); if (gitEntry.isSymbolicLink()) throw repositoryInvalidError()
    return real
  } catch (error) {
    if (error && (error.code === 'REPOSITORY_INVALID' || error.code === 'REPOSITORY_UNAVAILABLE')) throw error
    throw repositoryUnavailableError()
  }
}
function createRunner(dependencies) {
  const invoke = (dependencies && dependencies.execFile) || execFile
  return Object.freeze({ run(file, args, cwd) {
    if (!isAbsolute(file, process.platform)) return Promise.reject(new Error('Git 可执行文件必须使用绝对路径。'))
    if (!Array.isArray(args) || !args.length || args.length > MAX_ARGS || args.some(arg => typeof arg !== 'string' || arg.length > 1024)) return Promise.reject(new Error('固定 Git 参数无效。'))
    const allowed = (args.join('\0') === ['--no-optional-locks', '--version'].join('\0')) ||
      (args.join('\0') === ['--no-optional-locks', 'worktree', 'list', '--porcelain', '-z'].join('\0')) ||
      (args.length === 9 && args[0] === '--no-optional-locks' && args[1] === '-c' && args[2] === 'core.fsmonitor=false' && args[3] === '-C' && isAbsolute(args[4], process.platform) && args.slice(5).join('\0') === ['status', '--porcelain=v2', '-z', '--branch'].join('\0'))
    if (!allowed) return Promise.reject(new Error('Git 参数不在只读允许列表中。'))
    if (!isAbsolute(cwd, process.platform)) return Promise.reject(new Error('仓库路径必须是绝对路径。'))
    const env = Object.fromEntries(Object.entries({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, TMP: process.env.TMP, TEMP: process.env.TEMP, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }).filter(([, value]) => typeof value === 'string' && value.length))
    return new Promise((resolve, reject) => invoke(file, args, { cwd, shell: false, windowsHide: true, timeout: 15000, maxBuffer: MAX_OUTPUT, env }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stderr: String(stderr).slice(0, 2000) })) : resolve(String(stdout))))
  } })
}
async function resolveGit(override, platform, env, dependencies) {
  const targetPlatform = platform || process.platform; const io = dependencies && dependencies.fs || fs
  const runner = createRunner(dependencies); const values = override ? [override] : gitCandidates(targetPlatform, env)
  for (const value of values) {
    if (!isAbsolute(value, targetPlatform)) continue
    try {
      const resolved = await io.realpath(value); const entry = await io.stat(resolved)
      if (!entry.isFile()) continue
      await runner.run(resolved, ['--no-optional-locks', '--version'], process.cwd())
      return resolved
    } catch {}
  }
  throw new Error('未找到经过验证且使用绝对路径的 Git 可执行文件。')
}
function snapshotMarkdown(data) {
  const cell = (value) => String(value || '—').replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/`/g, '\\`')
  const lines = ['# Git 工作树快照', '', '仓库：' + cell(data.repository), '', '| 工作树 | 分支 | 状态 |', '| --- | --- | --- |']
  for (const item of data.worktrees) lines.push('| ' + cell(item.label || item.path) + ' | ' + cell(item.branch || (item.detached ? '游离' : '—')) + ' | ' + (item.status ? (item.status.dirty ? '有改动' : '干净') : '不可用') + ' |')
  return lines.join('\n')
}
function samePath(left, right, platform) {
  const p = platformPath(platform || process.platform)
  if (!isAbsolute(left, platform || process.platform) || !isAbsolute(right, platform || process.platform)) return false
  const normalizedLeft = p.normalize(left)
  const normalizedRight = p.normalize(right)
  return (platform || process.platform) === 'win32' ? normalizedLeft.toLocaleLowerCase('en-US') === normalizedRight.toLocaleLowerCase('en-US') : normalizedLeft === normalizedRight
}
async function inspect(repository, gitExecutable, dependencies) {
  const safeRepo = await authorizeRepository(repository, dependencies && dependencies.fs); const runner = createRunner(dependencies)
  const list = parseWorktreeList(await runner.run(gitExecutable, ['--no-optional-locks', 'worktree', 'list', '--porcelain', '-z'], safeRepo))
  const policy = dependencies && typeof dependencies.shouldInspect === 'function' ? dependencies.shouldInspect : () => true
  const filtered = dependencies && dependencies.filterWorktrees === true
  const selected = []
  for (const item of list) {
    let allowed = false
    try { allowed = policy(item, safeRepo) === true } catch {}
    if (allowed) selected.push(item)
    else if (!filtered) selected.push({ ...item, __skipStatus: true })
  }
  const worktrees = new Array(selected.length); const deadline = Date.now() + 20000; let cursor = 0
  async function worker() {
    while (cursor < selected.length) {
      const index = cursor++; const item = selected[index]
      if (item.__skipStatus) { const { __skipStatus, ...visible } = item; worktrees[index] = { ...visible, status: null, statusUnavailable: 'not-authorized' }; continue }
      if (item.prunable || Date.now() > deadline) { worktrees[index] = { ...item, status: null, statusUnavailable: item.prunable ? 'prunable' : 'deadline' }; continue }
      try { worktrees[index] = { ...item, status: parseStatus(await runner.run(gitExecutable, ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', item.path, 'status', '--porcelain=v2', '-z', '--branch'], safeRepo)) } }
      catch (error) { worktrees[index] = { ...item, status: null, statusUnavailable: String(error.message || 'unavailable').slice(0, 120) } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker))
  return { repository: safeRepo, worktrees, markdown: snapshotMarkdown({ repository: safeRepo, worktrees }) }
}
module.exports = Object.freeze({ MAX_REPOS, isAbsolute, gitCandidates, parseWorktreeList, parseStatus, authorizeRepository, createRunner, resolveGit, inspect, snapshotMarkdown, samePath })
