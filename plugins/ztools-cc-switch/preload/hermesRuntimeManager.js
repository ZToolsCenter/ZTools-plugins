'use strict'

const http = require('node:http')
const { execFile: execFileCallback } = require('node:child_process')
const { promisify } = require('node:util')

const defaultExecFile = promisify(execFileCallback)
const HERMES_WEB_OFFLINE_ERROR = 'hermes_web_offline'
const DEFAULT_HERMES_WEB_PORT = 9119

function resolvePort(raw) {
  const value = Number.parseInt(String(raw || ''), 10)
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : DEFAULT_HERMES_WEB_PORT
}

function normalizeWebPath(input) {
  const raw = String(input || '/').trim()
  if (!raw) return '/'
  if (/^https?:/i.test(raw) || /[\r\n\0]/.test(raw)) throw new Error('Hermes Web UI 路径无效')
  const pathname = raw.startsWith('/') ? raw : `/${raw}`
  const parsed = new URL(pathname, 'http://127.0.0.1')
  if (parsed.hostname !== '127.0.0.1') throw new Error('Hermes Web UI 路径无效')
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function createHermesRuntimeManager(options = {}) {
  const platform = options.platform || process.platform
  const execFile = options.execFile || defaultExecFile
  const openExternal = options.openExternal || (async () => { throw new Error('未配置外部链接打开能力') })
  const request = options.request || http.request
  const port = resolvePort(options.port ?? process.env.HERMES_WEB_PORT)
  const baseUrl = `http://127.0.0.1:${port}`

  async function probeWebUi() {
    const statusCode = await new Promise((resolve, reject) => {
      const req = request(`${baseUrl}/api/status`, { method: 'GET', agent: false }, (response) => {
        response.resume?.()
        resolve(Number(response.statusCode || 0))
      })
      req.setTimeout(1200, () => req.destroy(new Error(HERMES_WEB_OFFLINE_ERROR)))
      req.once('error', reject)
      req.end()
    }).catch(() => 0)
    const online = statusCode === 200 || statusCode === 401
    return { online, statusCode: statusCode || null, baseUrl, error: online ? null : HERMES_WEB_OFFLINE_ERROR }
  }

  async function openWebUi(pathInput) {
    const status = await probeWebUi()
    if (!status.online) {
      const error = new Error(HERMES_WEB_OFFLINE_ERROR)
      error.code = HERMES_WEB_OFFLINE_ERROR
      throw error
    }
    const target = `${baseUrl}${normalizeWebPath(pathInput)}`
    await openExternal(target)
    return { ...status, opened: true, target }
  }

  async function launchDashboard() {
    // 固定白名单命令；网页层无法传入或拼接任意 shell 内容。
    if (platform === 'darwin') {
      const script = 'tell application "Terminal"\nactivate\ndo script "hermes dashboard"\nend tell'
      await execFile('osascript', ['-e', script], { timeout: 10000 })
    } else if (platform === 'win32') {
      await execFile('powershell.exe', ['-NoProfile', '-Command', "Start-Process powershell.exe -ArgumentList @('-NoExit','-Command','hermes dashboard')"], { timeout: 10000 })
    } else {
      await execFile('x-terminal-emulator', ['-e', 'bash', '-lc', 'exec hermes dashboard'], { timeout: 10000 })
    }
    return { launched: true, command: 'hermes dashboard' }
  }

  return { probeWebUi, openWebUi, launchDashboard }
}

module.exports = { DEFAULT_HERMES_WEB_PORT, HERMES_WEB_OFFLINE_ERROR, normalizeWebPath, resolvePort, createHermesRuntimeManager }
