import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_RETRY_MAX_RETRIES,
  createChatRetryState,
  getChatRetryDelayMs,
  isRetryableChatError,
} from '../../src/services/chat-retry.js'

test('服务端临时故障、限流和网络错误会进入自动重试', () => {
  assert.equal(isRetryableChatError({ code: 'SERVER', status: 503, message: 'Upstream service temporarily unavailable' }), true)
  assert.equal(isRetryableChatError({ code: 'RATE_LIMIT', status: 429, message: 'Too many requests' }), true)
  assert.equal(isRetryableChatError({ code: 'TRANSPORT', message: 'fetch failed: ECONNRESET' }), true)
  assert.equal(isRetryableChatError({ code: 'SERVER', message: 'Upstream request failed' }), true)
  assert.equal(isRetryableChatError({ status: 400, message: 'invalid model parameter' }), false)
  assert.equal(isRetryableChatError({ code: 'CONTEXT_WINDOW_EXCEEDED', status: 400 }), false)
  assert.equal(isRetryableChatError({ name: 'AbortError', message: 'aborted' }), false)
})

test('无服务端提示时使用 Harness 风格指数退避并限制为十秒', () => {
  const error = { code: 'SERVER', status: 503, message: 'Service unavailable' }
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => getChatRetryDelayMs(error, index + 1, 0)),
    [450, 900, 1800, 3600, 7200, 9000],
  )
  assert.equal(getChatRetryDelayMs(error, 1, 1), 550)
})

test('优先遵循 retry-after-ms、秒数和 HTTP 日期响应头', () => {
  assert.equal(getChatRetryDelayMs({ responseHeaders: { 'retry-after-ms': '1500' } }, 4), 1500)
  assert.equal(getChatRetryDelayMs({ responseHeaders: { 'Retry-After': '3' } }, 1), 3000)
  const retryAt = new Date(Date.now() + 5000).toUTCString()
  const dateDelay = getChatRetryDelayMs({ responseHeaders: { 'retry-after': retryAt } }, 1)
  assert.ok(dateDelay >= 4000 && dateDelay <= 5000)
})

test('重试状态包含倒计时信息并在两次后停止', () => {
  const error = { code: 'SERVER', status: 503, message: 'Upstream service temporarily unavailable', responseHeaders: { 'retry-after-ms': '250' } }
  const retry = createChatRetryState(error, 1, 1000, 0)
  assert.deepEqual(retry, {
    attempt: 1,
    maxRetries: CHAT_RETRY_MAX_RETRIES,
    message: '模型服务暂时不可用',
    nextAt: 1250,
    delayMs: 250,
    failure: {
      message: 'Upstream service temporarily unavailable',
      code: 'SERVER',
      status: 503,
    },
  })
  assert.equal(createChatRetryState(error, CHAT_RETRY_MAX_RETRIES + 1, 1000, 0), null)
})

test('超过 Harness 退避上限的 provider delay 不会让会话无限等待', () => {
  assert.equal(createChatRetryState({ code: 'SERVER', status: 503, responseHeaders: { 'retry-after-ms': '10001' } }, 1), null)
})
