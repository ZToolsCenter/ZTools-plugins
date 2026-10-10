import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'json',
  category: 'tools',
  label: 'JSON 格式化',
  title: 'JSON 格式化与压缩',
  reversible: false,
  cmds: ['json', 'json-format', 'json-format'],
  defaultEnabled: true,
  teach: {
    summary:
      'JSON 格式化工具为混乱的 JSON 文本添加缩进与换行，提高可读性；压缩则去除所有空白字符，得到最小化 JSON 字符串，适合传输与存储。'
  }
}
