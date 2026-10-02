import test from 'node:test'
import assert from 'node:assert/strict'
import { filterTopics, formatRelativeTime } from './presentation.ts'
import type { TopicSummary } from './types.ts'

const topics: TopicSummary[] = [
  {
    id: 1,
    title: 'Vue 使用心得',
    url: 'https://www.v2ex.com/t/1',
    content: '',
    content_rendered: '',
    replies: 2,
    created: 900,
    node: { name: 'javascript', title: 'JavaScript' },
    member: { username: 'alice', avatar_normal: '' }
  }
]

test('按标题、节点和作者过滤帖子', () => {
  assert.equal(filterTopics(topics, 'Vue').length, 1)
  assert.equal(filterTopics(topics, 'alice').length, 1)
  assert.equal(filterTopics(topics, 'javascript').length, 1)
  assert.equal(filterTopics(topics, 'react').length, 0)
})

test('将 Unix 秒级时间格式化为相对时间', () => {
  assert.equal(formatRelativeTime(970, 1_000), '刚刚')
  assert.equal(formatRelativeTime(880, 1_000), '2 分钟前')
  assert.equal(formatRelativeTime(1_000 - 3_600 * 3, 1_000), '3 小时前')
})
