/*
 * 图片路径 → `file://` URL（`imageSrc`）。
 *
 * 为什么值得单测：这段逻辑**在 macOS 上怎么错都看不出来**。
 * 宿主给的 `imagePath` 是原生绝对路径，mac 是 `/Users/…`，
 * `'file://' + '/Users/…'` 恰好拼成合法的 `file:///Users/…`；
 * 而 Windows 是 `C:\Users\…`，同一个写法拼出来是 `file://C:%5CUsers%5C…`
 * —— 全部落进 URL 的 host 位，`<img>` 静默 `@error`，缩略图全线变占位图标。
 * （09-19 真机就是栽在这里：他那台 Windows 上所有图片缩略图都不显示。）
 *
 * ⇒ 所以这里锁两件事：
 *   ① 三个平台的路径各自拼成什么（POSIX / 盘符 / UNC）；
 *   ② **拼出来的每一个结果都必须能被 `new URL()` 解析** ——
 *      这条是真正防复发的，比逐个断言字符串形状更能抓住"又拼歪了"。
 *
 * 跑法：node --experimental-strip-types --test tests/image.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { imageSrc, type ClipContent } from '../src/lib/clipboard.ts'

const img = (p?: string, content?: string): ClipContent =>
  ({ type: 'image', imagePath: p, content }) as ClipContent

test('POSIX 绝对路径：`file://` + `/…` 恰好凑成三个斜杠（mac 上一直是好的，别改坏）', () => {
  assert.equal(
    imageSrc(img('/Users/xiaoxing/.ztools/clipboard/images/1789634327136-36c4816b.png')),
    'file:///Users/xiaoxing/.ztools/clipboard/images/1789634327136-36c4816b.png'
  )
})

test('★ Windows 盘符路径：反斜杠换正斜杠、盘符前补一个斜杠', () => {
  assert.equal(
    imageSrc(img('C:\\Users\\xiaoxing\\AppData\\Roaming\\ztools\\clipboard\\images\\1789634327136-36c4816b.png')),
    'file:///C:/Users/xiaoxing/AppData/Roaming/ztools/clipboard/images/1789634327136-36c4816b.png'
  )
  // 已经是正斜杠的写法（有些地方会给这种）走同一条路
  assert.equal(imageSrc(img('D:/ztools/clipboard/images/a.png')), 'file:///D:/ztools/clipboard/images/a.png')
})

test('UNC 路径：server 当 host，只能有两个斜杠', () => {
  assert.equal(imageSrc(img('\\\\server\\share\\a.png')), 'file://server/share/a.png')
})

test('★ 产出的 URL 一律能被 `new URL()` 解析（这条才防复发）', () => {
  const paths = [
    '/Users/x/.ztools/clipboard/images/a.png',
    'C:\\Users\\x\\AppData\\Roaming\\ztools\\clipboard\\images\\a.png',
    'C:/Users/x/ztools/a.png',
    '\\\\server\\share\\a.png',
    '/Users/x/My Documents/报告 2026.png'
  ]
  for (const p of paths) {
    const url = imageSrc(img(p))
    assert.doesNotThrow(() => new URL(url), `拼出来的不是合法 URL: ${url}`)
  }
})

test('路径里的空格、中文、`#` 都要编码（不然会被当成 URL 的片段分隔符）', () => {
  assert.equal(imageSrc(img('/Users/x/a b.png')), 'file:///Users/x/a%20b.png')
  assert.equal(imageSrc(img('/Users/x/图 1#2.png')), 'file:///Users/x/%E5%9B%BE%201%232.png')
})

test('已经是 URL 的原样放行（含大小写混写）', () => {
  for (const u of [
    'file:///C:/x/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:http://localhost:5181/abc',
    'https://example.com/a.png',
    'HTTP://example.com/a.png'
  ]) {
    assert.equal(imageSrc(img(u)), u)
  }
})

test('没有 imagePath 时退回 content（宿主两种形态都给过）', () => {
  assert.equal(imageSrc(img(undefined, '/Users/x/a.png')), 'file:///Users/x/a.png')
})

test('两个都没有 ⇒ 空串（模板会退成占位图标，不该拼出 `file://` 这种半截 URL）', () => {
  assert.equal(imageSrc(img()), '')
  assert.equal(imageSrc(img('')), '')
})
