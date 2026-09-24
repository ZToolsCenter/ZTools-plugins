import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPACTION_INSTRUCTION,
  analyzeCompactionCandidate,
  applyUsageCalibration,
  appendContextCompactionMarker,
  buildContextProjection,
  createCompactedContextState,
  createContextCompactionMarker,
  createEmptyContextState,
  displayMessagesToApi,
  isContextWindowExceededError,
  pruneToolResultContent,
  projectContextTokens,
  selectCompactionCandidate,
  shouldCompactContext,
  validateCompactionSummary,
} from '../../src/services/context-compaction.js'

/**
 * 创建单元测试使用的界面消息。
 * @param {string} id 消息标识。
 * @param {string} turnId Turn 标识。
 * @param {'user'|'assistant'|'tool'} role 消息角色。
 * @param {string} content 消息内容。
 * @returns {Record<string, unknown>} ZVC 消息对象。
 */
function message(id, turnId, role, content) {
  return { id, turnId, role, content }
}

test('压缩提示词要求在精确措辞重要时逐字引用用户原话', () => {
  assert.match(COMPACTION_INSTRUCTION, /精确措辞重要时逐字引用用户原话/)
})

test('工具结果裁剪保留头尾且不修改短结果', () => {
  const short = pruneToolResultContent('short')
  assert.equal(short.pruned, false)
  assert.equal(short.content, 'short')

  const long = pruneToolResultContent(`HEAD${'x'.repeat(9000)}TAIL`)
  assert.equal(long.pruned, true)
  assert.match(long.content, /^HEAD/)
  assert.match(long.content, /TAIL$/)
  assert.match(long.content, /工具结果中间内容已裁剪/)
})

test('工具调用历史始终保持 assistant 与 tool 配对', () => {
  const api = displayMessagesToApi([
    {
      id: 'a1', turnId: 't1', role: 'assistant', content: '',
      tool_calls: [{ id: 'call-1', name: 'read', arguments: '{"path":"a"}', status: 'completed' }],
    },
    { id: 'r1', turnId: 't1', role: 'tool', tool_call_id: 'call-1', name: 'read', content: 'ok' },
  ])
  assert.equal(api.length, 2)
  assert.equal(api[0].tool_calls[0].id, 'call-1')
  assert.equal(api[1].tool_call_id, 'call-1')
})

test('助手协议回放状态会随工具调用历史进入下一轮请求', () => {
  const replayState = {
    version: 1,
    apiFormat: 'openai-responses',
    providerId: 'provider-responses',
    model: 'gpt-test',
    blocks: [
      {
        type: 'reasoning',
        item: {
          id: 'reasoning-1',
          type: 'reasoning',
          encrypted_content: 'encrypted-reasoning',
        },
      },
    ],
  }
  const api = displayMessagesToApi([
    {
      id: 'a1', turnId: 't1', role: 'assistant', content: '', replay_state: replayState,
      tool_calls: [{ id: 'call-1', name: 'read', arguments: '{"path":"a"}', status: 'completed' }],
    },
    { id: 'r1', turnId: 't1', role: 'tool', tool_call_id: 'call-1', name: 'read', content: 'ok' },
  ])

  assert.deepEqual(api[0].replay_state, replayState)
  assert.equal(api[1].tool_call_id, 'call-1')
})

test('图片消息投影保留文本块和附件引用但不生成 Base64', () => {
  const attachment = { attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: 'image/png', bytes: 12, width: 1, height: 1, name: 'pixel.png' }
  const api = displayMessagesToApi([{
    id: 'image-user', turnId: 't-image', role: 'user', content: '分析这张图',
    parts: [{ type: 'text', text: '分析这张图' }, { type: 'image', attachment }],
  }])
  assert.deepEqual(api[0].content, [
    { type: 'text', text: '分析这张图' },
    { type: 'image', attachment },
  ])
  assert.equal(JSON.stringify(api).includes('base64'), false)
})

