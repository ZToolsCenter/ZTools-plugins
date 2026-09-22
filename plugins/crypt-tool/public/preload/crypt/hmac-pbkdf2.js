const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

const HMAC_ALGOS = new Set(['sha256', 'sha512', 'sha1', 'sha384'])

function sign({ key, data, algo }) {
  return tryCrypt(() => {
    if (!HMAC_ALGOS.has(algo)) {
      return fail('HMAC 算法仅支持 sha256 / sha512 / sha1 / sha384')
    }
    return ok(
      crypto
        .createHmac(algo, Buffer.from(String(key), 'utf-8'))
        .update(String(data), 'utf-8')
        .digest('hex')
    )
  })
}

function verify({ key, data, signature, algo }) {
  return tryCrypt(() => {
    if (!HMAC_ALGOS.has(algo)) {
      return fail('HMAC 算法仅支持 sha256 / sha512 / sha1 / sha384')
    }
    const expected = crypto
      .createHmac(algo, Buffer.from(String(key), 'utf-8'))
      .update(String(data), 'utf-8')
      .digest('hex')
    const a = Buffer.from(String(signature), 'utf-8')
    const b = Buffer.from(expected, 'utf-8')
    const match = a.length === b.length && crypto.timingSafeEqual(a, b)
    return ok(match)
  })
}

function derive({ password, salt, iterations, keylen, hash }) {
  return tryCrypt(() => {
    if (!Number.isInteger(iterations) || iterations < 1) {
      return fail('迭代次数必须为正整数')
    }
    if (!Number.isInteger(keylen) || keylen < 1 || keylen > 1024) {
      return fail('导出长度必须为 1-1024 的整数')
    }
    const hashAlgo = String(hash)
    if (!['sha1', 'sha256', 'sha384', 'sha512'].includes(hashAlgo)) {
      return fail('哈希算法仅支持 sha1 / sha256 / sha384 / sha512')
    }
    const dk = crypto.pbkdf2Sync(
      String(password),
      String(salt),
      iterations,
      keylen,
      hashAlgo
    )
    return ok(dk.toString('hex'))
  })
}

module.exports = {
  hmac: { sign, verify },
  pbkdf2: { derive }
}
