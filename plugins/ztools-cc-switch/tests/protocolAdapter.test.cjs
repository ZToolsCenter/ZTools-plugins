'use strict'
const test = require('node:test'); const assert = require('node:assert/strict')
const { prepareRequest, transformResponse, parseSsePayload } = require('../preload/protocolAdapter')

test('converts Anthropic Messages requests to OpenAI Chat with tools and model mapping', () => {
  const prepared = prepareRequest({ client: 'claude', incomingPath: '/v1/messages', provider: { apiType: 'openai_compat', model: 'gpt-5', modelMap: { 'claude-sonnet': 'gpt-5.2' } }, body: { model: 'claude-sonnet', system: 'Be exact', max_tokens: 2048, stream: true, tools: [{ name: 'search', description: 'Search', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] } })
  assert.equal(prepared.path, '/v1/chat/completions'); assert.equal(prepared.body.model, 'gpt-5.2'); assert.equal(prepared.body.messages[0].role, 'system'); assert.equal(prepared.body.tools[0].function.name, 'search'); assert.equal(prepared.body.stream_options.include_usage, true)
})
test('converts Anthropic requests to Responses and Gemini formats', () => {
  const source = { model: 'claude', max_tokens: 1000, system: 'system', messages: [{ role: 'user', content: 'hello' }] }
  const responses = prepareRequest({ client: 'claude', incomingPath: '/v1/messages', provider: { apiType: 'responses', model: 'gpt-5' }, body: source })
  assert.equal(responses.body.instructions, 'system'); assert.equal(responses.body.input[0].content[0].type, 'input_text')
  const gemini = prepareRequest({ client: 'claude', incomingPath: '/v1/messages', provider: { apiType: 'gemini', model: 'gemini-2.5-pro' }, body: source })
  assert.match(gemini.path, /generateContent/); assert.equal(gemini.body.contents[0].parts[0].text, 'hello')
})
test('converts Chat and Responses results back to Anthropic Messages', () => {
  const chat = transformResponse({ sourceProtocol: 'anthropic', targetProtocol: 'openai_compat', streaming: false, bodyText: JSON.stringify({ id: 'c1', model: 'gpt', choices: [{ message: { content: 'answer', tool_calls: [] }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }) })
  const chatBody = JSON.parse(chat.body); assert.equal(chatBody.type, 'message'); assert.equal(chatBody.content[0].text, 'answer'); assert.deepEqual(chatBody.usage, { input_tokens: 5, output_tokens: 2 })
  const responses = transformResponse({ sourceProtocol: 'anthropic', targetProtocol: 'responses', streaming: false, bodyText: JSON.stringify({ id: 'r1', model: 'gpt', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }], usage: { input_tokens: 3, output_tokens: 4 } }) })
  assert.equal(JSON.parse(responses.body).content[0].text, 'done')
})
test('converts OpenAI Chat SSE to valid Anthropic SSE envelope', () => {
  const upstream = 'data: {"id":"c1","model":"gpt","choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\ndata: {"id":"c1","model":"gpt","choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2}}\n\ndata: [DONE]\n\n'
  const ir = parseSsePayload(upstream, 'openai_compat'); assert.equal(ir.text, '你好')
  const converted = transformResponse({ sourceProtocol: 'anthropic', targetProtocol: 'openai_compat', streaming: true, bodyText: upstream })
  assert.match(converted.body, /event: message_start/); assert.match(converted.body, /text_delta/); assert.match(converted.body, /你好/); assert.match(converted.body, /event: message_stop/)
})
