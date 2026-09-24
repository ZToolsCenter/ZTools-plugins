const { ok, tryCrypt } = require('./envelope')

function encode({ input }) {
  return tryCrypt(() => {
    let out = ''
    for (const ch of String(input)) {
      const code = ch.codePointAt(0)
      if (code > 0xffff) {
        out += '\\u{' + code.toString(16) + '}'
      } else if (code > 127) {
        out += '\\u' + code.toString(16).padStart(4, '0')
      } else {
        out += ch
      }
    }
    return ok(out)
  })
}

function decode({ input }) {
  return tryCrypt(() => {
    const s = String(input)
    let out = ''
    const re = /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g
    let last = 0
    let match
    while ((match = re.exec(s))) {
      out += s.slice(last, match.index)
      const hex = match[1] || match[2]
      out += String.fromCodePoint(parseInt(hex, 16))
      last = re.lastIndex
    }
    out += s.slice(last)
    return ok(out)
  })
}

module.exports = { encode, decode }
