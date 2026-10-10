const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function generateKeyPair() {
  return tryCrypt(() => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    return ok({
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    })
  })
}

function sign({ privateKey, data }) {
  return tryCrypt(() => {
    const pem = String(privateKey ?? '').trim()
    if (!pem) return fail('私钥不能为空')
    const sig = crypto.sign(
      null,
      Buffer.from(String(data), 'utf-8'),
      pem
    )
    return ok(sig.toString('base64'))
  })
}

function verify({ publicKey, data, signature }) {
  try {
    return tryCrypt(() => {
      const pem = String(publicKey ?? '').trim()
      const sigStr = String(signature ?? '').trim()
      if (!pem) return fail('公钥不能为空')
      if (!sigStr) return fail('签名不能为空')
      const valid = crypto.verify(
        null,
        Buffer.from(String(data), 'utf-8'),
        pem,
        Buffer.from(sigStr, 'base64')
      )
      return ok(valid)
    })
  } catch (e) {
    return { ok: false, error: '验证失败：' + (e.message || '签名或密钥无效') }
  }
}

module.exports = { generateKeyPair, sign, verify }
