'use strict'

const path = require('node:path')
const { execFile } = require('node:child_process')

const MAX_INPUT_BYTES = 1024 * 1024

function runFile(file, args = [], options = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    return Promise.reject(new TypeError('Invalid executable request'))
  }
  const input = options.input
  if (input != null && typeof input !== 'string' && !Buffer.isBuffer(input)) return Promise.reject(new TypeError('Invalid process input'))
  if (input != null && Buffer.byteLength(input) > MAX_INPUT_BYTES) return Promise.reject(new RangeError('Process input exceeds safe limit'))
  const { input: _input, ...childOptions } = options
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { ...childOptions, shell: false }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr, code: 0 })
    })
    child.stdin.on('error', () => { /* callback reports process failures */ })
    child.stdin.end(input == null ? undefined : input)
  })
}

module.exports = { MAX_INPUT_BYTES, runFile }
