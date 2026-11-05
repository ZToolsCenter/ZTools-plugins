const fs = require('node:fs')
const path = require('node:path')

// PowerShell 脚本头部: 强制 UTF-8 输出,避免中文乱码
var PS_HEADER = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$OutputEncoding = [System.Text.Encoding]::UTF8\n'

function isDirectory(filePath) {
  try { return fs.statSync(filePath).isDirectory() } catch { return false }
}

function buildShredScript(filePath) {
  const escaped = filePath.replace(/'/g, "''")
  const isDir = isDirectory(filePath)
  if (isDir) {
    // 逐文件覆写；任何失败都要记录并在结果里如实返回。
    // 不用 Remove-Item -Recurse 递归删除：先自底向上删空目录，避免跟随 junction。
    return PS_HEADER + [
      '$ErrorActionPreference = "Stop"',
      '$path = ' + "'" + escaped + "'",
      '$count = 0',
      '$fileFailed = 0',
      '$dirFailed = 0',
      '$locked = 0',
      '$denied = 0',
      '$other = 0',
      '$errors = New-Object System.Collections.ArrayList',
      '',
      'function Add-Failure([string]$target, $err) {',
      '  # PowerShell 会把 .NET 异常包在 MethodInvocationException 里，需沿 InnerException 找真实错误码',
      '  $isLocked = $false',
      '  $isDenied = $false',
      '  $e = $err.Exception',
      '  while ($e -ne $null) {',
      '    if ($e.HResult -eq -2147024864 -or $e.HResult -eq -2147024863) { $isLocked = $true }',
      '    if ($e.HResult -eq -2147024891 -or $e -is [System.UnauthorizedAccessException]) { $isDenied = $true }',
      '    $e = $e.InnerException',
      '  }',
      '  if ($isLocked) { $script:locked++ }',
      '  elseif ($isDenied) { $script:denied++ }',
      '  else { $script:other++ }',
      '  if ($script:errors.Count -lt 10) { [void]$script:errors.Add((Split-Path -Leaf $target) + ": " + $err.Exception.Message) }',
      '}',
      '',
      'try {',
      '  $files = New-Object System.Collections.ArrayList',
      '  $dirs = New-Object System.Collections.ArrayList',
      '  $links = New-Object System.Collections.ArrayList',
      '  [void]$dirs.Add($path)',
      '  $stack = New-Object System.Collections.Stack',
      '  $stack.Push($path)',
      '  while ($stack.Count -gt 0) {',
      '    $cur = [string]$stack.Pop()',
      '    try {',
      '      foreach ($entry in [System.IO.Directory]::EnumerateFileSystemEntries($cur)) {',
      '        $attr = [System.IO.File]::GetAttributes($entry)',
      '        if (($attr -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {',
      '          [void]$links.Add($entry)',
      '        } elseif (($attr -band [System.IO.FileAttributes]::Directory) -ne 0) {',
      '          [void]$dirs.Add($entry)',
      '          $stack.Push($entry)',
      '        } else {',
      '          [void]$files.Add($entry)',
      '        }',
      '      }',
      '    } catch {',
      '      $fileFailed++',
      '      Add-Failure $cur $_',
      '    }',
      '  }',
      '',
      '  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()',
      '  $bufSize = 65536',
      '  foreach ($file in $files) {',
      '    try {',
      '      $info = New-Object System.IO.FileInfo([string]$file)',
      '      if ($info.IsReadOnly) { $info.IsReadOnly = $false }',
      '      $len = $info.Length',
      '      if ($len -gt 0) {',
      '        $fs = [System.IO.File]::Open([string]$file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)',
      '        try {',
      '          $left = $len',
      '          while ($left -gt 0) {',
      '            $chunk = [Math]::Min($bufSize, $left)',
      '            $buf = [byte[]]::new($chunk)',
      '            $rng.GetBytes($buf)',
      '            $fs.Write($buf, 0, $chunk)',
      '            $left -= $chunk',
      '          }',
      '          $fs.Flush()',
      '        } finally { $fs.Dispose() }',
      '      }',
      '      [System.IO.File]::Delete([string]$file)',
      '      $count++',
      '    } catch {',
      '      $fileFailed++',
      '      Add-Failure ([string]$file) $_',
      '    }',
      '  }',
      '',
      '  foreach ($link in $links) {',
      '    try {',
      '      # 只删除链接本身，绝不递归进入目标；Remove-Item 在非交互模式下会因确认提示失败',
      '      $attr = [System.IO.File]::GetAttributes([string]$link)',
      '      if (($attr -band [System.IO.FileAttributes]::Directory) -ne 0) {',
      '        [System.IO.Directory]::Delete([string]$link, $false)',
      '      } else {',
      '        [System.IO.File]::Delete([string]$link)',
      '      }',
      '    } catch { $fileFailed++; Add-Failure ([string]$link) $_ }',
      '  }',
      '',
      '  $sortedDirs = @($dirs | Sort-Object { ([string]$_).Length } -Descending)',
      '  foreach ($dir in $sortedDirs) {',
      '    try { [System.IO.Directory]::Delete([string]$dir, $false) }',
      '    catch { $dirFailed++; Add-Failure ([string]$dir) $_ }',
      '  }',
      '',
      '  $remaining = Test-Path -LiteralPath $path',
      '  $ok = (-not $remaining) -and ($fileFailed -eq 0) -and ($dirFailed -eq 0)',
      '  Write-Output (ConvertTo-Json -Compress -Depth 5 @{',
      '    ok = [bool]$ok; count = $count; failed = $fileFailed; failedDirs = $dirFailed',
      '    locked = $locked; permissionDenied = $denied; other = $other',
      '    remaining = [bool]$remaining; errors = @($errors)',
      '  })',
      '} catch {',
      '  Write-Output (ConvertTo-Json -Compress -Depth 5 @{',
      '    ok = $false; count = $count; failed = $fileFailed; failedDirs = ($dirFailed + 1)',
      '    locked = $locked; permissionDenied = $denied; other = $other',
      '    remaining = (Test-Path -LiteralPath $path); errors = @($errors)',
      '    error = $_.Exception.Message',
      '  })',
      '}'
    ].join('\n')
  }
  return PS_HEADER + [
    '$ErrorActionPreference = "Stop"',
    'try {',
    '$path = ' + "'" + escaped + "'",
    '$item = Get-Item -LiteralPath $path',
    'if ($item.IsReadOnly) { $item.IsReadOnly = $false }',
    '$len = $item.Length',
    'if ($len -eq 0) { Remove-Item -LiteralPath $path -Force; Write-Output (ConvertTo-Json @{ ok = $true; count = 1 }); exit }',
    '$bufSize = 65536',
    '$buf = [byte[]]::new($bufSize)',
    '$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()',
    '$fs = [System.IO.File]::Open($path, "Open", "Write", "None")',
    '$written = 0',
    'while ($written -lt $len) {',
    '  $chunk = [Math]::Min($bufSize, $len - $written)',
    '  if ($chunk -lt $bufSize) { $buf = [byte[]]::new($chunk) }',
    '  $rng.GetBytes($buf)',
    '  $fs.Write($buf, 0, $chunk)',
    '  $fs.Flush()',
    '  $written += $chunk',
    '}',
    '$fs.Close()',
    'Remove-Item -LiteralPath $path -Force',
    'Write-Output (ConvertTo-Json @{ ok = $true; count = 1 })',
    '} catch { Write-Output (ConvertTo-Json @{ ok = $false; error = $_.Exception.Message }) }'
  ].join('\n')
}

function buildDeleteScript(filePath) {
  const escaped = filePath.replace(/'/g, "''")
  const isDir = isDirectory(filePath)
  if (isDir) {
    return PS_HEADER + "$ErrorActionPreference = 'Stop'" + `
try { Remove-Item -LiteralPath '${escaped}' -Recurse -Force; Write-Output (ConvertTo-Json @{ ok = $true; count = 0 }) }
catch { Write-Output (ConvertTo-Json @{ ok = $false; error = $_.Exception.Message }) }`
  }
  return PS_HEADER + "$ErrorActionPreference = 'Stop'" + `
try {
  $item = Get-Item -LiteralPath '${escaped}'
  if ($item.IsReadOnly) { $item.IsReadOnly = $false }
  Remove-Item -LiteralPath '${escaped}' -Force
  Write-Output (ConvertTo-Json @{ ok = $true; count = 1 })
}
catch { Write-Output (ConvertTo-Json @{ ok = $false; error = $_.Exception.Message }) }`
}

function _isLockError(msg) {
  const lower = (msg || '').toLowerCase()
  // English patterns
  if (lower.includes('being used') || lower.includes('in use')) return true
  // Chinese patterns (.NET 异常消息)
  if (msg && (msg.includes('正由另一进程使用') || msg.includes('被另一进程使用') || msg.includes('正在使用'))) return true
  return false
}

function _isPermissionError(msg) {
  const lower = (msg || '').toLowerCase()
  // English patterns
  if (lower.includes('access denied') || lower.includes('permission denied')) return true
  // Chinese patterns
  if (msg && (msg.includes('拒绝') || msg.includes('权限不足'))) return true
  return false
}

function parseShredResult(raw) {
  const trimmed = raw.trim().replace(/^\uFEFF/, '')
  try {
    const parsed = JSON.parse(trimmed)
    const count = Number(parsed.count) || 0
    const failed = Number(parsed.failed) || 0
    const lockedCount = Number(parsed.locked) || 0
    const deniedCount = Number(parsed.permissionDenied) || 0
    const otherCount = Number(parsed.other) || 0
    const remaining = parsed.remaining === undefined ? null : !!parsed.remaining
    const partial = failed > 0 || remaining === true

    if (parsed.ok && !partial) {
      return { success: true, message: '已处理 ' + count + ' 个文件', filesProcessed: count }
    }

    const errMsg = parsed.error || (Array.isArray(parsed.errors) && parsed.errors.length > 0 ? String(parsed.errors[0]) : '')
    const isLocked = lockedCount > 0 || _isLockError(errMsg)
    const isDenied = deniedCount > 0 || _isPermissionError(errMsg)
    const base = {
      success: false,
      partial: failed > 0 || remaining === true,
      filesProcessed: count,
      failedFiles: failed,
      remaining: remaining === true
    }

    if (isLocked) {
      const remainingCount = failed || lockedCount
      let message
      if (count > 0) {
        message = '已处理 ' + count + ' 个文件，但' +
          (remainingCount > 0 ? '还有 ' + remainingCount + ' 个无法处理' : '仍有文件无法处理') +
          '（正被其他程序占用）'
      } else {
        message = remainingCount > 0
          ? '有 ' + remainingCount + ' 个文件正被其他程序占用，无法处理'
          : '有文件正被其他程序占用，无法处理'
      }
      return Object.assign(base, {
        locked: true,
        permissionDenied: isDenied,
        message: message,
        rawError: errMsg || undefined
      })
    }
    if (isDenied) {
      return Object.assign(base, {
        locked: true,
        permissionDenied: true,
        message: '权限不足，请以管理员身份运行 ZTools 后重试',
        rawError: errMsg || undefined
      })
    }
    if (partial) {
      return Object.assign(base, {
        message: '已处理 ' + count + ' 个文件，但仍有 ' + (failed || otherCount || 1) + ' 项未能删除',
        rawError: errMsg || undefined
      })
    }
    return { success: false, message: errMsg || '未知错误' }
  } catch (e) {
    if (_isPermissionError(trimmed)) {
      return { success: false, message: '权限不足，请以管理员身份运行 ZTools 后重试', locked: true, permissionDenied: true }
    }
    if (_isLockError(trimmed)) {
      return { success: false, message: '有文件正被其他程序占用', locked: true }
    }
    return { success: false, message: trimmed.substring(0, 200) || '未知错误' }
  }
}

module.exports = { buildShredScript, buildDeleteScript, parseShredResult }
