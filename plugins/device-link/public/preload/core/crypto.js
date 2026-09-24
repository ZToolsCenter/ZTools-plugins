'use strict'

const crypto = require('node:crypto')

const PAIRING_ITERATIONS = 210000
const KEY_BYTES = 32

function randomId(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function randomDigits(length = 6) {
  const upper = 10 ** length
  return crypto.randomInt(0, upper).toString().padStart(length, '0')
}

function derivePairKey(secret, code, salt) {
  if (typeof secret !== 'string' || secret.length < 20) throw new TypeError('连接密钥无效')
  if (!/^\d{6,12}$/.test(String(code))) throw new TypeError('匹配码必须为 6–12 位数字')
  return crypto.pbkdf2Sync(`${secret}:${code}`, Buffer.from(salt, 'base64url'), PAIRING_ITERATIONS, KEY_BYTES, 'sha256')
}

function deriveVaultKey(password, salt) {
  if (typeof password !== 'string' || password.length < 10) throw new TypeError('同步密码至少需要 10 个字符')
  return crypto.scryptSync(password, Buffer.from(salt, 'base64url'), KEY_BYTES, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
}

function pairingProof(key, sessionId, challenge) {
  return crypto.createHmac('sha256', key).update(`device-link-pair-v1:${sessionId}:${challenge}`).digest('base64url')
}

function resumeProof(secret, challengeId, challenge) {
  const key = Buffer.from(String(secret || ''), 'base64url')
  if (key.length !== KEY_BYTES) throw new TypeError('设备凭据无效')
  return crypto.createHmac('sha256', key).update(`device-link-resume-v1:${challengeId}:${challenge}`).digest('base64url')
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function encryptBytes(key, bytes, associatedData = '') {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  if (associatedData) cipher.setAAD(Buffer.from(associatedData))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(bytes)), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
}

function decryptBytes(key, envelope, associatedData = '') {
  const bytes = Buffer.from(envelope)
  if (bytes.length < 29) throw new TypeError('加密数据不完整')
  const nonce = bytes.subarray(0, 12)
  const tag = bytes.subarray(12, 28)
  const ciphertext = bytes.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
  if (associatedData) decipher.setAAD(Buffer.from(associatedData))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function encryptJson(key, value, associatedData = '') {
  return encryptBytes(key, Buffer.from(JSON.stringify(value)), associatedData).toString('base64url')
}

function decryptJson(key, encoded, associatedData = '') {
  const plain = decryptBytes(key, Buffer.from(String(encoded), 'base64url'), associatedData)
  return JSON.parse(plain.toString('utf8'))
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = require('node:fs').createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

module.exports = {
  KEY_BYTES,
  PAIRING_ITERATIONS,
  decryptBytes,
  decryptJson,
  derivePairKey,
  deriveVaultKey,
  encryptBytes,
  encryptJson,
  pairingProof,
  randomDigits,
  randomId,
  resumeProof,
  secureEqual,
  sha256,
  sha256File,
}
