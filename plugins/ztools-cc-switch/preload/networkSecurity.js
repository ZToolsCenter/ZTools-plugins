'use strict'

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return value === 'localhost' || value === '127.0.0.1' || value === '::1'
}

function requireSecureHttpUrl(value, label = 'URL') {
  let parsed
  try { parsed = value instanceof URL ? new URL(value.href) : new URL(String(value || '')) } catch { throw new Error(`${label} 无效`) }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} 必须使用 HTTP(S)`)
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) throw new Error(`${label} 的远程地址必须使用 HTTPS；仅回环地址允许 HTTP`)
  return parsed
}

module.exports = { isLoopbackHostname, requireSecureHttpUrl }
