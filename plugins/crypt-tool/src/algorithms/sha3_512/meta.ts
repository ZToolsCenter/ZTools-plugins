import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'sha3_512',
  category: 'hash',
  label: 'SHA3-512',
  title: 'SHA3-512 摘要',
  reversible: false,
  cmds: ['sha3-512', 'sha3_512'],
  defaultEnabled: true,
  teach: {
    summary:
      'SHA3-512 属 SHA-3 家族（Keccak），产生 512 位（128 位十六进制）摘要。SHA-3 采用海绵结构，与 SHA-2 设计完全不同，作为后量子时代的备选哈希标准。'
  }
}
