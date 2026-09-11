export const CHAT_RETRY_MAX_RETRIES = 2
export const CHAT_RETRY_INITIAL_DELAY_MS = 500
export const CHAT_RETRY_MAX_DELAY_MS = 10000
export const CHAT_RETRY_JITTER_FACTOR = 0.1

export const CHAT_RETRYABLE_CODES = Object.freeze([
  'EMPTY_RESPONSE',
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

const RETRYABLE_CODE_SET = new Set(CHAT_RETRYABLE_CODES)

/**
 * 创建没有活动重试的会话状态。
 * @returns {{attempt: number, maxRetries: number, message: string, nextAt: number, delayMs: number, failure: null}} 空重试状态。
 */
export function createEmptyChatRetryState() {
  return { attempt: 0, maxRetries: CHAT_RETRY_MAX_RETRIES, message: '', nextAt: 0, delayMs: 0, failure: null }
}

/**
 * 将跨层错误码规范为 Harness 风格的大写下划线形式。
 * @param {unknown} value 错误码候选值。
 * @returns {string} 规范化错误码；不存在时返回空字符串。
 */
function normalizeChatErrorCode(value) {
  return String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase()
}

/**
 * 从跨提供商错误中读取稳定错误码。
 * @param {unknown} error 模型请求错误。
 * @returns {string} 稳定错误码；错误未携带时返回空字符串。
 */
function readChatErrorCode(error) {
  return normalizeChatErrorCode(error?.failure?.code ?? error?.code)
}

/**
 * 从跨提供商错误中读取 HTTP 状态码。
 * @param {unknown} error 模型请求错误。
 * @returns {number|undefined} 有效 HTTP 状态码；错误未携带时返回 undefined。
 */
function readChatErrorStatus(error) {
  const value = error?.failure?.status ?? error?.status ?? error?.statusCode ?? error?.response?.status
  const status = Number(value)
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined
}

/**
 * 从错误响应头中读取一个不区分大小写的字段。
 * @param {unknown} error 模型请求错误。
 * @param {string} name 响应头名称。
 * @returns {string} 响应头值；不存在时返回空字符串。
 */
function readChatErrorHeader(error, name) {
  const headers = error?.responseHeaders || error?.headers || error?.response?.headers
  if (!headers) return ''
  if (typeof headers.get === 'function') return String(headers.get(name) || '')
  if (typeof headers !== 'object') return ''
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry ? String(entry[1] || '') : ''
}

/**
 * 读取提供商要求的重试等待时长。
 * @param {unknown} error 模型请求错误。
 * @param {number} now 当前时间戳。
 * @returns {number|undefined} 服务端指定的等待毫秒数；不存在时返回 undefined。
 */
function readProviderRetryDelayMs(error, now = Date.now()) {
  const retryAfterMs = Number.parseFloat(readChatErrorHeader(error, 'retry-after-ms'))
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) return Math.ceil(retryAfterMs)

  const retryAfter = readChatErrorHeader(error, 'retry-after')
  const retryAfterSeconds = Number.parseFloat(retryAfter)
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) return Math.ceil(retryAfterSeconds * 1000)
  const retryAt = retryAfter ? Date.parse(retryAfter) - now : Number.NaN
  return Number.isFinite(retryAt) && retryAt > 0 ? Math.ceil(retryAt) : undefined
}

/**
 * 判断一项模型错误是否适合在当前步骤内自动重试。
 * @param {unknown} error 模型请求错误。
 * @returns {boolean} 是否属于 Harness 默认处理的瞬时错误码。
 */
export function isRetryableChatError(error) {
  if (!error) return false
  const code = readChatErrorCode(error)
  if (code === 'ABORTED' || code === 'ABORT_ERR' || code === 'CONTEXT_WINDOW_EXCEEDED') return false
  if (RETRYABLE_CODE_SET.has(code)) return true
  if (code) return false

  // 兼容尚未经过 preload 归一化的 HTTP 错误，正式请求仍以稳定错误码为主。
  const status = readChatErrorStatus(error)
  if (status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599)) return true
  return error?.isRetryable === true
}

