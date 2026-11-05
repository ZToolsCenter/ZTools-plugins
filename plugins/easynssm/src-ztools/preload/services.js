const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const IS_WIN = process.platform === 'win32'
const NSSM_PATH_KEY = 'easynssm_nssm_path'

// nssm 参数注册表键（HKLM\SYSTEM\CurrentControlSet\Services\<名>\Parameters 下）
const NSSM_PARAM_KEYS = [
  'AppDirectory', 'AppApplication', 'AppParameters', 'AppStdout', 'AppStderr',
  'AppRotateFiles', 'AppRotateOnline', 'AppRotateBytes', 'AppRotateSeconds',
  'AppExit', 'AppRestartDelay', 'AppThrottle', 'AppPriority',
  'AppStopMethodSkip', 'AppStopMethodConsole', 'AppEnvironment'
]

// ==================== 基础设施 ====================

// PowerShell -EncodedCommand 需要 UTF-16LE base64，免引号/转义地狱
function b64(script) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

// PowerShell 单引号字符串转义（'' 表示字面单引号）
function psq(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"
}

// 异步执行 PowerShell（不阻塞渲染进程 UI）
function runPS(script, timeout) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      resolve({ ok: false, stdout: '', stderr: '仅支持 Windows 系统', error: '仅支持 Windows 系统' })
      return
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64(script)],
      { windowsHide: true, timeout: timeout || 60000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', error: err ? err.message : '' })
      }
    )
  })
}

// 结果走临时 JSON 文件回读，绕开控制台编码（中文乱码）问题
async function runPSJson(script, timeout) {
  const out = tempFile('json')
  const full =
    script +
    '\n[IO.File]::WriteAllText(' + psq(out) +
    ', ($result | ConvertTo-Json -Depth 6 -Compress), [Text.Encoding]::UTF8)'
  const r = await runPS(full, timeout)
  let data = null
  try {
    data = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) { /* 文件不存在或非法 JSON */ }
  try { fs.unlinkSync(out) } catch (e) { /* 忽略清理失败 */ }
  if (!data) {
    return { ok: false, error: (r.error || r.stderr || 'PowerShell 执行失败').slice(0, 300) }
  }
  return { ok: true, data }
}

function tempFile(ext) {
  return path.join(os.tmpdir(), 'easynssm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext)
}

// ==================== 权限 ====================

// 检测 ZTools 是否以管理员运行（不提权、不弹窗）
async function isAdmin() {
  const script =
    "$r = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)\n" +
    '$result = @{ isAdmin = $r }'
  const r = await runPSJson(script, 20000)
  return !!(r.ok && r.data && r.data.isAdmin)
}

// ==================== 系统服务查询（不需要管理员） ====================

async function listServices() {
  const script =
    "$ErrorActionPreference = 'Stop'\n" +
    'try {\n' +
    '  $list = Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,PathName,StartName,Description,ProcessId,ExitCode\n' +
    '  $result = @{ error = \'\'; services = @($list) }\n' +
    "} catch { $result = @{ error = $_.Exception.Message; services = @() } }"
  const r = await runPSJson(script, 90000)
  if (!r.ok) return r
  let svcs = (r.data && r.data.services) || []
  // 单条记录时 ConvertTo-Json 不输出数组，统一包装成数组
  if (!Array.isArray(svcs)) svcs = [svcs]
  return { ok: true, services: svcs, error: (r.data && r.data.error) || '' }
}

// ==================== nssm 路径管理与探测 ====================

function getNssmPath() {
  try {
    const v = window.ztools.dbStorage.getItem(NSSM_PATH_KEY)
    return (v && String(v)) || ''
  } catch (e) {
    return ''
  }
}

// 直接探测指定 nssm 路径是否可用（跑 nssm version，不需要管理员）
function probeNssm(p) {
  return new Promise((resolve) => {
    if (!p || !fs.existsSync(p)) {
      resolve('')
      return
    }
    execFile(p, ['version'], { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) => {
      const text = String(stdout || '') + String(stderr || '')
      resolve(/nssm\s+\d/i.test(text) ? text.trim().split(/\r?\n/)[0] : '')
    })
  })
}

// 探测顺序：用户已保存路径 → where.exe → 已注册 nssm 服务的 binPath 反向提取 → 常见安装位置
async function detectNssm() {
  const candidates = []
  const saved = getNssmPath()
  if (saved) candidates.push(saved)
  const found = await new Promise((resolve) => {
    if (!IS_WIN) return resolve('')
    execFile('where.exe', ['nssm.exe'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || '').split(/\r?\n/)[0].trim())
    })
  })
  if (found) candidates.push(found)
  // nssm 不在 PATH/常见位置时，它创建过的服务的 binPath 里一定写着完整路径
  const svcList = await listServices()
  if (svcList.ok) {
    for (const s of svcList.services) {
      const pn = String((s && s.PathName) || '')
      if (!/nssm\.exe/i.test(pn)) continue
      const m = /^"([^"]+nssm\.exe)"/i.exec(pn) || /^([^\s"]+nssm\.exe)/i.exec(pn)
      if (m) candidates.push(m[1])
    }
  }
  candidates.push(
    'C:\\nssm\\nssm.exe',
    'C:\\nssm.exe',
    'C:\\Program Files\\nssm\\win64\\nssm.exe',
    'C:\\Program Files (x86)\\nssm\\win32\\nssm.exe',
    'C:\\ProgramData\\chocolatey\\bin\\nssm.exe',
    path.join(os.homedir(), 'scoop', 'shims', 'nssm.exe')
  )
  for (const c of Array.from(new Set(candidates))) {
    const version = await probeNssm(c)
    if (version) return { found: true, path: c, version }
  }
  return { found: false, path: '', version: '' }
}

