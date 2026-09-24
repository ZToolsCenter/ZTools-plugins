import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'sha384',
  category: 'hash',
  label: 'SHA-384',
  title: 'SHA-384 摘要',
  reversible: false,
  cmds: ['sha384', 'sha-384'],
  defaultEnabled: true,
  teach: {
    summary:
      'SHA-384 属 SHA-2 家族，产生 384 位（96 位十六进制）摘要。相比 SHA-512 做了截断，安全性高于 SHA-256，常用于数字证书与完整性校验。'
  }
}
