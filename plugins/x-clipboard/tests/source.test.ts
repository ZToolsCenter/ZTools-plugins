/*
 * 行尾「来源」的短名换算（`lib/source.ts`）。
 *
 * 这里全是"看着无所谓、错了却很难发现"的形状：
 *   · 宿主的 `appName` 是**应用全名带 `.app` 后缀**（"Visual Studio Code.app"）；
 *   · 老数据 / 老收藏里**根本没有这个字段** ⇒ 必须回 `null`。
 *     回空串会让模板渲染出一个空的 `<span>`（`.tail` 的 6px gap 白占一格），
 *     回"未知"则是凭空多出一列 —— 两种都是"加个设置反而把界面搞脏了"。
 *
 * ⚠️ 显示名一律从 `appName` 出，**不看 `bundleId`**：`bundleId` 是机器标识
 *    （`com.microsoft.VSCode`），拿它显示是给用户看天书。它留着是给"按来源搜"以后用的。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import type { ClipContent } from '../src/lib/clipboard.ts'
import { sourceLabel } from '../src/lib/source.ts'

const clip = (appName?: string): ClipContent => ({ type: 'text', appName })

test('没有来源 ⇒ null（老数据不能渲染出一格空 span）', () => {
  assert.equal(sourceLabel(clip(undefined)), null)
  assert.equal(sourceLabel(clip('')), null)
  assert.equal(sourceLabel(clip('   ')), null)
  // 只剩个后缀：剥完是空的，也该回 null（不然行尾会多出一格空白）
  assert.equal(sourceLabel(clip('.app')), null)
})

test('★ 剥掉 .app 后缀（宿主给的是应用全名）', () => {
  assert.equal(sourceLabel(clip('Finder.app')), 'Finder')
  assert.equal(sourceLabel(clip('iTerm.app')), 'iTerm')
  assert.equal(sourceLabel(clip('CC Switch.app')), 'CC Switch')
  // 后缀判定大小写不敏感 —— 别哪天宿主换个写法就多出一串 ".APP"
  assert.equal(sourceLabel(clip('Finder.APP')), 'Finder')
  // 本来就没后缀的原样返回
  assert.equal(sourceLabel(clip('Finder')), 'Finder')
})

test('★ 短名表：长名字压短，不在表里的原样用', () => {
  assert.equal(sourceLabel(clip('Visual Studio Code.app')), 'VSCode')
  assert.equal(sourceLabel(clip('Google Chrome.app')), 'Chrome')
  assert.equal(sourceLabel(clip('IntelliJ IDEA.app')), 'IDEA')
  assert.equal(sourceLabel(clip('ima.copilot.app')), 'ima')
  // 表外的应用：剥后缀直接用 —— 不猜、不乱缩写（猜错了比长一点更难发现）
  assert.equal(sourceLabel(clip('WorkBuddy.app')), 'WorkBuddy')
})

test('前后空白不影响判定', () => {
  assert.equal(sourceLabel(clip('  Finder.app  ')), 'Finder')
})

test('跟内容字段无关：图片 / 文件行也有来源', () => {
  const img: ClipContent = { type: 'image', imagePath: '/a/b.png', appName: 'Google Chrome.app' }
  assert.equal(sourceLabel(img), 'Chrome')
})
