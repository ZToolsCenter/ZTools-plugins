const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
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
    const proc = spawn(cmd, args, { timeout: TIMEOUT_MS })
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
  fs.writeFileSync(scriptPath, '\uFEFF' + content, 'utf8')
  return scriptPath
}

// Find processes by command line matching - fallback when handle.exe fails
async function findByCommandLine(resolvedPath) {
  const fileName = path.basename(resolvedPath)
  const dirName = path.dirname(resolvedPath)

  // Build search patterns: match filename, and optionally directory name for more precision
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$fileName = "' + fileName.replace(/'/g, "''") + '"',
    '$dirName = "' + dirName.replace(/'/g, "''") + '"',
    '',
    '# First: try exact match with full path or directory+filename',
    '$results = Get-CimInstance Win32_Process | Where-Object {',
    '  $cmdLine = $_.CommandLine',
    '  # Match 1: Full path appears in command line',
    '  $fullPathMatch = $cmdLine -like "*" + $dirName + "\\" + $fileName + "*" -or $cmdLine -like "*" + $dirName + "/" + $fileName + "*"',
    '  # Match 2: Just filename (less precise, only if full path not found)',
    '  $fileNameMatch = $cmdLine -like "*" + $fileName + "*"',
    '  $fullPathMatch -or $fileNameMatch',
    '} | ForEach-Object {',
    '  $score = 0',
    '  $cmdLine = $_.CommandLine',
    '  # Score based on match quality',
    '  if ($cmdLine -like "*" + $dirName + "*") { $score += 10 }',
    '  if ($cmdLine -like "*" + $fileName + "*") { $score += 5 }',
    '  # Boost score if this looks like a file opener (not just a classpath entry)',
    '  if ($cmdLine -match "(open|edit|run|jar|\\.exe)\s+.*" + [regex]::Escape($fileName)) { $score += 20 }',
    '  # Penalize if it looks like a classpath entry (java -cp ... file.jar)',
    '  if ($cmdLine -match "-cp\\s+[^;]*" + [regex]::Escape($fileName)) { $score -= 5 }',
    '  [PSCustomObject]@{',
    '    pid = [int]$_.ProcessId',
    '    name = $_.Name',
    '    exePath = $_.ExecutablePath',
    '    cmdLine = $cmdLine',
    '    score = $score',
    '  }',
    '} | Sort-Object -Property score -Descending',
    '',
    'if ($results -is [array]) { $results | ConvertTo-Json -Compress }',
    'elseif ($results) { "[" + ($results | ConvertTo-Json -Compress) + "]" }',
    'else { "[]" }'
  ].join('\n')

  const scriptPath = writeTempScript(script)
  try {
    const raw = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'cmdline')

    const trimmed = raw.trim()
    if (!trimmed || trimmed === 'null' || trimmed === '[]') return []

    const parsed = JSON.parse(trimmed)
    const arr = Array.isArray(parsed) ? parsed : [parsed]

    // Filter: only return processes with positive scores (good matches)
    // and limit to top 3 to avoid killing unrelated processes
    const goodMatches = arr.filter(p => p.score > 0).slice(0, 3)

    debugPush('[unlock] command line matches: ' + goodMatches.length + ' (scored)')
    goodMatches.forEach(p => {
      debugPush('  PID ' + p.pid + ' (' + p.name + '): score=' + p.score)
    })

    return goodMatches.map(p => ({
      pid: p.pid,
      name: p.name,
      exePath: p.exePath || p.cmdLine || '',
      source: 'cmdline',
      score: p.score
    }))
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
  }
}

// Use Resource Manager to find processes that have a file open
// This uses the Windows Restart Manager API via PowerShell
async function findByResourceManager(resolvedPath) {
  // Use a simpler approach: create a PowerShell script that uses the Restart Manager COM API
  const scriptContent = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$path = "${resolvedPath.replace(/"/g, '""')}"

# Load the C# code with proper escaping
$csCode = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class RestartManager {
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Auto)]
  public static extern int RmStartSession(out IntPtr pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);

  [DllImport("rstrtmgr.dll")]
  public static extern int RmEndSession(IntPtr pSessionHandle);

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Auto)]
  public static extern int RmRegisterResources(IntPtr pSessionHandle, uint nFiles, string[] rgsFileNames, uint nApplications, IntPtr rgApplications, uint nServices, IntPtr rgsServiceNames);

  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(IntPtr pSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, IntPtr rgAffectedApps, out uint lpdwRebootReasons);

  public struct RM_UNIQUE_PROCESS {
    public uint dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }

  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
    public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
    public string strServiceShortName;
    public uint ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bRestartable;
  }
}
'@

try {
  Add-Type -TypeDefinition $csCode -ErrorAction Stop
} catch {
  Write-Output "[]"
  exit
}

$results = @()

