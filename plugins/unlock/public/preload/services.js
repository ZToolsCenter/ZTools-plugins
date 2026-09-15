const { findLockingProcesses, killProcess, getDebugLog: unlockDebugLog } = require('./unlock')
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
  logs = logs.concat(_debugLog)
  _debugLog = []
  return logs
}

function execWithTimeout(cmd, args, label) {
  return new Promise(function (resolve, reject) {
    debugPush('  [' + (label || 'exec') + '] ' + cmd + ' ' + args.map(function (a) { return a.includes(' ') ? '"' + a + '"' : a }).join(' '))
    var proc = spawn(cmd, args, { timeout: TIMEOUT_MS })
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
    require('node:fs').writeFileSync(scriptPath, '\uFEFF' + script, 'utf8')
    debugPush('[shred] temp script: ' + scriptPath)

    var raw
    try {
      raw = await execWithTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], 'shred')
    } finally {
      try { require('node:fs').unlinkSync(scriptPath) } catch (e) {}
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
    var script = buildPortQueryScript(portNum)
    var tmpDir = require('node:os').tmpdir()
    var scriptPath = require('node:path').join(tmpDir, 'unlock-port-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1')
    require('node:fs').writeFileSync(scriptPath, '\uFEFF' + script, 'utf8')
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
    result.forEach(function (p) {
      debugPush('[portscan]   ' + p.processName + ' PID:' + p.pid + ' ' + p.protocol + ' ' + p.state + ' ' + p.localAddress + ':' + p.localPort)
    })
    debugPush('=== done ===')
    return result
  } catch (err) {
    debugPush('[portscan] error: ' + err.message)
    debugPush('=== done ===')
    return []
  }
}

window.services = {
  findLockingProcesses: findLockingProcesses,
  killProcess: killProcess,
  shredPath: shredPath,
  findPortProcess: findPortProcess,
  getDebugLog: getDebugLog,
  getPathForFile: getPathForFile
}
