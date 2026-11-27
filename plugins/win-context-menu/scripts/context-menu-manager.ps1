#requires -Version 5.1
<#
.SYNOPSIS
  Windows 右键菜单无损扫描、停用/启用与备份回滚引擎
.DESCRIPTION
  - 扫描 HKCU/HKLM 下四大常见场景（文件夹空白处、文件、文件夹、桌面空白处）的 shell 与 shellex 项
  - 使用 Win32 SHLoadIndirectString 解析 @dll,-id 为真实中文菜单名
  - shell 项采用微软原生 LegacyDisable 无损停用；shellex 项采用 HKCU Shell Extensions\Blocked 无损拦截
  - 修改前自动备份注册表快照到 ALLTool\.local\backups\win-context-menu\
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('scan', 'toggle', 'restore-all', 'restart-explorer', 'lib')]
  [string]$Action,

  [string]$PayloadFile = '',
  [string]$BackupDir = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 默认备份目录指向 ALLTool/.local/backups/win-context-menu
if ([string]::IsNullOrWhiteSpace($BackupDir)) {
  $repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
  $BackupDir = Join-Path $repoRoot '.local\backups\win-context-menu'
}

# 加载 Win32 SHLoadIndirectString 与 ExtractIconEx（用于解析本地化菜单名与提取真实程序小图标）
$win32Type = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;

public static class ShlwapiHelper {
    private static readonly Dictionary<string, string> IconCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    [DllImport("shlwapi.dll", BestFitMapping = false, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = false, ThrowOnUnmappableChar = true)]
    private static extern int SHLoadIndirectString(string pszSource, StringBuilder pszOutBuf, int cchOutBuf, IntPtr ppvReserved);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ExtractIconEx(string lpszFile, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, uint nIcons);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public static string ResolveIndirectString(string input) {
        if (string.IsNullOrWhiteSpace(input) || !input.StartsWith("@")) {
            return input;
        }
        try {
            var sb = new StringBuilder(512);
            int hr = SHLoadIndirectString(input, sb, sb.Capacity, IntPtr.Zero);
            if (hr == 0 && sb.Length > 0) {
                return sb.ToString();
            }
        } catch {}
        return input;
    }

    private static string ResolveFilePath(string rawPath) {
        if (string.IsNullOrWhiteSpace(rawPath)) return "";
        string p = Environment.ExpandEnvironmentVariables(rawPath.Trim().Trim('"').Trim());
        if (p.StartsWith("@")) p = p.Substring(1).Trim().Trim('"');
        if (File.Exists(p)) return p;
        // 尝试 System32 目录（如 shell32.dll、imageres.dll、cmd.exe）
        if (!p.Contains("\\") && !p.Contains("/")) {
            string sys32 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), p);
            if (File.Exists(sys32)) return sys32;
            string winDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), p);
            if (File.Exists(winDir)) return winDir;
        }
        return "";
    }

    private static string ExtractExeFromCommand(string cmd) {
        if (string.IsNullOrWhiteSpace(cmd)) return "";
        string s = cmd.Trim();
        if (s.StartsWith("\"")) {
            int end = s.IndexOf('"', 1);
            if (end > 1) return ResolveFilePath(s.Substring(1, end - 1));
        }
        int sp = s.IndexOf(' ');
        string first = sp > 0 ? s.Substring(0, sp) : s;
        return ResolveFilePath(first);
    }

    private static string IconToDataUrl(Icon icon) {
        if (icon == null) return "";
        using (var bmp = new Bitmap(24, 24, PixelFormat.Format32bppArgb))
        using (var g = Graphics.FromImage(bmp))
        using (var srcBmp = icon.ToBitmap())
        using (var ms = new MemoryStream()) {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.Clear(Color.Transparent);
            g.DrawImage(srcBmp, 0, 0, 24, 24);
            bmp.Save(ms, ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
        }
    }

    public static string ExtractIconDataUrl(string iconSpec, string commandLine) {
        string cacheKey = (iconSpec ?? "") + "||" + (commandLine ?? "");
        string cached;
        if (IconCache.TryGetValue(cacheKey, out cached)) return cached;

        string result = "";
        try {
            string filePath = "";
            int iconIndex = 0;

            if (!string.IsNullOrWhiteSpace(iconSpec)) {
                string spec = iconSpec.Trim();
                int comma = spec.LastIndexOf(',');
                if (comma > 0) {
                    int parsedIdx;
                    if (int.TryParse(spec.Substring(comma + 1).Trim(), out parsedIdx)) {
                        filePath = ResolveFilePath(spec.Substring(0, comma));
                        iconIndex = parsedIdx;
                    } else {
                        filePath = ResolveFilePath(spec);
                    }
                } else {
                    filePath = ResolveFilePath(spec);
                }
            }

            if (string.IsNullOrEmpty(filePath) && !string.IsNullOrWhiteSpace(commandLine)) {
                filePath = ExtractExeFromCommand(commandLine);
                iconIndex = 0;
            }

            if (!string.IsNullOrEmpty(filePath)) {
                if (filePath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)) {
                    using (var ico = new Icon(filePath, 24, 24)) {
                        result = IconToDataUrl(ico);
                    }
                } else {
                    IntPtr[] smallIcons = new IntPtr[1];
                    IntPtr[] largeIcons = new IntPtr[1];
                    uint count = ExtractIconEx(filePath, iconIndex, largeIcons, smallIcons, 1);
                    IntPtr hIcon = smallIcons[0] != IntPtr.Zero ? smallIcons[0] : largeIcons[0];
                    if (count > 0 && hIcon != IntPtr.Zero) {
                        try {
                            using (var ico = Icon.FromHandle(hIcon)) {
                                result = IconToDataUrl(ico);
                            }
                        } finally {
                            if (smallIcons[0] != IntPtr.Zero) DestroyIcon(smallIcons[0]);
                            if (largeIcons[0] != IntPtr.Zero) DestroyIcon(largeIcons[0]);
                        }
                    } else if (iconIndex == 0 && filePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                        using (var ico = Icon.ExtractAssociatedIcon(filePath)) {
                            result = IconToDataUrl(ico);
                        }
                    }
                }
            }
        } catch {
            result = "";
        }

        IconCache[cacheKey] = result;
        return result;
    }
}
'@

