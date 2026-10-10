const bcrypt = require('bcryptjs')
const { ok, fail, tryCrypt } = require('./envelope')

const MIN_COST = 4
const MAX_COST = 31

function hash({ password, cost }) {
  return tryCrypt(() => {
    const pwd = String(password ?? '')
    if (pwd.length === 0) return fail('密码不能为空')
    const rounds = cost ?? 12
    if (!Number.isInteger(rounds) || rounds < MIN_COST || rounds > MAX_COST) {
      return fail(`计算成本需为 ${MIN_COST}-${MAX_COST} 的整数`)
    }
    const salt = bcrypt.genSaltSync(rounds)
    const hashStr = bcrypt.hashSync(pwd, salt)
    return ok(hashStr)
  })
}

function verify({ password, hash: hashString }) {
  return tryCrypt(() => {
    const pwd = String(password ?? '')
    const hash = String(hashString ?? '').trim()
    if (hash.length === 0) return fail('哈希值不能为空')
    if (pwd.length === 0) return fail('密码不能为空')
    if (!hash.match(/^\$2[aby]?\$\d+\$/)) return fail('无效的 bcrypt 哈希格式')
    const match = bcrypt.compareSync(pwd, hash)
    return ok(match)
  })
}

module.exports = {
  bcrypt: { hash, verify }
}
