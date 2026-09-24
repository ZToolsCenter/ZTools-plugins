import { expect, test } from '@playwright/test'
import {
  createDefaultSettingsState,
  flushSettingsStorePersistence,
  normalizePersistedSettings,
  useSettingsStore,
} from '../../src/stores/settings'
import { getDefaultAISettings } from '../../src/lib/aiProvider'

test('AI 助手能力对新用户默认全部开启', () => {
  expect(getDefaultAISettings().enabled).toBe(true)
  expect(createDefaultSettingsState()).toMatchObject({
    aiEnabled: true,
    aiAggressiveSaveEnabled: true,
    aiFormAutoPolish: true,
  })
})

test('缺失的 AI 能力字段补为开启，同时保留旧用户明确保存的值，并丢弃已移除的对话面板字段', () => {
  expect(normalizePersistedSettings({})).toMatchObject({
    aiEnabled: true,
    aiAggressiveSaveEnabled: true,
    aiFormAutoPolish: true,
  })

  const normalized = normalizePersistedSettings({
    aiEnabled: false,
    aiAggressiveSaveEnabled: false,
    aiFormAutoPolish: false,
    readLocalSkills: false,
    userGlobalPrompt: '旧全局提示词',
    aiDefaultReasoningEffort: 'high',
    aiDefaultTemperature: 0.7,
  } as Partial<ReturnType<typeof createDefaultSettingsState>>)
  expect(normalized).toMatchObject({
    aiEnabled: false,
    aiAggressiveSaveEnabled: false,
    aiFormAutoPolish: false,
  })
  expect(normalized).not.toHaveProperty('readLocalSkills')
  expect(normalized).not.toHaveProperty('userGlobalPrompt')
  expect(normalized).not.toHaveProperty('aiDefaultReasoningEffort')
  expect(normalized).not.toHaveProperty('aiDefaultTemperature')
})

test('AI 连接草稿在收起边界同步写入 uTools 云同步数据库', () => {
  const docs = new Map<string, { _id: string; _rev: string; data: unknown }>()
  let revision = 0
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      utools: {
        db: {
          get: (id: string) => docs.get(id) ?? null,
          put: (doc: { _id: string; data: unknown }) => {
            const stored = { ...doc, _rev: String(++revision) }
            docs.set(doc._id, stored)
            return { ok: true, id: doc._id, rev: stored._rev }
          },
          remove: (id: string) => {
            docs.delete(id)
            return { ok: true, id }
          },
          allDocs: () => Array.from(docs.values()),
        },
      },
    },
  })

  try {
    useSettingsStore.setState({
      aiEnabled: true,
      aiProtocol: 'openai-compatible',
      aiCustomBaseURL: 'https://old.example.test/v1',
      aiCustomApiKey: '',
      aiCustomModelOptions: [{ id: 'long-model-id', label: 'Long model' }],
      aiSelectedModelId: 'long-model-id',
      aiProtocolConfigs: {},
    })

    useSettingsStore.getState().setAiCustomCredentials({
      baseURL: 'https://new.example.test/v1',
      apiKey: 'sk-cloud-sync',
    })
    flushSettingsStorePersistence()

    const settings = docs.get('gm:settings')?.data as Record<string, unknown>
    expect(settings).toMatchObject({
      aiEnabled: true,
      aiProtocol: 'openai-compatible',
      aiCustomBaseURL: 'https://new.example.test/v1',
      aiCustomApiKey: 'sk-cloud-sync',
      aiSelectedModelId: 'long-model-id',
    })
    expect(settings.aiProtocolConfigs).toMatchObject({
      'openai-compatible': {
        baseURL: 'https://new.example.test/v1',
        apiKey: 'sk-cloud-sync',
        selectedModelId: 'long-model-id',
      },
    })
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
