# List visible top-level window titles, optionally filtered by -Match.
# Used by test/preload.test.js to prove a console window really appeared:
# tasklist / taskkill WINDOWTITLE filters cannot see console windows hosted by
# Windows Terminal, while EnumWindows can.
# ASCII-only: Windows PowerShell 5.1 decodes BOM-less files with the ANSI code page.
param(
  [string]$Match = '*'
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DshWindowProbe {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

$titles = New-Object System.Collections.ArrayList
$callback = [DshWindowProbe+EnumProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  $buffer = New-Object System.Text.StringBuilder 512
  [void][DshWindowProbe]::GetWindowText($hWnd, $buffer, 512)
  $title = $buffer.ToString()
  if ($title -and [DshWindowProbe]::IsWindowVisible($hWnd) -and $title -like $Match) {
    [void]$titles.Add($title)
  }
  return $true
}

[void][DshWindowProbe]::EnumWindows($callback, [IntPtr]::Zero)
$titles | Sort-Object -Unique | ForEach-Object { Write-Output $_ }