/**
 * 按 Harness 兼容规则计算本次重试等待时间。
 * @param {unknown} error 模型请求错误。
 * @param {number} attempt 从 1 开始的重试次数。
 * @param {number} randomValue 0 到 1 的抖动采样值。
 * @param {number} now 当前时间戳。
 * @returns {number} 等待毫秒数。
 */
export function getChatRetryDelayMs(error, attempt, randomValue = Math.random(), now = Date.now()) {
  const providerDelay = readProviderRetryDelayMs(error, now)
  if (providerDelay !== undefined) return providerDelay

  // 使用 500/1000ms 指数退避，并在基准值两侧加入 10% 对称抖动。
  const exponent = Math.max(0, Math.min(Number(attempt) - 1 || 0, 1024))
  const base = Math.min(CHAT_RETRY_INITIAL_DELAY_MS * 2 ** exponent, CHAT_RETRY_MAX_DELAY_MS)
  const sample = Math.min(1, Math.max(0, Number(randomValue) || 0))
  const jitterMultiplier = 1 - CHAT_RETRY_JITTER_FACTOR + 2 * CHAT_RETRY_JITTER_FACTOR * sample
  return Math.min(Math.round(base * jitterMultiplier), CHAT_RETRY_MAX_DELAY_MS)
}

/**
 * 将底层稳定错误码转换为用户可读的重试原因。
 * @param {unknown} error 模型请求错误。
 * @returns {string} 简洁的中文重试原因。
 */
function formatChatRetryMessage(error) {
  const code = readChatErrorCode(error)
  if (code === 'RATE_LIMIT') return '模型请求过于频繁'
  if (code === 'TIMEOUT') return '模型响应暂时超时'
  if (code === 'TRANSPORT') return '网络连接暂时中断'
  if (code === 'EMPTY_RESPONSE') return '模型返回了空响应'
  return '模型服务暂时不可用'
}

/**
 * 创建适合持久化和调试输出的模型失败快照。
 * @param {unknown} error 模型请求错误。
 * @returns {{message: string, code: string, status?: number, requestId?: string, responseBody?: string}} 稳定失败信息。
 */
export function createChatFailureSnapshot(error) {
  const status = readChatErrorStatus(error)
  const requestId = String(error?.failure?.requestId ?? error?.requestId ?? error?.requestID ?? '')
  const responseBody = typeof error?.responseBody === 'string' ? error.responseBody.slice(0, 4000) : ''
  return {
    message: String(error?.failure?.message ?? error?.message ?? '模型请求失败'),
    code: readChatErrorCode(error) || 'UNKNOWN',
    ...(status === undefined ? {} : { status }),
    ...(requestId ? { requestId } : {}),
    ...(responseBody ? { responseBody } : {}),
  }
}

/**
 * 为下一次自动重试创建可直接写入会话运行时的状态。
 * @param {unknown} error 模型请求错误。
 * @param {number} attempt 从 1 开始的重试次数。
 * @param {number} now 当前时间戳。
 * @param {number} randomValue 0 到 1 的抖动采样值。
 * @returns {{attempt: number, maxRetries: number, message: string, nextAt: number, delayMs: number, failure: ReturnType<typeof createChatFailureSnapshot>}|null} 重试状态；不可重试或已达到上限时返回 null。
 */
export function createChatRetryState(error, attempt, now = Date.now(), randomValue = Math.random()) {
  if (!isRetryableChatError(error) || attempt < 1 || attempt > CHAT_RETRY_MAX_RETRIES) return null
  const providerDelay = readProviderRetryDelayMs(error, now)
  // Harness 的 normal 策略拒绝超过退避上限的 provider delay，避免会话长时间无界等待。
  if (providerDelay !== undefined && providerDelay > CHAT_RETRY_MAX_DELAY_MS) return null
  const delayMs = getChatRetryDelayMs(error, attempt, randomValue, now)
  return {
    attempt,
    maxRetries: CHAT_RETRY_MAX_RETRIES,
    message: formatChatRetryMessage(error),
    nextAt: now + delayMs,
    delayMs,
    failure: createChatFailureSnapshot(error),
  }
}
