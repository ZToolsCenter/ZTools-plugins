# 解除文件占用插件 — Windows 简化版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把插件简化为「检测占用进程 + 一键 taskkill」,只用 Windows Restart Manager (`RmGetList`) 做检测,删除之前反复失败的精细关闭句柄、UAC 提权、NtQuery* 那一整套复杂链路。

**Architecture:** Vue 3 单页 UI → `window.services` → Node preload (`public/preload/services.js`) → `powershell.exe -File detect-lock.ps1` (内部调 Restart Manager P/Invoke) 查进程,→ `taskkill /pid X /f` 结束进程。纯函数 `parseDetectOutput` 拆出单独测试。

**Tech Stack:** Vue 3 + TypeScript + Vite, Electron preload (CommonJS), Node.js `child_process.spawn`, PowerShell 5.1, Restart Manager (rstrtmgr.dll), `taskkill.exe`. 不再需要 macOS/Linux lsof、kill 路径。

---

## File Structure

```
public/
├── plugin.json                       # MODIFY: platform → ["win32"]
├── logo.png                          # KEEP
└── preload/
    ├── package.json                  # KEEP
    ├── services.js                   # REWRITE: Windows-only, 调用 detect-lock.ps1 + taskkill
    ├── utils.js                      # SIMPLIFY: 只保留 getKillCommand (Windows 分支)
    ├── utils.test.js                 # UPDATE: 测试 getKillCommand Windows 分支
    ├── detect-lock.ps1               # REWRITE: Restart Manager RmGetList + 输出 JSON
    ├── close-handle.ps1              # DELETE (RmShutdown 那条线)
    └── admin-close.ps1               # DELETE (NtQuery* + UAC 那条线)
src/
├── App.vue                           # KEEP
├── main.ts                           # KEEP
├── main.css                          # KEEP
├── env.d.ts                          # MODIFY: 删 closeFileHandle / closeFileHandleAsAdmin, 加 appType/locked
├── Unlock/index.vue                  # REWRITE: 删关闭/管理员按钮, 加 appType 标签和 locked 区分文案
└── (Hello/Read/Write 已删除)
docs/superpowers/
├── specs/2026-07-08-unlock-file-design.md   # 已存在,本计划基于该设计
└── plans/2026-07-08-unlock-file-windows.md  # 本文件
README.md                                    # UPDATE: 反映 Windows-only + 新能力
```

**接口契约** (`src/env.d.ts`):

```typescript
interface ProcessInfo {
  pid: number
  name: string       // "java" / "explorer"
  appName: string    // "OpenJDK Platform" / "Windows Explorer"
  exePath: string    // "C:\Program Files\Java\jdk-17\bin\java.exe"
  appType: string    // "Unknown" | "MainWindow" | "OtherWindow" | "Service" | "Explorer" | "Console" | "RDP"
}

interface LockedHint {
  pid: -1
  name: '__LOCKED__'
  locked: boolean    // true=文件确认被占但拿不到进程; false=API 失败
}

interface Services {
  findLockingProcesses: (filePath: string) => Promise<(ProcessInfo | LockedHint)[]>
  killProcess: (pid: number) => Promise<{ success: boolean; message: string }>
}
```

---

## Task 1: 删除废弃的 PowerShell 脚本

**Files:**
- Delete: `public/preload/close-handle.ps1`
- Delete: `public/preload/admin-close.ps1`

- [ ] **Step 1: 删除两个废弃脚本**

```bash
rm public/preload/close-handle.ps1
rm public/preload/admin-close.ps1
```

- [ ] **Step 2: 验证删除成功**

```bash
ls public/preload/
```

Expected output (only these 4 files remain):
```
detect-lock.ps1
package.json
services.js
utils.js
utils.test.js
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete close-handle and admin-close scripts"
```

---

## Task 2: 添加 `parseDetectOutput` 纯函数(用 TDD)

**Files:**
- Create: `public/preload/detect-parse.js`
- Create: `public/preload/detect-parse.test.js`

