'use strict'

const path = require('node:path')

const MAX_TEXT_LENGTH = 200000
const MAX_DEVICE_NAME_LENGTH = 60

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') throw new TypeError('内容必须是文本')
  const result = value.replace(/\u0000/g, '').trim()
  if (!result) throw new TypeError('内容不能为空')
  if (result.length > maxLength) throw new RangeError(`内容不能超过 ${maxLength} 个字符`)
  return result
}

function cleanDeviceName(value) {
  return cleanText(value, MAX_DEVICE_NAME_LENGTH).replace(/[\r\n\t]/g, ' ')
}

function validatePairingCode(value) {
  const code = String(value || '').trim()
  if (!/^\d{6,12}$/.test(code)) throw new TypeError('匹配码必须为 6–12 位数字')
  if (/^(\d)\1+$/.test(code) || '012345678901'.includes(code) || '987654321098'.includes(code)) {
    throw new TypeError('匹配码过于简单，请更换一组数字')
  }
  return code
}

function normalizePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RangeError('端口必须在 1024–65535 之间')
  return port
}

function safeFilename(value) {
  const base = path.basename(String(value || 'file'))
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 180)
  if (!base || base === '.' || base === '..') return 'file'
  return base
}

function validateWebDavUrl(value) {
  const url = new URL(String(value || ''))
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new TypeError('WebDAV 地址必须使用 HTTPS；仅本机允许 HTTP')
  }
  if (url.username || url.password || url.search || url.hash) throw new TypeError('WebDAV 地址不能包含凭据、查询参数或片段')
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/device-link-v1/`
  return url.toString()
}

function isPrivateAddress(address) {
  const normalized = String(address || '').replace(/^::ffff:/, '')
  if (normalized === '127.0.0.1' || normalized === '::1') return true
  const parts = normalized.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254)
}

function detectKind(text) {
  try {
    const url = new URL(text)
    return ['http:', 'https:'].includes(url.protocol) ? 'link' : 'text'
  } catch {
    return 'text'
  }
}

module.exports = {
  MAX_TEXT_LENGTH,
  cleanDeviceName,
  cleanText,
  detectKind,
  isPrivateAddress,
  normalizePort,
  safeFilename,
  validatePairingCode,
  validateWebDavUrl,
}
