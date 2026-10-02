import test from 'node:test'
import assert from 'node:assert/strict'
import { FeedCache } from './feed-cache.ts'
import type { TopicSummary } from './types.ts'

const hotTopics = [{ id: 1 }] as TopicSummary[]
const latestTopics = [{ id: 2 }] as TopicSummary[]

test('十分钟内切换回同一列表时复用缓存', async () => {
  let calls = 0
  const cache = new FeedCache(async (kind) => {
    calls += 1
    return kind === 'hot' ? hotTopics : latestTopics
  }, () => 1_000)

  await cache.load('hot')
  await cache.load('latest')
  const topics = await cache.load('hot')

  assert.equal(calls, 2)
  assert.equal(topics, hotTopics)
})

test('热门缓存十分钟后切换回来会重新请求', async () => {
  let now = 1_000
  let calls = 0
  const cache = new FeedCache(async () => {
    calls += 1
    return hotTopics
  }, () => now)

  await cache.load('hot')
  now += 10 * 60 * 1_000
  await cache.load('hot')

  assert.equal(calls, 2)
})

test('最新缓存两分钟后切换回来会重新请求', async () => {
  let now = 1_000
  let calls = 0
  const cache = new FeedCache(async () => {
    calls += 1
    return latestTopics
  }, () => now)

  await cache.load('latest')
  now += 2 * 60 * 1_000
  await cache.load('latest')

  assert.equal(calls, 2)
})

test('手动刷新立即请求并更新对应缓存', async () => {
  let calls = 0
  const cache = new FeedCache(async () => {
    calls += 1
    return calls === 1 ? hotTopics : latestTopics
  }, () => 1_000)

  await cache.load('hot')
  const refreshed = await cache.load('hot', true)
  const cached = await cache.load('hot')

  assert.equal(calls, 2)
  assert.equal(refreshed, latestTopics)
  assert.equal(cached, latestTopics)
})
