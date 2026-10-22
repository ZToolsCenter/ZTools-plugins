import type { WhyInfo } from '../env'

const SOURCE_LABELS: Record<string, string> = {
  windows_service: 'Windows 服务',
  shell: '交互式 Shell',
  init: '系统进程',
  cron: '计划任务',
  container: '容器',
  supervisor: '守护进程',
  ssh: 'SSH 会话'
}

const STATE_LABELS: Record<string, string> = {
  listen: '监听中',
  listening: '监听中',
  established: '已连接',
  synsent: '连接中',
  synreceived: '连接中',
  finwait1: '关闭中',
  finwait2: '关闭中',
  timewait: '等待关闭',
  closewait: '等待关闭',
  lastack: '关闭中',
  closing: '关闭中',
  closed: '已关闭',
  bound: '已绑定',
  deletetcb: '已释放'
}

/** 进程来源的中文描述，如 `explorer.exe（交互式 Shell）`。 */
export function sourceLabel(why?: WhyInfo): string {
  if (!why || !why.source) return ''
  const name = why.source.name || ''
  const type = why.source.type || 'unknown'
  if (type === 'unknown') return name
  const label = SOURCE_LABELS[type] || type
  return name ? name + '（' + label + '）' : label
}

const NON_ALPHA = /[^a-z]/g

/** TCP/UDP 状态的中文描述；未知状态保留原值。 */
export function stateLabel(state: string): string {
  const key = (state || '').toLowerCase().replace(NON_ALPHA, '')
  return STATE_LABELS[key] || state || ''
}
