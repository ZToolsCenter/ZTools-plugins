'use strict'
const test = require('node:test'); const assert = require('node:assert/strict'); const { Readable } = require('node:stream')
const { parseSseEvents, transformSseStream } = require('../preload/sseTransformer')

async function collect(iterable) { const chunks = []; for await (const chunk of iterable) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString('utf8') }

test('SSE parser preserves Unicode split across TCP chunks and multiline data', async () => {
  const bytes = Buffer.from('event: message\ndata: {"text":"你好"}\ndata: second\n\n')
  const marker = bytes.indexOf(Buffer.from('你')) + 1
  const events = []; for await (const event of parseSseEvents(Readable.from([bytes.subarray(0, marker), bytes.subarray(marker)]))) events.push(event)
  assert.equal(events.length, 1); assert.equal(events[0].event, 'message'); assert.equal(events[0].data, '{"text":"你好"}\nsecond')
})

test('incrementally converts OpenAI Chat text and usage to Anthropic SSE', async () => {
  const input = [
    'data: {"id":"chat1","model":"gpt","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
    'data: {"id":"chat1","model":"gpt","choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\n',
    'data: {"id":"chat1","model":"gpt","choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n'
  ]
  const output = await collect(transformSseStream(Readable.from(input), 'anthropic', 'openai_compat'))
  assert.match(output, /event: message_start/); assert.match(output, /"text":"你"/); assert.match(output, /"text":"好"/); assert.match(output, /"output_tokens":2/); assert.equal((output.match(/event: message_stop/g) || []).length, 1)
})

test('delays Chat tool block start until id and name are available and streams JSON arguments', async () => {
  const input = [
    'data: {"id":"c","model":"gpt","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]},"finish_reason":null}]}\n\n',
    'data: {"id":"c","model":"gpt","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search","arguments":"\\"x\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n'
  ]
  const output = await collect(transformSseStream(Readable.from(input), 'anthropic', 'openai_compat'))
  assert.equal((output.match(/content_block_start/g) || []).length, 2)
  assert.match(output, /"id":"call_1"/); assert.match(output, /"name":"search"/); assert.match(output, /partial_json/); assert.match(output, /tool_use/)
})

test('converts Anthropic SSE incrementally to OpenAI Chat chunks', async () => {
  const input = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","model":"claude","usage":{"input_tokens":2,"output_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ]
  const output = await collect(transformSseStream(Readable.from(input), 'openai_compat', 'anthropic'))
  assert.match(output, /chat.completion.chunk/); assert.match(output, /"content":"hello"/); assert.match(output, /"finish_reason":"stop"/); assert.match(output, /data: \[DONE\]/)
})

test('converts Responses API delta events to Anthropic SSE', async () => {
  const input = [
    'event: response.created\ndata: {"type":"response.created","response":{"id":"r1","model":"gpt","usage":{"input_tokens":4,"output_tokens":0}}}\n\n',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"answer"}\n\n',
    'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r1","model":"gpt","status":"completed","usage":{"input_tokens":4,"output_tokens":2}}}\n\n'
  ]
  const output = await collect(transformSseStream(Readable.from(input), 'anthropic', 'responses'))
  assert.match(output, /"text":"answer"/); assert.match(output, /"input_tokens":4/); assert.match(output, /"output_tokens":2/)
})

test('buffers fragmented tool arguments only until Gemini can emit a complete functionCall', async () => {
  const input = [
    'data: {"id":"c","model":"gpt","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_2","function":{"name":"search","arguments":"{\\"q\\":"}}]},"finish_reason":null}]}\n\n',
    'data: {"id":"c","model":"gpt","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"term\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n',
    'data: [DONE]\n\n'
  ]
  const output = await collect(transformSseStream(Readable.from(input), 'gemini', 'openai_compat'))
  assert.match(output, /functionCall/); assert.match(output, /"q":"term"/); assert.match(output, /finishReason/)
})

test('emits complete Responses done-event sequence after Anthropic stream', async () => {
  const input = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m2","model":"claude","usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ]
  const output = await collect(transformSseStream(Readable.from(input), 'responses', 'anthropic'))
  assert.match(output, /response.output_text.delta/); assert.match(output, /response.output_text.done/); assert.match(output, /response.content_part.done/); assert.match(output, /response.output_item.done/); assert.match(output, /response.completed/)
})
