import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'rsa',
  category: 'asymmetric',
  label: 'RSA',
  title: 'RSA 非对称加密',
  reversible: true,
  cmds: ['rsa加密', 'RSA'],
  defaultEnabled: true,
  teach: {
    summary:
      'RSA 基于大数分解难题，公钥加密、私钥解密。本工具使用 2048 位密钥与 OAEP 填充。密钥为 PEM 文本；先生成密钥对，公钥加密、私钥解密。'
  }
}
