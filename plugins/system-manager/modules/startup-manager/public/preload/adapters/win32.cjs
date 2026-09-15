'use strict'

const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { copyString, createItem } = require('../core/model.cjs')

const POWERSHELL_PREAMBLE = String.raw`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$PSModuleAutoloadingPreference='None'
$moduleRoot="$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules"
foreach($module in @('Microsoft.PowerShell.Management','Microsoft.PowerShell.Utility','CimCmdlets','ScheduledTasks')){Import-Module -Name ($moduleRoot+'\'+$module+'\'+$module+'.psd1') -Force -ErrorAction Stop}`

const TASK_PREAMBLE = String.raw`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$PSModuleAutoloadingPreference='None'
$moduleRoot="$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules"
foreach($module in @('Microsoft.PowerShell.Management','Microsoft.PowerShell.Utility','ScheduledTasks')){Import-Module -Name ($moduleRoot+'\'+$module+'\'+$module+'.psd1') -Force -ErrorAction Stop}`

const SCAN_SCRIPT = `${POWERSHELL_PREAMBLE}${String.raw`
$rows=@()
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$currentIds=@($identity.Name,$identity.User.Value)
foreach($spec in @(@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','user','Run'),@('HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce','user','RunOnce'),@('HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','system','Run'),@('HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce','system','RunOnce'))){
  if(Test-Path $spec[0]){ $key=Get-Item $spec[0]; foreach($name in $key.GetValueNames()){ if($name){ $rows += [pscustomobject]@{kind='run-key';scope=$spec[1];name=$name;location=$spec[0];trigger=$spec[2];command=[string]$key.GetValue($name,$null,'DoNotExpandEnvironmentNames');valueType=[string]$key.GetValueKind($name);enabled=$true;running=$null} } } }
}
foreach($folder in @(@([Environment]::GetFolderPath('Startup'),'user'),@([Environment]::GetFolderPath('CommonStartup'),'system'))){ if(Test-Path $folder[0]){ Get-ChildItem -LiteralPath $folder[0] -File | ForEach-Object { $rows += [pscustomobject]@{kind='startup-folder';scope=$folder[1];name=$_.BaseName;location=$_.FullName;trigger='登录时';command=$_.Name;enabled=$true;running=$null} } } }
Get-ScheduledTask | Where-Object { $_.Triggers.CimClass.CimClassName -match 'Logon|Boot' } | ForEach-Object { $owner=[string]$_.Principal.UserId;$isCurrent=$currentIds -contains $owner;$xml=Export-ScheduledTask -TaskPath $_.TaskPath -TaskName $_.TaskName;$rows += [pscustomobject]@{kind='scheduled-task';scope=if($isCurrent){'user'}else{'system'};ownerIsCurrent=$isCurrent;principal=$owner;uri=([string]$_.TaskPath+[string]$_.TaskName);taskXml=$xml;name=$_.TaskName;location=$_.TaskPath;trigger='登录或开机';command=(($_.Actions|ForEach-Object{([string]$_.Execute)+' '+([string]$_.Arguments)}) -join ', ');enabled=($_.State -ne 'Disabled');running=($_.State -eq 'Running');taskPath=$_.TaskPath;state=[string]$_.State} }
Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' } | ForEach-Object { $rows += [pscustomobject]@{kind='service';scope='system';name=$_.DisplayName;location=$_.Name;trigger='系统启动';command=$_.PathName;enabled=$true;running=($_.State -eq 'Running');startType=$_.StartMode;state=$_.State} }
$rows | ConvertTo-Json -Depth 5 -Compress
`}`

const TASK_SCRIPT = `${TASK_PREAMBLE}${String.raw`
if($env:ZTOOLS_MODE -eq 'enable'){Enable-ScheduledTask -TaskPath $env:ZTOOLS_PATH -TaskName $env:ZTOOLS_NAME|Out-Null}else{Disable-ScheduledTask -TaskPath $env:ZTOOLS_PATH -TaskName $env:ZTOOLS_NAME|Out-Null}
`}`

const TASK_STATE_SCRIPT = `${TASK_PREAMBLE}${String.raw`
$task=Get-ScheduledTask -TaskPath $env:ZTOOLS_PATH -TaskName $env:ZTOOLS_NAME;$xml=Export-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName;@{enabled=($task.State -ne 'Disabled');running=($task.State -eq 'Running');principal=[string]$task.Principal.UserId;uri=([string]$task.TaskPath+[string]$task.TaskName);taskXml=$xml;command=(($task.Actions|ForEach-Object{([string]$_.Execute)+' '+([string]$_.Arguments)}) -join ', ')}|ConvertTo-Json -Depth 4 -Compress
`}`

function encoded(script) { return Buffer.from(script, 'utf16le').toString('base64') }
function powershell(deps) {
  if (deps.powershell) return deps.powershell
  const root = /^[A-Za-z]:\\Windows$/i.test(process.env.SystemRoot || '') ? process.env.SystemRoot : 'C:\\Windows'
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function parseRows(value) {
  const rows = typeof value === 'string' ? JSON.parse(value.replace(/^\uFEFF/, '') || '[]') : value
  return rows == null ? [] : Array.isArray(rows) ? rows : [rows]
}

function rowKey(row) { return `win32:${row.kind}:${row.scope}:${row.location}:${row.name}` }

function taskFingerprint(row) {
  const xml = String(row.taskXml || '').replace(/<Enabled>\s*(?:true|false)\s*<\/Enabled>/gi, '<Enabled>*</Enabled>').replace(/\s+/g, ' ').trim()
  return crypto.createHash('sha256').update(JSON.stringify({ xml, principal: row.principal || '', uri: row.uri || '', command: row.command || '' })).digest('hex')
}

function parseState(value) {
  const parsed = JSON.parse(String(value || '{}').replace(/^\uFEFF/, ''))
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

function boundedIdentity(value, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) return null
  return copyString(value)
}

function fromRow(row, home) {
  const taskPath = boundedIdentity(row.taskPath || row.location, 1_024)
  const taskName = boundedIdentity(row.name, 512)
  const userManageable = Boolean(row.scope === 'user' && row.kind === 'scheduled-task' && row.ownerIsCurrent === true && taskPath && taskName)
  const identity = {
    kind: row.kind === 'scheduled-task' ? 'scheduled-task' : copyString(String(row.kind || '')),
    taskPath,
    location: taskPath,
    name: taskName,
  }
  return createItem({
    key: rowKey(row), name: row.name, scope: row.scope, kind: row.kind,
    source: { label: row.kind === 'run-key' ? 'Windows 注册表' : row.kind === 'startup-folder' ? '启动文件夹' : row.kind === 'scheduled-task' ? '任务计划程序' : 'Windows 服务', location: row.location },
    trigger: row.trigger, commandSummary: row.command, enabled: row.enabled, running: row.running,
    status: row.running ? 'running' : row.enabled === false ? 'disabled' : 'idle',
    action: userManageable ? { canToggle: true, requiresElevation: false, reason: '通过任务计划程序切换，可撤销' } : { canToggle: false, requiresElevation: row.scope === 'system', reason: row.kind === 'run-key' ? '为避免删除注册表值后因崩溃丢失恢复数据，当前仅支持查看' : row.kind === 'startup-folder' ? '启动文件夹首版仅支持查看' : '系统级项目仅支持查看' },
    metadata: { startType: row.startType },
    internal: { row: identity, fingerprint: row.kind === 'scheduled-task' ? taskFingerprint(row) : null },
  }, home)
}

async function scan(deps = {}) {
  const runner = deps.runner
  const home = deps.home || os.homedir()
  const warnings = []
  let rows = []
  try {
    const result = await runner.runFile(powershell(deps), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(SCAN_SCRIPT)], { timeoutMs: 15_000 })
    rows = parseRows(result.stdout)
  } catch (error) {
    warnings.push(`Windows 启动项读取失败：${error.code === 'ENOENT' ? 'PowerShell 不可用' : '权限不足或命令失败'}`)
  }
  return { items: rows.slice(0, 800).map((row) => fromRow(row, home)), warnings }
}

async function runStatic(script, env, deps) {
  return deps.runner.runFile(powershell(deps), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(script)], { env })
}

