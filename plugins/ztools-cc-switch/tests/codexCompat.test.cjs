'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const {
  flattenNamespaceToolName, flattenRequestNamespaces, namespaceRestoreMap, restoreResponseNamespaces, restoreNamespaceSseStream,
  anthropicBlockFromOpenAiReasoningItem, openAiReasoningItemFromAnthropicBlock,
  shouldSendPromptCacheKey, injectPromptCacheKey, extractCodexClientSessionId
} = require('../preload/codexCompat')
const { requestToIr, irToRequest, responseToIr, irToResponse } = require('../preload/protocolAdapter')
const { transformSseStream } = require('../preload/sseTransformer')

function namespaceRequest() {
  return { model: 'grok-4.5', tools: [{ type: 'function', name: 'plain', parameters: {} }, { type: 'namespace', name: 'mcp__files__', tools: [{ type: 'function', name: 'read', description: 'Read', parameters: {} }, { type: 'function', name: 'write', parameters: {} }] }], input: [{ type: 'function_call', name: 'read', namespace: 'mcp__files__', call_id: 'c1', arguments: '{}' }], tool_choice: { type: 'namespace', name: 'mcp__files__' } }
}

test('flattens Codex namespace tools and restores JSON responses', () => {
  const request = namespaceRequest(); const map = namespaceRestoreMap(request)
  const result = flattenRequestNamespaces(request)
  assert.equal(result.changed, true)
  assert.deepEqual(result.body.tools.map((tool) => tool.name), ['plain', 'mcp__files____read', 'mcp__files____write'])
  assert.equal(result.body.input[0].name, 'mcp__files____read'); assert.equal(result.body.input[0].namespace, undefined)
  assert.equal(result.body.tool_choice, 'auto')
  const restored = restoreResponseNamespaces({ output: [{ type: 'function_call', name: 'mcp__files____read', call_id: 'c1' }] }, map)
  assert.deepEqual(restored.value.output[0], { type: 'function_call', name: 'read', namespace: 'mcp__files__', call_id: 'c1' })
  assert.equal(request.tools[1].type, 'namespace')
})

test('uses the upstream 64-byte deterministic namespace name and rejects collisions', () => {
  const value = flattenNamespaceToolName('命名空间'.repeat(10), '读取文件'.repeat(10))
  assert.ok(Buffer.byteLength(value) <= 64); assert.match(value, /__[0-9a-f]{16}$/)
  assert.throws(() => flattenRequestNamespaces({ tools: [{ type: 'function', name: 'mcp__x____read' }, { type: 'namespace', name: 'mcp__x__', tools: [{ type: 'function', name: 'read' }] }] }), /冲突/)
})

test('restores fragmented namespace SSE without changing unrelated events', async () => {
  const map = namespaceRestoreMap(namespaceRequest())
  const source = 'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"function_call","name":"mcp__files____read"}}\n\nevent: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"你好"}\n\n'
  const chunks = [Buffer.from(source).subarray(0, 47), Buffer.from(source).subarray(47, 113), Buffer.from(source).subarray(113)]
  const output = []; for await (const chunk of restoreNamespaceSseStream(Readable.from(chunks), map)) output.push(chunk)
  const text = Buffer.concat(output).toString('utf8')
  assert.match(text, /"name":"read","namespace":"mcp__files__"/); assert.match(text, /"delta":"你好"/)
})

test('round-trips opaque Responses reasoning through Anthropic thinking envelopes', () => {
  const item = { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Need a tool.' }], encrypted_content: 'opaque' }
  const block = anthropicBlockFromOpenAiReasoningItem(item)
  assert.equal(block.type, 'thinking'); assert.equal(block.thinking, 'Need a tool.'); assert.deepEqual(openAiReasoningItemFromAnthropicBlock(block), item)
  const redacted = anthropicBlockFromOpenAiReasoningItem({ ...item, summary: [] }); assert.equal(redacted.type, 'redacted_thinking')

  const anthropic = irToRequest('anthropic', requestToIr('responses', { input: [item, { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{}' }, { role: 'user', content: [{ type: 'input_text', text: 'continue' }] }], tools: [] }), 'claude')
  assert.deepEqual(openAiReasoningItemFromAnthropicBlock(anthropic.messages[0].content[0]), item)
  const responses = irToResponse('responses', responseToIr('anthropic', { id: 'm1', model: 'claude', content: [block, { type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: {} }))
  assert.deepEqual(responses.output[0], item); assert.equal(responses.output[1].content[0].text, 'done')

  const orphanReplay = irToRequest('responses', requestToIr('anthropic', { messages: [{ role: 'assistant', content: [anthropicBlockFromOpenAiReasoningItem(item)] }, { role: 'user', content: 'continue' }], tools: [] }), 'gpt-5.6')
  assert.equal(orphanReplay.input.some((entry) => entry.type === 'reasoning'), false)
})

test('streams opaque reasoning through Anthropic signature deltas and restores it', async () => {
  const item = { id: 'rs_stream', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Need context.' }], encrypted_content: 'ciphertext' }
  const responsesSse = [
    `event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: 'resp_1', model: 'gpt-5.6' } })}\n\n`,
    `event: response.reasoning_summary_text.delta\ndata: ${JSON.stringify({ type: 'response.reasoning_summary_text.delta', delta: 'Need context.' })}\n\n`,
    `event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item })}\n\n`,
    `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: {} } })}\n\n`
  ].join('')
  const anthropicChunks = []; for await (const chunk of transformSseStream(Readable.from([responsesSse]), 'anthropic', 'responses')) anthropicChunks.push(chunk)
  const anthropicSse = Buffer.concat(anthropicChunks).toString('utf8')
  assert.match(anthropicSse, /thinking_delta/); assert.match(anthropicSse, /signature_delta/); assert.match(anthropicSse, /ccswitch-openai-reasoning-v1:/)

  const restoredChunks = []; for await (const chunk of transformSseStream(Readable.from([anthropicSse]), 'responses', 'anthropic')) restoredChunks.push(chunk)
  const restoredSse = Buffer.concat(restoredChunks).toString('utf8')
  assert.match(restoredSse, /response\.output_item\.done/); assert.match(restoredSse, /"encrypted_content":"ciphertext"/); assert.match(restoredSse, /"text":"Need context\."/)
})

test('routes prompt cache keys only to supported providers and real sessions', () => {
  assert.equal(shouldSendPromptCacheKey({ baseUrl: 'https://api.openai.com/v1' }), true)
  assert.equal(shouldSendPromptCacheKey({ baseUrl: 'https://api.kimi.com/coding/v1' }), true)
  assert.equal(shouldSendPromptCacheKey({ baseUrl: 'https://strict.example/v1' }), false)
  assert.equal(shouldSendPromptCacheKey({ baseUrl: 'https://strict.example/v1', promptCacheRouting: 'enabled' }), true)
  const body = {}; assert.equal(injectPromptCacheKey({ baseUrl: 'https://api.openai.com/v1' }, body, 'explicit', 'session'), true); assert.equal(body.prompt_cache_key, 'explicit')
  assert.equal(extractCodexClientSessionId({ 'x-session-id': '12345678-1234-1234-1234-123456789012' }, { previous_response_id: 'never-use-me' }), '12345678-1234-1234-1234-123456789012')
  assert.equal(extractCodexClientSessionId({}, { previous_response_id: 'never-use-me' }), '')
})
