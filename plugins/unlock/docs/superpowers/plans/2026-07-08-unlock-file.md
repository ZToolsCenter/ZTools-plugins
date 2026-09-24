# 解除文件占用插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the example ZTools plugin (Hello/Read/Write) with a file unlock plugin that identifies processes locking a file and allows closing handles or killing the process.

**Architecture:** Vue 3 single-page UI → `window.services` → Electron preload (`public/preload/services.js`) → `child_process.exec` → system commands (PowerShell RestartManager API on Windows, `lsof` on macOS/Linux). Pure helper functions split into `public/preload/utils.js` for testability.

**Tech Stack:** Vue 3 + TypeScript + Vite, Electron preload (CommonJS), Node.js `child_process`, PowerShell, `lsof`

---

## File Structure

```
public/
├── plugin.json              # MODIFY: replace features config
├── logo.png                 # KEEP
└── preload/
    ├── package.json         # KEEP
    ├── services.js          # REWRITE: unlock APIs using utils
    └── utils.js             # CREATE: pure helper functions (testable)
src/
├── App.vue                  # MODIFY: render Unlock component
├── main.ts                  # KEEP
├── main.css                 # KEEP
├── env.d.ts                 # MODIFY: update Services interface
├── Hello/index.vue          # DELETE
├── Read/index.vue           # DELETE
├── Write/index.vue          # DELETE
└── Unlock/index.vue         # CREATE: main UI component
```

---

## Task 1: Clean up example files and update App.vue

**Files:**
- Delete: `src/Hello/index.vue`, `src/Read/index.vue`, `src/Write/index.vue`
- Modify: `src/App.vue`

- [ ] **Step 1: Delete example component files**

```bash
Remove-Item -Path "src/Hello/index.vue","src/Read/index.vue","src/Write/index.vue" -Force
Remove-Item -Path "src/Hello","src/Read","src/Write" -Force
```

- [ ] **Step 2: Replace App.vue with Unlock component**

Write `src/App.vue`:

```vue
<script setup lang="ts">
import Unlock from './Unlock/index.vue'
</script>

<template>
  <Unlock />
</template>
```

- [ ] **Step 3: Verify TypeScript passes**

Run: `npx tsc --noEmit`
Expected: No errors (Unlock component doesn't exist yet — this will error, that's OK. We check after Task 5.)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove example components, update App.vue"
```

---

## Task 2: Create pure helper functions (utils.js)

**Files:**
- Create: `public/preload/utils.js`

- [ ] **Step 1: Write utils.js with pure functions**

Write `public/preload/utils.js`:

```javascript
const os = require('node:os')

/**
 * Parse lsof output lines into process info objects.
 * @param {string} output - Raw lsof output (lines: "PID NAME")
 * @returns {Array<{pid: number, name: string}>}
 */
function parseLsofOutput(output) {
  const lines = output.trim().split('\n')
  const processes = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const spaceIdx = trimmed.indexOf(' ')
    if (spaceIdx === -1) continue
    const pid = parseInt(trimmed.substring(0, spaceIdx), 10)
    const name = trimmed.substring(spaceIdx + 1).trim()
    if (isNaN(pid) || !name) continue
    processes.push({ pid, name })
  }
  return processes
}

/**
 * Build the PowerShell script for Windows RestartManager API.
 * Outputs JSON array of {pid, name} to stdout.
 * @param {string} filePath
 * @returns {string} PowerShell script content
 */
