// 唤醒守护进程的 PowerShell 源码。
// 单独成文件：既可以保持 preload 逻辑清晰，也便于在 ZTools 之外独立验证原生调用。
const GUARD_MARKER = '--zvc-awake-guard'
const GUARD_SCRIPT_NAME = 'awake-guard.ps1'

const GUARD_SCRIPT = `param(
  [int]$Seconds = 0,
  [string]$HeartbeatFile = '',
  [string]$StopFile = '',
  [string]$AppProcessName = '',
  [int]$ParentProcessId = 0,
  [switch]$KeepDisplay
)

# Holds a Windows execution state so the system (and optionally the display) stays
# awake until this process ends, the stop flag appears, or the deadline passes.
$ErrorActionPreference = 'Stop'

Add-Type -Namespace ZvcAwake -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)] public static extern uint SetThreadExecutionState(uint esFlags);'

$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
$ES_DISPLAY_REQUIRED = [uint32]2

$flags = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED
if ($KeepDisplay) { $flags = $flags -bor $ES_DISPLAY_REQUIRED }
$flagsHex = '0x' + ([uint32]$flags).ToString('x8')

function Write-Beat([string]$state) {
  if (-not $HeartbeatFile) { return }
  try {
    Set-Content -LiteralPath $HeartbeatFile -Value ($state + '|' + $PID + '|' + $flagsHex) -Encoding ASCII -ErrorAction Stop
  } catch {
  }
}

if ([ZvcAwake.Native]::SetThreadExecutionState([uint32]$flags) -eq 0) {
  Write-Beat 'failed'
  [Console]::Out.WriteLine('FAILED')
  [Console]::Out.Flush()
  exit 2
}

Write-Beat 'ready'
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

$deadline = [DateTime]::MaxValue
if ($Seconds -gt 0) { $deadline = (Get-Date).AddSeconds($Seconds) }

$tick = 0
while ($true) {
  Start-Sleep -Milliseconds 500
  if ($StopFile -and (Test-Path -LiteralPath $StopFile)) { break }
  if ((Get-Date) -ge $deadline) { break }
  $tick = $tick + 1
  if (($tick % 4) -eq 0) {
    # Exit as soon as the hosting ZTools process is gone (parent pid when known,
    # otherwise any process using the application image name).
    $hostAlive = $true
    if ($ParentProcessId -gt 0) {
      $hostAlive = @(Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue).Count -gt 0
    } elseif ($AppProcessName) {
      $hostAlive = @(Get-Process -Name $AppProcessName -ErrorAction SilentlyContinue).Count -gt 0
    }
    if (-not $hostAlive) { break }
    Write-Beat 'hold'
  }
}

[ZvcAwake.Native]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
exit 0
`

module.exports = { GUARD_SCRIPT, GUARD_MARKER, GUARD_SCRIPT_NAME }
