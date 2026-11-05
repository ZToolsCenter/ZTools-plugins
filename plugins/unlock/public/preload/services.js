const {
  findLockingProcesses,
  killProcess,
  killLockingProcess,
  killAllLockingProcesses,
  verifyRelease,
  getDebugLog: unlockDebugLog
} = require('./unlock')
const { explainProcess, findPortOwnersByWitr, getDebugLog: whyDebugLog, findWitrBin } = require('./why')
const { buildShredScript, buildDeleteScript, parseShredResult } = require('./shredder')
const { buildPortQueryScript, parsePortOutput } = require('./portscan')
const { spawn } = require('node:child_process')

var _webUtils = null
try { _webUtils = require('electron').webUtils } catch (e) {}

var _debugLog = []
var TIMEOUT_MS = 30000

function debugPush(msg) { _debugLog.push(msg) }

function getDebugLog() {
  var logs = [].concat(unlockDebugLog ? unlockDebugLog() : [])
  logs = logs.concat(whyDebugLog ? whyDebugLog() : [])
  logs = logs.concat(_debugLog)
  _debugLog = []
  return logs
}

function execWithTimeout(cmd, args, label, options) {
  return new Promise(function (resolve, reject) {
    debugPush('  [' + (label || 'exec') + '] ' + cmd + ' ' + args.map(function (a) { return a.includes(' ') ? '"' + a + '"' : a }).join(' '))
    var proc = spawn(cmd, args, {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      cwd: options && options.cwd ? options.cwd : undefined
    })
    var stdout = ''
    var stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', function (d) { stdout += d })
    proc.stderr.on('data', function (d) { stderr += d })
    proc.on('error', function (err) {
      debugPush('  [' + (label || 'exec') + '] spawn error: ' + err.message)
      reject(new Error('spawn error: ' + err.message))
    })
    proc.on('close', function (code) {
      debugPush('  [' + (label || 'exec') + '] exit: ' + code)
      if (stderr.trim()) debugPush('  [' + (label || 'exec') + '] stderr: ' + stderr.trim().substring(0, 500))
      if (code !== 0) { reject(new Error(stderr.trim() || 'exit code ' + code)); return }
      resolve(stdout)
    })
  })
}

function getPathForFile(file) {
  if (!file) return ''
  if (_webUtils && _webUtils.getPathForFile) {
    try { var p = _webUtils.getPathForFile(file); if (p) return p } catch (e) {}
  }
  if (window.ztools && window.ztools.getPathForFile) {
    try { var p2 = window.ztools.getPathForFile(file); if (p2) return p2 } catch (e) {}
  }
  try { if (file.path) return file.path } catch (e) {}
  return ''
}

async function shredPath(filePath, mode) {
  _debugLog = []
  var resolved = require('node:path').resolve(filePath)
  debugPush('=== shredPath ===')
  debugPush('mode: ' + mode + ', path: ' + resolved)

  try {
    var script = mode === 'shred' ? buildShredScript(resolved) : buildDeleteScript(resolved)
    var tmpDir = require('node:os').tmpdir()
    var scriptPath = require('node:path').join(tmpDir, 'unlock-shred-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1')
    require('node:fs').writeFileSync(scriptPath, '﻿' + script, 'utf8')
    debugPush('[shred] temp script: ' + scriptPath)
    // 辅助进程用自己的空目录作为 cwd，避免它占住正在删除的文件夹
    var helperDir = ''
    try { helperDir = require('node:fs').mkdtempSync(require('node:path').join(tmpDir, 'unlock-shred-cwd-')) } catch (e) {}

    var raw
    try {
      raw = await execWithTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], 'shred', helperDir ? { cwd: helperDir } : undefined)
    } finally {
      try { require('node:fs').unlinkSync(scriptPath) } catch (e) {}
      if (helperDir) {
        try { require('node:fs').rmSync(helperDir, { recursive: true, force: true }) } catch (e) {}
      }
    }

    var result = parseShredResult(raw)
    debugPush('[shred] result: ' + result.message)
    debugPush('=== done ===')
    return result
  } catch (err) {
    debugPush('[shred] error: ' + err.message)
    debugPush('=== done ===')
    return { success: false, message: err.message, locked: false }
  }
}