// 保存用户手动指定的 nssm 路径（先验证再落库）
async function saveNssmPath(p) {
  const version = await probeNssm(p)
  if (!version) {
    return { ok: false, message: '该路径不是可用的 nssm.exe（version 命令无响应）' }
  }
  try {
    window.ztools.dbStorage.setItem(NSSM_PATH_KEY, String(p))
  } catch (e) {
    return { ok: false, message: '保存失败：' + e.message }
  }
  return { ok: true, message: '已保存：' + version }
}

// ==================== nssm 配置读取（注册表，普通用户可读） ====================

async function getNssmConfig(name) {
  const keys = NSSM_PARAM_KEYS.map(psq).join(',')
  const script =
    "$svc = " + psq(name) + '\n' +
    'try {\n' +
    '  $p = Get-ItemProperty -Path ("HKLM:\\SYSTEM\\CurrentControlSet\\Services\\" + $svc + "\\Parameters") -ErrorAction Stop\n' +
    '  $c = @{}\n' +
    '  foreach ($k in @(' + keys + ')) {\n' +
    '    if ($p.PSObject.Properties.Name -contains $k) { $c[$k] = $p.$k }\n' +
    '  }\n' +
    '  $result = @{ error = \'\'; config = $c }\n' +
    "} catch { $result = @{ error = $_.Exception.Message; config = @{} } }"
  const r = await runPSJson(script, 30000)
  if (!r.ok) return r
  const cfg = (r.data && r.data.config) || {}
  if (cfg.AppEnvironment != null && !Array.isArray(cfg.AppEnvironment)) {
    cfg.AppEnvironment = [cfg.AppEnvironment]
  }
  return { ok: true, config: cfg, error: (r.data && r.data.error) || '' }
}

// ==================== 提权命令执行（双轨：管理员直跑 / UAC 弹窗） ====================

// ops/结果文件放 ProgramData（跨账户共享）：UAC 可能以另一个管理员账户提权，
// 其 %TEMP% 与当前用户不同，结果会写到别处导致插件读不到
const SHARED_DIR = 'C:\\ProgramData\\easynssm'

