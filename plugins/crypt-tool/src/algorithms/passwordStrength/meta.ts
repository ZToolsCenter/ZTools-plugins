import type { AlgorithmMeta } from '../../registry/types'

export const meta: AlgorithmMeta = {
  id: 'passwordStrength',
  category: 'tools',
  label: '密码强度',
  title: '密码强度分析',
  reversible: false,
  cmds: ['password-strength', 'passwd-strength', 'pw-strength'],
  defaultEnabled: true,
  teach: {
    summary:
      '密码强度分析工具综合评估密码长度、字符种类（大写、小写、数字、符号）等因素，给出强度评分与标签（强/中/弱），辅助密码策略制定。'
  }
}
