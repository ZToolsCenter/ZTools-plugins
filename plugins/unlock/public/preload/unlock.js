const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { getKillCommand } = require('./utils')
const why = require('./why')
const { buildFolderProbeScript, parseFolderProbeOutput } = require('./folder-probe')
const {
  collectFolderCandidates,
  buildCwdScanScript,
  parseCwdScanOutput,
  filterCwdHolders,
  buildFolderResourceManagerScript,
  parseFolderRmOutput
} = require('./folder-scan')

const TIMEOUT_MS = 30000
/** 结束进程后轮询确认占用已解除的次数与间隔（约 1.8s 上限） */
const RELEASE_POLL_ATTEMPTS = 6
const RELEASE_POLL_INTERVAL_MS = 300
/** 文件夹探测较慢，轮询次数少一些，间隔长一点 */
const FOLDER_POLL_ATTEMPTS = 4
const FOLDER_POLL_INTERVAL_MS = 400
/** 只为前 N 个进程补全启动链路，避免大文件夹扫描后卡顿 */
const MAX_WHY_ENRICH = 20

let _debugLog = []

function debugPush(msg) {
  _debugLog.push(msg)
}

function getDebugLog() {
  // interleave by capture order: unlock then why is confusing; pull both now
  const whyLogs = why.getDebugLog ? why.getDebugLog() : []
  const logs = _debugLog.concat(whyLogs)
  _debugLog = []
  return logs
}

function execWithTimeout(cmd, args, label, options) {
  return new Promise((resolve, reject) => {
    debugPush('  [' + (label || 'exec') + '] ' + cmd + ' ' + args.map(a => a.includes(' ') ? '"' + a + '"' : a).join(' '))
    // cwd 固定到临时目录：辅助进程不能继承 ZTools 的当前目录，
    // 否则扫描文件夹时，它自己会以“工作目录在其中”被误认为占用者。
    const cwd = options && options.cwd ? options.cwd : os.tmpdir()
    const proc = spawn(cmd, args, { timeout: TIMEOUT_MS, windowsHide: true, cwd: cwd })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', function (d) { stdout += d })
    proc.stderr.on('data', function (d) { stderr += d })
    proc.on('error', function (err) {
      debugPush('  [' + (label || 'exec') + '] spawn error: ' + err.message)
      reject(new Error('spawn error: ' + err.message))
    })
    proc.on('close', function (code) {
      debugPush('  [' + (label || 'exec') + '] exit: ' + code)
      if (stderr.trim()) debugPush('  [' + (label || 'exec') + '] stderr: ' + stderr.trim().substring(0, 500))
      if (code !== 0) { reject(new Error(stderr.trim() || 'exit code ' + code)); return }
      resolve(stdout)
    })
  })
}

function writeTempScript(content) {
  const scriptPath = path.join(os.tmpdir(), 'unlock-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1')
  fs.writeFileSync(scriptPath, '﻿' + content, 'utf8')
  return scriptPath
}

/**
 * PowerShell 单引号字面量。单引号内不插值，路径里的 $ / 反引号 / 双引号都安全，
 * 只需把 ' 写成 ''。旧实现用双引号拼接，含 $ 的路径会被 PowerShell 当变量吃掉。
 */
