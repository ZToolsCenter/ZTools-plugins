// Settings use the host database; credentials use a separate device-local store.
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
module.exports = function createResearchService(getHost, options = {}) {
  let settings = { mode: 'host', protocol: 'openai', baseUrl: '', model: '', hostModel: '', provider: 'custom' }
  let key = '', active = null, initialized = false, persisted = false, keys = {}
  const credentials = options.credentials || require('../../shared/local-credentials')()
  let health = null, healthPending = null
  const STORE = 'research-settings-v1'
  function host() { return getHost() || {} }
  function init() {
    if (initialized) return
    try {
      const saved = host().dbStorage && host().dbStorage.getItem(STORE)
      if (saved && typeof saved === 'object') { Object.keys(settings).forEach(k => { if (typeof saved[k] === 'string') settings[k] = saved[k] }); persisted = true }
    } catch (_) { throw new Error('无法读取模型配置，请检查本机存储后重试。') }
    const savedKeys = credentials.read('research')
    for (const [id, value] of Object.entries(savedKeys)) if (/^[a-f0-9]{64}$/.test(id) && validKey(value)) keys[id] = value
    key = keys[scope(settings)] || ''
    initialized = true
  }
  function validKey(value) { return typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\r\n\0]/.test(value) }
  function scope(config) {
    let base = config.baseUrl
    try {
      const url = new URL(base)
      url.pathname = url.pathname.replace(/\/+$/, '')
      if (config.protocol === 'openai') url.pathname = url.pathname.replace(/\/chat\/completions$/, '')
      if (config.protocol === 'anthropic') url.pathname = url.pathname.replace(/\/messages$/, '')
      base = url.href.replace(/\/+$/, '')
    } catch (_) {}
    return crypto.createHash('sha256').update(JSON.stringify([config.provider, config.protocol, base])).digest('hex')
  }
  function getSettings() { init(); return Object.assign({}, settings, { hasKey: !!key, persisted, credentialStorage: credentials.mode(), hostAvailable: typeof host().ai === 'function' }) }
  function endpoint(config) {
    let url
    try { url = new URL(config.baseUrl) } catch (_) { throw new Error('请输入完整的 API 地址。') }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('远程 API 必须使用 HTTPS；本机服务可使用 HTTP。')
    if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含密码、查询参数或 API key。')
    if (/YOUR-WORKSPACE-ID|%7B|%7D/i.test(url.href)) throw new Error('请将 API 地址中的业务空间占位符替换为真实 ID。')
    const p = url.pathname.replace(/\/+$/, '')
    if (config.protocol === 'openai') url.pathname = /\/chat\/completions$/.test(p) ? p : p + '/chat/completions'
    else if (config.protocol === 'anthropic') url.pathname = /\/messages$/.test(p) ? p : p + '/messages'
    else if (config.protocol === 'gemini') url.pathname = p + '/models/' + encodeURIComponent(config.model) + ':generateContent'
    else throw new Error('不支持的 API 协议。')
    return url
  }
  function saveSettings(input) {
    init()
    if (active) throw new Error('请先停止当前分析，再修改模型配置。')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('模型配置格式无效。')
    const next = Object.assign({}, settings)
    Object.keys(settings).forEach(k => { if (typeof input[k] === 'string') next[k] = input[k].trim() })
    if (!['host', 'direct'].includes(next.mode)) throw new Error('请选择模型接入方式。')
    if (next.mode === 'direct') { if (!next.model || next.model.length > 200) throw new Error('请填写平台实际提供的模型 ID。'); endpoint(next) }
    const id = scope(next), nextKeys = Object.assign({}, keys)
    if (input.clearKey) delete nextKeys[id]
    if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 2048 || /[\r\n\0]/.test(input.apiKey))) throw new Error('API key 格式无效。')
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      // A key may only be attached to a validated provider/protocol/endpoint combination.
      endpoint(next)
      nextKeys[id] = input.apiKey.trim()
    }
    const changed = JSON.stringify(nextKeys) !== JSON.stringify(keys)
    if (changed) credentials.write('research', nextKeys)
    let saved = false
    try {
      if (typeof host().dbStorage?.setItem === 'function') {
        const result = host().dbStorage.setItem(STORE, next)
        if (result === false || result?.error) throw Error('write failed')
        saved = true
      }
    } catch (_) {
      if (changed) { try { credentials.write('research', keys) } catch (_) { throw new Error('模型配置保存失败，凭据回退也失败；请重新打开设置核对已保存状态。') } }
      throw new Error('模型配置保存失败，请检查本机存储后重试。')
    }
    keys = nextKeys; key = keys[id] || ''; settings = next; persisted = saved; health = null
    return getSettings()
  }
  async function models() {
    try {
      const list = typeof host().allAiModels === 'function' ? await host().allAiModels() : []
      return (Array.isArray(list) ? list : []).map(m => ({ value: String(m.value || m.id || ''), label: String(m.label || m.modelId || m.value || m.id || ''), provider: String(m.providerLabel || '') })).filter(m => m.value)
    } catch (_) { return [] }
  }
  function safeError(err) { let message = String(err && err.message || err || '请求失败'); if (key) message = message.split(key).join('[已隐藏]'); return new Error(message.slice(0, 400)) }
  function cancel() { if (active) active.cancel() }
  async function call(messages, requestOptions = {}) {
    const timeout = requestOptions.probe ? (options.probeTimeoutMs || 20000) : 180000
    init()
    if (active) throw new Error('已有模型请求正在进行。')
    if (!Array.isArray(messages) || !messages.length) throw new Error('请求内容为空。')
    if (settings.mode === 'host') {
      const h = host()
      if (typeof h.ai !== 'function') throw new Error('当前环境没有 ZTools AI 接口，请升级主程序或选择直连 API。')
      let pending, timer, cancelled = false
      const control = { cancel() { cancelled = true; if (pending && typeof pending.abort === 'function') pending.abort(); if (control.reject) control.reject(new Error('已停止分析。')) } }
      active = control
      try {
        const option = { messages }; if (settings.hostModel) option.model = settings.hostModel
        pending = h.ai(option)
        const response = await Promise.race([Promise.resolve(pending), new Promise((_, reject) => { control.reject = reject; timer = setTimeout(() => { if (pending && typeof pending.abort === 'function') pending.abort(); reject(new Error('模型请求超时，请重试。')) }, timeout) })])
        if (cancelled) throw new Error('已停止分析。')
        const content = response && (response.content || response.message && response.message.content)
        if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回文本内容。')
        return content
      } catch (err) { throw safeError(err) }
      finally { clearTimeout(timer); active = null }
    }
    const config = Object.assign({}, settings), url = endpoint(config)
    if (!key && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('请填写并保存此服务地址对应的 API key。')
    let payload, headers = { 'Content-Type': 'application/json' }
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
    if (config.protocol === 'openai') {
      payload = { model: config.model, messages, stream: false }
      // Reasoning models differ on temperature/token parameters. Use provider defaults.
      if (key) headers.Authorization = 'Bearer ' + key
    } else if (config.protocol === 'anthropic') {
      payload = { model: config.model, system, messages: messages.filter(m => m.role !== 'system'), max_tokens: requestOptions.probe ? 64 : 8192 }; headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'
    } else {
      payload = { systemInstruction: { parts: [{ text: system }] }, contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { responseMimeType: 'application/json', ...(requestOptions.probe ? { maxOutputTokens: 64 } : {}) } }; headers['x-goog-api-key'] = key
    }
    const body = JSON.stringify(payload); headers['Content-Length'] = Buffer.byteLength(body)
    return new Promise((resolve, reject) => {
      let settled = false, timer
      function finish(err, content) { if (settled) return; settled = true; clearTimeout(timer); active = null; if (err) reject(safeError(err)); else resolve(content) }
      const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST', headers }, res => {
        const chunks = []; let size = 0
        res.on('data', chunk => { size += chunk.length; if (size > 3 * 1024 * 1024) req.destroy(new Error('模型响应过大。')); else chunks.push(chunk) })
        res.on('error', err => finish(err))
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) return finish(new Error('API 返回 HTTP ' + res.statusCode + '。请检查地址、模型、key、额度和权限。'))
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); let content
            if (config.protocol === 'openai') content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
            else if (config.protocol === 'anthropic') content = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n')
            else content = ((data.candidates || [])[0]?.content?.parts || []).map(x => x.text || '').join('\n')
            if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回文本，请确认该模型支持对话请求。')
            finish(null, content)
          } catch (err) { finish(new Error(err instanceof SyntaxError ? 'API 返回了无效 JSON，请检查 API 地址。' : err.message)) }
        })
      })
      active = { cancel() { req.destroy(new Error('已停止分析。')) } }
      timer = setTimeout(() => req.destroy(new Error('模型请求超时，请重试。')), timeout)
      req.on('error', err => finish(err)); req.end(body)
    })
  }
  async function checkAvailability({ force = false } = {}) {
    if (healthPending) return healthPending
    if (active) return { ok: false, state: 'busy', message: '模型正在处理任务，请完成或停止后重试检测。' }
    try {
      init()
      if (settings.mode === 'host' && typeof host().ai !== 'function') return { ok: false, state: 'unconfigured', message: '未连接 ZTools AI。请配置模型，或使用自己的 AI Agent。' }
      if (settings.mode === 'direct') {
        if (!settings.model) throw Error('请先填写并保存模型 ID。')
        const url = endpoint(settings)
        if (!key && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('当前连接尚未保存 API key，请先配置模型。')
      }
    } catch (err) { return { ok: false, state: 'unconfigured', message: safeError(err).message } }
    if (!force && health && Date.now() - health.checkedAt < (health.ok ? 300000 : 60000)) return { ...health }
    healthPending = (async () => {
      try {
        await call([{ role: 'user', content: 'Connection test. Reply only with {"ok":true}.' }], { probe: true })
        health = { ok: true, state: 'ready', message: '连接正常，可以使用当前模型。', checkedAt: Date.now() }
      } catch (err) { health = { ok: false, state: 'unavailable', message: '连接检测未通过：' + safeError(err).message, checkedAt: Date.now() } }
      return { ...health }
    })()
    try { return await healthPending } finally { healthPending = null }
  }
  return { getSettings, saveSettings, models, call, cancel, checkAvailability,
    // No caller-supplied paths: only public runtime assets can enter a report.
    reportAssets() { const read = name => fs.readFileSync(path.join(__dirname, '../..', name), 'utf8'); return { css: read('index.css') + '\n' + read('features/research/research.css'), core: read('features/research/research-core.js'), metrics: read('features/research/research-metrics.js') } },
    openHostSettings() { const h = host(); if (typeof h.redirectAiModelsSetting === 'function') h.redirectAiModelsSetting(); else throw new Error('请在 ZTools 主程序的设置中打开 AI 模型管理。') } }
}
