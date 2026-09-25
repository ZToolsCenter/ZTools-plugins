param(
    [Parameter(Mandatory = $false)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectRoot 'dist'
$manifestPath = Join-Path $distPath 'plugin.json'

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw '请先运行 pnpm build，生成 dist/plugin.json。'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $projectRoot (Join-Path 'outputs' "file-smart-rename-v$($manifest.version).zip")
}

foreach ($relativePath in @($manifest.main, $manifest.preload, $manifest.logo)) {
    if (-not (Test-Path -LiteralPath (Join-Path $distPath $relativePath))) {
        throw "插件入口文件不存在：$relativePath"
    }
}

$destination = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $destination) {
    throw "安装包已存在，请先指定新的输出路径：$destination"
}

$destinationDirectory = Split-Path -Parent $destination
New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open(
    $destination,
    [System.IO.Compression.ZipArchiveMode]::Create
)
try {
    Get-ChildItem -LiteralPath $distPath -File -Recurse | ForEach-Object {
        $entryName = [System.IO.Path]::GetRelativePath($distPath, $_.FullName).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $_.FullName,
            $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
}

$verification = [System.IO.Compression.ZipFile]::OpenRead($destination)
try {
    foreach ($relativePath in @('plugin.json', $manifest.main, $manifest.preload, $manifest.logo)) {
        if (-not $verification.GetEntry($relativePath.Replace('\', '/'))) {
            throw "安装包缺少入口文件：$relativePath"
        }
    }
} finally {
    $verification.Dispose()
}

Write-Output $destination