function psLiteral(value) {
  return "'" + String(value == null ? '' : value).replace(/'/g, "''") + "'"
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

function stripBom(s) {
  return String(s == null ? '' : s).replace(/^\uFEFF/, '')
}

/* ------------------------------------------------------------------ *
 * 占用检测：Windows 重启管理器（Restart Manager）
 * ------------------------------------------------------------------ */

/**
 * 重启管理器探测脚本。
 *
 * 两个曾经踩过的坑，都由 buildResourceManagerScript 的文本断言 + 真实占用测试守着：
 * 1) RmGetList 的 pnProcInfoNeeded(out) 与 pnProcInfo(ref) 必须是**不同**变量，否则写回时
 *    计数被清零 → 分配 0 字节 → 永远查不到占用者（旧实现还把异常吞掉，完全静默）。
 * 2) RM_PROCESS_INFO 必须按 Unicode 计算大小：RmGetList 按 WCHAR[256]/WCHAR[64] 写入，
 *    按 Ansi 计算会低估缓冲区，RmGetList 越界写内存 → PowerShell 宿主堆损坏 0xC0000374
 *    （一个占用者时侥幸不崩，两个以上必崩）。因此这里改为在 C# 里完成两次调用与结构体解析。
 */
function buildResourceManagerScript(resolvedPath) {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "Stop"',
    '',
    '$path = ' + psLiteral(resolvedPath),
    '$err = ""',
    '$results = @()',
    '',
    '$csCode = @\'',
    'using System;',
    'using System.Collections.Generic;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    '',
    'public class RestartManager {',
    '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]',
    '  public static extern int RmStartSession(out IntPtr pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);',
    '  [DllImport("rstrtmgr.dll")]',
    '  public static extern int RmEndSession(IntPtr pSessionHandle);',
    '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]',
    '  public static extern int RmRegisterResources(IntPtr pSessionHandle, uint nFiles, string[] rgsFileNames, uint nApplications, IntPtr rgApplications, uint nServices, IntPtr rgsServiceNames);',
    '  [DllImport("rstrtmgr.dll")]',
    '  public static extern int RmGetList(IntPtr pSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, IntPtr rgAffectedApps, out uint lpdwRebootReasons);',
    '',
    '  public struct RM_UNIQUE_PROCESS {',
    '    public uint dwProcessId;',
    '    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;',
    '  }',
    '',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
    '  public struct RM_PROCESS_INFO {',
    '    public RM_UNIQUE_PROCESS Process;',
    '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]',
    '    public string strAppName;',
    '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]',
    '    public string strServiceShortName;',
    '    public int ApplicationType;',
    '    public uint AppStatus;',
    '    public uint TSSessionId;',
    '    [MarshalAs(UnmanagedType.Bool)]',
    '    public bool bRestartable;',
    '  }',
    '',
    '  /// 返回 "pid|appName|serviceShortName" 形式的占用者列表。',
    '  public static string[] GetHolders(string path) {',
    '    IntPtr session = IntPtr.Zero;',
    '    StringBuilder key = new StringBuilder(256);',
    '    int rv = RmStartSession(out session, 0, key);',
    '    if (rv != 0) throw new Exception("RmStartSession failed: " + rv);',
    '    try {',
    '      string[] files = new string[] { path };',
    '      rv = RmRegisterResources(session, 1, files, 0, IntPtr.Zero, 0, IntPtr.Zero);',
    '      if (rv != 0) throw new Exception("RmRegisterResources failed: " + rv);',
    '      uint needed = 0;',
    '      uint have = 0;',
    '      uint reasons = 0;',
    '      rv = RmGetList(session, out needed, ref have, IntPtr.Zero, out reasons);',
    '      if (rv != 0 && rv != 234) throw new Exception("RmGetList failed: " + rv);',
    '      if (rv == 0 || needed == 0) return new string[0];',
    '      int size = Marshal.SizeOf(typeof(RM_PROCESS_INFO));',
    '      IntPtr buffer = Marshal.AllocHGlobal(size * (int)needed);',
    '      try {',
    '        have = needed;',
    '        rv = RmGetList(session, out needed, ref have, buffer, out reasons);',
    '        if (rv != 0) throw new Exception("RmGetList failed: " + rv);',
    '        List<string> rows = new List<string>();',
    '        for (int i = 0; i < have; i++) {',
    '          IntPtr at = new IntPtr(buffer.ToInt64() + (long)size * i);',
    '          RM_PROCESS_INFO info = (RM_PROCESS_INFO)Marshal.PtrToStructure(at, typeof(RM_PROCESS_INFO));',
    '          rows.Add(info.Process.dwProcessId + "|" + (info.strAppName == null ? "" : info.strAppName) + "|" + (info.strServiceShortName == null ? "" : info.strServiceShortName));',
    '        }',
    '        return rows.ToArray();',
    '      } finally {',
    '        Marshal.FreeHGlobal(buffer);',
    '      }',
    '    } finally {',
    '      RmEndSession(session);',
    '    }',
    '  }',
    '}',
    '\'@',
    '',
    'try {',
    '  Add-Type -TypeDefinition $csCode -ErrorAction Stop',
    '} catch {',
    '  $err = "无法加载重启管理器接口: " + $_.Exception.Message',
    '}',
    '',
    'if (-not $err) {',
    '  try {',
    '    foreach ($row in [RestartManager]::GetHolders($path)) {',
    '      $parts = $row -split "\\|"',
    '      $holderPid = [int]$parts[0]',
    '      $appName = ""',
    '      if ($parts.Length -gt 1) { $appName = [string]$parts[1] }',
    '      $serviceName = ""',
    '      if ($parts.Length -gt 2) { $serviceName = [string]$parts[2] }',
    '      $procName = ""',
    '      $exePath = ""',
    '      $proc = Get-Process -Id $holderPid -ErrorAction SilentlyContinue',
    '      if ($proc) {',
    '        try { $exePath = $proc.Path } catch { }',
    '        if ($proc.ProcessName) { $procName = $proc.ProcessName + ".exe" }',
    '      }',
    '      if (-not $exePath) {',
    '        try {',
    '          $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $holderPid" -ErrorAction SilentlyContinue',
    '          if ($cim) {',
    '            $exePath = [string]$cim.ExecutablePath',
    '            if (-not $procName -and $cim.Name) { $procName = [string]$cim.Name }',
    '          }',
    '        } catch { }',
    '      }',
    '      if ($exePath) { $procName = Split-Path -Leaf $exePath }',
    '      if (-not $procName) { $procName = $appName }',
    '      $results += @{',
    '        pid = $holderPid',
    '        name = $procName',
    '        exePath = $exePath',
    '        service = $serviceName',
    '      }',
    '    }',
    '  } catch {',
    '    $err = $_.Exception.Message',
    '  }',
    '}',
    '',
    'if ($err) { [Console]::Error.WriteLine("Restart Manager: " + $err); exit 1 }',
    'if ($results.Count -eq 0) { "[]" } else { $results | ConvertTo-Json -Compress }'
  ].join('\n')
}

/**
 * Accurate lock-holder detection via Restart Manager (rstrtmgr.dll).
 * No heuristics — only processes Windows reports as holding the resource.
 */
async function findByResourceManager(resolvedPath) {
  const scriptPath = writeTempScript(buildResourceManagerScript(resolvedPath))
  try {
    const raw = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'rm')

    const trimmed = stripBom(raw).trim()
    if (!trimmed || trimmed === 'null' || trimmed === '[]') return []

    const parsed = JSON.parse(trimmed)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    debugPush('[unlock] 重启管理器找到 ' + arr.length + ' 个进程')
    return arr.map(function (p) {
      const service = String(p.service || '')
      return {
        pid: Number(p.pid) || 0,
        name: String(p.name || ''),
        exePath: String(p.exePath || ''),
        service: service,
        detectSource: 'resourcemanager',
        confidence: 'high'
      }
    }).filter(function (p) { return p.pid > 0 })
  } catch (e) {
    // 不再静默失败：把原因写进调试日志，便于排查"查不到占用者"
    debugPush('[unlock] 重启管理器检测失败: ' + e.message)
    return []
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
  }
}

