function ok(data) {
  return { ok: true, data }
}

function fail(error) {
  return { ok: false, error: String(error) }
}

function tryCrypt(fn) {
  try {
    return fn()
  } catch (e) {
    return fail(e && e.message ? e.message : '计算失败')
  }
}

module.exports = { ok, fail, tryCrypt }
