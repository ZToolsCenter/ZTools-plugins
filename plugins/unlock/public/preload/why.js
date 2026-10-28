const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const witrInstall = require('./witr-install')

const WITR_TIMEOUT_MS = 20000
const PS_TIMEOUT_MS = 15000
const MAX_ANCESTRY = 32

let _debugLog = []
let _witrPath = undefined

function debugPush(msg) {
  _debugLog.push(msg)
}

function getDebugLog() {
  const logs = _debugLog
  _debugLog = []
  return logs
}

function execCapture(cmd, args, timeoutMs) {
  return new Promise(function (resolve) {
    debugPush('  [exec] ' + cmd + ' ' + args.map(function (a) {
      return /\s/.test(a) ? JSON.stringify(a) : a
    }).join(' '))
    const proc = spawn(cmd, args, { timeout: timeoutMs || PS_TIMEOUT_MS, windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', function (d) { stdout += d })
    proc.stderr.on('data', function (d) { stderr += d })
    proc.on('error', function (err) {
      debugPush('  [exec] spawn error: ' + err.message)
      resolve({ ok: false, code: -1, stdout: '', stderr: err.message })
    })
    proc.on('close', function (code) {
      debugPush('  [exec] exit: ' + code + (stderr.trim() ? ' stderr=' + stderr.trim().slice(0, 200) : ''))
      // witr: 0=ok, 1=ok with warnings, 2=not found, 3=permission, 4=multiple matches (prose, not JSON), 5=internal
      resolve({ ok: code === 0 || code === 1, code: code, stdout: stdout, stderr: stderr })
    })
  })
}

function writeTempScript(content) {
  const scriptPath = path.join(
    os.tmpdir(),
    'why-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1'
  )
  fs.writeFileSync(scriptPath, '﻿' + content, 'utf8')
  return scriptPath
}

function runPowerShellScript(scriptContent, label) {
  const scriptPath = writeTempScript(scriptContent)
  return execCapture('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
  ], PS_TIMEOUT_MS).then(function (res) {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
    if (!res.ok) {
      debugPush('[why] ' + (label || 'ps') + ' failed: ' + (res.stderr || ('exit ' + res.code)))
    }
    return res
  })
}

/** Resolve witr.exe (sync). Never returns a path inside .asar (spawn would ENOENT). */
function findWitrBin() {
  if (_witrPath !== undefined) return _witrPath
  const found = witrInstall.findWitrBinSync()
  _witrPath = found || null
  if (found) debugPush('[why] witr bin: ' + found)
  else debugPush('[why] witr not found yet (will extract/download)')
  return _witrPath
}

/**
 * Ensure a *spawnable* witr is available (extract from asar or download).
 * @returns {Promise<string|null>}
 */
function ensureWitrBin() {
  const existing = findWitrBin()
  if (existing) return Promise.resolve(existing)
  // clear stale null cache before install attempt
  _witrPath = undefined
  return witrInstall.ensureWitr().then(function (bin) {
    _witrPath = bin || null
    if (bin) debugPush('[why] witr ready: ' + bin)
    else debugPush('[why] witr still unavailable')
    return _witrPath
  })
}

function resetWitrCache() {
  _witrPath = undefined
}

/**
 * Run witr CLI. Accepts exit 0/1 as success (1 = found with warnings).
 * Always requests --json --no-color for machine parsing.
 *
 * 退出码 4 不是失败：witr 在目标匹配到多个进程时会退出 4，并输出**人类可读**的列表
 * （"Multiple matching processes found: [1] xxx.exe (pid 123)…"），需要单独解析。
 * @returns {Promise<{ok:boolean, code:number, results:object[], raw:string, notFound:boolean, multiple?:{pid:number,name:string}[]}>}
 */
function runWitr(args, label) {
  return ensureWitrBin().then(function (bin) {
    if (!bin) {
      return { ok: false, code: -1, results: [], raw: '', notFound: false, reason: 'witr-unavailable' }
    }
    const fullArgs = args.concat(['--json', '--no-color'])
    return execCapture(bin, fullArgs, WITR_TIMEOUT_MS).then(function (res) {
      const raw = stripBom(res.stdout || '')
      if (res.code === 2) {
        debugPush('[witr] ' + (label || '') + ' not found')
        return { ok: true, code: 2, results: [], raw: raw, notFound: true }
      }
      if (res.code === 3) {
        debugPush('[witr] ' + (label || '') + ' permission denied')
        return { ok: false, code: 3, results: [], raw: raw, notFound: false, reason: 'permission' }
      }
      if (res.code === 4) {
        const multiple = parseWitrMultipleTargets(raw)
        debugPush('[witr] ' + (label || '') + ' 匹配到 ' + multiple.length + ' 个目标 (exit 4)')
        return { ok: true, code: 4, results: [], raw: raw, notFound: multiple.length === 0, multiple: multiple }
      }
      if (res.code === 5) {
        debugPush('[witr] ' + (label || '') + ' 内部错误: ' + raw.trim().slice(0, 200))
        return { ok: false, code: 5, results: [], raw: raw, notFound: false, reason: 'internal' }
      }
      if (!res.ok && !raw.trim()) {
        debugPush('[witr] ' + (label || '') + ' failed code=' + res.code)
        return { ok: false, code: res.code, results: [], raw: raw, notFound: false, reason: res.stderr || 'failed' }
      }
      const results = parseWitrJsonStream(raw)
      debugPush('[witr] ' + (label || '') + ' → ' + results.length + ' result(s)')
      return { ok: true, code: res.code, results: results, raw: raw, notFound: results.length === 0 }
    })
  })
}

/**
 * 解析 witr 退出码 4 时的多目标文本列表：
 *
 *   Multiple matching processes found:
 *
 *   [1] powershell.exe (pid 43396)
 *       powershell.exe -NoProfile ...
 *   [2] powershell.exe (pid 38476)
 *
 * @returns {{pid:number, name:string}[]}
 */
function parseWitrMultipleTargets(raw) {
  const text = stripBom(raw)
  const out = []
  const seen = new Set()
  const re = /^\s*\[\d+\]\s+(.+?)\s*\(pid\s+(\d+)\)/gm
  let m
  while ((m = re.exec(text)) !== null) {
    const pid = Number(m[2])
    if (!pid || seen.has(pid)) continue
    seen.add(pid)
    out.push({ pid: pid, name: String(m[1] || '').trim() })
  }
  return out
}

function stripBom(s) {
  return String(s || '').replace(/^﻿/, '')
}

/** Parse one or more concatenated witr JSON documents (multi-target). */
function parseWitrJsonStream(raw) {
  const trimmed = stripBom(raw).trim()
  if (!trimmed) return []
  try {
    const one = JSON.parse(trimmed)
    return normalizeWitrDocuments(one)
  } catch (e) {
    const objs = splitJsonObjects(trimmed)
    const out = []
    for (let i = 0; i < objs.length; i++) {
      out.push.apply(out, normalizeWitrDocuments(objs[i]))
    }
    return out
  }
}

function normalizeWitrDocuments(data) {
  if (data == null) return []
  if (Array.isArray(data)) {
    // short shape: [{PID, Command}, ...] OR array of Results
    if (data.length === 0) return []
    if (data[0] && (data[0].Process || data[0].Target || data[0].Ancestry)) {
      return data.map(function (d) { return parseWitrResult(d) }).filter(Boolean)
    }
    if (data[0] && (data[0].PID != null || data[0].pid != null)) {
      const parsed = parseWitrResult(data)
      return parsed ? [parsed] : []
    }
    return []
  }
  // warnings-only shape: {PID, Process, Command, Warnings}
  if (data.PID != null && data.Process != null && data.Target == null && data.Ancestry == null && !data.Source) {
    return [parseWarningsJson(data)]
  }
  const parsed = parseWitrResult(data)
  return parsed ? [parsed] : []
}

function formatAncestryText(ancestry) {
  if (!Array.isArray(ancestry) || ancestry.length === 0) return ''
  return ancestry.map(function (p) {
    const rawName = (p.name || p.Command || p.command || '').trim()
    const name = rawName || '(unknown)'
    const pid = p.pid != null ? p.pid : (p.PID != null ? p.PID : 0)
    return name + ' (pid ' + pid + ')'
  }).join(' → ')
}

function normalizeChainItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const pid = Number(raw.pid != null ? raw.pid : raw.PID) || 0
  let name = String(raw.name || raw.Command || raw.command || '').trim()
  // witr prints empty Command as (unknown)
  if (!name) name = '(unknown)'
  if (!pid && name === '(unknown)') return null
  return {
    pid: pid,
    name: name,
    ppid: Number(raw.ppid != null ? raw.ppid : raw.PPID) || 0,
    exe: String(raw.exe || raw.Exe || ''),
    cmd: String(raw.cmd || raw.Cmdline || raw.cmdLine || ''),
    user: String(raw.user || raw.User || ''),
    startedAt: String(raw.startedAt || raw.StartedAt || ''),
    workingDir: String(raw.workingDir || raw.WorkingDir || ''),
    gitRepo: String(raw.gitRepo || raw.GitRepo || ''),
    gitBranch: String(raw.gitBranch || raw.GitBranch || ''),
    health: String(raw.health || raw.Health || '')
  }
}

