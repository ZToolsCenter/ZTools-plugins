/*
 * 设置的读取容错。
 *
 * 设置存在宿主库里、由插件自己写，所以库里的值**不受我们控制** ——
 * 可能是上一个版本写的（比如 `mark` 只有 border / tint 两种的时候），
 * 也可能被人手工改过。读的时候必须一类一类地看，认不出就退回默认，
 * 绝不把非法值原样带进界面（带进去就是"选了没反应"或者整块面板没颜色）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SETTINGS,
  FOOT_MODES,
  MARK_MODES,
  normalizeSettings
} from '../src/lib/settings.ts'

test('空 / undefined → 全是默认值', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
})

test('默认：详情关、强调色跟随、选中项描框、底色跟随窗口、底栏完整', () => {
  assert.equal(DEFAULT_SETTINGS.peek, false)
  assert.equal(DEFAULT_SETTINGS.accent, 'auto')
  assert.equal(DEFAULT_SETTINGS.mark, 'border')
  // 「跟随窗口」= 不画底。默认就该跟顶部那行零色差，不是配一个相近的色号
  assert.equal(DEFAULT_SETTINGS.bg, 'auto')
  // 底栏默认完整：键位提示是给刚开始用的人看的，先给上
  assert.equal(DEFAULT_SETTINGS.foot, 'full')
})

test('三种选中项都认（含 09-14 新加的实心）', () => {
  for (const m of MARK_MODES) {
    assert.equal(normalizeSettings({ mark: m }).mark, m)
  }
})

test('认不出的选中项退回描框，不是原样带进去', () => {
  assert.equal(normalizeSettings({ mark: 'rainbow' }).mark, 'border')
  assert.equal(normalizeSettings({ mark: 123 }).mark, 'border')
  // 老版本存过的值里没有第三种，读出来也不该崩
  assert.equal(normalizeSettings({ mark: 'solid' }).mark, 'solid')
})

test('强调色认那 12 个键，认不出退回跟随', () => {
  assert.equal(normalizeSettings({ accent: 'teal' }).accent, 'teal')
  assert.equal(normalizeSettings({ accent: 'slate' }).accent, 'slate')
  assert.equal(normalizeSettings({ accent: 'chartreuse' }).accent, 'auto')
})

test('peek 只认严格 true —— 字符串 "false" 不能算开', () => {
  assert.equal(normalizeSettings({ peek: true }).peek, true)
  assert.equal(normalizeSettings({ peek: 'false' }).peek, false)
  assert.equal(normalizeSettings({ peek: 1 }).peek, false)
})

test('底色认那几个键，认不出退回跟随窗口', () => {
  assert.equal(normalizeSettings({ bg: 'white' }).bg, 'white')
  assert.equal(normalizeSettings({ bg: 'warm' }).bg, 'warm')
  assert.equal(normalizeSettings({ bg: 'rainbow' }).bg, 'auto')
  assert.equal(normalizeSettings({ bg: 0 }).bg, 'auto')
})

test('底栏四档都认，认不出退回完整', () => {
  for (const f of FOOT_MODES) {
    assert.equal(normalizeSettings({ foot: f }).foot, f)
  }
  assert.equal(normalizeSettings({ foot: 'hidden' }).foot, 'full')
  assert.equal(normalizeSettings({ foot: null }).foot, 'full')
})

test('多余的键一律丢掉，不往界面里带', () => {
  const s = normalizeSettings({ peek: true, theme: 'dark', accent: 'blue', 乱写: 1 })
  assert.deepEqual(Object.keys(s).sort(), [
    'accent',
    'bg',
    'confirmDelete',
    'foot',
    'mark',
    'peek',
    'tailActs',
    'tailIndex',
    'tailSource',
    'tailType'
  ])
})

/*
 * ★ 这一组锁的是「**加设置不能顺手改掉老用户的行为**」。
 *
 * `confirmDelete` / `tailType` / `tailActs` 的默认值是 `true`，而老版本存下来的文档里
 * 这三个键**根本不存在**（`undefined`）。如果 normalize 写成 `=== true`，
 * 所有老用户升级后会被悄悄关掉「删除前确认」和「行尾按钮」——
 * 那不是加设置，是改别人已有的行为。所以这里专门断言 `undefined` 要落到 `true`。
 */
test('老文档缺字段时，默认 true 的项要补 true（不能因为 undefined 就变 false）', () => {
  const old = normalizeSettings({ peek: true, accent: 'auto', mark: 'border', bg: 'auto', foot: 'full' })
  assert.equal(old.confirmDelete, true)
  assert.equal(old.tailType, true)
  assert.equal(old.tailActs, true)
  // 序号是默认 false 的那一类，缺字段就该是关的
  assert.equal(old.tailIndex, false)
  // 来源同理：老文档里没这个键 ⇒ 关（不能因为"加了个设置"就给别人多显示一列）
  assert.equal(old.tailSource, false)
})

test('这四个新项：显式写的值要认', () => {
  const s = normalizeSettings({ confirmDelete: false, tailType: false, tailIndex: true, tailActs: false })
  assert.equal(s.confirmDelete, false)
  assert.equal(s.tailType, false)
  assert.equal(s.tailIndex, true)
  assert.equal(s.tailActs, false)
})

test('默认 true 的项也认「垃圾值」—— 非 false 一律当开（不猜，只认显式关）', () => {
  assert.equal(normalizeSettings({ confirmDelete: 0 }).confirmDelete, true)
  assert.equal(normalizeSettings({ tailActs: 'no' }).tailActs, true)
  assert.equal(normalizeSettings({ tailIndex: 'yes' }).tailIndex, false)
})
