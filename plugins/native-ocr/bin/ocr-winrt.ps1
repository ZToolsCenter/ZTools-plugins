# Windows system OCR (WinRT Windows.Media.Ocr) for the native-ocr ZTools plugin.
# macOS equivalent of ocr-vision.swift. Runs on built-in PowerShell 5.1+ with
# zero dependencies. Output contract (stdout, single JSON line):
#   { "width": int, "height": int, "lines": [ { "text": str,
#       "box": { "x","y","w","h" } } ] }
# Box convention matches the macOS Vision engine: normalized to [0,1] with
# the origin at the image's lower-left corner (y measured from the bottom).
# Exit codes: 0 ok / 2 bad args / 4 engine unavailable / 5 ocr failed

param(
    [Parameter(Mandatory = $true)][string]$ImagePath
)

$ErrorActionPreference = 'Stop'

$scriptVersion = "0.6.10"

# Emit stdout/stderr as UTF-8 so the Node side decodes Chinese messages correctly.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

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
    [Console]::Error.WriteLine("[winrt-$scriptVersion] $message")
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
    # PowerShell 的 byte[] 不能直接匹配 IBuffer 重载，需转成 IBuffer。
    # 任何失败都回退到原始不放大路径，保证 OCR 始终可用。
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

    $payload = @{ width = $width; height = $height; lines = $lines }
    [Console]::Out.Write(($payload | ConvertTo-Json -Compress -Depth 5))
    exit 0
} catch {
    Fail 5 "ocr failed: $($_.Exception.Message)"
}
