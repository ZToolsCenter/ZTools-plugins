import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'base32',
  category: 'encoding',
  label: 'Base32',
  title: 'Base32 编码',
  reversible: true,
  cmds: ['base32', 'b32'],
  defaultEnabled: true,
  teach: {
    summary:
      'Base32 将二进制数据按 5 bit 一组映射为 A-Z 与 2-7 共 32 个字符，适合人工抄录与不区分大小写的场景。默认使用 RFC 4648 标准，可选尾部 = 填充。'
  }
}
