import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'hex',
  category: 'encoding',
  label: 'Hex',
  title: 'Hex 编码',
  reversible: true,
  cmds: ['hex', 'Hex编码'],
  defaultEnabled: true,
  teach: {
    summary:
      'Hex（十六进制）用 0-9a-f 每两个字符表示一个字节，便于查看与比对二进制内容。可逆：解码将偶数位 Hex 还原为 UTF-8 文本。'
  }
}
