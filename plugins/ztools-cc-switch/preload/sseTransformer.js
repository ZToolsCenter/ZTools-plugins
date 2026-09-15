'use strict'

const { Readable } = require('node:stream')
const { encodeOpenAiReasoningItem, anthropicBlockFromOpenAiReasoningItem, openAiReasoningItemFromAnthropicBlock } = require('./codexCompat')

async function *parseSseEvents(body) {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let current = { event: '', data: [], id: '' }
  function consumeLine(line) {
    if (line === '') {
      if (!current.data.length && !current.event) return null
      const result = { event: current.event || 'message', data: current.data.join('\n'), id: current.id }
      current = { event: '', data: [], id: '' }
      return result
    }
    if (line.startsWith(':')) return null
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') current.event = value
    else if (field === 'data') current.data.push(value)
    else if (field === 'id') current.id = value
    return null
  }
  const iterable = body && typeof body.getReader === 'function' ? Readable.fromWeb(body) : body
  for await (const chunk of iterable) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) { const event = consumeLine(line); if (event) yield event }
  }
  buffer += decoder.decode()
  for (const line of buffer.split(/\r?\n/)) { const event = consumeLine(line); if (event) yield event }
  const finalEvent = consumeLine('')
  if (finalEvent) yield finalEvent
}

function usageFrom(value = {}) {
  return {
    inputTokens: Number(value.input_tokens ?? value.prompt_tokens ?? value.promptTokenCount) || 0,
    outputTokens: Number(value.output_tokens ?? value.completion_tokens ?? value.candidatesTokenCount) || 0,
    cacheReadTokens: Number(value.cache_read_input_tokens ?? value.prompt_tokens_details?.cached_tokens ?? value.cached_tokens) || 0,
    cacheCreationTokens: Number(value.cache_creation_input_tokens) || 0
  }
}

function decodeJson(data) { try { return JSON.parse(data) } catch { return null } }
function startEvent(state, id, model, usage) {
  if (state.started) return []
  state.started = true
  state.id = id || state.id || `stream_${Date.now()}`
  state.model = model || state.model || ''
  return [{ type: 'start', id: state.id, model: state.model, usage: usageFrom(usage) }]
}
function finishEvent(state, reason, usage) {
  if (state.finished) return []
  state.finished = true
  return [{ type: 'finish', reason: reason || 'stop', usage: usageFrom(usage) }]
}

function decodeChat(event, state) {
  if (event.data === '[DONE]') return finishEvent(state, state.finishReason, state.usage)
  const value = decodeJson(event.data)
  if (!value) return []
  if (value.error) return [{ type: 'error', error: value.error }]
  const output = startEvent(state, value.id, value.model, value.usage)
  const choice = value.choices?.[0] || {}
  const delta = choice.delta || {}
  if (typeof delta.content === 'string' && delta.content) output.push({ type: 'text', text: delta.content })
  const reasoning = delta.reasoning_content ?? delta.reasoning
  if (typeof reasoning === 'string' && reasoning) output.push({ type: 'reasoning', text: reasoning })
  for (const call of delta.tool_calls || []) {
    const index = Number(call.index) || 0
    const known = state.tools.get(index) || { id: '', name: '', argumentsPending: '', started: false }
    known.id ||= call.id || ''
    known.name ||= call.function?.name || ''
    known.argumentsPending += call.function?.arguments || ''
    state.tools.set(index, known)
    if (!known.started && known.id && known.name) {
      known.started = true
      output.push({ type: 'tool', index, id: known.id, name: known.name, argumentsDelta: known.argumentsPending, start: true })
      known.argumentsPending = ''
    } else if (known.started && known.argumentsPending) {
      output.push({ type: 'tool', index, id: known.id, name: known.name, argumentsDelta: known.argumentsPending, start: false })
      known.argumentsPending = ''
    }
  }
  if (value.usage) state.usage = value.usage
  if (choice.finish_reason) state.finishReason = choice.finish_reason
  if (choice.finish_reason && value.usage) output.push(...finishEvent(state, choice.finish_reason, value.usage))
  return output
}

