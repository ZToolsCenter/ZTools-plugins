const builtin = require('../upstream/common/theme/index.json')
const { createKV } = require('./kv.cjs')
function createThemes(database) {
  const store = createKV(database, 'themes')
  return {
    getAll() { return { themes: structuredClone(builtin), userThemes: store.get('user', []) } },
    save(theme) {
      if (!theme || typeof theme.id !== 'string' || !theme.id || typeof theme.name !== 'string' || !theme.config || typeof theme.config !== 'object') throw new TypeError('无效的主题')
      if (builtin.some(item => item.id === theme.id)) throw new Error('不能覆盖内置主题')
      if (Buffer.byteLength(JSON.stringify(theme)) >= 256 * 1024) throw new Error('主题数据过大')
      const user = store.get('user', [])
      const index = user.findIndex(item => item.id === theme.id)
      if (index < 0) user.push(theme); else user[index] = theme
      store.set('user', user)
    },
    remove(id) { store.set('user', store.get('user', []).filter(theme => theme.id !== id)) },
  }
}
module.exports = { createThemes }
