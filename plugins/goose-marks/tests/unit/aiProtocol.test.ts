import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  AI_PROTOCOLS,
  DEFAULT_AI_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  getProtocolMeta,
  isAIProtocol,
  resolveProtocolByBaseURL,
  type AIProtocol,
} from '../../src/constants/ai'
import {
  fetchCustomAIModels,
  getDefaultBaseURL,
  getDefaultModelId,
  getProtocolDefaults,
  runAIText,
} from '../../src/lib/aiProvider'

const structuredSaveOutput = {
  name: 'organized_bookmark',
  description: '书签元信息和分类位置',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      desc: { type: 'string' },
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: { groupName: { type: 'string' } },
        },
      },
    },
    required: ['title', 'desc', 'categories'],
  },
}
import { useSettingsStore } from '../../src/stores/settings'

const responsesConfig = {
  baseURL: 'https://responses.example.test/v1',
  apiKey: 'responses-key',
  modelOptions: [{ id: 'gpt-responses', label: 'GPT Responses' }],
  selectedModelId: 'gpt-responses',
}

test.beforeEach(() => {
  useSettingsStore.setState({
    aiEnabled: false,
    aiAllowLegacyUTools: false,
    aiSelectedModelId: responsesConfig.selectedModelId,
    aiUseCustomProvider: true,
    aiProtocol: 'openai-responses',
    aiProtocolVersion: 4,
    aiCustomBaseURL: responsesConfig.baseURL,
    aiCustomApiKey: responsesConfig.apiKey,
    aiCustomModelOptions: responsesConfig.modelOptions,
    aiProtocolConfigs: { 'openai-responses': responsesConfig },
  })
})

test('三种协议具有稳定且互不混淆的默认配置', () => {
  expect(AI_PROTOCOLS.map((item) => item.id)).toEqual([
    'openai-responses',
    'openai-compatible',
    'anthropic',
  ])
  expect(getProtocolDefaults('openai-responses')).toEqual({
    protocol: 'openai-responses',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: DEFAULT_AI_MODEL,
  })
  expect(getProtocolDefaults('openai-compatible')).toEqual({
    protocol: 'openai-compatible',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: DEFAULT_AI_MODEL,
  })
  expect(getProtocolDefaults('anthropic')).toEqual({
    protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
  })
  expect(getDefaultBaseURL('anthropic')).toBe('https://api.anthropic.com/v1')
  expect(getDefaultModelId('anthropic')).toBe(DEFAULT_ANTHROPIC_MODEL)
  expect(getProtocolMeta('openai-compatible').label).toContain('OpenAI')
})

test('旧 OpenAI/Anthropic 地址可迁移到当前协议名', () => {
  expect(isAIProtocol('openai-responses')).toBe(true)
  expect(isAIProtocol('openai-compatible')).toBe(true)
  expect(isAIProtocol('anthropic')).toBe(true)
  expect(isAIProtocol('openai')).toBe(false)
  expect(isAIProtocol('claude')).toBe(false)

  expect(resolveProtocolByBaseURL('https://legacy.example.test/v1')).toBe(
    'openai-compatible',
  )
  expect(resolveProtocolByBaseURL('https://api.anthropic.com/v1')).toBe(
    'anthropic',
  )
  expect(resolveProtocolByBaseURL('https://proxy.example.test/anthropic/v1')).toBe(
    'anthropic',
  )
})

test('切换协议时分别保存 Base URL、凭证与模型', () => {
  const store = useSettingsStore.getState()

  store.setAiProtocol('openai-compatible')
  useSettingsStore.getState().saveAiCustomConfig({
    baseURL: 'https://chat.example.test/v1',
    apiKey: 'chat-key',
    modelOptions: [{ id: 'chat-model', label: 'Chat Model' }],
  })

  useSettingsStore.getState().setAiProtocol('anthropic')
  useSettingsStore.getState().saveAiCustomConfig({
    baseURL: 'https://claude.example.test/v1',
    apiKey: 'claude-key',
    modelOptions: [{ id: 'claude-model', label: 'Claude Model' }],
  })

  useSettingsStore.getState().setAiProtocol('openai-responses')
  expect(useSettingsStore.getState()).toMatchObject({
    aiProtocol: 'openai-responses',
    aiCustomBaseURL: responsesConfig.baseURL,
    aiCustomApiKey: responsesConfig.apiKey,
    aiSelectedModelId: responsesConfig.selectedModelId,
  })

  useSettingsStore.getState().setAiProtocol('openai-compatible')
  expect(useSettingsStore.getState()).toMatchObject({
    aiProtocol: 'openai-compatible',
    aiCustomBaseURL: 'https://chat.example.test/v1',
    aiCustomApiKey: 'chat-key',
    aiSelectedModelId: 'chat-model',
  })

  useSettingsStore.getState().setAiProtocol('anthropic')
  expect(useSettingsStore.getState()).toMatchObject({
    aiProtocol: 'anthropic',
    aiCustomBaseURL: 'https://claude.example.test/v1',
    aiCustomApiKey: 'claude-key',
    aiSelectedModelId: 'claude-model',
  })
})

