const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function validate({ key, iv, mode }) {
  const keyBuf = Buffer.from(String(key), 'utf-8')
  if (![16, 24, 32].includes(keyBuf.length)) {
    return fail('密钥必须为 16 / 24 / 32 字节（UTF-8）')
  }
  const ivBuf = Buffer.from(String(iv), 'utf-8')
  if (ivBuf.length !== 16) {
    return fail('IV 必须为 16 字节（UTF-8）')
  }
  if (mode !== 'CBC' && mode !== 'GCM') {
    return fail('模式仅支持 CBC 或 GCM')
  }
  return { keyBuf, ivBuf, mode }
}

function encrypt({ key, iv, mode, plaintext }) {
  return tryCrypt(() => {
    const v = validate({ key, iv, mode })
    if (v.ok === false) return v
    const cipher = crypto.createCipheriv(
      `aes-${v.keyBuf.length * 8}-${mode.toLowerCase()}`,
      v.keyBuf,
      v.ivBuf
    )
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf-8'), cipher.final()])
    if (mode === 'GCM') {
      const tag = cipher.getAuthTag()
      return ok(Buffer.concat([ct, tag]).toString('base64'))
    }
    return ok(ct.toString('base64'))
  })
}

function decrypt({ key, iv, mode, ciphertext }) {
  return tryCrypt(() => {
    const v = validate({ key, iv, mode })
    if (v.ok === false) return v
    const raw = Buffer.from(String(ciphertext), 'base64')
    try {
      if (mode === 'GCM') {
        if (raw.length < 17) return fail('密文过短或已被破坏')
        const tag = raw.subarray(raw.length - 16)
        const ct = raw.subarray(0, raw.length - 16)
        const decipher = crypto.createDecipheriv(
          `aes-${v.keyBuf.length * 8}-gcm`,
          v.keyBuf,
          v.ivBuf
        )
        decipher.setAuthTag(tag)
        return ok(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8'))
      }
      const decipher = crypto.createDecipheriv(
        `aes-${v.keyBuf.length * 8}-cbc`,
        v.keyBuf,
        v.ivBuf
      )
      return ok(Buffer.concat([decipher.update(raw), decipher.final()]).toString('utf-8'))
    } catch (e) {
      return fail('解密失败：密钥/IV 不正确或数据已损坏')
    }
  })
}

module.exports = { encrypt, decrypt }
