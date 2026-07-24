$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Top {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TOPMOST = 0x00000008;
    public const uint SWP_NOSIZE  = 0x0001;
    public const uint SWP_NOMOVE  = 0x0002;
    public static readonly IntPtr HWND_TOPMOST    = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST  = new IntPtr(-2);

    public static string GetTitle(IntPtr hwnd) {
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }
}
'@
try { Add-Type -TypeDefinition $code -ErrorAction Stop } catch {}

$hwnd = [Win32Top]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output "NoWindow||"
    exit
}

$windowTitle = [Win32Top]::GetTitle($hwnd)
if ([string]::IsNullOrWhiteSpace($windowTitle)) {
    $windowTitle = "(unnamed)"
}

$exStyle = [Win32Top]::GetWindowLong($hwnd, [Win32Top]::GWL_EXSTYLE)
$flags   = [Win32Top]::SWP_NOSIZE -bor [Win32Top]::SWP_NOMOVE

if (($exStyle -band [Win32Top]::WS_EX_TOPMOST) -eq [Win32Top]::WS_EX_TOPMOST) {
    [Win32Top]::SetWindowPos($hwnd, [Win32Top]::HWND_NOTOPMOST, 0, 0, 0, 0, $flags) | Out-Null
    Write-Output "Unpinned||$windowTitle"
} else {
    [Win32Top]::SetWindowPos($hwnd, [Win32Top]::HWND_TOPMOST, 0, 0, 0, 0, $flags) | Out-Null
    Write-Output "Pinned||$windowTitle"
}