if (-not ('ShlwapiHelper' -as [type])) {
  Add-Type -TypeDefinition $win32Type -Language CSharp -ReferencedAssemblies @('System.Drawing') | Out-Null
}

function Resolve-DisplayText {
  param([string]$Raw)
  if ([string]::IsNullOrWhiteSpace($Raw)) { return '' }
  $resolved = [ShlwapiHelper]::ResolveIndirectString($Raw.Trim())
  # 去掉菜单快捷键标记（如 &GUI -> GUI），但保留括号提示如 (V)
  return ($resolved -replace '&([A-Za-z0-9])', '$1').Trim()
}

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# 安全反序列化 JSON 数组（规避 PowerShell 5.1 中 @(ConvertFrom-Json) 对多元素数组产生二维嵌套的 Bug）
function ConvertFrom-JsonArray {
  param([string]$JsonText)
  if ([string]::IsNullOrWhiteSpace($JsonText)) { return @() }
  $parsed = ConvertFrom-Json $JsonText
  if ($null -eq $parsed) { return @() }
  if ($parsed -is [System.Array]) { return $parsed }
  return @($parsed)
}

# 安全序列化数组为 JSON（规避 Windows PowerShell 5.1 中 ConvertTo-Json -InputObject @(...) 报“参数类型不匹配”的已知 Bug）
function ConvertTo-JsonArray {
  param(
    [AllowEmptyCollection()]
    [object[]]$Items,
    [int]$Depth = 5
  )
  $arr = @($Items | Where-Object { $null -ne $_ })
  if ($arr.Count -eq 0) { return '[]' }
  if ($arr.Count -eq 1) {
    return '[' + ($arr[0] | ConvertTo-Json -Depth $Depth) + ']'
  }
  return ($arr | ConvertTo-Json -Depth $Depth)
}

