/*
 * 键盘提示里的修饰键写法。
 *
 * 看着琐碎，但它是**用户看得见的东西**：Windows 的键盘上没有 ⌘ 键，
 * 提示里写「⌘K」，那边的人等于看不懂。老大 09-15 专门提了这一点，
 * 所以这条得有测试盯着 —— 以后谁顺手写死一个 ⌘，这里会红。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { modKey } from '../src/lib/platform.ts'

test('mac：⌘ + 键名', () => {
  assert.equal(modKey('K', true), '⌘K')
  assert.equal(modKey('C', true), '⌘C')
  assert.equal(modKey('L', true), '⌘L')
})

test('Windows / Linux：Ctrl + 键名', () => {
  assert.equal(modKey('K', false), 'Ctrl+K')
  assert.equal(modKey('C', false), 'Ctrl+C')
  assert.equal(modKey('L', false), 'Ctrl+L')
})

test('不传第二个参数也拿得到字符串（不在宿主里跑时也不该炸）', () => {
  // 单测环境没有 window / navigator，detectMac 走两轮 catch 后当非 mac
  assert.equal(typeof modKey('K'), 'string')
})
