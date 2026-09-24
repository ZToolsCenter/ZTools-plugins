const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function generateKeyPair({ curve }) {
  return tryCrypt(() => {
    const c = curve || 'prime256v1'
    const ecdh = crypto.createECDH(c)
    ecdh.generateKeys()
    return ok({
      publicKey: ecdh.getPublicKey('hex'),
      privateKey: ecdh.getPrivateKey('hex'),
      curve: c
    })
  })
}

function deriveSharedSecret({ privateKey, peerPublicKey, curve }) {
  return tryCrypt(() => {
    if (!privateKey) return fail('自身私钥不能为空')
    if (!peerPublicKey) return fail('对方公钥不能为空')
    const c = curve || 'prime256v1'
    try {
      const ecdh = crypto.createECDH(c)
      ecdh.setPrivateKey(String(privateKey), 'hex')
      const secret = ecdh.computeSecret(String(peerPublicKey), 'hex')
      return ok(secret.toString('hex'))
    } catch (e) {
      return fail('ECDH 密钥协商失败：' + (e.message || '密钥无效'))
    }
  })
}

module.exports = { generateKeyPair, deriveSharedSecret }
