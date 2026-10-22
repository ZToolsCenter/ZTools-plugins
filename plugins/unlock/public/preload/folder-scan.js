/**
 * 文件夹占用扫描的纯工具：
 *   - Windows 路径比较
 *   - 目录枚举（有上限、跳过 reparse point）
 *   - 进程工作目录（PEB CurrentDirectory）扫描脚本
 *   - 重启管理器批量注册文件夹内文件
 *
 * 这里只负责构建脚本和解析输出，实际 spawn 在 unlock.js 中完成，便于单测。
 */

const fs = require('node:fs')
const path = require('node:path')

const MAX_FILES = 2000
const MAX_DIRS = 500
const MAX_DEPTH = 24
const RM_BATCH_SIZE = 64

function psLiteral(value) {
  return "'" + String(value == null ? '' : value).replace(/'/g, "''") + "'"
}

/** C# 字符串字面量（用于把路径嵌进内联源码）。 */
function csLiteral(value) {
  return '"' + String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/** 归一化 Windows 路径：去扩展前缀、统一反斜杠、转小写、去尾部分隔符。 */
function normalizeWinPath(value) {
  let s = String(value == null ? '' : value).trim()
  if (!s) return ''
  if (s.indexOf('\\\\?\\UNC\\') === 0) s = '\\\\' + s.slice(8)
  else if (s.indexOf('\\\\?\\') === 0) s = s.slice(4)
  else if (s.indexOf('\\??\\') === 0) s = s.slice(4)
  // 先保住 UNC 开头的两个斜杠，再合并重复分隔符
  let prefix = ''
  if (s.indexOf('\\\\') === 0) { prefix = '\\\\'; s = s.slice(2) }
  s = s.replace(/\//g, '\\').replace(/\\+/g, '\\').replace(/\\+$/, '')
  return (prefix + s).toLowerCase()
}

/** candidate 是否等于 dir 或位于 dir 之内（大小写不敏感）。 */
function isPathInsideWin(candidate, dir) {
  const c = normalizeWinPath(candidate)
  const d = normalizeWinPath(dir)
  if (!c || !d) return false
  return c === d || c.indexOf(d + '\\') === 0
}

/**
 * 递归枚举文件夹内的文件和目录。
 * 不跟随符号链接/junction；达到上限时 truncated=true。
 */
function collectFolderCandidates(folderPath, options) {
  const opts = options || {}
  const maxFiles = Number(opts.maxFiles) || MAX_FILES
  const maxDirs = Number(opts.maxDirs) || MAX_DIRS
  const maxDepth = Number(opts.maxDepth) || MAX_DEPTH

  const files = []
  const dirs = [folderPath]
  const errors = []
  let truncated = false
  const stack = [{ path: folderPath, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (current.depth > maxDepth) {
      truncated = true
      continue
    }
    let entries
    try {
      entries = fs.readdirSync(current.path, { withFileTypes: true })
    } catch (e) {
      errors.push({ path: current.path, error: e && e.code ? e.code : String(e && e.message ? e.message : e) })
      continue
    }
    entries.sort(function (a, b) { return a.name.localeCompare(b.name) })

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(current.path, entry.name)
      if (entry.isDirectory()) {
        try {
          if (fs.lstatSync(full).isSymbolicLink()) continue
        } catch (e) {
          errors.push({ path: full, error: e && e.code ? e.code : 'lstat failed' })
          continue
        }
        if (dirs.length > maxDirs) {
          truncated = true
          continue
        }
        dirs.push(full)
        stack.push({ path: full, depth: current.depth + 1 })
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) {
          truncated = true
          continue
        }
        files.push(full)
      }
    }
  }

  return { files: files, dirs: dirs, truncated: truncated, errors: errors }
}

/* ------------------------------------------------------------------ *
 * 工作目录扫描（读取 PEB CurrentDirectory）
 * ------------------------------------------------------------------ */

function buildCwdScanScript(excludePid, excludeCwd) {
  const exclude = Number(excludePid) || 0
  const excludeDir = csLiteral(excludeCwd || '')
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "Stop"',
    '',
    '$csCode = @\'',
    'using System;',
    'using System.Collections.Generic;',
    'using System.Diagnostics;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    '',
    'public class CwdScan {',
    '  [StructLayout(LayoutKind.Sequential)]',
    '  struct PROCESS_BASIC_INFORMATION {',
    '    public IntPtr Reserved1;',
    '    public IntPtr PebBaseAddress;',
    '    public IntPtr Reserved2_0;',
    '    public IntPtr Reserved2_1;',
    '    public IntPtr UniqueProcessId;',
    '    public IntPtr InheritedFromUniqueProcessId;',
    '  }',
    '',
    '  [DllImport("ntdll.dll")]',
    '  static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PROCESS_BASIC_INFORMATION info, int len, out int ret);',
    '  [DllImport("ntdll.dll")]',
    '  static extern int NtQueryInformationProcess(IntPtr h, int cls, out IntPtr info, int len, out int ret);',
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    '  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);',
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    '  static extern bool CloseHandle(IntPtr h);',
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    '  static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);',
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    '  static extern bool IsWow64Process(IntPtr h, out bool wow64);',
    '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    '  static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);',
    '',
    '  const uint QUERY = 0x1000;',
    '  const uint VM_READ = 0x0010;',
    '  const int ProcessBasicInformation = 0;',
    '  const int ProcessWow64Information = 26;',
    '',
    '  static bool ReadBytes(IntPtr h, long addr, byte[] buf) {',
    '    IntPtr read;',
    '    return ReadProcessMemory(h, new IntPtr(addr), buf, buf.Length, out read) && read.ToInt64() == buf.Length;',
    '  }',
    '',
    '  static bool ReadPtr(IntPtr h, long addr, int ptrSize, out long value) {',
    '    byte[] buf = new byte[ptrSize];',
    '    value = 0;',
    '    if (!ReadBytes(h, addr, buf)) return false;',
    '    value = ptrSize == 8 ? BitConverter.ToInt64(buf, 0) : (long)BitConverter.ToUInt32(buf, 0);',
    '    return true;',
    '  }',
    '',
    '  static string ReadUnicode(IntPtr h, long addr, int ptrSize) {',
    '    byte[] head = new byte[2];',
    '    if (!ReadBytes(h, addr, head)) return null;',
    '    int len = BitConverter.ToUInt16(head, 0);',
    '    if (len <= 0 || len > 0x10000 || (len & 1) != 0) return null;',
    '    long bufPtr;',
    '    if (!ReadPtr(h, addr + (ptrSize == 8 ? 8 : 4), ptrSize, out bufPtr) || bufPtr == 0) return null;',
    '    byte[] chars = new byte[len];',
    '    if (!ReadBytes(h, bufPtr, chars)) return null;',
    '    return Encoding.Unicode.GetString(chars);',
    '  }',
    '',
    '  /// 输出 ROW|pid|name|exe|cwd，最后一行 META|scanned|denied|wow64Skipped。',
    '  public static string[] Scan(int excludePid, string excludeCwd) {',
    '    List<string> rows = new List<string>();',
    '    int scanned = 0, denied = 0, wow64Skipped = 0;',
    '    bool self64 = IntPtr.Size == 8;',
    '    foreach (Process p in Process.GetProcesses()) {',
    '      int pid = 0;',
    '      IntPtr h = IntPtr.Zero;',
    '      try {',
    '        pid = p.Id;',
    '        if (pid <= 4 || pid == excludePid) continue;',
    '        h = OpenProcess(QUERY | VM_READ, false, pid);',
    '        if (h == IntPtr.Zero) { denied++; continue; }',
    '',
    '        PROCESS_BASIC_INFORMATION pbi = new PROCESS_BASIC_INFORMATION();',
    '        int ret;',
    '        int rv = NtQueryInformationProcess(h, ProcessBasicInformation, ref pbi, Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)), out ret);',
    '        if (rv != 0 || pbi.PebBaseAddress == IntPtr.Zero) { denied++; continue; }',
    '',
    '        bool wow64 = false;',
    '        try { IsWow64Process(h, out wow64); } catch { }',
    '',
    '        long peb = pbi.PebBaseAddress.ToInt64();',
    '        int ptrSize;',
    '        int paramsOffset;',
    '        int cwdOffset;',
    '        if (wow64) {',
    '          if (!self64) { wow64Skipped++; continue; }',
    '          IntPtr p32;',
    '          rv = NtQueryInformationProcess(h, ProcessWow64Information, out p32, IntPtr.Size, out ret);',
    '          if (rv != 0 || p32 == IntPtr.Zero) { wow64Skipped++; continue; }',
    '          peb = p32.ToInt64();',
    '          ptrSize = 4;',
    '          paramsOffset = 0x10;',
    '          cwdOffset = 0x24;',
    '        } else {',
    '          ptrSize = IntPtr.Size;',
    '          paramsOffset = ptrSize == 8 ? 0x20 : 0x10;',
    '          cwdOffset = ptrSize == 8 ? 0x38 : 0x24;',
    '        }',
    '',
    '        long parameters;',
    '        if (!ReadPtr(h, peb + paramsOffset, ptrSize, out parameters) || parameters == 0) { denied++; continue; }',
    '        string cwd = ReadUnicode(h, parameters + cwdOffset, ptrSize);',
    '        if (cwd == null) { denied++; continue; }',
    '        // 排除扫描辅助进程自身：它被特意启动在唯一临时目录里。',
    '        if (excludeCwd != null && excludeCwd.Length > 0 &&',
    '            string.Equals(cwd.TrimEnd(\'\\\\\'), excludeCwd.TrimEnd(\'\\\\\'), StringComparison.OrdinalIgnoreCase)) continue;',
    '',
    '        string name = "";',
    '        try { name = p.ProcessName + ".exe"; } catch { }',
    '        string exe = "";',
    '        try {',
    '          StringBuilder sb = new StringBuilder(1024);',
    '          int size = sb.Capacity;',
    '          if (QueryFullProcessImageName(h, 0, sb, ref size)) exe = sb.ToString();',
    '        } catch { }',
    '',
    '        scanned++;',
    '        rows.Add("ROW|" + pid + "|" + name + "|" + exe + "|" + cwd);',
    '      } catch {',
    '        denied++;',
    '      } finally {',
    '        if (h != IntPtr.Zero) CloseHandle(h);',
    '        p.Dispose();',
    '      }',
    '    }',
    '    rows.Add("META|" + scanned + "|" + denied + "|" + wow64Skipped);',
    '    return rows.ToArray();',
    '  }',
    '}',
    '\'@',
    '',
    'try {',
    '  Add-Type -TypeDefinition $csCode -ErrorAction Stop',
    '} catch {',
    '  [Console]::Error.WriteLine("CWD scan: " + $_.Exception.Message)',
    '  exit 1',
    '}',
    '',
    '[CwdScan]::Scan(' + exclude + ', ' + excludeDir + ')'
  ].join('\n')
}

