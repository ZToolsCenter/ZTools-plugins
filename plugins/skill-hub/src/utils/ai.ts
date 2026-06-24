import type { ModelConfig } from '../types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
}

export interface ChatResult {
  content: string
}

export interface ModelInfo {
  id: string
  name: string
  owned_by?: string
}

export interface FetchModelsResult {
  success: boolean
  models: ModelInfo[]
  error?: string
}

export async function chatCompletion(
  model: ModelConfig,
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<ChatResult> {
  const activeKey = model.apiKeys?.find(k => k.enabled)?.key
  if (!activeKey || !model.baseUrl || !model.apiPath || !model.model) {
    throw new Error('AI_NOT_CONFIGURED')
  }

  const endpoint = `${model.baseUrl.replace(/\/+$/, '')}${model.apiPath}`

  const body = {
    model: model.model,
    messages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.maxTokens ?? 8192,
    stream: false,
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${activeKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error('AI_AUTH_ERROR')
    }
    throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`)
  }

  let data: any
  try {
    data = await res.json()
  } catch {
    throw new Error('AI_INVALID_RESPONSE')
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('AI_EMPTY_RESPONSE')
  }

  return { content }
}

export async function fetchAvailableModels(
  baseUrl: string,
  apiKey: string,
): Promise<FetchModelsResult> {
  if (!apiKey || !baseUrl) {
    return { success: false, models: [], error: '请先填写 API Key 和 API 地址' }
  }

  try {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/models`
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const reason =
        res.status === 401 || res.status === 403
          ? 'auth'
          : res.status === 404 || res.status === 405
            ? 'unsupported'
            : 'http'
      return {
        success: false,
        models: [],
        error: `获取模型列表失败: ${res.status} - ${text.substring(0, 100)}`,
        reason,
      } as any
    }

    let data: any
    try {
      data = await res.json()
    } catch {
      return {
        success: false,
        models: [],
        error: `获取模型列表失败: 无效的 JSON 响应`,
        reason: 'http',
      } as any
    }

    if (data?.data && Array.isArray(data.data)) {
      const models = data.data
        .filter((m: any) => m.id)
        .map((m: any) => ({
          id: m.id,
          name: m.id,
          owned_by: m.owned_by,
        }))
        .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id))
      return { success: true, models }
    }

    if (data?.models && Array.isArray(data.models)) {
      const models = data.models
        .filter((m: any) => m.name)
        .map((m: any) => {
          const id = m.name.replace(/^models\//, '')
          return { id, name: m.displayName ? `${m.displayName} (${id})` : id, owned_by: 'Google' }
        })
        .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id))
      return { success: true, models }
    }

    if (Array.isArray(data)) {
      const models = data
        .filter((m: any) => m.id || m.model)
        .map((m: any) => ({ id: m.id || m.model || '', name: m.name || m.id || m.model }))
      return { success: true, models }
    }

    return { success: false, models: [], error: '无法解析模型列表响应' }
  } catch (err: any) {
    return { success: false, models: [], error: err.message || '获取模型列表失败' }
  }
}
