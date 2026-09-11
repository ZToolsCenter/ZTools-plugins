/** OpenAI 系列协议默认模型（用户拉取列表前的占位） */
export const DEFAULT_AI_MODEL = 'gpt-4o-mini'

/** Anthropic（A 社）默认模型 */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'

/** 接入协议：OpenAI Responses / OpenAI-compatible Chat Completions / Anthropic */
export type AIProtocol = 'openai-responses' | 'openai-compatible' | 'anthropic'

export interface AIProtocolMeta {
  id: AIProtocol
  label: string
  /** 默认 Base URL */
  baseURL: string
  /** 列表中展示的简短说明 */
  hint: string
  defaultModel: string
}

/**
 * 支持的 AI 协议。
 * - openai-responses：OpenAI Responses API
 * - openai-compatible：兼容 OpenAI Chat Completions 的服务
 * - anthropic：Anthropic 原生 Messages 协议
 */
export const AI_PROTOCOLS: AIProtocolMeta[] = [
  {
    id: 'openai-responses',
    label: 'OpenAI Responses',
    baseURL: 'https://api.openai.com/v1',
    hint: 'OpenAI 官方新协议',
    defaultModel: DEFAULT_AI_MODEL
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI 兼容',
    baseURL: 'https://api.openai.com/v1',
    hint: 'Chat Completions，兼容多数模型与中转服务',
    defaultModel: DEFAULT_AI_MODEL
  },
  {
    id: 'anthropic',
    label: 'Anthropic 原生',
    baseURL: 'https://api.anthropic.com/v1',
    hint: 'Claude 原生协议',
    defaultModel: DEFAULT_ANTHROPIC_MODEL
  }
]

export function getProtocolMeta(protocol: AIProtocol): AIProtocolMeta {
  return AI_PROTOCOLS.find((p) => p.id === protocol) ?? AI_PROTOCOLS[0]
}

export function isAIProtocol(value: unknown): value is AIProtocol {
  return value === 'openai-responses' || value === 'openai-compatible' || value === 'anthropic'
}

/**
 * 从历史 Base URL 推断协议（迁移用）。
 * 含 anthropic 主机名时迁移到 Anthropic，其余迁移到 OpenAI 官方。
 */
export function resolveProtocolByBaseURL(baseURL: string): AIProtocol {
  const normalized = (baseURL || '').trim().toLowerCase()
  if (normalized.includes('anthropic.com') || normalized.includes('/anthropic')) {
    return 'anthropic'
  }
  return 'openai-compatible'
}
