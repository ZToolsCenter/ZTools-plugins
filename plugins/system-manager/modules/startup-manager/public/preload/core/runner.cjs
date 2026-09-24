'use strict'

const { execFile } = require('node:child_process')

const MAX_OUTPUT = 4 * 1024 * 1024
const DEFAULT_TIMEOUT = 8_000

function controlledEnvironment(extra = {}, platform = process.platform) {
  const requestedRoot = extra.SystemRoot || process.env.SystemRoot || ''
  const systemRoot = /^[A-Za-z]:\\Windows$/i.test(requestedRoot) ? requestedRoot : 'C:\\Windows'
  const safePath = platform === 'win32'
    ? `${systemRoot}\\System32;${systemRoot};${systemRoot}\\System32\\WindowsPowerShell\\v1.0`
    : '/usr/bin:/bin:/usr/sbin:/sbin'
  const result = {}
  for (const [key, value] of Object.entries({ ...process.env, ...extra })) {
    if (['path', 'systemroot', 'windir', 'psmodulepath', 'psmoduleanalysiscachepath', 'pssessionconfigurationname'].includes(key.toLowerCase())) continue
    result[key] = value
  }
  result.PATH = safePath
  if (platform === 'win32') {
    result.SystemRoot = systemRoot
    result.WINDIR = systemRoot
    result.PSModulePath = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\Modules`
  }
  return result
}

function runFile(file, args = [], options = {}) {
  if (typeof file !== 'string' || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    return Promise.reject(new TypeError('Invalid executable request'))
  }
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: 'utf8',
      timeout: options.timeoutMs || DEFAULT_TIMEOUT,
      maxBuffer: options.maxOutput || MAX_OUTPUT,
      windowsHide: true,
      env: controlledEnvironment(options.env),
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr, code: 0 })
    })
  })
}

module.exports = { DEFAULT_TIMEOUT, MAX_OUTPUT, controlledEnvironment, runFile }
