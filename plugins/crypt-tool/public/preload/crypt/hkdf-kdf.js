const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function derive({ ikm, salt, info, keylen, hash }) {
  return tryCrypt(() => {
    if (!ikm) return fail('输入密钥材料 IKM 不能为空')
    const kl = keylen ?? 32
    if (!Number.isInteger(kl) || kl < 1 || kl > 8160) {
      return fail('密钥长度必须为 1-8160 整数')
    }
    const algo = hash ?? 'sha256'
    const validAlgos = ['sha1', 'sha256', 'sha384', 'sha512']
    if (!validAlgos.includes(algo)) {
      return fail('哈希算法仅支持 ' + validAlgos.join(' / '))
    }
    const ikmHex = String(ikm).trim().replace(/\s+/g, '')
    if (!/^[0-9a-fA-F]*$/.test(ikmHex) || ikmHex.length % 2 !== 0) {
      return fail('IKM 必须为偶数位十六进制字符串')
    }
    const ikmBuf = Buffer.from(ikmHex, 'hex')
    const saltHex = String(salt ?? '').trim().replace(/\s+/g, '')
    const saltBuf = saltHex ? Buffer.from(saltHex, 'hex') : Buffer.alloc(0)
    const infoHex = String(info ?? '').trim().replace(/\s+/g, '')
    const infoBuf = infoHex ? Buffer.from(infoHex, 'hex') : Buffer.alloc(0)
    try {
      const dk = crypto.hkdfSync(algo, ikmBuf, saltBuf, infoBuf, kl)
      return ok(Buffer.from(dk).toString('hex'))
    } catch (e) {
      return fail('HKDF 派生失败：' + (e.message || e))
    }
  })
}

module.exports = { derive }
