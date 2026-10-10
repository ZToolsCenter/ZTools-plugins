$ErrorActionPreference = 'Stop'
$pluginProjectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $PSScriptRoot 'build.cjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$pluginDistPath = Join-Path $pluginProjectRoot 'dist'
$pluginManifest = Get-Content -LiteralPath (Join-Path $pluginDistPath 'plugin.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ($pluginManifest.name -notmatch '^[a-z][a-z0-9-]*$' -or $pluginManifest.version -notmatch '^\d+\.\d+\.\d+([.-][a-zA-Z0-9.-]+)?$') {
  throw 'Plugin name or version is invalid for a package filename.'
}
$pluginArtifactsPath = Join-Path $pluginProjectRoot 'artifacts'
New-Item -ItemType Directory -Path $pluginArtifactsPath -Force | Out-Null
$pluginZipPath = Join-Path $pluginArtifactsPath ($pluginManifest.name + '-' + $pluginManifest.version + '.zip')
$pluginAssetNames = @('plugin.json', 'index.html', 'styles.css', 'app.js', 'commands.js', 'preload.js', 'preview.js', 'logo.png', 'LICENSE')
$pluginAssetPaths = $pluginAssetNames | ForEach-Object { Join-Path $pluginDistPath $_ }
Compress-Archive -LiteralPath $pluginAssetPaths -DestinationPath $pluginZipPath -Force
Write-Output ('Package created: ' + $pluginZipPath)
