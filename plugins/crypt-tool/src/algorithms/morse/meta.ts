import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'morse',
  category: 'encoding',
  label: '摩尔斯电码',
  title: '摩尔斯电码编解码',
  reversible: true,
  cmds: ['morse', 'morse-code'],
  defaultEnabled: true,
  teach: {
    summary:
      '摩尔斯电码使用点（.）与划（-）表示字母、数字和标点，字符之间以分隔符区分。编码将文本转为摩尔斯码，解码将摩尔斯码还原为文本。'
  }
}
