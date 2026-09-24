// 注意：@ai-sdk/* 与 ai 体积较大，仅在真正发起自定义 AI 调用时才需要。
// 本模块被 stores/settings 在启动期静态引入（取默认配置/归一化模型列表），若在此顶层
// 静态导入会把整个 AI SDK 图打进启动包。故改为在 runCustomText 内 await import() 懒加载，
// 使 ai-sdk 拆到独立 chunk、按需加载（见 vite.config.ts codeSplitting 的 vendor-ai-sdk 组）。
import {
  DEFAULT_AI_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  getProtocolMeta,
  type AIProtocol
} from '@/constants/ai'
import { isUToolsAiSupported, resolvePreferredUToolsModel } from '@/lib/utoolsAi'
import type { AIStructuredOutput } from '@/constants/aiPrompts'
import { parseAIJsonObject } from '@/lib/aiOutput'

const MODEL_ERROR_KEYWORDS = ['model', '模型', 'not found', 'unknown', 'unsupported', 'invalid', '不存在', '不可用', '无效']
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'
const ANTHROPIC_API_VERSION = '2023-06-01'
const SETTINGS_ENTRY_HINT = '请前往“设置 -> AI 助手”检查配置。'

export type AIProviderMode = 'utools' | 'custom'
export type { AIProtocol }

export interface AIModelOption {
  id: string
  label: string
  description?: string
}

export interface AISettingsLike {
  enabled: boolean
  allowLegacyUTools: boolean
  selectedModelId: string | null
  useCustomProvider: boolean
  /** OpenAI Responses / OpenAI-compatible Chat Completions / Anthropic */
  protocol: AIProtocol
  customBaseURL: string
  customApiKey: string
  customModelOptions: AIModelOption[]
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content?: string
}

export interface RunAITextOptions {
  output?: AIStructuredOutput
}

export class AIProviderRequestError extends Error {
  override cause: unknown
  provider: AIProviderMode
  model: string
  fallbackAttempted: boolean
  isCustomModel: boolean

  constructor(input: {
    cause: unknown
    provider: AIProviderMode
    model: string
    fallbackAttempted?: boolean
    isCustomModel: boolean
  }) {
    super(input.cause instanceof Error ? input.cause.message : String(input.cause))
    this.name = 'AIProviderRequestError'
    this.cause = input.cause
    this.provider = input.provider
    this.model = input.model
    this.fallbackAttempted = !!input.fallbackAttempted
    this.isCustomModel = input.isCustomModel
  }
}

function getUToolsApi() {
  if (typeof window === 'undefined') return null
  return window.utools ?? null
}

function isModelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  return MODEL_ERROR_KEYWORDS.some(keyword => lower.includes(keyword.toLowerCase()))
}

function normalizeMessages(messages: AIMessage[]) {
  return messages
    .filter(message => typeof message.content === 'string' && message.content.trim())
    .map(message => ({
      role: message.role,
      content: message.content!.trim()
    }))
}

