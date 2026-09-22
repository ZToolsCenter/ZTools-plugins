const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

const KEY_LEN = 32
const NONCE_LEN = 12
const TAG_LEN = 16

function validate({ key, nonce }, checkNonce = true) {
  const keyBuf = Buffer.from(String(key), 'base64')
  if (keyBuf.length !== KEY_LEN) {
    return fail('密钥必须为 32 字节（Base64 编码）')
  }
  if (checkNonce) {
    const nonceBuf = Buffer.from(String(nonce), 'base64')
    if (nonceBuf.length !== NONCE_LEN) {
      return fail('Nonce 必须为 12 字节（Base64 编码）')
    }
    return { keyBuf, nonceBuf }
  }
  return { keyBuf }
}

function encrypt({ key, nonce, plaintext }) {
  return tryCrypt(() => {
    const v = validate({ key, nonce })
    if (v.ok === false) return v
    const cipher = crypto.createCipheriv('chacha20-poly1305', v.keyBuf, v.nonceBuf)
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf-8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return ok(Buffer.concat([ct, tag]).toString('base64'))
  })
}

function decrypt({ key, nonce, ciphertext }) {
  return tryCrypt(() => {
    const v = validate({ key, nonce })
    if (v.ok === false) return v
    const raw = Buffer.from(String(ciphertext), 'base64')
    if (raw.length < TAG_LEN + 1) return fail('密文过短或已被破坏')
    const tag = raw.subarray(raw.length - TAG_LEN)
    const ct = raw.subarray(0, raw.length - TAG_LEN)
    try {
      const decipher = crypto.createDecipheriv('chacha20-poly1305', v.keyBuf, v.nonceBuf)
      decipher.setAuthTag(tag)
      return ok(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8'))
    } catch (e) {
      return fail('解密失败：密钥/Nonce 不正确或数据已损坏')
    }
  })
}

function keygen() {
  return tryCrypt(() => {
    const key = crypto.randomBytes(KEY_LEN)
    return ok(key.toString('base64'))
  })
}

function noncegen() {
  return tryCrypt(() => {
    const nonce = crypto.randomBytes(NONCE_LEN)
    return ok(nonce.toString('base64'))
  })
}

module.exports = { encrypt, decrypt, keygen, noncegen }
