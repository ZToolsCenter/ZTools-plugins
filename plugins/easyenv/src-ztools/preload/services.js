const { execFile, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const IS_WIN = process.platform === 'win32'

// 提权子进程与当前进程的共享回读目录。不用 %TEMP%：提权后 TEMP 可能指向别的用户目录，
// 结果会写到别处导致插件读不到（easynssm 已踩过）
const SHARED_DIR = 'C:\\ProgramData\\easyenv'
const SNAPSHOT_KEY = 'easyenv_snapshots'
const PRESET_KEY = 'easyenv_presets'
const MAX_SNAPSHOTS = 20

// 注册表位置：用户变量免提权读写；系统变量可读，写必须管理员
const SCOPES = {
  user: { hive: 'CurrentUser', sub: 'Environment' },
  machine: {
    hive: 'LocalMachine',
    sub: 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
  }
}

// ==================== PowerShell 基础设施 ====================

// -EncodedCommand 需要 UTF-16LE base64，免引号/转义地狱
function b64(script) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

// PowerShell 单引号字符串转义（'' 表示字面单引号）
function psq(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"
}

function runPS(script, timeout) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      resolve({ ok: false, stdout: '', stderr: '', error: '仅支持 Windows 系统' })
      return
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64(script)],
      { windowsHide: true, timeout: timeout || 60000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', error: err ? err.message : '' })
      }
    )
  })
}

function tempFile(ext) {
  return path.join(
    os.tmpdir(),
    'easyenv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext
  )
}

// 结果统一走临时 JSON 文件回读，绕开控制台编码（中文变量值乱码）问题
async function runPSJson(script, timeout) {
  const out = tempFile('json')
  const full =
    script +
    '\n[IO.File]::WriteAllText(' +
    psq(out) +
    ', ($result | ConvertTo-Json -Depth 6 -Compress), [Text.Encoding]::UTF8)'
  const r = await runPS(full, timeout)
  let data = null
  try {
    data = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    /* 文件未生成或非法 JSON */
  }
  try {
    fs.unlinkSync(out)
  } catch (e) {
    /* 清理失败忽略 */
  }
  if (!data) {
    return { ok: false, error: (r.error || r.stderr || 'PowerShell 执行失败').slice(0, 300) }
  }
  return { ok: true, data }
}

// ==================== 权限 ====================

let adminCache = null

async function isAdmin() {
  if (adminCache !== null) return adminCache
  const r = await runPSJson(
    "$r = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)\n" +
      '$result = @{ isAdmin = $r }',
    20000
  )
  adminCache = !!(r.ok && r.data && r.data.isAdmin)
  return adminCache
}

// ==================== 读取 ====================

// 读一个作用域的全部变量，保留值类型与未经展开的原始值（PATH 等 REG_EXPAND_SZ 的关键）
async function readScope(scope) {
  const s = SCOPES[scope]
  if (!s) return { ok: false, error: '未知作用域：' + scope, vars: [] }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$result = @{ error = ''; vars = @() }",
    'try {',
    '  $key = [Microsoft.Win32.Registry]::' + s.hive + '.OpenSubKey(' + psq(s.sub) + ')',
    '  if ($key -eq $null) { throw "注册表键不存在：" + ' + psq(s.sub) + ' }',
    '  $list = New-Object System.Collections.ArrayList',
    '  foreach ($n in $key.GetValueNames()) {',
    '    $kind = $key.GetValueKind($n).ToString()',
    '    $raw = $key.GetValue($n, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)',
    "    $val = ''",
    "    if ($kind -eq 'MultiString') { $val = (@($raw) -join \"`n\") } else { $val = [string]$raw }",
    '    [void]$list.Add(@{ name = [string]$n; kind = $kind; value = $val })',
    '  }',
    '  $key.Close()',
    '  $result.vars = @($list)',
    '} catch { $result.error = $_.Exception.Message }'
  ].join('\n')
  const r = await runPSJson(script, 30000)
  if (!r.ok) return { ok: false, error: r.error, vars: [] }
  let vars = (r.data && r.data.vars) || []
  if (!Array.isArray(vars)) vars = [vars]
  const error = (r.data && r.data.error) || ''
  return { ok: !error, error, vars: vars.map((v) => ({ name: v.name, kind: v.kind, value: v.value })) }
}

