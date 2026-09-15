import test from 'node:test'
import assert from 'node:assert/strict'
import { splitStreamingMarkdown } from '../../src/utils/markdown.js'

test('普通段落在空行结束后成为稳定块', () => {
  assert.deepEqual(splitStreamingMarkdown('第一段。\n\n'), {
    completedBlocks: ['第一段。'],
    tail: '',
  })
  assert.deepEqual(splitStreamingMarkdown('第一段。\n\n第二段正在输出'), {
    completedBlocks: ['第一段。'],
    tail: '第二段正在输出',
  })
})

test('没有安全空行的未完成段落保持为纯文本尾部', () => {
  assert.deepEqual(splitStreamingMarkdown('正在输出 **尚未闭合'), {
    completedBlocks: [],
    tail: '正在输出 **尚未闭合',
  })
})

test('代码围栏内部空行不会拆分 Markdown 块', () => {
  const code = '```js\nconst first = 1\n\nconst second = 2\n```\n\n后续'
  assert.deepEqual(splitStreamingMarkdown(code), {
    completedBlocks: ['```js\nconst first = 1\n\nconst second = 2\n```'],
    tail: '后续',
  })
})

test('块级公式内部空行不会拆分 Markdown 块', () => {
  const formula = '$$\na + b\n\n= c\n$$\n\n解释'
  assert.deepEqual(splitStreamingMarkdown(formula), {
    completedBlocks: ['$$\na + b\n\n= c\n$$'],
    tail: '解释',
  })
})

test('连续列表在后续普通段落出现前始终保留为同一尾部', () => {
  const partial = '- 第一项\n\n- 第二项'
  assert.deepEqual(splitStreamingMarkdown(partial), {
    completedBlocks: [],
    tail: partial,
  })

  const continued = `${partial}\n\n结论正在输出`
  assert.deepEqual(splitStreamingMarkdown(continued), {
    completedBlocks: [partial],
    tail: '结论正在输出',
  })
})

test('表格作为完整块冻结且后续追加不会改变既有块', () => {
  const table = '| 名称 | 值 |\n| --- | --- |\n| A | 1 |'
  const first = splitStreamingMarkdown(`${table}\n\n后续`)
  const appended = splitStreamingMarkdown(`${table}\n\n后续内容继续增长`)
  assert.equal(first.completedBlocks[0], table)
  assert.equal(appended.completedBlocks[0], first.completedBlocks[0])
  assert.equal(appended.tail, '后续内容继续增长')
})
