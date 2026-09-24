const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function encrypt({ publicKey, plaintext }) {
  return tryCrypt(() => {
    let key
    try {
      key = crypto.createPublicKey(String(publicKey))
    } catch (e) {
      return fail('公钥格式无效（需 PEM 格式）')
    }
    const ct = crypto.publicEncrypt(
      { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(String(plaintext), 'utf-8')
    )
    return ok(ct.toString('base64'))
  })
}

function decrypt({ privateKey, ciphertext }) {
  return tryCrypt(() => {
    let key
    try {
      key = crypto.createPrivateKey(String(privateKey))
    } catch (e) {
      return fail('私钥格式无效（需 PEM 格式）')
    }
    try {
      const pt = crypto.privateDecrypt(
        { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        Buffer.from(String(ciphertext), 'base64')
      )
      return ok(pt.toString('utf-8'))
    } catch (e) {
      return fail('解密失败：私钥不匹配或密文已损坏')
    }
  })
}

function generateKeyPair() {
  return tryCrypt(() => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    return ok(JSON.stringify({ publicKey, privateKey }))
  })
}

module.exports = { encrypt, decrypt, generateKeyPair }