try {
  $sessionHandle = [IntPtr]::Zero
  $sessionKey = New-Object System.Text.StringBuilder(256)
  $ret = [RestartManager]::RmStartSession([ref]$sessionHandle, 0, $sessionKey)
  if ($ret -ne 0) { throw "RmStartSession failed: $ret" }

  try {
    $files = @($path)
    $ret = [RestartManager]::RmRegisterResources($sessionHandle, 1, $files, 0, [IntPtr]::Zero, 0, [IntPtr]::Zero)
    if ($ret -ne 0) { throw "RmRegisterResources failed: $ret" }

    $procCount = 0
    $ret = [RestartManager]::RmGetList($sessionHandle, [ref]$procCount, [ref]$procCount, [IntPtr]::Zero, [ref]0)
    if ($ret -eq 234) {
      $infoSize = [System.Runtime.InteropServices.Marshal]::SizeOf([Type][RestartManager+RM_PROCESS_INFO])
      $infoPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($infoSize * $procCount)
      $actualCount = $procCount
      $ret = [RestartManager]::RmGetList($sessionHandle, [ref]$procCount, [ref]$actualCount, $infoPtr, [ref]0)
      if ($ret -eq 0) {
        for ($i = 0; $i -lt $actualCount; $i++) {
          $info = [System.Runtime.InteropServices.Marshal]::PtrToStructure([IntPtr]($infoPtr.ToInt64() + $infoSize * $i), [Type][RestartManager+RM_PROCESS_INFO])
          $proc = Get-Process -Id $info.Process.dwProcessId -ErrorAction SilentlyContinue
          $exePath = ""
          if ($proc) {
            try { $exePath = $proc.Path } catch {}
            if (-not $exePath) {
              try {
                $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($info.Process.dwProcessId)" -ErrorAction SilentlyContinue
                if ($cim) { $exePath = $cim.ExecutablePath }
              } catch {}
            }
          }
          $results += @{
            pid = [int]$info.Process.dwProcessId
            name = $info.strAppName
            exePath = $exePath
            source = "resourcemanager"
          }
        }
      }
      [System.Runtime.InteropServices.Marshal]::FreeHGlobal($infoPtr)
    }
  } finally {
    [void][RestartManager]::RmEndSession($sessionHandle)
  }
} catch {
  # Resource Manager failed
}