test('压缩候选保留最近上下文并选择历史头部安全范围', () => {
  const history = [
    message('u1', 't1', 'user', '第一轮问题'),
    message('a1', 't1', 'assistant', '第一轮回答'.repeat(100)),
    message('u2', 't2', 'user', '第二轮问题'),
    message('a2', 't2', 'assistant', '第二轮回答'.repeat(100)),
    message('u3', 't3', 'user', '当前问题'),
  ]
  const candidate = selectCompactionCandidate({ messages: history, contextState: createEmptyContextState(), retainTokens: 1 })
  assert.ok(candidate)
  assert.deepEqual(candidate.sourceMessageIds, ['u1', 'a1', 'u2', 'a2'])
  assert.equal(candidate.lastTurnId, 't2')
})

test('超长单 Turn 可以在已完成模型步骤之间压缩', () => {
  const history = [
    message('u1', 't1', 'user', '实现一个复杂插件'),
    message('a1', 't1', 'assistant', '较早步骤结果'.repeat(300)),
    {
      ...message('a2', 't1', 'assistant', ''),
      tool_calls: [{ id: 'call-1', name: 'read', arguments: '{"path":"a"}', status: 'completed' }],
    },
    { ...message('r1', 't1', 'tool', '最近工具结果'.repeat(40)), tool_call_id: 'call-1', name: 'read' },
    message('a3', 't1', 'assistant', '根据工具结果继续处理'),
    message('u2', 't2', 'user', '修复最后一个问题'),
  ]
  const candidate = selectCompactionCandidate({
    messages: history,
    contextState: createEmptyContextState(),
    retainTokens: 120,
  })

  assert.ok(candidate)
  assert.deepEqual(candidate.sourceMessageIds, ['u1', 'a1'])
  assert.equal(candidate.lastTurnId, 't1')
  assert.deepEqual(history.slice(candidate.sourceMessages.length).map((item) => item.id), ['a2', 'r1', 'a3', 'u2'])
})

test('保留切点向前对齐 assistant 工具调用并且不拆散并行结果', () => {
  const history = [
    message('u1', 't1', 'user', '旧需求'),
    message('a1', 't1', 'assistant', '旧步骤已经完成'.repeat(100)),
    {
      ...message('a2', 't1', 'assistant', ''),
      tool_calls: [
        { id: 'call-1', name: 'read', arguments: '{}', status: 'completed' },
        { id: 'call-2', name: 'bash', arguments: '{}', status: 'completed' },
      ],
    },
    { ...message('r1', 't1', 'tool', 'A'.repeat(400)), tool_call_id: 'call-1', name: 'read' },
    { ...message('r2', 't1', 'tool', 'B'.repeat(400)), tool_call_id: 'call-2', name: 'bash' },
    message('u2', 't2', 'user', '继续'),
  ]
  const analysis = analyzeCompactionCandidate({
    messages: history,
    contextState: createEmptyContextState(),
    retainTokens: 150,
  })

  assert.ok(analysis.candidate)
  assert.deepEqual(analysis.candidate.sourceMessageIds, ['u1', 'a1'])
  const retainedApi = displayMessagesToApi(history.slice(analysis.candidate.sourceMessages.length))
  assert.equal(retainedApi[0].role, 'assistant')
  assert.equal(retainedApi[0].tool_calls.length, 2)
  assert.deepEqual(retainedApi.slice(1, 3).map((item) => item.tool_call_id), ['call-1', 'call-2'])
})

test('只有当前待回答消息时明确报告没有安全压缩前缀', () => {
  const analysis = analyzeCompactionCandidate({
    messages: [message('u1', 't1', 'user', '当前问题')],
    contextState: createEmptyContextState(),
    retainTokens: 0,
  })
  assert.equal(analysis.candidate, null)
  assert.match(analysis.reason, /不足两条消息/)
})

test('上下文溢出恢复不会把当前用户消息压进摘要', () => {
  const history = [
    message('u1', 't1', 'user', '旧问题'),
    message('a1', 't1', 'assistant', '旧回答'.repeat(300)),
    message('u2', 't2', 'user', '当前必须原样保留的用户需求'),
    { ...message('a2', 't2', 'assistant', ''), status: 'streaming', tool_calls: [] },
  ]
  const analysis = analyzeCompactionCandidate({
    messages: history,
    contextState: createEmptyContextState(),
    retainTokens: 0,
  })

  assert.ok(analysis.candidate)
  assert.deepEqual(analysis.candidate.sourceMessageIds, ['u1', 'a1'])
  assert.equal(analysis.candidate.lastMessageId, 'a1')
  assert.equal(history[analysis.candidate.sourceMessages.length].id, 'u2')
})

