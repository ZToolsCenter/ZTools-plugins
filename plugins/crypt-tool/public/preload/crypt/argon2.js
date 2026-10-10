let argon2Lib = null

function loadArgon2() {
  if (argon2Lib) return argon2Lib
  try {
    argon2Lib = require('argon2')
  } catch (e) {
    return null
  }
  return argon2Lib
}

const { ok, fail } = require('./envelope')

async function hash({ password, type, timeCost, memoryCost, parallelism, salt, hashLength }) {
  if (!password) return fail('密码不能为空')
  const lib = loadArgon2()
  if (!lib) {
    return fail('argon2 库未安装，请在项目目录执行 npm install argon2')
  }
  const variant = type ?? 'argon2id'
  const variantMap = { argon2i: lib.argon2i, argon2d: lib.argon2d, argon2id: lib.argon2id }
  const argonType = variantMap[variant]
  if (!argonType) return fail('类型仅支持 argon2i / argon2d / argon2id')
  try {
    const saltBuf = salt
      ? Buffer.from(String(salt), 'utf-8')
      : Buffer.from(require('node:crypto').randomBytes(16))
    const opts = {
      type: argonType,
      timeCost: timeCost ?? 3,
      memoryCost: memoryCost ?? 65536,
      parallelism: parallelism ?? 1,
      hashLength: hashLength ?? 32,
      salt: saltBuf
    }
    const h = await lib.hash(String(password), opts)
    return ok(h)
  } catch (e) {
    return fail('哈希失败：' + (e?.message || e))
  }
}

async function verify({ password, hash: hashString }) {
  if (!hashString) return fail('哈希值不能为空')
  if (!password) return fail('密码不能为空')
  const lib = loadArgon2()
  if (!lib) {
    return fail('argon2 库未安装，请在项目目录执行 npm install argon2')
  }
  try {
    const match = await lib.verify(String(hashString), String(password))
    return ok(match)
  } catch (e) {
    return fail('验证失败：' + (e?.message || '格式错误'))
  }
}

module.exports = { hash, verify }