if ($results.Count -eq 0) { "[]" }
else { $results | ConvertTo-Json -Compress }
`

  const scriptPath = writeTempScript(scriptContent)
  try {
    const raw = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'rm')

    const trimmed = raw.trim()
    if (!trimmed || trimmed === 'null' || trimmed === '[]') return []

    const parsed = JSON.parse(trimmed)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    debugPush('[unlock] Resource Manager found ' + arr.length + ' processes')
    return arr
  } catch (e) {
    debugPush('[unlock] Resource Manager failed: ' + e.message)
    return []
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
  }
}

// Find suspicious processes that might be locking the file/directory
// This is a last resort when other methods fail
async function findSuspiciousProcesses(resolvedPath) {
  const dirName = path.basename(path.dirname(resolvedPath))
  const fileName = path.basename(resolvedPath)

  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$searchTerms = @("' + dirName.replace(/'/g, "''") + '", "' + fileName.replace(/'/g, "''") + '")',
    '',
    '# Find Java, Node, Python processes that might be related',
    '$suspiciousNames = @("java.exe", "javaw.exe", "node.exe", "python.exe", "pythonw.exe")',
    '$results = @()',
    '',
    'Get-CimInstance Win32_Process | Where-Object { $suspiciousNames -contains $_.Name } | ForEach-Object {',
    '  $cmdLine = $_.CommandLine',
    '  $score = 0',
    '  # Check if command line contains search terms',
    '  foreach ($term in $searchTerms) {',
    '    if ($cmdLine -like "*$term*") { $score += 10 }',
    '  }',
    '  # Boost score for certain process types',
    '  if ($_.Name -like "*java*") { $score += 5 }',
    '  if ($_.Name -like "*node*") { $score += 3 }',
    '  # Only include if there\'s some match',
    '  if ($score -gt 0) {',
    '    $results += [PSCustomObject]@{',
    '      pid = [int]$_.ProcessId',
    '      name = $_.Name',
    '      exePath = $_.ExecutablePath',
    '      cmdLine = $cmdLine',
    '      score = $score',
    '      source = "suspicious"',
    '      reason = "Process may be locking the file/directory"',
    '    }',
    '  }',
    '}',
    '',
    '# Also find ALL Java/Node processes as fallback (in case no match found)',
    'if ($results.Count -eq 0) {',
    '  Get-CimInstance Win32_Process | Where-Object { $suspiciousNames -contains $_.Name } | ForEach-Object {',
    '    $results += [PSCustomObject]@{',
    '      pid = [int]$_.ProcessId',
    '      name = $_.Name',
    '      exePath = $_.ExecutablePath',
    '      cmdLine = $_.CommandLine',
    '      score = 1',
    '      source = "suspicious"',
    '      reason = "Common development process - may be locking files"',
    '    }',
    '  }',
    '}',
    '',
    'if ($results -is [array]) { $results | ConvertTo-Json -Compress }',
    'elseif ($results) { "[" + ($results | ConvertTo-Json -Compress) + "]" }',
    'else { "[]" }'
  ].join('\n')

  const scriptPath = writeTempScript(script)
  try {
    const raw = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
    ], 'suspicious')

    const trimmed = raw.trim()
    if (!trimmed || trimmed === 'null' || trimmed === '[]') return []

    const parsed = JSON.parse(trimmed)
    const arr = Array.isArray(parsed) ? parsed : [parsed]
    debugPush('[unlock] found ' + arr.length + ' suspicious processes')
    return arr
  } catch (e) {
    debugPush('[unlock] suspicious process search failed: ' + e.message)
    return []
  } finally {
    try { fs.unlinkSync(scriptPath) } catch (e) {}
  }
}

async function findLockingProcesses(filePath) {
  _debugLog = []
  const resolved = path.resolve(filePath)
  debugPush('=== findLockingProcesses ===')
  debugPush('path: ' + resolved)

  if (!fs.existsSync(resolved)) {
    throw new Error('路径不存在: ' + resolved)
  }

  // Method 1: Try Resource Manager (most accurate - asks Windows which process has the file open)
  debugPush('[unlock] trying Resource Manager...')
  try {
    const byRM = await findByResourceManager(resolved)
    if (byRM.length > 0) {
      debugPush('[unlock] found ' + byRM.length + ' processes via Resource Manager')
      debugPush('=== done ===')
      return byRM
    }
  } catch (e) {
    debugPush('[unlock] Resource Manager failed: ' + e.message)
  }

  // Method 2: Try command line matching (fallback, works for GUI apps)
  debugPush('[unlock] trying command line matching...')
  try {
    const byCmdLine = await findByCommandLine(resolved)
    if (byCmdLine.length > 0) {
      debugPush('[unlock] found ' + byCmdLine.length + ' processes via command line')
      debugPush('=== done ===')
      return byCmdLine
    }
  } catch (e) {
    debugPush('[unlock] command line matching failed: ' + e.message)
  }

  // Method 3: Try to open file exclusively to confirm it's locked
  debugPush('[unlock] trying exclusive open test...')
  const testScript = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$path = "' + resolved.replace(/'/g, "''") + '"',
    'try {',
    '  $fs = [System.IO.File]::Open($path, "Open", "Read", "None")',
    '  $fs.Close()',
    '  Write-Output "NOT_LOCKED"',
    '} catch {',
    '  Write-Output "LOCKED"',
    '}'
  ].join('\n')

  const testScriptPath = writeTempScript(testScript)
  let isLocked = false
  try {
    const testResult = await execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', testScriptPath
    ], 'locktest')

    if (testResult.trim() === 'LOCKED') {
      debugPush('[unlock] file is confirmed locked, searching for suspicious processes...')
      isLocked = true
    } else {
      debugPush('[unlock] file is NOT locked')
    }
  } catch (e) {
    debugPush('[unlock] lock test failed: ' + e.message)
  } finally {
    try { fs.unlinkSync(testScriptPath) } catch (e) {}
  }

  // Method 4: If locked but no process found, search for suspicious processes
  if (isLocked) {
    debugPush('[unlock] searching for suspicious processes...')
    try {
      const suspicious = await findSuspiciousProcesses(resolved)
      if (suspicious.length > 0) {
        debugPush('[unlock] found ' + suspicious.length + ' suspicious processes')
        debugPush('=== done ===')
        return suspicious
      }
    } catch (e) {
      debugPush('[unlock] suspicious process search failed: ' + e.message)
    }
  }

  debugPush('[unlock] no locking processes found')
  debugPush('=== done ===')
  return []
}

async function isProcessAlive(pid) {
  try {
    const raw = await execWithTimeout('tasklist', ['/FI', 'PID eq ' + pid, '/NH', '/FO', 'CSV'], 'alive')
    return raw.includes('"' + pid + '"')
  } catch { return false }
}

async function killProcess(pid) {
  _debugLog = []
  debugPush('=== killProcess PID: ' + pid + ' ===')
  const killCmd = getKillCommand(pid)
  debugPush('cmd: ' + killCmd.cmd + ' ' + killCmd.args.join(' '))

  return new Promise(function (resolve) {
    const proc = spawn(killCmd.cmd, killCmd.args, { timeout: TIMEOUT_MS })
    proc.on('error', function (err) {
      debugPush('[kill] spawn error: ' + err.message)
      resolve({ success: false, message: '结束失败: ' + err.message + '。请尝试任务管理器 (Ctrl+Shift+Esc)。' })
    })
    proc.on('close', function (code) {
      debugPush('[kill] exit code: ' + code)
      if (code === 0) {
        setTimeout(function () {
          isProcessAlive(pid).then(function (alive) {
            if (alive) {
              resolve({ success: false, message: 'PID ' + pid + ' 仍然存活,可能需要管理员权限。请使用任务管理器。' })
            } else {
              resolve({ success: true, message: '已结束 PID ' + pid })
            }
          })
        }, 500)
      } else if (code === 128) {
        resolve({ success: true, message: 'PID ' + pid + ' 已自行退出' })
      } else {
        resolve({ success: false, message: '结束失败 (退出码:' + code + '),可能需要管理员权限。请使用任务管理器。' })
      }
    })
  })
}

module.exports = { findLockingProcesses, killProcess, getDebugLog }
