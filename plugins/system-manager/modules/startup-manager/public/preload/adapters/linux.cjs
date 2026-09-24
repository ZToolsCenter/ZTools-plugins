'use strict'

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { copyString, createItem, safeBaseName } = require('../core/model.cjs')
const { assertMutableRoot, assertUnchanged, readMutableRoot, readState, stateEvidence } = require('../core/file-state.cjs')
const TOOL_ALLOWLIST = Object.freeze({
  systemctl: ['/usr/bin/systemctl', '/bin/systemctl'],
  crontab: ['/usr/bin/crontab', '/bin/crontab'],
})
const SYSTEMD_UNIT_PATTERN = /^[A-Za-z0-9_.@:][A-Za-z0-9_.@:-]*\.service$/

async function resolveTool(name, fileSystem = fs, preferred) {
  const allowed = TOOL_ALLOWLIST[name] || []
  const candidates = preferred ? [preferred] : allowed
  for (const candidate of candidates) {
    if (!allowed.includes(candidate) || !path.isAbsolute(candidate)) continue
    try { await fileSystem.access(candidate); return candidate } catch {}
  }
  const error = new Error(`${name} 不存在于受控绝对路径`)
  error.code = 'TOOL_UNAVAILABLE'
  throw error
}

function parseDesktopEntry(text) {
  const result = {}
  let section = ''
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const header = line.match(/^\[([^\]]+)]$/)
    if (header) { section = header[1]; continue }
    if (section !== 'Desktop Entry') continue
    const index = line.indexOf('=')
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return result
}

function booleanValue(value) { return /^(?:1|true|yes)$/i.test(String(value || '')) }
function isManageableSystemdState(value) { return value === 'enabled' || value === 'disabled' }

function setDesktopEnabled(text, enabled) {
  const lines = String(text).split(/\r?\n/)
  let sectionStart = -1
  let sectionEnd = lines.length
  let hiddenIndex = -1
  let gnomeIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*\[Desktop Entry]\s*$/.test(lines[index])) { sectionStart = index; continue }
    if (sectionStart >= 0 && index > sectionStart && /^\s*\[.+]\s*$/.test(lines[index])) { sectionEnd = index; break }
    if (sectionStart >= 0 && /^\s*Hidden\s*=/.test(lines[index])) hiddenIndex = index
    if (sectionStart >= 0 && /^\s*X-GNOME-Autostart-enabled\s*=/.test(lines[index])) gnomeIndex = index
  }
  if (sectionStart < 0) throw new Error('缺少 Desktop Entry 段')
  const hiddenValue = `Hidden=${enabled ? 'false' : 'true'}`
  const gnomeValue = `X-GNOME-Autostart-enabled=${enabled ? 'true' : 'false'}`
  const insertions = []
  if (hiddenIndex >= 0) lines[hiddenIndex] = hiddenValue
  else insertions.push(hiddenValue)
  if (gnomeIndex >= 0) lines[gnomeIndex] = gnomeValue
  else insertions.push(gnomeValue)
  if (insertions.length) lines.splice(sectionEnd, 0, ...insertions)
  return lines.join('\n')
}

function parseSystemdList(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [unit, state] = line.split(/\s+/, 2)
    return { unit: copyString(unit || ''), state: copyString(state || '') }
  }).filter((entry) => entry.unit.length <= 256 && entry.state.length <= 64 && SYSTEMD_UNIT_PATTERN.test(entry.unit))
}

async function listDesktopFiles(dir, fileSystem) {
  try {
    const directory = await fileSystem.opendir(dir)
    const files = []
    let complete = true
    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.endsWith('.desktop')) continue
      if (files.length === 400) { complete = false; break }
      files.push(path.join(dir, entry.name))
    }
    return { files, complete }
  } catch { return { files: [], complete: false } }
}

