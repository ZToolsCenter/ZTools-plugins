import test from 'node:test'
import assert from 'node:assert/strict'
import * as threading from './reply-threads.ts'
import type { TopicReply } from './types.ts'

const reply = (id: number, username: string, content: string): TopicReply => ({
  id, content, content_rendered: '', created: 1_000,
  member: { username, avatar_normal: '' }
})

test('按前置用户名建立多级回复，并保留原楼层与原始数据', () => {
  const replies = [reply(21, 'Peng0620', '祝大卖'), reply(27, 'BerniLin', '@Peng0620 谢谢'), reply(29, 'jacketma', '@BerniLin 👍')]
  const before = structuredClone(replies)
  const threads = threading.buildReplyThreads(replies)

  assert.equal(threads.length, 1)
  assert.equal(threads[0].floor, 1)
  assert.equal(threads[0].children[0].reply.id, 27)
  assert.equal(threads[0].children[0].children[0].reply.id, 29)
  assert.equal(threads[0].children[0].children[0].floor, 3)
  assert.equal(threads[0].children[0].content, '谢谢')
  assert.deepEqual(replies, before)
})

test('明确楼层优先于最近同名用户，同一父评论的子回复必须平级', () => {
  const replies = [
    reply(77, '94nb', '问题'),
    reply(98, 'BerniLin', '@94nb 回答'),
    reply(102, '94nb', '@BerniLin #2 补充'),
    reply(117, 'lovedeepl', '@94nb #1 同问')
  ]
  const threads = threading.buildReplyThreads(replies)

  assert.deepEqual(threads[0].children.map(node => node.reply.id), [98, 117])
  assert.equal(threads[0].children[0].children[0].reply.id, 102)
  assert.equal(threads[0].children[1].content, '#1 同问')
})

test('未指定楼层时匹配该用户最近的前置评论，用户名不区分大小写', () => {
  const threads = threading.buildReplyThreads([
    reply(1, 'Alice', '第一条'), reply(2, 'alice', '第二条'), reply(3, 'bob', '@ALICE 回第二条')
  ])
  assert.equal(threads.length, 2)
  assert.equal(threads[0].children.length, 0)
  assert.equal(threads[1].children[0].reply.id, 3)
})

test('明确楼层不存在、指向未来或作者不符时独立展示，不退回最近用户匹配', () => {
  const replies = [
    reply(1, 'alice', '原评论'),
    reply(2, 'bob', '@alice #99 不存在'),
    reply(3, 'carol', '@alice #4 尚未出现'),
    reply(4, 'dave', '@alice #2 作者不符'),
    reply(5, 'erin', '@alice #0 无效楼层')
  ]
  const threads = threading.buildReplyThreads(replies)
  assert.equal(threads.length, replies.length)
  assert(threads.every(node => node.children.length === 0))
  assert.equal(threads[1].content, replies[1].content)
})

test('支持只写楼层的回复及自回复，显式楼层不会产生环', () => {
  const threads = threading.buildReplyThreads([
    reply(1, 'alice', '原评论'),
    reply(2, 'alice', '@alice #1 自己补充'),
    reply(3, 'bob', '#2 回复补充'),
    reply(4, 'bob', '@bob #4 指向自己')
  ])
  assert.equal(threads[0].children[0].children[0].reply.id, 3)
  assert.equal(threads[1].reply.id, 4)
  assert.equal(threads[0].children[0].content, '#1 自己补充')
})

test('无前置对象、正文中提及用户以及开头提及多个对象时不猜测关系', () => {
  const replies = [
    reply(1, 'alice', '原评论'), reply(2, 'bob', '正文提到 @alice'),
    reply(3, 'carol', '@missing 找不到对象'), reply(4, 'dave', '@alice @bob 同时回复'),
    reply(5, 'erin', '@alice@example.com 邮件'), reply(6, 'frank', 'https://example.com/#1 链接')
  ]
  assert.equal(threading.buildReplyThreads(replies).length, replies.length)
})

test('关联后只省略开头用户名，完整保留正文、楼层引用与其他提及', () => {
  const threads = threading.buildReplyThreads([
    reply(1, 'alice', '原评论'), reply(2, 'bob', '  @alice #1 第一行\n第二行 @carol <img src=x>'),
    reply(3, 'carol', '@alice')
  ])
  assert.equal(threads[0].children[0].content, '#1 第一行\n第二行 @carol <img src=x>')
  assert.equal(threads[0].children[1].content, '@alice')
})

test('空列表正常返回，多层对话与兄弟评论不会丢失或重复', () => {
  assert.deepEqual(threading.buildReplyThreads([]), [])
  const replies = Array.from({ length: 200 }, (_, i) => reply(i + 1, `user${i}`, i ? `@user${i - 1} 连续回复` : '根评论'))
  const roots = threading.buildReplyThreads(replies)
  const seen = new Set<number>()
  const pending = [...roots]
  while (pending.length) {
    const node = pending.pop()!
    assert(!seen.has(node.reply.id))
    seen.add(node.reply.id)
    pending.push(...node.children)
  }
  assert.equal(seen.size, replies.length)
})
