import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'xorStream',
  category: 'symmetric',
  label: 'XOR 流密码',
  title: 'XOR 流密码',
  reversible: true,
  cmds: ['xor', 'xor-stream', 'xor-cipher'],
  defaultEnabled: true,
  teach: {
    summary:
      'XOR 流密码将明文与密钥进行逐字节异或运算，输出为十六进制密文。加密与解密均为相同操作，需相同密钥。简单但仅用于教学演示，不适用于生产安全场景。'
  }
}
