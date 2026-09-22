import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'sha256',
  category: 'hash',
  label: 'SHA-256',
  title: 'SHA-256 摘要',
  reversible: false,
  cmds: ['sha256', 'sha-256'],
  defaultEnabled: true,
  teach: {
    summary:
      'SHA-256 属 SHA-2 家族，产生 256 位（64 位十六进制）摘要，广泛用于证书、完整性校验与区块链。不可逆，抗碰撞性强于 MD5。'
  }
}
