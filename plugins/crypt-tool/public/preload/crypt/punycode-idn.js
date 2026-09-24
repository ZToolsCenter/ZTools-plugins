const { ok, tryCrypt } = require('./envelope')
const { toASCII, toUnicode } = require('node:punycode')

function encode({ input }) {
  return tryCrypt(() => ok(toASCII(String(input))))
}

function decode({ input }) {
  return tryCrypt(() => ok(toUnicode(String(input))))
}

module.exports = { encode, decode }
