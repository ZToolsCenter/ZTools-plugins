import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'des',
  category: 'symmetric',
  label: '3DES',
  title: '3DES 对称加密',
  reversible: true,
  cmds: ['des', '3des', 'des3', 'des-ede3'],
  defaultEnabled: true,
  teach: {
    summary:
      '3DES（Triple DES）对每个数据块进行三次 DES 加密操作，密钥长度 24 字节（168 位有效安全强度约 112 位）。虽已不推荐用于新系统，但仍有大量存量系统使用。'
  }
}
