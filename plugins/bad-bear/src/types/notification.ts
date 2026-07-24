export type NotificationStatus = 'UNREAD' | 'READ'
export type NotificationFilter = 'ALL' | NotificationStatus

export interface NotificationListQuery {
  page?: number
  pageSize?: number
  status?: NotificationStatus
}

export interface NotificationRecord {
  id: string
  type: string
  status: NotificationStatus
  title: string
  message: string
  metadata: Record<string, unknown> | null
  parentId?: string | null
  createdAt: string
  readAt: string | null
}

export interface NotificationTreeNode extends NotificationRecord {
  replies: NotificationTreeNode[]
  depth: 0 | 1
}

export interface NotificationListResponse {
  items: NotificationRecord[]
  total: number
  page: number
  pageSize: number
}

export interface MarkAllNotificationsReadResponse {
  success?: boolean
  message?: string
}

export type NotificationStreamEventName =
  | 'connected'
  | 'notification.created'
  | 'notification.read'
  | 'notification.read-all'

export interface NotificationStreamConnectedPayload {
  message: string
}

export interface NotificationStreamReadPayload {
  id: string
  status: 'READ'
  readAt: string | null
}

export interface NotificationStreamReadAllPayload {
  updated: number
  readAt: string | null
}

export type NotificationStreamEvent =
  | {
      type: 'connected'
      id: string | null
      data: NotificationStreamConnectedPayload
    }
  | {
      type: 'notification.created'
      id: string | null
      data: NotificationRecord
    }
  | {
      type: 'notification.read'
      id: string | null
      data: NotificationStreamReadPayload
    }
  | {
      type: 'notification.read-all'
      id: string | null
      data: NotificationStreamReadAllPayload
    }