async function findPortProcess(port) {
  _debugLog = []
  var portNum = parseInt(port, 10)
  debugPush('=== findPortProcess port: ' + portNum + ' ===')
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    debugPush('[portscan] invalid port')
    return []
  }

  try {
    // PRIMARY: witr --port --json (full Result: Process + Ancestry + Source + Sockets)
    debugPush('[portscan] witr --port (primary)...')
    var viaWitr = null
    try {
      viaWitr = await findPortOwnersByWitr(portNum)
    } catch (e) {
      debugPush('[portscan] witr --port error: ' + e.message)
    }

    if (viaWitr && viaWitr.length > 0) {
      debugPush('[portscan] witr found ' + viaWitr.length + ' entries')
      viaWitr.forEach(function (p) {
        debugPush('[portscan]   ' + p.processName + ' PID:' + p.pid + ' ' + p.protocol + ' ' + p.state + ' ' + p.localAddress + ':' + p.localPort)
        if (p.why && p.why.ancestryText) {
          debugPush('[portscan]   why: ' + p.why.ancestryText)
          debugPush('[portscan]   source: ' + (p.why.sourceLine || p.why.source.type))
        }
      })
      debugPush('=== done ===')
      return viaWitr
    }

    // FALLBACK: Get-NetTCPConnection / Get-NetUDPEndpoint
    debugPush('[portscan] falling back to Get-NetTCPConnection...')
    var script = buildPortQueryScript(portNum)
    var tmpDir = require('node:os').tmpdir()
    var scriptPath = require('node:path').join(tmpDir, 'unlock-port-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1')
    require('node:fs').writeFileSync(scriptPath, '﻿' + script, 'utf8')
    debugPush('[portscan] temp script: ' + scriptPath)

    var raw
    try {
      raw = await execWithTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], 'portscan')
    } finally {
      try { require('node:fs').unlinkSync(scriptPath) } catch (e) {}
    }

    var result = parsePortOutput(raw)
    debugPush('[portscan] found ' + result.length + ' entries')

    var withWhy = []
    for (var i = 0; i < result.length; i++) {
      var entry = result[i]
      var whyInfo = null
      try {
        whyInfo = await explainProcess(entry.pid)
      } catch (e) {
        debugPush('[portscan] why failed for PID ' + entry.pid + ': ' + e.message)
      }
      entry.why = whyInfo
      withWhy.push(entry)
      debugPush('[portscan]   ' + entry.processName + ' PID:' + entry.pid + ' ' + entry.protocol + ' ' + entry.state + ' ' + entry.localAddress + ':' + entry.localPort)
    }
    debugPush('=== done ===')
    return withWhy
  } catch (err) {
    debugPush('[portscan] error: ' + err.message)
    debugPush('=== done ===')
    return []
  }
}

async function explainPid(pid) {
  try {
    return await explainProcess(pid)
  } catch (e) {
    return null
  }
}

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

/**
 * 端口是否仍被监听（轻量检查，不写调试日志，供结束后闭环验证使用）。
 * @returns {Promise<boolean|null>} null = 无法确认
 */
async function portStillListening(portNum) {
  try {
    var viaWitr = await findPortOwnersByWitr(portNum)
    if (viaWitr) return viaWitr.length > 0
  } catch (e) {}

  try {
    var script = buildPortQueryScript(portNum)
    var tmpDir = require('node:os').tmpdir()
    var scriptPath = require('node:path').join(tmpDir, 'unlock-port-check-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1')
    require('node:fs').writeFileSync(scriptPath, '﻿' + script, 'utf8')
    var raw
    try {
      raw = await execWithTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], 'portcheck')
    } finally {
      try { require('node:fs').unlinkSync(scriptPath) } catch (e) {}
    }
    return parsePortOutput(raw).length > 0
  } catch (e) {
    return null
  }
}