async function scanDesktop(deps, items, warnings, home) {
  const fileSystem = deps.fs || fs
  const locations = deps.desktopLocations || [
    { dir: path.join(home, '.config/autostart'), scope: 'user', label: '用户 XDG Autostart' },
    { dir: '/etc/xdg/autostart', scope: 'system', label: '系统 XDG Autostart' },
  ]
  for (const location of locations) {
    let rootEvidence = null
    if (location.scope === 'user') {
      try { rootEvidence = await readMutableRoot(location.dir, home, fileSystem) }
      catch { warnings.push(`${location.label} 根目录不是 realHome 内的普通目录，用户项目已拒绝扫描`); continue }
    }
    const listing = await listDesktopFiles(location.dir, fileSystem)
    if (!listing.complete) warnings.push(`${location.label} 超过400项或目录读取不完整，相关用户项目已降级为只读`)
    for (const file of listing.files) {
      try {
        const state = await readState(file, fileSystem)
        const evidence = stateEvidence(state)
        const data = parseDesktopEntry(state.content.toString('utf8'))
        const enabled = !booleanValue(data.Hidden) && !/^false$/i.test(data['X-GNOME-Autostart-enabled'] || '')
        items.push(createItem({
          key: `linux:desktop:${file}`, name: data.Name || path.basename(file, '.desktop'), scope: location.scope,
          kind: 'desktop-autostart', source: { label: location.label, location: file }, trigger: data.AutostartCondition || '登录时',
          commandSummary: data.Exec, enabled, running: null, status: enabled ? 'idle' : 'disabled',
          action: location.scope === 'user' && listing.complete ? { canToggle: true, requiresElevation: false, reason: '同步修改用户 .desktop 的 Hidden 与 GNOME 启用字段，可撤销' } : { canToggle: false, requiresElevation: location.scope === 'system', reason: location.scope === 'user' ? '目录超过可证明上限或读取不完整，当前仅支持查看' : '系统级 Autostart 仅支持查看' },
          metadata: { description: data.Comment }, internal: { file, evidence, rootEvidence },
        }, home))
      } catch { warnings.push(`${safeBaseName(file)}：无法读取或解析`) }
    }
  }
}

function parseActiveUnits(text) {
  const active = new Set()
  for (const line of String(text).split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/)
    if (SYSTEMD_UNIT_PATTERN.test(columns[0] || '') && columns[2] === 'active') active.add(columns[0])
  }
  return active
}

async function scanSystemd(deps, items, warnings, home) {
  if (!deps.resolvedTools.systemctl) return
  for (const user of [true, false]) {
    try {
      const args = [...(user ? ['--user'] : []), 'list-unit-files', '--type=service', '--no-legend', '--no-pager']
      const result = await deps.runner.runFile(deps.resolvedTools.systemctl, args, { timeoutMs: 6_000, maxOutput: 2 * 1024 * 1024 })
      let active = new Set()
      try {
        const activeResult = await deps.runner.runFile(deps.resolvedTools.systemctl, [...(user ? ['--user'] : []), 'list-units', '--type=service', '--all', '--no-legend', '--no-pager'], { timeoutMs: 6_000, maxOutput: 2 * 1024 * 1024 })
        active = parseActiveUnits(activeResult.stdout)
      } catch {}
      for (const entry of parseSystemdList(result.stdout).slice(0, 500)) {
        const enabled = /^(?:enabled|enabled-runtime|linked|linked-runtime)$/.test(entry.state)
        const running = active.has(entry.unit)
        items.push(createItem({
          key: `linux:systemd:${user ? 'user' : 'system'}:${entry.unit}`, name: entry.unit, scope: user ? 'user' : 'system', kind: 'systemd-unit',
          source: { label: user ? 'systemd 用户服务' : 'systemd 系统服务', location: entry.unit }, trigger: user ? '用户会话启动' : '系统启动',
          enabled, running, status: running ? 'running' : enabled ? 'idle' : entry.state,
          action: user && isManageableSystemdState(entry.state) ? { canToggle: true, requiresElevation: false, reason: '仅在 persistent enabled/disabled 间切换，可撤销' } : { canToggle: false, requiresElevation: !user, reason: user ? `该 unit 状态为 ${entry.state}，无法保证精确回滚，当前仅支持查看` : '系统服务仅支持查看' },
          metadata: { startType: entry.state }, internal: { unit: entry.unit, user, unitState: entry.state, toolPath: deps.resolvedTools.systemctl },
        }, home))
      }
    } catch (error) {
      if (user) warnings.push(`systemd 用户服务不可用：${error.code === 'ENOENT' ? '未安装 systemctl' : '当前会话无用户总线'}`)
    }
  }
}

