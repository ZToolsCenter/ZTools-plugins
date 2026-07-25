'use strict'

const { flattenRequestNamespaces, anthropicBlockFromOpenAiReasoningItem, openAiReasoningItemFromAnthropicBlock } = require('./codexCompat')

function protocolForClient(client, incomingPath = '') {
  if (client === 'claude') return 'anthropic'
  if (client === 'gemini') return 'gemini'
  return /chat\/completions/i.test(incomingPath) ? 'openai_compat' : 'responses'
}
function protocolForProvider(provider) { return ['anthropic', 'openai_compat', 'responses', 'gemini'].includes(provider.apiType) ? provider.apiType : 'openai_compat' }
function mappedModel(provider, requested) { return String(provider.modelMap?.[requested] || provider.model || requested || '') }
function asText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((v) => v?.type === 'text' || v?.type === 'input_text' || v?.type === 'output_text').map((v) => v.text || '').join('')
}
function parseArguments(value) { if (value && typeof value === 'object') return value; try { return JSON.parse(value || '{}') } catch { return {} } }

function anthropicRequestToIr(body) {
  const messages = []
  const system = asText(body.system)
  for (const message of body.messages || []) {
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : (message.content || [])
    const text = blocks.filter((v) => v.type === 'text').map((v) => v.text || '').join('')
    const toolCalls = blocks.filter((v) => v.type === 'tool_use').map((v) => ({ id: v.id, name: v.name, arguments: v.input || {} }))
    const reasoningItems = blocks.map(openAiReasoningItemFromAnthropicBlock).filter(Boolean)
    const toolResults = blocks.filter((v) => v.type === 'tool_result').map((v) => ({ id: v.tool_use_id, content: asText(v.content) || String(v.content || '') }))
    const images = blocks.filter((v) => v.type === 'image').map((v) => v.source?.type === 'base64' ? `data:${v.source.media_type};base64,${v.source.data}` : v.source?.url).filter(Boolean)
    if (text || toolCalls.length || images.length || reasoningItems.length) messages.push({ role: message.role, text, toolCalls, images, reasoningItems })
    for (const result of toolResults) messages.push({ role: 'tool', text: result.content, toolCallId: result.id })
  }
  return { system, messages, tools: (body.tools || []).map((v) => ({ name: v.name, description: v.description || '', schema: v.input_schema || {} })), toolChoice: body.tool_choice, model: body.model, maxTokens: body.max_tokens, temperature: body.temperature, topP: body.top_p, stops: body.stop_sequences, stream: Boolean(body.stream) }
}

function chatRequestToIr(body) {
  const messages = []; let system = ''
  for (const message of body.messages || []) {
    if (message.role === 'system' || message.role === 'developer') { system += `${system ? '\n\n' : ''}${asText(message.content)}`; continue }
    messages.push({ role: message.role, text: asText(message.content), toolCallId: message.tool_call_id, toolCalls: (message.tool_calls || []).map((v) => ({ id: v.id, name: v.function?.name, arguments: parseArguments(v.function?.arguments) })), images: [] })
  }
  return { system, messages, tools: (body.tools || []).map((v) => ({ name: v.function?.name, description: v.function?.description || '', schema: v.function?.parameters || {} })), toolChoice: body.tool_choice, model: body.model, maxTokens: body.max_completion_tokens || body.max_tokens, temperature: body.temperature, topP: body.top_p, stops: body.stop, stream: Boolean(body.stream) }
}

function responsesRequestToIr(body) {
  const messages = []
  let pendingReasoning = []
  const input = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : (body.input || [])
  for (const item of input) {
    if (item.type === 'reasoning') { pendingReasoning.push(structuredClone(item)); continue }
    if (item.type === 'function_call') { messages.push({ role: 'assistant', text: '', toolCalls: [{ id: item.call_id || item.id, name: item.name, arguments: parseArguments(item.arguments) }], reasoningItems: pendingReasoning }); pendingReasoning = [] }
    else if (item.type === 'function_call_output') messages.push({ role: 'tool', text: String(item.output || ''), toolCallId: item.call_id })
    else { pendingReasoning = []; messages.push({ role: item.role || 'user', text: asText(item.content), toolCalls: [], images: [] }) }
  }
  return { system: asText(body.instructions), messages, tools: (body.tools || []).filter((v) => v.type === 'function').map((v) => ({ name: v.name, description: v.description || '', schema: v.parameters || {} })), toolChoice: body.tool_choice, model: body.model, maxTokens: body.max_output_tokens, temperature: body.temperature, topP: body.top_p, stream: Boolean(body.stream) }
}

