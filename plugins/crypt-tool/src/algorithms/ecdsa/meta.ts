import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'ecdsa',
  category: 'asymmetric',
  label: 'ECDSA',
  title: 'ECDSA 签名与验证',
  reversible: false,
  cmds: ['ecdsa'],
  defaultEnabled: true,
  teach: {
    summary:
      'ECDSA 是椭圆曲线数字签名算法，基于不同椭圆曲线（P-256 / P-384 / P-521）提供数字签名与验证功能，广泛用于证书、区块链与身份认证。签名使用私钥，验证使用对应公钥。'
  }
}
