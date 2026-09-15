'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

class ProcessOutputLimitError extends Error {
  constructor() {
    super('Process output exceeded the audited limit')
    this.name = 'ProcessOutputLimitError'
    this.code = 'OUTPUT_LIMIT'
  }
}

function createProcessRunner(spawnImpl = spawn, lifecycle = {}) {
  const graceMs = Math.min(2_000, Math.max(10, Number(lifecycle.graceMs) || 150))
  const settleMs = Math.min(4_000, Math.max(graceMs + 10, Number(lifecycle.settleMs) || 500))

  return function run(file, args, options = {}) {
    const absolute = typeof file === 'string' && (path.posix.isAbsolute(file) || path.win32.isAbsolute(file))
    if (!absolute || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      return Promise.reject(new TypeError('Invalid process invocation'))
    }
    const timeoutMs = Math.min(15_000, Math.max(50, Number(options.timeoutMs) || 2_000))
    return new Promise((resolve, reject) => {
      let child
      let stdout = ''
      let stderr = ''
      let outputBytes = 0
      let settled = false
      let terminationReason = null
      let timeoutTimer
      let forceTimer
      let settleTimer

      const result = (code = null, signal = null) => ({
        code: Number.isInteger(code) ? code : null,
        signal: signal || null,
        stdout,
        stderr,
        timedOut: terminationReason === 'timeout',
        aborted: terminationReason === 'abort',
      })

      const cleanup = () => {
        clearTimeout(timeoutTimer)
        clearTimeout(forceTimer)
        clearTimeout(settleTimer)
        options.signal?.removeEventListener('abort', onAbort)
        child?.stdout?.removeListener?.('data', onStdout)
        child?.stderr?.removeListener?.('data', onStderr)
        child?.removeListener?.('error', onError)
        child?.removeListener?.('close', onClose)
      }

      const finish = (error, value) => {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve(value)
      }

      const finishTermination = (code = null, signal = null) => {
        if (terminationReason === 'output-limit') finish(new ProcessOutputLimitError())
        else finish(null, result(code, signal))
      }

      const kill = (signal) => {
        try { if (child) child.kill(signal) } catch { /* process already exited */ }
      }

      const beginTermination = (reason) => {
        if (terminationReason || settled) return
        terminationReason = reason
        kill('SIGTERM')
        forceTimer = setTimeout(() => kill('SIGKILL'), graceMs)
        settleTimer = setTimeout(() => {
          try { child?.unref?.() } catch { /* optional ChildProcess API */ }
          finishTermination(null, 'SIGKILL')
        }, settleMs)
      }

      const append = (field, chunk) => {
        if (settled || terminationReason) return
        const value = String(chunk)
        const bytes = Buffer.byteLength(value, 'utf8')
        if (outputBytes + bytes > MAX_OUTPUT_BYTES) {
          beginTermination('output-limit')
          return
        }
        outputBytes += bytes
        if (field === 'stdout') stdout += value
        else stderr += value
      }

      const onStdout = (chunk) => append('stdout', chunk)
      const onStderr = (chunk) => append('stderr', chunk)
      const onAbort = () => beginTermination('abort')
      const onError = (error) => {
        // A failed TERM attempt can emit an error while the process is still
        // alive. Keep the grace/KILL/final-settle timers in control.
        if (!terminationReason) finish(error)
      }
      const onClose = (code, signal) => terminationReason ? finishTermination(code, signal) : finish(null, result(code, signal))

      try {
        child = spawnImpl(file, args, {
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        finish(error)
        return
      }
      if (typeof options.onChild === 'function') options.onChild(child)
      child.stdout?.setEncoding?.('utf8')
      child.stderr?.setEncoding?.('utf8')
      child.stdout?.on?.('data', onStdout)
      child.stderr?.on?.('data', onStderr)
      child.once('error', onError)
      child.once('close', onClose)
      timeoutTimer = setTimeout(() => beginTermination('timeout'), timeoutMs)
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

module.exports = { MAX_OUTPUT_BYTES, ProcessOutputLimitError, createProcessRunner }