test('摘要检查点替换旧前缀但完整历史仍可用于界面', () => {
  const history = [
    message('u1', 't1', 'user', '旧问题'),
    message('a1', 't1', 'assistant', '旧回答'.repeat(200)),
    message('u2', 't2', 'user', '新问题'),
  ]
  const candidate = selectCompactionCandidate({ messages: history, contextState: createEmptyContextState(), retainTokens: 0 })
  const validated = validateCompactionSummary({ content: '## 用户目标与意图\n- 继续完成新问题。' }, candidate)
  const state = createCompactedContextState(createEmptyContextState(), candidate, validated, 'provider::model')
  const projection = buildContextProjection({ messages: history, contextState: state, systemPrompt: 'system', tools: [], modelKey: 'provider::model' })

  assert.equal(history.length, 3)
  assert.equal(projection.messages.some((item) => item.content === '旧问题'), false)
  assert.match(projection.messages[1].content, /compacted-summary/)
  assert.equal(projection.messages.at(-1).content, '新问题')
})

test('压缩标记按完成时间追加到末尾但不会进入模型请求', () => {
  const history = [
    message('u1', 't1', 'user', '旧问题'),
    message('a1', 't1', 'assistant', '旧回答'.repeat(200)),
    message('u2', 't2', 'user', '新问题'),
  ]
  const candidate = selectCompactionCandidate({ messages: history, contextState: createEmptyContextState(), retainTokens: 0 })
  const validated = validateCompactionSummary({ content: '## 当前进展\n- 已整理旧对话。' }, candidate)
  const marker = createContextCompactionMarker(candidate, validated, { id: 'compact-1', reason: 'manual', timestamp: 123 })
  const timeline = appendContextCompactionMarker(history, marker)

  assert.equal(timeline.at(-1), marker)
  assert.equal(marker.kind, 'context-compaction')
  assert.equal(marker.shadowedItemCount, 2)
  assert.equal(displayMessagesToApi(timeline).some((item) => item.content?.includes('已整理旧对话')), false)
  assert.throws(() => appendContextCompactionMarker(history, { ...marker, boundaryMessageId: 'missing' }), /历史边界不存在/)
})

test('无缩减摘要、超限错误和 usage 校正具有明确边界', () => {
  assert.throws(() => validateCompactionSummary({ content: 'x'.repeat(2000) }, { shadowedTokens: 10 }), /没有缩小历史/)
  assert.equal(shouldCompactContext(2866, 4096), false)
  assert.equal(shouldCompactContext(2867, 4096), true)
  assert.equal(shouldCompactContext(3277, 4096, 0.8), true)
  assert.equal(isContextWindowExceededError({ message: 'maximum context length is 128000 tokens' }), true)
  const calibrated = applyUsageCalibration(createEmptyContextState(), { prompt_tokens: 200 }, 100, 'p::m')
  assert.equal(calibrated.lastPromptTokens, 200)
  assert.ok(calibrated.tokenScale > 1)
})

test('上下文占用使用提供商采样并沿本地消息增量推进', () => {
  const sampled = applyUsageCalibration(createEmptyContextState(), { prompt_tokens: 200 }, 100, 'p::m')
  assert.equal(projectContextTokens(sampled, 125, 250, 'p::m'), 250)
  assert.equal(projectContextTokens(sampled, 125, 250, 'other::model'), 250)
  assert.equal(projectContextTokens(createEmptyContextState(), 125, 180, 'p::m'), 180)
  const switchedWithoutUsage = applyUsageCalibration(sampled, undefined, 140, 'other::model')
  assert.equal(switchedWithoutUsage.lastPromptTokens, 0)
  assert.equal(projectContextTokens(switchedWithoutUsage, 150, 150, 'other::model'), 150)
})