function getFindProcessesScript(filePath) {
  const escapedPath = filePath.replace(/'/g, "''")
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
public enum RM_APP_TYPE { RmUnknownApp = 0, RmMainWindow = 1, RmOtherWindow = 2, RmService = 3, RmExplorer = 4, RmConsole = 5, RmCritical = 1000 }
public struct RM_PROCESS_INFO { public RM_UNIQUE_PROCESS Process; public string strAppName; public string strServiceShortName; public RM_APP_TYPE ApplicationType; public uint AppStatus; public uint TSSessionId; [MarshalAs(UnmanagedType.Bool)] public bool bRestartable; }
public class RM {
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern int RmStartSession(out uint h, int f, string k);
    [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint h);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern int RmRegisterResources(uint h, uint n, string[] r, uint na, IntPtr a, uint ns, string[] s);
    [DllImport("rstrtmgr.dll")] public static extern int RmGetList(uint h, out uint need, ref uint count, [In, Out] RM_PROCESS_INFO[] apps, ref uint reason);
}
"@
$handle = [uint32]0
$key = [Guid]::NewGuid().ToString()
$result = [RM]::RmStartSession([ref]$handle, 0, $key)
if ($result -ne 0) { Write-Error "RmStartSession failed: $result"; exit 1 }
$resources = @('${escapedPath}')
$result = [RM]::RmRegisterResources($handle, 1, $resources, 0, [IntPtr]::Zero, 0, @())
if ($result -ne 0) { Write-Error "RmRegisterResources failed: $result"; [RM]::RmEndSession($handle); exit 1 }
$count = [uint32]0
$need = [uint32]0
$reason = [uint32]0
$apps = @()
$result = [RM]::RmGetList($handle, [ref]$need, [ref]$count, $apps, [ref]$reason)
if ($result -eq 234) {
    $apps = New-Object 'RM_PROCESS_INFO[]' $need
    $count = $need
    $result = [RM]::RmGetList($handle, [ref]$need, [ref]$count, $apps, [ref]$reason)
}
[RM]::RmEndSession($handle)
if ($result -ne 0) { Write-Error "RmGetList failed: $result"; exit 1 }
$resultList = @()
for ($i = 0; $i -lt $count; $i++) {
    $resultList += @{ pid = $apps[$i].Process.dwProcessId; name = $apps[$i].strAppName }
}
$resultList | ConvertTo-Json -Compress
`.trim()
}

/**
 * Build the PowerShell script for closing handles on Windows.
 * Uses RmShutdown to close processes locking the file.
 * @param {string} filePath
 * @returns {string} PowerShell script content
 */
function getCloseHandlesScript(filePath) {
  const escapedPath = filePath.replace(/'/g, "''")
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RM2 {
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern int RmStartSession(out uint h, int f, string k);
    [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint h);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] public static extern int RmRegisterResources(uint h, uint n, string[] r, uint na, IntPtr a, uint ns, string[] s);
    [DllImport("rstrtmgr.dll")] public static extern int RmShutdown(uint h, uint action, IntPtr status);
}
"@
$handle = [uint32]0
$key = [Guid]::NewGuid().ToString()
$result = [RM2]::RmStartSession([ref]$handle, 0, $key)
if ($result -ne 0) { Write-Error "RmStartSession failed: $result"; exit 1 }
$resources = @('${escapedPath}')
$result = [RM2]::RmRegisterResources($handle, 1, $resources, 0, [IntPtr]::Zero, 0, @())
if ($result -ne 0) { Write-Error "RmRegisterResources failed: $result"; [RM2]::RmEndSession($handle); exit 1 }
$result = [RM2]::RmShutdown($handle, 1, [IntPtr]::Zero)
[RM2]::RmEndSession($handle)
if ($result -ne 0) { Write-Error "RmShutdown failed: $result"; exit 1 }
"SUCCESS"
`.trim()
}

/**
 * Get the process kill command for current platform.
 * @param {number} pid
 * @returns {{cmd: string, args: string[]}}
 */
function getKillCommand(pid) {
  if (os.platform() === 'win32') {
    return { cmd: 'taskkill', args: ['/PID', String(pid), '/F'] }
  }
  return { cmd: 'kill', args: ['-9', String(pid)] }
}

module.exports = {
  parseLsofOutput,
  getFindProcessesScript,
  getCloseHandlesScript,
  getKillCommand
}
```

- [ ] **Step 2: Commit**

```bash
git add public/preload/utils.js
git commit -m "feat(preload): add pure helper utilities for process management"
```

---

## Task 3: Test pure helper functions

**Files:**
- Create: `public/preload/utils.test.js`

- [ ] **Step 1: Write tests for parseLsofOutput**

Write `public/preload/utils.test.js`:

```javascript
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { parseLsofOutput, getKillCommand } = require('./utils')

describe('parseLsofOutput', () => {
  it('parses valid lsof output', () => {
    const output = '1234 notepad\n5678 WINWORD'
    const result = parseLsofOutput(output)
    assert.deepEqual(result, [
      { pid: 1234, name: 'notepad' },
      { pid: 5678, name: 'WINWORD' }
    ])
  })

  it('handles empty output', () => {
    assert.deepEqual(parseLsofOutput(''), [])
  })

  it('skips invalid lines', () => {
    const output = '1234 valid\ninvalid-line\n5678 alsovalid'
    const result = parseLsofOutput(output)
    assert.deepEqual(result, [
      { pid: 1234, name: 'valid' },
      { pid: 5678, name: 'alsovalid' }
    ])
  })
})

describe('getKillCommand', () => {
  it('returns taskkill on Windows', () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    if (origPlatform && origPlatform.value === 'win32') {
      const { cmd, args } = getKillCommand(1234)
      assert.equal(cmd, 'taskkill')
      assert.deepEqual(args, ['/PID', '1234', '/F'])
    }
  })
})
```

- [ ] **Step 2: Run tests**

Run: `node --test public/preload/utils.test.js`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add public/preload/utils.test.js
git commit -m "test(preload): add unit tests for pure helper functions"
```