function normalizeChain(list) {
  if (!Array.isArray(list)) return []
  const chain = []
  for (let i = 0; i < list.length; i++) {
    const item = normalizeChainItem(list[i])
    if (item) chain.push(item)
    if (chain.length >= MAX_ANCESTRY) break
  }
  return chain
}

/**
 * witr model.Source → { type, name, description, unitFile, details }
 * Human format is: `Name (type)` e.g. `Explorer.EXE (shell)`
 */
function normalizeSource(src) {
  if (!src || typeof src !== 'object') {
    return { type: 'unknown', name: '', description: '', unitFile: '', details: null }
  }
  return {
    type: String(src.Type || src.type || 'unknown').toLowerCase(),
    name: String(src.Name || src.name || ''),
    description: String(src.Description || src.description || ''),
    unitFile: String(src.UnitFile || src.unitFile || ''),
    details: src.Details || src.details || null
  }
}

function formatSourceLine(source) {
  if (!source) return ''
  const name = source.name || ''
  const type = source.type || 'unknown'
  if (!name) return type
  return name + ' (' + type + ')'
}

function normalizeSockets(list) {
  if (!Array.isArray(list)) return []
  return list.map(function (s) {
    if (!s || typeof s !== 'object') return null
    return {
      port: Number(s.Port != null ? s.Port : s.port) || 0,
      address: String(s.Address != null ? s.Address : s.address || ''),
      state: String(s.State != null ? s.State : s.state || ''),
      protocol: String(s.Protocol != null ? s.Protocol : s.protocol || '')
    }
  }).filter(Boolean)
}

