import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'sha1',
  category: 'hash',
  label: 'SHA-1',
  title: 'SHA-1 摘要',
  reversible: false,
  cmds: ['sha1', 'sha-1'],
  defaultEnabled: true,
  teach: {
    summary:
      'SHA-1 产生 160 位（40 位十六进制）摘要，仍广泛用于 Git 对象 ID 与旧版协议。因其抗碰撞性不足，已不建议用于安全场景，但作为校验与兼容性工具仍然实用。'
  }
}
