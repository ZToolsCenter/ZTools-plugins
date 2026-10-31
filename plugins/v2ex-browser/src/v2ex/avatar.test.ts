import test from 'node:test'
import assert from 'node:assert/strict'
import { createAvatarStore } from './avatar.ts'

test('头像请求成功后缓存 data URL', async () => {
  const store = createAvatarStore(async () => 'data:image/png;base64,avatar')

  await store.load('https://cdn.v2ex.com/avatar/example.png')

  assert.equal(store.get('https://cdn.v2ex.com/avatar/example.png'), 'data:image/png;base64,avatar')
})

test('同一头像地址只请求一次', async () => {
  let calls = 0
  const store = createAvatarStore(async () => {
    calls += 1
    return 'data:image/png;base64,avatar'
  })

  await Promise.all([store.load('https://cdn.v2ex.com/avatar/example.png'), store.load('https://cdn.v2ex.com/avatar/example.png')])

  assert.equal(calls, 1)
})

test('头像先写入缓存再通知视图更新，命中缓存不重复通知', async () => {
  const url = 'https://cdn.v2ex.com/avatar/example.png'
  const readyImages: (string | undefined)[] = []
  const store = createAvatarStore(async () => 'data:image/png;base64,avatar', () => {
    readyImages.push(store.get(url))
  })

  await store.load(url)
  await store.load(url)

  assert.deepEqual(readyImages, ['data:image/png;base64,avatar'])
})
