// Device-local credentials, deliberately outside the host's synced plugin database.
// This is a permission-restricted local file, not OS keychain encryption.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const copy = value => JSON.parse(JSON.stringify(value))
const namespaces = new Set(['research', 'translation'])

module.exports = function createLocalCredentials(options = {}) {
  const memory = Object.create(null)
  function directory() {
    const value = typeof options.directory === 'function' ? options.directory() : options.directory
    if (value == null || value === '') return null
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('本机凭据目录无效，请重启插件后重试。')
    return value
  }
  function file() { const dir = directory(); return dir && path.join(dir, 'credentials-v1.json') }
  function readAll() {
    const target = file()
    if (!target) return { version: 1, entries: copy(memory) }
    try {
      const stat = fs.lstatSync(target)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw Error('invalid file')
      const saved = JSON.parse(fs.readFileSync(target, 'utf8'))
      if (saved?.version !== 1 || !saved.entries || typeof saved.entries !== 'object' || Array.isArray(saved.entries)) throw Error('invalid format')
      return saved
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, entries: {} }
      throw Error('无法读取本机凭据文件，请检查文件权限；原有凭据未被覆盖。')
    }
  }
  function check(namespace) { if (!namespaces.has(namespace)) throw Error('不支持的凭据类型。') }
  return {
    mode() { return directory() ? 'local' : 'session' },
    read(namespace) { check(namespace); return copy(readAll().entries[namespace] || {}) },
    write(namespace, values) {
      check(namespace)
      const next = copy(values)
      if (!next || typeof next !== 'object' || Array.isArray(next)) throw Error('凭据格式无效。')
      const target = file()
      if (!target) { memory[namespace] = next; return false }
      const saved = readAll()
      saved.entries[namespace] = next
      const bytes = JSON.stringify(saved)
      if (Buffer.byteLength(bytes) > 128 * 1024) throw Error('本机凭据数量过多，请先清除不用的配置。')
      const dir = path.dirname(target), temp = path.join(dir, '.credentials-' + crypto.randomUUID() + '.tmp')
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
        if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw Error('invalid directory')
        if (process.platform !== 'win32') fs.chmodSync(dir, 0o700)
        fs.writeFileSync(temp, bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        fs.renameSync(temp, target)
        return true
      } catch (_) {
        try { fs.unlinkSync(temp) } catch (_) {}
        throw Error('无法保存本机凭据，请检查磁盘空间和目录权限后重试；本次修改未生效。')
      }
    }
  }
}