async function scanCron(deps, items, warnings, home) {
  if (!deps.resolvedTools.crontab) return
  try {
    const result = await deps.runner.runFile(deps.resolvedTools.crontab, ['-l'], { timeoutMs: 3_000, maxOutput: 256 * 1024 })
    String(result.stdout).split(/\r?\n/).filter((line) => /^\s*@reboot\s+/.test(line)).slice(0, 100).forEach((line, index) => {
      items.push(createItem({ key: `linux:cron:${index}:${crypto.createHash('sha1').update(line).digest('hex')}`, name: `@reboot #${index + 1}`, scope: 'user', kind: 'cron', source: { label: '用户 crontab', location: 'crontab -l' }, trigger: '开机时', commandSummary: line.replace(/^\s*@reboot\s+/, ''), enabled: true, running: null, status: 'idle', action: { canToggle: false, requiresElevation: false, reason: '为避免重写整个 crontab，当前仅支持查看' } }, home))
    })
  } catch (error) {
    if (error.code !== 1) warnings.push('crontab 无法读取')
  }
}

async function scan(deps = {}) {
  const fileSystem = deps.fs || fs
  const home = deps.home || os.homedir()
  const items = []
  const warnings = []
  const resolvedTools = {}
  for (const name of Object.keys(TOOL_ALLOWLIST)) {
    try { resolvedTools[name] = await resolveTool(name, fileSystem, deps.toolPaths && deps.toolPaths[name]) }
    catch { warnings.push(`${name} 不存在于受控路径，相关来源不可用`) }
  }
  const scopedDeps = { ...deps, resolvedTools }
  await scanDesktop(scopedDeps, items, warnings, home)
  await scanSystemd(scopedDeps, items, warnings, home)
  await scanCron(scopedDeps, items, warnings, home)
  return { items, warnings }
}

async function writeAtomic(file, content, originalState, fileSystem) {
  const temp = `${file}.ztools-${process.pid}-${crypto.randomBytes(5).toString('hex')}.tmp`
  try {
    await fileSystem.writeFile(temp, content, { mode: 0o600, flag: 'wx' })
    const tempState = await readState(temp, fileSystem)
    if (tempState.parentRealPath !== originalState.parentRealPath) throw new Error('临时文件父目录发生变化')
    if (typeof fileSystem.chmod === 'function') await fileSystem.chmod(temp, originalState.mode)
    await assertUnchanged(file, originalState, fileSystem)
    const finalParent = await fileSystem.realpath(path.dirname(file))
    if (finalParent !== originalState.parentRealPath) {
      const error = new Error('rename 前父目录 realpath 已变化')
      error.code = 'ITEM_CHANGED'
      throw error
    }
    await assertUnchanged(file, originalState, fileSystem)
    // rename is atomic in the verified directory. A residual kernel scheduling
    // window remains between this final lstat/realpath check and rename.
    await fileSystem.rename(temp, file)
  } catch (error) {
    try { await fileSystem.unlink(temp) } catch {}
    throw error
  }
}

async function readSystemdEnabledState(runner, toolPath, unit) {
  return runner.runFile(toolPath, ['--user', 'is-enabled', '--', unit], { timeoutMs: 2_000 })
    .then((value) => value.stdout.trim(), (error) => String(error.stdout || '').trim() || 'unknown')
}

async function restoreSystemdEnabledState(runner, toolPath, unit, originalState) {
  let commandError = null
  try {
    await runner.runFile(toolPath, ['--user', originalState === 'enabled' ? 'enable' : 'disable', '--', unit])
  } catch (error) {
    commandError = error
  }
  const restored = await readSystemdEnabledState(runner, toolPath, unit)
  if (restored !== originalState) {
    const error = new Error('systemd unit 回滚失败，无法证明已恢复原状态')
    error.code = 'ROLLBACK_FAILED'
    error.expectedState = originalState
    error.actualState = restored
    if (commandError) error.rollbackCause = commandError
    throw error
  }
}

