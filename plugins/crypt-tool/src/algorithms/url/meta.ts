import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'url',
  category: 'encoding',
  label: 'URL',
  title: 'URL 编码',
  reversible: true,
  cmds: ['url编码', 'urlencode'],
  defaultEnabled: true,
  teach: {
    summary:
      'URL 编码（百分号编码）将保留字符与非 ASCII 转为 %XX 序列，用于查询参数与路径安全传输。可逆解码还原原文。'
  }
}