async function applyEnabled(item, enabled, deps = {}) {
  const row = item.internal.row
  if (row.kind === 'scheduled-task') {
    const stateResult = await runStatic(TASK_STATE_SCRIPT, { ZTOOLS_PATH: row.taskPath || row.location, ZTOOLS_NAME: row.name }, deps)
    const state = parseState(stateResult.stdout)
    if (Boolean(state.enabled) !== Boolean(item.enabled)) { const error = new Error('计划任务状态已变化，请刷新后重试'); error.code = 'ITEM_CHANGED'; throw error }
    if (taskFingerprint(state) !== item.internal.fingerprint) { const error = new Error('计划任务定义、主体或操作已变化，请刷新后重试'); error.code = 'ITEM_CHANGED'; throw error }
    await runStatic(TASK_SCRIPT, { ZTOOLS_MODE: enabled ? 'enable' : 'disable', ZTOOLS_PATH: row.taskPath || row.location, ZTOOLS_NAME: row.name }, deps)
    const verificationResult = await runStatic(TASK_STATE_SCRIPT, { ZTOOLS_PATH: row.taskPath || row.location, ZTOOLS_NAME: row.name }, deps)
    const verification = parseState(verificationResult.stdout)
    if (Boolean(verification.enabled) !== enabled || taskFingerprint(verification) !== item.internal.fingerprint) {
      try { await runStatic(TASK_SCRIPT, { ZTOOLS_MODE: enabled ? 'disable' : 'enable', ZTOOLS_PATH: row.taskPath || row.location, ZTOOLS_NAME: row.name }, deps) } catch {}
      const error = new Error('计划任务未进入请求状态，已尝试恢复'); error.code = 'VERIFY_FAILED'; throw error
    }
    return { kind: 'win-task', enabled: !enabled, state: { enabled, running: Boolean(verification.running) } }
  }
  throw new Error('该项目仅支持查看')
}

async function undo(item, rollback, deps) {
  return applyEnabled(item, rollback.enabled, deps)
}

module.exports = { POWERSHELL_PREAMBLE, SCAN_SCRIPT, TASK_STATE_SCRIPT, applyEnabled, encoded, parseRows, parseState, rowKey, scan, taskFingerprint, undo }
