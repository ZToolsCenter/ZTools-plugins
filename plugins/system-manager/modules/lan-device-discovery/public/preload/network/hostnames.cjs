'use strict'

const dns = require('node:dns')

function cleanHostname(value) {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\.$/, '')
  return cleaned ? cleaned.slice(0, 253) : null
}

function reverseHostname(ip, options = {}) {
  return new Promise((resolve) => {
    const resolver = new dns.Resolver()
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(cleanHostname(value))
    }
    const onAbort = () => {
      try { resolver.cancel() } catch { /* already settled */ }
      finish(null)
    }
    const timer = setTimeout(() => onAbort(), Math.min(2_000, Math.max(100, options.timeoutMs || 400)))
    timer.unref?.()
    if (options.signal?.aborted) return onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    resolver.reverse(ip, (error, hostnames) => finish(error ? null : hostnames && hostnames[0]))
  })
}

async function enrichHostnames(devices, options = {}) {
  const values = Array.isArray(devices) ? devices : []
  const lookup = options.lookup || reverseHostname
  const concurrency = Math.min(8, Math.max(1, Math.floor(options.concurrency || 8)))
  let cursor = 0
  async function worker() {
    while (!options.signal?.aborted) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      const item = values[index]
      try {
        item.hostname = cleanHostname(await lookup(item.ip, {
          signal: options.signal,
          timeoutMs: options.timeoutMs || 400,
        }))
      } catch {
        item.hostname = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return values
}

module.exports = { cleanHostname, enrichHostnames, reverseHostname }
