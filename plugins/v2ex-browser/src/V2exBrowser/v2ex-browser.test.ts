import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('组件包含热门、最新、刷新和详情操作', () => {
  const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
  for (const label of ['热门', '最新', '刷新', '返回列表', '在浏览器打开']) {
    assert.match(source, new RegExp(label))
  }
})

test('原帖跳转按钮始终使用蓝色主操作样式', () => {
  const stylesheet = readFileSync(new URL('../main.css', import.meta.url), 'utf8')

  const rule = /\.open-button \{([^}]*)\}/.exec(stylesheet)?.[1] ?? ''
  assert.match(rule, /background: #1677ff/)
  assert.match(rule, /color: #fff/)
  assert.match(rule, /border: 1px solid #1677ff/)
})
