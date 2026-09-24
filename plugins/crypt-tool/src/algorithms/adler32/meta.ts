import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'adler32',
  category: 'tools',
  label: 'Adler-32',
  title: 'Adler-32 校验和',
  reversible: false,
  cmds: ['adler32', 'adler-32'],
  defaultEnabled: true,
  teach: {
    summary:
      'Adler-32 是 zlib 使用的快速校验和算法，输出 32 位（8 位十六进制）。比 CRC32 更快但可靠性稍低，适用于压缩数据完整性校验，不适合用于安全场景。'
  }
}
