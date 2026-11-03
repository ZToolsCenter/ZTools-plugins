# Windows system OCR (WinRT Windows.Media.Ocr) for the native-ocr ZTools plugin.
# macOS equivalent of ocr-vision.swift. Runs on built-in PowerShell 5.1+ with
# zero dependencies.
#
# OUTPUT CONTRACT (single line on stdout):
#   NOCR1:<base64 of UTF-8 JSON>
#   success: { "ok": true, "width": int, "height": int,
#              "lines": [ { "text": str, "box": { "x","y","w","h" } } ] }
#   failure: { "ok": false, "code": int, "message": str }
#
# WHY BASE64: stdout bytes are encoded by [Console]::OutputEncoding, which is
# silently ignored in some hosts (no real console + redirected pipe), falling
# back to the OEM code page (936/GBK on Chinese Windows). Node would then decode
# GBK bytes as UTF-8 and every Chinese line becomes mojibake. Base64 uses only
# [A-Za-z0-9+/=], so the bytes are identical under ANY code page.
# This file is deliberately pure ASCII: PowerShell 5.1 reads UTF-8 files WITHOUT
# a BOM using the system ANSI code page, which would corrupt non-ASCII comments.
#
# Box convention matches the macOS Vision engine: normalized to [0,1] with
# the origin at the image's lower-left corner (y measured from the bottom).
# Exit codes: 0 ok / 2 bad args / 3 image missing / 4 engine unavailable / 5 ocr failed

param(
    [Parameter(Mandatory = $true)][string]$ImagePath
)

$ErrorActionPreference = 'Stop'

$scriptVersion = "0.6.10"

# Best effort only: keeps the human-readable stderr line from mojibake.
# The data channel does NOT depend on this succeeding (see Write-Payload).
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Console]::ErrorEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Emit the payload as ASCII-only base64 so no console code page can alter it.
function Write-Payload($payload) {
    $json = $payload | ConvertTo-Json -Compress -Depth 6
    $b64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    [Console]::Out.Write("NOCR1:$b64`r`n")
    [Console]::Out.Flush()
}

# Required for [System.WindowsRuntimeSystemExtensions] (AsTask reflection below).
# Some systems do not auto-load it when resolving WinRT types.
try { Add-Type -AssemblyName System.Runtime.WindowsRuntime } catch {}

$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Security.Cryptography.CryptographicBuffer, Windows.Foundation, ContentType = WindowsRuntime]

function Await($WinRtTask, $ResultType) {
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    if (-not $asTaskGeneric) {
        throw 'WinRT AsTask helper not found'
    }
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

function Fail($code, $message) {
    # stderr is for humans and may be re-encoded by the console code page; the
    # authoritative text travels in the base64 envelope on stdout.
    try { [Console]::Error.WriteLine("[winrt-$scriptVersion] $message") } catch {}
    try { Write-Payload @{ ok = $false; code = $code; message = $message } } catch {}
    exit $code
}

if (-not (Test-Path -LiteralPath $ImagePath)) {
    Fail 3 "image not found: $ImagePath"
}

# Prefer Chinese, then any user-profile language.
$engine = $null
try {
    $available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
    $preferred = $available | Where-Object { $_.LanguageTag -like 'zh*' } | Select-Object -First 1
    if ($preferred) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($preferred)
    }
    if (-not $engine) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
} catch {
    Fail 4 "ocr engine init failed: $($_.Exception.Message)"
}
if (-not $engine) {
    Fail 4 "ocr engine unavailable: install a language pack (Settings > Time & Language > Language)"
}

try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path -LiteralPath $ImagePath).Path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])

    # Accuracy boost: small images / small text hurt WinRT OCR badly, so upscale
    # at decode time (max edge < 1200px gets 2x, capped at 4000px). Boxes are
    # normalized afterwards, so coordinates stay consistent with the source.
    $srcW = [uint32]$decoder.PixelWidth
    $srcH = [uint32]$decoder.PixelHeight
    $outW = $srcW
    $outH = $srcH
    $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
    $maxEdge = [Math]::Max($srcW, $srcH)
    if ($maxEdge -gt 0 -and $maxEdge -lt 1200) {
        $scale = [Math]::Min(4.0, 1200.0 / [double]$maxEdge)
        $outW = [uint32][Math]::Min(4000, [Math]::Round([double]$srcW * $scale))
        $outH = [uint32][Math]::Min(4000, [Math]::Round([double]$srcH * $scale))
        $transform.ScaledWidth = $outW
        $transform.ScaledHeight = $outH
    }
    $pixelData = Await ($decoder.GetPixelDataAsync(
        [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
        [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
        $transform,
        [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
        [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.PixelDataProvider])
    # PowerShell cannot bind byte[] to the IBuffer overload directly; convert it.
    # Any failure falls back to the plain (no upscale) path so OCR keeps working.
    $bitmap = $null
    try {
        $pixels = $pixelData.DetachPixelData()
        $buffer = [Windows.Security.Cryptography.CryptographicBuffer]::CreateFromByteArray($pixels)
        $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer(
            $buffer,
            [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
            [int]$outW,
            [int]$outH)
    } catch {
        $bitmap = $null
    }
    if (-not $bitmap) {
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    }
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $width = [double]$srcW
    $height = [double]$srcH
    $lines = @()
    foreach ($line in $result.Lines) {
        $text = $line.Text
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        $rect = $null
        foreach ($word in $line.Words) {
            $r = $word.BoundingRect
            if ($null -eq $rect) {
                $rect = @{
                    left   = $r.X; top = $r.Y
                    right  = ($r.X + $r.Width); bottom = ($r.Y + $r.Height)
                }
            } else {
                $rect.left = [Math]::Min($rect.left, $r.X)
                $rect.top = [Math]::Min($rect.top, $r.Y)
                $rect.right = [Math]::Max($rect.right, $r.X + $r.Width)
                $rect.bottom = [Math]::Max($rect.bottom, $r.Y + $r.Height)
            }
        }
        if ($null -eq $rect) {
            $rect = @{ left = 0; top = 0; right = $width; bottom = $height }
        }
        $lines += @{
            text = $text
            box  = @{
                x = [Math]::Max(0.0, [Math]::Min(1.0, $rect.left / $width))
                y = [Math]::Max(0.0, [Math]::Min(1.0, 1.0 - $rect.bottom / $height))
                w = [Math]::Max(0.0, [Math]::Min(1.0, ($rect.right - $rect.left) / $width))
                h = [Math]::Max(0.0, [Math]::Min(1.0, ($rect.bottom - $rect.top) / $height))
            }
        }
    }

    Write-Payload @{ ok = $true; width = $width; height = $height; lines = $lines }
    exit 0
} catch {
    Fail 5 "ocr failed: $($_.Exception.Message)"
}
