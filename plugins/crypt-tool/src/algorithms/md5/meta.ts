import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'md5',
  category: 'hash',
  label: 'MD5',
  title: 'MD5 摘要',
  reversible: false,
  cmds: ['md5', 'MD5'],
  defaultEnabled: true,
  teach: {
    summary:
      'MD5 产生 128 位（32 位十六进制）摘要，速度快但已不适合安全场景，常用于校验和与非安全场景指纹。不可逆。'
  }
}
