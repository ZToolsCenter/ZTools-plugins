// 兼容性导出桶 - 从专注模块重新导出以保持向后兼容性
// 同时允许逐步迁移到直接导入

// 状态类型和工厂函数
export type {
  ActiveNav,
  MarketBusyAction,
  InstalledBusyAction,
  PluginDetailState,
  NotificationState,
} from './state'
export {
  createEmptyPluginDetailState,
  createEmptyNotificationState,
  PLUGIN_COMMENTS_PAGE_SIZE,
  NOTIFICATIONS_PAGE_SIZE,
} from './state'

// 插件列表和已安装状态辅助函数
export {
  isPluginVisibleOnPlatform,
  toInstalledMap,
  toUiPlugin,
  buildInstalledViewPlugins,
  resolvePluginList,
} from './plugin-list'

// 插件详情解析辅助函数
export {
  mergePluginDetailIntoPlugin,
  parsePluginSourceReference,
  mapPluginSourceLabel,
  buildCurrentPluginDownloadTarget,
} from './plugin-detail'

// 评论树辅助函数
export {
  flattenCommentRecords,
  buildCommentTree,
} from './comments'

// 通知树辅助函数
export {
  resolveNotificationParentId,
  findNotificationRootId,
  toTimestamp,
  buildNotificationTree,
} from './notifications'

// 验证辅助函数
export {
  validateUsername,
  validatePassword,
  validateRegisterPayload,
  validateLoginPayload,
  validateAvatarFile,
  ACCOUNT_PATTERN,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  MAX_AVATAR_SIZE,
  ALLOWED_AVATAR_TYPES,
} from './validation'

// 错误处理辅助函数
export {
  getErrorMessage,
  isPluginHostPermissionDeniedError,
} from './errors'