- [ ] **Step 1: 写失败的测试 — 空数组**

Create `public/preload/detect-parse.test.js`:

```javascript
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { parseDetectOutput } = require('./detect-parse')

describe('parseDetectOutput', () => {
  it('parses empty array', () => {
    assert.deepEqual(parseDetectOutput('[]'), [])
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
node --test public/preload/detect-parse.test.js
```

Expected: FAIL with `Cannot find module './detect-parse'` or `parseDetectOutput is not defined`.

- [ ] **Step 3: 写最小实现使测试通过**

Create `public/preload/detect-parse.js`:

```javascript
function parseDetectOutput(raw) {
  if (!raw || !raw.trim()) return []
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed : [parsed]
}

module.exports = { parseDetectOutput }
```

- [ ] **Step 4: 重新运行测试,确认通过**

```bash
node --test public/preload/detect-parse.test.js
```

Expected: PASS

- [ ] **Step 5: 加测试 — 进程条目**

Append to `public/preload/detect-parse.test.js` (replace the closing `}` of describe):

```javascript
  it('parses process entries', () => {
    const raw = JSON.stringify([
      { pid: 1234, name: 'notepad', appName: 'Notepad', exePath: 'C:\\Windows\\notepad.exe', appType: 'MainWindow' }
    ])
    assert.deepEqual(parseDetectOutput(raw), [
      { pid: 1234, name: 'notepad', appName: 'Notepad', exePath: 'C:\\Windows\\notepad.exe', appType: 'MainWindow' }
    ])
  })
```

- [ ] **Step 6: 运行测试,确认通过**

```bash
node --test public/preload/detect-parse.test.js
```

Expected: PASS (2 tests)

- [ ] **Step 7: 加测试 — `__LOCKED__` 提示条目**

Append another test (within the same describe block):

```javascript
  it('parses __LOCKED__ hint with locked=true', () => {
    const raw = JSON.stringify([{ pid: -1, name: '__LOCKED__', locked: true }])
    assert.deepEqual(parseDetectOutput(raw), [
      { pid: -1, name: '__LOCKED__', locked: true }
    ])
  })

  it('parses __LOCKED__ hint with locked=false', () => {
    const raw = JSON.stringify([{ pid: -1, name: '__LOCKED__', locked: false }])
    assert.deepEqual(parseDetectOutput(raw), [
      { pid: -1, name: '__LOCKED__', locked: false }
    ])
  })
```

- [ ] **Step 8: 运行测试,确认全部通过**

```bash
node --test public/preload/detect-parse.test.js
```

Expected: PASS (4 tests)

- [ ] **Step 9: 加测试 — 无效 JSON / 容错**

Append:

```javascript
  it('returns empty array for empty/whitespace input', () => {
    assert.deepEqual(parseDetectOutput(''), [])
    assert.deepEqual(parseDetectOutput('   '), [])
    assert.deepEqual(parseDetectOutput(null), [])
    assert.deepEqual(parseDetectOutput(undefined), [])
  })

  it('throws on invalid JSON', () => {
    assert.throws(() => parseDetectOutput('not json'), /JSON/)
  })
```

- [ ] **Step 10: 跑全部测试,确认通过**

```bash
node --test public/preload/detect-parse.test.js
```

Expected: PASS (6 tests)

- [ ] **Step 11: Commit**

```bash
git add public/preload/detect-parse.js public/preload/detect-parse.test.js
git commit -m "feat(preload): add parseDetectOutput pure function with tests"
```

---

## Task 3: 简化 `utils.js` 为 Windows-only

**Files:**
- Modify: `public/preload/utils.js` (删除 `parseLsofOutput`, 简化 `getKillCommand` 不再分支)
- Modify: `public/preload/utils.test.js` (重写测试)

- [ ] **Step 1: 重写测试文件**

Replace `public/preload/utils.test.js` content with:

```javascript
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { getKillCommand } = require('./utils')

describe('getKillCommand', () => {
  it('returns taskkill with /F for any pid', () => {
    const { cmd, args } = getKillCommand(1234)
    assert.equal(cmd, 'taskkill')
    assert.deepEqual(args, ['/pid', '1234', '/f'])
  })

  it('stringifies pid', () => {
    const { args } = getKillCommand(98765)
    assert.equal(args[1], '98765')
    assert.equal(typeof args[1], 'string')
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
node --test public/preload/utils.test.js
```

Expected: FAIL — `getKillCommand` 当前返回 `/PID 1234 /F` (大写),测试期望小写 `/pid 1234 /f`;`parseLsofOutput` 不再被 import,导致 import 行报错。

- [ ] **Step 3: 重写 `utils.js`**

Replace `public/preload/utils.js` content with:

```javascript
function getKillCommand(pid) {
  return { cmd: 'taskkill', args: ['/pid', String(pid), '/f'] }
}

module.exports = { getKillCommand }
```

- [ ] **Step 4: 运行测试,确认通过**

```bash
node --test public/preload/utils.test.js
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add public/preload/utils.js public/preload/utils.test.js
git commit -m "refactor(preload): simplify utils to Windows-only taskkill"
```

---

## Task 4: 重写 `services.js` — Windows-only

**Files:**
- Modify: `public/preload/services.js` (整体重写)

- [ ] **Step 1: 写完整新版本**

Replace `public/preload/services.js` content with:

```javascript
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { parseDetectOutput } = require('./detect-parse')
const { getKillCommand } = require('./utils')

const TIMEOUT_MS = 60000

function execWithTimeout(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout: TIMEOUT_MS })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (data) => { stdout += data })
    proc.stderr.on('data', (data) => { stderr += data })
    proc.on('error', (err) => reject(new Error('spawn error: ' + err.message)))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'exit code ' + code))
        return
      }
      resolve(stdout)
    })
  })
}

async function findLockingProcesses(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error('路径不存在: ' + resolved)
  }

  const scriptPath = path.join(__dirname, 'detect-lock.ps1')
  const raw = await execWithTimeout('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    resolved
  ])

  const trimmed = raw.trim().replace(/^\uFEFF/, '')
  if (!trimmed) return []

  return parseDetectOutput(trimmed)
}

async function killProcess(pid) {
  const { cmd, args } = getKillCommand(pid)
  try {
    await execWithTimeout(cmd, args)
    return { success: true, message: '已结束进程 PID: ' + pid }
  } catch (err) {
    return { success: false, message: '结束进程失败: ' + (err.message || '未知错误') }
  }
}

window.services = {
  findLockingProcesses,
  killProcess
}
```

- [ ] **Step 2: 确认 Node 解析没问题(语法检查)**

```bash
node --check public/preload/services.js
```

Expected: no output (exit 0).

- [ ] **Step 3: 运行所有 preload 单元测试**

```bash
node --test public/preload/
```

Expected: 8 tests pass (4 in detect-parse, 2 in utils, …).

- [ ] **Step 4: Commit**

```bash
git add public/preload/services.js
git commit -m "refactor(preload): rewrite services.js to Windows-only, use parseDetectOutput"
```

---

## Task 5: 重写 `detect-lock.ps1` — Restart Manager

**Files:**
- Modify: `public/preload/detect-lock.ps1` (整体重写)

- [ ] **Step 1: 写新脚本**

Replace `public/preload/detect-lock.ps1` content with:

```powershell
param($filePath)

# 文件不存在 → 空数组
if (-not (Test-Path -LiteralPath $filePath)) {
    Write-Output '[]'
    exit 0
}

# PS5.1 默认输出编码是 GBK,中文路径会乱码。强制 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 加载 Restart Manager P/Invoke
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[StructLayout(LayoutKind.Sequential)]
public struct RM_UNIQUE_PROCESS {
    public uint dwProcessId;
    public FILETIME ProcessStartTime;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.LPTStr)] public string strAppName;
    [MarshalAs(UnmanagedType.LPTStr)] public string strServiceShortName;
    [MarshalAs(UnmanagedType.LPTStr)] public string strApplicationName;
    public uint ApplicationType;
    public uint AppStatus;
    public uint fBackground;
    public uint fVetoing;
    public uint fPaused;
    public uint fPausedByUser;
}

public static class RestartManager {
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmRegisterResources(uint hSession, uint nFiles, string[] rgsFilenames, uint nApplications, IntPtr rgApplications, uint nServices, string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    public static extern int RmGetList(uint hSession, out uint pnProcInfoNeeded, uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, out uint lpdwRebootReasons);

    [DllImport("rstrtmgr.dll")]
    public static extern int RmEndSession(uint hSession);
}
'@

function Convert-AppType($t) {
    switch ($t) {
        1 { 'MainWindow' }
        2 { 'OtherWindow' }
        3 { 'Service' }
        4 { 'Explorer' }
        5 { 'Console' }
        6 { 'Critical' }
        default { 'Unknown' }
    }
}

$hSession = 0
$startRc = [RestartManager]::RmStartSession([ref]$hSession, 0, [Guid]::NewGuid().ToString())
if ($startRc -ne 0) {
    @(@{ pid = -1; name = '__LOCKED__'; locked = $false }) | ConvertTo-Json -Compress
    exit 0
}

try {
    $regRc = [RestartManager]::RmRegisterResources($hSession, 1, @($filePath), 0, [IntPtr]::Zero, 0, $null)
    if ($regRc -ne 0) {
        @(@{ pid = -1; name = '__LOCKED__'; locked = $false }) | ConvertTo-Json -Compress
        return
    }

    $needed = 0
    $reboot = 0
    $null = [RestartManager]::RmGetList($hSession, [ref]$needed, 0, $null, [ref]$reboot)

    if ($needed -eq 0) {
        Write-Output '[]'
        return
    }

    $infos = New-Object 'RM_PROCESS_INFO[]' $needed
    $listRc = [RestartManager]::RmGetList($hSession, [ref]$needed, $needed, $infos, [ref]$reboot)
    if ($listRc -ne 0) {
        @(@{ pid = -1; name = '__LOCKED__'; locked = $false }) | ConvertTo-Json -Compress
        return
    }

    $results = @()
    foreach ($info in $infos) {
        $p = $info.Process.dwProcessId
        $proc = $null
        try { $proc = Get-Process -Id $p -ErrorAction Stop } catch {}

        $exePath = ''
        if ($proc) {
            try { $exePath = $proc.MainModule.FileName } catch {}
        }
        if (-not $exePath) {
            try {
                $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction Stop
                if ($cim) { $exePath = $cim.ExecutablePath }
            } catch {}
        }

        $appName = $info.strApplicationName
        if (-not $appName) { $appName = $info.strAppName }
        if (-not $appName -and $proc) { $appName = $proc.ProcessName }

        $results += @{
            pid     = $p
            name    = if ($proc) { $proc.ProcessName } else { $info.strAppName }
            appName = $appName
            exePath = if ($exePath) { $exePath } else { '' }
            appType = Convert-AppType $info.ApplicationType
        }
    }

    if ($results.Count -gt 0) {
        $results | ConvertTo-Json -Compress
    } else {
        @(@{ pid = -1; name = '__LOCKED__'; locked = $true }) | ConvertTo-Json -Compress
    }
} finally {
    $null = [RestartManager]::RmEndSession($hSession)
}
```

- [ ] **Step 2: 烟测 — 不存在的路径**

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File public/preload/detect-lock.ps1 "C:\does-not-exist-xyz"
```

Expected output: `[]`

- [ ] **Step 3: 烟测 — 未被占用的文件**

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File public/preload/detect-lock.ps1 "public/plugin.json"
```

Expected output: `[]`