function geminiRequestToIr(body) {
  const messages = (body.contents || []).map((item) => ({
    role: item.role === 'model' ? 'assistant' : 'user',
    text: (item.parts || []).filter((v) => typeof v.text === 'string').map((v) => v.text).join(''),
    toolCalls: (item.parts || []).filter((v) => v.functionCall).map((v) => ({ id: v.functionCall.id, name: v.functionCall.name, arguments: v.functionCall.args || {} })),
    images: (item.parts || []).filter((v) => v.inlineData).map((v) => `data:${v.inlineData.mimeType};base64,${v.inlineData.data}`)
  }))
  return { system: (body.systemInstruction?.parts || []).map((v) => v.text || '').join(''), messages, tools: (body.tools || []).flatMap((v) => v.functionDeclarations || []).map((v) => ({ name: v.name, description: v.description || '', schema: v.parameters || {} })), toolChoice: body.toolConfig?.functionCallingConfig, model: body.model, maxTokens: body.generationConfig?.maxOutputTokens, temperature: body.generationConfig?.temperature, topP: body.generationConfig?.topP, stops: body.generationConfig?.stopSequences, stream: Boolean(body.stream) }
}

function requestToIr(protocol, body) {
  if (protocol === 'anthropic') return anthropicRequestToIr(body)
  if (protocol === 'responses') return responsesRequestToIr(body)
  if (protocol === 'gemini') return geminiRequestToIr(body)
  return chatRequestToIr(body)
}

function irToAnthropic(ir, model) {
  const messages = []
  for (const item of ir.messages) {
    if (item.role === 'tool') { messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: item.toolCallId, content: item.text }] }); continue }
    const content = []
    for (const reasoning of item.reasoningItems || []) { const block = anthropicBlockFromOpenAiReasoningItem(reasoning); if (block) content.push(block) }
    if (item.text) content.push({ type: 'text', text: item.text })
    for (const image of item.images || []) { const match = /^data:([^;]+);base64,(.*)$/.exec(image); if (match) content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }) }
    for (const call of item.toolCalls || []) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })
    messages.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content })
  }
  const body = { model, messages, max_tokens: ir.maxTokens || 8192, stream: ir.stream }
  if (ir.system) body.system = ir.system
  if (ir.temperature !== undefined) body.temperature = ir.temperature
  if (ir.topP !== undefined) body.top_p = ir.topP
  if (ir.stops) body.stop_sequences = Array.isArray(ir.stops) ? ir.stops : [ir.stops]
  if (ir.tools.length) body.tools = ir.tools.map((v) => ({ name: v.name, description: v.description, input_schema: v.schema }))
  return body
}

function irToChat(ir, model) {
  const messages = []
  if (ir.system) messages.push({ role: 'system', content: ir.system })
  for (const item of ir.messages) {
    if (item.role === 'tool') { messages.push({ role: 'tool', tool_call_id: item.toolCallId, content: item.text }); continue }
    const message = { role: item.role, content: item.images?.length ? [{ type: 'text', text: item.text || '' }, ...item.images.map((url) => ({ type: 'image_url', image_url: { url } }))] : item.text }
    if (item.toolCalls?.length) message.tool_calls = item.toolCalls.map((v) => ({ id: v.id, type: 'function', function: { name: v.name, arguments: JSON.stringify(v.arguments || {}) } }))
    messages.push(message)
  }
  const body = { model, messages, stream: ir.stream }
  if (ir.maxTokens) body.max_tokens = ir.maxTokens
  if (ir.temperature !== undefined) body.temperature = ir.temperature
  if (ir.topP !== undefined) body.top_p = ir.topP
  if (ir.stops) body.stop = ir.stops
  if (ir.tools.length) body.tools = ir.tools.map((v) => ({ type: 'function', function: { name: v.name, description: v.description, parameters: v.schema } }))
  if (ir.stream) body.stream_options = { include_usage: true }
  if (ir.toolChoice) body.tool_choice = ir.toolChoice.type === 'tool' ? { type: 'function', function: { name: ir.toolChoice.name } } : ir.toolChoice.type === 'any' ? 'required' : ir.toolChoice
  return body
}

