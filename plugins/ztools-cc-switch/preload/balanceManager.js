'use strict'

/** 对照 cc-switch 原生 balance service 的确定性失败/瞬时失败语义。 */
const MAX_BYTES = 1024 * 1024

function detectBalanceProvider(baseUrl) {
  const url = String(baseUrl || '').toLowerCase()
  if (url.includes('api.deepseek.com')) return 'deepseek'
  if (url.includes('api.stepfun.ai') || url.includes('api.stepfun.com')) return 'stepfun'
  if (url.includes('api.siliconflow.cn')) return 'siliconflow_cn'
  if (url.includes('api.siliconflow.com')) return 'siliconflow_en'
  if (url.includes('openrouter.ai')) return 'openrouter'
  if (url.includes('api.novita.ai')) return 'novita'
  return ''
}

function numberField(object, key) {
  const value = object?.[key]
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function failure(error, data = null) { return { success: false, data, error, queriedAt: Date.now() } }
function authFailure(status) {
  const error = `Authentication failed (HTTP ${status})`
  return failure(error, [{ planName: null, remaining: null, total: null, used: null, unit: null, isValid: false, invalidMessage: error }])
}

function parseBalance(provider, body) {
  if (provider === 'deepseek') {
    const valid = body.is_available !== false
    const rows = (Array.isArray(body.balance_infos) ? body.balance_infos : []).map((item) => ({ planName: item.currency || 'CNY', remaining: numberField(item, 'total_balance'), total: null, used: null, unit: item.currency || 'CNY', isValid: valid, invalidMessage: valid ? null : 'Insufficient balance' }))
    return { success: true, data: rows.length ? rows : null, error: null, queriedAt: Date.now() }
  }
  if (provider === 'stepfun') return { success: true, data: [{ planName: 'StepFun', remaining: numberField(body, 'balance') ?? 0, total: null, used: null, unit: 'CNY', isValid: true, invalidMessage: null }], error: null, queriedAt: Date.now() }
  if (provider === 'siliconflow_cn' || provider === 'siliconflow_en') {
    if (!body.data) return failure("Missing 'data' field in response")
    const cn = provider === 'siliconflow_cn'
    return { success: true, data: [{ planName: cn ? 'SiliconFlow' : 'SiliconFlow (EN)', remaining: numberField(body.data, 'totalBalance') ?? 0, total: null, used: null, unit: cn ? 'CNY' : 'USD', isValid: true, invalidMessage: null }], error: null, queriedAt: Date.now() }
  }
  if (provider === 'openrouter') {
    const data = body.data || body; const total = numberField(data, 'total_credits') ?? 0; const used = numberField(data, 'total_usage') ?? 0; const remaining = total - used
    return { success: true, data: [{ planName: 'OpenRouter', remaining, total, used, unit: 'USD', isValid: remaining > 0, invalidMessage: remaining > 0 ? null : 'No credits remaining' }], error: null, queriedAt: Date.now() }
  }
  const remaining = (numberField(body, 'availableBalance') ?? 0) / 10000
  return { success: true, data: [{ planName: 'Novita AI', remaining, total: null, used: null, unit: 'USD', isValid: remaining > 0, invalidMessage: remaining > 0 ? null : 'No balance remaining' }], error: null, queriedAt: Date.now() }
}

function createBalanceManager(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const resolveAuth = options.resolveAuth || (async (provider) => ({ token: provider.apiKey }))

  async function readResponse(response) {
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('余额 API 响应超过 1 MB 安全限制')
    try { return text ? JSON.parse(text) : {} } catch (error) { return { parseError: `Failed to parse response: ${error.message}`, text: text.slice(0, 500) } }
  }

  async function queryProvider(provider) {
    const type = detectBalanceProvider(provider?.baseUrl)
    if (!type) return failure('Unknown balance provider')
    const auth = await resolveAuth(provider)
    const token = String(auth?.token || provider.apiKey || '').trim()
    if (!token) return failure('API key is empty')
    const url = ({
      deepseek: 'https://api.deepseek.com/user/balance',
      stepfun: 'https://api.stepfun.com/v1/accounts',
      siliconflow_cn: 'https://api.siliconflow.cn/v1/user/info',
      siliconflow_en: 'https://api.siliconflow.com/v1/user/info',
      openrouter: 'https://openrouter.ai/api/v1/credits',
      novita: 'https://api.novita.ai/v3/user/balance'
    })[type]
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000)
    let response
    try { response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: controller.signal }) }
    catch (error) { throw new Error(error.name === 'AbortError' ? 'Network error: request timed out' : `Network error: ${error.message}`) }
    finally { clearTimeout(timer) }
    if ([401, 403].includes(response.status)) return authFailure(response.status)
    const body = await readResponse(response)
    if (!response.ok) return failure(`API error (HTTP ${response.status}): ${body.text || JSON.stringify(body).slice(0, 500)}`)
    if (body.parseError) return failure(body.parseError)
    return parseBalance(type, body)
  }

  async function listCandidates(providers) {
    return (providers || []).filter((provider) => provider.id !== 'claude-desktop-official' && detectBalanceProvider(provider.baseUrl)).map((provider) => ({ id: provider.id, name: provider.name, providerType: detectBalanceProvider(provider.baseUrl), hasCredential: Boolean(provider.apiKey || provider.authProvider) }))
  }

  return { queryProvider, listCandidates }
}

module.exports = { detectBalanceProvider, numberField, parseBalance, createBalanceManager }