- [ ] **Step 4: 烟测 — 目录未占用**

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File public/preload/detect-lock.ps1 "public"
```

Expected output: `[]`

- [ ] **Step 5: 烟测 — 当前 cmd 进程(应有进程)**

```bash
powershell -NoProfile -Command "notepad.exe public\plugin.json"
```

(打开记事本,占用该文件。Ctrl+Z 暂停,新建 shell)

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File public/preload/detect-lock.ps1 "public/plugin.json"
```

Expected: 类似 `[{"pid":XXXX,"name":"notepad","appName":"Notepad","exePath":"C:\\Windows\\notepad.exe","appType":"MainWindow"}]`

- [ ] **Step 6: 关闭测试用的 notepad**

```bash
powershell -NoProfile -Command "Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force"
```

- [ ] **Step 7: Commit**

```bash
git add public/preload/detect-lock.ps1
git commit -m "feat(preload): rewrite detect-lock.ps1 to use Restart Manager RmGetList"
```

---

## Task 6: 更新 `src/env.d.ts` 类型定义

**Files:**
- Modify: `src/env.d.ts`

- [ ] **Step 1: 替换文件内容**

Replace `src/env.d.ts` content with:

```typescript
/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export type AppType =
  | 'Unknown'
  | 'MainWindow'
  | 'OtherWindow'
  | 'Service'
  | 'Explorer'
  | 'Console'
  | 'Critical'

export interface ProcessInfo {
  pid: number
  name: string
  appName: string
  exePath: string
  appType: AppType
}

export interface LockedHint {
  pid: -1
  name: '__LOCKED__'
  locked: boolean
}

export interface OperationResult {
  success: boolean
  message: string
}

export interface Services {
  findLockingProcesses: (filePath: string) => Promise<(ProcessInfo | LockedHint)[]>
  killProcess: (pid: number) => Promise<OperationResult>
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApi & { getPathForFile(file: File): string }
  }
}

export {}
```

- [ ] **Step 2: 跑类型检查**

```bash
npx vue-tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/env.d.ts
git commit -m "feat(types): update Services interface for Windows-only unlock plugin"
```

---

## Task 7: 重写 `src/Unlock/index.vue` UI

**Files:**
- Modify: `src/Unlock/index.vue` (整体重写)

- [ ] **Step 1: 写新的 script setup 段**

Replace the entire `<script setup lang="ts">` block (lines 1-176) in `src/Unlock/index.vue` with:

