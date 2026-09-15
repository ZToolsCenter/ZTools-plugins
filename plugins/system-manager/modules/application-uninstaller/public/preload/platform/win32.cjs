'use strict'

const path = require('node:path')
const { opaqueId } = require('../core/safety.cjs')
const { copyPrefix, copyString } = require('../core/text.cjs')

const MAX_PLATFORM_APPS = 5_000
const MAX_REGISTRY_ROWS = MAX_PLATFORM_APPS + 1
const SYSTEM_ROOT_PATTERN = /^[A-Za-z]:\\Windows$/i
const REGISTRY_ORIGIN_SCOPES = new Map([
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'user'],
  ['HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'system'],
  ['HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'system'],
])

function resolveSystemRoot(env = {}) {
  const value = typeof env.SystemRoot === 'string' ? env.SystemRoot : ''
  if (!SYSTEM_ROOT_PATTERN.test(value) || !path.win32.isAbsolute(value) || path.win32.normalize(value) !== value) {
    const error = new Error('SystemRoot 必须是形如 C:\\Windows 的绝对系统目录')
    error.code = 'UNSAFE_SYSTEM_ROOT'
    throw error
  }
  return value
}

function systemExecutable(env, ...segments) {
  const root = resolveSystemRoot(env)
  const executable = path.win32.join(root, ...segments)
  if (!path.win32.isAbsolute(executable) || path.win32.relative(root, executable).startsWith('..')) {
    const error = new Error('系统可执行文件路径无效')
    error.code = 'UNSAFE_SYSTEM_ROOT'
    throw error
  }
  return executable
}

function controlledWindowsEnv(env = {}) {
  const root = resolveSystemRoot(env)
  const result = {}
  for (const [key, value] of Object.entries(env)) {
    if (['path', 'systemroot', 'windir', 'psmodulepath', 'psmoduleanalysiscachepath', 'pssessionconfigurationname'].includes(key.toLowerCase())) continue
    result[key] = value
  }
  result.SystemRoot = root
  result.WINDIR = root
  result.PATH = [
    path.win32.join(root, 'System32'),
    root,
    path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
  ].join(';')
  result.PSModulePath = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules')
  return result
}

const REGISTRY_SCRIPT = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$PSModuleAutoloadingPreference='None'
$moduleRoot="$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules"
foreach($module in @('Microsoft.PowerShell.Management','Microsoft.PowerShell.Utility')){Import-Module -Name ($moduleRoot+'\'+$module+'\'+$module+'.psd1') -Force -ErrorAction Stop}
$roots = @(
  @{Path='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'; Scope='user'},
  @{Path='HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'; Scope='system'},
  @{Path='HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'; Scope='system'}
)
$items = @($roots | ForEach-Object {
  $origin=$_.Path;$scope=$_.Scope
  Get-ItemProperty -Path $origin -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and [int]$_.SystemComponent -ne 1 } | ForEach-Object {
    [PSCustomObject]@{ Origin=$origin; Key=$_.PSChildName; Scope=$scope; DisplayName=$_.DisplayName; DisplayVersion=$_.DisplayVersion; Publisher=$_.Publisher; InstallLocation=$_.InstallLocation; SystemComponent=$_.SystemComponent }
  }
} | Select-Object -First ${MAX_REGISTRY_ROWS})
$items | ConvertTo-Json -Compress -Depth 3
`

function normalizeEntries(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function cleanMetadataText(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? copyPrefix(text, maxLength) : null
}

function registryEntriesToApps(entries, secret = '') {
  const seen = new Set()
  const apps = []
  const rows = normalizeEntries(entries).slice(0, MAX_REGISTRY_ROWS)
  for (const item of rows) {
    if (!item || !item.DisplayName || Number(item.SystemComponent || 0) === 1) continue
    const scope = REGISTRY_ORIGIN_SCOPES.get(item.Origin)
    const rawKey = typeof item.Key === 'string' && item.Key.length > 0 && item.Key.length <= 512 && !item.Key.includes('\0')
      ? copyString(item.Key)
      : null
    if (!scope || !rawKey) continue
    const identity = `${item.Origin}\0${rawKey}`
    if (seen.has(identity)) continue
    seen.add(identity)
    const name = cleanMetadataText(item.DisplayName, 240)
    if (!name) continue
    apps.push({
      id: opaqueId('app', `win32:${identity}`, secret), platform: 'win32',
      name, version: cleanMetadataText(item.DisplayVersion, 120), publisher: cleanMetadataText(item.Publisher, 240),
      appKey: safeSegment(rawKey),
      install: { kind: 'registry', path: cleanMetadataText(item.InstallLocation, 1_024), scope },
      uninstall: { mode: 'manual', requiresElevation: scope !== 'user', supported: false },
      protected: false,
    })
    if (apps.length >= MAX_PLATFORM_APPS) break
  }
  return apps
}

async function scanApps(ctx) {
  const encoded = Buffer.from(REGISTRY_SCRIPT, 'utf16le').toString('base64')
  try {
    const powershell = systemExecutable(ctx.env, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const { stdout } = await ctx.execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 12000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: controlledWindowsEnv(ctx.env) })
    const rows = normalizeEntries(JSON.parse(String(stdout || '').replace(/^\uFEFF/, '') || '[]')).slice(0, MAX_REGISTRY_ROWS)
    const warnings = rows.length > MAX_PLATFORM_APPS ? [`Windows 应用枚举已达到安全上限 ${MAX_PLATFORM_APPS}，已返回部分结果。`] : []
    return { apps: registryEntriesToApps(rows, ctx.secret).sort((a, b) => a.name.localeCompare(b.name)), warnings }
  } catch { return { apps: [], warnings: ['无法读取 Windows 应用注册表，请确认 PowerShell 可用。'] } }
}

function safeSegment(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!text || Buffer.byteLength(text, 'utf8') > 255 || text === '.' || text === '..' || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(text)) return null
  return copyString(text)
}

async function inspectApp(app, ctx) {
  const candidates = []
  const segments = [...new Set([safeSegment(app.appKey), safeSegment(app.name)].filter(Boolean))]
  const localAppData = path.win32.join(ctx.home, 'AppData', 'Local')
  const roamingAppData = path.win32.join(ctx.home, 'AppData', 'Roaming')
  for (const root of [localAppData, roamingAppData]) {
    for (const segment of segments) {
      const candidatePath = path.win32.join(root, segment)
      try {
        await ctx.fs.lstat(candidatePath)
        const confidence = segment === app.appKey ? 'exact' : 'strong'
        candidates.push({ path: candidatePath, category: root === localAppData ? 'cache' : 'config', confidence, reason: confidence === 'exact' ? `由卸载注册表声明的标识关联：${segment}` : `仅按显示名称推断：${segment}，可能与同名应用共享`, selectedByDefault: false, ownership: 'user', deletable: true })
      } catch {}
    }
  }
  return candidates
}

module.exports = { MAX_PLATFORM_APPS, MAX_REGISTRY_ROWS, REGISTRY_SCRIPT, cleanMetadataText, controlledWindowsEnv, inspectApp, registryEntriesToApps, resolveSystemRoot, scanApps, systemExecutable }