function parseWarningsJson(data) {
  const warnings = Array.isArray(data.Warnings) ? data.Warnings.map(String) : []
  const pid = Number(data.PID) || 0
  const name = String(data.Process || '')
  const chain = pid ? [{ pid: pid, name: name || '(unknown)', ppid: 0, exe: '', cmd: String(data.Command || ''), user: '', startedAt: '', workingDir: '', gitRepo: '', gitBranch: '', health: '' }] : []
  return {
    engine: 'witr',
    target: { type: 'pid', value: String(pid) },
    resolvedTarget: name,
    process: {
      pid: pid,
      ppid: 0,
      command: name,
      cmdLine: String(data.Command || ''),
      exe: '',
      startedAt: '',
      user: '',
      workingDir: '',
      gitRepo: '',
      gitBranch: '',
      container: '',
      service: '',
      health: ''
    },
    restartCount: 0,
    ancestry: chain,
    ancestryText: formatAncestryText(chain),
    source: { type: 'unknown', name: '', description: '', unitFile: '', details: null },
    sourceLine: '',
    warnings: warnings,
    workingDir: '',
    cmdLine: String(data.Command || ''),
    gitRepo: '',
    gitBranch: '',
    user: '',
    startedAt: '',
    sockets: [],
    children: []
  }
}

/**
 * Parse a witr Result document (Go capitalized JSON) into WhyInfo.
 * Also accepts short/tree shapes.
 */