async function listEnv(scope) {
  return readScope(scope)
}

// ==================== 写入（批量操作清单） ====================

function buildOpsScript(scope, opsFile, outFile) {
  const s = SCOPES[scope]
  return [
    "$ErrorActionPreference = 'Stop'",
    "$result = @{ ok = $false; error = ''; applied = 0; failed = @() }",
    'try {',
    '  $raw = [IO.File]::ReadAllText(' + psq(opsFile) + ')',
    '  $ops = @(ConvertFrom-Json $raw)',
    '  $key = [Microsoft.Win32.Registry]::' + s.hive + '.OpenSubKey(' + psq(s.sub) + ', $true)',
    "  if ($key -eq $null) { throw '无法以写权限打开注册表键（需要管理员权限）' }",
    '  foreach ($o in $ops) {',
    '    $n = [string]$o.name',
    '    try {',
    "      if ($o.op -eq 'delete') {",
    '        $key.DeleteValue($n, $false)',
    '      } else {',
    "        $v = ''",
    '        if ($o.value -ne $null) { $v = [string]$o.value }',
    '        $k = [string]$o.kind',
    '        switch ($k) {',
    "          'ExpandString' { $key.SetValue($n, $v, [Microsoft.Win32.RegistryValueKind]::ExpandString) }",
    "          'DWord'        { $key.SetValue($n, [int]$v, [Microsoft.Win32.RegistryValueKind]::DWord) }",
    "          'QWord'        { $key.SetValue($n, [long]$v, [Microsoft.Win32.RegistryValueKind]::QWord) }",
    "          'MultiString'  { $key.SetValue($n, [string[]]($v -split \"`r?`n\"), [Microsoft.Win32.RegistryValueKind]::MultiString) }",
    '          default        { $key.SetValue($n, $v, [Microsoft.Win32.RegistryValueKind]::String) }',
    '        }',
    '      }',
    '      $result.applied = $result.applied + 1',
    '    } catch { $result.failed += ($n + ": " + $_.Exception.Message) }',
    '  }',
    '  $key.Close()',
    '  if (@($result.failed).Count -eq 0) { $result.ok = $true }',
    '  else { $result.error = (@($result.failed) -join "; ") }',
    '} catch { $result.error = $_.Exception.Message }'
  ].join('\n')
}

function ensureSharedDir() {
  try {
    fs.mkdirSync(SHARED_DIR, { recursive: true })
  } catch (e) {
    /* 已存在或无权限，后续写入会报错并被兜底 */
  }
}

function sharedFile(ext) {
  return path.join(
    SHARED_DIR,
    'easyenv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext
  )
}

