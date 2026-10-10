import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'bcrypt',
  category: 'kdf',
  label: 'bcrypt',
  title: 'bcrypt 密码哈希',
  reversible: false,
  cmds: ['bcrypt', '密码哈希'],
  defaultEnabled: true,
  teach: {
    summary:
      'bcrypt 是专为密码存储设计的自适应哈希算法，内置随机盐与可调节计算成本（4-31），每增加 1 成本翻倍计算时间，天然抗 GPU/ASIC 暴力破解。支持哈希生成与密码验证两种模式。'
  }
}
