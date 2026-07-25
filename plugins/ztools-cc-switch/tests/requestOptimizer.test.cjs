'use strict'
const test = require('node:test'); const assert = require('node:assert/strict')
const { optimizeBedrockRequest, optimizeCopilotRequest, normalizeCopilot } = require('../preload/requestOptimizer')

test('Bedrock Optimizer 按模型选择 adaptive/legacy/haiku 并限制四个缓存断点', () => {
  const adaptive = optimizeBedrockRequest({ model:'claude-opus-4.8', max_tokens:16000, system:'sys', tools:[{name:'a'}], messages:[{role:'user',content:[{type:'text',text:'one'}]},{role:'assistant',content:[{type:'text',text:'two'}]},{role:'user',content:[{type:'text',text:'three'}]},{role:'assistant',content:[{type:'text',text:'four'}]}] }, { enabled:true })
  assert.deepEqual(adaptive.thinking, { type:'adaptive' }); assert.equal(adaptive.output_config.effort, 'max'); assert.ok(adaptive.anthropic_beta.includes('context-1m-2025-08-07'))
  const points = JSON.stringify(adaptive).match(/cache_control/g) || []; assert.equal(points.length, 4)
  const legacy = optimizeBedrockRequest({ model:'claude-sonnet-4-5', max_tokens:8192, messages:[] }, { enabled:true, cacheInjection:false })
  assert.equal(legacy.thinking.budget_tokens, 8191); assert.ok(legacy.anthropic_beta.includes('interleaved-thinking-2025-05-14'))
  const haiku = optimizeBedrockRequest({ model:'claude-haiku-4-5', max_tokens:8192 }, { enabled:true, cacheInjection:false }); assert.equal(haiku.thinking, undefined)
})

test('Copilot Optimizer 分类工具续写、合并结果、剥离 thinking 并生成稳定 ID', () => {
  const body = { model:'claude-sonnet', metadata:{user_id:'user_demo_session_session-1'}, messages:[{role:'assistant',content:[{type:'tool_use',id:'tool-1'},{type:'thinking',thinking:'secret'}]},{role:'user',content:[{type:'tool_result',tool_use_id:'tool-1',content:'ok'},{type:'text',text:'hook note'}]}] }
  const one = optimizeCopilotRequest(body, {}, {})
  const two = optimizeCopilotRequest(body, {}, {})
  assert.equal(one.classification.initiator, 'agent'); assert.equal(one.headers['x-initiator'], 'agent'); assert.equal(one.body.messages[1].content.length, 1); assert.match(one.body.messages[1].content[0].content, /hook note/)
  assert.equal(one.body.messages[0].content.some((item)=>item.type==='thinking'), false)
  assert.match(one.headers['x-request-id'], /^[0-9a-f-]{36}$/); assert.notEqual(one.headers['x-request-id'], two.headers['x-request-id']); assert.equal(one.headers['x-interaction-id'], two.headers['x-interaction-id'])
})

test('Copilot Optimizer 识别 compact、subagent、warmup 和孤立 tool_result', () => {
  const compact = optimizeCopilotRequest({ system:'You are a helpful AI assistant tasked with summarizing conversations now', messages:[{role:'user',content:'summary'}] }, {}, {})
  assert.equal(compact.classification.isCompact, true); assert.equal(compact.headers['x-initiator'], 'agent')
  const sub = optimizeCopilotRequest({ metadata:{user_id:'parent_agent_child'}, messages:[{role:'user',content:'task'}] }, {}, {})
  assert.equal(sub.headers['x-interaction-type'], 'conversation-subagent')
  const warm = optimizeCopilotRequest({ model:'claude-large', messages:[{role:'user',content:'hello'}], tools:[] }, {'anthropic-beta':'x'}, {})
  assert.equal(warm.classification.isWarmup, true); assert.equal(warm.body.model, 'gpt-5-mini')
  const orphan = optimizeCopilotRequest({ messages:[{role:'assistant',content:[]},{role:'user',content:[{type:'tool_result',tool_use_id:'missing',content:'lost'}]}] }, {}, { toolResultMerging:false })
  assert.equal(orphan.body.messages[1].content[0].type, 'text')
  assert.equal(normalizeCopilot({enabled:false}).enabled, false)
})