function decodeResponses(event, state) {
  const value = decodeJson(event.data)
  if (!value) return []
  const type = value.type || event.event
  if (type === 'error' || type === 'response.failed') return [{ type: 'error', error: value.error || value.response?.error || value }]
  const response = value.response || {}
  const output = ['response.created', 'response.in_progress'].includes(type) ? startEvent(state, response.id, response.model, response.usage) : []
  if (type === 'response.output_text.delta') output.push({ type: 'text', text: value.delta || '' })
  if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') output.push({ type: 'reasoning', text: value.delta || '' })
  if (type === 'response.output_item.done' && value.item?.type === 'reasoning') output.push({ type: 'reasoning_done', item: structuredClone(value.item) })
  if (type === 'response.output_item.added' && value.item?.type === 'function_call') {
    const index = Number(value.output_index) || 0; const item = value.item
    state.tools.set(index, { id: item.call_id || item.id, name: item.name || '' })
    output.push({ type: 'tool', index, id: item.call_id || item.id, name: item.name || '', argumentsDelta: '', start: true })
  }
  if (type === 'response.function_call_arguments.delta') {
    const index = Number(value.output_index) || 0; const known = state.tools.get(index) || { id: value.item_id || `call_${index}`, name: '' }
    state.tools.set(index, known); output.push({ type: 'tool', index, ...known, argumentsDelta: value.delta || '', start: false })
  }
  if (type === 'response.completed') output.push(...finishEvent(state, response.status || 'completed', response.usage))
  return output
}

function decodeGemini(event, state) {
  const value = decodeJson(event.data)
  if (!value) return []
  if (value.error) return [{ type: 'error', error: value.error }]
  const output = startEvent(state, value.responseId, value.modelVersion, value.usageMetadata)
  const candidate = value.candidates?.[0] || {}
  for (const part of candidate.content?.parts || []) {
    if (part.thought && typeof part.text === 'string') output.push({ type: 'reasoning', text: part.text })
    else if (typeof part.text === 'string' && part.text) output.push({ type: 'text', text: part.text })
    if (part.functionCall) {
      const index = state.tools.size; const call = part.functionCall
      output.push({ type: 'tool', index, id: call.id || `call_${index}`, name: call.name, argumentsDelta: JSON.stringify(call.args || {}), start: true })
    }
  }
  if (value.usageMetadata) state.usage = value.usageMetadata
  if (candidate.finishReason) output.push(...finishEvent(state, candidate.finishReason, value.usageMetadata))
  return output
}

function decodeAnthropic(event, state) {
  const value = decodeJson(event.data)
  if (!value) return []
  if (value.type === 'error') return [{ type: 'error', error: value.error }]
  if (value.type === 'message_start') return startEvent(state, value.message?.id, value.message?.model, value.message?.usage)
  if (value.type === 'content_block_start') {
    const block = structuredClone(value.content_block || {}); state.blocks.set(value.index, block)
    if (block.type === 'tool_use') return [{ type: 'tool', index: value.index, id: block.id, name: block.name, argumentsDelta: '', start: true }]
    return []
  }
  if (value.type === 'content_block_delta') {
    if (value.delta?.type === 'text_delta') return [{ type: 'text', text: value.delta.text || '' }]
    if (value.delta?.type === 'thinking_delta') { const block = state.blocks.get(value.index) || {}; block.thinking = `${block.thinking || ''}${value.delta.thinking || ''}`; state.blocks.set(value.index, block); return [{ type: 'reasoning', text: value.delta.thinking || '' }] }
    if (value.delta?.type === 'signature_delta') { const block = state.blocks.get(value.index) || {}; block.signature = value.delta.signature || ''; state.blocks.set(value.index, block); return [] }
    if (value.delta?.type === 'input_json_delta') { const block = state.blocks.get(value.index) || {}; return [{ type: 'tool', index: value.index, id: block.id, name: block.name, argumentsDelta: value.delta.partial_json || '', start: false }] }
  }
  if (value.type === 'content_block_stop') { const item = openAiReasoningItemFromAnthropicBlock(state.blocks.get(value.index)); return item ? [{ type: 'reasoning_done', item }] : [] }
  if (value.type === 'message_delta') { state.finishReason = value.delta?.stop_reason; state.usage = value.usage || state.usage; return [] }
  if (value.type === 'message_stop') return finishEvent(state, state.finishReason, state.usage)
  return []
}