function appendStructuredOutputInstruction(
  messages: AIMessage[],
  output?: AIStructuredOutput
): AIMessage[] {
  if (!output) return messages

  const instruction = [
    '只输出单个合法 JSON 对象，不要输出 Markdown、解释或其他文字。',
    `输出必须严格符合以下 JSON Schema，字段名不得替换：${JSON.stringify(output.schema)}`
  ].join('\n')
  const systemIndex = messages.findIndex((message) => message.role === 'system')
  if (systemIndex < 0) {
    return [{ role: 'system', content: instruction }, ...messages]
  }

  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content?.trim() || ''}\n\n${instruction}`.trim() }
    : message)
}

function extractStructuredText(payload: unknown, output?: AIStructuredOutput) {
  const text = extractTextFromJsonPayload(payload)
  if (!text) return ''
  if (!output) return text

  try {
    const parsed = parseAIJsonObject(text)
    return matchesJsonSchemaShape(parsed, output.schema) ? text : ''
  } catch {
    return ''
  }
}

function matchesJsonSchemaShape(value: unknown, schema: unknown): boolean {
  if (!isRecord(schema)) return true

  if (schema.type === 'object') {
    if (!isRecord(value)) return false
    const required = Array.isArray(schema.required)
      ? schema.required.filter((field): field is string => typeof field === 'string')
      : []
    if (required.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
      return false
    }

    if (isRecord(schema.properties)) {
      for (const [field, fieldSchema] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, field)
          && !matchesJsonSchemaShape(value[field], fieldSchema)) {
          return false
        }
      }
    }
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false
    if (schema.items && value.some((item) => !matchesJsonSchemaShape(item, schema.items))) {
      return false
    }
  }

  return true
}

function normalizeModelOption(input: unknown): AIModelOption | null {
  if (!input) return null

  if (typeof input === 'string') {
    const id = input.trim()
    return id ? { id, label: id } : null
  }

  if (typeof input !== 'object') return null

  const maybeModel = input as {
    id?: unknown
    name?: unknown
    display_name?: unknown
    description?: unknown
    type?: unknown
  }

  const id = typeof maybeModel.id === 'string' ? maybeModel.id.trim() : ''
  if (!id) return null

  const labelSource =
    typeof maybeModel.display_name === 'string' && maybeModel.display_name.trim()
      ? maybeModel.display_name.trim()
      : typeof maybeModel.name === 'string' && maybeModel.name.trim()
        ? maybeModel.name.trim()
        : id

  const descriptionParts = [
    typeof maybeModel.description === 'string' ? maybeModel.description.trim() : '',
    typeof maybeModel.type === 'string' ? maybeModel.type.trim() : ''
  ].filter(Boolean)

  return {
    id,
    label: labelSource,
    description: descriptionParts.length ? descriptionParts.join(' · ') : undefined
  }
}

function getOpenAIModelsUrl(baseURL: string) {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

function getOpenAIResponsesUrl(baseURL: string) {
  return `${baseURL.replace(/\/+$/, '')}/responses`
}

export function getDefaultBaseURL(protocol: AIProtocol = 'openai-responses') {
  return protocol === 'anthropic' ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL
}

/** 解析用户自定义 Base URL，空值回落到协议官方默认 */
export function resolveCustomBaseURL(
  protocol: AIProtocol,
  customBaseURL?: string | null
): string {
  const trimmed = (customBaseURL || '').trim().replace(/\/+$/, '')
  return trimmed || getDefaultBaseURL(protocol).replace(/\/+$/, '')
}

export function getDefaultModelId(protocol: AIProtocol = 'openai-responses') {
  return protocol === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_AI_MODEL
}

function getProtocolLabel(protocol: AIProtocol) {
  if (protocol === 'anthropic') return 'Anthropic 原生接口'
  if (protocol === 'openai-compatible') return 'OpenAI 兼容接口'
  return 'OpenAI Responses API'
}

async function readErrorMessage(response: Response) {
  // 一次性读取 body，避免二次消费导致空串或异常
  let raw: string
  try {
    raw = await response.text()
  } catch {
    return null
  }

  // 优先从 JSON 字段提取可读错误信息
  try {
    const payload = JSON.parse(raw)
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return payload.error.trim()
    }
    if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
      return payload.error.message.trim()
    }
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return payload.message.trim()
    }
  } catch {
    // 非 JSON 响应，直接使用原始文本
  }

  // 兜底：返回原始文本截断（防止超长错误页面）
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.length > 300 ? trimmed.slice(0, 300) + '…' : trimmed
}

function getApiKeyMissingMessage() {
  return `未填写 API Key。${SETTINGS_ENTRY_HINT}`
}

function getAuthFailedMessage(providerLabel: string) {
  return `${providerLabel} 鉴权失败。${SETTINGS_ENTRY_HINT}`
}

function getSelectedCustomModelId(settings: AISettingsLike) {
  const selectedModelId = settings.selectedModelId?.trim()
  if (selectedModelId) return selectedModelId
  return settings.customModelOptions[0]?.id ?? null
}

function shouldUseLegacyUTools(settings: AISettingsLike) {
  return settings.allowLegacyUTools && !settings.useCustomProvider
}

function extractTextPayload(result: string | { text?: string; content?: string }) {
  const text = typeof result === 'string'
    ? result
    : typeof result?.content === 'string'
      ? result.content
      : typeof result?.text === 'string'
        ? result.text
        : ''

  const normalizedText = text.trim()
  if (!normalizedText) {
    throw new Error('AI 没有返回可用内容')
  }

  return normalizedText
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    return ''
  }

  const combined = content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''

      if (typeof part.text === 'string') return part.text
      if (typeof part.output_text === 'string') return part.output_text
      if (typeof part.content === 'string') return part.content
      return ''
    })
    .join('')
    .trim()

  return combined
}

function extractTextFromJsonPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload.trim()
  }

  if (!isRecord(payload)) {
    return ''
  }

  const directFields = [
    payload.text,
    payload.output_text,
    payload.content,
    payload.response,
    payload.answer,
    payload.result
  ]

  for (const field of directFields) {
    const text = typeof field === 'string'
      ? field.trim()
      : isRecord(field)
        ? extractTextFromJsonPayload(field)
        : extractTextFromContent(field)
    if (text) return text
  }

  if (Array.isArray(payload.choices)) {
    const deltaParts: string[] = []

    for (const choice of payload.choices) {
      if (!isRecord(choice)) continue

      const message = isRecord(choice.message) ? choice.message : null
      const delta = isRecord(choice.delta) ? choice.delta : null
      const text = [
        typeof choice.text === 'string' ? choice.text.trim() : '',
        extractTextFromContent(message?.content),
        extractTextFromContent(delta?.content),
        typeof delta?.text === 'string' ? delta.text.trim() : '',
        typeof message?.text === 'string' ? message.text.trim() : ''
      ].find(Boolean)

      if (text) {
        if (delta && !message && typeof choice.text !== 'string') {
          deltaParts.push(text)
          continue
        }
        return text
      }
    }

    const combinedDelta = deltaParts.join('').trim()
    if (combinedDelta) return combinedDelta
  }

  if (Array.isArray(payload.output)) {
    const outputText = payload.output
      .map(item => extractTextFromJsonPayload(item))
      .join('')
      .trim()

    if (outputText) return outputText
  }

  if (Array.isArray(payload.data)) {
    const nestedText = payload.data
      .map(item => extractTextFromJsonPayload(item))
      .find(Boolean)

    if (nestedText) return nestedText
  }

  return ''
}

function isInvalidJsonResponseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  return lower.includes('invalid json response')
    || lower.includes('unexpected token')
    || (lower.includes('json') && lower.includes('response'))
}

function normalizeStructuredOutputError(error: unknown, enabled: boolean) {
  if (!enabled) return error
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (
    lower.includes('json schema') ||
    lower.includes('json_schema') ||
    lower.includes('response format') ||
    lower.includes('structured output') ||
    lower.includes('no object generated')
  ) {
    return new Error('当前模型不支持所需的结构化输出，请切换到支持 JSON Schema 或原生工具调用的模型')
  }
  return error
}

function isOfficialOpenAIBaseURL(baseURL: string) {
  try {
    const host = new URL(baseURL.includes('://') ? baseURL : `https://${baseURL}`).hostname.toLowerCase()
    return host === 'api.openai.com' || host.endsWith('.openai.com')
  } catch {
    return false
  }
}

