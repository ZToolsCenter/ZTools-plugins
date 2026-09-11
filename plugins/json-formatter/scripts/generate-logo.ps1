$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\public'
$outputPath = Join-Path $outputDirectory 'logo.png'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Rectangle 0, 0, 256, 256),
  ([System.Drawing.Color]::FromArgb(102, 82, 224)),
  ([System.Drawing.Color]::FromArgb(51, 165, 133)),
  45
)
$graphics.FillRectangle($background, 0, 0, 256, 256)

$glass = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(32, 255, 255, 255))
$graphics.FillEllipse($glass, 134, -54, 190, 190)
$graphics.FillEllipse($glass, -70, 166, 170, 170)

$font = New-Object System.Drawing.Font('Consolas', 86, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel))
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('{ }', $font, $textBrush, (New-Object System.Drawing.RectangleF 0, 0, 256, 250), $format)

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$format.Dispose(); $textBrush.Dispose(); $font.Dispose(); $glass.Dispose(); $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
Write-Output "Created $outputPath"