for (const protocol of [
  'openai-responses',
  'openai-compatible',
  'anthropic',
] satisfies AIProtocol[]) {
  test(`${protocol} 拉取模型时选择正确鉴权头且不访问真实网络`, async () => {
    const originalFetch = globalThis.fetch
    let requestURL = ''
    let requestHeaders: Record<string, string> = {}
    globalThis.fetch = async (input, init) => {
      requestURL = String(input)
      requestHeaders = (init?.headers ?? {}) as Record<string, string>
      return new Response(
        JSON.stringify({ data: [{ id: `${protocol}-model`, name: 'Test Model' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    try {
      const models = await fetchCustomAIModels({
        protocol,
        baseURL:
          protocol === 'anthropic'
            ? 'https://claude.example.test/v1/'
            : 'https://openai.example.test/v1/',
        apiKey: 'test-key',
      })

      expect(requestURL).toBe(
        protocol === 'anthropic'
          ? 'https://claude.example.test/v1/models'
          : 'https://openai.example.test/v1/models',
      )
      expect(models).toEqual([
        { id: `${protocol}-model`, label: 'Test Model', description: undefined },
      ])
      if (protocol === 'anthropic') {
        expect(requestHeaders['x-api-key']).toBe('test-key')
        expect(requestHeaders['anthropic-version']).toBe('2023-06-01')
        expect(requestHeaders.Authorization).toBeUndefined()
      } else {
        expect(requestHeaders.Authorization).toBe('Bearer test-key')
        expect(requestHeaders['x-api-key']).toBeUndefined()
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })
}

test('AI 保存使用后台结构化流程，不触发聊天助手的确认提案', () => {
  const promptSource = readFileSync(new URL('../../src/constants/aiPrompts.ts', import.meta.url), 'utf8')
  const prompt = promptSource.match(/AGGRESSIVE_SAVE_SYSTEM_PROMPT = `([\s\S]*?)`/)?.[1] || ''
  expect(prompt).toContain('后台书签整理器')
  expect(prompt).toContain('不生成变更提案')
  expect(prompt).not.toContain('proposeChanges')
  expect(prompt).not.toContain('等待用户确认')
})

test('AI 保存进度来自真实执行阶段，不再按固定延时模拟十步', () => {
  const serviceSource = readFileSync(new URL('../../src/services/aggressiveAiSave.ts', import.meta.url), 'utf8')
  const homeSource = readFileSync(new URL('../../src/views/home/HomePage.tsx', import.meta.url), 'utf8')

  expect(serviceSource).toContain("reportProgress('fetching'")
  expect(serviceSource).toContain("reportProgress('analyzing'")
  expect(serviceSource).toContain("reportProgress('saving'")
  expect(serviceSource).toContain("reportProgress('completed'")
  expect(homeSource).toContain('onProgress: ({ phase, detail })')
  expect(homeSource).not.toContain('AGGRESSIVE_SAVE_STEP_DELAYS')
  expect(homeSource).not.toContain('animateProgress')
  expect(homeSource).not.toContain('步骤 {activeAggressiveSaveJob.step}/10')
})

test('兼容接口收到 200 空内容时继续降级，并向模型明确 JSON Schema', async () => {
  const originalFetch = globalThis.fetch
  const requestBodies: Record<string, unknown>[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    requestBodies.push(body)
    const attempt = requestBodies.length

    if (attempt === 1) {
      return new Response(JSON.stringify({ error: { message: 'SDK structured output unsupported' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (attempt === 2) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: '{"title":"GitHub","description":"开发者平台","categories":[]}',
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: '{"title":"GitHub","desc":"开发者平台","categories":[]}',
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const result = await runAIText({
      enabled: true,
      allowLegacyUTools: false,
      selectedModelId: 'flash-test',
      useCustomProvider: true,
      protocol: 'openai-compatible',
      customBaseURL: 'https://chat.example.test/v1',
      customApiKey: 'test-key',
      customModelOptions: [],
    }, [
      { role: 'system', content: '你是后台书签整理器。' },
      { role: 'user', content: '{"url":"https://github.com","groups":[]}' },
    ], { output: structuredSaveOutput })

    expect(result).toContain('"title":"GitHub"')
    expect(requestBodies).toHaveLength(3)
    expect(requestBodies[2].response_format).toEqual({ type: 'json_object' })
    const messages = requestBodies[2].messages as Array<{ role: string; content: string }>
    expect(messages[0].content).toContain('输出必须严格符合以下 JSON Schema')
    expect(messages[0].content).toContain('"groupName"')
  } finally {
    globalThis.fetch = originalFetch
  }
})
