// 页面级状态类型定义、常量和工厂函数

// 导航页面类型枚举
export type ActiveNav = 'store' | 'installed' | 'notifications' | 'upload' | 'account' | 'settings'
// 市场插件正在执行的操作类型
export type MarketBusyAction = 'download' | 'upgrade' | null
// 已安装插件正在执行的操作类型
export type InstalledBusyAction = 'upgrade' | 'stop' | 'uninstall' | null

import type {
  PluginCommentRecord,
  PluginRatingRecord,
  PluginRiskInfo,
} from '../../../types/pluginMarket'

// 插件评论分页大小
export const PLUGIN_COMMENTS_PAGE_SIZE = 20
// 通知分页大小
export const NOTIFICATIONS_PAGE_SIZE = 20

export interface PluginDetailState {
  detail: import('../../../types/pluginMarket').PluginDetailResponse | null
  risk: PluginRiskInfo | null
  riskLoading: boolean
  riskError: string
  selectedVersion: string | null
  selectedHash: string | null
  comments: PluginCommentRecord[]
  currentUserRating: PluginRatingRecord | null
  commentPage: number
  commentPageSize: number
  commentTotal: number
  commentLoading: boolean
  commentLoadingMore: boolean
  commentSubmitting: boolean
  ratingSubmitting: boolean
  commentError: string
  requestId: number
}

export interface NotificationState {
  items: import('../../../types/notification').NotificationRecord[]
  filter: import('../../../types/notification').NotificationFilter
  page: number
  pageSize: number
  total: number
  loading: boolean
  error: string
  selectedId: string | null
  selectedItem: import('../../../types/notification').NotificationRecord | null
  initialized: boolean
  markingAllRead: boolean
  requestId: number
}

// 创建空的插件详情状态
export function createEmptyPluginDetailState(): PluginDetailState {
  return {
    detail: null,
    risk: null,
    riskLoading: false,
    riskError: '',
    selectedVersion: null,
    selectedHash: null,
    comments: [],
    currentUserRating: null,
    commentPage: 1,
    commentPageSize: PLUGIN_COMMENTS_PAGE_SIZE,
    commentTotal: 0,
    commentLoading: false,
    commentLoadingMore: false,
    commentSubmitting: false,
    ratingSubmitting: false,
    commentError: '',
    requestId: 0,
  }
}

// 创建空的通知状态
export function createEmptyNotificationState(): NotificationState {
  return {
    items: [],
    filter: 'ALL',
    page: 1,
    pageSize: NOTIFICATIONS_PAGE_SIZE,
    total: 0,
    loading: false,
    error: '',
    selectedId: null,
    selectedItem: null,
    initialized: false,
    markingAllRead: false,
    requestId: 0,
  }
}