function irToResponses(ir, model) {
  const input = []
  for (const item of ir.messages) {
    if (item.role === 'tool') { input.push({ type: 'function_call_output', call_id: item.toolCallId, output: item.text }); continue }
    if (item.toolCalls?.length) for (const reasoning of item.reasoningItems || []) input.push(structuredClone(reasoning))
    input.push({ role: item.role, content: [{ type: item.role === 'assistant' ? 'output_text' : 'input_text', text: item.text || '' }] })
    for (const call of item.toolCalls || []) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments || {}) })
  }
  const body = { model, input, stream: ir.stream }
  if (ir.system) body.instructions = ir.system
  if (ir.maxTokens) body.max_output_tokens = ir.maxTokens
  if (ir.temperature !== undefined) body.temperature = ir.temperature
  if (ir.topP !== undefined) body.top_p = ir.topP
  if (ir.tools.length) body.tools = ir.tools.map((v) => ({ type: 'function', name: v.name, description: v.description, parameters: v.schema }))
  return body
}

function irToGemini(ir, model) {
  const contents = ir.messages.filter((v) => v.role !== 'tool').map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [
    ...(item.text ? [{ text: item.text }] : []),
    ...(item.toolCalls || []).map((v) => ({ functionCall: { id: v.id, name: v.name, args: v.arguments } }))
  ] }))
  const body = { model, contents, generationConfig: {} }
  if (ir.system) body.systemInstruction = { parts: [{ text: ir.system }] }
  if (ir.maxTokens) body.generationConfig.maxOutputTokens = ir.maxTokens
  if (ir.temperature !== undefined) body.generationConfig.temperature = ir.temperature
  if (ir.topP !== undefined) body.generationConfig.topP = ir.topP
  if (ir.stops) body.generationConfig.stopSequences = Array.isArray(ir.stops) ? ir.stops : [ir.stops]
  if (ir.tools.length) body.tools = [{ functionDeclarations: ir.tools.map((v) => ({ name: v.name, description: v.description, parameters: v.schema })) }]
  return body
}

function irToRequest(protocol, ir, model) {
  if (protocol === 'anthropic') return irToAnthropic(ir, model)
  if (protocol === 'responses') return irToResponses(ir, model)
  if (protocol === 'gemini') return irToGemini(ir, model)
  return irToChat(ir, model)
}

function endpointFor(protocol, provider, stream) {
  if (protocol === 'anthropic') return '/v1/messages'
  if (protocol === 'responses') return '/v1/responses'
  if (protocol === 'gemini') return `/v1beta/models/${encodeURIComponent(provider.model || 'gemini-2.5-pro')}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`
  return '/v1/chat/completions'
}

function prepareRequest({ client, provider, incomingPath, body }) {
  const sourceProtocol = protocolForClient(client, incomingPath); const targetProtocol = protocolForProvider(provider)
  if (!body) return { sourceProtocol, targetProtocol, body, path: incomingPath, transformed: false, stream: false, namespaceRestoreMap: new Map() }
  const namespaceResult = sourceProtocol === 'responses' ? flattenRequestNamespaces(body) : { body, changed: false, restoreMap: new Map() }
  const preparedBody = namespaceResult.body
  if (sourceProtocol === targetProtocol) return { sourceProtocol, targetProtocol, body: preparedBody, path: incomingPath, transformed: false, namespaceTransformed: namespaceResult.changed, namespaceRestoreMap: namespaceResult.restoreMap, stream: Boolean(body?.stream) }
  const ir = requestToIr(sourceProtocol, preparedBody); const model = mappedModel(provider, ir.model); const converted = irToRequest(targetProtocol, ir, model)
  return { sourceProtocol, targetProtocol, body: converted, path: endpointFor(targetProtocol, { ...provider, model }, ir.stream), transformed: true, namespaceTransformed: namespaceResult.changed, namespaceRestoreMap: namespaceResult.restoreMap, stream: ir.stream, model }
}

