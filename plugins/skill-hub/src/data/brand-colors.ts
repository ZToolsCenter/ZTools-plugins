const BRAND_COLORS: Record<string, string> = {
  openai: '#10A37F',
  deepseek: '#4D6BFE',
  xai: '#000',
  anthropic: '#D97757',
  google: '#4285F4',
  minimax: '#F23F5D',
  silicon: '#6E29F6',
  siliconcloud: '#6E29F6',
  zhipu: '#3859FF',
  chatglm: '#3859FF',
  gemini: '#4285F4',
  claude: '#D97757',
  grok: '#000',
  perplexity: '#1B3A5C',
  together: '#B02D5E',
  fireworks: '#F97316',
  groq: '#F97316',
  mistral: '#FF6B6B',
  replicate: '#1B1B1B',
  huggingface: '#FBBF24',
  azure: '#0078D4',
  aws: '#FF9900',
  cloudflare: '#F38020',
  meta: '#1877F2',
  microsoft: '#00A4EF',
  nvidia: '#76B900',
  apple: '#555',
  github: '#24292F',
  ollama: '#000',
}

const DEFAULT_PALETTE = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
]

// export function getBrandColor(iconName: string): string {
//   if (BRAND_COLORS[iconName]) return BRAND_COLORS[iconName]
//   let hash = 0
//   for (let i = 0; i < iconName.length; i++) {
//     hash = iconName.charCodeAt(i) + ((hash << 5) - hash)
//   }
//   return DEFAULT_PALETTE[Math.abs(hash) % DEFAULT_PALETTE.length]
// }
