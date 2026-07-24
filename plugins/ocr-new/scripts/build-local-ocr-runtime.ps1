$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildRoot = Join-Path $ProjectRoot ".runtime-build"
$VenvDir = Join-Path $BuildRoot ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$ServerScript = Join-Path $ProjectRoot "local-ocr-server\server.py"
$Requirements = Join-Path $ProjectRoot "local-ocr-server\requirements.txt"
$RuntimeRoot = Join-Path $ProjectRoot "public\local-ocr-runtime\win32"
$WorkPath = Join-Path $BuildRoot "pyinstaller-work"
$SpecPath = Join-Path $BuildRoot "pyinstaller-spec"

function Invoke-FirstPython {
  param([string[]]$Arguments)

  $candidates = @(
    @{ Command = "py"; Args = @("-3") },
    @{ Command = "python"; Args = @() },
    @{ Command = "python3"; Args = @() }
  )

  foreach ($candidate in $candidates) {
    try {
      & $candidate.Command @($candidate.Args + $Arguments)
      if ($LASTEXITCODE -eq 0) { return }
    } catch {
    }
  }

  throw "Python 3 was not found. Install Python 3 to build the bundled runtime."
}

function Test-PythonModule {
  param([string]$ModuleName)

  & $VenvPython -c "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('$ModuleName') else 1)" *> $null
  return $LASTEXITCODE -eq 0
}

New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

if (!(Test-Path $VenvPython)) {
  Invoke-FirstPython -Arguments @("-m", "venv", $VenvDir)
}

& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r $Requirements pyinstaller

$collectArgs = @()
foreach ($module in @("rapidocr", "rapidocr_onnxruntime", "onnxruntime", "cv2", "numpy", "PIL", "pyclipper", "shapely")) {
  if (Test-PythonModule $module) {
    $collectArgs += @("--collect-all", $module)
  }
}

$existingRuntime = Join-Path $RuntimeRoot "rapidocr-server"
if (Test-Path $existingRuntime) {
  Remove-Item -Recurse -Force $existingRuntime
}

& $VenvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name rapidocr-server `
  --distpath $RuntimeRoot `
  --workpath $WorkPath `
  --specpath $SpecPath `
  --hidden-import rapidocr_onnxruntime `
  --hidden-import rapidocr `
  --hidden-import onnxruntime `
  --hidden-import onnxruntime.capi._pybind_state `
  --hidden-import onnxruntime.capi.onnxruntime_pybind11_state `
  --collect-submodules onnxruntime `
  --collect-binaries onnxruntime `
  @collectArgs `
  $ServerScript

$info = [ordered]@{
  platform = "win32"
  kind = "pyinstaller-onedir"
  entry = "win32/rapidocr-server/rapidocr-server.exe"
  builtAt = (Get-Date).ToString("s")
}
$info | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path (Split-Path $RuntimeRoot -Parent) "runtime-info.json")

Write-Host "Bundled RapidOCR runtime built at: $RuntimeRoot"