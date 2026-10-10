import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchTopics } from './client.ts'

test('通过 Preload 服务加载热门列表', async () => {
  let requestedKind = ''
  globalThis.window = {
    services: {
      getV2exTopics: async (kind: string) => {
        requestedKind = kind
        return []
      }
    }
  }

  await fetchTopics('hot')

  assert.equal(requestedKind, 'hot')
})

test('Preload 不可用时提示需要在 ZTools 中打开', async () => {
  globalThis.window = {} as Window & typeof globalThis

  assert.throws(() => fetchTopics('latest'), /ZTools 中重新打开插件/)
})
