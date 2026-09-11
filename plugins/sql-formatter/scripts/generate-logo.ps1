Add-Type -AssemblyName System.Drawing

$outputPath = Join-Path $PSScriptRoot '..\public\logo.png'
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(21, 111, 91))
$cream = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(246, 241, 229))
$goldPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(218, 174, 86), 12)
$goldPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$goldPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

$graphics.FillRectangle($background, 0, 0, 256, 256)
$graphics.FillEllipse($cream, 54, 48, 148, 52)
$graphics.FillRectangle($cream, 54, 74, 148, 106)
$graphics.FillEllipse($cream, 54, 154, 148, 52)
$graphics.DrawArc($goldPen, 75, 91, 106, 42, 0, 180)
$graphics.DrawArc($goldPen, 75, 126, 106, 42, 0, 180)

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$goldPen.Dispose()
$cream.Dispose()
$background.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
