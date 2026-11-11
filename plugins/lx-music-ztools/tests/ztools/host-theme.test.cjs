const { test } = require('node:test')
const assert = require('node:assert/strict')
const { bindHostTheme } = require('../../src/ztools/host-theme.cjs')
test('host color changes update automatic LX themes without replacing a selected manual theme', () => {
  const applied = [], setting = { 'theme.id': 'auto', 'theme.lightId': 'green', 'theme.darkId': 'black' }
  let dark = false, notify, update
  bindHostTheme({ host: { isDarkColors: () => true, onThemeChange: cb => { notify = cb } }, setting,
    setDark: value => { dark = value }, apply: (id, light, black) => applied.push({ id, light, black, dark }), watch: cb => { update = cb } })
  assert.deepEqual(applied.at(-1), { id: 'auto', light: 'green', black: 'black', dark: true })
  notify({ isDark: false }); assert.equal(applied.at(-1).dark, false)
  setting['theme.id'] = 'blue'; update()
  const count = applied.length; notify({ isDark: true })
  assert.equal(applied.length, count); assert.equal(applied.at(-1).id, 'blue')
  setting['theme.id'] = 'auto'; update(); assert.equal(applied.at(-1).dark, true)
})
