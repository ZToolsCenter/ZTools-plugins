import type { HistoryItem, ParsedCurlRequest } from './curl/types'

const HISTORY_KEY = 'curl-tool-history'

export function loadHistory(): HistoryItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as HistoryItem[]
    return normalizeHistory(parsed)
  } catch {
    return []
  }
}

export function saveHistory(history: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(normalizeHistory(history).slice(0, 200)))
}

export function makeHistoryItem(request: ParsedCurlRequest): HistoryItem {
  const now = Date.now()
  return {
    id: `${now}:${Math.random().toString(36).slice(2, 8)}`,
    title: request.baseUrl || request.url,
    method: request.method,
    url: buildFullUrl(request),
    subtitle: formatRelativeDay(now),
    command: request.rawCommand,
    createdAt: now
  }
}

export function normalizeHistory(history: HistoryItem[]) {
  return history
    .filter((item) => item && item.id && item.url)
    .map((item) => ({ ...item, subtitle: formatRelativeDay(item.createdAt) }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function formatRelativeDay(value: number) {
  const target = new Date(value)
  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const diff = Math.round((startOfToday - startOfTarget) / dayMs)
  const time = target.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (diff === 0) return `今天 ${time}`
  if (diff === 1) return `昨天 ${time}`
  if (diff === 2) return `前天 ${time}`
  return '更早'
}

function buildFullUrl(request: ParsedCurlRequest) {
  try {
    const url = new URL(request.baseUrl || request.url)
    request.queryParams.filter((item) => item.enabled && item.key).forEach((item) => url.searchParams.set(item.key, item.value))
    return url.toString()
  } catch {
    return request.baseUrl || request.url
  }
}
