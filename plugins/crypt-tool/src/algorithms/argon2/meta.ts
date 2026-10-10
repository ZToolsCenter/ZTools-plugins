import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'argon2',
  category: 'kdf',
  label: 'Argon2',
  title: 'Argon2 密码哈希',
  reversible: false,
  cmds: ['argon2'],
  defaultEnabled: false,
  teach: {
    summary:
      'Argon2 是 2015 年密码哈希竞赛冠军，argon2id 兼顾侧信道抗性与 GPU/ASIC 抗性。支持可调时间成本、内存成本与并行度，是目前推荐的首选密码存储算法（优于 bcrypt 与 PBKDF2）。'
  }
}
