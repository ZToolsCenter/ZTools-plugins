'use strict'

const crypto = require('node:crypto')
const { Readable } = require('node:stream')

const CHAT_TOOL_NAME_MAX_BYTES = 64
const OPENAI_REASONING_ITEM_PREFIX = 'ccswitch-openai-reasoning-v1:'

function flattenNamespaceToolName(namespace, name) {
  const full = `${namespace}__${name}`
  if (Buffer.byteLength(full) <= CHAT_TOOL_NAME_MAX_BYTES) return full
  const hash = crypto.createHash('sha256').update(full).digest('hex').slice(0, 16)
  const suffix = `__${hash}`
  const maxPrefix = CHAT_TOOL_NAME_MAX_BYTES - Buffer.byteLength(suffix)
  let prefix = ''
  for (const character of full) {
    if (Buffer.byteLength(prefix + character) > maxPrefix) break
    prefix += character
  }
  return `${prefix}${suffix}`
}

function namespaceChildren(tool) {
  return Array.isArray(tool?.tools) ? tool.tools : Array.isArray(tool?.children) ? tool.children : []
}

function namespaceRestoreMap(body) {
  const result = new Map()
  for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
    if (tool?.type !== 'namespace' || !String(tool.name || '').trim()) continue
    const namespace = String(tool.name).trim()
    for (const child of namespaceChildren(tool)) {
      if (child?.type !== 'function' || !String(child.name || '').trim()) continue
      const name = String(child.name).trim()
      const flat = flattenNamespaceToolName(namespace, name)
      if (!result.has(flat)) result.set(flat, { namespace, name })
    }
  }
  return result
}

function walk(value, visitor) {
  if (Array.isArray(value)) { for (const child of value) walk(child, visitor); return }
  if (!value || typeof value !== 'object') return
  visitor(value)
  for (const child of Object.values(value)) walk(child, visitor)
}

function flattenRequestNamespaces(input) {
  const body = structuredClone(input)
  const tools = Array.isArray(body?.tools) ? body.tools : []
  if (!tools.some((tool) => tool?.type === 'namespace')) return { body, changed: false, restoreMap: new Map() }
  const topLevel = new Set(tools.filter((tool) => ['function', 'custom'].includes(tool?.type)).map((tool) => String(tool.name || '').trim()).filter(Boolean))
  const owners = new Map()
  for (const [flat, owner] of namespaceRestoreMap(body)) {
    if (topLevel.has(flat)) throw new Error(`namespace tool ${owner.namespace}/${owner.name} 与顶层工具 ${flat} 冲突`)
    const previous = owners.get(flat)
    if (previous && (previous.namespace !== owner.namespace || previous.name !== owner.name)) throw new Error(`namespace tools 扁平化后名称冲突: ${flat}`)
    owners.set(flat, owner)
  }
  const flattened = []
  const seen = new Set()
  for (const tool of tools) {
    if (tool?.type !== 'namespace') { flattened.push(tool); continue }
    const namespace = String(tool.name || '').trim()
    if (!namespace) continue
    for (const child of namespaceChildren(tool)) {
      if (child?.type !== 'function' || !String(child.name || '').trim()) continue
      const flat = flattenNamespaceToolName(namespace, String(child.name).trim())
      if (seen.has(flat)) continue
      seen.add(flat); flattened.push({ ...child, name: flat })
    }
  }
  body.tools = flattened
  walk(body.input, (item) => {
    if (item.type !== 'function_call') return
    const namespace = String(item.namespace || '').trim(); const name = String(item.name || '').trim()
    if (!namespace || !name) return
    const flat = flattenNamespaceToolName(namespace, name); const owner = owners.get(flat)
    if (owner?.namespace === namespace && owner?.name === name) { item.name = flat; delete item.namespace }
  })
  if (body.tool_choice?.type === 'namespace') body.tool_choice = 'auto'
  else if (body.tool_choice && typeof body.tool_choice === 'object') {
    const namespace = String(body.tool_choice.namespace || '').trim(); const name = String(body.tool_choice.name || '').trim()
    const flat = flattenNamespaceToolName(namespace, name); const owner = owners.get(flat)
    if (owner?.namespace === namespace && owner?.name === name) { body.tool_choice.name = flat; delete body.tool_choice.namespace }
  }
  return { body, changed: true, restoreMap: owners }
}

function restoreResponseNamespaces(input, restoreMap) {
  const value = structuredClone(input)
  let changed = false
  walk(value, (item) => {
    if (item.type !== 'function_call') return
    const owner = restoreMap?.get?.(String(item.name || ''))
    if (!owner) return
    item.name = owner.name; item.namespace = owner.namespace; changed = true
  })
  return { value, changed }
}

