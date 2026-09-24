import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'sha3_256',
  category: 'hash',
  label: 'SHA3-256',
  title: 'SHA3-256 摘要',
  reversible: false,
  cmds: ['sha3', 'sha3-256', 'sha3_256'],
  defaultEnabled: true,
  teach: {
    summary:
      'SHA3-256 属 SHA-3 家族（Keccak），产生 256 位（64 位十六进制）摘要。基于海绵构造而非 Merkle-Damgård，结构上与 SHA-2 完全不同，是新标准的哈希算法。'
  }
}
