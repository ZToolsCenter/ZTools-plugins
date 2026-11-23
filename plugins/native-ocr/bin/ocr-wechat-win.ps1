# WeChat OCR for the native-ocr ZTools plugin (Windows only).
#
# WHY THIS EXISTS: on macOS the plugin downloads a bundled WeChat OCR runtime
# (libwxocr.dylib + models). No Windows build of that native addon is published,
# so on Windows we call the WeChat desktop client's own wxocr.dll directly via
# P/Invoke -- no node-gyp, no MSVC, no Python.
#
# REQUIREMENT: WeChat 4.x must be installed on this machine. wxocr.dll ships
# inside the WeChat plugin directory; we do not redistribute it.
#
# ABI (from the official addon source, Windows branch):
#   bool __cdecl wechat_ocr(const wchar_t *ocrExe, const wchar_t *wechatDir,
#                           const char *imagePath, void(__cdecl *cb)(const char *));
#   void __cdecl stop_ocr();
#
# OUTPUT CONTRACT (single line on stdout, ASCII only):
#   NOCR1:<base64 of UTF-8 JSON>
#   probe: { "ok": true, "available": bool, "reason": str, "wxocrDll": str, "wechatDir": str }
#   ocr:   { "ok": true, "raw": "<base64 of the raw callback bytes>", "width": int, "height": int }
#   fail:  { "ok": false, "code": int, "message": str }
#
# The raw WeChat JSON is NOT parsed here: its shape varies between WeChat
# versions and PowerShell-side string handling cannot be unit tested. We only
# transport the bytes; public/wechat-result.cjs does the tolerant parsing.
# Base64 keeps the transport immune to the console code page (see the fix in
# 1.1.1 -- 936/950/932/1252 all produce identical bytes).
# This file is deliberately pure ASCII: PowerShell 5.1 reads BOM-less UTF-8
# files using the system ANSI code page.
#
# Exit codes: 0 ok / 2 bad args / 3 image missing / 6 wechat not found
#             7 native load failed / 8 ocr call failed / 9 result too large

param(
    [string]$ImagePath = "",
    [switch]$Probe
)

$ErrorActionPreference = 'Stop'