function decodeNormalized(protocol, event, state) {
  if (protocol === 'anthropic') return decodeAnthropic(event, state)
  if (protocol === 'responses') return decodeResponses(event, state)
  if (protocol === 'gemini') return decodeGemini(event, state)
  return decodeChat(event, state)
}

function sse(event, value) { return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n` }
function encodeAnthropic(event, state) {
  const output = []
  if (event.type === 'start') {
    output.push(sse('message_start', { type: 'message_start', message: { id: event.id, type: 'message', role: 'assistant', model: event.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: event.usage.inputTokens, output_tokens: 0 } } }))
  } else if (event.type === 'text' || event.type === 'reasoning') {
    const key = event.type
    if (!state.blocks.has(key)) { const index = state.nextIndex++; state.blocks.set(key, index); const block = event.type === 'reasoning' ? { type: 'thinking', thinking: '', signature: '' } : { type: 'text', text: '' }; output.push(sse('content_block_start', { type: 'content_block_start', index, content_block: block })) }
    const index = state.blocks.get(key); const delta = event.type === 'reasoning' ? { type: 'thinking_delta', thinking: event.text } : { type: 'text_delta', text: event.text }
    output.push(sse('content_block_delta', { type: 'content_block_delta', index, delta }))
  } else if (event.type === 'reasoning_done') {
    const block = anthropicBlockFromOpenAiReasoningItem(event.item)
    if (!block) return output
    if (!state.blocks.has('reasoning')) {
      const index = state.nextIndex++; state.blocks.set('reasoning', index)
      if (block.type === 'redacted_thinking') output.push(sse('content_block_start', { type: 'content_block_start', index, content_block: block }))
      else {
        output.push(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }))
        if (block.thinking) output.push(sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } }))
      }
    }
    if (block.type === 'thinking' && block.signature) output.push(sse('content_block_delta', { type: 'content_block_delta', index: state.blocks.get('reasoning'), delta: { type: 'signature_delta', signature: block.signature } }))
  } else if (event.type === 'tool') {
    const key = `tool:${event.index}`
    if (!state.blocks.has(key)) { const index = state.nextIndex++; state.blocks.set(key, index); output.push(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: event.id, name: event.name, input: {} } })) }
    if (event.argumentsDelta) output.push(sse('content_block_delta', { type: 'content_block_delta', index: state.blocks.get(key), delta: { type: 'input_json_delta', partial_json: event.argumentsDelta } }))
  } else if (event.type === 'finish') {
    for (const index of state.blocks.values()) output.push(sse('content_block_stop', { type: 'content_block_stop', index }))
    const reason = ['length', 'max_tokens'].includes(event.reason) ? 'max_tokens' : event.reason === 'tool_calls' ? 'tool_use' : 'end_turn'
    output.push(sse('message_delta', { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: event.usage.outputTokens } }))
    output.push(sse('message_stop', { type: 'message_stop' }))
  } else if (event.type === 'error') output.push(sse('error', { type: 'error', error: event.error }))
  return output
}

function encodeChat(event, state) {
  const base = { id: state.id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: state.model }
  if (event.type === 'start') { state.id = event.id; state.model = event.model; return [`data: ${JSON.stringify({ ...base, id: event.id, model: event.model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`] }
  if (event.type === 'text') return [`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }] })}\n\n`]
  if (event.type === 'reasoning') return [`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { reasoning_content: event.text }, finish_reason: null }] })}\n\n`]
  if (event.type === 'tool') return [`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: event.index, ...(event.start ? { id: event.id, type: 'function' } : {}), function: { ...(event.start ? { name: event.name } : {}), arguments: event.argumentsDelta || '' } }] }, finish_reason: null }] })}\n\n`]
  if (event.type === 'finish') return [`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: event.reason === 'tool_use' ? 'tool_calls' : event.reason === 'max_tokens' ? 'length' : 'stop' }], usage: { prompt_tokens: event.usage.inputTokens, completion_tokens: event.usage.outputTokens, total_tokens: event.usage.inputTokens + event.usage.outputTokens } })}\n\n`, 'data: [DONE]\n\n']
  if (event.type === 'error') return [`data: ${JSON.stringify({ error: event.error })}\n\n`, 'data: [DONE]\n\n']
  return []
}

function encodeResponses(event, state) {
  const output = []
  if (event.type === 'start') { state.id = event.id; state.model = event.model; output.push(sse('response.created', { type: 'response.created', response: { id: event.id, object: 'response', status: 'in_progress', model: event.model, output: [] } })) }
  else if (event.type === 'reasoning') {
    if (!state.reasoning) {
      const id = `rs_${state.id || Date.now()}`; const outputIndex = state.nextIndex++
      state.reasoning = { id, outputIndex, text: '', item: null }
      output.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: outputIndex, item: { id, type: 'reasoning', summary: [], status: 'in_progress' } }))
      output.push(sse('response.reasoning_summary_part.added', { type: 'response.reasoning_summary_part.added', item_id: id, output_index: outputIndex, summary_index: 0, part: { type: 'summary_text', text: '' } }))
    }
    state.reasoning.text += event.text
    output.push(sse('response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', item_id: state.reasoning.id, output_index: state.reasoning.outputIndex, summary_index: 0, delta: event.text }))
  } else if (event.type === 'reasoning_done') {
    if (!state.reasoning) {
      const outputIndex = state.nextIndex++; state.reasoning = { id: event.item.id || `rs_${state.id || Date.now()}`, outputIndex, text: '', item: null }
      output.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: outputIndex, item: { ...event.item, summary: [], status: 'in_progress' } }))
    }
    state.reasoning.item = structuredClone(event.item)
    output.push(sse('response.output_item.done', { type: 'response.output_item.done', output_index: state.reasoning.outputIndex, item: event.item }))
  } else if (event.type === 'text') {
    if (!state.textStarted) { state.textStarted = true; state.textOutputIndex = state.nextIndex++; output.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: state.textOutputIndex, item: { id: `msg_${state.id}`, type: 'message', role: 'assistant', status: 'in_progress', content: [] } }), sse('response.content_part.added', { type: 'response.content_part.added', item_id: `msg_${state.id}`, output_index: state.textOutputIndex, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })) }
    state.text += event.text; output.push(sse('response.output_text.delta', { type: 'response.output_text.delta', item_id: `msg_${state.id}`, output_index: state.textOutputIndex, content_index: 0, delta: event.text }))
  } else if (event.type === 'tool') {
    const key = event.index; if (!state.tools.has(key)) { const outputIndex = state.nextIndex++; state.tools.set(key, { id: event.id, name: event.name, args: '', outputIndex }); output.push(sse('response.output_item.added', { type: 'response.output_item.added', output_index: outputIndex, item: { id: event.id, call_id: event.id, type: 'function_call', name: event.name, arguments: '', status: 'in_progress' } })) }
    const tool = state.tools.get(key); tool.args += event.argumentsDelta || ''; if (event.argumentsDelta) output.push(sse('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', item_id: tool.id, output_index: tool.outputIndex, delta: event.argumentsDelta }))
  } else if (event.type === 'finish') {
    const completedOutput = []
    if (state.reasoning) {
      const item = state.reasoning.item || { id: state.reasoning.id, type: 'reasoning', summary: state.reasoning.text ? [{ type: 'summary_text', text: state.reasoning.text }] : [] }
      if (!state.reasoning.item) output.push(sse('response.output_item.done', { type: 'response.output_item.done', output_index: state.reasoning.outputIndex, item }))
      completedOutput.push(item)
    }
    if (state.textStarted) {
      output.push(sse('response.output_text.done', { type: 'response.output_text.done', item_id: `msg_${state.id}`, output_index: state.textOutputIndex, content_index: 0, text: state.text }))
      output.push(sse('response.content_part.done', { type: 'response.content_part.done', item_id: `msg_${state.id}`, output_index: state.textOutputIndex, content_index: 0, part: { type: 'output_text', text: state.text, annotations: [] } }))
      const item = { id: `msg_${state.id}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: state.text, annotations: [] }] }
      completedOutput.push(item); output.push(sse('response.output_item.done', { type: 'response.output_item.done', output_index: state.textOutputIndex, item }))
    }
    for (const [index, tool] of state.tools) {
      output.push(sse('response.function_call_arguments.done', { type: 'response.function_call_arguments.done', item_id: tool.id, output_index: tool.outputIndex, arguments: tool.args }))
      const item = { id: tool.id, call_id: tool.id, type: 'function_call', name: tool.name, arguments: tool.args, status: 'completed' }
      completedOutput.push(item); output.push(sse('response.output_item.done', { type: 'response.output_item.done', output_index: tool.outputIndex, item }))
    }
    const response = { id: state.id, object: 'response', status: 'completed', model: state.model, output: completedOutput, usage: { input_tokens: event.usage.inputTokens, output_tokens: event.usage.outputTokens, total_tokens: event.usage.inputTokens + event.usage.outputTokens } }
    output.push(sse('response.completed', { type: 'response.completed', response }))
  } else if (event.type === 'error') output.push(sse('response.failed', { type: 'response.failed', response: { id: state.id, status: 'failed', error: event.error } }))
  return output
}

