import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'punycode',
  category: 'encoding',
  label: 'Punycode',
  title: 'Punycode 域名编码',
  reversible: true,
  cmds: ['punycode', 'idn'],
  defaultEnabled: true,
  teach: {
    summary:
      'Punycode 将 Unicode 域名转为 ASCII 兼容编码（ACE），实现国际化域名（IDN）。编码输出 punycode 前缀 xn-- 开头的 ASCII 域名，解码还原 Unicode 域名。'
  }
}