$scriptVersion = "1.0.0"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
try { [Console]::ErrorEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Write-Payload($payload) {
    $json = $payload | ConvertTo-Json -Compress -Depth 6
    $b64 = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    [Console]::Out.Write("NOCR1:$b64`r`n")
    [Console]::Out.Flush()
}

function Fail($code, $message) {
    try { [Console]::Error.WriteLine("[wcocr-$scriptVersion] $message") } catch {}
    try { Write-Payload @{ ok = $false; code = $code; message = $message } } catch {}
    exit $code
}

# ---------------------------------------------------------------------------
# Locate WeChat 4.x
# ---------------------------------------------------------------------------

# wxocr.dll lives under the WeChat plugin data directory, one folder per build.
# Newest build wins; we never execute it, only LoadLibrary it.
function Find-WxOcrDll {
    $roots = @()
    if ($env:APPDATA) { $roots += $env:APPDATA }
    if ($env:LOCALAPPDATA) { $roots += $env:LOCALAPPDATA }
    foreach ($root in $roots) {
        foreach ($plugin in @('Tencent\xwechat\XPlugin\plugins\WeChatOcr', 'Tencent\WeChat\XPlugin\plugins\WeChatOcr')) {
            $base = Join-Path $root $plugin
            if (-not (Test-Path -LiteralPath $base)) { continue }
            $versions = Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue |
                Sort-Object -Property Name -Descending
            foreach ($version in $versions) {
                $dll = Join-Path $version.FullName 'extracted\wxocr.dll'
                if (Test-Path -LiteralPath $dll) { return $dll }
            }
        }
    }
    return ""
}

# wechat_ocr() also takes the client install directory (used by wxocr.dll to
# resolve its own dependencies), so we look for the client executable.
function Find-WeChatDir {
    $roots = @()
    if ($env:ProgramW6432) { $roots += $env:ProgramW6432 }
    if ($env:ProgramFiles) { $roots += $env:ProgramFiles }
    if (${env:ProgramFiles(x86)}) { $roots += ${env:ProgramFiles(x86)} }
    foreach ($root in $roots) {
        foreach ($name in @('Tencent\Weixin', 'Tencent\WeChat')) {
            $base = Join-Path $root $name
            if (-not (Test-Path -LiteralPath $base)) { continue }
            foreach ($exe in @('Weixin.exe', 'WeChat.exe')) {
                $found = Get-ChildItem -LiteralPath $base -Filter $exe -Recurse -Depth 3 -ErrorAction SilentlyContinue |
                    Sort-Object -Property FullName -Descending |
                    Select-Object -First 1
                if ($found) { return $found.DirectoryName }
            }
        }
    }
    return ""
}

# ---------------------------------------------------------------------------
# P/Invoke bridge
# ---------------------------------------------------------------------------

$nativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WcOcrNative
{
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr LoadLibraryW(string fileName);

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern IntPtr GetProcAddress(IntPtr module, string procName);

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool SetDllDirectoryW(string path);

    [DllImport("kernel32", SetLastError = true)]
    public static extern bool FreeLibrary(IntPtr module);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void ResultCallback(IntPtr text);

    // Static fields instead of script-scope variables: the callback may be invoked
    // from a native worker thread, where PowerShell $script: scope is unreliable.
    public static volatile bool CallbackInvoked;
    public static byte[] ResultBytes;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate bool WechatOcrFn(IntPtr ocrExe, IntPtr wechatDir, IntPtr imagePath, IntPtr callback);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void StopOcrFn();

    // Copy the NUL-terminated byte string out of unmanaged memory as raw bytes.
    // The encoding is unknown (UTF-8 for newer builds, ANSI/GBK is possible), so
    // we must not decode here -- Node decides with a UTF-8-strict-then-GBK rule.
    public static byte[] BytesFromPtr(IntPtr ptr)
    {
        if (ptr == IntPtr.Zero) { return null; }
        int length = 0;
        while (Marshal.ReadByte(ptr, length) != 0) { length++; }
        byte[] buffer = new byte[length];
        if (length > 0) { Marshal.Copy(ptr, buffer, 0, length); }
        return buffer;
    }

    public static IntPtr AllocUtf16(string value)
    {
        return Marshal.StringToHGlobalUni(value);
    }

    public static IntPtr AllocUtf8(string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        IntPtr ptr = Marshal.AllocHGlobal(bytes.Length + 1);
        Marshal.Copy(bytes, 0, ptr, bytes.Length);
        Marshal.WriteByte(ptr, bytes.Length, 0);
        return ptr;
    }

    public static string LastError()
    {
        return Marshal.GetLastWin32Error().ToString();
    }
}
'@

function Get-WxOcrState {
    $dll = Find-WxOcrDll
    $dir = Find-WeChatDir
    # Machine-readable reason code; the Chinese wording lives in preload.js so
    # this file can stay pure ASCII (see the header note).
    $reasonCode = "ok"
    $detail = ""
    if (-not $dll) {
        $reasonCode = "wxocr-dll-missing"
        $detail = "wxocr.dll not found under %APPDATA%\\Tencent\\xwechat\\XPlugin\\plugins\\WeChatOcr"
    } elseif (-not $dir) {
        $reasonCode = "wechat-dir-missing"
        $detail = "Weixin.exe not found under Program Files\\Tencent"
    }
    return @{
        wxocrDll = $dll
        wechatDir = $dir
        available = [bool]($dll -and $dir)
        reasonCode = $reasonCode
        detail = $detail
    }
}

if ($Probe) {
    $state = Get-WxOcrState
    Write-Payload @{
        ok = $true
        available = $state.available
        reasonCode = $state.reasonCode
        detail = $state.detail
        wxocrDll = $state.wxocrDll
        wechatDir = $state.wechatDir
    }
    exit 0
}

if (-not $ImagePath) { Fail 2 "ImagePath is required" }
if (-not (Test-Path -LiteralPath $ImagePath)) { Fail 3 "image not found: $ImagePath" }

$state = Get-WxOcrState
if (-not $state.available) { Fail 6 ($state.reasonCode + ":" + $state.detail) }

# Image size is needed to normalize the boxes; wxocr does not return it.
$width = 0
$height = 0
try {
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $image = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $ImagePath).Path)
    try {
        $width = [int]$image.Width
        $height = [int]$image.Height
    } finally {
        $image.Dispose()
    }
} catch {
    # Non-fatal: the Node side falls back to deriving size from the boxes.
}

