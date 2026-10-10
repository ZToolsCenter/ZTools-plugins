const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function derive({ password, salt, keylen, N, r, p }) {
  return tryCrypt(() => {
    if (!password) return fail('密码不能为空')
    if (!salt) return fail('盐不能为空')
    const kl = keylen ?? 64
    if (!Number.isInteger(kl) || kl < 1 || kl > 1024) {
      return fail('密钥长度必须为 1-1024 整数')
    }
    const nVal = N ?? 16384
    const rVal = r ?? 8
    const pVal = p ?? 1
    if (nVal <= 0 || (nVal & (nVal - 1)) !== 0) {
      return fail('N 必须为 2 的幂')
    }
    if (rVal < 1 || pVal < 1) {
      return fail('r 和 p 必须为正整数')
    }
    const dk = crypto.scryptSync(
      String(password),
      String(salt),
      kl,
      { N: nVal, r: rVal, p: pVal, maxmem: 64 * 1024 * 1024 * 1024 }
    )
    return ok(dk.toString('hex'))
  })
}

function hash({ password, salt, cost }) {
  return tryCrypt(() => {
    if (!password) return fail('密码不能为空')
    if (!salt) return fail('盐不能为空')
    const nVal = cost ?? 16384
    if (nVal <= 0 || (nVal & (nVal - 1)) !== 0) {
      return fail('成本参数 N 必须为 2 的幂（如 16384）')
    }
    const hashStr = crypto.scryptSync(
      String(password),
      String(salt),
      64,
      { N: nVal, r: 8, p: 1 }
    ).toString('hex')
    return ok(`$$scrypt$N=${nVal}$r=8$p=1$$${Buffer.from(String(salt), 'utf-8').toString('base64')}$${Buffer.from(hashStr, 'hex').toString('base64')}`)
  })
}

module.exports = { derive, hash }