function Get-BlockedClsids {
  $map = @{}
  $paths = @(
    @{ Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'; Scope = 'HKCU' },
    @{ Path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'; Scope = 'HKLM' }
  )
  foreach ($p in $paths) {
    if (Test-Path $p.Path) {
      $item = Get-Item $p.Path -ErrorAction SilentlyContinue
      if ($null -ne $item) {
        foreach ($valName in $item.GetValueNames()) {
          if ($valName -match '^\{[0-9A-Fa-f-]+\}$') {
            $key = $valName.ToUpperInvariant()
            if (-not $map.ContainsKey($key)) {
              $map[$key] = $p.Scope
            }
          }
        }
      }
    }
  }
  return $map
}

function Resolve-ClsidFriendlyInfo {
  param([string]$Clsid)
  $info = @{
    name = ''
    dll  = ''
  }
  if ([string]::IsNullOrWhiteSpace($Clsid) -or ($Clsid -notmatch '^\{[0-9A-Fa-f-]+\}$')) {
    return $info
  }
  $clsidKey = "Registry::HKEY_CLASSES_ROOT\CLSID\$Clsid"
  if (Test-Path $clsidKey) {
    $props = Get-ItemProperty $clsidKey -ErrorAction SilentlyContinue
    if ($null -ne $props -and -not [string]::IsNullOrWhiteSpace($props.'(default)')) {
      $info.name = Resolve-DisplayText $props.'(default)'
    }
    $inprocKey = Join-Path $clsidKey 'InprocServer32'
    if (Test-Path $inprocKey) {
      $inprocProps = Get-ItemProperty $inprocKey -ErrorAction SilentlyContinue
      if ($null -ne $inprocProps -and -not [string]::IsNullOrWhiteSpace($inprocProps.'(default)')) {
        $info.dll = [string]$inprocProps.'(default)'
      }
    }
  }
  return $info
}

# 定义 4 个常用右键场景（文件与文件夹同时聚合 AllFilesystemObjects 通用项，所见即所得）
$Scopes = @(
  @{ id = 'dir-bg';     label = '文件夹空白处'; subPaths = @('Directory\Background') },
  @{ id = 'file';       label = '文件';         subPaths = @('*', 'AllFilesystemObjects') },
  @{ id = 'dir';        label = '文件夹';       subPaths = @('Directory', 'AllFilesystemObjects') },
  @{ id = 'desktop-bg'; label = '桌面空白处';   subPaths = @('DesktopBackground') }
)

$Hives = @(
  @{ name = 'HKCU'; psRoot = 'HKCU:\Software\Classes'; regRoot = 'HKEY_CURRENT_USER\Software\Classes'; needsAdmin = $false },
  @{ name = 'HKLM'; psRoot = 'HKLM:\Software\Classes'; regRoot = 'HKEY_LOCAL_MACHINE\Software\Classes'; needsAdmin = $true }
)

# 常见系统关键扩展，标注提醒防止误关基础功能
$SystemProtectedKeys = @('New', 'Sharing', 'ModernSharing', 'SendTo', 'CopyAsPathMenu', 'Open Containing Folder Menu', 'EncryptionMenu', 'WorkFolders')

# 缓存 Win11 现代右键扩展（AppX / Sparse Package）静态元数据，避免常驻 Worker 每次重复调 Get-AppxPackage
if (-not $script:Win11ExtCache) {
  $script:Win11ExtCache = $null
}

function Get-Win11ContextMenuExtensions {
  if ($null -ne $script:Win11ExtCache) {
    return $script:Win11ExtCache
  }
  $list = New-Object System.Collections.Generic.List[object]
  # Windows 10 (Build < 22000) 无 Win11 现代 FileExplorerContextMenus，直接跳过以大幅提升 Win10 启动速度
  if ([System.Environment]::OSVersion.Version.Build -lt 22000) {
    $script:Win11ExtCache = $list
    return $script:Win11ExtCache
  }
  try {
    $pkgs = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {
      $_.InstallLocation -and (Test-Path -LiteralPath (Join-Path $_.InstallLocation 'AppxManifest.xml'))
    }
    foreach ($pkg in $pkgs) {
      $mfPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
      $raw = ''
      try { $raw = [System.IO.File]::ReadAllText($mfPath) } catch { continue }
      if ($raw.IndexOf('FileExplorerContextMenus', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        continue
      }

      try {
        [xml]$xml = $raw
        $propDisp = ''
        $dispNode = $xml.SelectSingleNode("//*[local-name()='Properties']/*[local-name()='DisplayName']")
        if ($null -ne $dispNode -and -not [string]::IsNullOrWhiteSpace($dispNode.InnerText)) {
          $propDisp = $dispNode.InnerText.Trim()
        }
        if ([string]::IsNullOrWhiteSpace($propDisp) -or $propDisp.StartsWith('ms-resource:')) {
          $propDisp = $pkg.Name
        }

        # 提取包 Logo 或同目录 DLL 图标
        $iconPath = ''
        $logoNode = $xml.SelectSingleNode("//*[local-name()='Properties']/*[local-name()='Logo']")
        if ($null -ne $logoNode -and -not [string]::IsNullOrWhiteSpace($logoNode.InnerText)) {
          $cand = Join-Path $pkg.InstallLocation $logoNode.InnerText.Trim()
          if (Test-Path -LiteralPath $cand) { $iconPath = $cand }
        }
        if ([string]::IsNullOrWhiteSpace($iconPath)) {
          $dllCand = Get-ChildItem -LiteralPath $pkg.InstallLocation -Filter '*.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
          if ($null -ne $dllCand) { $iconPath = $dllCand.FullName }
        }

        # 读取 PNG Logo 或通过 Win32 提取 DLL 图标
        $iconDataUrl = ''
        if ($iconPath -match '\.png$' -and (Test-Path -LiteralPath $iconPath)) {
          try {
            $bytes = [System.IO.File]::ReadAllBytes($iconPath)
            $iconDataUrl = 'data:image/png;base64,' + [Convert]::ToBase64String($bytes)
          } catch {}
        } elseif (-not [string]::IsNullOrWhiteSpace($iconPath)) {
          $iconDataUrl = [ShlwapiHelper]::ExtractIconDataUrl($iconPath, '')
        }

        $itemTypes = $xml.SelectNodes("//*[local-name()='FileExplorerContextMenus']//*[local-name()='ItemType']")
        foreach ($it in $itemTypes) {
          $typeAttr = $it.GetAttribute('Type')
          $scopeIds = @()
          switch ($typeAttr) {
            '*'                    { $scopeIds = @('file') }
            'Directory'            { $scopeIds = @('dir') }
            'Directory\Background' { $scopeIds = @('dir-bg') }
            'DesktopBackground'    { $scopeIds = @('desktop-bg') }
            default                { continue }
          }
          $verbs = $it.SelectNodes("./*[local-name()='Verb']")
          foreach ($v in $verbs) {
            $verbId = $v.GetAttribute('Id')
            $clsidRaw = $v.GetAttribute('Clsid')
            if ([string]::IsNullOrWhiteSpace($clsidRaw)) { continue }
            $clsidUpper = $clsidRaw.Trim().ToUpperInvariant()
            if (-not $clsidUpper.StartsWith('{')) { $clsidUpper = "{$clsidUpper}" }

            # 若 DLL 在 PackagedCom 中可找到，补充更精准的 DLL 路径与图标
            $dllPath = ''
            foreach ($pcRoot in @('HKCU:\Software\Classes\PackagedCom\Package', 'HKLM:\Software\Classes\PackagedCom\Package')) {
              $clsReg = Join-Path $pcRoot "$($pkg.PackageFullName)\Class\$clsidUpper"
              if (Test-Path -LiteralPath $clsReg) {
                $clsProps = Get-ItemProperty -LiteralPath $clsReg -ErrorAction SilentlyContinue
                if ($null -ne $clsProps -and -not [string]::IsNullOrWhiteSpace($clsProps.DllPath)) {
                  $dllRel = [string]$clsProps.DllPath
                  $dllPath = if ([System.IO.Path]::IsPathRooted($dllRel)) { $dllRel } else { Join-Path $pkg.InstallLocation $dllRel }
                  if ([string]::IsNullOrWhiteSpace($iconDataUrl) -and (Test-Path -LiteralPath $dllPath)) {
                    $iconDataUrl = [ShlwapiHelper]::ExtractIconDataUrl($dllPath, '')
                  }
                  break
                }
              }
            }

            # 构造更友好的中文/可读显示名
            $friendlyMap = @{
              'QQExtension'          = '通过 QQ 发送到 (Win11 现代扩展)'
              'HRContextMenu'        = '火绒安全软件 (Win11 现代扩展)'
              'EditWithNotepadPlusPlus' = '以 Notepad++ 编辑 (Win11 现代扩展)'
              'kMoreCommand'         = '360 压缩右键菜单 (Win11 现代扩展)'
              'FileLocksmithCommand' = 'Unlock with File Locksmith (Win11 现代扩展)'
              'PowerRenameCommand'   = '使用 PowerRename 重命名 (Win11 现代扩展)'
              'ImageResizerCommand'  = '调整图片大小 Image Resizer (Win11 现代扩展)'
            }
            $displayName = if ($friendlyMap.ContainsKey($verbId)) {
              $friendlyMap[$verbId]
            } elseif ($propDisp -ne $verbId) {
              "$propDisp ($verbId)"
            } else {
              $propDisp
            }

            foreach ($sid in $scopeIds) {
              $list.Add([PSCustomObject]@{
                scopeId     = $sid
                pkgName     = $pkg.Name
                pkgFullName = $pkg.PackageFullName
                verbId      = $verbId
                clsid       = $clsidUpper
                displayName = $displayName
                dllPath     = if ($dllPath) { $dllPath } else { $pkg.InstallLocation }
                iconDataUrl = $iconDataUrl
              })
            }
          }
        }
      } catch {}
    }
  } catch {}
  $script:Win11ExtCache = $list
  return $script:Win11ExtCache
}

function Invoke-Scan {
  $blockedMap = Get-BlockedClsids
  $results = New-Object System.Collections.Generic.List[object]

  foreach ($scope in $Scopes) {
    foreach ($subPath in $scope.subPaths) {
      foreach ($hive in $Hives) {
        # 1. 扫描传统 shell 项（必须使用 -LiteralPath，防止 '*' 被 PowerShell 当作通配符展开）
        $shellPsPath = Join-Path $hive.psRoot "$subPath\shell"
        if (Test-Path -LiteralPath $shellPsPath) {
          $subKeys = Get-ChildItem -LiteralPath $shellPsPath -ErrorAction SilentlyContinue
          foreach ($sk in $subKeys) {
            $props = Get-ItemProperty -LiteralPath $sk.PSPath -ErrorAction SilentlyContinue
            $keyName = $sk.PSChildName

            $rawName = ''
            if ($null -ne $props -and -not [string]::IsNullOrWhiteSpace($props.MUIVerb)) {
              $rawName = [string]$props.MUIVerb
            } elseif ($null -ne $props -and -not [string]::IsNullOrWhiteSpace($props.'(default)')) {
              $rawName = [string]$props.'(default)'
            } else {
              $rawName = $keyName
            }

            $displayName = Resolve-DisplayText $rawName
            if ([string]::IsNullOrWhiteSpace($displayName)) {
              $displayName = $keyName
            }

            $commandText = ''
            $cmdKey = Join-Path $sk.PSPath 'command'
            if (Test-Path -LiteralPath $cmdKey) {
              $cmdProps = Get-ItemProperty -LiteralPath $cmdKey -ErrorAction SilentlyContinue
              if ($null -ne $cmdProps -and $null -ne $cmdProps.'(default)') {
                $commandText = [string]$cmdProps.'(default)'
              }
            }

            $hasLegacyDisable = ($null -ne $props) -and ($props.PSObject.Properties.Name -contains 'LegacyDisable')
            $hasProgOnly = ($null -ne $props) -and ($props.PSObject.Properties.Name -contains 'ProgrammaticAccessOnly')
            $isExtended = ($null -ne $props) -and ($props.PSObject.Properties.Name -contains 'Extended')
            $iconText = if ($null -ne $props -and $null -ne $props.Icon) { [string]$props.Icon } else { '' }
            $positionText = if ($null -ne $props -and $null -ne $props.Position) { ([string]$props.Position).Trim() } else { '' }
            $iconDataUrl = [ShlwapiHelper]::ExtractIconDataUrl($iconText, $commandText)
            $regPath = "$($hive.regRoot)\$subPath\shell\$keyName"

            # 贴近 Windows Explorer 真实右键顺序的分组权重
            $sortGroup = if ($isExtended) {
              5
            } elseif ($positionText -ieq 'Top') {
              0
            } elseif ($positionText -ieq 'Bottom') {
              3
            } else {
              2
            }

            $results.Add([PSCustomObject]@{
              id             = "$($scope.id)|$($hive.name)|$subPath|shell|$keyName"
              scopeId        = $scope.id
              scopeLabel     = $scope.label
              kind           = 'shell'
              hive           = $hive.name
              keyName        = $keyName
              displayName    = $displayName
              rawName        = $rawName
              regPath        = $regPath
              clsid          = ''
              command        = $commandText
              icon           = $iconText
              iconDataUrl    = $iconDataUrl
              position       = $positionText
              sortGroup      = $sortGroup
              enabled        = -not ($hasLegacyDisable -or $hasProgOnly)
              disabledReason = if ($hasLegacyDisable) { 'LegacyDisable' } elseif ($hasProgOnly) { 'ProgrammaticAccessOnly' } else { '' }
              isExtended     = $isExtended
              needsAdmin     = $hive.needsAdmin
              isSystemHint   = ($keyName -in @('cmd', 'Powershell', 'WSL', 'open', 'print', 'edit', 'find'))
            })
          }
        }

        # 2. 扫描 shellex\ContextMenuHandlers COM 扩展（同样使用 -LiteralPath）
        $shellexPsPath = Join-Path $hive.psRoot "$subPath\shellex\ContextMenuHandlers"
        if (Test-Path -LiteralPath $shellexPsPath) {
          $subKeys = Get-ChildItem -LiteralPath $shellexPsPath -ErrorAction SilentlyContinue
          foreach ($sk in $subKeys) {
            $props = Get-ItemProperty -LiteralPath $sk.PSPath -ErrorAction SilentlyContinue
            $keyName = $sk.PSChildName
            $clsid = ''
            if ($null -ne $props -and -not [string]::IsNullOrWhiteSpace($props.'(default)')) {
              $clsid = ([string]$props.'(default)').Trim()
            } elseif ($keyName -match '^\{[0-9A-Fa-f-]+\}$') {
              $clsid = $keyName.Trim()
            }

            if ($clsid -notmatch '^\{[0-9A-Fa-f-]+\}$') {
              continue
            }

            $clsidUpper = $clsid.ToUpperInvariant()
            $clsidInfo = Resolve-ClsidFriendlyInfo $clsidUpper
            $displayName = if (-not [string]::IsNullOrWhiteSpace($clsidInfo.name)) {
              if ($keyName -ne $clsidInfo.name -and ($keyName -notmatch '^\{')) {
                "$($clsidInfo.name) ($keyName)"
              } else {
                $clsidInfo.name
              }
            } else {
              $keyName
            }

            $isBlocked = $blockedMap.ContainsKey($clsidUpper)
            $blockedScope = if ($isBlocked) { $blockedMap[$clsidUpper] } else { '' }
            $regPath = "$($hive.regRoot)\$subPath\shellex\ContextMenuHandlers\$keyName"
            $isSysHint = ($keyName -in $SystemProtectedKeys)
            $iconDataUrl = [ShlwapiHelper]::ExtractIconDataUrl($clsidInfo.dll, '')

            # 通过 HKCU Shell Extensions\Blocked 停用免管理员权限；仅当它被 HKLM 拦截时启用才需 UAC
            $needsAdmin = ($blockedScope -eq 'HKLM')
            $sortGroup = if ($isSysHint) { 4 } else { 1 }

            $results.Add([PSCustomObject]@{
              id             = "$($scope.id)|$($hive.name)|$subPath|shellex|$keyName|$clsidUpper"
              scopeId        = $scope.id
              scopeLabel     = $scope.label
              kind           = 'shellex'
              hive           = $hive.name
              keyName        = $keyName
              displayName    = $displayName
              rawName        = $keyName
              regPath        = $regPath
              clsid          = $clsidUpper
              command        = $clsidInfo.dll
              icon           = ''
              iconDataUrl    = $iconDataUrl
              position       = ''
              sortGroup      = $sortGroup
              enabled        = -not $isBlocked
              disabledReason = if ($isBlocked) { "Blocked($blockedScope)" } else { '' }
              isExtended     = $false
              needsAdmin     = $needsAdmin
              isSystemHint   = $isSysHint
            })
          }
        }
      }
    }
  }

  # 3. 扫描 Win11 现代右键扩展（AppX / Sparse Package，如 QQ、火绒、新版 PowerToys、Notepad++、360 压缩）
  $scopeLabelMap = @{ 'dir-bg' = '文件夹空白处'; 'file' = '文件'; 'dir' = '文件夹'; 'desktop-bg' = '桌面空白处' }
  $win11Exts = Get-Win11ContextMenuExtensions
  foreach ($ext in $win11Exts) {
    $isBlocked = $blockedMap.ContainsKey($ext.clsid)
    $blockedScope = if ($isBlocked) { $blockedMap[$ext.clsid] } else { '' }
    $results.Add([PSCustomObject]@{
      id             = "$($ext.scopeId)|APPX|win11|$($ext.verbId)|$($ext.clsid)"
      scopeId        = $ext.scopeId
      scopeLabel     = $scopeLabelMap[$ext.scopeId]
      kind           = 'shellex'
      subKind        = 'win11'
      hive           = 'APPX'
      keyName        = $ext.verbId
      displayName    = $ext.displayName
      rawName        = $ext.pkgName
      regPath        = "PackagedCom\\$($ext.pkgFullName)\\Class\\$($ext.clsid)"
      clsid          = $ext.clsid
      command        = $ext.dllPath
      icon           = ''
      iconDataUrl    = $ext.iconDataUrl
      position       = ''
      sortGroup      = 1
      enabled        = -not $isBlocked
      disabledReason = if ($isBlocked) { "Blocked($blockedScope)" } else { '' }
      isExtended     = $false
      needsAdmin     = ($blockedScope -eq 'HKLM')
      isSystemHint   = $false
    })
  }

  # 按真实 Windows 右键菜单顺序排序（合并 HKCU/HKLM：场景 -> 分组权重 -> keyName 不区分大小写字母序）
  $scopeRank = @{ 'dir-bg' = 0; 'file' = 1; 'dir' = 2; 'desktop-bg' = 3 }
  $sortedResults = @($results | Sort-Object `
    @{ Expression = { $scopeRank[$_.scopeId] } }, `
    @{ Expression = { $_.sortGroup } }, `
    @{ Expression = { $_.keyName.ToLowerInvariant() } }
  )

  # 读取本插件历史修改记录数量
  $historyCount = Get-HistoryCount

  $output = [PSCustomObject]@{
    ok           = $true
    isAdmin      = (Test-IsAdmin)
    backupDir    = $BackupDir
    historyCount = $historyCount
    items        = $sortedResults
  }
  $output | ConvertTo-Json -Depth 6 -Compress
}

function Save-BackupAndHistory {
  param(
    [array]$Operations
  )
  if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  }

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupFiles = @()

  # 1. 导出修改前 .reg 备份文件（仅当目标注册表键存在时导出，并临时放宽 ErrorActionPreference 避免外部命令 stderr 中断）
  $idx = 0
  $prevEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    foreach ($op in $Operations) {
      $idx++
      $safeName = ($op.keyName -replace '[^A-Za-z0-9_-]', '_')
      if ($op.kind -eq 'shell') {
        $psCheckPath = 'Registry::' + $op.regPath
        if (Test-Path -LiteralPath $psCheckPath) {
          $regFile = Join-Path $BackupDir "${timestamp}_${idx}_${safeName}.reg"
          $null = & reg.exe export $op.regPath $regFile /y 2>&1
          if (Test-Path -LiteralPath $regFile) {
            $backupFiles += $regFile
          }
        }
      } elseif ($op.kind -eq 'shellex') {
        $blockedPsPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'
        $blockedRegPath = 'HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'
        if (Test-Path -LiteralPath $blockedPsPath) {
          $regFile = Join-Path $BackupDir "${timestamp}_${idx}_Blocked_${safeName}.reg"
          $null = & reg.exe export $blockedRegPath $regFile /y 2>&1
          if (Test-Path -LiteralPath $regFile) {
            $backupFiles += $regFile
          }
        }
      }
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }

  # 2. 更新可回滚历史记录 history.json（记录每个项最初的状态）
  $historyPath = Join-Path $BackupDir 'history.json'
  $historyList = New-Object System.Collections.Generic.List[object]
  if (Test-Path $historyPath) {
    try {
      $existing = ConvertFrom-JsonArray (Get-Content $historyPath -Raw -Encoding UTF8)
      foreach ($e in $existing) {
        if ($null -ne $e) { $historyList.Add($e) }
      }
    } catch {}
  }

  foreach ($op in $Operations) {
    $found = $false
    foreach ($h in $historyList) {
      if ($h.id -eq $op.id) {
        $found = $true
        break
      }
    }
    if (-not $found) {
      $historyList.Add([PSCustomObject]@{
        id              = $op.id
        kind            = $op.kind
        hive            = $op.hive
        keyName         = $op.keyName
        displayName     = $op.displayName
        regPath         = $op.regPath
        clsid           = $op.clsid
        originalEnabled = [bool]$op.currentEnabled
        needsAdmin      = [bool]$op.needsAdmin
        recordedAt      = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
      })
    }
  }

  $jsonText = ConvertTo-JsonArray -Items $historyList.ToArray() -Depth 5
  [System.IO.File]::WriteAllText($historyPath, $jsonText, [System.Text.UTF8Encoding]::new($false))
  return $backupFiles
}

function Apply-SingleOperation {
  param($Op)

  if ($Op.kind -eq 'shell') {
    $psPath = 'Registry::' + $Op.regPath
    if (-not (Test-Path -LiteralPath $psPath)) {
      throw "注册表项不存在: $($Op.regPath)"
    }
    if ([bool]$Op.targetEnabled) {
      # 启用：移除 LegacyDisable（以及如存在的 ProgrammaticAccessOnly）
      $props = Get-ItemProperty -LiteralPath $psPath -ErrorAction SilentlyContinue
      if ($null -ne $props -and ($props.PSObject.Properties.Name -contains 'LegacyDisable')) {
        Remove-ItemProperty -LiteralPath $psPath -Name 'LegacyDisable' -Force
      }
      if ($null -ne $props -and ($props.PSObject.Properties.Name -contains 'ProgrammaticAccessOnly')) {
        Remove-ItemProperty -LiteralPath $psPath -Name 'ProgrammaticAccessOnly' -Force
      }
    } else {
      # 停用：写入微软原生 LegacyDisable 空字符串
      New-ItemProperty -LiteralPath $psPath -Name 'LegacyDisable' -Value '' -PropertyType String -Force | Out-Null
    }
  } elseif ($Op.kind -eq 'shellex') {
    $clsid = ([string]$Op.clsid).Trim().ToUpperInvariant()
    if ($clsid -notmatch '^\{[0-9A-Fa-f-]+\}$') {
      throw "无效的 CLSID: $clsid"
    }
    $hkcuBlocked = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'
    $hklmBlocked = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'

    if ([bool]$Op.targetEnabled) {
      if (Test-Path $hkcuBlocked) {
        $p = Get-ItemProperty $hkcuBlocked -ErrorAction SilentlyContinue
        if ($null -ne $p -and ($p.PSObject.Properties.Name -contains $clsid)) {
          Remove-ItemProperty -Path $hkcuBlocked -Name $clsid -Force
        }
      }
      if ((Test-IsAdmin) -and (Test-Path $hklmBlocked)) {
        $p2 = Get-ItemProperty $hklmBlocked -ErrorAction SilentlyContinue
        if ($null -ne $p2 -and ($p2.PSObject.Properties.Name -contains $clsid)) {
          Remove-ItemProperty -Path $hklmBlocked -Name $clsid -Force
        }
      }
    } else {
      if (-not (Test-Path $hkcuBlocked)) {
        New-Item -Path $hkcuBlocked -Force | Out-Null
      }
      $desc = "ALLTool Disabled: $($Op.displayName)"
      New-ItemProperty -Path $hkcuBlocked -Name $clsid -Value $desc -PropertyType String -Force | Out-Null
    }
  }
}

function Invoke-OperationsWithElevation {
  param([array]$Operations)

  $needsAdminOps = @($Operations | Where-Object { [bool]$_.needsAdmin })
  $normalOps     = @($Operations | Where-Object { -not [bool]$_.needsAdmin })

  # 先执行免管理员权限的项
  foreach ($op in $normalOps) {
    Apply-SingleOperation -Op $op
  }

  # 再处理需要管理员权限的项
  if ($needsAdminOps.Count -gt 0) {
    if (Test-IsAdmin) {
      foreach ($op in $needsAdminOps) {
        Apply-SingleOperation -Op $op
      }
    } else {
      # 写入临时提权任务文件并只弹一次 UAC
      $tempId = [Guid]::NewGuid().ToString('N')
      $elevPayload = Join-Path $env:TEMP "alltool_ctx_${tempId}.json"
      $elevResult  = Join-Path $env:TEMP "alltool_ctx_${tempId}_res.json"
      $elevScript  = Join-Path $env:TEMP "alltool_ctx_${tempId}.ps1"

      $payloadJson = ConvertTo-JsonArray -Items $needsAdminOps -Depth 5
      [System.IO.File]::WriteAllText($elevPayload, $payloadJson, [System.Text.UTF8Encoding]::new($false))

      $scriptBody = @"
`$ErrorActionPreference = 'Stop'
`$resPath = '$($elevResult.Replace("'", "''"))'
try {
  `$ops = Get-Content '$($elevPayload.Replace("'", "''"))' -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach (`$op in @(`$ops)) {
    if (`$op.kind -eq 'shell') {
      `$psPath = 'Registry::' + `$op.regPath
      if (-not (Test-Path -LiteralPath `$psPath)) { throw "注册表项不存在: `$(`$op.regPath)" }
      if ([bool]`$op.targetEnabled) {
        `$props = Get-ItemProperty -LiteralPath `$psPath -ErrorAction SilentlyContinue
        if (`$null -ne `$props -and (`$props.PSObject.Properties.Name -contains 'LegacyDisable')) {
          Remove-ItemProperty -LiteralPath `$psPath -Name 'LegacyDisable' -Force
        }
        if (`$null -ne `$props -and (`$props.PSObject.Properties.Name -contains 'ProgrammaticAccessOnly')) {
          Remove-ItemProperty -LiteralPath `$psPath -Name 'ProgrammaticAccessOnly' -Force
        }
      } else {
        New-ItemProperty -LiteralPath `$psPath -Name 'LegacyDisable' -Value '' -PropertyType String -Force | Out-Null
      }
    } elseif (`$op.kind -eq 'shellex') {
      `$clsid = ([string]`$op.clsid).Trim().ToUpperInvariant()
      `$hklmBlocked = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Blocked'
      if ([bool]`$op.targetEnabled -and (Test-Path `$hklmBlocked)) {
        `$p = Get-ItemProperty `$hklmBlocked -ErrorAction SilentlyContinue
        if (`$null -ne `$p -and (`$p.PSObject.Properties.Name -contains `$clsid)) {
          Remove-ItemProperty -Path `$hklmBlocked -Name `$clsid -Force
        }
      }
    }
  }
  [System.IO.File]::WriteAllText(`$resPath, '{"ok":true}', [System.Text.UTF8Encoding]::new(`$false))
} catch {
  `$errObj = @{ ok = `$false; error = `$_.Exception.Message } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText(`$resPath, `$errObj, [System.Text.UTF8Encoding]::new(`$false))
  exit 1
}
"@
      [System.IO.File]::WriteAllText($elevScript, $scriptBody, [System.Text.UTF8Encoding]::new($false))

      try {
        $proc = Start-Process -FilePath 'powershell.exe' `
          -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $elevScript) `
          -Verb RunAs -Wait -PassThru

        if (-not (Test-Path $elevResult)) {
          throw "管理员提权未完成（可能已取消 UAC 授权，退出码: $($proc.ExitCode)）"
        }
        $resObj = Get-Content $elevResult -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $resObj.ok) {
          throw "提权执行失败: $($resObj.error)"
        }
      } finally {
        Remove-Item $elevPayload, $elevResult, $elevScript -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

function Get-HistoryCount {
  $historyPath = Join-Path $BackupDir 'history.json'
  $historyCount = 0
  if (Test-Path $historyPath) {
    try {
      $hist = ConvertFrom-JsonArray (Get-Content $historyPath -Raw -Encoding UTF8)
      $historyCount = $hist.Count
    } catch {}
  }
  return $historyCount
}

function Invoke-RestoreAll {
  $historyPath = Join-Path $BackupDir 'history.json'
  if (-not (Test-Path $historyPath)) {
    return ([PSCustomObject]@{ ok = $true; restoredCount = 0; historyCount = 0; message = '暂无需要还原的修改记录' } | ConvertTo-Json -Compress)
  }
  $hist = ConvertFrom-JsonArray (Get-Content $historyPath -Raw -Encoding UTF8)
  if ($hist.Count -eq 0) {
    return ([PSCustomObject]@{ ok = $true; restoredCount = 0; historyCount = 0; message = '暂无需要还原的修改记录' } | ConvertTo-Json -Compress)
  }
  $restoreOps = @()
  foreach ($h in $hist) {
    $restoreOps += [PSCustomObject]@{
      id            = $h.id
      kind          = $h.kind
      hive          = $h.hive
      keyName       = $h.keyName
      displayName   = $h.displayName
      regPath       = $h.regPath
      clsid         = $h.clsid
      targetEnabled = [bool]$h.originalEnabled
      needsAdmin    = [bool]$h.needsAdmin
    }
  }
  Invoke-OperationsWithElevation -Operations $restoreOps
  Remove-Item $historyPath -Force -ErrorAction SilentlyContinue
  return ([PSCustomObject]@{
    ok                   = $true
    restoredCount        = $restoreOps.Count
    historyCount         = 0
    needsExplorerRestart = (@($restoreOps | Where-Object { $_.kind -eq 'shellex' }).Count -gt 0)
  } | ConvertTo-Json -Compress)
}

function Invoke-RestartExplorer {
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 600
  if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
    Start-Process explorer.exe
  }
  return ([PSCustomObject]@{ ok = $true } | ConvertTo-Json -Compress)
}

