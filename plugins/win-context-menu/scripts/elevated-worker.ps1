#requires -Version 5.1
<#
.SYNOPSIS
  Windows 右键菜单管理 - 常驻提权本地工作进程（一次 UAC，全程免重复弹窗，毫秒级响应）
.DESCRIPTION
  - 仅监听 127.0.0.1:<Port>，所有请求强制校验随机 Token
  - 启动时预热一次 context-menu-manager.ps1（含 SHLoadIndirectString），后续 scan/toggle/restore 毫秒级响应
  - 空闲超过 IdleTimeoutSeconds（默认 900 秒 = 15 分钟）或收到 /shutdown 自动优雅退出
#>
param(
  [Parameter(Mandatory = $true)]
  [int]$Port,

  [Parameter(Mandatory = $true)]
  [string]$Token,

  [Parameter(Mandatory = $true)]
  [string]$BackupDir,

  [Parameter(Mandatory = $true)]
  [string]$ManagerScriptPath,

  [string]$ReadyFile = '',
  [int]$IdleTimeoutSeconds = 900
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 加载核心引擎函数（通过 dot-source 方式，避免重复冷启动与重复 Add-Type 编译）
. $ManagerScriptPath -Action 'lib' -BackupDir $BackupDir

$listener = New-Object System.Net.HttpListener
$prefix = "http://127.0.0.1:${Port}/"
$listener.Prefixes.Add($prefix)
$listener.Start()

if (-not [string]::IsNullOrWhiteSpace($ReadyFile)) {
  $readyJson = @{ ok = $true; port = $Port; pid = $PID; isAdmin = (Test-IsAdmin) } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($ReadyFile, $readyJson, [System.Text.UTF8Encoding]::new($false))
}

function Send-JsonResponse {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$StatusCode,
    [string]$JsonText
  )
  $Response.StatusCode = $StatusCode
  $Response.ContentType = 'application/json; charset=utf-8'
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonText)
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Response.OutputStream.Close()
}

$lastActive = Get-Date

try {
  while ($listener.IsListening) {
    $asyncResult = $listener.BeginGetContext($null, $null)
    while (-not $asyncResult.AsyncWaitHandle.WaitOne(500)) {
      if (((Get-Date) - $lastActive).TotalSeconds -ge $IdleTimeoutSeconds) {
        $listener.Stop()
        break
      }
    }
    if (-not $listener.IsListening) { break }

    $context = $null
    try {
      $context = $listener.EndGetContext($asyncResult)
    } catch {
      break
    }

    $lastActive = Get-Date
    $req = $context.Request
    $res = $context.Response

    # 强制校验随机 Token
    $reqToken = $req.Headers['X-ALLTool-Token']
    if ($reqToken -ne $Token) {
      Send-JsonResponse -Response $res -StatusCode 403 -JsonText '{"ok":false,"error":"Forbidden"}'
      continue
    }

    $route = $req.Url.AbsolutePath.ToLowerInvariant()
    try {
      switch ($route) {
        '/health' {
          $body = @{ ok = $true; pid = $PID; isAdmin = (Test-IsAdmin); schemaVersion = 5 } | ConvertTo-Json -Compress
          Send-JsonResponse -Response $res -StatusCode 200 -JsonText $body
        }
        '/scan' {
          $body = Invoke-Scan
          Send-JsonResponse -Response $res -StatusCode 200 -JsonText $body
        }
        '/toggle' {
          $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
          $rawBody = $reader.ReadToEnd()
          $reader.Close()
          $parsed = ConvertFrom-Json $rawBody
          $ops = if ($parsed -is [System.Array]) { $parsed } else { @($parsed) }
          if ($ops.Count -eq 0) { throw '操作列表为空' }
          $backups = Save-BackupAndHistory -Operations $ops
          Invoke-OperationsWithElevation -Operations $ops
          $needsExplorerRestart = (@($ops | Where-Object { $_.kind -eq 'shellex' }).Count -gt 0)
          $historyCount = Get-HistoryCount
          $body = [PSCustomObject]@{
            ok                   = $true
            appliedCount         = $ops.Count
            backupCount          = $backups.Count
            backupDir            = $BackupDir
            historyCount         = $historyCount
            needsExplorerRestart = $needsExplorerRestart
          } | ConvertTo-Json -Compress
          Send-JsonResponse -Response $res -StatusCode 200 -JsonText $body
        }
        '/restore-all' {
          $body = Invoke-RestoreAll
          Send-JsonResponse -Response $res -StatusCode 200 -JsonText $body
        }
        '/restart-explorer' {
          $body = Invoke-RestartExplorer
          Send-JsonResponse -Response $res -StatusCode 200 -JsonText $body
        }
        '/shutdown' {
          Send-JsonResponse -Response $res -StatusCode 200 -JsonText '{"ok":true}'
          $listener.Stop()
        }
        default {
          Send-JsonResponse -Response $res -StatusCode 404 -JsonText '{"ok":false,"error":"Not Found"}'
        }
      }
    } catch {
      $errJson = @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
      Send-JsonResponse -Response $res -StatusCode 200 -JsonText $errJson
    }
  }
} finally {
  if ($listener.IsListening) { $listener.Stop() }
  $listener.Close()
}
