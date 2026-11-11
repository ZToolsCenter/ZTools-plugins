const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const vue = require('vue')

const componentPath = path.resolve(__dirname, '../../vendor/lx/src/renderer/components/layout/Toolbar/SearchInput.vue')
const loaderPath = path.resolve(__dirname, '../../build-config/ztools/search-input-loader.cjs')

// Exercise the real component script and Vue watchers; only routing, timers and
// external suggestion requests are replaced so this regression needs no browser.
function fixture(t, { clearInput, clearList }) {
  const route = vue.reactive({ name: 'Search', path: '/search' })
  const query = vue.ref('')
  const timers = []
  const setting = {
    'odc.isAutoClearSearchInput': clearInput,
    'odc.isAutoClearSearchList': clearList,
  }
  const modules = {
    '@renderer/utils/musicSdk': {},
    '@common/utils': { debounce: () => () => {} },
    '@common/utils/vueTools': vue,
    '@common/utils/vueRouter': { useRoute: () => route, useRouter: () => ({ push: () => Promise.resolve() }) },
    '@renderer/store/setting': { appSetting: setting },
    '@renderer/store/search/state': { searchText: query },
    '@renderer/store/search/action': { setSearchText: value => { query.value = value } },
    '@renderer/utils/data': { getSearchSetting: async () => ({ temp_source: 'kw', source: 'all', type: 'music' }) },
  }
  const original = fs.readFileSync(componentPath, 'utf8')
  const source = fs.existsSync(loaderPath) ? require(loaderPath)(original) : original
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  const context = { module: { exports: {} }, setTimeout: fn => { timers.push(fn) }, console,
    require: name => { if (!(name in modules)) throw new Error('Unexpected module: ' + name); return modules[name] } }
  vm.runInNewContext(transformSync(script, { format: 'cjs' }).code, context)
  const scope = vue.effectScope()
  t.after(() => scope.stop())
  const state = scope.run(() => context.module.exports.default.setup())
  return {
    state, query,
    async search(value) { query.value = value; await vue.nextTick() },
    async navigate(name) {
      route.name = name
      route.path = name === 'Search' ? '/search' : name === 'SongListDetail' ? '/songList/detail' : '/list'
      await vue.nextTick()
      while (timers.length) timers.shift()()
      await vue.nextTick()
    },
  }
}

for (const scenario of [
  { clearInput: false, clearList: false, input: '洛雪', query: '洛雪' },
  { clearInput: true, clearList: false, input: '', query: '洛雪' },
  { clearInput: false, clearList: true, input: '洛雪', query: '' },
  { clearInput: true, clearList: true, input: '', query: '' },
]) test(`leaving search independently clears input=${scenario.clearInput} and results=${scenario.clearList}`, async t => {
  const x = fixture(t, scenario)
  await x.search('洛雪')
  await x.navigate('List')
  assert.equal(x.state.searchText.value, scenario.input)
  assert.equal(x.query.value, scenario.query)
})

test('opening a song-list detail preserves the current query and draft input', async t => {
  const x = fixture(t, { clearInput: true, clearList: true })
  await x.search('歌单')
  x.state.searchText.value = '未提交'
  await x.navigate('SongListDetail')
  assert.equal(x.state.searchText.value, '未提交')
  assert.equal(x.query.value, '歌单')
})

test('clearing results preserves unsubmitted input and later searches still update the input', async t => {
  const x = fixture(t, { clearInput: false, clearList: true })
  await x.search('已提交')
  x.state.searchText.value = '未提交'
  await x.navigate('List')
  assert.equal(x.state.searchText.value, '未提交')
  assert.equal(x.query.value, '')
  await x.navigate('Search')
  await x.search('下一次搜索')
  assert.equal(x.state.searchText.value, '下一次搜索')
})