function parseWitrResult(dataOrRaw) {
  let data = dataOrRaw
  if (typeof dataOrRaw === 'string') {
    const trimmed = stripBom(dataOrRaw).trim()
    if (!trimmed) return null
    try {
      data = JSON.parse(trimmed)
    } catch (e) {
      const objs = splitJsonObjects(trimmed)
      if (objs.length > 0) data = objs[0]
      else return null
    }
  }

  if (Array.isArray(data)) {
    const looksLikeChain = data.length > 0 && data.every(function (item) {
      return item && typeof item === 'object' && !item.Process && !item.Ancestry && !item.Target &&
        (item.PID != null || item.pid != null)
    })
    if (looksLikeChain || data.length === 0) {
      const chainOnly = normalizeChain(data)
      return {
        engine: 'witr',
        target: { type: 'pid', value: '' },
        resolvedTarget: '',
        process: chainOnly.length ? {
          pid: chainOnly[chainOnly.length - 1].pid,
          ppid: chainOnly[chainOnly.length - 1].ppid,
          command: chainOnly[chainOnly.length - 1].name,
          cmdLine: chainOnly[chainOnly.length - 1].cmd,
          exe: chainOnly[chainOnly.length - 1].exe,
          startedAt: '',
          user: '',
          workingDir: '',
          gitRepo: '',
          gitBranch: '',
          container: '',
          service: '',
          health: ''
        } : emptyProcess(),
        restartCount: 0,
        ancestry: chainOnly,
        ancestryText: formatAncestryText(chainOnly),
        source: { type: 'unknown', name: '', description: '', unitFile: '', details: null },
        sourceLine: '',
        warnings: [],
        workingDir: '',
        cmdLine: chainOnly.length ? chainOnly[chainOnly.length - 1].cmd : '',
        gitRepo: '',
        gitBranch: '',
        user: '',
        startedAt: '',
        sockets: [],
        children: []
      }
    }
    data = data[0]
  }

  if (!data || typeof data !== 'object') return null

  // warnings-only
  if (data.PID != null && data.Process != null && data.Target == null && data.Ancestry == null && !data.Source) {
    return parseWarningsJson(data)
  }

  // tree shape without Process/Target
  if (Array.isArray(data.Ancestry) && !data.Process && !data.Target) {
    const chain = normalizeChain(data.Ancestry)
    const children = normalizeChain(data.Children || [])
    return {
      engine: 'witr',
      target: { type: 'pid', value: '' },
      resolvedTarget: '',
      process: emptyProcess(),
      restartCount: 0,
      ancestry: chain,
      ancestryText: formatAncestryText(chain),
      source: { type: 'unknown', name: '', description: '', unitFile: '', details: null },
      sourceLine: '',
      warnings: [],
      workingDir: '',
      cmdLine: '',
      gitRepo: '',
      gitBranch: '',
      user: '',
      startedAt: '',
      sockets: [],
      children: children
    }
  }

  const processRaw = data.Process || data.process || {}
  const self = normalizeChainItem(processRaw)
  let chain = normalizeChain(data.Ancestry || data.ancestry || [])
  if (chain.length === 0) {
    if (self) chain = [self]
  } else if (self && chain[chain.length - 1].pid !== self.pid) {
    chain = chain.concat([self])
  }

  const source = normalizeSource(data.Source || data.source)
  const warnings = Array.isArray(data.Warnings || data.warnings)
    ? (data.Warnings || data.warnings).map(String)
    : []

  const process = {
    pid: Number(processRaw.PID != null ? processRaw.PID : processRaw.pid) || (self ? self.pid : 0),
    ppid: Number(processRaw.PPID != null ? processRaw.PPID : processRaw.ppid) || (self ? self.ppid : 0),
    command: String(processRaw.Command != null ? processRaw.Command : (processRaw.command || (self ? self.name : ''))),
    cmdLine: String(processRaw.Cmdline != null ? processRaw.Cmdline : (processRaw.cmdLine || (self ? self.cmd : ''))),
    exe: String(processRaw.Exe != null ? processRaw.Exe : (processRaw.exe || (self ? self.exe : ''))),
    startedAt: String(processRaw.StartedAt != null ? processRaw.StartedAt : (processRaw.startedAt || '')),
    user: String(processRaw.User != null ? processRaw.User : (processRaw.user || '')),
    workingDir: String(processRaw.WorkingDir != null ? processRaw.WorkingDir : (processRaw.workingDir || '')),
    gitRepo: String(processRaw.GitRepo != null ? processRaw.GitRepo : (processRaw.gitRepo || '')),
    gitBranch: String(processRaw.GitBranch != null ? processRaw.GitBranch : (processRaw.gitBranch || '')),
    container: String(processRaw.Container != null ? processRaw.Container : (processRaw.container || '')),
    service: String(processRaw.Service != null ? processRaw.Service : (processRaw.service || '')),
    health: String(processRaw.Health != null ? processRaw.Health : (processRaw.health || '')),
    deleted: !!(processRaw.ExeDeleted || processRaw.deleted)
  }

  const targetRaw = data.Target || data.target || {}
  const sockets = normalizeSockets(processRaw.Sockets || processRaw.sockets)
  const children = normalizeChain(data.Children || data.children || [])

  return {
    engine: 'witr',
    target: {
      type: String(targetRaw.Type || targetRaw.type || '').toLowerCase(),
      value: String(targetRaw.Value != null ? targetRaw.Value : (targetRaw.value || ''))
    },
    resolvedTarget: String(data.ResolvedTarget || data.resolvedTarget || ''),
    process: process,
    restartCount: Number(data.RestartCount != null ? data.RestartCount : data.restartCount) || 0,
    ancestry: chain,
    ancestryText: formatAncestryText(chain),
    source: source,
    sourceLine: formatSourceLine(source),
    warnings: warnings,
    workingDir: process.workingDir,
    cmdLine: process.cmdLine,
    gitRepo: process.gitRepo,
    gitBranch: process.gitBranch,
    user: process.user,
    startedAt: process.startedAt,
    sockets: sockets,
    children: children
  }
}