/* ------------------------------------------------------------------ *
 * 文件夹占用检测：工作目录 + 内部文件 + 删除权限探测
 * ------------------------------------------------------------------ */

function isDirectoryPath(value) {
  try { return fs.statSync(value).isDirectory() } catch (e) { return false }
}

/**
 * 非破坏性删除探测：以 DELETE 权限打开目录/内部条目后立即关闭。
 * @returns {Promise<{ok:boolean, deletable:'yes'|'no'|'unknown', locked:number, denied:number, other:number, checked:number, truncated:boolean}>}
 */
async function probeFolderState(folderPath) {
  const scriptPath = writeTempScript(buildFolderProbeScript(folderPath))
  try {
    const raw = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'folder-probe')
    return parseFolderProbeOutput(stripBom(raw))
  } catch (e) {
    debugPush('[unlock] 文件夹删除探测失败: ' + e.message)
    return { ok: false, deletable: 'unknown', locked: 0, denied: 0, other: 0, checked: 0, truncated: false }
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
  }
}

/** 找出工作目录位于该文件夹（含子目录）的进程。 */
async function findByWorkingDirectory(dir) {
  // 给辅助进程一个唯一的空目录作为 cwd，扫描时据此排除它自己。
  let helperDir = ''
  try { helperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unlock-cwd-')) } catch (e) { helperDir = os.tmpdir() }
  const scriptPath = writeTempScript(buildCwdScanScript(process.pid, helperDir))
  try {
    const raw = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'cwd-scan', { cwd: helperDir })
    const parsed = parseCwdScanOutput(stripBom(raw))
    const holders = filterCwdHolders(parsed.rows, dir)
    debugPush('[unlock] 工作目录扫描: 读到 ' + parsed.scanned + ' 个进程, 匹配 ' + holders.length +
      ', 无权限 ' + parsed.denied + ', WOW64 跳过 ' + parsed.wow64Skipped)
    return {
      ok: true,
      holders: holders,
      scanned: parsed.scanned,
      denied: parsed.denied,
      wow64Skipped: parsed.wow64Skipped
    }
  } catch (e) {
    debugPush('[unlock] 工作目录扫描失败: ' + e.message)
    return { ok: false, holders: [], scanned: 0, denied: 0, wow64Skipped: 0, error: e.message }
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
    if (helperDir && path.resolve(helperDir) !== path.resolve(os.tmpdir())) {
      try { fs.rmSync(helperDir, { recursive: true, force: true }) } catch (e) {}
    }
  }
}

