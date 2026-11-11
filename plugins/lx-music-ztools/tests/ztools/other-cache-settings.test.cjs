const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const vue = require('vue')
const loader = require('../../build-config/ztools/host-settings-loader.cjs')

const operations = [
  ['OtherSource', 'OtherSourceCache', 'otherSourceCount'],
  ['MusicUrl', 'MusicUrlCache', 'musicUrlCount'],
  ['LyricRaw', 'LyricRawCache', 'lyricRawCount'],
  ['LyricEdited', 'LyricEditedCache', 'lyricEditedCount'],
]
const tick = async () => { await vue.nextTick(); await new Promise(setImmediate) }

function fixture(t) {
  const failures = {}, counts = Object.fromEntries(operations.map(([key]) => [key, 2]))
  let confirm = true
  const ipc = { getCacheSize: async () => 0, clearCache: async () => {} }
  for (const [key] of operations) {
    ipc[`get${key}Count`] = async () => { if (failures[`count:${key}`]) throw new Error('无法读取缓存数量'); return counts[key] }
    ipc[`clear${key}`] = () => {
      if (failures[key] === 'synchronous') throw new Error('缓存清理失败')
      if (failures[key] === 'rejection') return Promise.reject(new Error('缓存清理失败'))
      counts[key] = 0
      return Promise.resolve()
    }
  }
  const modules = {
    '@common/utils/vueTools': vue,
    '@renderer/utils/ipc': ipc,
    '@common/utils/common': { sizeFormate: String },
    '@renderer/plugins/Dialog': { dialog: { confirm: async () => confirm } },
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/store/setting': { appSetting: {}, updateSetting() {} },
    '@renderer/store/list/listManage': { overwriteListFull: async () => {} },
    '@renderer/store/dislikeList': { dislikeRuleCount: vue.ref(0) },
    './DislikeListModal.vue': {},
    '@common/constants': { TRAY_AUTO_ID: 3 },
  }
  const resourcePath = 'vendor/lx/src/renderer/views/Setting/components/SettingOther.vue'
  const source = loader.call({ resourcePath }, fs.readFileSync(resourcePath, 'utf8'))
  const context = { module: { exports: {} }, require: name => {
    if (!(name in modules)) throw new Error('Unexpected module: ' + name)
    return modules[name]
  } }
  vm.runInNewContext(transformSync(source.match(/<script>([\s\S]*?)<\/script>/)[1], { format: 'cjs' }).code, context)
  const scope = vue.effectScope()
  t.after(() => scope.stop())
  const state = scope.run(() => context.module.exports.default.setup())
  return { state, failures, setConfirm: value => { confirm = value }, render() {
    const html = require('pug').render(source.match(/<template lang="pug">([\s\S]*?)<\/template>/)[1])
    const code = require('@vue/compiler-dom').compile(html, { mode: 'function' }).code
    const render = new Function('Vue', code)({ ...vue, resolveComponent: name => name })
    return render(vue.proxyRefs({ ...state, $t: key => key, $style: {} }), [])
  } }
}

function alertText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.props?.role === 'alert') return typeof node.children === 'string' ? node.children : ''
  return Array.isArray(node.children) ? node.children.map(alertText).find(Boolean) || '' : ''
}

for (const [key, suffix, count] of operations) for (const mode of ['synchronous', 'rejection']) {
  test(`${key} cache ${mode} failure restores its button, shows the error and permits a retry`, async t => {
    const x = fixture(t)
    await tick()
    x.failures[key] = mode
    await x.state[`handleClear${suffix}`]().catch(() => {})
    await tick()
    assert.equal(x.state[`isDisabled${suffix}Clear`].value, false)
    assert.equal(alertText(x.render()), '缓存清理失败')
    delete x.failures[key]
    await x.state[`handleClear${suffix}`]()
    await tick()
    assert.equal(x.state[count].value, 0)
    assert.equal(alertText(x.render()), '')
  })
}

test('cache count refresh failure remains visible while the cleanup button recovers', async t => {
  const x = fixture(t)
  await tick()
  x.failures['count:OtherSource'] = true
  await x.state.handleClearOtherSourceCache()
  await tick()
  assert.equal(x.state.isDisabledOtherSourceCacheClear.value, false)
  assert.equal(alertText(x.render()), '无法读取缓存数量')
})

test('cancelling edited-lyric cleanup preserves the count and leaves the button usable', async t => {
  const x = fixture(t)
  await tick()
  x.setConfirm(false)
  await x.state.handleClearLyricEditedCache()
  await tick()
  assert.equal(x.state.lyricEditedCount.value, 2)
  assert.equal(x.state.isDisabledLyricEditedCacheClear.value, false)
})