function buildResponsesTextFormat(output?: AIStructuredOutput) {
  if (!output) return undefined
  return {
    format: {
      type: 'json_schema' as const,
      name: output.name,
      description: output.description,
      schema: output.schema,
      strict: true
    }
  }
}

/** 读取 OpenAI Responses SSE 流，拼接 output_text.delta */
async function readResponsesSSE(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error('OpenAI Responses API 没有返回可读流')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let streamError: string | null = null

  const consumeEventData = (data: string) => {
    if (!data || data === '[DONE]') return
    let event: unknown
    try {
      event = JSON.parse(data)
    } catch {
      return
    }
    if (!isRecord(event)) return

    const type = typeof event.type === 'string' ? event.type : ''
    if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
      text += event.delta
      return
    }
    if (type === 'response.completed' && isRecord(event.response)) {
      const finalText = extractTextFromJsonPayload(event.response)
      if (finalText) text = finalText
      return
    }
    if (type === 'response.failed' || type === 'error') {
      const errObj = isRecord(event.error) ? event.error : isRecord(event.response) ? event.response.error : null
      const msg =
        (isRecord(errObj) && typeof errObj.message === 'string' && errObj.message) ||
        (typeof event.message === 'string' && event.message) ||
        'OpenAI Responses 流式调用失败'
      streamError = msg
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      consumeEventData(trimmed.slice(5).trim())
    }
  }

  // 处理末尾残留
  const tail = buffer.trim()
  if (tail.startsWith('data:')) {
    consumeEventData(tail.slice(5).trim())
  }

  if (streamError) throw new Error(streamError)
  return text.trim()
}

