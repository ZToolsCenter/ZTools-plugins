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
  { id: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com', defaultApiPath: '/v1/chat/completions', icon: 'openai', isBuiltin: true, getKeyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', name: 'Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultApiPath: '/chat/completions', icon: 'google', isBuiltin: true, getKeyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'claude', name: 'Claude', defaultBaseUrl: 'https://api.anthropic.com', defaultApiPath: '/v1/messages', icon: 'anthropic', isBuiltin: true, getKeyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'deepseek', name: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com', defaultApiPath: '/v1/chat/completions', icon: 'deepseek', isBuiltin: true, getKeyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'xai', name: 'xAI', defaultBaseUrl: 'https://api.x.ai', defaultApiPath: '/v1/chat/completions', icon: 'grok', isBuiltin: true, getKeyUrl: 'https://console.x.ai/' },
  { id: 'glm', name: 'GLM (智谱)', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas', defaultApiPath: '/v4/chat/completions', icon: 'zhipu', isBuiltin: true, getKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'siliconflow', name: 'SiliconFlow', defaultBaseUrl: 'https://api.siliconflow.cn', defaultApiPath: '/v1/chat/completions', icon: 'silicon', isBuiltin: true, getKeyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'minimax', name: 'MiniMax', defaultBaseUrl: 'https://api.minimax.chat', defaultApiPath: '/v1/text/chatcompletion_v2', icon: 'minimax', isBuiltin: true, getKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key' },
]

export function getProviderInfo(id: string): AiProviderPreset | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id)
}


export const AVAILABLE_ICONS = [
  '302ai', '3min-top', 'abacus', 'ai-only', 'ai-studio', 'ai21', 'aihubmix', 'aionlabs',
  'alayanew', 'allenai', 'anthropic', 'application', 'arcee-ai', 'aws-bedrock', 'azureai',
  'baai', 'baichuan', 'baidu', 'baidu-cloud', 'bailian', 'bfl', 'bing', 'bocha',
  'bolt-new', 'burncloud', 'bytedance', 'cephalon', 'cerebras', 'cherryin', 'cloudflare',
  'inceptionlabs', 'infini', 'inflection', 'intel', 'internlm', 'jimeng', 'kling',
  'deepseek', 'devv', 'dify', 'dmxapi', 'doc2x', 'dola', 'dolphin-ai', 'doubao', 'duck',
  'elevenlabs', 'essential-ai', 'exa', 'felo', 'fireworks', 'flowith', 'genspark',
  'gitee-ai', 'github', 'github-copilot', 'glama', 'google', 'gpustack', 'graph-rag',
  'grok', 'groq', 'higress', 'huggingface', 'hyperbolic', 'ideogram', 'ima',
  'inceptionlabs', 'infini', 'inflection', 'intel', 'internlm', 'jimeng', 'kling',
  'kwaipilot', 'lambda', 'lanyun', 'lepton', 'lingxi', 'liquid', 'lmstudio', 'longcat',
  'macos', 'mcp', 'mcprouter', 'mcpso', 'meta', 'metaso', 'mineru', 'minimax',
  'minimax-agent', 'mistral', 'mixedbread', 'modelscope', 'monica', 'moonshot', 'n8n',
  'nami-ai', 'netease-youdao', 'newapi', 'nomic', 'notebooklm', 'nousresearch', 'nvidia',
  'o3', 'ocoolai', 'ollama', 'openai', 'openclaw', 'openrouter', 'paddleocr', 'perplexity',
  'ph8', 'poe', 'ppio', 'pulse', 'qiniu', 'querit', 'qwen', 'recraft', 'relace',
  'riverflow', 'runway', 'searxng', 'sensetime', 'silicon', 'skywork', 'smithery',
  'sophnet', 'stability', 'step', 'streamlake', 'suno', 'tavily', 'tencent-cloud-ti',
  'tesseract-js', 'think-any', 'tng', 'together', 'tokenflux', 'twitter', 'upstage',
  'vercel', 'vertexai', 'vidu', 'volcengine', 'wenxin', 'workers-ai', 'xiaoyi',
  'xinghuo', 'xirang', 'you', 'yuanbao', 'z-ai', 'zero-one', 'zhida', 'zhipu',
]
