import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'base58',
  category: 'encoding',
  label: 'Base58',
  title: 'Base58 / Base58check 编解码',
  reversible: true,
  cmds: ['base58', 'base58check'],
  defaultEnabled: true,
  teach: {
    summary:
      'Base58 是比特币地址和私钥使用的编码方案，在 Base64 基础上移除 0、O、I、l、+、/ 等易混淆字符。Base58check 在 Base58 基础上追加 4 字节双 SHA-256 校验和，防止手误导致地址无效。'
  }
}