async function applyEnabled(item, enabled, deps = {}) {
  const fileSystem = deps.fs || fs
  if (item.kind === 'desktop-autostart') {
    const { file, evidence } = item.internal
    await assertMutableRoot(item.internal.rootEvidence, fileSystem)
    const current = await assertUnchanged(file, evidence, fileSystem)
    const next = setDesktopEnabled(current.content.toString('utf8'), enabled)
    await writeAtomic(file, next, current, fileSystem)
    const nextState = await readState(file, fileSystem)
    const verified = parseDesktopEntry(nextState.content.toString('utf8'))
    const verifiedEnabled = !booleanValue(verified.Hidden) && !/^false$/i.test(verified['X-GNOME-Autostart-enabled'] || '')
    if (verifiedEnabled !== enabled) {
      try { await writeAtomic(file, current.content, nextState, fileSystem) } catch {}
      const error = new Error('Autostart 文件未进入请求状态，已尝试恢复'); error.code = 'VERIFY_FAILED'; throw error
    }
    item.internal.evidence = stateEvidence(nextState)
    return { kind: 'linux-desktop', enabled: !enabled, content: current.content.toString('base64'), evidence: stateEvidence(nextState) }
  }
  if (item.kind === 'systemd-unit') {
    const { unit, user, unitState } = item.internal
    if (!user || !SYSTEMD_UNIT_PATTERN.test(unit) || !isManageableSystemdState(unitState)) throw new Error('该项目仅支持查看')
    const toolPath = await resolveTool('systemctl', fileSystem, item.internal.toolPath)
    const current = await readSystemdEnabledState(deps.runner, toolPath, unit)
    if (current !== unitState) { const error = new Error('项目状态已变化，请刷新后重试'); error.code = 'ITEM_CHANGED'; throw error }
    const expectedState = enabled ? 'enabled' : 'disabled'
    try {
      await deps.runner.runFile(toolPath, ['--user', enabled ? 'enable' : 'disable', '--', unit])
      const verified = await readSystemdEnabledState(deps.runner, toolPath, unit)
      if (verified !== expectedState) {
        const error = new Error('systemd unit 未进入请求状态')
        error.code = 'VERIFY_FAILED'
        throw error
      }
    } catch (operationError) {
      try {
        await restoreSystemdEnabledState(deps.runner, toolPath, unit, unitState)
      } catch (rollbackError) {
        rollbackError.cause = operationError
        throw rollbackError
      }
      operationError.rollbackRestored = true
      if (operationError.code === 'VERIFY_FAILED') operationError.message = 'systemd unit 未进入请求状态，已恢复原状态'
      throw operationError
    }
    const running = await deps.runner.runFile(toolPath, ['--user', 'is-active', '--quiet', '--', unit], { timeoutMs: 2_000 }).then(() => true, () => false)
    item.internal.unitState = expectedState
    return { kind: 'linux-systemd', enabled: !enabled, state: { enabled, running } }
  }
  throw new Error('该项目仅支持查看')
}

async function undo(item, rollback, deps = {}) {
  if (rollback.kind === 'linux-desktop') {
    const fileSystem = deps.fs || fs
    const { file } = item.internal
    await assertMutableRoot(item.internal.rootEvidence, fileSystem)
    const current = await assertUnchanged(file, rollback.evidence, fileSystem)
    await writeAtomic(file, Buffer.from(rollback.content, 'base64'), current, fileSystem)
    item.internal.evidence = stateEvidence(await readState(file, fileSystem))
    return { restored: true }
  }
  return applyEnabled(item, rollback.enabled, deps)
}

module.exports = { SYSTEMD_UNIT_PATTERN, TOOL_ALLOWLIST, applyEnabled, isManageableSystemdState, parseActiveUnits, parseDesktopEntry, parseSystemdList, resolveTool, scan, setDesktopEnabled, undo, writeAtomic }