function emptyProcess() {
  return {
    pid: 0, ppid: 0, command: '', cmdLine: '', exe: '',
    startedAt: '', user: '', workingDir: '', gitRepo: '', gitBranch: '',
    container: '', service: '', health: '', deleted: false
  }
}

function splitJsonObjects(text) {
  const out = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(text.slice(start, i + 1))) } catch (e) {}
        start = -1
      }
    }
  }
  return out
}

function parseNativeWhy(raw) {
  const trimmed = stripBom(raw).trim()
  if (!trimmed) return null
  let data
  try {
    data = JSON.parse(trimmed)
  } catch (e) {
    return null
  }
  if (!data || typeof data !== 'object') return null

  const chain = normalizeChain(data.ancestry || data.Ancestry || [])
  const src = normalizeSource(data.source || data.Source)
  const warnings = Array.isArray(data.warnings || data.Warnings)
    ? (data.warnings || data.Warnings).map(String)
    : []
  const self = chain.length ? chain[chain.length - 1] : null

  return {
    engine: 'native',
    target: { type: 'pid', value: self ? String(self.pid) : '' },
    resolvedTarget: self ? self.name : '',
    process: {
      pid: self ? self.pid : 0,
      ppid: self ? self.ppid : 0,
      command: self ? self.name : '',
      cmdLine: self ? self.cmd : '',
      exe: self ? self.exe : '',
      startedAt: '',
      user: '',
      workingDir: String(data.workingDir || ''),
      gitRepo: '',
      gitBranch: '',
      container: '',
      service: '',
      health: ''
    },
    restartCount: 0,
    ancestry: chain,
    ancestryText: formatAncestryText(chain),
    source: src,
    sourceLine: formatSourceLine(src),
    warnings: warnings,
    workingDir: String(data.workingDir || ''),
    cmdLine: self ? self.cmd : '',
    gitRepo: '',
    gitBranch: '',
    user: '',
    startedAt: '',
    sockets: [],
    children: []
  }
}

