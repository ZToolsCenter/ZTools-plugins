import { requestJson } from './httpClient'
import { getShopApiRuntimeConfig } from '../config/runtimeConfig'
import type {
  MarkAllNotificationsReadResponse,
  NotificationListQuery,
  NotificationListResponse,
  NotificationRecord,
  NotificationStreamConnectedPayload,
  NotificationStreamEvent,
  NotificationStreamEventName,
  NotificationStreamReadAllPayload,
  NotificationStreamReadPayload,
} from '../types/notification'

export function buildNotificationListQuery(query?: NotificationListQuery): string {
  const searchParams = new URLSearchParams()

  if (typeof query?.page === 'number') {
    searchParams.set('page', String(query.page))
  }

  if (typeof query?.pageSize === 'number') {
    searchParams.set('pageSize', String(query.pageSize))
  }

  if (query?.status) {
    searchParams.set('status', query.status)
  }

  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

export function getNotifications(
  query?: NotificationListQuery,
): Promise<NotificationListResponse> {
  return requestJson<NotificationListResponse>({
    path: `/api/v1/notifications${buildNotificationListQuery(query)}`,
  })
}

export async function markNotificationRead(id: string): Promise<void> {
  await requestJson<unknown>({
    path: `/api/v1/notifications/${encodeURIComponent(id)}/read`,
    method: 'PATCH',
  })
}

export function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResponse | null> {
  return requestJson<MarkAllNotificationsReadResponse | null>({
    path: '/api/v1/notifications/read-all',
    method: 'PATCH',
  })
}

const NOTIFICATION_STREAM_PATH = '/api/v1/notifications/stream'
const STREAM_ACCEPT_HEADER = 'text/event-stream'

function buildNotificationStreamUrl(): string {
  const { baseUrl } = getShopApiRuntimeConfig()
  return `${baseUrl}${NOTIFICATION_STREAM_PATH}`
}

function parseNotificationStreamPayload<TPayload>(payload: string): TPayload | null {
  const trimmed = payload.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as TPayload
  } catch {
    return null
  }
}

function toNotificationStreamEvent(
  type: NotificationStreamEventName,
  id: string | null,
  data: string,
): NotificationStreamEvent | null {
  switch (type) {
    case 'connected': {
      const parsed = parseNotificationStreamPayload<NotificationStreamConnectedPayload>(data)
      return parsed ? { type, id, data: parsed } : null
    }
    case 'notification.created': {
      const parsed = parseNotificationStreamPayload<NotificationRecord>(data)
      return parsed ? { type, id, data: parsed } : null
    }
    case 'notification.read': {
      const parsed = parseNotificationStreamPayload<NotificationStreamReadPayload>(data)
      return parsed ? { type, id, data: parsed } : null
    }
    case 'notification.read-all': {
      const parsed = parseNotificationStreamPayload<NotificationStreamReadAllPayload>(data)
      return parsed ? { type, id, data: parsed } : null
    }
    default:
      return null
  }
}

function parseNotificationStreamChunk(chunk: string): NotificationStreamEvent[] {
  return chunk
    .split(/\r?\n\r?\n/)
    .map((frame) => frame.trim())
    .filter(Boolean)
    .flatMap((frame) => {
      const lines = frame.split(/\r?\n/)
      let eventType: NotificationStreamEventName = 'connected'
      let eventId: string | null = null
      const dataLines: string[] = []

      lines.forEach((line) => {
        if (!line || line.startsWith(':')) {
          return
        }

        if (line.startsWith('event:')) {
          const value = line.slice('event:'.length).trim() as NotificationStreamEventName
          eventType = value
          return
        }

        if (line.startsWith('id:')) {
          eventId = line.slice('id:'.length).trim() || null
          return
        }

        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart())
        }
      })

      const event = toNotificationStreamEvent(eventType, eventId, dataLines.join('\n'))
      return event ? [event] : []
    })
}

export async function subscribeNotifications(options: {
  signal: AbortSignal
  onEvent: (event: NotificationStreamEvent) => void
}): Promise<void> {
  const { token } = getShopApiRuntimeConfig()
  const headers = new Headers({
    Accept: STREAM_ACCEPT_HEADER,
    'Cache-Control': 'no-cache',
  })

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(buildNotificationStreamUrl(), {
    method: 'GET',
    headers,
    signal: options.signal,
  })

  if (!response.ok) {
    throw new Error(`通知流连接失败 (${response.status})`)
  }

  if (!response.body) {
    throw new Error('通知流不可用')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() || ''

      frames.forEach((frame) => {
        parseNotificationStreamChunk(frame).forEach((event) => {
          options.onEvent(event)
        })
      })
    }

    buffer += decoder.decode()
    if (buffer.trim()) {
      parseNotificationStreamChunk(buffer).forEach((event) => {
        options.onEvent(event)
      })
    }
  } finally {
    reader.releaseLock()
  }
}
