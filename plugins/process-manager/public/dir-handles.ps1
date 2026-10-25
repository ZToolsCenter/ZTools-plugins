param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Path,
    [switch]$All
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "Directory not found: $Path"
}

$target = (Resolve-Path -LiteralPath $Path).Path
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Add-Type -TypeDefinition @"
#pragma warning disable 0649
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class HandleScan {
    [StructLayout(LayoutKind.Sequential)]
    struct SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX {
        public IntPtr Object;
        public IntPtr UniqueProcessId;
        public IntPtr HandleValue;
        public uint GrantedAccess;
        public ushort CreatorBackTraceIndex;
        public ushort ObjectTypeIndex;
        public uint HandleAttributes;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [DllImport("ntdll.dll")]
    static extern int NtQuerySystemInformation(int SystemInformationClass, IntPtr SystemInformation, int SystemInformationLength, out int ReturnLength);

    [DllImport("ntdll.dll")]
    static extern int NtQueryObject(IntPtr ObjectHandle, int ObjectInformationClass, IntPtr ObjectInformation, int ObjectInformationLength, out int ReturnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool DuplicateHandle(IntPtr hSourceProcessHandle, IntPtr hSourceHandle, IntPtr hTargetProcessHandle, out IntPtr lpTargetHandle, uint dwDesiredAccess, bool bInheritHandle, uint dwOptions);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(IntPtr hFile, StringBuilder lpszFilePath, uint cchFilePath, uint dwFlags);

    [DllImport("kernel32.dll")]
    static extern uint GetFileType(IntPtr hFile);

    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    const uint PROCESS_DUP_HANDLE = 0x0040;
    const uint DUPLICATE_SAME_ACCESS = 0x0002;
    const uint FILE_TYPE_DISK = 0x0001;
    const int SystemExtendedHandleInformation = 64;
    const int ObjectNameInformation = 1;

    static string GetObjectName(IntPtr handle) {
        int len = 4096;
        IntPtr buf = Marshal.AllocHGlobal(len);
        try {
            int needed;
            int st = NtQueryObject(handle, ObjectNameInformation, buf, len, out needed);
            if (st != 0) return null;
            var us = (UNICODE_STRING)Marshal.PtrToStructure(buf, typeof(UNICODE_STRING));
            if (us.Buffer == IntPtr.Zero || us.Length == 0) return null;
            return Marshal.PtrToStringUni(us.Buffer, us.Length / 2);
        } finally {
            Marshal.FreeHGlobal(buf);
        }
    }

    static bool Matches(string path, string target, string relative) {
        if (path == null) return false;
        return path.Equals(target, StringComparison.OrdinalIgnoreCase) ||
               path.StartsWith(target + "\\", StringComparison.OrdinalIgnoreCase) ||
               path.EndsWith(relative, StringComparison.OrdinalIgnoreCase) ||
               path.IndexOf(relative + "\\", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    public static List<string[]> Scan(string target, int[] pids) {
        var results = new List<string[]>();
        int len = 1024 * 1024;
        IntPtr buffer = IntPtr.Zero;
        int status;
        int needed;
        while (true) {
            buffer = Marshal.AllocHGlobal(len);
            status = NtQuerySystemInformation(SystemExtendedHandleInformation, buffer, len, out needed);
            if (status == 0) break;
            Marshal.FreeHGlobal(buffer);
            if (status != unchecked((int)0xC0000004)) {
                throw new Exception("NtQuerySystemInformation failed: 0x" + status.ToString("X8"));
            }
            len = Math.Max(needed + 65536, len * 2);
        }

        try {
            long count = Marshal.ReadIntPtr(buffer, 0).ToInt64();
            int entrySize = Marshal.SizeOf(typeof(SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX));
            IntPtr entries = IntPtr.Add(buffer, IntPtr.Size * 2);
            var wanted = pids != null && pids.Length > 0 ? new HashSet<int>(pids) : null;
            string normalizedTarget = target.TrimEnd('\\');
            string relative = normalizedTarget.Length >= 2 && normalizedTarget[1] == ':'
                ? normalizedTarget.Substring(2)
                : normalizedTarget;

            var byPid = new Dictionary<int, List<SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX>>();
            for (long i = 0; i < count; i++) {
                IntPtr entryPtr = IntPtr.Add(entries, (int)(i * entrySize));
                var entry = (SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX)Marshal.PtrToStructure(entryPtr, typeof(SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX));
                int pid = entry.UniqueProcessId.ToInt32();
                if (pid <= 4) continue;
                if (wanted != null && !wanted.Contains(pid)) continue;
                if (!byPid.ContainsKey(pid)) byPid[pid] = new List<SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX>();
                byPid[pid].Add(entry);
            }

            IntPtr current = GetCurrentProcess();
            foreach (var item in byPid) {
                int pid = item.Key;
                string pname = "";
                try { pname = Process.GetProcessById(pid).ProcessName; } catch { }

                IntPtr process = OpenProcess(PROCESS_DUP_HANDLE, false, pid);
                if (process == IntPtr.Zero) continue;

                try {
                    foreach (var entry in item.Value) {
                        IntPtr dup = IntPtr.Zero;
                        try {
                            if (!DuplicateHandle(process, entry.HandleValue, current, out dup, 0, false, DUPLICATE_SAME_ACCESS)) continue;
                            if (GetFileType(dup) != FILE_TYPE_DISK) continue;

                            var sb = new StringBuilder(32768);
                            uint n = GetFinalPathNameByHandleW(dup, sb, (uint)sb.Capacity, 0);
                            string path = null;
                            if (n > 0 && n < sb.Capacity) {
                                path = sb.ToString();
                                if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) {
                                    path = @"\\" + path.Substring(8);
                                } else if (path.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) {
                                    path = path.Substring(4);
                                }
                            }

                            bool matched = Matches(path, normalizedTarget, relative);
                            if (!matched) {
                                string objectName = GetObjectName(dup);
                                if (Matches(objectName, normalizedTarget, relative)) {
                                    matched = true;
                                    path = path == null ? objectName : path;
                                }
                            }

                            if (matched) {
                                results.Add(new[] {
                                    pid.ToString(),
                                    pname,
                                    "0x" + entry.HandleValue.ToInt64().ToString("X"),
                                    path ?? ""
                                });
                            }
                        } finally {
                            if (dup != IntPtr.Zero) CloseHandle(dup);
                        }
                    }
                } finally {
                    CloseHandle(process);
                }
            }
        } finally {
            Marshal.FreeHGlobal(buffer);
        }
        return results;
    }
}
"@

$pids = $null
$candidates = 0

if (-not $All) {
    $pattern = '^(explorer|cmd|powershell|pwsh|WindowsTerminal|conhost|bash|sh|Code|webstorm64?|idea64?|studio64?|java|node|pythonw?|nutstore|NTFSWatcher|OneDrive|Dropbox|BaiduNetdisk|ThemeStudio|zeus|Everything|devenv|cursor|windsurf|sublime_text|notepad\+\+|TotalCMD64|Far|rider64?|clion64?|pycharm64?|goland64?|phpstorm64?|rubymine64?|atom|electron|ztools|utools)$'
    $pids = @(Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match $pattern -and $_.Id -ne $PID } |
        Select-Object -ExpandProperty Id)
    $candidates = $pids.Count
    if ($candidates -eq 0) {
        $All = $true
    }
}

$allFlag = if ($All) { 1 } else { 0 }
Write-Output ("META`t{0}`t{1}`t{2}" -f ([int]$isAdmin), $allFlag, $candidates)
$results = [HandleScan]::Scan($target, $(if ($All) { $null } else { $pids }))

if ($results.Count -eq 0) {
    Write-Output "No handles found."
} else {
    Write-Output "PID`tProcess`tHandle`tPath"
    $seen = @{}
    $results | Sort-Object { $_[1] }, { $_[3] } | ForEach-Object {
        $key = "$($_[0])|$($_[3])"
        if (-not $seen.ContainsKey($key)) {
            $seen[$key] = $true
            Write-Output ($_ -join "`t")
        }
    }
}