/** 把文件夹内的文件分批交给重启管理器，找出打开了这些文件的进程。 */
async function findByResourceManagerForFolder(dir) {
  const candidates = collectFolderCandidates(dir)
  if (candidates.files.length === 0) {
    debugPush('[unlock] 重启管理器(文件夹): 没有可注册的文件')
    return {
      ok: true,
      holders: [],
      registered: 0,
      failedBatches: 0,
      lastError: '',
      truncated: candidates.truncated,
      errors: candidates.errors
    }
  }

  const manifestPath = path.join(os.tmpdir(), 'unlock-files-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json')
  const scriptPath = writeTempScript(buildFolderResourceManagerScript(manifestPath))
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(candidates.files), 'utf8')
    const raw = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'rm-folder')
    const parsed = parseFolderRmOutput(stripBom(raw))
    debugPush('[unlock] 重启管理器(文件夹): 注册 ' + parsed.registered + ' 个文件, 找到 ' +
      parsed.holders.length + ' 个进程' + (parsed.failedBatches ? ', 失败批次 ' + parsed.failedBatches : ''))
    return Object.assign({}, parsed, { truncated: candidates.truncated, errors: candidates.errors })
  } catch (e) {
    debugPush('[unlock] 重启管理器(文件夹)失败: ' + e.message)
    return {
      ok: false,
      holders: [],
      registered: candidates.files.length,
      failedBatches: 0,
      lastError: e.message,
      truncated: candidates.truncated,
      errors: candidates.errors
    }
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
    try { fs.unlinkSync(manifestPath) } catch (e) {}
  }
}

/** 按 PID 合并多个来源的占用证据，保留名称、路径、服务与 why。 */
function mergeHoldersByPid(list) {
  const byPid = new Map()
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || !p.pid) continue
    const existing = byPid.get(p.pid)
    if (!existing) {
      byPid.set(p.pid, Object.assign({}, p, {
        evidence: Array.isArray(p.evidence) ? p.evidence.slice() : []
      }))
      continue
    }
    if (!existing.name && p.name) existing.name = p.name
    if (!existing.exePath && p.exePath) existing.exePath = p.exePath
    if (!existing.service && p.service) existing.service = p.service
    if (!existing.workingDir && p.workingDir) existing.workingDir = p.workingDir
    if (!existing.why && p.why) existing.why = p.why
    const sources = String(existing.detectSource || '').split('+').filter(Boolean)
    for (const s of String(p.detectSource || '').split('+')) {
      if (s && sources.indexOf(s) < 0) sources.push(s)
    }
    existing.detectSource = sources.join('+')
    for (const e of (Array.isArray(p.evidence) ? p.evidence : [])) {
      if (existing.evidence.indexOf(e) < 0) existing.evidence.push(e)
    }
  }
  return Array.from(byPid.values())
}

async function enrichHolders(holders) {
  const head = holders.slice(0, MAX_WHY_ENRICH)
  const rest = holders.slice(MAX_WHY_ENRICH)
  const enriched = head.length > 0 ? await why.withWhyAll(head) : []
  for (const p of enriched) {
    if (p.workingDir && p.why && !p.why.workingDir) p.why.workingDir = p.workingDir
  }
  return enriched.concat(rest)
}

function buildFolderScanNote(holderCount, blocked, probe, cwdResult, rmResult) {
  if (holderCount > 0) {
    if (blocked === false) {
      return { note: '这些程序打开了文件夹内的内容，但目前不影响删除。', noteLevel: 'info' }
    }
    return { note: '结束这些进程前，请先确认它们可以安全关闭。', noteLevel: 'warning' }
  }
  if (blocked === true) {
    return {
      note: '文件夹被占用，但没能定位到具体程序。可能是系统服务、杀毒软件或其他用户的进程，可尝试以管理员身份运行 ZTools 后重新扫描。',
      noteLevel: 'warning'
    }
  }
  if (blocked === false) {
    if (probe.truncated || rmResult.truncated) {
      return { note: '文件夹当前没有被占用，但内容较多，只检查了其中一部分。', noteLevel: 'info' }
    }
    return { note: '文件夹当前没有被占用。', noteLevel: 'success' }
  }
  if (!probe.ok || !cwdResult.ok || !rmResult.ok) {
    return {
      note: '文件夹占用检测没有全部完成，可能是权限不足。可尝试以管理员身份运行 ZTools 后重新扫描。',
      noteLevel: 'warning'
    }
  }
  return {
    note: '无法确认文件夹是否被占用，可能是权限不足或内容过多。可尝试以管理员身份运行 ZTools 后重新扫描。',
    noteLevel: 'warning'
  }
}

