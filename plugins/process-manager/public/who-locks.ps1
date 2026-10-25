param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,
    [switch]$Recurse,
    [int]$MaxFiles = 500
)

if (-not (Test-Path -LiteralPath $Path)) {
    throw "Path not found: $Path"
}

if ($MaxFiles -lt 1) {
    $MaxFiles = 500
}

$item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
$isDirectory = $item.PSIsContainer
$kind = if ($isDirectory) { 'directory' } else { 'file' }
$scanned = 0
$truncated = $false
$paths = @()

if ($isDirectory) {
    $files = @(Get-ChildItem -LiteralPath $Path -File -Force -Recurse:$Recurse -ErrorAction SilentlyContinue |
        Select-Object -First ($MaxFiles + 1))
    $truncated = $files.Count -gt $MaxFiles
    if ($truncated) {
        $files = $files[0..($MaxFiles - 1)]
    }
    $paths = @($files | ForEach-Object { $_.FullName })
    $scanned = $paths.Count
} else {
    $paths = @($item.FullName)
    $scanned = 1
}

if ($scanned -eq 0) {
    Write-Output ("META`t{0}`t0`t0" -f $kind)
    Write-Output "No process is locking: $($item.FullName)"
    exit 0
}

Add-Type -TypeDefinition @"
#pragma warning disable 0649
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class FileLock {
    [StructLayout(LayoutKind.Sequential)]
    struct RM_UNIQUE_PROCESS {
        public int dwProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    const int CCH_RM_MAX_APP_NAME = 255;
    const int CCH_RM_MAX_SVC_NAME = 63;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
        public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
        public string strServiceShortName;
        public int ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bRestartable;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint pSessionHandle);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    static extern int RmRegisterResources(
        uint pSessionHandle,
        uint nFiles,
        string[] rgsFilenames,
        uint nApplications,
        [In] RM_UNIQUE_PROCESS[] rgApplications,
        uint nServices,
        string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(
        uint dwSessionHandle,
        out uint pnProcInfoNeeded,
        ref uint pnProcInfo,
        [In, Out] RM_PROCESS_INFO[] rgAffectedApps,
        ref uint lpdwRebootReasons);

    public static List<string> Who(string[] paths) {
        var result = new List<string>();
        uint handle;
        int rc = RmStartSession(out handle, 0, Guid.NewGuid().ToString());
        if (rc != 0) {
            result.Add("RmStartSession failed: " + rc);
            return result;
        }
        try {
            rc = RmRegisterResources(handle, (uint)paths.Length, paths, 0, null, 0, null);
            if (rc != 0) {
                result.Add("RmRegisterResources failed: " + rc);
                return result;
            }

            uint needed = 0, count = 0, reason = 0;
            rc = RmGetList(handle, out needed, ref count, null, ref reason);
            if (rc == 234 && needed > 0) {          // ERROR_MORE_DATA
                var info = new RM_PROCESS_INFO[needed];
                count = needed;
                rc = RmGetList(handle, out needed, ref count, info, ref reason);
                if (rc != 0) {
                    result.Add("RmGetList failed: " + rc);
                    return result;
                }
                for (int i = 0; i < count; i++) {
                    string name = info[i].strAppName;
                    if (string.IsNullOrEmpty(name)) {
                        name = info[i].strServiceShortName;
                    }
                    result.Add(info[i].Process.dwProcessId + "\t" + name + "\t" + info[i].strServiceShortName + "\t" + info[i].ApplicationType);
                }
            } else if (rc != 0) {
                result.Add("RmGetList failed: " + rc);
            }
        } finally {
            RmEndSession(handle);
        }
        return result;
    }
}
"@

Write-Output ("META`t{0}`t{1}`t{2}" -f $kind, $scanned, [int]$truncated)
$holders = [FileLock]::Who($paths)

if ($holders.Count -eq 0) {
    Write-Output "No process is locking: $($item.FullName)"
} else {
    Write-Output "PID`tProcess`tService`tType"
    $holders | ForEach-Object { Write-Output $_ }
}
