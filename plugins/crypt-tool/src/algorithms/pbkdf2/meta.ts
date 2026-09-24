import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'pbkdf2',
  category: 'kdf',
  label: 'PBKDF2',
  title: 'PBKDF2 口令派生',
  reversible: false,
  cmds: ['pbkdf2', '口令派生'],
  defaultEnabled: true,
  teach: {
    summary:
      'PBKDF2 通过多轮 HMAC 迭代将口令与随机盐派生为密钥，显著提高暴力破解成本。相同口令、盐与参数得到相同密钥；输出为十六进制。'
  }
}