try {
    Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop
} catch {
    # Re-running in the same host can hit "type already exists"; that is fine.
    if (-not ([System.Management.Automation.PSTypeName]'WcOcrNative').Type) {
        Fail 7 ("failed to load P/Invoke bridge: " + $_.Exception.Message)
    }
}

# Make wxocr.dll's own dependencies resolvable before loading it.
try { [void][WcOcrNative]::SetDllDirectoryW($state.wechatDir) } catch {}

$module = [WcOcrNative]::LoadLibraryW($state.wxocrDll)
if ($module -eq [IntPtr]::Zero) {
    Fail 7 ("LoadLibraryW failed for wxocr.dll (win32 error " + [WcOcrNative]::LastError() + ")")
}

$procOcr = [WcOcrNative]::GetProcAddress($module, "wechat_ocr")
$procStop = [WcOcrNative]::GetProcAddress($module, "stop_ocr")
if ($procOcr -eq [IntPtr]::Zero) {
    Fail 7 "wxocr.dll does not export wechat_ocr (unsupported WeChat version)"
}

# Callback captures raw bytes; script scope keeps the delegate alive so the GC
# cannot collect it while native code still holds the function pointer.
[WcOcrNative]::ResultBytes = $null
[WcOcrNative]::CallbackInvoked = $false
$resultCallback = [WcOcrNative+ResultCallback]{
    param([IntPtr]$text)
    [WcOcrNative]::CallbackInvoked = $true
    [WcOcrNative]::ResultBytes = [WcOcrNative]::BytesFromPtr($text)
}

$wechatOcr = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer(
    $procOcr, [WcOcrNative+WechatOcrFn])

$ptrOcrExe = [WcOcrNative]::AllocUtf16($state.wxocrDll)
$ptrWechatDir = [WcOcrNative]::AllocUtf16($state.wechatDir)
$ptrImage = [WcOcrNative]::AllocUtf8((Resolve-Path -LiteralPath $ImagePath).Path)

try {
    $called = $wechatOcr.Invoke($ptrOcrExe, $ptrWechatDir, $ptrImage, $resultCallback)
    # The official addon reads the result right after the call, i.e. it is
    # synchronous. Some builds hand the work to a worker thread, so give the
    # callback a bounded window to arrive before declaring failure.
    if (-not [WcOcrNative]::CallbackInvoked) {
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while (-not [WcOcrNative]::CallbackInvoked -and [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 100
        }
    }
    [GC]::KeepAlive($resultCallback)
    if (-not $called) { Fail 8 "wechat_ocr returned false" }
    if (-not [WcOcrNative]::CallbackInvoked) { Fail 8 "wechat_ocr did not invoke the result callback within 15s" }
    if ($null -eq [WcOcrNative]::ResultBytes -or [WcOcrNative]::ResultBytes.Length -eq 0) {
        Fail 8 "wechat_ocr returned an empty result"
    }
    if ([WcOcrNative]::ResultBytes.Length -gt 8MB) { Fail 9 "result too large" }

    $rawB64 = [System.Convert]::ToBase64String([WcOcrNative]::ResultBytes)
    Write-Payload @{ ok = $true; raw = $rawB64; width = $width; height = $height }
    exit 0
} catch {
    Fail 8 "ocr failed: $($_.Exception.Message)"
} finally {
    try { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrOcrExe) } catch {}
    try { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrWechatDir) } catch {}
    try { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptrImage) } catch {}
    if ($procStop -ne [IntPtr]::Zero) {
        try {
            $stopOcr = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer(
                $procStop, [WcOcrNative+StopOcrFn])
            $stopOcr.Invoke()
        } catch {}
    }
    try { [void][WcOcrNative]::FreeLibrary($module) } catch {}
}