function responseToIr(protocol, body) {
  if (protocol === 'anthropic') return { id: body.id, model: body.model, text: asText(body.content), reasoningItems: (body.content || []).map(openAiReasoningItemFromAnthropicBlock).filter(Boolean), toolCalls: (body.content || []).filter((v) => v.type === 'tool_use').map((v) => ({ id: v.id, name: v.name, arguments: v.input })), finish: body.stop_reason, usage: body.usage || {} }
  if (protocol === 'responses') {
    const output = body.output || []; return { id: body.id, model: body.model, text: output.flatMap((v) => v.content || []).filter((v) => v.type === 'output_text').map((v) => v.text || '').join(''), reasoningItems: output.filter((v) => v.type === 'reasoning').map((v) => structuredClone(v)), toolCalls: output.filter((v) => v.type === 'function_call').map((v) => ({ id: v.call_id || v.id, name: v.name, arguments: parseArguments(v.arguments) })), finish: body.status === 'completed' ? 'end_turn' : body.status, usage: body.usage || {} }
  }
  if (protocol === 'gemini') {
    const candidate = body.candidates?.[0] || {}; const parts = candidate.content?.parts || []; return { id: body.responseId, model: body.modelVersion, text: parts.filter((v) => typeof v.text === 'string').map((v) => v.text).join(''), toolCalls: parts.filter((v) => v.functionCall).map((v) => ({ id: v.functionCall.id, name: v.functionCall.name, arguments: v.functionCall.args })), finish: candidate.finishReason, usage: body.usageMetadata || {} }
  }
  const choice = body.choices?.[0] || {}; const message = choice.message || {}; return { id: body.id, model: body.model, text: asText(message.content), toolCalls: (message.tool_calls || []).map((v) => ({ id: v.id, name: v.function?.name, arguments: parseArguments(v.function?.arguments) })), finish: choice.finish_reason, usage: body.usage || {} }
}

