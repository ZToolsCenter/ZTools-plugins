import type { NormalizedReport } from '../types/report'

const STATUS_LABEL = {
  healthy: '正常',
  warning: '需关注',
  error: '失败',
  unavailable: '不适用',
  checking: '检查中',
  neutral: '已记录',
} as const

export function reportToMarkdown(report: NormalizedReport): string {
  const lines = [
    '# 系统诊断记录单',
    '',
    `- 生成时间：${escapeMarkdown(formatReportDate(report.generatedAt))}`,
    `- 总体结论：${STATUS_LABEL[report.overallStatus]}`,
    '- 隐私模式：安全（敏感标识已最小化）',
    '',
    '## 诊断建议',
    '',
  ]

  report.recommendations.forEach((item) => {
    lines.push(`- **${escapeMarkdown(item.title)}**：${escapeMarkdown(item.detail)}`)
  })

  report.groups.forEach((group) => {
    lines.push('', `## ${escapeMarkdown(group.title)}`, '', `状态：${STATUS_LABEL[group.status]}`, '')
    lines.push('| 项目 | 结果 | 状态 |', '| --- | --- | --- |')
    group.fields.forEach((field) => {
      lines.push(`| ${escapeMarkdown(field.label)} | ${escapeMarkdown(field.value)} | ${STATUS_LABEL[field.status]} |`)
    })
  })

  if (report.warnings.length) {
    lines.push('', '## 采集提示', '', ...report.warnings.map((message) => `- ${escapeMarkdown(message)}`))
  }
  if (report.errors.length) {
    lines.push('', '## 采集失败项', '', ...report.errors.map((message) => `- ${escapeMarkdown(message)}`))
  }
  lines.push('', '> 本报告由本地系统诊断生成；默认不包含用户名、序列号、网络地址与完整文件路径。', '')
  return lines.join('\n')
}

export function reportToJson(report: NormalizedReport): string {
  return JSON.stringify(report.raw, null, 2)
}

export function formatReportDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export function escapeMarkdown(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([`*_[\]{}()#+|~])/g, '\\$1')
    .replace(/\r\n?|\n/g, '<br>')
}
