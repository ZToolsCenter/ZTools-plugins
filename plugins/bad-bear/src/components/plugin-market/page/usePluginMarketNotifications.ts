import { computed, onUnmounted, ref, type Ref } from 'vue'
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotifications,
} from '../../../api/notifications'
import type { AuthUser } from '../../../types/auth'
import type {
  NotificationFilter,
  NotificationRecord,
  NotificationStreamEvent,
  NotificationTreeNode,
} from '../../../types/notification'
import type { ActiveNav, NotificationState } from './shared'
import {
  buildNotificationTree,
  createEmptyNotificationState,
  getErrorMessage,
} from './shared'

const NOTIFICATION_STREAM_RECONNECT_DELAY = 3000

export function usePluginMarketNotifications(options: {
  activeNav: Ref<ActiveNav>
  authToken: Ref<string>
  currentUser: Ref<AuthUser | null>
  goToAccount: () => void
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
}) {
  const notificationState = ref<NotificationState>(createEmptyNotificationState())
  const unreadNotificationTotal = ref(0)
  const readingNotificationIds = ref<string[]>([])
  const notificationTree = computed(() => buildNotificationTree(notificationState.value.items))

  let notificationStreamAbortController: AbortController | null = null
  let notificationStreamReconnectTimer: number | null = null
  let notificationStreamConnectPromise: Promise<void> | null = null
  let notificationStreamSessionId = 0
  let notificationRefreshPromise: Promise<void> | null = null
  let notificationRefreshQueued = false

  function setNotificationReadStateById(id: string): void {
    let unreadDelta = 0
    notificationState.value.items = notificationState.value.items.map((item) => {
      if (item.id !== id || item.status === 'READ') {
        return item
      }

      unreadDelta += 1
      const nextItem: NotificationRecord = {
        ...item,
        status: 'READ',
        readAt: item.readAt || new Date().toISOString(),
      }

      if (notificationState.value.selectedItem?.id === id) {
        notificationState.value.selectedItem = nextItem
      }

      return nextItem
    })

    if (unreadDelta > 0) {
      unreadNotificationTotal.value = Math.max(0, unreadNotificationTotal.value - unreadDelta)
    }
  }

  function markVisibleNotificationsRead(): void {
    let unreadDelta = 0
    notificationState.value.items = notificationState.value.items.map((item) => {
      if (item.status === 'READ') {
        return item
      }

      unreadDelta += 1
      const nextItem: NotificationRecord = {
        ...item,
        status: 'READ',
        readAt: item.readAt || new Date().toISOString(),
      }

      if (notificationState.value.selectedItem?.id === item.id) {
        notificationState.value.selectedItem = nextItem
      }

      return nextItem
    })

    if (unreadDelta > 0) {
      unreadNotificationTotal.value = Math.max(0, unreadNotificationTotal.value - unreadDelta)
    }
  }

  async function loadNotifications(optionsArg: {
    page?: number
    filter?: NotificationFilter
    force?: boolean
  } = {}): Promise<void> {
    if (!options.authToken.value || !options.currentUser.value) {
      notificationState.value = {
        ...createEmptyNotificationState(),
        filter: optionsArg.filter ?? notificationState.value.filter,
        page: optionsArg.page ?? 1,
        initialized: optionsArg.force ? false : notificationState.value.initialized,
      }
      unreadNotificationTotal.value = 0
      return
    }

    const nextFilter = optionsArg.filter ?? notificationState.value.filter
    const nextPage = optionsArg.page ?? notificationState.value.page
    const requestId = notificationState.value.requestId + 1

    notificationState.value = {
      ...notificationState.value,
      filter: nextFilter,
      page: nextPage,
      loading: true,
      error: '',
      requestId,
    }

    try {
      const response = await getNotifications({
        page: nextPage,
        pageSize: notificationState.value.pageSize,
        status: nextFilter === 'ALL' ? undefined : nextFilter,
      })

      if (notificationState.value.requestId !== requestId) {
        return
      }

      notificationState.value = {
        ...notificationState.value,
        items: response.items,
        total: response.total,
        page: response.page,
        pageSize: response.pageSize,
        loading: false,
        error: '',
        initialized: true,
      }

      if (notificationState.value.selectedId) {
        const matchedSelectedItem =
          response.items.find((item) => item.id === notificationState.value.selectedId) || null
        if (matchedSelectedItem) {
          notificationState.value.selectedItem = matchedSelectedItem
        } else {
          notificationState.value.selectedId = null
        }
      }
    } catch (error) {
      if (notificationState.value.requestId !== requestId) {
        return
      }

      notificationState.value = {
        ...notificationState.value,
        loading: false,
        error: getErrorMessage(error, '加载通知失败'),
        initialized: true,
      }
    }
  }

  async function refreshUnreadNotificationTotal(): Promise<void> {
    if (!options.authToken.value || !options.currentUser.value) {
      unreadNotificationTotal.value = 0
      return
    }

    try {
      const response = await getNotifications({
        page: 1,
        pageSize: 1,
        status: 'UNREAD',
      })
      unreadNotificationTotal.value = response.total
    } catch (error) {
      console.warn('[PluginMarket] 加载未读通知数失败:', error)
    }
  }

  async function markNotificationAsRead(notification: NotificationRecord): Promise<void> {
    if (!options.authToken.value || !options.currentUser.value || notification.status === 'READ') {
      return
    }

    if (readingNotificationIds.value.includes(notification.id)) {
      return
    }

    readingNotificationIds.value = [...readingNotificationIds.value, notification.id]

    try {
      await markNotificationRead(notification.id)
      setNotificationReadStateById(notification.id)
      await Promise.all([
        loadNotifications({
          page: notificationState.value.page,
          filter: notificationState.value.filter,
          force: true,
        }),
        refreshUnreadNotificationTotal(),
      ])
    } catch (error) {
      console.error('[PluginMarket] 标记通知已读失败:', error)
      options.notifyError(getErrorMessage(error, '标记通知已读失败'))
    } finally {
      readingNotificationIds.value = readingNotificationIds.value.filter((id) => id !== notification.id)
    }
  }

  function openNotification(notification: NotificationTreeNode): void {
    notificationState.value.selectedId = notification.id
    notificationState.value.selectedItem = { ...notification }

    if (notification.status === 'UNREAD') {
      void markNotificationAsRead(notification)
    }
  }

  function closeNotificationDetail(): void {
    notificationState.value.selectedId = null
    notificationState.value.selectedItem = null
  }

  async function handleMarkAllNotificationsRead(): Promise<void> {
    if (
      !options.authToken.value ||
      !options.currentUser.value ||
      unreadNotificationTotal.value === 0 ||
      notificationState.value.markingAllRead
    ) {
      return
    }

    notificationState.value.markingAllRead = true

    try {
      await markAllNotificationsRead()
      markVisibleNotificationsRead()
      options.notifySuccess('全部通知已标记为已读')
      await Promise.all([
        loadNotifications({
          page: notificationState.value.filter === 'UNREAD' ? 1 : notificationState.value.page,
          force: true,
        }),
        refreshUnreadNotificationTotal(),
      ])
    } catch (error) {
      console.error('[PluginMarket] 标记全部通知已读失败:', error)
      options.notifyError(getErrorMessage(error, '标记全部通知已读失败'))
    } finally {
      notificationState.value.markingAllRead = false
    }
  }

  function handleNotificationFilterChange(filter: NotificationFilter): void {
    notificationState.value.selectedId = null
    notificationState.value.selectedItem = null
    void loadNotifications({ page: 1, filter, force: true })
  }

  function handleNotificationPageChange(page: number): void {
    if (page < 1 || page === notificationState.value.page) {
      return
    }

    notificationState.value.selectedId = null
    notificationState.value.selectedItem = null
    void loadNotifications({ page, force: true })
  }

  async function handleRefreshNotifications(): Promise<void> {
    await Promise.all([loadNotifications({ force: true }), refreshUnreadNotificationTotal()])
  }

  async function refreshNotificationsFromStream(): Promise<void> {
    if (notificationRefreshPromise) {
      notificationRefreshQueued = true
      return
    }

    let refreshTask: Promise<void>
    refreshTask = (async () => {
      do {
        notificationRefreshQueued = false
        await handleRefreshNotifications()
      } while (notificationRefreshQueued)
    })()

    notificationRefreshPromise = refreshTask

    try {
      await refreshTask
    } finally {
      if (notificationRefreshPromise === refreshTask) {
        notificationRefreshPromise = null
      }
    }
  }

  function handleNotificationStreamEvent(event: NotificationStreamEvent): void {
    if (event.type === 'connected') {
      return
    }

    void refreshNotificationsFromStream()
  }

  function clearNotificationStreamReconnectTimer(): void {
    if (notificationStreamReconnectTimer !== null) {
      window.clearTimeout(notificationStreamReconnectTimer)
      notificationStreamReconnectTimer = null
    }
  }

  function stopNotificationStream(): void {
    notificationStreamSessionId += 1
    clearNotificationStreamReconnectTimer()
    notificationStreamConnectPromise = null

    if (notificationStreamAbortController) {
      notificationStreamAbortController.abort()
      notificationStreamAbortController = null
    }
  }

  function scheduleNotificationStreamReconnect(): void {
    if (
      notificationStreamReconnectTimer !== null ||
      !options.authToken.value ||
      !options.currentUser.value
    ) {
      return
    }

    notificationStreamReconnectTimer = window.setTimeout(() => {
      notificationStreamReconnectTimer = null
      startNotificationStream({ resync: true })
    }, NOTIFICATION_STREAM_RECONNECT_DELAY)
  }

  function startNotificationStream(optionsArg: { resync?: boolean } = {}): void {
    if (
      notificationStreamAbortController ||
      notificationStreamConnectPromise ||
      !options.authToken.value ||
      !options.currentUser.value
    ) {
      return
    }

    const sessionId = notificationStreamSessionId
    let connectTask: Promise<void>

    connectTask = (async () => {
      try {
        if (optionsArg.resync || !notificationState.value.initialized) {
          await handleRefreshNotifications()
        }

        if (
          sessionId !== notificationStreamSessionId ||
          !options.authToken.value ||
          !options.currentUser.value
        ) {
          return
        }

        clearNotificationStreamReconnectTimer()

        const controller = new AbortController()
        notificationStreamAbortController = controller

        try {
          await subscribeNotifications({
            signal: controller.signal,
            onEvent: handleNotificationStreamEvent,
          })
        } catch (error) {
          if (controller.signal.aborted || sessionId !== notificationStreamSessionId) {
            return
          }

          console.warn('[PluginMarket] 通知流连接失败:', error)
        } finally {
          if (notificationStreamAbortController === controller) {
            notificationStreamAbortController = null
          }

          if (!controller.signal.aborted && sessionId === notificationStreamSessionId) {
            scheduleNotificationStreamReconnect()
          }
        }
      } finally {
        if (notificationStreamConnectPromise === connectTask) {
          notificationStreamConnectPromise = null
        }
      }
    })()

    notificationStreamConnectPromise = connectTask
  }

  function syncNotificationStream(optionsArg: { resync?: boolean } = {}): void {
    if (!options.authToken.value || !options.currentUser.value) {
      stopNotificationStream()
      return
    }

    if (optionsArg.resync) {
      stopNotificationStream()
    }

    startNotificationStream(optionsArg)
  }

  async function refreshNotificationsAfterAuthChange(): Promise<void> {
    if (!options.authToken.value || !options.currentUser.value) {
      stopNotificationStream()
      notificationState.value = createEmptyNotificationState()
      unreadNotificationTotal.value = 0
      readingNotificationIds.value = []
      return
    }

    syncNotificationStream({ resync: true })
  }

  function handleGoToNotificationLogin(): void {
    options.goToAccount()
  }

  onUnmounted(() => {
    stopNotificationStream()
  })

  return {
    notificationState,
    unreadNotificationTotal,
    readingNotificationIds,
    notificationTree,
    loadNotifications,
    refreshUnreadNotificationTotal,
    handleRefreshNotifications,
    handleNotificationFilterChange,
    handleNotificationPageChange,
    openNotification,
    closeNotificationDetail,
    handleMarkAllNotificationsRead,
    handleGoToNotificationLogin,
    refreshNotificationsAfterAuthChange,
    syncNotificationStream,
    stopNotificationStream,
  }
}