function usageFields(usage) { return { input: Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount) || 0, output: Number(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount) || 0 } }
function irToResponse(protocol, ir) {
  const usage = usageFields(ir.usage)
  if (protocol === 'anthropic') return { id: ir.id || `msg_${Date.now()}`, type: 'message', role: 'assistant', model: ir.model || '', content: [...(ir.reasoningItems || []).map(anthropicBlockFromOpenAiReasoningItem).filter(Boolean), ...(ir.text ? [{ type: 'text', text: ir.text }] : []), ...ir.toolCalls.map((v) => ({ type: 'tool_use', id: v.id, name: v.name, input: v.arguments }))], stop_reason: ir.toolCalls.length ? 'tool_use' : (['length', 'max_tokens'].includes(ir.finish) ? 'max_tokens' : 'end_turn'), stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: usage.output } }
  if (protocol === 'responses') return { id: ir.id || `resp_${Date.now()}`, object: 'response', status: 'completed', model: ir.model || '', output: [...(ir.reasoningItems || []).map((v) => structuredClone(v)), ...(ir.text ? [{ id: `msg_${Date.now()}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: ir.text, annotations: [] }] }] : []), ...ir.toolCalls.map((v) => ({ type: 'function_call', call_id: v.id, name: v.name, arguments: JSON.stringify(v.arguments) }))], usage: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.input + usage.output } }
  if (protocol === 'gemini') return { candidates: [{ content: { role: 'model', parts: [...(ir.text ? [{ text: ir.text }] : []), ...ir.toolCalls.map((v) => ({ functionCall: { id: v.id, name: v.name, args: v.arguments } }))] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: usage.input, candidatesTokenCount: usage.output, totalTokenCount: usage.input + usage.output } }
  return { id: ir.id || `chatcmpl_${Date.now()}`, object: 'chat.completion', model: ir.model || '', choices: [{ index: 0, message: { role: 'assistant', content: ir.text || null, ...(ir.toolCalls.length ? { tool_calls: ir.toolCalls.map((v) => ({ id: v.id, type: 'function', function: { name: v.name, arguments: JSON.stringify(v.arguments) } })) } : {}) }, finish_reason: ir.toolCalls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } }
}

function parseSsePayload(text, protocol) {
  const values = []
  for (const match of String(text || '').matchAll(/^data:\s*(.+)$/gm)) { if (match[1].trim() === '[DONE]') continue; try { values.push(JSON.parse(match[1])) } catch {} }
  if (!values.length) throw new Error('上游流式响应没有有效 SSE 数据')
  if (protocol === 'openai_compat') {
    const textValue = values.map((v) => v.choices?.[0]?.delta?.content || '').join(''); const toolMap = new Map(); let usage = {}; let finish = ''
    for (const value of values) { usage = value.usage || usage; finish = value.choices?.[0]?.finish_reason || finish; for (const call of value.choices?.[0]?.delta?.tool_calls || []) { const current = toolMap.get(call.index) || { id: '', name: '', argumentsText: '' }; current.id ||= call.id || ''; current.name ||= call.function?.name || ''; current.argumentsText += call.function?.arguments || ''; toolMap.set(call.index, current) } }
    return { id: values[0].id, model: values[0].model, text: textValue, toolCalls: [...toolMap.values()].map((v) => ({ id: v.id, name: v.name, arguments: parseArguments(v.argumentsText) })), finish, usage }
  }
  if (protocol === 'responses') {
    const textValue = values.filter((v) => v.type === 'response.output_text.delta').map((v) => v.delta || '').join(''); const completed = values.findLast?.((v) => v.type === 'response.completed') || values.find((v) => v.response?.output)
    return completed?.response ? responseToIr('responses', completed.response) : { id: '', model: '', text: textValue, toolCalls: [], finish: 'end_turn', usage: {} }
  }
  if (protocol === 'gemini') return responseToIr('gemini', values.at(-1))
  const content = []; let usage = {}; let model = ''; let id = ''; let finish = ''
  for (const value of values) { if (value.type === 'message_start') { id = value.message?.id; model = value.message?.model; usage = value.message?.usage || usage } if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta') content.push(value.delta.text || ''); if (value.type === 'message_delta') { finish = value.delta?.stop_reason; usage = { ...usage, ...(value.usage || {}) } } }
  return { id, model, text: content.join(''), toolCalls: [], finish, usage }
}

function responseToSse(protocol, response) {
  const ir = response
  if (protocol === 'anthropic') {
    const message = irToResponse('anthropic', ir); const events = [{ type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: message.usage.input_tokens, output_tokens: 0 } } }]
    if (ir.text) events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ir.text } }, { type: 'content_block_stop', index: 0 })
    events.push({ type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } }, { type: 'message_stop' })
    return events.map((v) => `event: ${v.type}\ndata: ${JSON.stringify(v)}\n\n`).join('')
  }
  const body = irToResponse(protocol, ir)
  if (protocol === 'responses') return `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: body })}\n\n`
  if (protocol === 'gemini') return `data: ${JSON.stringify(body)}\n\n`
  return `data: ${JSON.stringify({ ...body, object: 'chat.completion.chunk' })}\n\ndata: [DONE]\n\n`
}

function transformResponse({ sourceProtocol, targetProtocol, bodyText, streaming }) {
  if (sourceProtocol === targetProtocol) return { body: bodyText, contentType: streaming ? 'text/event-stream' : 'application/json' }
  const ir = streaming ? parseSsePayload(bodyText, targetProtocol) : responseToIr(targetProtocol, JSON.parse(bodyText))
  return { body: streaming ? responseToSse(sourceProtocol, ir) : JSON.stringify(irToResponse(sourceProtocol, ir)), contentType: streaming ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8' }
}

module.exports = { protocolForClient, protocolForProvider, mappedModel, requestToIr, irToRequest, prepareRequest, responseToIr, irToResponse, parseSsePayload, responseToSse, transformResponse }