function buildNativeWhyScript(pid) {
  const n = Number(pid) | 0
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "SilentlyContinue"',
    '$targetPid = ' + n,
    '$chain = New-Object System.Collections.Generic.List[object]',
    '$seen = @{}',
    '$cur = $targetPid',
    'while ($cur -gt 0 -and -not $seen.ContainsKey($cur) -and $chain.Count -lt 24) {',
    '  $seen[$cur] = $true',
    '  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $cur"',
    '  if (-not $p) { break }',
    '  $chain.Add([ordered]@{',
    '    pid = [int]$p.ProcessId',
    '    name = $p.Name',
    '    cmd = $p.CommandLine',
    '    ppid = [int]$p.ParentProcessId',
    '    exe = $p.ExecutablePath',
    '  })',
    '  $cur = [int]$p.ParentProcessId',
    '}',
    '$chain.Reverse()',
    'if ($chain.Count -eq 0) {',
    '  Write-Output "{`"ancestry`":[],`"source`":{`"type`":`"unknown`",`"name`":`"`",`"description`":`"`"},`"warnings`":[]}"',
    '  exit',
    '}',
    '$target = $chain[$chain.Count - 1]',
    '$parent = $null',
    'if ($chain.Count -ge 2) { $parent = $chain[$chain.Count - 2] }',
    '$svc = Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -eq $targetPid } | Select-Object -First 1',
    '$sourceType = "unknown"',
    '$sourceName = ""',
    '$sourceDesc = ""',
    'if ($svc) {',
    '  $sourceType = "windows_service"',
    '  $sourceName = $svc.Name',
    '  $sourceDesc = $svc.DisplayName',
    '} elseif ($parent -and $parent.name -match "(?i)services\\.exe") {',
    '  $sourceType = "windows_service"',
    '  $sourceName = "services.exe"',
    '  $sourceDesc = "Windows Service Control Manager"',
    '} elseif ($parent -and $parent.name -match "(?i)svchost") {',
    '  $sourceType = "windows_service"',
    '  $sourceName = "svchost.exe"',
    '  $sourceDesc = "Hosted Windows service"',
    '} elseif ($parent -and $parent.name -match "(?i)taskeng|taskhost|taskhostw") {',
    '  $sourceType = "cron"',
    '  $sourceName = $parent.name',
    '  $sourceDesc = "Task Scheduler task"',
    '} elseif ($parent -and $parent.name -match "(?i)explorer") {',
    '  $sourceType = "shell"',
    '  $sourceName = "explorer.exe"',
    '  $sourceDesc = "Interactive desktop session"',
    '} elseif ($parent -and $parent.name -match "(?i)cmd|powershell|pwsh|WindowsTerminal|wt") {',
    '  $sourceType = "shell"',
    '  $sourceName = $parent.name',
    '  $sourceDesc = "Interactive shell session"',
    '} elseif ($parent -and $parent.name -match "(?i)wininit|csrss|smss") {',
    '  $sourceType = "init"',
    '  $sourceName = $parent.name',
    '  $sourceDesc = "Windows system process"',
    '} elseif ($chain.Count -eq 1) {',
    '  $sourceType = "init"',
    '  $sourceName = $target.name',
    '  $sourceDesc = "System / root process"',
    '} elseif ($parent) {',
    '  $sourceName = $parent.name',
    '  $sourceDesc = "Started by parent process"',
    '}',
    '$warnings = @()',
    'if ($target.cmd -match "(?i)LD_PRELOAD|DYLD_") { $warnings += "Command line contains library preload indicators" }',
    '$result = [ordered]@{',
    '  ancestry = $chain',
    '  source = [ordered]@{ type = $sourceType; name = $sourceName; description = $sourceDesc }',
    '  warnings = $warnings',
    '  workingDir = ""',
    '}',
    '$result | ConvertTo-Json -Depth 6 -Compress'
  ].join('\n')
}

function explainByWitr(pid) {
  return runWitr(['--pid', String(Number(pid) | 0)], 'pid:' + pid).then(function (res) {
    if (!res.ok || res.results.length === 0) return null
    return res.results[0]
  })
}

function explainByNative(pid) {
  const script = buildNativeWhyScript(pid)
  return runPowerShellScript(script, 'native-why').then(function (res) {
    if (!res.ok) return null
    return parseNativeWhy(res.stdout)
  })
}

/**
 * Explain why a process exists (full witr Result). Prefer witr, fall back to native.
 * @returns {Promise<WhyInfo|null>}
 */
function explainProcess(pid) {
  return explainByWitr(pid).then(function (viaWitr) {
    if (viaWitr) return viaWitr
    return explainByNative(pid)
  })
}

/**
 * witr 多目标文本里的条目 → ProcessInfo（逐个用 witr --pid 补全溯源信息）。
 */
function targetToProcessInfo(target) {
  return explainByWitr(target.pid).then(function (why) {
    if (why) return whyToProcessInfo(why)
    // 进程可能在两次调用之间退出：先给出基本信息，后续 withWhyAll 会再尝试补全
    return {
      pid: target.pid,
      name: target.name,
      exePath: '',
      detectSource: 'witr',
      confidence: 'medium',
      cmdLine: '',
      user: '',
      startedAt: ''
    }
  })
}

function resolveTargets(targets) {
  return Promise.all(targets.map(function (t) {
    return targetToProcessInfo(t)
  })).then(function (list) {
    return list.filter(Boolean)
  })
}

/**
 * Find process(es) holding a file via `witr --file`.
 * 一个文件被多个进程占用时 witr 退出码 4 并输出文本列表，这里展开成多条记录。
 * @returns {Promise<ProcessInfo[] | null>} null if witr unavailable
 */
