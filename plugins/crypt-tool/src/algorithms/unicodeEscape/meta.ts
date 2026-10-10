import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'unicodeEscape',
  category: 'encoding',
  label: 'Unicode 转义',
  title: 'Unicode 转义编码',
  reversible: true,
  cmds: ['unicode-escape', 'unicode'],
  defaultEnabled: true,
  teach: {
    summary:
      'Unicode 转义将非 ASCII 字符编码为 \\uXXXX 形式（如 \\u4e2d），常用于 JSON、JS/源码字符串中。编码后可逆，解码还原原始字符。'
  }
}
