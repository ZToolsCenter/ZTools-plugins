import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'sha512',
  category: 'hash',
  label: 'SHA-512',
  title: 'SHA-512 摘要',
  reversible: false,
  cmds: ['sha512', 'sha-512'],
  defaultEnabled: true,
  teach: {
    summary:
      'SHA-512 属 SHA-2 家族，产生 512 位（128 位十六进制）摘要，安全强度高于 SHA-256，适合用于完整性校验、证书签名与高强度散列场景。64 位平台运算效率通常优于 SHA-256。'
  }
}