function findFileHoldersByWitr(filePath) {
  return runWitr(['--file', filePath], 'file').then(function (res) {
    if (!res.ok) return null
    if (res.multiple && res.multiple.length > 0) {
      debugPush('[witr] file → ' + res.multiple.length + ' holder(s) (multi-target)')
      return resolveTargets(res.multiple)
    }
    return res.results.map(function (why) {
      return whyToProcessInfo(why)
    }).filter(Boolean)
  })
}

/**
 * Find process(es) owning a port via `witr --port`.
 * Socket rows are filtered to the queried port (witr returns every socket of the process).
 * @returns {Promise<PortInfo[] | null>}
 */
function findPortOwnersByWitr(port) {
  return runWitr(['--port', String(port)], 'port:' + port).then(function (res) {
    if (!res.ok) return null
    if (res.multiple && res.multiple.length > 0) {
      debugPush('[witr] port → ' + res.multiple.length + ' owner(s) (multi-target)')
      return Promise.all(res.multiple.map(function (t) { return explainByWitr(t.pid) })).then(function (whys) {
        const out = []
        whys.forEach(function (why) {
          if (!why) return
          const infos = whyToPortInfo(why, port)
          if (infos && infos.length) out.push.apply(out, infos)
        })
        return out
      })
    }
    const out = []
    for (let i = 0; i < res.results.length; i++) {
      const infos = whyToPortInfo(res.results[i], port)
      if (infos && infos.length) out.push.apply(out, infos)
    }
    return out
  })
}

/**
 * Map one witr Result to PortInfo rows (one per matching socket).
 * @param {object} why
 * @param {number|string} [onlyPort] keep only this local port
 */
function whyToPortInfo(why, onlyPort) {
  if (!why || !why.process) return []
  const p = why.process
  let socks = Array.isArray(why.sockets) ? why.sockets.slice() : []
  if (onlyPort != null && onlyPort !== '') {
    const n = Number(onlyPort) | 0
    const filtered = socks.filter(function (s) { return (s.port | 0) === n })
    if (filtered.length) socks = filtered
  }
  if (!socks.length) {
    socks = [{
      port: Number(onlyPort) | 0,
      address: '',
      state: 'LISTEN',
      protocol: 'TCP'
    }]
  }
  return socks.map(function (s) {
    return {
      pid: p.pid,
      processName: p.command || '(unknown)',
      exePath: p.exe || '',
      protocol: (String(s.protocol).toUpperCase() === 'UDP' ? 'UDP' : 'TCP'),
      state: s.state || '',
      localAddress: s.address || '',
      localPort: s.port || 0,
      why: why
    }
  })
}

function whyToProcessInfo(why) {
  if (!why || !why.ancestry || why.ancestry.length === 0) return null
  const p = why.process || {}
  const self = why.ancestry[why.ancestry.length - 1]
  return {
    pid: p.pid || self.pid,
    name: p.command || self.name,
    exePath: p.exe || self.exe || '',
    detectSource: 'witr',
    confidence: 'high',
    cmdLine: p.cmdLine || self.cmd || '',
    user: p.user || '',
    startedAt: p.startedAt || '',
    why: why
  }
}

function withWhy(proc) {
  if (!proc || !proc.pid) return Promise.resolve(proc)
  if (proc.why && proc.why.ancestryText) return Promise.resolve(proc)
  return explainProcess(proc.pid).then(function (why) {
    return Object.assign({}, proc, {
      why: why || parseNativeWhy('{"ancestry":[],"source":{},"warnings":[]}')
    })
  })
}

function withWhyAll(procs) {
  const list = Array.isArray(procs) ? procs : []
  return Promise.all(list.map(withWhy))
}

module.exports = {
  findWitrBin,
  ensureWitrBin,
  resetWitrCache,
  runWitr,
  formatAncestryText,
  formatSourceLine,
  normalizeChain,
  normalizeSource,
  parseWitrResult,
  parseWitrJsonStream,
  parseNativeWhy,
  splitJsonObjects,
  buildNativeWhyScript,
  explainProcess,
  explainByWitr,
  explainByNative,
  findFileHoldersByWitr,
  findPortOwnersByWitr,
  parseWitrMultipleTargets,
  resolveTargets,
  targetToProcessInfo,
  whyToProcessInfo,
  whyToPortInfo,
  withWhy,
  withWhyAll,
  getDebugLog
}