async function findFolderLockingProcesses(resolved) {
  const cwdPromise = findByWorkingDirectory(resolved)
  const rmPromise = findByResourceManagerForFolder(resolved)
  const probePromise = probeFolderState(resolved)

  const results = await Promise.all([cwdPromise, rmPromise, probePromise])
  const cwdResult = results[0]
  const rmResult = results[1]
  const probe = results[2]

  let holders = mergeHoldersByPid([].concat(cwdResult.holders, rmResult.holders))
  holders = holders.filter(function (p) {
    // 排除本工具自己，以及注册清单的辅助 PowerShell（目标可能正好是临时目录）
    return p.pid !== process.pid && (!rmResult.helperPid || p.pid !== rmResult.helperPid)
  })
  const processes = await enrichHolders(holders)

  const blocked = probe.deletable === 'no' ? true : probe.deletable === 'yes' ? false : null
  const locked = processes.length > 0 ? true : (blocked === null ? null : blocked)
  const info = buildFolderScanNote(processes.length, blocked, probe, cwdResult, rmResult)

  const degraded = !probe.ok || probe.truncated || probe.denied > 0 || !cwdResult.ok ||
    !rmResult.ok || rmResult.failedBatches > 0 || !!rmResult.truncated
  const coverage = {
    cwd: cwdResult.ok,
    resourceManager: rmResult.ok,
    deleteProbe: probe.ok,
    filesRegistered: rmResult.registered || 0,
    truncated: !!probe.truncated || !!rmResult.truncated,
    denied: (cwdResult.denied || 0) + (probe.denied || 0)
  }

  const engines = []
  if (cwdResult.ok) engines.push('cwd')
  if (rmResult.ok) engines.push('resourcemanager-child')
  if (probe.ok) engines.push('delete-probe')

  debugPush('[unlock] 文件夹结果: ' + processes.length + ' 个进程, locked=' + locked +
    ', blocked=' + blocked + ', deletable=' + probe.deletable +
    ', 检查 ' + probe.checked + ' 项, 截断=' + probe.truncated)

  return {
    locked: locked,
    blocked: blocked,
    holders: processes.length,
    state: 'directory',
    processes: processes,
    note: info.note,
    noteLevel: info.noteLevel,
    engine: engines.join('+') || 'none',
    isDirectory: true,
    degraded: degraded,
    coverage: coverage
  }
}

/* ------------------------------------------------------------------ *
 * 占用状态探测：文件是否还能独占打开
 * ------------------------------------------------------------------ */

function buildProbeScript(resolvedPath) {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$path = ' + psLiteral(resolvedPath),
    'if (Test-Path -LiteralPath $path -PathType Container) { Write-Output "DIR"; exit }',
    'if (-not (Test-Path -LiteralPath $path)) { Write-Output "MISSING"; exit }',
    'try {',
    '  $fs = [System.IO.File]::Open($path, "Open", "Read", "None")',
    '  $fs.Close()',
    '  Write-Output "NOT_LOCKED"',
    '} catch {',
    '  Write-Output "LOCKED"',
    '}'
  ].join('\n')
}

/**
 * 路径当前状态。
 * @returns {Promise<'locked'|'free'|'directory'|'missing'|'unknown'>}
 */
async function probePathState(resolvedPath) {
  const scriptPath = writeTempScript(buildProbeScript(resolvedPath))
  try {
    const out = stripBom(await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'locktest')).trim()
    if (out === 'LOCKED') return 'locked'
    if (out === 'NOT_LOCKED') return 'free'
    if (out === 'DIR') return 'directory'
    if (out === 'MISSING') return 'missing'
    return 'unknown'
  } catch (e) {
    debugPush('[unlock] 占用探测失败: ' + e.message)
    return 'unknown'
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
  }
}

/**
 * Exclusive-open probe: is the path locked at all?
 * Returns true (locked) / false (not locked) / null (unknown or not a file).
 */
async function probeExclusiveLock(resolvedPath) {
  const state = await probePathState(resolvedPath)
  if (state === 'locked') return true
  if (state === 'free') return false
  return null
}

