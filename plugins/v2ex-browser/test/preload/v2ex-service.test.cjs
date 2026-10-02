const assert = require('node:assert/strict')
const test = require('node:test')
const { createV2exService } = require('../../src-ztools/preload/v2ex-service.cjs')

test('通过 Node 系统代理请求 V2EX 最新帖子', async () => {
  let calledUrl = ''
  const service = createV2exService(async (url) => {
    calledUrl = url
    return [{ id: 1 }]
  })

  const topics = await service.getTopics('latest')

  assert.equal(calledUrl, 'https://www.v2ex.com/api/topics/latest.json')
  assert.deepEqual(topics, [{ id: 1 }])
})

test('将网络异常转换成供页面展示的错误', async () => {
  const service = createV2exService(async () => {
    throw new Error('net::ERR_CONNECTION_TIMED_OUT')
  })

  await assert.rejects(service.getTopics('hot'), /无法通过系统代理连接到 V2EX/)
})
