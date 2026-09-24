import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'safeBase64',
  category: 'encoding',
  label: 'Safe Base64',
  title: 'URL 安全 Base64 编码',
  reversible: true,
  cmds: ['safe-base64', 'urlsafe-base64', 'base64url'],
  defaultEnabled: true,
  teach: {
    summary:
      'URL 安全 Base64 将标准 Base64 中的 + 替换为 / 替换为 _，避免在 URL/文件名中出现特殊字符。支持可选去除尾部 = 填充，适用于 JWT、URL 参数等场景。'
  }
}