function parseCwdScanOutput(raw) {
  const rows = []
  const meta = { scanned: 0, denied: 0, wow64Skipped: 0 }
  const lines = String(raw == null ? '' : raw).split(/\r?\n/)
  for (const line of lines) {
    const text = line.replace(/^﻿/, '').trim()
    if (!text) continue
    const parts = text.split('|')
    if (parts[0] === 'META') {
      meta.scanned = Number(parts[1]) || 0
      meta.denied = Number(parts[2]) || 0
      meta.wow64Skipped = Number(parts[3]) || 0
      continue
    }
    if (parts[0] !== 'ROW' || parts.length < 5) continue
    const pid = Number(parts[1]) || 0
    if (pid <= 0) continue
    rows.push({
      pid: pid,
      name: parts[2] || '',
      exePath: parts[3] || '',
      cwd: parts.slice(4).join('|')
    })
  }
  return { ok: true, rows: rows, scanned: meta.scanned, denied: meta.denied, wow64Skipped: meta.wow64Skipped }
}

function filterCwdHolders(rows, dir) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.pid <= 0 || !row.cwd) continue
    if (!isPathInsideWin(row.cwd, dir)) continue
    out.push({
      pid: row.pid,
      name: row.name || '',
      exePath: row.exePath || '',
      workingDir: row.cwd,
      detectSource: 'cwd',
      confidence: 'high',
      evidence: ['working-directory']
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 重启管理器：批量注册文件夹内的文件
 * ------------------------------------------------------------------ */

function buildFolderResourceManagerScript(manifestPath) {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "Stop"',
    '',
    '$manifest = ' + psLiteral(manifestPath),
    '$paths = @()',
    'if (Test-Path -LiteralPath $manifest) {',
    '  $raw = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8',
    '  if ($raw) { $paths = @($raw | ConvertFrom-Json) }',
    '}',
    'if ($paths.Count -eq 0) {',
    '  @{ holders = @(); registered = 0; failedBatches = 0; lastError = ""; helperPid = $PID } | ConvertTo-Json -Compress -Depth 5',
    '  exit 0',
    '}',
    '',
    '$csCode = @\'',
    'using System;',
    'using System.Collections.Generic;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    '',
    'public class FolderRestartManager {',
    '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]',
    '  public static extern int RmStartSession(out IntPtr pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);',
    '  [DllImport("rstrtmgr.dll")]',
    '  public static extern int RmEndSession(IntPtr pSessionHandle);',
    '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]',
    '  public static extern int RmRegisterResources(IntPtr pSessionHandle, uint nFiles, string[] rgsFileNames, uint nApplications, IntPtr rgApplications, uint nServices, IntPtr rgsServiceNames);',
    '  [DllImport("rstrtmgr.dll")]',
    '  public static extern int RmGetList(IntPtr pSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, IntPtr rgAffectedApps, out uint lpdwRebootReasons);',
    '',
    '  public struct RM_UNIQUE_PROCESS {',
    '    public uint dwProcessId;',
    '    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;',
    '  }',
    '',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
    '  public struct RM_PROCESS_INFO {',
    '    public RM_UNIQUE_PROCESS Process;',
    '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]',
    '    public string strAppName;',
    '    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]',
    '    public string strServiceShortName;',
    '    public int ApplicationType;',
    '    public uint AppStatus;',
    '    public uint TSSessionId;',
    '    [MarshalAs(UnmanagedType.Bool)]',
    '    public bool bRestartable;',
    '  }',
    '',
    '  public static int LastFailedBatches = 0;',
    '  public static string LastError = "";',
    '',
    '  public static string[] GetHoldersForFiles(string[] paths) {',
    '    LastFailedBatches = 0;',
    '    LastError = "";',
    '    List<string> rows = new List<string>();',
    '    HashSet<int> seen = new HashSet<int>();',
    '    for (int offset = 0; offset < paths.Length; offset += 64) {',
    '      int count = Math.Min(64, paths.Length - offset);',
    '      string[] batch = new string[count];',
    '      Array.Copy(paths, offset, batch, 0, count);',
    '      IntPtr session = IntPtr.Zero;',
    '      StringBuilder key = new StringBuilder(256);',
    '      int rv = RmStartSession(out session, 0, key);',
    '      if (rv != 0) { LastFailedBatches++; LastError = "RmStartSession failed: " + rv; continue; }',
    '      try {',
    '        rv = RmRegisterResources(session, (uint)batch.Length, batch, 0, IntPtr.Zero, 0, IntPtr.Zero);',
    '        if (rv != 0) { LastFailedBatches++; LastError = "RmRegisterResources failed: " + rv; continue; }',
    '        uint needed = 0;',
    '        uint have = 0;',
    '        uint reasons = 0;',
    '        rv = RmGetList(session, out needed, ref have, IntPtr.Zero, out reasons);',
    '        if (rv != 0 && rv != 234) { LastFailedBatches++; LastError = "RmGetList failed: " + rv; continue; }',
    '        if (needed == 0) continue;',
    '        int size = Marshal.SizeOf(typeof(RM_PROCESS_INFO));',
    '        IntPtr buffer = Marshal.AllocHGlobal(size * (int)needed);',
    '        try {',
    '          have = needed;',
    '          rv = RmGetList(session, out needed, ref have, buffer, out reasons);',
    '          if (rv != 0) { LastFailedBatches++; LastError = "RmGetList failed: " + rv; continue; }',
    '          for (int i = 0; i < have; i++) {',
    '            IntPtr at = new IntPtr(buffer.ToInt64() + (long)size * i);',
    '            RM_PROCESS_INFO info = (RM_PROCESS_INFO)Marshal.PtrToStructure(at, typeof(RM_PROCESS_INFO));',
    '            int pid = (int)info.Process.dwProcessId;',
    '            if (pid <= 0 || !seen.Add(pid)) continue;',
    '            rows.Add(pid + "|" + (info.strAppName == null ? "" : info.strAppName) + "|" + (info.strServiceShortName == null ? "" : info.strServiceShortName));',
    '          }',
    '        } finally {',
    '          Marshal.FreeHGlobal(buffer);',
    '        }',
    '      } finally {',
    '        RmEndSession(session);',
    '      }',
    '    }',
    '    return rows.ToArray();',
    '  }',
    '}',
    '\'@',
    '',
    'try {',
    '  Add-Type -TypeDefinition $csCode -ErrorAction Stop',
    '} catch {',
    '  [Console]::Error.WriteLine("Folder Restart Manager: " + $_.Exception.Message)',
    '  exit 1',
    '}',
    '',
    '$results = @()',
    'foreach ($row in [FolderRestartManager]::GetHoldersForFiles([string[]]$paths)) {',
    '  $parts = $row -split "\\|"',
    '  $holderPid = [int]$parts[0]',
    '  $appName = ""',
    '  if ($parts.Length -gt 1) { $appName = [string]$parts[1] }',
    '  $serviceName = ""',
    '  if ($parts.Length -gt 2) { $serviceName = [string]$parts[2] }',
    '  $procName = ""',
    '  $exePath = ""',
    '  $proc = Get-Process -Id $holderPid -ErrorAction SilentlyContinue',
    '  if ($proc) {',
    '    try { $exePath = $proc.Path } catch { }',
    '    if ($proc.ProcessName) { $procName = $proc.ProcessName + ".exe" }',
    '  }',
    '  if (-not $exePath) {',
    '    try {',
    '      $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $holderPid" -ErrorAction SilentlyContinue',
    '      if ($cim) {',
    '        $exePath = [string]$cim.ExecutablePath',
    '        if (-not $procName -and $cim.Name) { $procName = [string]$cim.Name }',
    '      }',
    '    } catch { }',
    '  }',
    '  if ($exePath) { $procName = Split-Path -Leaf $exePath }',
    '  if (-not $procName) { $procName = $appName }',
    '  $results += @{ pid = $holderPid; name = $procName; exePath = $exePath; service = $serviceName }',
    '}',
    '',
    '@{',
    '  holders = @($results)',
    '  registered = $paths.Count',
    '  failedBatches = [FolderRestartManager]::LastFailedBatches',
    '  lastError = [FolderRestartManager]::LastError',
    '  helperPid = $PID',
    '} | ConvertTo-Json -Compress -Depth 5'
  ].join('\n')
}

function parseFolderRmOutput(raw) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').trim()
  if (!text || text === 'null' || text === '[]') {
    return { ok: true, holders: [], registered: 0, failedBatches: 0, lastError: '', helperPid: 0 }
  }
  try {
    const parsed = JSON.parse(text)
    const list = Array.isArray(parsed.holders) ? parsed.holders : []
    const holders = list.map(function (p) {
      return {
        pid: Number(p.pid) || 0,
        name: String(p.name || ''),
        exePath: String(p.exePath || ''),
        service: String(p.service || ''),
        detectSource: 'resourcemanager-child',
        confidence: 'high',
        evidence: ['child-file']
      }
    }).filter(function (p) { return p.pid > 0 })
    return {
      ok: true,
      holders: holders,
      registered: Number(parsed.registered) || 0,
      failedBatches: Number(parsed.failedBatches) || 0,
      lastError: String(parsed.lastError || ''),
      helperPid: Number(parsed.helperPid) || 0
    }
  } catch (e) {
    return { ok: false, holders: [], registered: 0, failedBatches: 0, lastError: '解析失败: ' + e.message, helperPid: 0 }
  }
}

module.exports = {
  MAX_FILES,
  MAX_DIRS,
  MAX_DEPTH,
  RM_BATCH_SIZE,
  psLiteral,
  normalizeWinPath,
  isPathInsideWin,
  collectFolderCandidates,
  buildCwdScanScript,
  parseCwdScanOutput,
  filterCwdHolders,
  buildFolderResourceManagerScript,
  parseFolderRmOutput
}