```typescript
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { ProcessInfo, LockedHint } from '../env'

const props = defineProps({
  enterAction: {
    type: Object as () => { type: string; payload?: any } | null,
    default: null
  }
})

const filePath = ref('')
const processes = ref<(ProcessInfo | LockedHint)[]>([])
const loading = ref('')
const error = ref('')
const showDebug = ref(false)
const logs = ref<string[]>([])

function addLog(msg: string) {
  const time = new Date().toLocaleTimeString()
  logs.value.push(`[${time}] ${msg}`)
  if (logs.value.length > 50) logs.value.shift()
}

function toggleDebug() {
  showDebug.value = !showDebug.value
}

onMounted(() => {
  addLog('插件已加载')
  if (props.enterAction) handleAction(props.enterAction)
})

watch(
  () => props.enterAction,
  (action) => { if (action) handleAction(action) }
)

function handleAction(action: { type: string; payload?: any }) {
  if (action.type === 'files' && action.payload && action.payload.length > 0) {
    const first = action.payload[0]
    const p = first.path || (first.name ? first.name : '')
    if (p) {
      filePath.value = p
      handleFind()
    }
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (!file) return
  let fullPath = ''
  if (window.ztools.getPathForFile) {
    try { fullPath = window.ztools.getPathForFile(file) } catch {}
  }
  if (!fullPath && (file as any).path) fullPath = (file as any).path
  if (fullPath) {
    filePath.value = fullPath
    handleFind()
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
}

async function handleBrowse() {
  const files = window.ztools.showOpenDialog({
    title: '选择要解除占用的文件或目录',
    properties: ['openFile', 'openDirectory']
  })
  if (files && files.length > 0) {
    filePath.value = files[0]
    handleFind()
  }
}

async function handleFind() {
  if (!filePath.value.trim()) {
    error.value = '请输入文件路径'
    return
  }
  loading.value = '正在查找占用进程...'
  error.value = ''
  processes.value = []
  addLog('开始查找: ' + filePath.value.trim())
  try {
    const result = await window.services.findLockingProcesses(filePath.value.trim())
    processes.value = result
    addLog('查找完成,共 ' + result.length + ' 项')
    if (result.length === 0) {
      error.value = '该文件没有被任何进程占用'
      addLog('未检测到占用')
    }
  } catch (err: any) {
    error.value = err.message || '查找失败'
    addLog('查找错误: ' + error.value)
  } finally {
    loading.value = ''
  }
}

async function handleKill(proc: ProcessInfo) {
  if (proc.pid === -1) return
  loading.value = `正在结束 ${proc.name} (PID: ${proc.pid})...`
  error.value = ''
  addLog('尝试结束进程: ' + proc.name + ' (PID: ' + proc.pid + ')')
  try {
    const result = await window.services.killProcess(proc.pid)
    addLog('结束结果: ' + result.message)
    window.ztools.showNotification(result.message)
    if (result.success) {
      await handleFind()
    } else {
      error.value = result.message
    }
  } catch (err: any) {
    error.value = err.message || '结束进程失败'
    addLog('结束错误: ' + error.value)
  } finally {
    loading.value = ''
  }
}

function isProcessInfo(p: ProcessInfo | LockedHint): p is ProcessInfo {
  return p.pid !== -1
}
</script>
```

- [ ] **Step 2: 替换 template 段**

Replace the entire `<template>` block (lines 178-253) with:

