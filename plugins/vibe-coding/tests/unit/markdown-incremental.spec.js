import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStreamingMarkdown } from '../../src/utils/markdown/parse.js'
import { createIncrementalMarkdownParser } from '../../src/utils/markdown/incremental.js'

/**
 * 创建包含大量独立段落的可追加 Markdown 文档。
 * @param {number} count 段落数量。
 * @returns {string} 测试 Markdown 文档。
 */
function createDocument(count) {
  return Array.from({ length: count }, (_, index) => `段落 ${index}：包含 **加粗**、\`代码\` 和一段用于测量的文本。`).join('\n\n')
}

/**
 * 将文档逐段追加到增量解析器并统计实际解析字符数。
 * @param {string} document Markdown 文档。
 * @returns {{cost: number, updates: number, last: object}} 解析成本和最后一帧结果。
 */
function measureIncremental(document) {
  let cost = 0
  let updates = 0
  const parser = createIncrementalMarkdownParser((tail) => {
    cost += tail.length
    updates += 1
    return parseStreamingMarkdown(tail)
  })
  let source = ''
  let last
  for (const paragraph of document.split('\n\n')) {
    source += `${source ? '\n\n' : ''}${paragraph}`
    last = parser.update(source)
  }
  return { cost, updates, last }
}

test('AST 增量解析按源码偏移冻结前缀并保留两个尾部块', () => {
  const parser = createIncrementalMarkdownParser(parseStreamingMarkdown)
  const result = parser.update('a\n\nb\n\nc\n\nd')
  assert.deepEqual(result.frozen.map((block) => block.key), [0, 3])
  assert.deepEqual(result.tail.map((block) => block.key), [6, 9])
})

test('非追加文本会重置 generation 和冻结缓存', () => {
  const parser = createIncrementalMarkdownParser(parseStreamingMarkdown)
  const before = parser.update('a\n\nb\n\nc\n\nd')
  const after = parser.update('new content')
  assert.equal(after.generation, before.generation + 1)
  assert.equal(after.frozen.length, 0)
  assert.equal(after.tail.length, 1)
})

test('流式解析累计字符数显著低于每帧完整解析', () => {
  const document = createDocument(240)
  const incremental = measureIncremental(document)
  let fullCost = 0
  let source = ''
  for (const paragraph of document.split('\n\n')) {
    source += `${source ? '\n\n' : ''}${paragraph}`
    fullCost += source.length
  }
  assert.ok(incremental.updates === 240)
  assert.ok(incremental.cost < fullCost * 0.25, `增量解析 ${incremental.cost}，完整解析 ${fullCost}`)
  assert.equal(incremental.last.frozen.length, 238)
  assert.equal(incremental.last.tail.length, 2)
})