---

## Task 4: Implement services.js — findLockingProcesses

**Files:**
- Modify: `public/preload/services.js`

- [ ] **Step 2: Rewrite services.js with unlock APIs**

Write `public/preload/services.js`:

```javascript
const { exec } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const {
  parseLsofOutput,
  getFindProcessesScript,
  getCloseHandlesScript,
  getKillCommand
} = require('./utils')

const TIMEOUT_MS = 10000

/**
 * Execute a command with timeout. Returns stdout.
 */
function execWithTimeout(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = exec(
      `"${cmd}" ${args.map((a) => `"${a}"`).join(' ')}`,
      { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message))
          return
        }
        resolve(stdout)
      }
    )
    proc.on('error', reject)
  })
}

/**
 * Find processes locking the given file.
 */
async function findLockingProcesses(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error('文件不存在: ' + resolved)
  }

  if (os.platform() === 'win32') {
    const script = getFindProcessesScript(resolved)
    const output = await execWithTimeout('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script
    ])
    const trimmed = output.trim()
    if (!trimmed) return []
    const parsed = JSON.parse(trimmed)
    const result = []
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      result.push({
        pid: item.pid,
        name: item.name || 'Unknown',
        path: ''
      })
    }
    return result
  }

  // macOS / Linux
  const output = await execWithTimeout('bash', [
    '-c',
    `lsof "${resolved.replace(/"/g, '\\"')}" 2>/dev/null | awk 'NR>1 {print $2, $1}'`
  ])
  const processes = parseLsofOutput(output)

  // Enrich with process path via ps
  for (const proc of processes) {
    try {
      const pathOutput = await execWithTimeout('bash', [
        '-c',
        `ps -p ${proc.pid} -o comm= 2>/dev/null`
      ])
      proc.path = pathOutput.trim()
    } catch {
      proc.path = ''
    }
  }
  return processes
}

/**
 * Close handles by shutting down processes locking the file (Windows only).
 */
async function closeFileHandle(filePath, pid) {
  if (os.platform() !== 'win32') {
    return { success: false, message: '该功能仅支持 Windows' }
  }
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error('文件不存在: ' + resolved)
  }
  const script = getCloseHandlesScript(resolved)
  await execWithTimeout('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ])
  return { success: true, message: '已关闭占用该文件的进程' }
}

/**
 * Kill a process by PID.
 */
async function killProcess(pid) {
  const { cmd, args } = getKillCommand(pid)
  await execWithTimeout(cmd, args)
  return { success: true, message: `已结束进程 PID: ${pid}` }
}

window.services = {
  findLockingProcesses,
  closeFileHandle,
  killProcess
}
```

- [ ] **Step 3: Verify syntax**

Run: `node --check public/preload/services.js`
Expected: No syntax errors

- [ ] **Step 4: Commit**

```bash
git add public/preload/services.js
git commit -m "feat(preload): implement find/close/kill process APIs"
```

---

## Task 5: Update env.d.ts type declarations

**Files:**
- Modify: `src/env.d.ts`

- [ ] **Step 1: Replace Services interface**

Write `src/env.d.ts`:

```typescript
/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface ProcessInfo {
  pid: number
  name: string
  path: string
}

interface OperationResult {
  success: boolean
  message: string
}

interface Services {
  findLockingProcesses: (filePath: string) => Promise<ProcessInfo[]>
  closeFileHandle: (filePath: string, pid: number) => Promise<OperationResult>
  killProcess: (pid: number) => Promise<OperationResult>
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
```

- [ ] **Step 2: Commit**

```bash
git add src/env.d.ts
git commit -m "feat(types): update Services interface for unlock APIs"
```

---

## Task 6: Create Unlock UI component

**Files:**
- Create: `src/Unlock/index.vue`

- [ ] **Step 1: Write the Unlock component**

Write `src/Unlock/index.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'

const filePath = ref('')
const processes = ref<ProcessInfo[]>([])
const loading = ref('')
const error = ref('')
const isWindows = ref(false)

onMounted(() => {
  isWindows.value = window.ztools.isWindows()
})

function handleDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file) {
    const fullPath = window.ztools.getPathForFile(file)
    filePath.value = fullPath
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
}

