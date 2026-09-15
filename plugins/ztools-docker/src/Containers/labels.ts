// src/Containers/labels.ts — 容器 / compose 状态展示文案

export function stateLabel(s: string) {
  return s === 'running' ? '运行中' : s === 'paused' ? '已暂停' : '已停止'
}

// docker compose ls 的状态（如 "running(2)"、"exited(1)"、"stopped"）转中文
export function composeStatusLabel(status: string): string {
  const s = (status || '').trim()
  if (/^running/i.test(s)) return '运行中' + s.replace(/^running/i, '').trim()
  if (/^exited/i.test(s)) return '已停止' + s.replace(/^exited/i, '').trim()
  if (/^stopped/i.test(s)) return '已停止'
  if (/^paused/i.test(s)) return '已暂停'
  if (/^created/i.test(s)) return '已创建'
  return s
}
