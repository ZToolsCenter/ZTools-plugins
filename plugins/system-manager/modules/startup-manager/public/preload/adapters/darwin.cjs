const { getAppIconDataUrl, getLetterSvgIcon } = require('../icon-helper.cjs');
'use strict'

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { copyString, createItem, safeBaseName } = require('../core/model.cjs')
const { readMutableRoot, readState } = require('../core/file-state.cjs')

const MAX_FILES_PER_LOCATION = 1_500
const SCAN_DEADLINE_MS = 10_000
const IO_CONCURRENCY = 8
const TOOLS = Object.freeze({ launchctl: '/bin/launchctl', plutil: '/usr/bin/plutil' })

function defaultLocations(home) {
  return [
    { dir: path.join(home, 'Library/LaunchAgents'), scope: 'user', kind: 'launch-agent', label: '用户 LaunchAgents' },
    { dir: '/Library/LaunchAgents', scope: 'system', kind: 'launch-agent', label: '系统 LaunchAgents' },
    { dir: '/Library/LaunchDaemons', scope: 'system', kind: 'launch-daemon', label: '系统 LaunchDaemons' },
    { dir: '/System/Library/LaunchAgents', scope: 'system', kind: 'launch-agent', label: 'macOS LaunchAgents' },
    { dir: '/System/Library/LaunchDaemons', scope: 'system', kind: 'launch-daemon', label: 'macOS LaunchDaemons' },
  ]
}

function parsePlistJson(text) {
  const value = typeof text === 'string' ? JSON.parse(text) : text
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid plist value')
  return value
}

async function listPlists(location, fileSystem) {
  try {
    const directory = await fileSystem.opendir(location.dir)
    const names = []
    let complete = true
    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.plist')) continue
      if (names.length === MAX_FILES_PER_LOCATION) { complete = false; break }
      names.push(entry.name)
    }
    names.sort()
    return { files: names.map((name) => path.join(location.dir, name)), names, complete }
  } catch {
    return { files: [], names: [], complete: false }
  }
}

async function mapBounded(values, worker, deadlineAt, concurrency = IO_CONCURRENCY) {
  const results = new Array(values.length)
  let cursor = 0
  let deadlineExceeded = false
  async function run() {
    while (cursor < values.length) {
      const index = cursor++
      if (Date.now() >= deadlineAt) { deadlineExceeded = true; return }
      try { results[index] = { ok: true, value: await worker(values[index], index) } }
      catch (error) { results[index] = { ok: false, error } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run))
  return { results, deadlineExceeded }
}

function parseLaunchctlList(text) {
  if (!/^PID\s+Status\s+Label(?:\r?\n|$)/.test(String(text).trimStart())) throw new TypeError('Unexpected launchctl list output')
  const loaded = new Set()
  const running = new Set()
  for (const line of String(text).split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/)
    if (columns.length >= 3 && columns[2] && columns[2] !== 'Label') {
      const label = columns.slice(2).join(' ')
      loaded.add(label)
      if (/^\d+$/.test(columns[0])) running.add(label)
    }
  }
  return { loaded, running }
}