/** 结束单个端口占用进程，并确认端口是否释放。 */
async function killPortProcess(port, pid, name) {
  var portNum = parseInt(port, 10)
  var label = name ? '「' + name + '」' : ('进程 ' + pid)
  var kill = await killProcess(pid, name)

  if (!kill.success) {
    return {
      success: false,
      released: false,
      level: 'error',
      message: kill.message,
      needsAdmin: !!kill.needsAdmin,
      kill: kill
    }
  }

  var listening = null
  for (var i = 0; i < 4; i++) {
    await delay(400)
    listening = await portStillListening(portNum)
    if (listening === false) break
  }

  if (listening === false) {
    return {
      success: true,
      released: true,
      level: 'success',
      message: '已解除占用：' + label + '已结束，端口 ' + portNum + ' 已释放。',
      kill: kill
    }
  }
  if (listening === true) {
    return {
      success: true,
      released: false,
      level: 'warning',
      message: label + '已结束，但端口 ' + portNum + ' 仍被监听：可能已被其他进程接管，请重新扫描查看。',
      kill: kill
    }
  }
  return {
    success: true,
    released: null,
    level: 'warning',
    message: label + '已结束。请重新扫描确认端口 ' + portNum + ' 是否已释放。',
    kill: kill
  }
}

/** 一键结束端口上的全部监听进程，并统一确认端口是否释放。 */
async function killAllPortProcesses(port, entries) {
  var portNum = parseInt(port, 10)
  var list = Array.isArray(entries) ? entries : []
  var seen = {}
  var pids = []
  for (var i = 0; i < list.length; i++) {
    var p = list[i]
    if (p && p.pid && !seen[p.pid]) { seen[p.pid] = true; pids.push({ pid: p.pid, name: p.processName }) }
  }
  if (pids.length === 0) {
    return { success: false, released: false, level: 'warning', message: '没有需要结束的进程。', killed: 0, failed: 0 }
  }

  var results = []
  for (var j = 0; j < pids.length; j++) {
    var r = await killProcess(pids[j].pid, pids[j].name)
    results.push(Object.assign({ pid: pids[j].pid, name: pids[j].name }, r))
  }

  var okCount = results.filter(function (r) { return r.success }).length
  var failCount = results.length - okCount
  var needsAdmin = results.some(function (r) { return r.needsAdmin })

  var listening = null
  for (var k = 0; k < 4; k++) {
    await delay(400)
    listening = await portStillListening(portNum)
    if (listening === false) break
  }

  var level = 'success'
  var message
  if (failCount === 0 && listening === false) {
    message = '已解除占用：' + okCount + ' 个进程已结束，端口 ' + portNum + ' 已释放。'
  } else if (failCount === 0 && listening === true) {
    level = 'warning'
    message = '已结束 ' + okCount + ' 个进程，但端口 ' + portNum + ' 仍被监听：可能已被其他进程接管，请重新扫描查看。'
  } else if (failCount === 0) {
    level = 'warning'
    message = '已结束 ' + okCount + ' 个进程。请重新扫描确认端口 ' + portNum + ' 是否已释放。'
  } else if (okCount > 0) {
    level = 'warning'
    message = '已结束 ' + okCount + ' 个进程，另有 ' + failCount + ' 个无法结束' +
      (needsAdmin ? '（需要管理员权限）' : '') + '。'
  } else {
    level = 'error'
    message = '未能结束任何进程。' + (needsAdmin ? '请以管理员身份运行 ZTools 后重试。' : '请在任务管理器中手动结束这些进程。')
  }

  return {
    success: okCount > 0,
    released: listening === false ? true : (listening === true ? false : null),
    level: level,
    message: message,
    killed: okCount,
    failed: failCount,
    needsAdmin: needsAdmin,
    results: results
  }
}

function getWhyEngine() {
  return findWitrBin() ? 'witr' : 'native'
}

window.services = {
  findLockingProcesses: findLockingProcesses,
  killProcess: killProcess,
  killLockingProcess: killLockingProcess,
  killAllLockingProcesses: killAllLockingProcesses,
  verifyRelease: verifyRelease,
  killPortProcess: killPortProcess,
  killAllPortProcesses: killAllPortProcesses,
  shredPath: shredPath,
  findPortProcess: findPortProcess,
  explainPid: explainPid,
  getWhyEngine: getWhyEngine,
  getDebugLog: getDebugLog,
  getPathForFile: getPathForFile
}
