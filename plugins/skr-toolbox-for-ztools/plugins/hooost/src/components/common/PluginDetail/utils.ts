import type { PluginCommand } from './types'

export function cmdKey(cmd: PluginCommand | string): string {
  if (typeof cmd === 'string') return cmd
  return cmd.label || cmd.text || cmd.name || ''
}

export function normalizeCommand(cmd: PluginCommand | string): PluginCommand {
  if (typeof cmd === 'string') {
    return {
      text: cmd,
      type: 'text',
    }
  }

  return {
    ...cmd,
    name: cmd.label || cmd.name,
    text: cmd.text || cmd.label || cmd.name,
    type: cmd.type || 'text',
  }
}

export function formatJsonData(data: unknown): string {
  if (!data) return ''

  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return ''

  try {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return dateStr
  }
}