async function handleBrowse() {
  const files = window.ztools.showOpenDialog({
    title: '选择要解除占用的文件',
    properties: ['openFile']
  })
  if (files && files.length > 0) {
    filePath.value = files[0]
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
  try {
    processes.value = await window.services.findLockingProcesses(filePath.value.trim())
    if (processes.value.length === 0) {
      error.value = '该文件没有被任何进程占用'
    }
  } catch (err: any) {
    error.value = err.message || '查找失败'
  } finally {
    loading.value = ''
  }
}

async function handleCloseHandle(proc: ProcessInfo) {
  if (!isWindows.value) return
  loading.value = `正在关闭 ${proc.name} 的占用...`
  error.value = ''
  try {
    const result: OperationResult = await window.services.closeFileHandle(
      filePath.value.trim(),
      proc.pid
    )
    window.ztools.showNotification(result.message)
    if (result.success) {
      await handleFind()
    }
  } catch (err: any) {
    error.value = err.message || '关闭占用失败'
  } finally {
    loading.value = ''
  }
}

async function handleKill(proc: ProcessInfo) {
  loading.value = `正在结束 ${proc.name} (PID: ${proc.pid})...`
  error.value = ''
  try {
    const result: OperationResult = await window.services.killProcess(proc.pid)
    window.ztools.showNotification(result.message)
    if (result.success) {
      await handleFind()
    }
  } catch (err: any) {
    error.value = err.message || '结束进程失败'
  } finally {
    loading.value = ''
  }
}
</script>

<template>
  <div class="unlock">
    <div class="unlock-header">
      <h1>解除文件占用</h1>
    </div>

    <div
      class="unlock-input-area"
      @drop="handleDrop"
      @dragover="handleDragOver"
    >
      <input
        v-model="filePath"
        class="unlock-input"
        placeholder="输入文件路径或拖拽文件到此处"
        @keyup.enter="handleFind"
      />
      <button class="unlock-browse-btn" @click="handleBrowse">浏览</button>
    </div>

    <button class="unlock-find-btn" @click="handleFind">查找占用进程</button>

    <div v-if="loading" class="unlock-loading">{{ loading }}</div>

    <div v-if="error && !loading" class="unlock-error">{{ error }}</div>

    <div v-if="processes.length > 0" class="unlock-results">
      <div v-for="proc in processes" :key="proc.pid" class="process-card">
        <div class="process-info">
          <span class="process-name">{{ proc.name }}</span>
          <span class="process-pid">PID: {{ proc.pid }}</span>
        </div>
        <div v-if="proc.path" class="process-path">{{ proc.path }}</div>
        <div class="process-actions">
          <button
            :disabled="!isWindows || !!loading"
            class="action-btn close-btn"
            :title="!isWindows ? '该功能仅支持 Windows' : '关闭占用（优雅退出进程）'"
            @click="handleCloseHandle(proc)"
          >
            关闭占用
          </button>
          <button
            :disabled="!!loading"
            class="action-btn kill-btn"
            title="强制结束进程"
            @click="handleKill(proc)"
          >
            结束进程
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unlock {
  padding: 20px;
  box-sizing: border-box;
}

.unlock-header h1 {
  font-size: 18px;
  margin: 0 0 16px 0;
}

.unlock-input-area {
  display: flex;
  gap: 8px;
  padding: 8px;
  border: 1px dashed var(--border-color, #ccc);
  border-radius: 6px;
  transition: border-color 0.2s;
}

.unlock-input-area:hover {
  border-color: var(--primary-color, #42b883);
}

.unlock-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  background: transparent;
  color: var(--text-color, #333);
}

.unlock-browse-btn {
  padding: 4px 12px;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-color, #333);
}

.unlock-browse-btn:hover {
  background: var(--hover-color, #f5f5f5);
}

.unlock-find-btn {
  margin-top: 12px;
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 6px;
  background: var(--primary-color, #42b883);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.unlock-find-btn:hover {
  opacity: 0.9;
}

.unlock-find-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.unlock-loading {
  margin-top: 16px;
  text-align: center;
  color: var(--text-color, #666);
}

.unlock-error {
  margin-top: 16px;
  padding: 12px;
  border-radius: 6px;
  background: #fff2f0;
  color: #cf1322;
  font-size: 13px;
}

.unlock-results {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.process-card {
  padding: 14px;
  border: 1px solid var(--border-color, #e8e8e8);
  border-radius: 8px;
  background: var(--card-bg, #fafafa);
}

.process-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.process-name {
  font-weight: 600;
  font-size: 14px;
}

.process-pid {
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.process-path {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary, #999);
  word-break: break-all;
}

.process-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}

.action-btn {
  padding: 6px 14px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.close-btn {
  background: #e6f7ff;
  color: #096dd9;
}

.close-btn:hover:not(:disabled) {
  background: #bae7ff;
}

.kill-btn {
  background: #fff1f0;
  color: #cf1322;
}

.kill-btn:hover:not(:disabled) {
  background: #ffccc7;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/Unlock/index.vue
git commit -m "feat(ui): add Unlock component with drag-drop and process management"
```

---

## Task 7: Update plugin.json features configuration

**Files:**
- Modify: `public/plugin.json`

- [ ] **Step 1: Replace plugin.json content**

Write `public/plugin.json`:

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "unlock-file",
  "title": "解除文件占用",
  "description": "查找并解除文件被进程占用，支持拖拽文件和手动输入路径",
  "author": "",
  "version": "1.0.0",
  "main": "index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "development": {
    "main": "http://localhost:5173"
  },
  "features": [
    {
      "code": "unlock",
      "explain": "解除文件占用",
      "icon": "logo.png",
      "cmds": [
        {
          "type": "files",
          "fileType": "file",
          "maxLength": 1,
          "label": "解除文件占用"
        }
      ]
    }
  ],
  "platform": [
    "darwin",
    "win32",
    "linux"
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add public/plugin.json
git commit -m "feat(config): update plugin.json with unlock feature"
```

---

## Task 8: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README content**

Write `README.md`:

```markdown
# 解除文件占用

> 解除文件占用，以方便修改删除文件

一个 ZTools 插件，用于查找并解除文件被进程占用的问题。

## 功能特性

- **识别占用进程** — 找出哪个进程锁定了指定文件
- **关闭占用** — 通过 RestartManager API 精准关闭占用文件的进程（仅 Windows）
- **结束进程** — 强制杀掉占用文件的进程（全平台）
- **输入方式** — 支持手动输入路径、拖拽文件、浏览选择

## 平台支持

| 功能 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 查找进程 | RestartManager API | lsof | lsof |
| 关闭占用 | RmShutdown | 不支持 | 不支持 |
| 结束进程 | taskkill /F | kill -9 | kill -9 |

## 项目结构

```
public/
├── logo.png
├── plugin.json
└── preload/
    ├── package.json
    ├── services.js       # 核心 API 实现
    ├── utils.js          # 纯辅助函数
    └── utils.test.js     # 单元测试
src/
├── App.vue
├── main.ts
├── main.css
├── env.d.ts
└── Unlock/
    └── index.vue         # 主界面组件
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 运行单元测试
node --test public/preload/utils.test.js
```

## 技术方案

- Windows: PowerShell P/Invoke 调用 RestartManager API (RmStartSession / RmRegisterResources / RmGetList / RmShutdown / RmEndSession)
- macOS / Linux: `lsof` 查找进程，`kill -9` 结束进程

## 开源协议

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for unlock plugin"
```

---

## Task 9: Verify build and type checking

**Files:** (no modified files)

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run unit tests**

Run: `node --test public/preload/utils.test.js`
Expected: All tests pass

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds, output in `dist/`

- [ ] **Step 4: Fix any errors and commit**

If errors found, fix them. Then:

```bash
git add -A && git commit -m "chore: fix type/build issues"
```

If no errors, no commit needed.

---

## Task 10: Manual integration testing in ZTools

**Files:** (no modified files — verification only)

- [ ] **Step 1: Load plugin in ZTools dev mode**

Run: `npm run dev`
ZTools loads `development.main` URL (`http://localhost:5173`)

- [ ] **Step 2: Test with a locked file on Windows**

1. Open Notepad, create a file, keep it open
2. In ZTools, paste the file → should see Notepad process listed
3. Click "关闭占用" → should close Notepad's handle
4. Click "结束进程" → should kill Notepad

- [ ] **Step 3: Test edge cases**

1. Input a non-existent path → should show "文件不存在"
2. Input a path with no lock → should show "该文件没有被任何进程占用"
3. Drag and drop a file → should auto-fill the path

- [ ] **Step 4: Verify final state**

All tasks complete. Plugin is functional and tested.
