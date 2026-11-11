const { test } = require('node:test')
const assert = require('node:assert/strict')
const postcss = require('postcss')
const config = require('../../build-config/ztools/postcss.config.cjs')
const transform = (css, from) => postcss(config.plugins).process(css, { from }).then(result => result.css)

test('app typography and related dimensions follow rem while fixed host rules remain fixed', async () => {
  const css = await transform('.setting { font-size: 14px; padding: 16px; width: 160px } html { font-size: 16px } .ignore-to-rem { font-size: 13px } @media (min-width: 1200px) { .setting { margin: 8px } }', 'C:/project/src/Setting.vue')
  assert.match(css, /font-size: 0\.875rem/)
  assert.match(css, /padding: 1rem/)
  assert.match(css, /width: 10rem/)
  assert.match(css, /html \{ font-size: 16px \}/)
  assert.match(css, /ignore-to-rem \{ font-size: 13px \}/)
  assert.match(css, /min-width: 1200px/)
})

test('third-party CSS is excluded from application font scaling on Windows and slash paths', async () => {
  const css = '.picker { font-size: 16px; padding: 8px; border-radius: 4px }'
  for (const file of ['C:/project/node_modules/picker/theme.css', 'C:\\project\\node_modules\\picker\\theme.css']) assert.equal(await transform(css, file), css)
})
