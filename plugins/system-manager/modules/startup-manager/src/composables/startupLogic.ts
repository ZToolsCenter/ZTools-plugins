import type { StartupItem } from '../types/startup'

export interface Filters { query: string; scope: 'all' | 'user' | 'system'; state: 'all' | 'enabled' | 'disabled'; kind: 'all' | string }

export function filterItems(items: StartupItem[], filters: Filters): StartupItem[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return items.filter((item) => {
    if (filters.scope !== 'all' && item.scope !== filters.scope) return false
    if (filters.state === 'enabled' && item.enabled !== true) return false
    if (filters.state === 'disabled' && item.enabled !== false) return false
    if (filters.kind !== 'all' && item.kind !== filters.kind) return false
    if (!query) return true
    return [item.name, item.source.label, item.source.location, item.commandSummary, item.trigger]
      .some((value) => value?.toLocaleLowerCase().includes(query))
  })
}

export function summarize(items: StartupItem[]) {
  return {
    total: items.length,
    enabled: items.filter((item) => item.enabled === true).length,
    running: items.filter((item) => item.running === true).length,
    manageable: items.filter((item) => item.action.canToggle).length,
  }
}

export function kindLabel(kind: StartupItem['kind']): string {
  return ({
    'login-item': '登录项', 'launch-agent': 'Launch Agent', 'launch-daemon': 'Launch Daemon',
    'run-key': '注册表启动项', 'startup-folder': '启动文件夹', 'scheduled-task': '计划任务',
    service: '系统服务', 'desktop-autostart': '桌面自启动', 'systemd-unit': 'systemd 服务', cron: 'Cron 任务',
  } as Record<string, string>)[kind] || kind
}
