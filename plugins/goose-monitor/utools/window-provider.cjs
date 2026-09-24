const { execFile } = require("node:child_process");

const MAC_JXA = String.raw`
ObjC.import('Cocoa');
function run() {
  const options = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;
  const raw = $.CGWindowListCopyWindowInfo(options, $.kCGNullWindowID);
  const pids = [];
  const count = Number($.CFArrayGetCount(raw));
  for (let index = 0; index < count; index++) {
    const window = ObjC.castRefToObject($.CFArrayGetValueAtIndex(raw, index));
    const pid = Number(window.objectForKey($('kCGWindowOwnerPID')).js);
    const layer = Number(window.objectForKey($('kCGWindowLayer')).js);
    const alpha = Number(window.objectForKey($('kCGWindowAlpha')).js);
    const bounds = ObjC.deepUnwrap(window.objectForKey($('kCGWindowBounds'))) || {};
    if (Number.isInteger(pid) && pid > 0 && layer === 0 && alpha > 0 &&
        Number(bounds.Width) > 1 && Number(bounds.Height) > 1) pids.push(pid);
  }
  return JSON.stringify([...new Set(pids)]);
}`;

const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class GooseVisibleWindows {
  const int DWMWA_CLOAKED = 14;
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);
  public static uint[] GetPids() {
    var found = new HashSet<uint>();
    EnumWindows((hWnd, _) => {
      if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;
      RECT r; if (!GetWindowRect(hWnd, out r) || r.Right-r.Left <= 1 || r.Bottom-r.Top <= 1) return true;
      int cloaked = 0; if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
      uint pid; GetWindowThreadProcessId(hWnd, out pid); if (pid > 0) found.Add(pid);
      return true;
    }, IntPtr.Zero);
    var result = new uint[found.Count]; found.CopyTo(result); return result;
  }
}
'@
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[GooseVisibleWindows]::GetPids() | ConvertTo-Json -Compress
`;

function parsePidJson(text) {
  const value = JSON.parse(String(text || "null"));
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(list.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))];
}

function run(execFileImpl, command, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

async function getVisibleWindowPids(platform = process.platform, execFileImpl = execFile) {
  if (platform === "darwin") {
    const stdout = await run(execFileImpl, "/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_JXA], {
      encoding: "utf8", timeout: 2000, maxBuffer: 2 * 1024 * 1024,
    });
    return parsePidJson(stdout);
  }
  if (platform === "win32") {
    const stdout = await run(execFileImpl, "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT], {
      encoding: "utf8", timeout: 3000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    return parsePidJson(stdout);
  }
  const error = new Error("visible windows unsupported on this platform");
  error.code = "UNSUPPORTED";
  throw error;
}

module.exports = { MAC_JXA, WINDOWS_SCRIPT, parsePidJson, getVisibleWindowPids };
