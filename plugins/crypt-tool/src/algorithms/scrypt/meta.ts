import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'scrypt',
  category: 'kdf',
  label: 'scrypt',
  title: 'scrypt 口令派生',
  reversible: false,
  cmds: ['scrypt'],
  defaultEnabled: true,
  teach: {
    summary:
      'scrypt 是内存困难型密钥派生函数，通过大量内存访问有效抵抗 GPU/ASIC 暴力破解，被 Tarsnap、多种加密货币（Litecoin、Dogecoin 等）采用。参数 N 控制成本，r 与 p 控制内存与并行。'
  }
}
