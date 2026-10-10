const { ok, tryCrypt } = require('./envelope')

function analyze({ password }) {
  return tryCrypt(() => {
    const pw = String(password)
    if (!pw) return ok({ score: 0, label: '空密码', length: 0 })
    let score = 0
    const len = pw.length

    if (len >= 8) score += 25
    else if (len >= 6) score += 15
    else score += 5

    const checks = [
      /[a-z]/.test(pw),
      /[A-Z]/.test(pw),
      /[0-9]/.test(pw),
      /[^A-Za-z0-9]/.test(pw)
    ]
    const typeCount = checks.filter(Boolean).length
    score += (typeCount - 1) * 15

    const commonPatterns = ['123456', 'password', 'qwerty', 'abc123', '111111', '000000']
    const lowerPW = pw.toLowerCase()
    for (const pat of commonPatterns) {
      if (lowerPW.includes(pat)) {
        score -= 20
        break
      }
    }

    if (/(.)\1{2,}/.test(pw)) score -= 10
    if (/123|234|345|456|567|678|789/.test(pw)) score -= 5

    score = Math.max(0, Math.min(100, score))

    let label = '弱'
    if (score >= 80) label = '强'
    else if (score >= 60) label = '中'
    else if (score >= 40) label = '较弱'

    return ok({ score, label, length: len, hasLower: checks[0], hasUpper: checks[1], hasDigit: checks[2], hasSymbol: checks[3] })
  })
}

module.exports = { analyze }
