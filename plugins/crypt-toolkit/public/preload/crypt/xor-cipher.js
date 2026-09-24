const { ok, fail, tryCrypt } = require('./envelope')

function encrypt({ key, plaintext }) {
  return tryCrypt(() => {
    if (!key) return fail('密钥不能为空')
    const keyBuf = Buffer.from(String(key), 'utf-8')
    const ptBuf = Buffer.from(String(plaintext), 'utf-8')
    const ctBuf = Buffer.alloc(ptBuf.length)
    for (let i = 0; i < ptBuf.length; i++) {
      ctBuf[i] = ptBuf[i] ^ keyBuf[i % keyBuf.length]
    }
    return ok(ctBuf.toString('hex'))
  })
}

function decrypt({ key, ciphertext }) {
  return tryCrypt(() => {
    if (!key) return fail('密钥不能为空')
    const keyBuf = Buffer.from(String(key), 'utf-8')
    const ctBuf = Buffer.from(String(ciphertext), 'hex')
    const ptBuf = Buffer.alloc(ctBuf.length)
    for (let i = 0; i < ctBuf.length; i++) {
      ptBuf[i] = ctBuf[i] ^ keyBuf[i % keyBuf.length]
    }
    return ok(ptBuf.toString('utf-8'))
  })
}

module.exports = { encrypt, decrypt }
