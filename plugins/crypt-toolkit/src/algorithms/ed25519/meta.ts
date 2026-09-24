import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'ed25519',
  category: 'asymmetric',
  label: 'Ed25519',
  title: 'Ed25519 数字签名',
  reversible: false,
  cmds: ['ed25519', 'eddsa'],
  defaultEnabled: true,
  teach: {
    summary:
      'Ed25519 是基于 Edwards 曲线 Ed25519 的 EdDSA 签名算法，密钥短（32 字节私钥 / 32 字节公钥）、速度快、抗侧信道，被 OpenSSH、TLS 1.3、Signal Protocol 等广泛采用。'
  }
}