/**
 * 结束进程后的闭环验证：轮询直到能独占打开（或超时）。
 * @returns {Promise<{released: boolean|null, state: string, attempts: number, elapsedMs: number}>}
 */
async function verifyRelease(filePath, options) {
  const opts = options || {}
  const resolved = path.resolve(filePath)
  const isDir = isDirectoryPath(resolved)
  const attempts = Math.max(1, Number(opts.attempts) ||
    (isDir ? FOLDER_POLL_ATTEMPTS : RELEASE_POLL_ATTEMPTS))
  const intervalMs = Number(opts.intervalMs) ||
    (isDir ? FOLDER_POLL_INTERVAL_MS : RELEASE_POLL_INTERVAL_MS)
  const started = Date.now()

  let state = 'unknown'
  let used = 0
  for (let i = 0; i < attempts; i++) {
    used = i + 1
    if (isDir) {
      const probe = await probeFolderState(resolved)
      state = probe.deletable === 'yes' ? 'free'
        : probe.deletable === 'no' ? 'locked'
          : 'unknown'
    } else {
      state = await probePathState(resolved)
    }
    if (state === 'free') break
    if (isDir && state === 'unknown') break
    if (i < attempts - 1) await delay(intervalMs)
  }

  const released = state === 'free' ? true : state === 'locked' ? false : null
  debugPush('[unlock] 解除验证: state=' + state + ' released=' + released + ' 用时 ' + (Date.now() - started) + 'ms')
  const result = {
    released: released,
    state: state,
    attempts: used,
    elapsedMs: Date.now() - started,
    verification: isDir ? 'delete-probe' : 'exclusive-open'
  }
  if (isDir) result.blocked = released === null ? null : !released
  return result
}

/* ------------------------------------------------------------------ *
 * 占用扫描
 * ------------------------------------------------------------------ */

function dedupeByPid(list) {
  const seen = new Set()
  const out = []
  for (const p of list) {
    if (!p || !p.pid || seen.has(p.pid)) continue
    seen.add(p.pid)
    out.push(p)
  }
  return out
}

function buildScanNote(holderCount, state) {
  if (holderCount > 0) {
    if (state === 'free') {
      return {
        note: '这些程序打开了该文件，但不影响删除或重命名。',
        noteLevel: 'info'
      }
    }
    return {
      note: '结束这些进程前，请先确认它们可以安全关闭。',
      noteLevel: 'warning'
    }
  }
  if (state === 'locked') {
    return {
      note: '文件被占用，但没能查到具体进程。可能是系统服务、杀毒软件或其他用户的进程，可尝试以管理员身份运行 ZTools 后重新扫描。',
      noteLevel: 'warning'
    }
  }
  if (state === 'free') {
    return {
      note: '未检测到占用，文件当前可以正常删除或重命名。',
      noteLevel: 'success'
    }
  }
  if (state === 'missing') {
    return {
      note: '路径不存在，可能已被其他程序删除或移动。',
      noteLevel: 'warning'
    }
  }
  return {
    note: '无法确认占用状态，可能是权限不足。可尝试以管理员身份运行 ZTools 后重新扫描。',
    noteLevel: 'warning'
  }
}

/**
 * Find processes locking a file/directory, each annotated with witr-style `why`.
 *
 * Detection is evidence-based only (witr --file / Restart Manager).
 * Kill is a separate, user-initiated action — never guessed here.
 *
 * @returns {Promise<{
 *   locked: boolean|null,
 *   blocked: boolean|null,
 *   holders: number,
 *   state: string,
 *   processes: ProcessInfo[],
 *   note?: string,
 *   noteLevel: 'success'|'info'|'warning'|'error',
 *   engine: string
 * }>}
 */
