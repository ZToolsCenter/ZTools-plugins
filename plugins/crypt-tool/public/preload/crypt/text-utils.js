const { ok, tryCrypt } = require('./envelope')

function format({ input, indent }) {
  return tryCrypt(() => {
    const obj = JSON.parse(String(input))
    return ok(JSON.stringify(obj, null, Number(indent) || 2))
  })
}

function minify({ input }) {
  return tryCrypt(() => {
    const obj = JSON.parse(String(input))
    return ok(JSON.stringify(obj))
  })
}

module.exports = { format, minify }
