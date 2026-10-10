const { ok, fail, tryCrypt } = require('./envelope')

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return Buffer.from(b64, 'base64').toString('utf-8')
}

function decode({ token }) {
  return tryCrypt(() => {
    const parts = String(token).trim().split('.')
    if (parts.length < 2) return fail('JWT 格式错误（需至少 header.payload）')
    try {
      const header = JSON.parse(base64UrlDecode(parts[0]))
      const payload = JSON.parse(base64UrlDecode(parts[1]))
      return ok({ header, payload })
    } catch (e) {
      return fail('JWT 解析失败：' + (e.message || 'Base64 或 JSON 格式错误'))
    }
  })
}

module.exports = { decode }