async function findLockingProcesses(filePath) {
  _debugLog = []
  const resolved = path.resolve(filePath)
  debugPush('=== findLockingProcesses ===')
  debugPush('path: ' + resolved)

  if (!fs.existsSync(resolved)) {
    throw new Error('路径不存在: ' + resolved)
  }

  if (isDirectoryPath(resolved)) {
    const folderResult = await findFolderLockingProcesses(resolved)
    debugPush('=== done ===')
    return folderResult
  }

  // 占用探测与占用者检测互不依赖，并行执行以省掉一次 PowerShell 启动
  const statePromise = probePathState(resolved)

  const engines = []
  let holders = []

  // 1) PRIMARY: witr --file — full Result (Process + Ancestry + Source + Warnings)
  debugPush('[unlock] witr --file (主引擎)...')
  try {
    const viaWitr = await why.findFileHoldersByWitr(resolved)
    if (viaWitr && viaWitr.length > 0) {
      debugPush('[unlock] witr --file 找到 ' + viaWitr.length + ' 个占用者')
      holders = holders.concat(viaWitr)
      engines.push('witr')
    } else if (viaWitr) {
      debugPush('[unlock] witr --file: 无占用者')
      engines.push('witr')
    } else {
      debugPush('[unlock] witr 不可用，改用重启管理器')
    }
  } catch (e) {
    debugPush('[unlock] witr --file 出错: ' + e.message)
  }

  // 2) Restart Manager — merge any additional handle holders
  debugPush('[unlock] 重启管理器 (合并)...')
  try {
    const byRM = await findByResourceManager(resolved)
    if (byRM.length > 0) {
      debugPush('[unlock] 重启管理器找到 ' + byRM.length + ' 个进程')
      holders = holders.concat(byRM)
      if (engines.indexOf('resourcemanager') < 0) engines.push('resourcemanager')
    } else if (engines.length === 0) {
      engines.push('resourcemanager')
    }
  } catch (e) {
    debugPush('[unlock] 重启管理器出错: ' + e.message)
  }

  holders = dedupeByPid(holders)

  // Attach full witr Result as `why` for holders that lack it (RM path)
  const processes = await why.withWhyAll(holders)

  const state = await statePromise
  const blocked = state === 'locked' ? true : state === 'free' ? false : null
  const locked = processes.length > 0 ? true : (blocked === null ? null : blocked)
  const info = buildScanNote(processes.length, state)

  const engine = engines.join('+') || 'none'
  debugPush('[unlock] 结果: ' + processes.length + ' 个进程, locked=' + locked + ', state=' + state + ', engine=' + engine)
  debugPush('=== done ===')

  return {
    locked: locked,
    blocked: blocked,
    holders: processes.length,
    state: state,
    processes: processes,
    note: info.note,
    noteLevel: info.noteLevel,
    engine: engine,
    isDirectory: false
  }
}

async function isProcessAlive(pid) {
  try {
    const raw = await execWithTimeout('tasklist', ['/FI', 'PID eq ' + pid, '/NH', '/FO', 'CSV'], 'alive')
    return raw.includes('"' + pid + '"')
  } catch { return false }
}

function looksLikePermissionDenied(text) {
  const s = String(text || '')
  return /拒绝访问|权限|access is denied|access denied|not permitted|denied/i.test(s)
}

/* ------------------------------------------------------------------ *
 * 结束进程
 * ------------------------------------------------------------------ */

function processLabel(pid, name) {
  const n = String(name || '').trim()
  return n ? '「' + n + '」' : ('进程 ' + pid)
}

function targetKind(filePath) {
  return isDirectoryPath(path.resolve(filePath)) ? '文件夹' : '文件'
}

/** Kill is an attached action after diagnosis — never auto-fired from find. */
async function killProcess(pid, name) {
  _debugLog = []
  const label = processLabel(pid, name)
  debugPush('=== killProcess PID: ' + pid + ' ===')
  const killCmd = getKillCommand(pid)
  debugPush('cmd: ' + killCmd.cmd + ' ' + killCmd.args.join(' '))

  return new Promise(function (resolve) {
    const proc = spawn(killCmd.cmd, killCmd.args, { timeout: TIMEOUT_MS, windowsHide: true })
    let stderr = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', function (d) { stderr += d })

    proc.on('error', function (err) {
      debugPush('[kill] spawn error: ' + err.message)
      resolve({
        success: false,
        needsAdmin: false,
        alreadyGone: false,
        message: '无法结束' + label + '：' + err.message + '。请在任务管理器中手动结束该进程。'
      })
    })
    proc.on('close', function (code) {
      debugPush('[kill] exit code: ' + code + (stderr.trim() ? ' stderr=' + stderr.trim().substring(0, 300) : ''))
      if (code === 0) {
        setTimeout(function () {
          isProcessAlive(pid).then(function (alive) {
            if (alive) {
              resolve({
                success: false,
                needsAdmin: true,
                alreadyGone: false,
                message: '无法结束' + label + '：进程仍在运行。它可能需要管理员权限，请以管理员身份运行 ZTools 后重试。'
              })
            } else {
              resolve({ success: true, needsAdmin: false, alreadyGone: false, message: label + '已结束' })
            }
          })
        }, 500)
      } else if (code === 128) {
        resolve({ success: true, needsAdmin: false, alreadyGone: true, message: label + '已经退出，无需处理' })
      } else if (code === 5 || looksLikePermissionDenied(stderr)) {
        resolve({
          success: false,
          needsAdmin: true,
          alreadyGone: false,
          message: '权限不足，无法结束' + label + '。请以管理员身份运行 ZTools 后重试。'
        })
      } else {
        resolve({
          success: false,
          needsAdmin: false,
          alreadyGone: false,
          message: '无法结束' + label + '：系统拒绝了该操作。可以在任务管理器中手动结束它。'
        })
      }
    })
  })
}