// 系统变量走提权：管理员直跑零弹窗，否则 UAC 一次
async function applyOpsElevated(scope, ops, timeout) {
  const elevated = scope === 'machine'
  if (elevated) ensureSharedDir()
  const opsFile = elevated ? sharedFile('ops.json') : tempFile('ops.json')
  const outFile = elevated ? sharedFile('result.json') : tempFile('result.json')
  fs.writeFileSync(opsFile, JSON.stringify(ops), 'utf8')
  const OUT = psq(outFile)

  const inner =
    buildOpsScript(scope, opsFile, outFile) +
    '\n[IO.File]::WriteAllText(' +
    OUT +
    ', ($result | ConvertTo-Json -Depth 6 -Compress), [Text.Encoding]::UTF8)'

  const admin = await isAdmin()
  let r
  if (admin) {
    // 快路径：ZTools 已是管理员，直接执行，零弹窗
    r = await runPS(inner, timeout || 120000)
  } else {
    // 慢路径：UAC 提权 + 轮询回读。不用 -Wait（-Verb RunAs 与 -Wait 有竞态，会提前返回）
    const outer =
      'try {\n' +
      "  $p = Start-Process powershell.exe -Verb RunAs -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','" +
      b64(inner) +
      "')\n" +
      '  $sw = [Diagnostics.Stopwatch]::StartNew()\n' +
      '  while (-not (Test-Path ' + OUT + ') -and $sw.Elapsed.TotalSeconds -lt 120) { Start-Sleep -Milliseconds 400 }\n' +
      '  if (-not (Test-Path ' + OUT + ')) {\n' +
      "    $alive = '?'\n" +
      '    try { $alive = (-not $p.HasExited) } catch {}\n' +
      "    $res = @{ ok = $false; error = ('等待提权结果超时：PID=' + $p.Id + ' HasExited=' + $alive + '。若未看到 UAC 弹窗，请检查是否被置顶窗口遮挡'); applied = 0 }\n" +
      '    [IO.File]::WriteAllText(' + OUT + ', ($res | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)\n' +
      '  }\n' +
      '} catch {\n' +
      '  $msg = $_.Exception.Message\n' +
      "  if ($msg -match 'cancel') { $msg = 'UAC 确认被取消' }\n" +
      '  [IO.File]::WriteAllText(' + OUT + ', (@{ ok = $false; error = $msg; applied = 0 } | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)\n' +
      '}'
    r = await runPS(outer, timeout || 180000)
  }

  let data = null
  try {
    data = JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    /* 未回写 */
  }
  try {
    fs.unlinkSync(opsFile)
  } catch (e) {
    /* 忽略 */
  }
  try {
    fs.unlinkSync(outFile)
  } catch (e) {
    /* 忽略 */
  }
  if (!data) {
    return { ok: false, error: (r.error || r.stderr || '无法回读写入结果').slice(0, 300), applied: 0 }
  }
  return { ok: !!data.ok, error: data.error || '', applied: data.applied || 0 }
}

// 广播 WM_SETTINGCHANGE "Environment"：资源管理器/新终端才会读到新值。
// 已打开终端的环境变量是其进程启动时的快照，广播也改不了，UI 需明示
async function broadcastEnvChange() {
  const script = [
    "$src = @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class EnvBroadcast {',
    '  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]',
    '  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);',
    '}',
    "'@",
    'try {',
    '  Add-Type -TypeDefinition $src',
    '  $ptr = [UIntPtr]::Zero',
    '  [EnvBroadcast]::SendMessageTimeout([IntPtr]0xFFFF, 0x001A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$ptr) | Out-Null',
    "$result = @{ ok = $true; error = '' }",
    '} catch { $result = @{ ok = $false; error = $_.Exception.Message } }'
  ].join('\n')
  const r = await runPSJson(script, 30000)
  return r.ok ? r.data : { ok: false, error: r.error }
}

async function applyOps(scope, ops) {
  if (!IS_WIN) return { ok: false, error: '仅支持 Windows 系统', applied: 0 }
  if (!Array.isArray(ops) || ops.length === 0) return { ok: true, error: '', applied: 0 }
  const r = await applyOpsElevated(scope, ops)
  if (r.ok) await broadcastEnvChange()
  return r
}

// ==================== 快照（修改前自动备份 + 一键回滚） ====================

function readSnapshots() {
  try {
    const raw = window.ztools.dbStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function writeSnapshots(list) {
  try {
    window.ztools.dbStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list))
    return true
  } catch (e) {
    return false
  }
}

// 归一化一条变更记录：只留回滚需要的字段
function normalizeChange(c) {
  return {
    scope: c.scope === 'machine' ? 'machine' : 'user',
    name: String(c.name || ''),
    before: String(c.before == null ? '' : c.before),
    after: String(c.after == null ? '' : c.after),
    existed: !!c.existed,
    kindBefore: String(c.kindBefore || 'String'),
    kindAfter: String(c.kindAfter || 'String')
  }
}

