'use strict'

/**
 * Rust sidecar JSON Lines 客户端。
 *
 * 每次请求启动一个短生命周期进程：避免插件窗口隐藏后残留守护进程，
 * 同时保持 stdin/stdout 协议可独立调试。全程不使用 shell，参数不会参与命令拼接。
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')

const PLATFORM_NAMES = Object.freeze({
  darwin: 'darwin',
  win32: 'win32',
  linux: 'linux'
})

const ARCH_NAMES = Object.freeze({
  arm64: 'arm64',
  x64: 'x64'
})

function binaryFilename(platform = process.platform, arch = process.arch) {
  const platformName = PLATFORM_NAMES[platform]
  const archName = ARCH_NAMES[arch]
  if (!platformName || !archName) return null
  return `cc-switch-sidecar-${platformName}-${archName}${platform === 'win32' ? '.exe' : ''}`
}

function createSidecarClient(options = {}) {
  const filename = binaryFilename(options.platform, options.arch)
  const binaryPath = options.binaryPath
    ? path.resolve(options.binaryPath)
    : filename
      ? path.join(__dirname, 'bin', filename)
      : null
  const timeoutMs = Number(options.timeoutMs) || 15000
  const maxOutputBytes = Number(options.maxOutputBytes) || 1024 * 1024

  function isAvailable() {
    if (!binaryPath) return false
    try {
      fs.accessSync(binaryPath, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  function request(method, params = {}) {
    if (!isAvailable()) {
      return Promise.reject(new Error(`Rust sidecar 不可用：${binaryPath || '当前平台没有构建产物'}`))
    }
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      const child = spawn(binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(new Error(`Rust sidecar 请求超时（${timeoutMs} ms）`))
      }, timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        if (Buffer.byteLength(stdout) > maxOutputBytes) {
          child.kill('SIGKILL')
          finish(new Error('Rust sidecar 输出超过安全限制'))
        }
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
        if (Buffer.byteLength(stderr) > maxOutputBytes) stderr = stderr.slice(-maxOutputBytes)
      })
      child.on('error', (error) => finish(new Error(`无法启动 Rust sidecar：${error.message}`)))
      child.on('close', (code) => {
        if (settled) return
        const line = stdout.split(/\r?\n/).find((item) => item.trim())
        if (!line) {
          finish(new Error(`Rust sidecar 未返回结果${stderr ? `：${stderr.trim()}` : `（退出码 ${code}）`}`))
          return
        }
        try {
          const response = JSON.parse(line)
          if (response.id !== id) throw new Error('响应 ID 不匹配')
          if (!response.ok) throw new Error(response.error || 'Rust sidecar 执行失败')
          finish(null, response.result)
        } catch (error) {
          finish(new Error(`Rust sidecar 响应无效：${error.message}`))
        }
      })

      child.stdin.end(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  return {
    binaryPath,
    isAvailable,
    ping: () => request('ping'),
    applyClient: (client, homeDir, provider) => request('applyClient', { client, homeDir, provider }),
    updateTomlCommonConfig: (configToml, snippetToml, enabled) => request('updateTomlCommonConfig', { configToml, snippetToml, enabled }),
    extractCodexCommonConfig: (configToml) => request('extractCodexCommonConfig', { configToml }),
    updateCodexHistoryToml: (configToml, enabled, bucket = 'ztools_cc_switch') => request('updateCodexHistoryToml', { configToml, enabled, bucket }),
    updateCodexStateProviders: (params) => request('updateCodexStateProviders', params),
    async getStatus() {
      if (!isAvailable()) return { available: false, binaryPath, error: '当前平台 sidecar 未构建' }
      try {
        return { available: true, binaryPath, info: await request('ping') }
      } catch (error) {
        return { available: false, binaryPath, error: error.message }
      }
    }
  }
}

module.exports = { binaryFilename, createSidecarClient }
