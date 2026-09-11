[CmdletBinding()]
param(
  [string]$ForkPath = '',
  [switch]$NoProxy,
  [switch]$Yes,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourcePath = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
if ([string]::IsNullOrWhiteSpace($ForkPath)) {
  $ForkPath = Join-Path (Split-Path $sourcePath -Parent) 'ZTools-plugins'
}
$forkPath = [IO.Path]::GetFullPath($ForkPath)
$pluginId = 'ztools-markdown-notes'
$pluginPath = [IO.Path]::GetFullPath((Join-Path $forkPath "plugins\$pluginId"))
$pluginsRoot = [IO.Path]::GetFullPath((Join-Path $forkPath 'plugins'))
$gitNetworkArguments = if ($NoProxy) { @('-c', 'http.proxy=', '-c', 'https.proxy=') } else { @() }

function Invoke-Checked {
  param(
    [Parameter(Mandatory)] [string]$Command,
    [Parameter(Mandatory)] [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Command $($Arguments -join ' ')"
  }
}

function Invoke-Git {
  param(
    [Parameter(Mandatory)] [string]$Repository,
    [Parameter(Mandatory)] [string[]]$Arguments
  )

  Invoke-Checked -Command 'git' -Arguments @($gitNetworkArguments + @('-C', $Repository) + $Arguments)
}

function Get-GitOutput {
  param(
    [Parameter(Mandatory)] [string]$Repository,
    [Parameter(Mandatory)] [string[]]$Arguments
  )

  $output = & git @gitNetworkArguments -C $Repository @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Git command failed: git $($Arguments -join ' ')"
  }
  return ($output | Out-String).Trim()
}

foreach ($command in @('git', 'pnpm')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command was not found in PATH."
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $sourcePath '.git'))) {
  throw "Source directory is not a Git repository: $sourcePath"
}
if (-not (Test-Path -LiteralPath (Join-Path $forkPath '.git'))) {
  throw "Fork repository was not found: $forkPath"
}
if (-not $pluginPath.StartsWith("$pluginsRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Plugin destination validation failed.'
}

$package = [IO.File]::ReadAllText((Join-Path $sourcePath 'package.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$rootManifest = [IO.File]::ReadAllText((Join-Path $sourcePath 'plugin.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$publicManifest = [IO.File]::ReadAllText((Join-Path $sourcePath 'public\plugin.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$version = [string]$package.version

if ([string]::IsNullOrWhiteSpace($version)) { throw 'package.json has no version.' }
if ($rootManifest.version -ne $version -or $publicManifest.version -ne $version) {
  throw 'Versions in package.json, plugin.json, and public/plugin.json do not match.'
}
$changelog = [IO.File]::ReadAllText((Join-Path $sourcePath 'CHANGELOG.md'), [Text.Encoding]::UTF8)
if ($changelog -notmatch "(?m)^##\s+(?:v|\[)?$([regex]::Escape($version))(?:\])?\s*$") {
  throw "CHANGELOG.md has no section for $version."
}

$branch = "plugin/$pluginId-v$version"
Write-Host ''
Write-Host "Preparing Markdown Notes v$version" -ForegroundColor Cyan
Write-Host "Source: $sourcePath"
Write-Host "Fork: $forkPath"
Write-Host "Branch: $branch"
if ($NoProxy) { Write-Host 'Git will bypass the global proxy for this run.' -ForegroundColor Yellow }
Write-Host ''

if (-not $Yes) {
  $answer = Read-Host 'Commit and push both repositories? (y/N)'
  if ($answer -notmatch '^(?i:y|yes)$') {
    Write-Host 'Cancelled.'
    exit 0
  }
}

Push-Location $sourcePath
try {
  Invoke-Checked -Command 'pnpm' -Arguments @('typecheck')
  Invoke-Checked -Command 'pnpm' -Arguments @('test')
  Invoke-Checked -Command 'pnpm' -Arguments @('build')
} finally {
  Pop-Location
}

Invoke-Git -Repository $sourcePath -Arguments @('add', '--all')
$sourceChanges = Get-GitOutput -Repository $sourcePath -Arguments @('status', '--porcelain')
if ($sourceChanges) {
  Invoke-Git -Repository $sourcePath -Arguments @('commit', '-m', "release: publish Markdown Notes v$version")
}
Invoke-Git -Repository $sourcePath -Arguments @('push', 'origin', 'main')

$remoteOutput = Get-GitOutput -Repository $forkPath -Arguments @('remote')
$existingRemotes = @($remoteOutput -split "`r?`n")
Invoke-Git -Repository $forkPath -Arguments @('remote', 'set-url', 'origin', 'https://github.com/dufan1032/ZTools-plugins.git')
if ($existingRemotes -contains 'upstream') {
  Invoke-Git -Repository $forkPath -Arguments @('remote', 'set-url', 'upstream', 'https://github.com/ZToolsCenter/ZTools-plugins.git')
} else {
  Invoke-Git -Repository $forkPath -Arguments @('remote', 'add', 'upstream', 'https://github.com/ZToolsCenter/ZTools-plugins.git')
}

Invoke-Git -Repository $forkPath -Arguments @('checkout', 'main')
Invoke-Git -Repository $forkPath -Arguments @('fetch', 'upstream')
Invoke-Git -Repository $forkPath -Arguments @('merge', '--ff-only', 'upstream/main')
Invoke-Git -Repository $forkPath -Arguments @('push', 'origin', 'main')

$localBranch = Get-GitOutput -Repository $forkPath -Arguments @('branch', '--list', $branch)
if ($localBranch) {
  throw "Local release branch already exists: $branch"
}
Invoke-Git -Repository $forkPath -Arguments @('checkout', '-b', $branch)

$archivePath = Join-Path ([IO.Path]::GetTempPath()) "$pluginId-$version-$([guid]::NewGuid().ToString('N')).zip"
try {
  Invoke-Git -Repository $sourcePath -Arguments @('archive', '--format=zip', '--output', $archivePath, 'HEAD')
  if (Test-Path -LiteralPath $pluginPath) {
    Remove-Item -LiteralPath $pluginPath -Recurse -Force
  }
  New-Item -ItemType Directory -Path $pluginPath -Force | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $pluginPath -Force
} finally {
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
}

Invoke-Git -Repository $forkPath -Arguments @('add', '--all', '--', "plugins/$pluginId")
$forkChanges = Get-GitOutput -Repository $forkPath -Arguments @('status', '--porcelain', '--', "plugins/$pluginId")
if (-not $forkChanges) {
  throw 'The plugin contents in the fork have not changed.'
}
Invoke-Git -Repository $forkPath -Arguments @('commit', '-m', "Update plugin Markdown Notes v$version")
Invoke-Git -Repository $forkPath -Arguments @('push', '-u', 'origin', $branch)

$pullRequestUrl = "https://github.com/dufan1032/ZTools-plugins/compare/main...$branch?expand=1"
Write-Host ''
Write-Host 'Release branch pushed. Create the pull request:' -ForegroundColor Green
Write-Host $pullRequestUrl
if (-not $NoOpen) {
  Start-Process $pullRequestUrl
}