// 快照有两种：
//   diff（默认）：只记本次被改动的项，回滚只影响这几项，体积小、不覆盖别人后来的改动
//   full（手动立即快照）：整份环境备份，用作「回到某个时间点」
async function takeSnapshot(reason, changes) {
  let snap
  if (Array.isArray(changes) && changes.length) {
    snap = {
      id: 'snap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      reason: reason || '修改前自动快照',
      kind: 'diff',
      changes: changes.map(normalizeChange)
    }
  } else {
    const [u, m] = await Promise.all([readScope('user'), readScope('machine')])
    if (!u.ok && !m.ok) return { ok: false, error: u.error || m.error || '读取失败' }
    snap = {
      id: 'snap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      reason: reason || '手动快照',
      kind: 'full',
      user: u.vars || [],
      machine: m.vars || []
    }
  }
  const list = readSnapshots()
  list.unshift(snap)
  writeSnapshots(list.slice(0, MAX_SNAPSHOTS))
  return { ok: true, snapshot: snap }
}

function listSnapshots() {
  return { ok: true, snapshots: readSnapshots() }
}

function deleteSnapshot(id) {
  const list = readSnapshots().filter((s) => s.id !== id)
  writeSnapshots(list)
  return { ok: true }
}

// 对比目标快照与当前注册表，生成最小操作集
function buildRestoreOps(current, target) {
  const curMap = new Map()
  for (const v of current) curMap.set(v.name.toUpperCase(), v)
  const tgtMap = new Map()
  for (const v of target) tgtMap.set(v.name.toUpperCase(), v)
  const ops = []
  for (const v of target) {
    const cur = curMap.get(v.name.toUpperCase())
    if (!cur || cur.value !== v.value || cur.kind !== v.kind) {
      ops.push({ op: 'set', name: v.name, value: v.value, kind: v.kind })
    }
  }
  for (const v of current) {
    if (!tgtMap.has(v.name.toUpperCase())) ops.push({ op: 'delete', name: v.name })
  }
  return ops
}

async function restoreSnapshot(id) {
  const snap = readSnapshots().find((s) => s.id === id)
  if (!snap) return { ok: false, error: '快照不存在（可能已被删除）' }

  // 只改了某几项的 diff 快照：只回滚这几项，不碰其它变量
  if (Array.isArray(snap.changes)) {
    const [u, m] = await Promise.all([readScope('user'), readScope('machine')])
    if (!u.ok) return { ok: false, error: '读取用户变量失败：' + u.error }
    if (!m.ok) return { ok: false, error: '读取系统变量失败：' + m.error }
    const current = { user: u.vars, machine: m.vars }
    const findVar = (scope, name) => {
      const upper = String(name).toUpperCase()
      return (current[scope] || []).find((v) => v.name.toUpperCase() === upper)
    }

    // 回滚本身也要可回滚：把当前值按同样的项存一份 diff 快照
    const reverse = snap.changes.map((c) => {
      const cur = findVar(c.scope, c.name)
      return {
        scope: c.scope,
        name: c.name,
        before: cur ? cur.value : '',
        after: c.before,
        existed: !!cur,
        kindBefore: cur ? cur.kind : 'String',
        kindAfter: c.kindBefore
      }
    })
    if (reverse.length) await takeSnapshot('回滚前自动快照', reverse)

    const byScope = { user: [], machine: [] }
    for (const c of snap.changes) {
      if (c.existed) {
        byScope[c.scope].push({ op: 'set', name: c.name, value: c.before, kind: c.kindBefore || 'String' })
      } else {
        byScope[c.scope].push({ op: 'delete', name: c.name })
      }
    }

    let userChanges = 0
    let machineChanges = 0
    if (byScope.user.length) {
      const r = await applyOps('user', byScope.user)
      if (!r.ok) return { ok: false, error: '恢复用户变量失败：' + r.error }
      userChanges = byScope.user.length
    }
    if (byScope.machine.length) {
      const r = await applyOps('machine', byScope.machine)
      if (!r.ok) return { ok: false, error: '恢复系统变量失败：' + r.error }
      machineChanges = byScope.machine.length
    }
    return { ok: true, userChanges, machineChanges }
  }

  // 旧版 / 手动整份快照：按全量对比恢复
  // 回滚本身也要可回滚：先给当前状态存一份
  await takeSnapshot('回滚前自动快照')

  const [u, m] = await Promise.all([readScope('user'), readScope('machine')])
  if (!u.ok) return { ok: false, error: '读取用户变量失败：' + u.error }
  if (!m.ok) return { ok: false, error: '读取系统变量失败：' + m.error }

  const userOps = buildRestoreOps(u.vars, snap.user || [])
  const machineOps = buildRestoreOps(m.vars, snap.machine || [])

  if (userOps.length) {
    const r = await applyOps('user', userOps)
    if (!r.ok) return { ok: false, error: '恢复用户变量失败：' + r.error }
  }
  if (machineOps.length) {
    const r = await applyOps('machine', machineOps)
    if (!r.ok) return { ok: false, error: '恢复系统变量失败：' + r.error }
  }
  return { ok: true, userChanges: userOps.length, machineChanges: machineOps.length }
}

