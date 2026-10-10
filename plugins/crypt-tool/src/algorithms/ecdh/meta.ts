import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'ecdh',
  category: 'asymmetric',
  label: 'ECDH',
  title: 'ECDH 密钥交换',
  reversible: false,
  cmds: ['ecdh', 'ecdh-key-exchange'],
  defaultEnabled: true,
  teach: {
    summary:
      'ECDH（椭圆曲线迪菲-赫尔曼）密钥交换允许双方在不安全信道上协商共享密钥。每方生成自己的椭圆曲线密钥对，交换公钥后各自独立计算出相同的共享密钥。'
  }
}
