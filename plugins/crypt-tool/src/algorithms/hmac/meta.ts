import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'hmac',
  category: 'hmac',
  label: 'HMAC',
  title: 'HMAC-SHA256 消息认证',
  reversible: false,
  cmds: ['hmac', 'HMAC'],
  defaultEnabled: true,
  teach: {
    summary:
      'HMAC 将密钥与消息经哈希组合，既验证完整性也证明来自持钥方。默认 SHA-256，输出十六进制认证码；比对相同认证码可确认消息未被篡改。'
  }
}
