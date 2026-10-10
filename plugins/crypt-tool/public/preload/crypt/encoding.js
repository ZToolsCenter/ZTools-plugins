const { ok, fail, tryCrypt } = require('./envelope')

const base64 = {
  encode(input) {
    return tryCrypt(() => ok(Buffer.from(String(input), 'utf-8').toString('base64')))
  },
  decode(input) {
    return tryCrypt(() => {
      const s = String(input).trim()
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) {
        return fail('Base64 格式无效，无法解码')
      }
      const buf = Buffer.from(s, 'base64')
      if (buf.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '')) {
        return fail('Base64 格式无效，无法解码')
      }
      return ok(buf.toString('utf-8'))
    })
  }
}

const hex = {
  encode(input) {
    return tryCrypt(() => ok(Buffer.from(String(input), 'utf-8').toString('hex')))
  },
  decode(input) {
    return tryCrypt(() => {
      const s = String(input).trim().replace(/\s+/g, '')
      if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2 !== 0) {
        return fail('Hex 格式无效（需偶数位 0-9a-f）')
      }
      return ok(Buffer.from(s, 'hex').toString('utf-8'))
    })
  }
}

const url = {
  encode(input) {
    return tryCrypt(() => ok(encodeURIComponent(String(input))))
  },
  decode(input) {
    return tryCrypt(() => {
      try {
        return ok(decodeURIComponent(String(input)))
      } catch (e) {
        return fail('URL 编码无效，无法解码')
      }
    })
  }
}

module.exports = { base64, hex, url }