// 导出快照到下载目录
function exportSnapshot(id) {
  const snap = readSnapshots().find((s) => s.id === id)
  if (!snap) return { ok: false, error: '快照不存在' }
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = path.join(window.ztools.getPath('downloads'), 'easyenv-snapshot-' + stamp + '.json')
    fs.writeFileSync(file, JSON.stringify(snap, null, 2), 'utf8')
    return { ok: true, path: file }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// 从本地 JSON 导入快照（换机迁移用）
function importSnapshot() {
  let picked = []
  try {
    picked =
      window.ztools.showOpenDialog({
        title: '选择 easyenv 快照文件',
        properties: ['openFile'],
        filters: [{ name: '快照 JSON', extensions: ['json'] }]
      }) || []
  } catch (e) {
    return { ok: false, error: e.message }
  }
  if (!picked.length) return { ok: false, error: '已取消' }
  try {
    const data = JSON.parse(fs.readFileSync(picked[0], 'utf8'))
    const isDiff = Array.isArray(data && data.changes) && data.changes.length > 0
    const isFull = Array.isArray(data && data.user) && Array.isArray(data && data.machine)
    if (!isDiff && !isFull) {
      return { ok: false, error: '不是有效的 easyenv 快照文件' }
    }
    const base = {
      id: 'snap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      ts: data.ts || Date.now(),
      reason: (data.reason || '导入快照') + '（导入）'
    }
    const snap = isDiff
      ? Object.assign(base, { kind: 'diff', changes: data.changes.map(normalizeChange) })
      : Object.assign(base, { kind: 'full', user: data.user, machine: data.machine })
    const list = readSnapshots()
    list.unshift(snap)
    writeSnapshots(list.slice(0, MAX_SNAPSHOTS))
    return { ok: true, snapshot: snap }
  } catch (e) {
    return { ok: false, error: '读取快照失败：' + e.message }
  }
}

// ==================== PATH 校验 ====================

// 递归展开 %VAR%：envMap 由渲染层传入（注册表两侧合并结果），基线用 process.env 兜底
function expandValue(value, upperMap, depth) {
  const d = depth || 0
  if (d > 8) return String(value)
  return String(value).replace(/%([^%]+)%/g, (m, name) => {
    const hit = upperMap[String(name).toUpperCase()]
    if (hit == null) return m
    return expandValue(hit, upperMap, d + 1)
  })
}

// 合并 process.env 与渲染层传来的注册表变量，统一转成「大写名 → 值」的查找表
function buildUpperEnvMap(envMap) {
  const merged = Object.assign({}, process.env, envMap || {})
  const upperMap = {}
  for (const k of Object.keys(merged)) upperMap[k.toUpperCase()] = merged[k]
  return upperMap
}

// 展开单个值（详情页显示「实际生效的值」用）
function expandEnvValue(value, envMap) {
  return expandValue(String(value == null ? '' : value), buildUpperEnvMap(envMap), 0)
}

// 逐条校验 PATH 条目：展开后是否存在。renderer 拖动/输入时调用
function checkPaths(entries, envMap) {
  const upperMap = buildUpperEnvMap(envMap)
  return (entries || []).map((raw) => {
    const text = String(raw == null ? '' : raw)
    const clean = text.trim().replace(/^"(.*)"$/, '$1')
    const expanded = expandValue(clean, upperMap, 0)
    let exists = false
    if (clean) {
      try {
        exists = fs.existsSync(expanded)
      } catch (e) {
        exists = false
      }
    }
    return { raw: text, expanded, exists }
  })
}

// 在资源管理器中打开：目录直接打开，文件则打开所在目录并选中它。
// explorer.exe 即便成功也常返回 exitCode=1（把活交给已有进程后立即返回），
// 所以判成败只看 spawnSync 的 res.error，不能看 status；
// 也不能加 windowsHide，STARTUPINFO 的 SW_HIDE 会把 GUI 窗口整个藏掉
function openPath(target, envMap) {
  const raw = String(target == null ? '' : target)
    .trim()
    .replace(/^"(.*)"$/, '$1')
  if (!raw) return { ok: false, error: '路径为空' }
  if (raw.includes(';')) return { ok: false, error: '这不是单条路径（含分号），请到 PATH 编辑器里逐条打开' }
  const resolved = expandEnvValue(raw, envMap)
  try {
    if (!fs.existsSync(resolved)) return { ok: false, error: '路径不存在：' + resolved }
    const isDir = fs.statSync(resolved).isDirectory()
    const res = spawnSync('explorer.exe', isDir ? [resolved] : ['/select,' + resolved], {
      timeout: 10000
    })
    if (res.error) return { ok: false, error: '打开失败：' + res.error.message }
    return { ok: true, path: resolved, isDir }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ==================== 备选值（一套变量多个候选，用于快速切换） ====================

// 结构：{ 'machine:JAVA_HOME': ['D:\\...jdk8', 'D:\\...jdk17'] }
function listPresets() {
  try {
    const raw = window.ztools.dbStorage.getItem(PRESET_KEY)
    if (!raw) return { ok: true, presets: {} }
    const obj = JSON.parse(raw)
    return { ok: true, presets: obj && typeof obj === 'object' ? obj : {} }
  } catch (e) {
    return { ok: true, presets: {} }
  }
}

// 整体覆盖保存：渲染层把改动后的全量对象传回来，逻辑集中在一处
function savePresets(presets) {
  try {
    const clean = {}
    const src = presets && typeof presets === 'object' ? presets : {}
    for (const k of Object.keys(src)) {
      const arr = Array.isArray(src[k]) ? src[k] : []
      const values = []
      for (const v of arr) {
        const s = String(v == null ? '' : v).trim()
        if (s && !values.some((x) => x.toUpperCase() === s.toUpperCase())) values.push(s)
      }
      if (values.length) clean[k] = values
    }
    window.ztools.dbStorage.setItem(PRESET_KEY, JSON.stringify(clean))
    return { ok: true, presets: clean }
  } catch (e) {
    return { ok: false, error: e.message, presets: {} }
  }
}

// ==================== 注入渲染层 ====================

window.services = {
  isAdmin,
  listEnv,
  applyOps,
  takeSnapshot,
  listSnapshots,
  deleteSnapshot,
  restoreSnapshot,
  exportSnapshot,
  importSnapshot,
  checkPaths,
  expandEnvValue,
  openPath,
  listPresets,
  savePresets
}
