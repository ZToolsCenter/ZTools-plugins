import { DEFAULT_AI_MODEL } from '@/constants/ai'
import { AIProviderRequestError } from '@/lib/aiProvider'

export type AggressiveAiSaveErrorCode =
  | 'invalid_url'
  | 'ai_unavailable'
  | 'no_groups'
  | 'ai_failed'
  | 'save_failed'

export type AggressiveAiSaveFailure = {
  code: AggressiveAiSaveErrorCode
  message: string
  detail: string
  recovery: string
}

export class AggressiveAiSaveError extends Error {
  code: AggressiveAiSaveErrorCode
  detail: string
  recovery: string

  constructor(
    code: AggressiveAiSaveErrorCode,
    message: string,
    options: { detail?: string; recovery?: string } = {}
  ) {
    super(message)
    this.name = 'AggressiveAiSaveError'
    this.code = code
    this.detail = options.detail?.trim() || message
    this.recovery = options.recovery?.trim() || '请检查后重试。'
  }

  toFailure(): AggressiveAiSaveFailure {
    return {
      code: this.code,
      message: this.message,
      detail: this.detail,
      recovery: this.recovery
    }
  }
}

function sanitizeDiagnostic(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || '')
  return raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ••••')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-••••')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

export function describeAggressiveAiSaveProviderError(
  error: unknown,
  context: { model?: string; isCustomModel?: boolean } = {}
): AggressiveAiSaveError {
  const providerError = error instanceof AIProviderRequestError ? error : null
  const cause = providerError?.cause ?? error
  const diagnostic = sanitizeDiagnostic(cause) || 'AI 服务未返回可识别的错误原因。'
  const lower = diagnostic.toLowerCase()
  const model = providerError?.model || context.model || DEFAULT_AI_MODEL
  const isCustom = providerError?.isCustomModel ?? context.isCustomModel ?? true

  if (
    /\b40[13]\b/.test(lower) ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('api key') ||
    lower.includes('apikey') ||
    lower.includes('鉴权') ||
    lower.includes('认证失败')
  ) {
    return new AggressiveAiSaveError('ai_failed', 'AI 服务鉴权失败', {
      detail: 'API Key 无效，或当前账号没有访问该模型的权限。',
      recovery: '请检查 API Key、接口协议和 Base URL，确认后重试。'
    })
  }

  if (
    /\b429\b/.test(lower) ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('限流')
  ) {
    return new AggressiveAiSaveError('ai_failed', 'AI 请求受到限制', {
      detail: diagnostic,
      recovery: '请检查供应商额度和限流规则，或稍后重试。'
    })
  }

  if (
    lower.includes('余额') ||
    lower.includes('balance') ||
    lower.includes('quota') ||
    lower.includes('credit')
  ) {
    return new AggressiveAiSaveError('ai_failed', 'AI 服务额度不足', {
      detail: diagnostic,
      recovery: '请检查当前供应商的余额或配额，补充后重试。'
    })
  }

  if (
    lower.includes('json schema') ||
    lower.includes('json_schema') ||
    lower.includes('structured output') ||
    lower.includes('response format') ||
    lower.includes('no object generated') ||
    lower.includes('结构化输出') ||
    lower.includes('返回格式')
  ) {
    return new AggressiveAiSaveError('ai_failed', 'AI 返回内容格式不正确', {
      detail: 'AI 已响应，但内容无法解析为标题、简介和分组。',
      recovery: '请重试；如果持续失败，再尝试切换模型或接口协议。'
    })
  }

  if (
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('fetch failed') ||
    lower.includes('cors') ||
    lower.includes('连接') ||
    lower.includes('超时')
  ) {
    return new AggressiveAiSaveError('ai_failed', '无法连接 AI 服务', {
      detail: diagnostic,
      recovery: '请检查 Base URL、网络或接口跨域配置后重试。'
    })
  }

  if (
    lower.includes('model') ||
    lower.includes('模型') ||
    lower.includes('not found') ||
    lower.includes('unknown model') ||
    lower.includes('unsupported model')
  ) {
    return new AggressiveAiSaveError('ai_failed', `模型“${model}”不可用`, {
      detail: isCustom ? diagnostic : `当前供应商无法使用模型“${model}”。`,
      recovery: '请检查模型名称，或在 AI 设置中重新选择模型。'
    })
  }

  return new AggressiveAiSaveError('ai_failed', 'AI 快速保存失败', {
    detail: diagnostic,
    recovery: '请检查 AI 设置后重试；如果持续失败，可根据上面的原因检查供应商日志。'
  })
}
