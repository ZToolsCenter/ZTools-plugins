# Unlock File v2 — 三合一模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the ZTools unlock-file plugin from a single-purpose file unlocker into a three-tab tool (Unlock + Shredder + Port Scanner), while simplifying the unlock backend to rely solely on handle.exe.

**Architecture:** Three Vue tab components share a Node preload with three module files (`unlock.js`, `shredder.js`, `portscan.js`), all registered on `window.services`. Unlock detection drops Restart Manager / Win32_Process / exclusive-lock probe — handle.exe is the sole detection source. Shredder uses pure PowerShell (no external binary). Port scanner uses `Get-NetTCPConnection`.

**Tech Stack:** Vue 3 (script setup, TS), Node preload (no framework), PowerShell 5.1, handle.exe, node:test, Vite.

---

## File Structure

### Created
| File | Responsibility |
|------|---------------|
| `public/preload/unlock.js` | handle.exe invocation, output parsing, taskkill |
| `public/preload/shredder.js` | file/dir delete and shred via PowerShell |
| `public/preload/portscan.js` | port→process lookup via Get-NetTCPConnection |
| `src/Unlock/UnlockTab.vue` | UI for unlock module |
| `src/Unlock/ShredderTab.vue` | UI for shredder module |
| `src/Unlock/PortTab.vue` | UI for port scanner module |

### Deleted
| File | Reason |
|------|--------|
| `public/preload/detect-lock.ps1` | Restart Manager script — no longer used |
| `public/preload/detect-parse.js` | RM JSON parser — no longer used |
| `public/preload/detect-parse.test.js` | Tests for deleted module |

### Modified
| File | Change |
|------|--------|
| `public/preload/services.js` | Import from unlock/shredder/portscan instead of inline functions |
| `src/env.d.ts` | Add TabType, PortInfo, ShredderResult types; remove AppType |
| `src/Unlock/index.vue` | Rewrite to tab container with debug panel |
| `plugin.json` | Optionally rename/update description |

### Unchanged
| File | Reason |
|------|--------|
| `public/preload/handle.exe` | Sysinternals binary, already downloaded |
| `public/preload/handle-parse.js` | Still needed by unlock.js |
| `public/preload/handle-parse.test.js` | 8 existing tests, still valid |
| `public/preload/utils.js` | getKillCommand unchanged |
| `public/preload/utils.test.js` | 2 existing tests, still valid |

---

### Task 1: Update Type Definitions

**Files:**
- Modify: `src/env.d.ts`

- [ ] **Step 1: Read current env.d.ts**

Run: `Get-Content src/env.d.ts`

- [ ] **Step 2: Replace with new types**

Write to `src/env.d.ts`:
```ts
/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export type TabType = 'unlock' | 'shredder' | 'port'

export interface ProcessInfo {
  pid: number
  name: string
  exePath: string
}

export interface OperationResult {
  success: boolean
  message: string
}

export interface PortInfo {
  pid: number
  processName: string
  exePath: string
  protocol: 'TCP' | 'UDP'
  state: string
  localAddress: string
  localPort: number
}

export interface ShredderResult {
  success: boolean
  message: string
  filesProcessed?: number
  locked?: boolean
}

export interface Services {
  findLockingProcesses: (filePath: string) => Promise<ProcessInfo[]>
  killProcess: (pid: number) => Promise<OperationResult>
  shredPath: (filePath: string, mode: 'delete' | 'shred') => Promise<ShredderResult>
  findPortProcess: (port: number) => Promise<PortInfo[]>
  getDebugLog: () => string[]
  getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApi & { getPathForFile(file: File): string }
  }
}

export {}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `node --no-warnings ..\node_modules\.bin\vue-tsc --noEmit`
Expected: exit 0, no errors

- [ ] **Step 4: Commit**

```bash
git add src/env.d.ts
git commit -m "feat(types): add PortInfo, ShredderResult, TabType; remove AppType"
```

---

### Task 2: Delete Old Detection Modules

**Files:**
- Delete: `public/preload/detect-lock.ps1`
- Delete: `public/preload/detect-parse.js`
- Delete: `public/preload/detect-parse.test.js`

- [ ] **Step 1: Remove files**

```bash
git rm public/preload/detect-lock.ps1 public/preload/detect-parse.js public/preload/detect-parse.test.js
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove Restart Manager detection module (no longer used)"
```

---

### Task 3: Create unlock.js (Simplified Handle-Only Detection)

**Files:**
- Create: `public/preload/unlock.js`

This module contains only `findLockingProcesses` and `killProcess`. It replaces the multi-path detection in the old `services.js` with a single handle.exe call. Chinese paths are handled by writing a temp `.ps1` file as UTF-8 with BOM, ensuring PowerShell passes the path as UTF-16 to handle.exe.

- [ ] **Step 1: Write unlock.js**

Write to `public/preload/unlock.js`:
```js
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { parseHandleExeOutput, isPathInside } = require('./handle-parse')
const { getKillCommand } = require('./utils')

const TIMEOUT_MS = 30000
let _debugLog = []

function debugPush(msg) {
  _debugLog.push(msg)
}

function getDebugLog() {
  const logs = _debugLog
  _debugLog = []
  return logs
}

