'use strict'

const { performance } = require('node:perf_hooks')

const SCAN_DEADLINE_CODE = 'SCAN_DEADLINE'

function deadlineError() {
  const error = new Error('扫描超过总时限')
  error.code = SCAN_DEADLINE_CODE
  return error
}

function createDeadline(timeoutMs, customNow) {
  const now = customNow || (() => performance.now())
  const expiresAt = now() + timeoutMs
  function remaining() { return Math.max(0, Math.floor(expiresAt - now())) }
  function expired() { return remaining() <= 0 }
  async function run(factory) {
    const budget = remaining()
    if (budget <= 0) throw deadlineError()
    let timer
    try {
      const result = await Promise.race([
        Promise.resolve().then(factory),
        new Promise((_, reject) => { timer = setTimeout(() => reject(deadlineError()), budget) }),
      ])
      if (expired()) throw deadlineError()
      return result
    } finally { if (timer) clearTimeout(timer) }
  }
  return { expired, remaining, run }
}

module.exports = { SCAN_DEADLINE_CODE, createDeadline, deadlineError }
