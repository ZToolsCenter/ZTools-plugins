const { ok, fail, tryCrypt } = require('./envelope')

const ENCODE_MAP = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
  G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
  M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '$': '...-..-', '@': '.--.-.', ' ': '/'
}

const DECODE_MAP = Object.fromEntries(
  Object.entries(ENCODE_MAP).map(([k, v]) => [v, k])
)

function encode({ input, separator }) {
  return tryCrypt(() => {
    const sep = separator || ' '
    const chars = String(input).toUpperCase().split('')
    const parts = []
    for (const ch of chars) {
      if (ENCODE_MAP[ch] !== undefined) {
        parts.push(ENCODE_MAP[ch])
      } else if (ch !== '\n' && ch !== '\r') {
        parts.push('?')
      }
    }
    return ok(parts.join(sep))
  })
}

function decode({ input, separator }) {
  return tryCrypt(() => {
    const sep = separator || ' '
    const symbols = String(input).trim().split(/\s+/)
    let out = ''
    for (const sym of symbols) {
      if (!sym) continue
      const ch = DECODE_MAP[sym]
      if (ch !== undefined) {
        out += ch
      } else {
        out += '?'
      }
    }
    return ok(out.toLowerCase())
  })
}

module.exports = { encode, decode }
