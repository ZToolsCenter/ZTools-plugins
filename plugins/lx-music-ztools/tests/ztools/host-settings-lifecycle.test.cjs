const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const adapt = require('../../build-config/ztools/host-lifecycle-loader.cjs')
function load(name, imports, context = {}) {
  const file = `vendor/lx/src/renderer/core/useApp/${name}.ts`
  const code = ts.transpileModule(adapt.call({ resourcePath: file }, fs.readFileSync(file, 'utf8')), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: key => imports[key] ?? { default: () => () => {} }, ...context })
  return module.exports.default
}
test('desktop fullscreen backup values cannot force fullscreen into the plugin renderer', () => {
  const isFullscreen = { value: false }
  load('index', {
    '@renderer/utils/ipc': { getEnvParams: () => new Promise(() => {}) },
    '@renderer/store': { proxy: {}, isFullscreen, themeId: {} },
    '@renderer/store/setting': { appSetting: { 'common.startInFullscreen': true } },
    '@common/utils/vueRouter': { useRouter: () => ({}) },
  })()
  assert.equal(isFullscreen.value, false)
})
test('legacy window dimensions remain stored without resizing the host, while font settings still apply', async () => {
  const appSetting = vue.reactive({ 'common.windowSizeId': 0, 'common.fontSize': 16 }), calls = [], style = {}
  const scope = vue.effectScope()
  const setup = load('useSettingSync', {
    '@common/utils/vueTools': vue,
    '@renderer/store': { isFullscreen: { value: false }, windowSizeList: [{ width: 800, height: 600 }, { width: 1000, height: 700 }], sync: { server: {}, client: {} }, proxy: {} },
    '@renderer/store/setting': { appSetting },
    '@renderer/utils/ipc': { setWindowSize: (...args) => calls.push(args) },
  }, { document: { documentElement: { style } }, window: {} })
  scope.run(setup)
  appSetting['common.windowSizeId'] = 1; appSetting['common.fontSize'] = 18
  await vue.nextTick(); scope.stop()
  assert.equal(appSetting['common.windowSizeId'], 1)
  assert.deepEqual(calls, [])
  assert.equal(style.fontSize, '18px')
})
