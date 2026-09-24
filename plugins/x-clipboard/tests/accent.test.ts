/*
 * 强调色的数学 & 设置里的主题 / 强调色解析。
 *
 *   node --experimental-strip-types --test tests/accent.test.ts
 *
 * 最要紧的一条是「深色主题的强调色不能用白字」——
 * 宿主深色主题给的 6 个色都是**亮色**，配白字对比度只有 2:1 上下，直接糊。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACCENT_KEYS,
  ACCENT_PRESETS,
  accentSwatch,
  deriveFrom,
  resolveAccent
} from '../src/lib/accent.ts'

const WHITE = '#ffffff'
const NEAR_BLACK = '#101114'

test('当前行那层淡底按透明度算：13%', () => {
  const d = deriveFrom('#1fa84e')
  assert.equal(d.soft, 'rgba(31, 168, 78, 0.13)')
})

test('浅色那版全是深色，配白字', () => {
  for (const key of ACCENT_KEYS) {
    const hex = ACCENT_PRESETS[key].light
    assert.equal(deriveFrom(hex).text, WHITE, `${key} ${hex}`)
  }
})

test('深色那版全是亮色，必须是近黑字（白字会糊）', () => {
  for (const key of ACCENT_KEYS) {
    const hex = ACCENT_PRESETS[key].dark
    assert.equal(deriveFrom(hex).text, NEAR_BLACK, `${key} ${hex}`)
  }
})

test('调色板：至少 12 个色、键不重复、色值不重复', () => {
  assert.ok(ACCENT_KEYS.length >= 12, `只有 ${ACCENT_KEYS.length} 个色`)
  assert.equal(new Set(ACCENT_KEYS).size, ACCENT_KEYS.length)
  const hexes = ACCENT_KEYS.flatMap((k) => [ACCENT_PRESETS[k].light, ACCENT_PRESETS[k].dark])
  assert.equal(new Set(hexes).size, hexes.length, '有重复色值')
  for (const h of hexes) assert.match(h, /^#[0-9a-f]{6}$/, `${h} 不是 6 位小写 hex`)
})

test('同一个色：浅色那版一定比深色那版深（标反了上面两条会一起挂）', () => {
  for (const key of ACCENT_KEYS) {
    const { light, dark } = ACCENT_PRESETS[key]
    assert.equal(deriveFrom(light).text, WHITE, key)
    assert.equal(deriveFrom(dark).text, NEAR_BLACK, key)
  }
})

test('三位的简写也认', () => {
  assert.equal(deriveFrom('#fff').soft, 'rgba(255, 255, 255, 0.13)')
})

test('强调色：auto = 不覆盖（返回 null，沿用宿主注入的那个）', () => {
  assert.equal(resolveAccent('auto', false), null)
  assert.equal(resolveAccent('auto', true), null)
})

test('强调色：选了预设就按当前深浅取对应的那个色值', () => {
  assert.equal(resolveAccent('green', false), ACCENT_PRESETS.green.light)
  assert.equal(resolveAccent('green', true), ACCENT_PRESETS.green.dark)
  assert.equal(accentSwatch('green', true), ACCENT_PRESETS.green.dark)
})

test('不认识的色名当作没选（退回跟随），不能让整个界面没颜色', () => {
  assert.equal(resolveAccent('chartreuse' as never, false), null)
})
