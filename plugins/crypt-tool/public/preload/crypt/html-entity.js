const { ok, fail, tryCrypt } = require('./envelope')

const NAMED_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&nbsp;': '\u00A0',
  '&copy;': '\u00A9',
  '&reg;': '\u00AE',
  '&trade;': '\u2122',
  '&euro;': '\u20AC',
  '&pound;': '\u00A3',
  '&yen;': '\u00A5',
  '&cent;': '\u00A2',
  '&sect;': '\u00A7',
  '&deg;': '\u00B0',
  '&plusmn;': '\u00B1',
  '&para;': '\u00B6',
  '&middot;': '\u00B7',
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
  '&hellip;': '\u2026',
  '&permil;': '\u2030',
  '&bull;': '\u2022',
  '&prime;': '\u2032',
  '&Prime;': '\u2033'
}

const REVERSE_ENTITIES = Object.fromEntries(
  Object.entries(NAMED_ENTITIES).map(([k, v]) => [v, k])
)

function encode({ input, useNamed }) {
  return tryCrypt(() => {
    let out = ''
    for (const ch of String(input)) {
      if (useNamed && REVERSE_ENTITIES[ch]) {
        out += REVERSE_ENTITIES[ch]
      } else if (ch.codePointAt(0) > 127 || '<>&"\''.includes(ch)) {
        out += '&#x' + ch.codePointAt(0).toString(16).toUpperCase() + ';'
      } else {
        out += ch
      }
    }
    return ok(out)
  })
}

function decode({ input }) {
  try {
    return tryCrypt(() => {
      const s = String(input)
      let out = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16))
      )
      out = out.replace(/&#(\d+);/g, (_, dec) =>
        String.fromCodePoint(parseInt(dec, 10))
      )
      for (const [entity, ch] of Object.entries(NAMED_ENTITIES)) {
        out = out.split(entity).join(ch)
      }
      return ok(out)
    })
  } catch (e) {
    return fail('HTML 实体解码失败：' + (e.message || e))
  }
}

module.exports = { encode, decode }
