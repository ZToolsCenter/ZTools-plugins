Add-Type -AssemblyName System.IO.Compression.FileSystem
$dir = $PSScriptRoot
$out = "$dir\AutoMode.zpx"
if (Test-Path $out) { Remove-Item $out }

$z = [System.IO.Compression.ZipFile]::Open($out, "Create")

$files = @(
    @{Path="$dir\plugin.json"; Name="plugin.json"},
    @{Path="$dir\preload.js"; Name="preload.js"},
    @{Path="$dir\index.html"; Name="index.html"},
    @{Path="$dir\logo.png"; Name="logo.png"},
    @{Path="$dir\lib\utils.js"; Name="lib/utils.js"},
    @{Path="$dir\lib\ui-state.js"; Name="lib/ui-state.js"}
)

foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f.Path)
    $entry = $z.CreateEntry($f.Name)
    $entry.LastWriteTime = [DateTime]::Now
    $stream = $entry.Open()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $stream.Dispose()
}

$z.Dispose()
Write-Host "OK"