/**
 * Chat Completions 兜底：部分兼容网关对 Responses 参数更严，但 chat/completions 可用。
 * 仅用于结构化文本任务（书签元信息），不承担工具连续调用。
 */
async function runOpenAIChatCompletionsText(
  settings: AISettingsLike,
  messages: AIMessage[],
  selectedModelId: string,
  output?: AIStructuredOutput
) {
  const baseURL = resolveCustomBaseURL('openai-compatible', settings.customBaseURL)
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`
  const normalized = normalizeMessages(messages)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const baseBody: Record<string, unknown> = {
      model: selectedModelId,
      messages: normalized.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.2
    }
    const attempts: Record<string, unknown>[] = output
      ? [
          {
            ...baseBody,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: output.name,
                description: output.description,
                schema: output.schema,
                strict: true
              }
            }
          },
          { ...baseBody, response_format: { type: 'json_object' } },
          baseBody
        ]
      : [baseBody]

    let lastError: Error | null = null
    for (const body of attempts) {
      const response = await fetch(url, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.customApiKey.trim()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const detail = await readErrorMessage(response)
        if (response.status === 401 || response.status === 403) {
          throw new Error(getAuthFailedMessage('OpenAI 兼容接口'))
        }
        lastError = new Error(detail || `调用 Chat Completions 失败（${response.status}）`)
        const lower = (detail || '').toLowerCase()
        const canDowngrade = Boolean(output) && (
          response.status === 400
          || response.status === 404
          || response.status === 422
          || lower.includes('response_format')
          || lower.includes('json_schema')
          || lower.includes('unsupported')
        )
        if (!canDowngrade) throw lastError
        continue
      }

      const text = extractStructuredText(await response.json(), output)
      if (text) return text
      lastError = new Error(output
        ? 'AI 返回内容不是可解析的 JSON 对象'
        : 'Chat Completions 没有返回可用内容')
    }

    throw lastError ?? new Error('Chat Completions 没有返回可用内容')
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('请求超时，请检查接口地址是否可达')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function runOfficialOpenAIResponsesText(
  settings: AISettingsLike,
  messages: AIMessage[],
  selectedModelId: string,
  output?: AIStructuredOutput
) {
  const normalized = normalizeMessages(messages)
  const instructions = normalized
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
    .trim()
  const input = normalized
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content }))

  const baseURL = resolveCustomBaseURL('openai-responses', settings.customBaseURL)
  const official = isOfficialOpenAIBaseURL(baseURL)
  const textFormat = buildResponsesTextFormat(output)

  // 官方：非流式 + max_output_tokens；兼容网关常要求 store=false、stream=true，且拒 max_output_tokens
  const attemptBodies: Record<string, unknown>[] = official
    ? [
        {
          model: selectedModelId,
          store: false,
          ...(instructions ? { instructions } : {}),
          input,
          max_output_tokens: 1024,
          ...(textFormat ? { text: textFormat } : {})
        }
      ]
    : [
        {
          model: selectedModelId,
          store: false,
          stream: true,
          ...(instructions ? { instructions } : {}),
          input,
          ...(textFormat ? { text: textFormat } : {})
        },
        // 个别网关不接受 json_schema text.format，再试纯文本流
        {
          model: selectedModelId,
          store: false,
          stream: true,
          ...(instructions
            ? {
                instructions: `${instructions}\n\n只输出合法 JSON 对象，不要使用 Markdown 代码块。`
              }
            : {
                instructions: '只输出合法 JSON 对象，不要使用 Markdown 代码块。'
              }),
          input
        }
      ]

  let lastError: unknown = null
  for (const body of attemptBodies) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), official ? 45_000 : 90_000)
    try {
      const response = await fetch(getOpenAIResponsesUrl(baseURL), {
        signal: controller.signal,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.customApiKey.trim()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream, text/plain, */*'
        },
        body: JSON.stringify(body)
      })

      if (!response.ok) {
        const detail = await readErrorMessage(response)
        if (response.status === 401 || response.status === 403) {
          throw new Error(getAuthFailedMessage('OpenAI 官方 Responses API'))
        }
        lastError = new Error(detail || `调用 OpenAI Responses API 失败（${response.status}）`)
        continue
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      const useStream = Boolean(body.stream) || contentType.includes('text/event-stream')
      const text = useStream
        ? await readResponsesSSE(response)
        : extractTextFromJsonPayload(await response.json())

      if (!text || (output && !extractStructuredText(text, output))) {
        lastError = new Error(output
          ? 'AI 返回内容不是可解析的 JSON 对象'
          : 'OpenAI Responses API 没有返回可用内容')
        continue
      }
      return text
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        lastError = new Error('请求超时，请检查接口地址是否可达')
      } else {
        lastError = err
      }
    } finally {
      clearTimeout(timer)
    }
  }

  // 兼容网关：Responses 参数受限时降级到 chat/completions（仅文本结构化任务）
  if (!official) {
    try {
      return await runOpenAIChatCompletionsText(settings, messages, selectedModelId, output)
    } catch (fallbackErr) {
      // 保留更具体的原始错误，便于排查
      if (lastError) throw lastError
      throw fallbackErr
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI Responses API 调用失败')
}

/** Anthropic Messages API 原生兜底（SDK 解析失败时） */
async function runCustomAnthropicText(settings: AISettingsLike, messages: AIMessage[], selectedModelId: string) {
  const baseURL = resolveCustomBaseURL('anthropic', settings.customBaseURL)
  const normalized = normalizeMessages(messages)
  const system = normalized.filter((m) => m.role === 'system').map((m) => m.content).join('\n').trim()
  const chatMessages = normalized
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(`${baseURL}/messages`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'x-api-key': settings.customApiKey.trim(),
        'anthropic-version': ANTHROPIC_API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        model: selectedModelId,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages: chatMessages.length ? chatMessages : [{ role: 'user', content: '' }]
      })
    })

    if (!response.ok) {
      const detail = await readErrorMessage(response)
      if (response.status === 401 || response.status === 403) {
        throw new Error(getAuthFailedMessage('Anthropic'))
      }
      throw new Error(detail || `调用 Anthropic 失败（${response.status}）`)
    }

    const payload = await response.json()
    const text = extractTextFromJsonPayload(payload)
    if (!text) {
      // Anthropic content 数组：[{ type: 'text', text: '...' }]
      if (isRecord(payload) && Array.isArray(payload.content)) {
        const joined = payload.content
          .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
          .join('')
          .trim()
        if (joined) return joined
      }
      throw new Error('AI 没有返回可用内容')
    }
    return text
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('请求超时，请检查接口地址是否可达')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function runUToolsText(settings: AISettingsLike, messages: AIMessage[]) {
  const utools = getUToolsApi()
  if (!utools?.ai) {
    throw new AIProviderRequestError({
      cause: new Error('当前 uTools 版本未提供 AI 能力'),
      provider: 'utools',
      model: settings.selectedModelId?.trim() || DEFAULT_AI_MODEL,
      isCustomModel: false
    })
  }

  const modelId = await resolvePreferredUToolsModel(settings.selectedModelId)

  try {
    const result = await utools.ai({
      model: modelId,
      messages: normalizeMessages(messages)
    })
    return extractTextPayload(result)
  } catch (error) {
    if (!isModelError(error)) {
      throw new AIProviderRequestError({
        cause: error,
        provider: 'utools',
        model: modelId,
        isCustomModel: false
      })
    }

    try {
      const result = await utools.ai({
        messages: normalizeMessages(messages)
      })
      return extractTextPayload(result)
    } catch (fallbackError) {
      throw new AIProviderRequestError({
        cause: fallbackError,
        provider: 'utools',
        model: modelId,
        fallbackAttempted: true,
        isCustomModel: false
      })
    }
  }
}

async function runCustomText(
  settings: AISettingsLike,
  messages: AIMessage[],
  options: RunAITextOptions
) {
  const selectedModelId = getSelectedCustomModelId(settings)
  if (!selectedModelId) {
    throw new AIProviderRequestError({
      cause: new Error('请先保存 AI 配置并获取模型列表'),
      provider: 'custom',
      model: '',
      isCustomModel: true
    })
  }

  const protocol: AIProtocol =
    settings.protocol === 'anthropic' ||
    settings.protocol === 'openai-compatible' ||
    settings.protocol === 'openai-responses'
      ? settings.protocol
      : 'openai-responses'
  const { generateText, Output, jsonSchema } = await import('ai')
  const requestMessages = appendStructuredOutputInstruction(messages, options.output)
  const normalizedMessages = normalizeMessages(requestMessages)
  const system = normalizedMessages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')
    .trim()
  const chatMessages = normalizedMessages.filter(
    (message): message is { role: 'user' | 'assistant'; content: string } =>
      message.role === 'user' || message.role === 'assistant'
  )

  try {
    const model = protocol === 'openai-responses'
      ? (await import('@ai-sdk/openai')).createOpenAI({
          baseURL: resolveCustomBaseURL(protocol, settings.customBaseURL),
          apiKey: settings.customApiKey.trim(),
          name: 'openai.responses'
        }).responses(selectedModelId)
      : protocol === 'openai-compatible'
        ? (await import('@ai-sdk/openai-compatible')).createOpenAICompatible({
            baseURL: resolveCustomBaseURL(protocol, settings.customBaseURL),
            apiKey: settings.customApiKey.trim(),
            name: 'openai.compatible'
          }).chatModel(selectedModelId)
        : (await import('@ai-sdk/anthropic')).createAnthropic({
            baseURL: resolveCustomBaseURL(protocol, settings.customBaseURL),
            apiKey: settings.customApiKey.trim(),
            name: 'anthropic.official',
            headers: {
              'anthropic-dangerous-direct-browser-access': 'true'
            }
          }).languageModel(selectedModelId)

    const result = await generateText({
      model,
      ...(system ? { system } : {}),
      messages: chatMessages,
      ...(options.output
        ? {
            output: Output.object({
              schema: jsonSchema(options.output.schema as Parameters<typeof jsonSchema>[0]),
              name: options.output.name,
              description: options.output.description
            })
          }
        : {})
    })
    const normalizedText = options.output
      ? JSON.stringify(result.output)
      : result.text.trim()
    if (!normalizedText) throw new Error('AI 没有返回可用内容')
    return normalizedText
  } catch (error) {
    // Vercel AI SDK 是主链；兼容服务返回非标准 JSON 时保留原生 HTTP 兜底。
    if (protocol === 'openai-compatible') {
      try {
        return await runOpenAIChatCompletionsText(
          settings,
          requestMessages,
          selectedModelId,
          options.output
        )
      } catch (fallbackError) {
        throw new AIProviderRequestError({
          cause: normalizeStructuredOutputError(fallbackError, Boolean(options.output)),
          provider: 'custom',
          model: selectedModelId,
          isCustomModel: true
        })
      }
    }

    if (
      protocol === 'openai-responses'
      && (isInvalidJsonResponseError(error) || Boolean(options.output))
    ) {
      try {
        return await runOfficialOpenAIResponsesText(
          settings,
          requestMessages,
          selectedModelId,
          options.output
        )
      } catch (fallbackError) {
        throw new AIProviderRequestError({
          cause: normalizeStructuredOutputError(fallbackError, Boolean(options.output)),
          provider: 'custom',
          model: selectedModelId,
          isCustomModel: true
        })
      }
    }

    if (protocol === 'anthropic' && !options.output && isInvalidJsonResponseError(error)) {
      try {
        return await runCustomAnthropicText(settings, messages, selectedModelId)
      } catch (fallbackError) {
        throw new AIProviderRequestError({
          cause: fallbackError,
          provider: 'custom',
          model: selectedModelId,
          isCustomModel: true
        })
      }
    }

    throw new AIProviderRequestError({
      cause: normalizeStructuredOutputError(error, Boolean(options.output)),
      provider: 'custom',
      model: selectedModelId,
      isCustomModel: true
    })
  }
}

export function normalizeAIModelOptions(modelOptions: AIModelOption[] | undefined) {
  if (!Array.isArray(modelOptions)) {
    return [] as AIModelOption[]
  }

  return modelOptions
    .filter((item): item is AIModelOption => Boolean(item && typeof item === 'object'))
    .map(item => ({
      id: typeof item.id === 'string' ? item.id.trim() : '',
      label: typeof item.label === 'string' ? item.label.trim() : '',
      description: typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : undefined
    }))
    .filter(item => item.id && item.label)
}

export function getAIProviderMode(settings: AISettingsLike): AIProviderMode {
  return shouldUseLegacyUTools(settings) ? 'utools' : 'custom'
}

export function getStoredAIModelOptions(settings: AISettingsLike) {
  return settings.useCustomProvider ? settings.customModelOptions : []
}

export function getAIAvailability(settings: AISettingsLike) {
  if (!settings.enabled) {
    return { ok: false as const, reason: 'AI 助手尚未开启，请先到设置中打开' }
  }

  if (!shouldUseLegacyUTools(settings)) {
    if (!settings.customApiKey.trim()) {
      return { ok: false as const, reason: getApiKeyMissingMessage() }
    }

    if (!getSelectedCustomModelId(settings)) {
      return { ok: false as const, reason: '请先填写 API Key 并拉取模型列表' }
    }

    return { ok: true as const, provider: 'custom' as const }
  }

  const utools = getUToolsApi()
  if (!utools) {
    return { ok: false as const, reason: '当前不在 uTools 环境中运行，请配置 AI 服务' }
  }

  if (!isUToolsAiSupported() || typeof utools.ai !== 'function') {
    return { ok: false as const, reason: '请在 uTools 设置中开启 AI 功能' }
  }

  return { ok: true as const, provider: 'utools' as const }
}

export async function fetchCustomAIModels(config: {
  baseURL: string
  apiKey: string
  protocol?: AIProtocol
}) {
  const protocol: AIProtocol =
    config.protocol === 'anthropic' ||
    config.protocol === 'openai-compatible' ||
    config.protocol === 'openai-responses'
      ? config.protocol
      : 'openai-responses'
  const apiKey = config.apiKey.trim()
  const baseURL = resolveCustomBaseURL(protocol, config.baseURL)
  if (!apiKey) {
    throw new Error(getApiKeyMissingMessage())
  }

  // 模型列表接口最多等待 15 秒，防止错误地址永久挂起（含响应体读取阶段）
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const headers: Record<string, string> =
      protocol === 'anthropic'
        ? {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION
          }
        : {
            Authorization: `Bearer ${apiKey}`
          }

    const response = await fetch(getOpenAIModelsUrl(baseURL), {
      signal: controller.signal,
      headers
    })

    if (!response.ok) {
      const detail = await readErrorMessage(response)
      if (response.status === 401 || response.status === 403) {
        throw new Error(getAuthFailedMessage(getProtocolLabel(protocol)))
      }
      throw new Error(detail || `读取模型列表失败（${response.status}）`)
    }

    const payload = await response.json()
    const rawModels = Array.isArray(payload?.data) ? payload.data : []
    const models = rawModels
      .map((item: unknown) => normalizeModelOption(item))
      .filter((item: AIModelOption | null): item is AIModelOption => Boolean(item))

    if (!models.length) throw new Error('未读取到可用模型')

    return models
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('请求超时，请检查接口地址是否可达')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function runAIText(
  settings: AISettingsLike,
  messages: AIMessage[],
  options: RunAITextOptions = {}
) {
  const availability = getAIAvailability(settings)
  if (!availability.ok) {
    throw new Error(availability.reason)
  }

  if (availability.provider === 'custom') {
    return runCustomText(settings, messages, options)
  }

  if (options.output) {
    throw new Error('历史 uTools AI 不支持结构化输出，请切换到自定义 AI 服务')
  }

  return runUToolsText(settings, messages)
}


export function getDefaultAISettings() {
  const protocol: AIProtocol = 'openai-responses'
  return {
    enabled: true,
    allowLegacyUTools: false,
    selectedModelId: getDefaultModelId(protocol),
    useCustomProvider: true,
    protocol,
    customBaseURL: getDefaultBaseURL(protocol),
    customApiKey: '',
    customModelOptions: [] as AIModelOption[]
  }
}

/** 切换协议时的默认字段（BaseURL / 默认模型），供 settings store 使用 */
export function getProtocolDefaults(protocol: AIProtocol) {
  const meta = getProtocolMeta(protocol)
  return {
    protocol: meta.id,
    baseURL: meta.baseURL,
    defaultModel: meta.defaultModel
  }
}