function encodeGemini(event, state) {
  if (event.type === 'text') return [`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: event.text }] } }] })}\n\n`]
  if (event.type === 'reasoning') return [`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: event.text, thought: true }] } }] })}\n\n`]
  if (event.type === 'tool') {
    const tool = state.tools.get(event.index) || { id: event.id, name: event.name, args: '' }; tool.id ||= event.id; tool.name ||= event.name; tool.args += event.argumentsDelta || ''; state.tools.set(event.index, tool); return []
  }
  if (event.type === 'finish') {
    const output = []
    for (const tool of state.tools.values()) { let args = {}; try { args = JSON.parse(tool.args || '{}') } catch {} output.push(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: tool.id, name: tool.name, args } }] } }] })}\n\n`) }
    output.push(`data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: event.usage.inputTokens, candidatesTokenCount: event.usage.outputTokens, totalTokenCount: event.usage.inputTokens + event.usage.outputTokens } })}\n\n`); return output
  }
  if (event.type === 'error') return [`data: ${JSON.stringify({ error: event.error })}\n\n`]
  return []
}

function encodeNormalized(protocol, event, state) {
  if (protocol === 'anthropic') return encodeAnthropic(event, state)
  if (protocol === 'responses') return encodeResponses(event, state)
  if (protocol === 'gemini') return encodeGemini(event, state)
  return encodeChat(event, state)
}

async function *transformSseStream(body, sourceProtocol, targetProtocol) {
  if (sourceProtocol === targetProtocol) {
    const iterable = body && typeof body.getReader === 'function' ? Readable.fromWeb(body) : body
    for await (const chunk of iterable) yield Buffer.from(chunk)
    return
  }
  const decodeState = { started: false, finished: false, tools: new Map(), blocks: new Map(), usage: {} }
  const encodeState = { id: '', model: '', nextIndex: 0, blocks: new Map(), tools: new Map(), text: '', textStarted: false, textOutputIndex: null, reasoning: null }
  for await (const raw of parseSseEvents(body)) {
    for (const event of decodeNormalized(targetProtocol, raw, decodeState)) {
      for (const encoded of encodeNormalized(sourceProtocol, event, encodeState)) yield Buffer.from(encoded)
    }
  }
  if (!decodeState.finished) {
    for (const event of finishEvent(decodeState, decodeState.finishReason, decodeState.usage)) {
      for (const encoded of encodeNormalized(sourceProtocol, event, encodeState)) yield Buffer.from(encoded)
    }
  }
}

module.exports = { parseSseEvents, usageFrom, decodeNormalized, encodeNormalized, transformSseStream }
