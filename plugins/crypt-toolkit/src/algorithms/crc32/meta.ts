import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'crc32',
  category: 'tools',
  label: 'CRC32',
  title: 'CRC32 校验和',
  reversible: false,
  cmds: ['crc32'],
  defaultEnabled: true,
  teach: {
    summary:
      'CRC32 是最常用的循环冗余校验算法，被 ZIP、PNG、Ethernet、MPEG-2 等广泛采用。用于快速数据完整性校验（非加密安全）。标准多项式 0xEDB88320（ISO 3309 / ITU-T V.42）。'
  }
}
