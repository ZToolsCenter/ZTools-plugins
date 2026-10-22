/**
 * 文件夹删除权限探测。
 *
 * 只以 DELETE 权限打开目录/文件并立即关闭，不会删除任何内容。
 * 目的是回答两个问题：
 *   1. 文件夹现在是否真的不可删除（有进程以不共享删除的方式持有它/内部条目）；
 *   2. 结束进程后，占用是否已经解除。
 */

const MAX_ENTRIES = 5000
const TIME_BUDGET_MS = 4000

function psLiteral(value) {
  return "'" + String(value == null ? '' : value).replace(/'/g, "''") + "'"
}

function buildFolderProbeScript(folderPath) {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    '$ErrorActionPreference = "Stop"',
    '$path = ' + psLiteral(folderPath),
    '',
    '$csCode = @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    '',
    'public class FolderProbe {',
    '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    '  static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);',
    '  [DllImport("kernel32.dll", SetLastError = true)]',
    '  static extern bool CloseHandle(IntPtr hObject);',
    '',
    '  const uint DELETE = 0x00010000;',
    '  const uint SHARE_ALL = 0x00000001 | 0x00000002 | 0x00000004;',
    '  const uint OPEN_EXISTING = 3;',
    '  const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;',
    '',
    '  /// 返回 0 表示可以删除；否则返回 Win32 错误码。',
    '  public static int Probe(string path) {',
    '    IntPtr h = CreateFileW(path, DELETE, SHARE_ALL, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero);',
    '    if (h == new IntPtr(-1)) return Marshal.GetLastWin32Error();',
    '    CloseHandle(h);',
    '    return 0;',
    '  }',
    '}',
    '\'@',
    '',
    'Add-Type -TypeDefinition $csCode -ErrorAction Stop',
    '',
    '$locked = 0',
    '$denied = 0',
    '$other = 0',
    '$checked = 0',
    '$truncated = $false',
    '$deadline = [DateTime]::UtcNow.AddMilliseconds(' + TIME_BUDGET_MS + ')',
    '$stack = New-Object System.Collections.Stack',
    '$stack.Push($path)',
    '',
    'while ($stack.Count -gt 0) {',
    '  if ([DateTime]::UtcNow -gt $deadline -or $checked -ge ' + MAX_ENTRIES + ') { $truncated = $true; break }',
    '  $cur = [string]$stack.Pop()',
    '  try {',
    '    $code = [FolderProbe]::Probe($cur)',
    '    $checked++',
    '    if ($code -eq 0) { }',
    '    elseif ($code -eq 32 -or $code -eq 33) { $locked++ }',
    '    elseif ($code -eq 5) { $denied++ }',
    '    elseif ($code -eq 2 -or $code -eq 3) { }',
    '    else { $other++ }',
    '  } catch { $other++ }',
    '',
    '  if ([System.IO.Directory]::Exists($cur)) {',
    '    try {',
    '      foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($cur)) {',
    '        try {',
    '          $attr = [System.IO.File]::GetAttributes($entry)',
    '          if (($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }',
    '          $stack.Push($entry)',
    '        } catch { $denied++ }',
    '      }',
    '    } catch { $denied++ }',
    '  }',
    '}',
    '',
    '$deletable = "unknown"',
    'if ($locked -gt 0) { $deletable = "no" }',
    'elseif (-not $truncated -and $denied -eq 0 -and $other -eq 0) { $deletable = "yes" }',
    '',
    '[ordered]@{',
    '  deletable = $deletable',
    '  locked = $locked',
    '  denied = $denied',
    '  other = $other',
    '  checked = $checked',
    '  truncated = $truncated',
    '} | ConvertTo-Json -Compress'
  ].join('\n')
}

function parseFolderProbeOutput(raw) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').trim()
  if (!text) {
    return { ok: false, deletable: 'unknown', locked: 0, denied: 0, other: 0, checked: 0, truncated: false }
  }
  try {
    const parsed = JSON.parse(text)
    const deletable = ['yes', 'no', 'unknown'].includes(parsed.deletable) ? parsed.deletable : 'unknown'
    return {
      ok: true,
      deletable: deletable,
      locked: Number(parsed.locked) || 0,
      denied: Number(parsed.denied) || 0,
      other: Number(parsed.other) || 0,
      checked: Number(parsed.checked) || 0,
      truncated: !!parsed.truncated
    }
  } catch (e) {
    return { ok: false, deletable: 'unknown', locked: 0, denied: 0, other: 0, checked: 0, truncated: false }
  }
}

module.exports = {
  MAX_ENTRIES,
  TIME_BUDGET_MS,
  buildFolderProbeScript,
  parseFolderProbeOutput
}
