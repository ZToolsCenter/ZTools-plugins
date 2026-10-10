const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function generateKeyPair({ curve }) {
  return tryCrypt(() => {
    const c = curve || 'prime256v1'
    const validCurves = ['prime256v1', 'secp384r1', 'secp521r1']
    if (!validCurves.includes(c)) {
      return fail('仅支持 ' + validCurves.join(' / '))
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: c,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    return ok({ publicKey, privateKey, curve: c })
  })
}

function sign({ privateKey, data, hash }) {
  return tryCrypt(() => {
    if (!privateKey) return fail('私钥不能为空')
    const algo = hash || 'sha256'
    const signObj = crypto.createSign(algo)
    signObj.update(String(data), 'utf-8')
    signObj.end()
    const sig = signObj.sign(String(privateKey), 'base64')
    return ok(sig)
  })
}

function verify({ publicKey, data, signature, hash }) {
  try {
    return tryCrypt(() => {
      if (!publicKey) return fail('公钥不能为空')
      if (!signature) return fail('签名不能为空')
      const algo = hash || 'sha256'
      const verifyObj = crypto.createVerify(algo)
      verifyObj.update(String(data), 'utf-8')
      verifyObj.end()
      const valid = verifyObj.verify(String(publicKey), String(signature), 'base64')
      return ok(valid)
    })
  } catch (e) {
    return { ok: false, error: '验证失败：' + (e.message || '签名或密钥无效') }
  }
}

module.exports = { generateKeyPair, sign, verify }
