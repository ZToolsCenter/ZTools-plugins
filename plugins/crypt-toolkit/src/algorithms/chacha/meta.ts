import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'chacha',
  category: 'symmetric',
  label: 'ChaCha20',
  title: 'ChaCha20-Poly1305 对称加密',
  reversible: true,
  cmds: ['chacha', 'chacha20', 'chacha20-poly1305'],
  defaultEnabled: true,
  teach: {
    summary:
      'ChaCha20-Poly1305 是现代流密码与 AEAD 认证加密组合，TLS 1.3、WireGuard、QUIC 等主流协议广泛采用。256 位密钥 + 96 位 Nonce，比 AES-GCM 在纯软件实现中更快且抗侧信道。'
  }
}
