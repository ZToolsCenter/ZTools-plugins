import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'randomBytes',
  category: 'tools',
  label: 'Random Bytes',
  title: '随机字节生成器',
  reversible: false,
  cmds: ['random-bytes', 'random', 'randbytes'],
  defaultEnabled: true,
  teach: {
    summary:
      '使用密码学安全的伪随机数生成器（CSPRNG）产生指定长度的随机字节，支持 Hex、Base64、Base64URL 三种编码输出.适用于密钥生成、Token 创建、Nonce 值等场景.'
  }
}
