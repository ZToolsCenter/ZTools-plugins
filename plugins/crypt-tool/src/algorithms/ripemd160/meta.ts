import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'ripemd160',
  category: 'hash',
  label: 'RIPEMD-160',
  title: 'RIPEMD-160 摘要',
  reversible: false,
  cmds: ['ripemd160', 'ripemd-160', 'rmd160'],
  defaultEnabled: true,
  teach: {
    summary:
      'RIPEMD-160 产生 160 位（40 位十六进制）摘要，常用于比特币地址生成。相比 MD5/SHA-1 有更强抗碰撞性，但已不推荐在新系统中使用。'
  }
}
