import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'jwt',
  category: 'tools',
  label: 'JWT 解码',
  title: 'JWT 解码工具',
  reversible: false,
  cmds: ['jwt', 'jwt-decode'],
  defaultEnabled: true,
  teach: {
    summary:
      'JWT（JSON Web Token）解码工具将三段式 Token（header.payload.signature）解析为可读 JSON 结构。仅做解码展示，不验证签名有效性。'
  }
}
