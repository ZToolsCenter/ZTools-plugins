param (
    [int]$HoldDurationMs = 500
)

$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MouseHookNative {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);
}
"@

$VK_MBUTTON = 0x04
$pressing = $false
$pressStartTime = 0

while ($true) {
    Start-Sleep -Milliseconds 25
    $state = [MouseHookNative]::GetAsyncKeyState($VK_MBUTTON)
    $isDown = ($state -band 0x8000) -ne 0
    if ($isDown) {
        $now = [Environment]::TickCount
        if (-not $pressing) {
            $pressing = $true
            $pressStartTime = $now
        } else {
            $elapsed = $now - $pressStartTime
            if ($elapsed -lt 0) { $elapsed = $elapsed + [int]::MaxValue }
            if ($elapsed -ge $HoldDurationMs) {
                $point = New-Object MouseHookNative+POINT
                [MouseHookNative]::GetCursorPos([ref]$point) | Out-Null
                Write-Output "TRIGGER $($point.X),$($point.Y)"
                [Console]::Out.Flush()
                while ($true) {
                    Start-Sleep -Milliseconds 40
                    $curState = [MouseHookNative]::GetAsyncKeyState($VK_MBUTTON)
                    if (($curState -band 0x8000) -eq 0) { break }
                }
                $pressing = $false
            }
        }
    } else {
        $pressing = $false
    }
}