async function *restoreNamespaceSseStream(body, restoreMap) {
  const iterable = body && typeof body.getReader === 'function' ? Readable.fromWeb(body) : body
  const decoder = new TextDecoder('utf-8'); let buffer = ''
  async function *emitBlock(block) {
    if (!block.trim()) return
    const lines = block.split(/\r?\n/); const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n')
    if (!data || data.trim() === '[DONE]') { yield Buffer.from(`${block}\n\n`); return }
    let parsed
    try { parsed = JSON.parse(data) } catch { yield Buffer.from(`${block}\n\n`); return }
    const restored = restoreResponseNamespaces(parsed, restoreMap)
    if (!restored.changed) { yield Buffer.from(`${block}\n\n`); return }
    const eventLine = lines.find((line) => line.startsWith('event:'))
    yield Buffer.from(`${eventLine ? `${eventLine}\n` : ''}data: ${JSON.stringify(restored.value)}\n\n`)
  }
  for await (const chunk of iterable) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    while (true) {
      const match = /\r?\n\r?\n/.exec(buffer)
      if (!match) break
      const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length)
      yield *emitBlock(block)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) yield *emitBlock(buffer)
}

function reasoningSummaryText(item) {
  return (Array.isArray(item?.summary) ? item.summary : []).filter((part) => ['summary_text', 'reasoning_text'].includes(part?.type) && typeof part.text === 'string').map((part) => part.text).join('')
}
function encodeOpenAiReasoningItem(item) {
  if (item?.type !== 'reasoning') return null
  return `${OPENAI_REASONING_ITEM_PREFIX}${Buffer.from(JSON.stringify(item)).toString('base64url')}`
}
function decodeOpenAiReasoningItem(encoded) {
  if (typeof encoded !== 'string' || !encoded.startsWith(OPENAI_REASONING_ITEM_PREFIX)) return null
  try { const item = JSON.parse(Buffer.from(encoded.slice(OPENAI_REASONING_ITEM_PREFIX.length), 'base64url')); return item?.type === 'reasoning' ? item : null } catch { return null }
}
function anthropicBlockFromOpenAiReasoningItem(item) {
  if (item?.type !== 'reasoning') return null
  const text = reasoningSummaryText(item); const encrypted = typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0
  if (encrypted) {
    const envelope = encodeOpenAiReasoningItem(item)
    return text ? { type: 'thinking', thinking: text, signature: envelope } : { type: 'redacted_thinking', data: envelope }
  }
  return text ? { type: 'thinking', thinking: text } : null
}
function openAiReasoningItemFromAnthropicBlock(block) {
  if (block?.type === 'thinking') return decodeOpenAiReasoningItem(block.signature)
  if (block?.type === 'redacted_thinking') return decodeOpenAiReasoningItem(block.data)
  return null
}

function shouldSendPromptCacheKey(provider) {
  const setting = String(provider?.promptCacheRouting || 'auto')
  if (setting === 'enabled') return true
  if (setting === 'disabled') return false
  try {
    const url = new URL(provider?.baseUrl)
    if (url.hostname === 'api.openai.com') return true
    return url.hostname === 'api.kimi.com' && (url.pathname.replace(/\/+$/, '') === '/coding' || url.pathname.startsWith('/coding/'))
  } catch { return false }
}
function injectPromptCacheKey(provider, body, explicitKey, clientSessionId) {
  if (!shouldSendPromptCacheKey(provider)) return false
  const key = String(explicitKey || '').trim() || String(clientSessionId || '').trim()
  if (!key) return false
  body.prompt_cache_key = key
  return true
}

function extractCodexClientSessionId(headers = {}, body = {}) {
  for (const key of ['session_id', 'x-session-id']) {
    const value = String(headers[key] || '').trim()
    if (value.length > 20) return value
  }
  const metadataValue = String(body?.metadata?.session_id || '').trim()
  return metadataValue.length > 10 ? metadataValue : ''
}

module.exports = { CHAT_TOOL_NAME_MAX_BYTES, OPENAI_REASONING_ITEM_PREFIX, flattenNamespaceToolName, namespaceRestoreMap, flattenRequestNamespaces, restoreResponseNamespaces, restoreNamespaceSseStream, reasoningSummaryText, encodeOpenAiReasoningItem, decodeOpenAiReasoningItem, anthropicBlockFromOpenAiReasoningItem, openAiReasoningItemFromAnthropicBlock, shouldSendPromptCacheKey, injectPromptCacheKey, extractCodexClientSessionId }
