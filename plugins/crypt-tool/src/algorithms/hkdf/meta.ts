import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'hkdf',
  category: 'kdf',
  label: 'HKDF',
  title: 'HKDF 密钥派生',
  reversible: false,
  cmds: ['hkdf'],
  defaultEnabled: true,
  teach: {
    summary:
      'HKDF（RFC 5869）是基于 HMAC 的标准密钥派生函数，两阶段抽取+扩展设计，适用于从共享密钥材料（如 ECDH 共享点）派生多个会话密钥。TLS 1.3、Signal 协议、WireGuard 等广泛采用。'
  }
}
