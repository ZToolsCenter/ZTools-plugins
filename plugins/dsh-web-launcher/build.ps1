# Package this plugin directory into a zip that ZTools can import.
# ZTools requires plugin.json to sit at the archive root.
# Keep this file ASCII-only: Windows PowerShell 5.1 decodes BOM-less scripts
# with the system ANSI code page and would mangle non-ASCII source text.
[CmdletBinding()]
param(
  [string]$OutDir = (Join-Path $PSScriptRoot 'dist')
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$pluginJsonPath = Join-Path $root 'plugin.json'
$config = Get-Content -LiteralPath $pluginJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json

$packageName = '{0}-{1}' -f $config.name, $config.version
$stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) ('ztools-package-' + $packageName)
$zipPath = Join-Path $OutDir ($packageName + '.zip')

# Files that go into the package.
# config.json is NOT packaged: the plugin writes it to the user home on first run.
$payload = @('plugin.json', 'preload.js', 'logo.png')

if (Test-Path -LiteralPath $stagingDir) {
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

foreach ($file in $payload) {
  $source = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $source)) {
    throw ('Missing package file: ' + $file)
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $stagingDir $file) -Force
}

if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$staged = Get-ChildItem -LiteralPath $stagingDir -File
Compress-Archive -Path $staged.FullName -DestinationPath $zipPath -CompressionLevel Optimal

Remove-Item -LiteralPath $stagingDir -Recurse -Force

$zipItem = Get-Item -LiteralPath $zipPath
Write-Host ('Built: {0} ({1} bytes)' -f $zipItem.FullName, $zipItem.Length)