/**
 * 结束占用进程并验证占用是否真的解除（闭环）。
 * @returns {Promise<{success: boolean, released: boolean|null, level: 'success'|'warning'|'error', message: string, needsAdmin?: boolean, kill?: object, verify?: object}>}
 */
async function killLockingProcess(filePath, pid, name) {
  const label = processLabel(pid, name)
  const kind = targetKind(filePath)
  const killed = await killProcess(pid, name)
  if (!killed.success) {
    return {
      success: false,
      released: false,
      level: 'error',
      message: killed.message,
      needsAdmin: !!killed.needsAdmin,
      kill: killed
    }
  }

  const verify = await verifyRelease(filePath)
  if (verify.released === true) {
    return {
      success: true,
      released: true,
      level: 'success',
      message: '已解除占用：' + label + '已结束，' + kind + '不再被占用。',
      kill: killed,
      verify: verify
    }
  }
  if (verify.released === false) {
    return {
      success: true,
      released: false,
      level: 'warning',
      message: label + '已结束，但' + kind + '仍被占用：可能还有其他程序或系统服务在访问。请查看下面的剩余占用者。',
      kill: killed,
      verify: verify
    }
  }
  return {
    success: true,
    released: null,
    level: 'warning',
    message: label + '已结束。请重新扫描确认' + kind + '是否已释放。',
    kill: killed,
    verify: verify
  }
}

/**
 * 一键结束全部占用进程，并统一验证是否解除。
 */
async function killAllLockingProcesses(filePath, procs) {
  const kind = targetKind(filePath)
  const list = dedupeByPid(Array.isArray(procs) ? procs : [])
  if (list.length === 0) {
    return { success: false, released: false, level: 'warning', message: '没有需要结束的占用进程。', killed: 0, failed: 0, results: [] }
  }

  const results = []
  for (const p of list) {
    const r = await killProcess(p.pid, p.name)
    results.push(Object.assign({ pid: p.pid, name: p.name }, r))
  }

  const okList = results.filter(function (r) { return r.success })
  const failList = results.filter(function (r) { return !r.success })
  const verify = await verifyRelease(filePath)
  const needsAdmin = failList.some(function (r) { return r.needsAdmin })

  let level = 'success'
  let message
  if (failList.length === 0 && verify.released === true) {
    message = '已解除占用：' + okList.length + ' 个占用进程已全部结束，' + kind + '不再被占用。'
  } else if (failList.length === 0 && verify.released === false) {
    level = 'warning'
    message = '已结束 ' + okList.length + ' 个进程，但' + kind + '仍被占用：可能还有其他程序或系统服务在访问。请查看下面的剩余占用者。'
  } else if (failList.length === 0) {
    level = 'warning'
    message = '已结束 ' + okList.length + ' 个进程。请重新扫描确认' + kind + '是否已释放。'
  } else if (okList.length > 0) {
    level = 'warning'
    message = '已结束 ' + okList.length + ' 个进程，另有 ' + failList.length + ' 个无法结束' +
      (needsAdmin ? '（需要管理员权限）' : '') + '。' +
      (verify.released === true ? kind + '已不再被占用。' : kind + '可能仍被占用。')
  } else {
    level = 'error'
    message = '未能结束任何占用进程。' +
      (needsAdmin ? '请以管理员身份运行 ZTools 后重试。' : '请在任务管理器中手动结束这些进程。')
  }

  return {
    success: okList.length > 0,
    released: verify.released,
    level: level,
    message: message,
    killed: okList.length,
    failed: failList.length,
    needsAdmin: needsAdmin,
    results: results,
    verify: verify
  }
}

module.exports = {
  findLockingProcesses,
  killProcess,
  killLockingProcess,
  killAllLockingProcesses,
  verifyRelease,
  getDebugLog,
  // exposed for tests
  probeExclusiveLock,
  probePathState,
  probeFolderState,
  isDirectoryPath,
  dedupeByPid,
  mergeHoldersByPid,
  findByResourceManager,
  findByWorkingDirectory,
  findByResourceManagerForFolder,
  findFolderLockingProcesses,
  buildResourceManagerScript,
  buildProbeScript,
  psLiteral
}
