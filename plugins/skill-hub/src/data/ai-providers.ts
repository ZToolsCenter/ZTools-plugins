export interface AiProviderPreset {
  id: string
  name: string
  defaultBaseUrl: string
  defaultApiPath: string
  icon: string
  isBuiltin: boolean
  getKeyUrl?: string
}

export const BUILTIN_PROVIDERS: AiProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com', defaultApiPath: '/v1/chat/completions', icon: '⚡', isBuiltin: true, getKeyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'openai-responses', name: 'OpenAI Responses', defaultBaseUrl: 'https://api.openai.com', defaultApiPath: '/v1/responses', icon: '💬', isBuiltin: true, getKeyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', name: 'Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultApiPath: '/chat/completions', icon: '🔮', isBuiltin: true, getKeyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'claude', name: 'Claude', defaultBaseUrl: 'https://api.anthropic.com', defaultApiPath: '/v1/messages', icon: '🟣', isBuiltin: true, getKeyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'deepseek', name: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com', defaultApiPath: '/v1/chat/completions', icon: '🔵', isBuiltin: true, getKeyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'xai', name: 'xAI', defaultBaseUrl: 'https://api.x.ai', defaultApiPath: '/v1/chat/completions', icon: '✖️', isBuiltin: true, getKeyUrl: 'https://console.x.ai/' },
  { id: 'glm', name: 'GLM (智谱)', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas', defaultApiPath: '/v4/chat/completions', icon: '🟢', isBuiltin: true, getKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'siliconflow', name: 'SiliconFlow', defaultBaseUrl: 'https://api.siliconflow.cn', defaultApiPath: '/v1/chat/completions', icon: '🌐', isBuiltin: true, getKeyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'minimax', name: 'MiniMax', defaultBaseUrl: 'https://api.minimax.chat', defaultApiPath: '/v1/text/chatcompletion_v2', icon: '🤖', isBuiltin: true, getKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key' },
  { id: 'jina', name: 'Jina', defaultBaseUrl: 'https://api.jina.ai', defaultApiPath: '/v1/chat/completions', icon: '🔍', isBuiltin: true, getKeyUrl: 'https://jina.ai/settings/' },
  { id: 'cohere', name: 'Cohere', defaultBaseUrl: 'https://api.cohere.com', defaultApiPath: '/v2/chat', icon: '🔗', isBuiltin: true, getKeyUrl: 'https://dashboard.cohere.com/api-keys' },
  { id: 'voyage', name: 'Voyage', defaultBaseUrl: 'https://api.voyageai.com', defaultApiPath: '/v1/chat/completions', icon: '🧭', isBuiltin: true, getKeyUrl: 'https://dashboard.voyageai.com/settings/api-keys' },
]

export function getProviderInfo(id: string): AiProviderPreset | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id)
}
