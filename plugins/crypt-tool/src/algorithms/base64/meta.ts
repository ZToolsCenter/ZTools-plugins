import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'base64',
  category: 'encoding',
  label: 'Base64',
  title: 'Base64 编码',
  reversible: true,
  cmds: ['base64', 'Base64编码'],
  defaultEnabled: true,
  teach: {
    summary:
      'Base64 将二进制/文本按 6 bit 一组映射为 64 个可打印字符，常用于 URL、邮件与 JSON 中嵌入数据。编码可逆，解码还原为 UTF-8 文本。'
  }
}