function sharedFile(ext) {
  return path.join(SHARED_DIR, 'easynssm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext)
}

// ops 是 PowerShell 命令字符串数组。参数一律用 psq() 包裹，避免注入。
async function runCommands(ops, timeout) {
  const opsFile = sharedFile('ops.json')
  const outFile = sharedFile('result.json')
  fs.mkdirSync(SHARED_DIR, { recursive: true })
  // 操作清单走文件传递，规避多层引号嵌套
  fs.writeFileSync(opsFile, JSON.stringify(ops), 'utf8')
  const OPS = psq(opsFile)
  const OUT = psq(outFile)
  // 主体整体包 try/catch：任何异常（含 ops 解析失败）都回写结果，杜绝「进程结束但无回写」
  const inner =
    "$ErrorActionPreference = 'Continue'\n" +
    'try {\n' +
    '  New-Item -ItemType Directory -Force -Path ' + psq(SHARED_DIR) + ' | Out-Null\n' +
    '  $ops = ConvertFrom-Json ([IO.File]::ReadAllText(' + OPS + '))\n' +
    '  $results = New-Object System.Collections.ArrayList\n' +
    '  $fail = 0\n' +
    "  $lastErr = ''\n" +
    '  foreach ($op in $ops) {\n' +
    "    $o = ''\n" +
    '    $c = 0\n' +
    '    try {\n' +
    '      $o = (Invoke-Expression $op) 2>&1 | Out-String\n' +
    '      if ($LASTEXITCODE -ne $null) { $c = $LASTEXITCODE }\n' +
    '    } catch {\n' +
    '      $o = $_.Exception.Message\n' +
    '      $c = -1\n' +
    '    }\n' +
    '    if ($c -ne 0) { $fail = 1; $lastErr = $o }\n' +
    '    [void]$results.Add(@{ op = $op; code = $c; output = ("" + $o).Trim() })\n' +
    '  }\n' +
    '  $result = @{ exitCode = $fail; message = $lastErr; output = $results }\n' +
    '} catch {\n' +
    '  $result = @{ exitCode = -5; message = ("提权脚本异常: " + $_.Exception.Message); output = @() }\n' +
    '}'

  const admin = await isAdmin()
  // 写结果这一行必须拼进被编码执行的脚本本体——两个分支共用，漏拼会导致提权进程算完不落盘
  const writeResult =
    '\n[IO.File]::WriteAllText(' + OUT + ', ($result | ConvertTo-Json -Depth 6 -Compress), [Text.Encoding]::UTF8)'
  let r
  if (admin) {
    // 快路径：ZTools 已是管理员，直接执行，零弹窗
    r = await runPS(inner + writeResult, timeout || 300000)
  } else {
    // 慢路径：UAC 提权执行，结果写共享目录后轮询回读。
    // 不用 -Wait：实测 -Wait 配合 -Verb RunAs 会提前返回（ExitCode 为空），与提权进程产生竞态
    const outer =
      'try {\n' +
      "  $p = Start-Process powershell.exe -Verb RunAs -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','" + b64(inner + writeResult) + "')\n" +
      '  $sw = [Diagnostics.Stopwatch]::StartNew()\n' +
      '  while (-not (Test-Path ' + OUT + ') -and $sw.Elapsed.TotalSeconds -lt 120) { Start-Sleep -Milliseconds 500 }\n' +
      '  if (-not (Test-Path ' + OUT + ')) {\n' +
      "    $alive = '?'\n" +
      '    try { $alive = (-not $p.HasExited) } catch {}\n' +
      "    $r = @{ exitCode = 2; message = ('等待提权结果超时：PID=' + $p.Id + ' HasExited=' + $alive + '。若无 UAC 弹窗，请检查是否被置顶窗口遮挡或被安全策略拦截'); output = @() }\n" +
      '    [IO.File]::WriteAllText(' + OUT + ', ($r | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)\n' +
      '  }\n' +
      '} catch {\n' +
      '  $msg = $_.Exception.Message\n' +
      "  if ($msg -match 'cancel') { $msg = 'UAC 确认被取消' }\n" +
      '  [IO.File]::WriteAllText(' + OUT + ", (@{ exitCode = 3; message = $msg; output = @() } | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)\n" +
      '}\n' +
      '$result = @{ exitCode = 0; message = \'\' }'
    r = await runPS(outer, timeout || 180000)
  }

  let data = null
  try {
    data = JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) { /* 未回写 */ }
  try { fs.unlinkSync(outFile) } catch (e) { /* 清理 */ }
  try { fs.unlinkSync(opsFile) } catch (e) { /* 清理 */ }
  if (!data) {
    return { exitCode: -99, message: (r.error || r.stderr || '无法回读提权执行结果').slice(0, 300), output: [] }
  }
  return data
}

// ==================== 命令构造（纯函数，渲染层可先预览再执行） ====================

const START_TYPE_SC = { auto: 'auto', delayed: 'delayed-auto', manual: 'demand', disabled: 'disabled' }

// nssm 安装/编辑的命令清单
function buildNssmOps(payload) {
  const nssm = psq(payload.nssmPath)
  const name = payload.name
  const ops = []
  const set = function () {
    const args = Array.prototype.slice.call(arguments).map(psq)
    ops.push('& ' + nssm + ' set ' + psq(name) + ' ' + args.join(' '))
  }
  if (payload.mode === 'install') {
    const installArgs = ['install', name, payload.application]
    if (payload.parameters) installArgs.push(payload.parameters)
    ops.push('& ' + nssm + ' ' + installArgs.map(psq).join(' '))
  } else {
    // 编辑模式：install 时已写入的项改走 set 覆盖
    if (payload.application) set('AppApplication', payload.application)
    if (payload.parameters) set('AppParameters', payload.parameters)
  }
  if (payload.appDirectory) set('AppDirectory', payload.appDirectory)
  if (payload.stdout) set('AppStdout', payload.stdout)
  if (payload.stderr) set('AppStderr', payload.stderr)
  if (payload.rotate) {
    set('AppRotateFiles', '1')
    if (payload.rotateOnline) set('AppRotateOnline', '1')
    if (payload.rotateBytes) set('AppRotateBytes', String(payload.rotateBytes))
  }
  if (payload.exitCode !== '' && payload.exitCode != null && payload.exitAction) {
    set('AppExit', String(payload.exitCode), payload.exitAction)
  }
  if (payload.restartDelay !== '' && payload.restartDelay != null) set('AppRestartDelay', String(payload.restartDelay))
  if (payload.throttle) set('AppThrottle', String(payload.throttle))
  if (payload.priority) set('AppPriority', payload.priority)
  if (payload.stopSkip) set('AppStopMethodSkip', String(payload.stopSkip))
  if (payload.environment && payload.environment.length) {
    ops.push('& ' + nssm + ' set ' + psq(name) + ' AppEnvironment ' + payload.environment.map(psq).join(' '))
  }
  if (payload.startType && START_TYPE_SC[payload.startType]) {
    ops.push('& sc.exe config ' + psq(name) + ' start= ' + START_TYPE_SC[payload.startType])
  }
  return ops
}

// 卸载 nssm 服务
function buildRemoveOp(nssmPath, name) {
  return '& ' + psq(nssmPath) + ' remove ' + psq(name) + ' confirm'
}

// 服务启停 / 重启（重启合并为一条操作：停 → 轮询等停 → 启，一次 UAC）
function buildServiceActionOps(name, action) {
  const n = psq(name)
  if (action === 'start') return ['& sc.exe start ' + n]
  if (action === 'stop') return ['& sc.exe stop ' + n]
  if (action === 'restart') {
    return [
      '& sc.exe stop ' + n + ' | Out-Null\n' +
      '$d = (Get-Date).AddSeconds(20)\n' +
      "while ((Get-Date) -lt $d) { $sv = Get-Service -Name " + n + " -ErrorAction SilentlyContinue; if ($sv -and $sv.Status -eq 'Stopped') { break }; Start-Sleep -Milliseconds 400 }\n" +
      '& sc.exe start ' + n
    ]
  }
  return []
}

// 改启动类型（sc config，系统服务和 nssm 服务通用）
function buildStartTypeOp(name, startType) {
  const v = START_TYPE_SC[startType]
  if (!v) return []
  return ['& sc.exe config ' + psq(name) + ' start= ' + v]
}

// ==================== 日志查看（读 nssm 重定向的日志文件尾部，不需要提权） ====================

// 读文件最后 ~512KB，按行取尾部。日志可能是 UTF-8 或 GBK（Java 默认平台编码）：
// 先按 UTF-8 解码，出现过多替换符则回退 GBK
function readLogTail(p, maxLines) {
  return new Promise((resolve) => {
    maxLines = maxLines || 200
    try {
      if (!p || !fs.existsSync(p)) {
        resolve({ ok: false, error: '日志文件不存在（可能尚未产生输出）：' + (p || '未配置') })
        return
      }
      const size = fs.statSync(p).size
      const readBytes = Math.min(size, 512 * 1024)
      const buf = Buffer.alloc(readBytes)
      const fd = fs.openSync(p, 'r')
      fs.readSync(fd, buf, 0, readBytes, size - readBytes)
      fs.closeSync(fd)
      let text = buf.toString('utf8')
      const bad = (text.match(/\uFFFD/g) || []).length
      if (bad > text.length * 0.01) {
        try {
          text = new TextDecoder('gbk').decode(buf)
        } catch (e) { /* 无 GBK 解码器则维持 UTF-8 结果 */ }
      }
      const arr = text.split(/\r?\n/)
      if (arr.length && arr[arr.length - 1] === '') arr.pop()
      const total = arr.length
      const truncated = readBytes < size || total > maxLines
      resolve({ ok: true, content: arr.slice(-maxLines).join('\n'), truncated })
    } catch (e) {
      resolve({ ok: false, error: '读取日志失败：' + e.message })
    }
  })
}

// ==================== 注入渲染层 ====================

window.services = {
  isAdmin,
  listServices,
  getNssmConfig,
  detectNssm,
  getNssmPath,
  saveNssmPath,
  runCommands,
  buildNssmOps,
  buildRemoveOp,
  buildServiceActionOps,
  buildStartTypeOp,
  readLogTail
}