```vue
<template>
  <div class="unlock">
    <div class="unlock-header">
      <h1>解除文件占用</h1>
      <p class="unlock-subtitle">仅支持 Windows · 检测占用进程并一键结束</p>
    </div>

    <div
      class="unlock-input-area"
      @drop="handleDrop"
      @dragover="handleDragOver"
    >
      <input
        v-model="filePath"
        class="unlock-input"
        placeholder="输入文件或目录路径,或拖拽到此处"
        @keyup.enter="handleFind"
      />
      <button class="unlock-browse-btn" @click="handleBrowse">浏览</button>
    </div>

    <div v-if="loading" class="unlock-loading">{{ loading }}</div>

    <div v-if="error && !loading" class="unlock-error">{{ error }}</div>

    <div v-if="processes.length > 0" class="unlock-results">
      <template v-for="(proc, idx) in processes" :key="idx">
        <div v-if="!isProcessInfo(proc)" class="process-card hint-card">
          <div class="hint-icon">&#128274;</div>
          <div class="hint-text">
            <template v-if="proc.locked">
              <strong>文件被占用,但无法识别具体进程。</strong><br />
              持有者可能是受保护的系统进程。请尝试:
              <ul>
                <li>检查常见的占用方(资源管理器、IDE、截图工具等)并结束</li>
                <li>安装 <a href="https://learn.microsoft.com/sysinternals/downloads/handle" target="_blank">Handle (Sysinternals)</a> 增强检测</li>
              </ul>
            </template>
            <template v-else>
              <strong>无法查询占用信息。</strong><br />
              Restart Manager API 调用失败,可能是权限或路径异常:
              <ul>
                <li>确认文件路径存在且可访问</li>
                <li>以管理员身份运行 ZTools 后重试</li>
                <li>若反复失败,安装 <a href="https://learn.microsoft.com/sysinternals/downloads/handle" target="_blank">Handle</a> 作为兜底</li>
              </ul>
            </template>
          </div>
        </div>

        <div v-else class="process-card">
          <div class="process-info">
            <span class="process-app-type" :data-type="proc.appType">{{ proc.appType }}</span>
            <span class="process-name">{{ proc.name }}</span>
            <span class="process-pid">PID: {{ proc.pid }}</span>
          </div>
          <div v-if="proc.appName" class="process-app-name">{{ proc.appName }}</div>
          <div v-if="proc.exePath" class="process-path">{{ proc.exePath }}</div>
          <div class="process-actions">
            <button
              :disabled="!!loading"
              class="action-btn kill-btn"
              title="强制结束进程"
              @click="handleKill(proc)"
            >结束进程</button>
          </div>
        </div>
      </template>
    </div>

    <div v-if="logs.length > 0" class="debug-panel">
      <div class="debug-header" @click="toggleDebug">
        <span>调试日志 ({{ logs.length }})</span>
        <span class="debug-toggle">{{ showDebug ? '▼' : '▶' }}</span>
      </div>
      <div v-if="showDebug" class="debug-logs">
        <div v-for="(log, idx) in logs" :key="idx" class="debug-line">{{ log }}</div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: 在 style 段里追加 appType 标签样式**

Append to the existing `<style scoped>` block (just before the closing `</style>` tag):

```css
.unlock-subtitle {
  font-size: 12px;
  color: var(--text-secondary, #888);
  margin: 4px 0 0 0;
  font-weight: normal;
}

.process-app-type {
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  background: #555;
  color: #fff;
  margin-right: 8px;
  vertical-align: middle;
}
.process-app-type[data-type="Service"] { background: #cf1322; }
.process-app-type[data-type="Console"] { background: #096dd9; }
.process-app-type[data-type="MainWindow"] { background: #389e0d; }
.process-app-type[data-type="Explorer"] { background: #d48806; }
.process-app-type[data-type="Critical"] { background: #722ed1; }

.process-app-name {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary, #aaa);
  word-break: break-all;
}

.hint-text ul {
  margin: 6px 0 0 0;
  padding-left: 20px;
}
.hint-text li {
  margin: 2px 0;
}
```

- [ ] **Step 4: 跑类型检查**

```bash
npx vue-tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/Unlock/index.vue
git commit -m "feat(ui): simplify to kill-only, add appType label, split __LOCKED__ by locked flag"
```

---

## Task 8: 更新 `plugin.json` 为 Windows-only

**Files:**
- Modify: `public/plugin.json`

- [ ] **Step 1: 修改 platform 字段**

In `public/plugin.json`, change:

```json
  "platform": [
    "darwin",
    "win32",
    "linux"
  ]
```

to:

```json
  "platform": [
    "win32"
  ]
```

- [ ] **Step 2: 验证文件可解析**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('public/plugin.json','utf8')).platform)"
```

Expected output: `[ 'win32' ]`

- [ ] **Step 3: Commit**

```bash
git add public/plugin.json
git commit -m "chore: restrict plugin to Windows platform"
```

---

## Task 9: 更新 README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 重写 README 反映新设计**

Replace entire `README.md` content with:

```markdown
# 解除文件占用 (unlock-file)

ZTools 插件 — 检测占用文件/目录的进程并一键结束。仅支持 Windows。

## 功能

- 输入路径或拖拽文件/目录,使用 **Windows Restart Manager** (`RmGetList`) 查找所有占用该资源的进程
- 展示每个进程的:类型标签 (Service / MainWindow / Explorer / Console / RDP 等)、进程名、PID、应用名、可执行文件完整路径
- 一键 `taskkill /f` 结束进程

## 平台

- Windows 10 / 11 (依赖 Restart Manager API,Win Vista+ 均有)

## 不支持 / 限制

- 不会做「精细关闭单个句柄而不杀进程」这种操作 — 那条路在 Windows 上极其依赖内核权限和进程状态,反复试过不靠谱。本插件提供的是「结束整个进程」,用户可以自己选择要不要结束。
- macOS / Linux 不在支持范围

## 使用方式

1. 在 ZTools 搜索框输入「解除文件占用」,或拖一个文件/目录到搜索框
2. 看到进程列表后,点对应卡片的「结束进程」即可

## 开发

```bash
npm install
npm run dev      # 启动 vite dev server
npm run build    # 生产构建
npx vue-tsc --noEmit  # 类型检查
```

## 技术栈

- Vue 3 + TypeScript + Vite (前端)
- Electron preload (CommonJS) 调用 PowerShell 5.1
- PowerShell 调用 `rstrtmgr.dll` (Restart Manager)
- Node `child_process.spawn` 调 `taskkill`

## 项目结构

```
public/
  plugin.json                   # 插件配置 (Windows-only)
  preload/
    services.js                 # Node 桥接层
    detect-lock.ps1             # Restart Manager 检测
    utils.js                    # taskkill 命令构造
    utils.test.js
    detect-parse.js             # 纯函数:解析 PS1 输出
    detect-parse.test.js
src/
  Unlock/index.vue              # 唯一 UI 组件
  env.d.ts                      # 类型定义
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for Windows-only unlock plugin"
```

---

## Task 10: 整体构建验证

- [ ] **Step 1: 跑类型检查**

```bash
npx vue-tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: 跑单元测试**

```bash
node --test public/preload/
```

Expected: 8 tests pass (4 in detect-parse.test.js, 2 in utils.test.js, 2 in detect-parse more, 0 in services.js).

Verify actual count matches — should be 6 in detect-parse + 2 in utils = 8.

- [ ] **Step 3: 生产构建**

```bash
npm run build
```

Expected: `✓ built in <ms>` no errors.

- [ ] **Step 4: 列出最终 preload 目录,确认旧文件已删除**

```bash
ls public/preload/
```

Expected:
```
detect-lock.ps1
detect-parse.js
detect-parse.test.js
package.json
services.js
utils.js
utils.test.js
```

(无 close-handle.ps1, 无 admin-close.ps1)

- [ ] **Step 5: 手动集成测试**

依次执行以下场景,每步都用 ZTools 重新加载插件 (`npm run build` 之后重启 ZTools 或重新触发):

| 场景 | 预期 |
|---|---|
| 拖一个不存在的路径 | `[]`,提示「路径不存在」 |
| 拖一个未被占用的文件 (例如 `public/plugin.json`) | `[]`,提示「该文件没有被任何进程占用」 |
| 拖一个未被占用的目录 (例如 `public`) | `[]`,提示同上 |
| 用记事本打开 `public\plugin.json`,再拖该文件 | 看到 notepad 卡片,appType=`MainWindow`,exePath 指向 notepad.exe |
| 拖一个目录到「我的电脑」已打开的目录 | 看到 explorer 卡片,appType=`Explorer` |
| 点击 notepad 卡片的「结束进程」 | 通知「已结束进程 PID: XXXX」,记事本关闭,重新查找结果变 `[]` |
| 拖一个**已删除但还有进程持有句柄**的文件 | 看到 `__LOCKED__` `locked: true` 提示卡 |
| 拖一个无效格式的路径 (例如 `:::invalid::: `) | 看到 `__LOCKED__` `locked: false` 提示卡 |

- [ ] **Step 6: 提交最终清理(若有遗留)**

```bash
git status
```

如果还有未提交的改动,审视后单独 commit;否则无需操作。

---

## Self-Review Checklist (执行时核对)

- [ ] 所有 preload 单元测试通过 (8 个)
- [ ] `vue-tsc --noEmit` 无错
- [ ] `npm run build` 成功
- [ ] 旧 PS1 文件 (`close-handle.ps1`, `admin-close.ps1`) 已删除
- [ ] UI 不再有「关闭占用」「以管理员权限重试」按钮
- [ ] 进程卡片显示 appType 标签
- [ ] `__LOCKED__` 卡片根据 `locked` 区分文案
- [ ] `plugin.json` `platform` 仅 `["win32"]`
- [ ] README 反映新设计
- [ ] 至少跑过 5 个手动集成测试场景
