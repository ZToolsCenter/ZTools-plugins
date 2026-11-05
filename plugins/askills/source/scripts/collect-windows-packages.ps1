#requires -Version 7.0
param(
    [string]$ExecutablePath = 'src-tauri/target/release/askills.exe',
    [string]$OutputDirectory = 'artifacts/windows-x64'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Get-Item -LiteralPath ([IO.Path]::GetFullPath($ExecutablePath, $projectRoot))
$outputPath = [IO.Path]::GetFullPath($OutputDirectory, $projectRoot)
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$configuration = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $configuration.version) { throw 'Frontend and Tauri versions differ.' }
$binaryVersion = $executable.VersionInfo.ProductVersion
if ($binaryVersion -ne $manifest.version) { throw 'Executable and package versions differ.' }
$reader = [IO.BinaryReader]::new([IO.File]::OpenRead($executable.FullName))
try {
    if ($reader.ReadUInt16() -ne 0x5A4D) { throw 'Expected a Windows executable.' }
    $reader.BaseStream.Position = 0x3C
    $reader.BaseStream.Position = $reader.ReadUInt32()
    if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Expected a Windows x64 PE executable.' }
} finally { $reader.Dispose() }
if ((Test-Path -LiteralPath $outputPath) -and @(Get-ChildItem -LiteralPath $outputPath -Force).Count -ne 0) {
    throw 'Output directory must be empty; choose a new OutputDirectory to avoid mixing builds.'
}
$commit = & git -C $projectRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the source commit.' }
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$executableName = "Askills_$($manifest.version)_windows_x64.exe"
$destination = Join-Path $outputPath $executableName
Copy-Item -LiteralPath $executable.FullName -Destination $destination
$digest = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
$buildInfo = [ordered]@{
    version = $manifest.version
    commit = $commit.Trim()
    target = 'x86_64-pc-windows-msvc'
    configuration = 'release'
    executable = $executableName
    executableSha256 = $digest
}
$buildInfo | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'build-info.json') -Encoding utf8NoBOM
"$digest  $executableName" | Set-Content -LiteralPath (Join-Path $outputPath 'SHA256SUMS.txt') -Encoding utf8NoBOM
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $outputPath 'LICENSE.txt')
Get-ChildItem -LiteralPath $outputPath | Select-Object Name, Length