if ($Action -ne 'lib') {
  try {
    switch ($Action) {
      'scan' {
        Invoke-Scan
      }
      'toggle' {
        if ([string]::IsNullOrWhiteSpace($PayloadFile) -or -not (Test-Path $PayloadFile)) {
          throw '缺少有效的 PayloadFile 参数'
        }
        $raw = Get-Content $PayloadFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $ops = if ($raw -is [System.Array]) { $raw } else { @($raw) }
        if ($ops.Count -eq 0) {
          throw '操作列表为空'
        }
        $backups = Save-BackupAndHistory -Operations $ops
        Invoke-OperationsWithElevation -Operations $ops
        $needsExplorerRestart = (@($ops | Where-Object { $_.kind -eq 'shellex' }).Count -gt 0)
        [PSCustomObject]@{
          ok                   = $true
          appliedCount         = $ops.Count
          backupCount          = $backups.Count
          backupDir            = $BackupDir
          historyCount         = (Get-HistoryCount)
          needsExplorerRestart = $needsExplorerRestart
        } | ConvertTo-Json -Compress
      }
      'restore-all' {
        Invoke-RestoreAll
      }
      'restart-explorer' {
        Invoke-RestartExplorer
      }
    }
  } catch {
    [PSCustomObject]@{
      ok    = $false
      error = $_.Exception.Message
    } | ConvertTo-Json -Compress
    exit 1
  }
}
