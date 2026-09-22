import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'aes',
  category: 'symmetric',
  label: 'AES',
  title: 'AES 对称加密',
  reversible: true,
  cmds: ['aes加密', 'AES'],
  defaultEnabled: true,
  teach: {
    summary:
      'AES 是分组对称加密标准，加密与解密使用同一密钥。支持 128/192/256 位密钥；常见模式 CBC、GCM。IV 用于保证相同明文每次产出不同密文，GCM 额外提供完整性校验。'
  }
}
