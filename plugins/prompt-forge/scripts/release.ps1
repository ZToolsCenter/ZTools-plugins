# PromptForge 一键发布脚本
# 用法：.\scripts\release.ps1 [-Version "1.6.0"] [-SkipCheck] [-ResolveConflict]
#
# 参数：
#   -Version        目标版本号（可选，不传则使用当前 package.json 版本）
#   -SkipCheck      跳过质量检查（默认执行 lint + test + build）
#   -ResolveConflict 仅执行冲突解决 + 继续发布（用于 ztools publish 首次失败后）

param(
    [string]$Version = "",
    [switch]$SkipCheck,
    [switch]$ResolveConflict
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  PromptForge 发布脚本" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ========== 模式一：仅解决冲突并继续发布 ==========
if ($ResolveConflict) {
    Write-Host "[1/2] 解决上游同步冲突（用本地版本覆盖）..." -ForegroundColor Yellow
    git add CHANGELOG.md RELEASE.md ROADMAP.md package-lock.json package.json plugin.json public/plugin.json src/
    if ($LASTEXITCODE -ne 0) { Write-Host "❌ git add 失败" -ForegroundColor Red; exit 1 }
    Write-Host "  ✓ 已标记冲突文件" -ForegroundColor Green

    Write-Host "[2/2] 继续同步并发布..." -ForegroundColor Yellow
    ztools sync-upstream --continue
    if ($LASTEXITCODE -ne 0) { Write-Host "❌ sync-upstream --continue 失败" -ForegroundColor Red; exit 1 }
    Write-Host "  ✓ 同步完成" -ForegroundColor Green

    git commit -m "chore: merge upstream changes"
    if ($LASTEXITCODE -ne 0) { Write-Host "⚠ git commit 可能无变更（正常）" -ForegroundColor DarkGray }

    ztools publish
    if ($LASTEXITCODE -ne 0) { Write-Host "❌ publish 失败" -ForegroundColor Red; exit 1 }
    Write-Host "`n✅ 发布完成！`n" -ForegroundColor Green
    exit 0
}

# ========== 模式二：完整发布流程 ==========

# 步骤 1：同步版本号（如果指定了 -Version）
if ($Version) {
    Write-Host "[1/5] 更新版本号到 $Version ..." -ForegroundColor Yellow
    $files = @("package.json", "plugin.json", "public/plugin.json")
    foreach ($f in $files) {
        $content = Get-Content $f -Raw
        $content = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
        Set-Content $f $content -NoNewline
        Write-Host "  ✓ $f" -ForegroundColor Green
    }
    # package-lock.json
    $lock = Get-Content "package-lock.json" -Raw | ConvertFrom-Json
    $lock.version = $Version
    if ($lock.packages.'') { $lock.packages.''.version = $Version }
    $lock | ConvertTo-Json -Depth 10 | Set-Content "package-lock.json" -NoNewline
    Write-Host "  ✓ package-lock.json" -ForegroundColor Green
    # ROADMAP.md
    $roadmap = Get-Content "ROADMAP.md" -Raw
    $roadmap = $roadmap -replace '当前版本：v[\d.]+', "当前版本：v$Version"
    Set-Content "ROADMAP.md" $roadmap -NoNewline
    Write-Host "  ✓ ROADMAP.md" -ForegroundColor Green
} else {
    Write-Host "[1/5] 使用当前版本号" -ForegroundColor Yellow
    $pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
    $Version = $pkg.version
    Write-Host "  → v$Version" -ForegroundColor Cyan
}

# 步骤 2：质量检查
if (-not $SkipCheck) {
    Write-Host "[2/5] 执行质量检查..." -ForegroundColor Yellow
    npm run check
    if ($LASTEXITCODE -ne 0) { Write-Host "❌ 质量检查失败，停止发布" -ForegroundColor Red; exit 1 }
    Write-Host "  ✓ 质量检查通过" -ForegroundColor Green
} else {
    Write-Host "[2/5] 跳过质量检查（-SkipCheck）" -ForegroundColor DarkGray
}

# 步骤 3：打包 .zpx
Write-Host "[3/5] 打包 .zpx ..." -ForegroundColor Yellow
$zpxFile = "prompt-forge-v$Version.zpx"
if (Test-Path $zpxFile) { Remove-Item $zpxFile }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory("dist", $zpxFile)
$size = [math]::Round((Get-Item $zpxFile).Length / 1KB, 1)
Write-Host "  ✓ $zpxFile ($size KB)" -ForegroundColor Green

# 步骤 4：提交 + 打 tag
Write-Host "[4/5] 提交并打 tag ..." -ForegroundColor Yellow
git add -A
git commit -m "release: v$Version"
git tag "v$Version"
Write-Host "  ✓ 已提交并打 tag v$Version" -ForegroundColor Green

# 步骤 5：发布
Write-Host "[5/5] 发布到插件市场 ..." -ForegroundColor Yellow
ztools publish
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n⚠ ztools publish 遇到上游冲突，执行冲突解决..." -ForegroundColor Yellow
    git add CHANGELOG.md RELEASE.md ROADMAP.md package-lock.json package.json plugin.json public/plugin.json src/
    ztools sync-upstream --continue
    git commit -m "chore: merge upstream changes" 2>$null
    ztools publish
    if ($LASTEXITCODE -ne 0) { Write-Host "❌ 发布失败" -ForegroundColor Red; exit 1 }
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  ✅ v$Version 发布完成！" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Green
Write-Host "发布产物：$zpxFile" -ForegroundColor Cyan
Write-Host "远程分支：git push origin main --tags" -ForegroundColor Cyan
