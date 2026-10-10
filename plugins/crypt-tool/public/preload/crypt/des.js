const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

const KEY_LEN = 24
const IV_LEN = 8

function encrypt({ key, iv, plaintext }) {
  return tryCrypt(() => {
    const keyBuf = Buffer.from(String(key), 'base64')
    const ivBuf = Buffer.from(String(iv), 'base64')
    if (keyBuf.length !== KEY_LEN) return fail('密钥必须为 24 字节（Base64 编码）')
    if (ivBuf.length !== IV_LEN) return fail('IV 必须为 8 字节（Base64 编码）')
    const cipher = crypto.createCipheriv('des-ede3-cbc', keyBuf, ivBuf)
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf-8'), cipher.final()])
    return ok(ct.toString('base64'))
  })
}

function decrypt({ key, iv, ciphertext }) {
  return tryCrypt(() => {
    const keyBuf = Buffer.from(String(key), 'base64')
    const ivBuf = Buffer.from(String(iv), 'base64')
    if (keyBuf.length !== KEY_LEN) return fail('密钥必须为 24 字节（Base64 编码）')
    if (ivBuf.length !== IV_LEN) return fail('IV 必须为 8 字节（Base64 编码）')
    try {
      const decipher = crypto.createDecipheriv('des-ede3-cbc', keyBuf, ivBuf)
      const pt = Buffer.concat([decipher.update(Buffer.from(String(ciphertext), 'base64')), decipher.final()])
      return ok(pt.toString('utf-8'))
    } catch (e) {
      return fail('解密失败：密钥/IV 不正确或数据已损坏')
    }
  })
}

function keygen() {
  return tryCrypt(() => ok(crypto.randomBytes(KEY_LEN).toString('base64')))
}

function ivgen() {
  return tryCrypt(() => ok(crypto.randomBytes(IV_LEN).toString('base64')))
}

module.exports = { encrypt, decrypt, keygen, ivgen }