function execWithTimeout(cmd, args, label) {
  return new Promise((resolve, reject) => {
    debugPush('  [' + (label || 'exec') + '] ' + cmd + ' ' + args.map(a => a.includes(' ') ? '"' + a + '"' : a).join(' '))
    var proc = spawn(cmd, args, { timeout: TIMEOUT_MS })
    var stdout = ''
    var stderr = ''
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

function buildHandleScript(handleExePath, isDir, resolvedPath) {
  var searchTerm = isDir ? resolvedPath : path.basename(resolvedPath)
  var escapedSearch = searchTerm.replace(/'/g, "''")
  var escapedExe = handleExePath.replace(/'/g, "''")
  return [
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    "& '" + escapedExe + "' -accepteula -nobanner -a '" + escapedSearch + "'"
  ].join('\n')
}

async function findLockingProcesses(filePath) {
  _debugLog = []
  var resolved = path.resolve(filePath)
  debugPush('=== findLockingProcesses ===')
  debugPush('path: ' + resolved)
  if (!fs.existsSync(resolved)) {
    throw new Error('path not found: ' + resolved)
  }
  var isDir = fs.statSync(resolved).isDirectory()

  var handleExe = path.join(__dirname, 'handle.exe')
  if (!fs.existsSync(handleExe)) {
    debugPush('[unlock] handle.exe not found at ' + handleExe)
    debugPush('=== done ===')
    return []
  }

  var script = buildHandleScript(handleExe, isDir, resolved)
  var scriptPath = path.join(os.tmpdir(), 'unlock-handle-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1')
  try {
    fs.writeFileSync(scriptPath, '\uFEFF' + script, 'utf8')
    debugPush('[unlock] temp script: ' + scriptPath)
    var raw = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'handle')
    var trimmed = raw.trim()
    var result = []
    if (trimmed) {
      var allHandles = parseHandleExeOutput(trimmed)
      var filtered = isDir
        ? allHandles.filter(function (h) { return isPathInside(h.handlePath, resolved) })
        : allHandles
      result = filtered.map(function (p) {
        return { pid: p.pid, name: p.name, exePath: p.handlePath }
      })
      debugPush('[unlock] found ' + result.length + ' processes')
    } else {
      debugPush('[unlock] no output from handle.exe')
    }
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
  }
  debugPush('=== done ===')
  return result
}

async function isProcessAlive(pid) {
  try {
    var raw = await execWithTimeout('tasklist', ['/FI', 'PID eq ' + pid, '/NH', '/FO', 'CSV'], 'alive')
    return raw.includes('"' + pid + '"')
  } catch { return false }
}

async function killProcess(pid) {
  _debugLog = []
  debugPush('=== killProcess PID: ' + pid + ' ===')
  var killCmd = getKillCommand(pid)
  debugPush('cmd: ' + killCmd.cmd + ' ' + killCmd.args.join(' '))
  return new Promise(function (resolve) {
    var proc = spawn(killCmd.cmd, killCmd.args, { timeout: TIMEOUT_MS })
    proc.on('error', function (err) {
      debugPush('[kill] spawn error: ' + err.message)
      resolve({ success: false, message: 'kill failed: ' + err.message + '. try Task Manager (Ctrl+Shift+Esc).' })
    })
    proc.on('close', function (code) {
      debugPush('[kill] exit code: ' + code)
      if (code === 0) {
        setTimeout(function () {
          isProcessAlive(pid).then(function (alive) {
            if (alive) {
              resolve({ success: false, message: 'PID ' + pid + ' still alive, needs admin rights. use Task Manager.' })
            } else {
              resolve({ success: true, message: 'killed PID ' + pid })
            }
          })
        }, 500)
      } else if (code === 128) {
        resolve({ success: true, message: 'PID ' + pid + ' already exited' })
      } else {
        resolve({ success: false, message: 'kill failed (exit:' + code + '), may need admin rights. use Task Manager.' })
      }
    })
  })
}

module.exports = { findLockingProcesses, killProcess, getDebugLog }
```

- [ ] **Step 2: Verify syntax**

```bash
node --check public/preload/unlock.js
```
Expected: no output (exit 0)

- [ ] **Step 3: Commit**

```bash
git add public/preload/unlock.js
git commit -m "feat(unlock): create handle.exe-only detection module with temp script for Chinese paths"
```

---

### Task 4: Create shredder.js with Tests

**Files:**
- Create: `public/preload/shredder.js`
- Create: `public/preload/shredder.test.js`

The shredder uses only PowerShell built-in cmdlets. Delete mode calls `Remove-Item -Recurse -Force`. Shred mode overwrites each file with random bytes (1 pass, 64KB chunks via `RandomNumberGenerator`) then deletes.

- [ ] **Step 1: Write failing test**

Write to `public/preload/shredder.test.js`:
```js
const assert = require('node:assert')
const { describe, it } = require('node:test')
const { buildShredScript, buildDeleteScript, parseShredResult } = require('./shredder')

describe('shredder', () => {
  describe('buildShredScript', () => {
    it('generates PowerShell script for single file shred', () => {
      var script = buildShredScript('C:\\test\\file.txt')
      assert(script.includes('RandomNumberGenerator'))
      assert(script.includes("'C:\\test\\file.txt'"))
      assert(script.includes('Remove-Item'))
    })

    it('generates PowerShell script for directory shred', () => {
      var script = buildShredScript('C:\\test\\dir')
      assert(script.includes('Get-ChildItem'))
      assert(script.includes('-Recurse'))
      assert(script.includes('-File'))
    })

    it('escapes single quotes in path', () => {
      var script = buildShredScript("C:\\test\\it's.txt")
      assert(script.includes("'C:\\test\\it''s.txt'"))
    })
  })

  describe('buildDeleteScript', () => {
    it('generates Remove-Item for file', () => {
      var script = buildDeleteScript('C:\\test\\file.txt')
      assert(script.includes('Remove-Item'))
      assert(script.includes('-Force'))
    })

    it('generates Remove-Item -Recurse for directory', () => {
      var script = buildDeleteScript('C:\\test\\dir')
      assert(script.includes('-Recurse'))
    })
  })

  describe('parseShredResult', () => {
    it('parses success JSON', () => {
      var result = parseShredResult('{"ok":true,"count":5}')
      assert.strictEqual(result.success, true)
      assert.strictEqual(result.filesProcessed, 5)
    })

    it('parses failure JSON', () => {
      var result = parseShredResult('{"ok":false,"error":"access denied"}')
      assert.strictEqual(result.success, false)
      assert(result.message.includes('access denied'))
    })
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
node --test public/preload/shredder.test.js
```
Expected: 6 failures, all "module not found" or "function not defined"

- [ ] **Step 3: Write minimal shredder.js**

Write to `public/preload/shredder.js`:
```js
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const TIMEOUT_MS = 120000

function buildShredScript(filePath) {
  var escaped = filePath.replace(/'/g, "''")
  var isDir
  try { isDir = fs.statSync(filePath).isDirectory() } catch { isDir = false }
  if (isDir) {
    return [
      '$path = ' + "'" + escaped + "'",
      '$files = Get-ChildItem -Path $path -Recurse -File -ErrorAction Stop',
      '$count = 0',
      '$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()',
      'foreach ($f in $files) {',
      '  try {',
      '    $len = $f.Length',
      '    if ($len -eq 0) { Remove-Item -Force $f.FullName; $count++; continue }',
      '    $buf = [byte[]]::new(65536)',
      '    $fs = [System.IO.File]::Open($f.FullName, "Open", "Write", "None")',
      '    $written = 0',
      '    while ($written -lt $len) {',
      '      $chunk = [Math]::Min(65536, $len - $written)',
      '      if ($chunk -lt 65536) { $buf = [byte[]]::new($chunk) }',
      '      $rng.GetBytes($buf)',
      '      $fs.Write($buf, 0, $chunk)',
      '      $fs.Flush()',
      '      $written += $chunk',
      '    }',
      '    $fs.Close()',
      '    Remove-Item -Force $f.FullName',
      '    $count++',
      '  } catch { }',
      '}',
      'try { Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue } catch {}',
      'Write-Output (ConvertTo-Json @{ ok = $true; count = $count })'
    ].join('\n')
  }
  return [
    '$path = ' + "'" + escaped + "'",
    '$len = (Get-Item $path).Length',
    'if ($len -eq 0) { Remove-Item -Force $path; Write-Output (ConvertTo-Json @{ ok = $true; count = 1 }); exit }',
    '$buf = [byte[]]::new(65536)',
    '$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()',
    '$fs = [System.IO.File]::Open($path, "Open", "Write", "None")',
    '$written = 0',
    'while ($written -lt $len) {',
    '  $chunk = [Math]::Min(65536, $len - $written)',
    '  if ($chunk -lt 65536) { $buf = [byte[]]::new($chunk) }',
    '  $rng.GetBytes($buf)',
    '  $fs.Write($buf, 0, $chunk)',
    '  $fs.Flush()',
    '  $written += $chunk',
    '}',
    '$fs.Close()',
    'Remove-Item -Force $path',
    'Write-Output (ConvertTo-Json @{ ok = $true; count = 1 })'
  ].join('\n')
}

function buildDeleteScript(filePath) {
  var escaped = filePath.replace(/'/g, "''")
  var isDir
  try { isDir = fs.statSync(filePath).isDirectory() } catch { isDir = false }
  if (isDir) {
    return "Remove-Item -Recurse -Force '" + escaped + "'; Write-Output (ConvertTo-Json @{ ok = $true; count = 0 })"
  }
  return "Remove-Item -Force '" + escaped + "'; Write-Output (ConvertTo-Json @{ ok = $true; count = 1 })"
}

function parseShredResult(raw) {
  var trimmed = raw.trim().replace(/^\uFEFF/, '')
  try {
    var parsed = JSON.parse(trimmed)
    if (parsed.ok) {
      return { success: true, message: 'done. ' + (parsed.count || 0) + ' files processed.', filesProcessed: parsed.count || 0 }
    }
    return { success: false, message: parsed.error || 'unknown error' }
  } catch (e) {
    if (trimmed.toLowerCase().includes('access denied') || trimmed.toLowerCase().includes('permission')) {
      return { success: false, message: 'permission denied. try running as admin.', locked: true }
    }
    if (trimmed.toLowerCase().includes('being used') || trimmed.toLowerCase().includes('in use')) {
      return { success: false, message: 'file is in use by another process.', locked: true }
    }
    return { success: false, message: trimmed.substring(0, 200) || 'unknown error' }
  }
}

module.exports = { buildShredScript, buildDeleteScript, parseShredResult }
```

- [ ] **Step 4: Run tests**

```bash
node --test public/preload/shredder.test.js
```
Expected: 6 pass

- [ ] **Step 5: Commit**

```bash
git add public/preload/shredder.js public/preload/shredder.test.js
git commit -m "feat(shredder): add file shred/delete module with PowerShell implementation"
```

---

### Task 5: Create portscan.js with Tests

**Files:**
- Create: `public/preload/portscan.js`
- Create: `public/preload/portscan.test.js`

Uses `Get-NetTCPConnection` and `Get-NetUDPEndpoint` to find processes on a given port. Output is JSON, parsed into `PortInfo[]`.

- [ ] **Step 1: Write failing test**

Write to `public/preload/portscan.test.js`:
```js
const assert = require('node:assert')
const { describe, it } = require('node:test')
const { buildPortQueryScript, parsePortOutput } = require('./portscan')

describe('portscan', () => {
  describe('buildPortQueryScript', () => {
    it('includes the port number', () => {
      var script = buildPortQueryScript(8080)
      assert(script.includes('8080'))
    })

    it('includes Get-NetTCPConnection', () => {
      var script = buildPortQueryScript(443)
      assert(script.includes('Get-NetTCPConnection'))
    })
  })

  describe('parsePortOutput', () => {
    it('parses TCP listening port JSON', () => {
      var json = JSON.stringify([{
        pid: 1234, processName: 'nginx', exePath: 'C:\\nginx.exe',
        protocol: 'TCP', state: 'Listen',
        localAddress: '0.0.0.0', localPort: 8080
      }])
      var result = parsePortOutput(json)
      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0].pid, 1234)
      assert.strictEqual(result[0].protocol, 'TCP')
      assert.strictEqual(result[0].state, 'Listen')
    })

    it('parses UDP endpoint JSON', () => {
      var json = JSON.stringify([{
        pid: 5678, processName: 'dns.exe', exePath: 'C:\\dns.exe',
        protocol: 'UDP', state: 'Listening',
        localAddress: '0.0.0.0', localPort: 53
      }])
      var result = parsePortOutput(json)
      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0].protocol, 'UDP')
    })

    it('handles empty array', () => {
      var result = parsePortOutput('[]')
      assert.strictEqual(result.length, 0)
    })

    it('handles missing owning process info', () => {
      var json = JSON.stringify([{
        pid: 9999, processName: '', exePath: '',
        protocol: 'TCP', state: 'Listen',
        localAddress: '::', localPort: 80
      }])
      var result = parsePortOutput(json)
      assert.strictEqual(result.length, 1)
      assert.strictEqual(result[0].processName, '')
    })

    it('handles multiple connections on same port', () => {
      var json = JSON.stringify([
        { pid: 1, processName: 'a', exePath: '', protocol: 'TCP', state: 'Listen', localAddress: '0.0.0.0', localPort: 80 },
        { pid: 2, processName: 'b', exePath: '', protocol: 'TCP', state: 'Listen', localAddress: '0.0.0.0', localPort: 80 }
      ])
      var result = parsePortOutput(json)
      assert.strictEqual(result.length, 2)
    })
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
node --test public/preload/portscan.test.js
```
Expected: 6 failures

- [ ] **Step 3: Write minimal portscan.js**

Write to `public/preload/portscan.js`:
```js
const { spawn } = require('node:child_process')
const TIMEOUT_MS = 30000

function buildPortQueryScript(port) {
  return [
    '$port = ' + port,
    '$results = @()',
    '$tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue',
    'if ($tcp) {',
    '  foreach ($c in $tcp) {',
    '    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue',
    '    $results += @{',
    '      pid = [int]$c.OwningProcess',
    '      processName = if ($proc) { $proc.ProcessName } else { "" }',
    '      exePath = if ($proc) { $proc.Path } else { "" }',
    '      protocol = "TCP"',
    '      state = $c.State.ToString()',
    '      localAddress = $c.LocalAddress',
    '      localPort = [int]$c.LocalPort',
    '    }',
    '  }',
    '}',
    '$udp = Get-NetUDPEndpoint -LocalPort $port -ErrorAction SilentlyContinue',
    'if ($udp) {',
    '  foreach ($c in $udp) {',
    '    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue',
    '    $results += @{',
    '      pid = [int]$c.OwningProcess',
    '      processName = if ($proc) { $proc.ProcessName } else { "" }',
    '      exePath = if ($proc) { $proc.Path } else { "" }',
    '      protocol = "UDP"',
    '      state = "Listening"',
    '      localAddress = $c.LocalAddress',
    '      localPort = [int]$c.LocalPort',
    '    }',
    '  }',
    '}',
    'if ($results.Count -gt 0) { $results | ConvertTo-Json -Compress } else { Write-Output "[]" }'
  ].join('\n')
}

function parsePortOutput(raw) {
  var trimmed = raw.trim().replace(/^\uFEFF/, '')
  if (!trimmed || trimmed === '[]') return []
  try {
    var parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      return [{
        pid: parsed.pid || 0,
        processName: parsed.processName || '',
        exePath: parsed.exePath || '',
        protocol: parsed.protocol || 'TCP',
        state: parsed.state || '',
        localAddress: parsed.localAddress || '',
        localPort: parsed.localPort || 0
      }]
    }
    return parsed.map(function (p) { return {
      pid: p.pid || 0,
      processName: p.processName || '',
      exePath: p.exePath || '',
      protocol: p.protocol || 'TCP',
      state: p.state || '',
      localAddress: p.localAddress || '',
      localPort: p.localPort || 0
    }})
  } catch (e) {
    return []
  }
}

module.exports = { buildPortQueryScript, parsePortOutput }
```

- [ ] **Step 4: Run tests**

```bash
node --test public/preload/portscan.test.js
```
Expected: 6 pass

- [ ] **Step 5: Commit**

```bash
git add public/preload/portscan.js public/preload/portscan.test.js
git commit -m "feat(portscan): add port occupancy detection module with Get-NetTCPConnection"
```

---

### Task 6: Update services.js

**Files:**
- Modify: `public/preload/services.js`

Replace the current services.js (which has everything inline) with a thin aggregator that imports from the new modules. Keep `getPathForFile` and the debug log infrastructure inline.

- [ ] **Step 1: Read current services.js**

- [ ] **Step 2: Write new services.js**

Write to `public/preload/services.js`:
```js
const { findLockingProcesses, killProcess, getDebugLog: unlockDebugLog } = require('./unlock')
const { buildShredScript, buildDeleteScript, parseShredResult } = require('./shredder')
const { buildPortQueryScript, parsePortOutput } = require('./portscan')
const { spawn } = require('node:child_process')

var _webUtils = null
try { _webUtils = require('electron').webUtils } catch (e) {}

var _debugLog = []
var TIMEOUT_MS = 30000

function debugPush(msg) { _debugLog.push(msg) }

function getDebugLog() {
  var logs = [].concat(unlockDebugLog ? unlockDebugLog() : [])
  logs = logs.concat(_debugLog)
  _debugLog = []
  return logs
}

function execWithTimeout(cmd, args, label) {
  return new Promise(function (resolve, reject) {
    debugPush('  [' + (label || 'exec') + '] ' + cmd + ' ' + args.map(function (a) { return a.includes(' ') ? '"' + a + '"' : a }).join(' '))
    var proc = spawn(cmd, args, { timeout: TIMEOUT_MS })
    var stdout = ''
    var stderr = ''
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

function getPathForFile(file) {
  if (!file) return ''
  if (_webUtils && _webUtils.getPathForFile) {
    try { var p = _webUtils.getPathForFile(file); if (p) return p } catch (e) {}
  }
  if (window.ztools && window.ztools.getPathForFile) {
    try { var p2 = window.ztools.getPathForFile(file); if (p2) return p2 } catch (e) {}
  }
  try { if (file.path) return file.path } catch (e) {}
  return ''
}

async function shredPath(filePath, mode) {
  _debugLog = []
  var resolved = require('node:path').resolve(filePath)
  debugPush('=== shredPath ===')
  debugPush('mode: ' + mode + ', path: ' + resolved)

  try {
    var script = mode === 'shred' ? buildShredScript(resolved) : buildDeleteScript(resolved)
    var tmpDir = require('node:os').tmpdir()
    var scriptPath = require('node:path').join(tmpDir, 'unlock-shred-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1')
    require('node:fs').writeFileSync(scriptPath, '\uFEFF' + script, 'utf8')
    debugPush('[shred] temp script: ' + scriptPath)

    var raw
    try {
      raw = await execWithTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], 'shred')
    } finally {
      try { require('node:fs').unlinkSync(scriptPath) } catch (e) {}
    }

    var result = parseShredResult(raw)
    debugPush('[shred] result: ' + result.message)
    debugPush('=== done ===')
    return result
  } catch (err) {
    debugPush('[shred] error: ' + err.message)
    debugPush('=== done ===')
    return { success: false, message: err.message, locked: false }
  }
}

async function findPortProcess(port) {
  _debugLog = []
  var portNum = parseInt(port, 10)
  debugPush('=== findPortProcess port: ' + portNum + ' ===')
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    debugPush('[portscan] invalid port')
    return []
  }

  try {
    var script = buildPortQueryScript(portNum)
    var tmpDir = require('node:os').tmpdir()
    var scriptPath = require('node:path').join(tmpDir, 'unlock-port-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1')
    require('node:fs').writeFileSync(scriptPath, '\uFEFF' + script, 'utf8')
    debugPush('[portscan] temp script: ' + scriptPath)

    var raw
    try {
      raw = await execWithTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], 'portscan')
    } finally {
      try { require('node:fs').unlinkSync(scriptPath) } catch (e) {}
    }

    var result = parsePortOutput(raw)
    debugPush('[portscan] found ' + result.length + ' entries')
    result.forEach(function (p) {
      debugPush('[portscan]   ' + p.processName + ' PID:' + p.pid + ' ' + p.protocol + ' ' + p.state + ' ' + p.localAddress + ':' + p.localPort)
    })
    debugPush('=== done ===')
    return result
  } catch (err) {
    debugPush('[portscan] error: ' + err.message)
    debugPush('=== done ===')
    return []
  }
}

window.services = {
  findLockingProcesses: findLockingProcesses,
  killProcess: killProcess,
  shredPath: shredPath,
  findPortProcess: findPortProcess,
  getDebugLog: getDebugLog,
  getPathForFile: getPathForFile
}
```

- [ ] **Step 3: Run all tests to confirm nothing broken**

```bash
node --test public/preload/handle-parse.test.js public/preload/utils.test.js public/preload/shredder.test.js public/preload/portscan.test.js
```
Expected: 16 pass (8 + 2 + 6 + 6)

Actually wait, after removing detect-parse.test.js we have:
- handle-parse.test.js: 8
- utils.test.js: 2
- shredder.test.js: 6
- portscan.test.js: 6
Total: 22

- [ ] **Step 4: Verify syntax of services.js**

```bash
node --check public/preload/services.js
```
Expected: no output (exit 0)

- [ ] **Step 5: Commit**

```bash
git add public/preload/services.js
git commit -m "refactor(services): aggregate from unlock/shredder/portscan modules"
```

---

### Task 7: Rewrite index.vue as Tab Container

**Files:**
- Modify: `src/Unlock/index.vue`

Replace current monolithic unlock UI with a tabbed container. Debug panel stays here, tabs are child components.

- [ ] **Step 1: Write new index.vue**

Write to `src/Unlock/index.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import UnlockTab from './UnlockTab.vue'
import ShredderTab from './ShredderTab.vue'
import PortTab from './PortTab.vue'
import type { TabType } from '../env'

const props = defineProps({
  enterAction: {
    type: Object as () => { type: string; payload?: any } | null,
    default: null
  }
})

const activeTab = ref<TabType>('unlock')
const logs = ref<string[]>([])
const showDebug = ref(true)

function addLog(msg: string) {
  var time = new Date().toLocaleTimeString()
  logs.value.push('[' + time + '] ' + msg)
  if (logs.value.length > 200) logs.value.shift()
}

function flushDebugLog() {
  try {
    var debugLogs = window.services.getDebugLog()
    debugLogs.forEach(function (l) { addLog(l) })
  } catch (e) {}
}

function toggleDebug() { showDebug.value = !showDebug.value }

onMounted(function () {
  addLog('plugin loaded')
  if (props.enterAction && props.enterAction.type === 'files') {
    addLog('received files via enterAction')
  }
})

watch(
  function () { return props.enterAction },
  function (action) {
    if (action && action.type === 'files') {
      activeTab.value = 'unlock'
    }
  }
)
</script>

<template>
  <div class="app">
    <div class="tab-bar">
      <button
        :class="['tab-btn', { active: activeTab === 'unlock' }]"
        @click="activeTab = 'unlock'"
      >解除占用</button>
      <button
        :class="['tab-btn', { active: activeTab === 'shredder' }]"
        @click="activeTab = 'shredder'"
      >文件粉碎</button>
      <button
        :class="['tab-btn', { active: activeTab === 'port' }]"
        @click="activeTab = 'port'"
      >端口检测</button>
    </div>

    <div class="tab-content">
      <UnlockTab
        v-if="activeTab === 'unlock'"
        :add-log="addLog"
        :flush-debug-log="flushDebugLog"
      />
      <ShredderTab
        v-if="activeTab === 'shredder'"
        :add-log="addLog"
        :flush-debug-log="flushDebugLog"
      />
      <PortTab
        v-if="activeTab === 'port'"
        :add-log="addLog"
        :flush-debug-log="flushDebugLog"
      />
    </div>

    <div v-if="logs.length > 0" class="debug-panel">
      <div class="debug-header" @click="toggleDebug">
        <span>debug log ({{ logs.length }})</span>
        <span class="debug-toggle">{{ showDebug ? '▼' : '▶' }}</span>
      </div>
      <div v-if="showDebug" class="debug-logs">
        <div v-for="(log, idx) in logs" :key="idx" class="debug-line">{{ log }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app { padding: 20px; box-sizing: border-box; color: var(--text-color, #e0e0e0); }
.tab-bar { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border-color, #444); padding-bottom: 8px; }
.tab-btn { padding: 6px 16px; border: 1px solid transparent; border-radius: 4px 4px 0 0; background: transparent; color: var(--text-secondary, #999); cursor: pointer; font-size: 14px; }
.tab-btn.active { color: var(--primary-color, #42b883); border-color: var(--border-color, #444); border-bottom-color: var(--bg-color, #1e1e1e); background: var(--card-bg, #2a2a2a); }
.tab-btn:hover:not(.active) { color: var(--text-color, #e0e0e0); }
.tab-content { min-height: 200px; }
.debug-panel { margin-top: 16px; border: 1px solid var(--border-color, #444); border-radius: 6px; overflow: hidden; }
.debug-header { padding: 8px 12px; background: var(--card-bg, #2a2a2a); cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-secondary, #999); }
.debug-toggle { font-size: 10px; }
.debug-logs { max-height: 400px; overflow-y: auto; padding: 8px 12px; background: #1a1a1a; font-family: monospace; font-size: 11px; line-height: 1.6; }
.debug-line { color: #a0a0a0; word-break: break-all; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/Unlock/index.vue
git commit -m "feat(ui): add tab container with unlock/shredder/port tabs"
```

---

### Task 8: Create UnlockTab.vue

**Files:**
- Create: `src/Unlock/UnlockTab.vue`

Simplified from the old index.vue: no `__LOCKED__`, no `AppType`, no `appName`. Processes show only name, PID, exePath, and a kill button.

- [ ] **Step 1: Write UnlockTab.vue**

Write to `src/Unlock/UnlockTab.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { ProcessInfo } from '../env'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
}>()

const filePath = ref('')
const processes = ref<ProcessInfo[]>([])
const loading = ref('')
const error = ref('')
const isDragOver = ref(false)
let dragCounter = 0

function handleDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; isDragOver.value = true }
function handleDragLeave(e: DragEvent) { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { isDragOver.value = false; dragCounter = 0 } }
function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation() }

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  dragCounter = 0
  var dt = e.dataTransfer
  if (!dt || !dt.files || !dt.files[0]) {
    props.addLog('drop: no files')
    return
  }
  var file = dt.files[0]
  props.addLog('drop: ' + file.name)
  var fullPath = ''
  if (window.services.getPathForFile) {
    try { fullPath = window.services.getPathForFile(file) } catch (e) {}
  }
  if (!fullPath && (file as any).path) fullPath = (file as any).path
  if (fullPath) { filePath.value = fullPath; handleFind() }
}

function handleBrowse() {
  var files = window.ztools.showOpenDialog({ title: 'select file or directory', properties: ['openFile', 'openDirectory'] })
  if (files && files.length > 0) { filePath.value = files[0]; handleFind() }
}

async function handleFind() {
  if (!filePath.value.trim()) { error.value = 'enter a file path'; return }
  loading.value = 'scanning...'
  error.value = ''
  processes.value = []
  props.addLog('find: ' + filePath.value.trim())
  try {
    var result = await window.services.findLockingProcesses(filePath.value.trim())
    props.flushDebugLog()
    processes.value = result
    props.addLog('found ' + result.length + ' processes')
    if (result.length === 0) error.value = 'no locking processes detected.'
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || 'scan failed'
    props.addLog('error: ' + error.value)
  } finally { loading.value = '' }
}

async function handleKill(proc: ProcessInfo) {
  loading.value = 'killing ' + proc.name + ' (PID:' + proc.pid + ')...'
  props.addLog('kill: ' + proc.name + ' PID:' + proc.pid)
  try {
    var result = await window.services.killProcess(proc.pid)
    props.flushDebugLog()
    props.addLog('kill result: ' + result.message)
    window.ztools.showNotification(result.message)
    if (result.success) { await handleFind() }
    else { error.value = result.message }
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || 'kill failed'
    props.addLog('kill error: ' + error.value)
  } finally { loading.value = '' }
}
</script>

<template>
  <div
    class="unlock"
    :class="{ 'drag-active': isDragOver }"
    @drop="handleDrop"
    @dragover="handleDragOver"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
  >
    <div class="input-area">
      <input
        v-model="filePath"
        class="input"
        placeholder="path or drag file here"
        @keyup.enter="handleFind"
      />
      <button class="btn" @click="handleBrowse">browse</button>
    </div>

    <div v-if="isDragOver" class="drop-hint">drop to scan</div>
    <div v-if="loading" class="loading">{{ loading }}</div>
    <div v-if="error && !loading" class="error">{{ error }}</div>

    <div v-if="processes.length > 0" class="results">
      <div v-for="(proc, idx) in processes" :key="idx" class="card">
        <div class="info">
          <span class="name">{{ proc.name }}</span>
          <span class="pid">PID: {{ proc.pid }}</span>
        </div>
        <div v-if="proc.exePath" class="exe-path">{{ proc.exePath }}</div>
        <button
          :disabled="!!loading"
          class="kill-btn"
          @click="handleKill(proc)"
        >kill</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unlock { position: relative; border: 2px solid transparent; border-radius: 8px; min-height: 100px; transition: border-color 0.2s, background 0.2s; }
.unlock.drag-active { border-color: var(--primary-color, #42b883); background: rgba(66, 184, 131, 0.08); }
.drop-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 600; color: var(--primary-color, #42b883); pointer-events: none; }
.input-area { display: flex; gap: 8px; padding: 8px; border: 1px dashed var(--border-color, #555); border-radius: 6px; }
.input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; color: var(--text-color, #e0e0e0); }
.input::placeholder { color: var(--text-secondary, #888); }
.btn { padding: 4px 12px; border: 1px solid var(--border-color, #555); border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; color: var(--text-color, #e0e0e0); }
.btn:hover { background: var(--hover-color, #333); }
.loading { margin-top: 12px; text-align: center; color: var(--text-secondary, #aaa); }
.error { margin-top: 12px; padding: 10px; border-radius: 6px; background: #fff2f0; color: #cf1322; font-size: 13px; }
.results { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.card { padding: 12px; border: 1px solid var(--border-color, #444); border-radius: 8px; background: var(--card-bg, #2a2a2a); }
.info { display: flex; justify-content: space-between; align-items: center; }
.name { font-weight: 600; font-size: 14px; }
.pid { font-size: 12px; color: var(--text-secondary, #999); }
.exe-path { margin-top: 4px; font-size: 12px; color: var(--text-secondary, #999); word-break: break-all; }
.kill-btn { margin-top: 8px; padding: 6px 14px; border: none; border-radius: 4px; font-size: 13px; cursor: pointer; background: #fff1f0; color: #cf1322; }
.kill-btn:hover:not(:disabled) { background: #ffccc7; }
.kill-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/Unlock/UnlockTab.vue
git commit -m "feat(ui): add simplified UnlockTab with handle.exe-only results"
```

---

### Task 9: Create ShredderTab.vue

**Files:**
- Create: `src/Unlock/ShredderTab.vue`

Two modes (delete/shred), file path input, auto-unlock before shredding.

- [ ] **Step 1: Write ShredderTab.vue**

Write to `src/Unlock/ShredderTab.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { ProcessInfo } from '../env'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
}>()

const filePath = ref('')
const mode = ref<'delete' | 'shred'>('shred')
const loading = ref('')
const error = ref('')
const result = ref('')
const isDragOver = ref(false)
let dragCounter = 0

function handleDragEnter(e: DragEvent) { e.preventDefault(); dragCounter++; isDragOver.value = true }
function handleDragLeave(e: DragEvent) { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { isDragOver.value = false; dragCounter = 0 } }
function handleDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation() }

function handleDrop(e: DragEvent) {
  e.preventDefault(); isDragOver.value = false; dragCounter = 0
  var dt = e.dataTransfer; if (!dt || !dt.files || !dt.files[0]) return
  var file = dt.files[0]; props.addLog('drop: ' + file.name)
  var fullPath = ''
  if (window.services.getPathForFile) { try { fullPath = window.services.getPathForFile(file) } catch (e) {} }
  if (!fullPath && (file as any).path) fullPath = (file as any).path
  if (fullPath) filePath.value = fullPath
}

function handleBrowse() {
  var files = window.ztools.showOpenDialog({ title: 'select file or directory', properties: ['openFile', 'openDirectory'] })
  if (files && files.length > 0) filePath.value = files[0]
}

async function handleStart() {
  if (!filePath.value.trim()) { error.value = 'enter a file path'; return }
  loading.value = (mode.value === 'shred' ? 'shredding' : 'deleting') + '...'
  error.value = ''
  result.value = ''
  props.addLog('shred: ' + filePath.value.trim() + ' mode=' + mode.value)
  try {
    var res = await window.services.shredPath(filePath.value.trim(), mode.value)
    props.flushDebugLog()
    if (res.locked) {
      props.addLog('file is locked, attempting auto-unlock...')
      loading.value = 'file is locked, unlocking...'
      var procs = await window.services.findLockingProcesses(filePath.value.trim())
      props.flushDebugLog()
      if (procs.length > 0) {
        for (var i = 0; i < procs.length; i++) {
          var killRes = await window.services.killProcess(procs[i].pid)
          props.flushDebugLog()
          props.addLog('killed ' + procs[i].name + ' (' + (killRes.success ? 'ok' : 'failed') + ')')
        }
        loading.value = (mode.value === 'shred' ? 'shredding' : 'deleting') + ' (retry)...'
        res = await window.services.shredPath(filePath.value.trim(), mode.value)
        props.flushDebugLog()
      }
    }
    if (res.success) {
      result.value = res.message
      props.addLog('done: ' + res.message)
    } else {
      error.value = res.message
      props.addLog('failed: ' + res.message)
    }
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || 'operation failed'
    props.addLog('error: ' + error.value)
  } finally { loading.value = '' }
}
</script>

<template>
  <div
    class="shredder"
    :class="{ 'drag-active': isDragOver }"
    @drop="handleDrop"
    @dragover="handleDragOver"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
  >
    <div class="input-area">
      <input
        v-model="filePath"
        class="input"
        placeholder="path or drag file here"
        @keyup.enter="handleStart"
      />
      <button class="btn" @click="handleBrowse">browse</button>
    </div>

    <div v-if="isDragOver" class="drop-hint">drop to process</div>

    <div class="mode-select">
      <label :class="{ active: mode === 'delete' }">
        <input type="radio" v-model="mode" value="delete" /> delete
      </label>
      <label :class="{ active: mode === 'shred' }">
        <input type="radio" v-model="mode" value="shred" /> shred
      </label>
    </div>

    <button class="start-btn" :disabled="!!loading" @click="handleStart">
      {{ mode === 'shred' ? 'shred' : 'delete' }}
    </button>

    <div v-if="loading" class="loading">{{ loading }}</div>
    <div v-if="result && !loading" class="success">{{ result }}</div>
    <div v-if="error && !loading" class="error">{{ error }}</div>
  </div>
</template>

<style scoped>
.shredder { position: relative; border: 2px solid transparent; border-radius: 8px; min-height: 100px; transition: border-color 0.2s, background 0.2s; }
.shredder.drag-active { border-color: var(--primary-color, #42b883); background: rgba(66, 184, 131, 0.08); }
.drop-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 600; color: var(--primary-color, #42b883); pointer-events: none; }
.input-area { display: flex; gap: 8px; padding: 8px; border: 1px dashed var(--border-color, #555); border-radius: 6px; }
.input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; color: var(--text-color, #e0e0e0); }
.input::placeholder { color: var(--text-secondary, #888); }
.btn { padding: 4px 12px; border: 1px solid var(--border-color, #555); border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; color: var(--text-color, #e0e0e0); }
.btn:hover { background: var(--hover-color, #333); }
.mode-select { margin-top: 12px; display: flex; gap: 16px; }
.mode-select label { display: flex; align-items: center; gap: 4px; font-size: 14px; cursor: pointer; color: var(--text-secondary, #999); padding: 4px 10px; border-radius: 4px; border: 1px solid transparent; }
.mode-select label.active { color: var(--primary-color, #42b883); border-color: var(--primary-color, #42b883); }
.start-btn { margin-top: 12px; padding: 8px 20px; border: none; border-radius: 4px; font-size: 14px; cursor: pointer; background: var(--primary-color, #42b883); color: #fff; }
.start-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.loading { margin-top: 12px; text-align: center; color: var(--text-secondary, #aaa); }
.success { margin-top: 12px; padding: 10px; border-radius: 6px; background: #f6ffed; color: #389e0d; font-size: 13px; }
.error { margin-top: 12px; padding: 10px; border-radius: 6px; background: #fff2f0; color: #cf1322; font-size: 13px; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/Unlock/ShredderTab.vue
git commit -m "feat(ui): add ShredderTab with delete/shred modes and auto-unlock"
```

---

### Task 10: Create PortTab.vue

**Files:**
- Create: `src/Unlock/PortTab.vue`

Input a port number, show table of results, kill button per row.

- [ ] **Step 1: Write PortTab.vue**

Write to `src/Unlock/PortTab.vue`:
```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { PortInfo } from '../env'

const props = defineProps<{
  addLog: (msg: string) => void
  flushDebugLog: () => void
}>()

const port = ref<number | string>('')
const entries = ref<PortInfo[]>([])
const loading = ref('')
const error = ref('')

async function handleScan() {
  var portNum = parseInt(String(port.value), 10)
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) { error.value = 'enter a valid port (1-65535)'; return }
  loading.value = 'scanning port ' + portNum + '...'
  error.value = ''
  entries.value = []
  props.addLog('port scan: ' + portNum)
  try {
    var result = await window.services.findPortProcess(portNum)
    props.flushDebugLog()
    entries.value = result
    props.addLog('found ' + result.length + ' entries')
    if (result.length === 0) error.value = 'no process listening on port ' + portNum
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || 'scan failed'
    props.addLog('error: ' + error.value)
  } finally { loading.value = '' }
}

async function handleKill(entry: PortInfo) {
  loading.value = 'killing PID:' + entry.pid + '...'
  props.addLog('port kill: ' + entry.processName + ' PID:' + entry.pid)
  try {
    var result = await window.services.killProcess(entry.pid)
    props.flushDebugLog()
    props.addLog('kill result: ' + result.message)
    window.ztools.showNotification(result.message)
    if (result.success) { await handleScan() }
    else { error.value = result.message }
  } catch (err: any) {
    props.flushDebugLog()
    error.value = err.message || 'kill failed'
    props.addLog('kill error: ' + error.value)
  } finally { loading.value = '' }
}
</script>

<template>
  <div class="port">
    <div class="input-area">
      <input
        v-model.number="port"
        class="input"
        type="number"
        min="1"
        max="65535"
        placeholder="port number (e.g. 8080)"
        @keyup.enter="handleScan"
      />
      <button class="btn" @click="handleScan">scan</button>
    </div>

    <div v-if="loading" class="loading">{{ loading }}</div>
    <div v-if="error && !loading" class="error">{{ error }}</div>

    <div v-if="entries.length > 0" class="table-wrap">
      <table class="port-table">
        <thead>
          <tr>
            <th>process</th>
            <th>PID</th>
            <th>proto</th>
            <th>state</th>
            <th>address</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(entry, idx) in entries" :key="idx">
            <td>
              <div class="proc-name">{{ entry.processName }}</div>
              <div v-if="entry.exePath" class="proc-path">{{ entry.exePath }}</div>
            </td>
            <td>{{ entry.pid }}</td>
            <td><span :class="['proto', entry.protocol === 'TCP' ? 'tcp' : 'udp']">{{ entry.protocol }}</span></td>
            <td>{{ entry.state }}</td>
            <td>{{ entry.localAddress }}:{{ entry.localPort }}</td>
            <td>
              <button
                :disabled="!!loading"
                class="kill-btn"
                @click="handleKill(entry)"
              >kill</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.input-area { display: flex; gap: 8px; padding: 8px; border: 1px dashed var(--border-color, #555); border-radius: 6px; }
.input { flex: 1; border: none; outline: none; font-size: 14px; background: transparent; color: var(--text-color, #e0e0e0); }
.input::placeholder { color: var(--text-secondary, #888); }
.input[type=number] { -moz-appearance: textfield; }
.input[type=number]::-webkit-inner-spin-button { display: none; }
.btn { padding: 4px 12px; border: 1px solid var(--border-color, #555); border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; color: var(--text-color, #e0e0e0); }
.btn:hover { background: var(--hover-color, #333); }
.loading { margin-top: 12px; text-align: center; color: var(--text-secondary, #aaa); }
.error { margin-top: 12px; padding: 10px; border-radius: 6px; background: #fff2f0; color: #cf1322; font-size: 13px; }
.table-wrap { margin-top: 12px; overflow-x: auto; }
.port-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.port-table th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-color, #444); color: var(--text-secondary, #999); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.port-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-color, #333); }
.proc-name { font-weight: 600; }
.proc-path { font-size: 11px; color: var(--text-secondary, #999); word-break: break-all; max-width: 200px; }
.proto { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }
.proto.tcp { background: #096dd9; color: #fff; }
.proto.udp { background: #722ed1; color: #fff; }
.kill-btn { padding: 4px 10px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; background: #fff1f0; color: #cf1322; }
.kill-btn:hover:not(:disabled) { background: #ffccc7; }
.kill-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/Unlock/PortTab.vue
git commit -m "feat(ui): add PortTab with port scan table and kill button"
```

---

### Task 11: Update plugin.json

**Files:**
- Modify: `plugin.json`

Update description to reflect multi-module nature.

- [ ] **Step 1: Read current plugin.json**

- [ ] **Step 2: Update description**

Write to `plugin.json`:
```json
{
  "name": "unlock-file",
  "description": "解除文件占用 / 文件粉碎 / 端口检测 · 仅 Windows",
  "platform": ["win32"],
  "entry": "src/Unlock/index.vue",
  "preload": "public/preload/services.js",
  "apiVersion": "2"
}
```

- [ ] **Step 3: Commit**

```bash
git add plugin.json
git commit -m "docs(plugin): update description for three-module tool"
```

---

### Task 12: Build & Verify

- [ ] **Step 1: Run all tests**

```bash
node --test public/preload/*.test.js
```
Expected: all pass (8 handle-parse + 2 utils + 6 shredder + 6 portscan = 22)

- [ ] **Step 2: Typecheck**

```bash
node --no-warnings ..\node_modules\.bin\vue-tsc --noEmit
```
Expected: exit 0, no errors

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: "built in Xms"

- [ ] **Step 4: Final commit**

```bash
git add -A
git status
```
If any uncommitted files remain, add and commit them.

---

## Self-Review Checklist

- **Spec coverage:** Every spec requirement has a corresponding task.
  - ✅ Simplification (unlock.js only handle.exe) → Task 3
  - ✅ Chinese path handling → Task 3 (temp .ps1 with BOM)
  - ✅ File shredder → Task 4 (shredder.js) + Task 9 (UI)
  - ✅ Port scanner → Task 5 (portscan.js) + Task 10 (UI)
  - ✅ Delete old RM modules → Task 2
  - ✅ Type definitions → Task 1
  - ✅ Tab UI → Tasks 7-10
  - ✅ Build verification → Task 12

- **Placeholder scan:** No TODOs, TBDs, or incomplete sections. All code is fully specified.

- **Type consistency:** PortInfo uses pid/processName/protocol/state/localAddress/localPort consistently across Tasks 1, 5, 10. ProcessInfo uses pid/name/exePath in Tasks 1, 3, 8. ShredderResult uses success/message/filesProcessed/locked in Tasks 1, 4, 9.

- **No missing types:** All interfaces referenced in .vue files are defined in env.d.ts. All functions used in services.js are exported from the module files.
