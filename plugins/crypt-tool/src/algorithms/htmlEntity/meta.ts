import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'htmlEntity',
  category: 'encoding',
  label: 'HTML 实体',
  title: 'HTML 实体编码',
  reversible: true,
  cmds: ['html-entity', 'html entity', 'htmle'],
  defaultEnabled: true,
  teach: {
    summary:
      'HTML 实体将特殊字符编码为实体形式，如 \\< 变为 &lt;、中文变为 &#x4E2D;。可选择优先使用命名实体，解码时还原原始字符。'
  }
}