function parseDisabled(text) {
  if (!/disabled services\s*=\s*\{/i.test(String(text))) throw new TypeError('Unexpected launchctl print-disabled output')
  const values = new Map()
  for (const match of String(text).matchAll(/["']?([^\s"'=]+)["']?\s*=>\s*(true|false)/gi)) values.set(match[1], match[2].toLowerCase() === 'true')
  return values
}

async function launchState(runner, uid) {
  let loaded = new Set()
  let running = new Set()
  let disabled = new Map()
  let runningKnown = true
  let disabledKnown = true
  try {
    const list = parseLaunchctlList((await runner.runFile(TOOLS.launchctl, ['list'], { timeoutMs: 3_000, maxOutput: 2 * 1024 * 1024 })).stdout)
    loaded = list.loaded
    running = list.running
  } catch { runningKnown = false }
  try { disabled = parseDisabled((await runner.runFile(TOOLS.launchctl, ['print-disabled', `gui/${uid}`], { timeoutMs: 3_000, maxOutput: 512 * 1024 })).stdout) } catch { disabledKnown = false }
  return { loaded, running, disabled, runningKnown, disabledKnown }
}

async function scan(deps = {}) {
  const fileSystem = deps.fs || fs
  const runner = deps.runner
  const home = deps.home || os.homedir()
  const uid = deps.uid == null ? os.userInfo().uid : deps.uid
  const locations = deps.locations || defaultLocations(home)
  const items = []
  const warnings = []
  const deadlineAt = Date.now() + SCAN_DEADLINE_MS
  const state = await launchState(runner, uid)
  if (!state.runningKnown) warnings.push('launchctl 加载/运行状态读取失败，相关状态将显示为未知')
  if (!state.disabledKnown) warnings.push('launchctl 启用状态读取失败，相关状态将显示为未知')
  const records = []
  for (const location of locations) {
    if (location.scope === 'user') {
      try { await readMutableRoot(location.dir, home, fileSystem) }
      catch {
        warnings.push(`${location.label} 根目录不是 realHome 内的普通目录，用户项目已拒绝扫描`)
        continue
      }
    }
    const listing = await listPlists(location, fileSystem)
    if (!listing.complete) warnings.push(`${location.label} 超过 ${MAX_FILES_PER_LOCATION} 项或目录读取不完整，结果已截断`)
    for (const file of listing.files) records.push({ file, location })
  }
  const parsed = await mapBounded(records, async ({ file, location }) => {
    await readState(file, fileSystem)
    const result = await runner.runFile(TOOLS.plutil, ['-convert', 'json', '-o', '-', file], { timeoutMs: Math.max(100, Math.min(3_000, deadlineAt - Date.now())) })
    const plist = parsePlistJson(result.stdout)
    const rawLabel = String(plist.Label || path.basename(file, '.plist'))
    const labelValid = rawLabel.length > 0 && rawLabel.length <= 240 && !/[\u0000-\u001f\u007f]/.test(rawLabel)
    const label = copyString(labelValid ? rawLabel : path.basename(file, '.plist'))
    const command = Array.isArray(plist.ProgramArguments) ? plist.ProgramArguments.join(' ') : plist.Program
    const running = location.scope === 'user' && state.runningKnown ? state.running.has(rawLabel) : null
    const enabled = location.scope === 'user' ? state.disabledKnown ? state.disabled.get(rawLabel) !== true : null : plist.Disabled !== true
    const isApple = file.startsWith('/System/Library/') || rawLabel.startsWith('com.apple.')
    return createItem({
      key: `darwin:${location.kind}:${file}`, name: label, scope: location.scope, kind: location.kind,
      source: { label: location.label, location: file },
      trigger: plist.RunAtLoad ? '登录时' : plist.StartInterval ? `每 ${plist.StartInterval} 秒` : '由 launchd 按需触发',
      commandSummary: command, enabled, running, status: running ? 'running' : enabled ? 'idle' : 'disabled',
      action: { canToggle: false, requiresElevation: location.scope === 'system', reason: !labelValid ? 'LaunchAgent Label 为空、过长或包含控制字符，当前仅支持查看' : isApple ? '系统项目仅支持查看' : location.scope === 'user' ? '无法可信绑定当前 launchd 服务与来源 plist，当前仅支持查看' : '系统域项目需要管理员权限，当前仅查看' },
      metadata: { description: safeBaseName(file), serviceType: plist.KeepAlive ? 'persistent' : 'on-demand' },
      icon: getAppIconDataUrl(file) || (command ? getAppIconDataUrl(command.split(' ')[0]) : '') || getLetterSvgIcon(label),
      internal: { label },
    }, home)
  }, deadlineAt)
  if (parsed.deadlineExceeded) {
    warnings.push('LaunchAgent 扫描超过总时限，已返回部分只读结果')
  }
  parsed.results.forEach((result, index) => {
    if (result && result.ok) items.push(result.value)
    else {
      const record = records[index]
      if (record) warnings.push(`${safeBaseName(record.file)}：无法在时限内读取或解析`)
    }
  })
  const labelOrigins = new Map()
  for (const item of items.filter((candidate) => candidate.kind === 'launch-agent')) {
    const origins = labelOrigins.get(item.internal.label) || []
    origins.push(item)
    labelOrigins.set(item.internal.label, origins)
  }
  for (const origins of labelOrigins.values()) {
    if (origins.length < 2) continue
    for (const item of origins) item.action = { canToggle: false, requiresElevation: false, reason: '同一 launchd Label 对应多个来源文件，无法安全确定操作目标' }
    warnings.push(`LaunchAgent Label 冲突：${origins[0].internal.label}`)
  }
  return { items, warnings }
}

async function readOnlyMutation() {
  const error = new Error('macOS LaunchAgent 无法可信绑定当前服务来源，当前仅支持查看')
  error.code = 'READ_ONLY'
  throw error
}

module.exports = { IO_CONCURRENCY, MAX_FILES_PER_LOCATION, SCAN_DEADLINE_MS, TOOLS, applyEnabled: readOnlyMutation, defaultLocations, parseDisabled, parseLaunchctlList, parsePlistJson, scan, undo: readOnlyMutation }
