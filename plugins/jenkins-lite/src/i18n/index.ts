/**
 * 国际化支持
 * 当前支持简体中文和英文
 */

export type Locale = 'zh-CN' | 'en-US'

export interface LocaleMessages {
  [key: string]: string
}

const messages: Record<Locale, LocaleMessages> = {
  'zh-CN': {
    // 通用
    'app.name': 'Jenkins Lite',
    'app.version': 'v1.0.0',

    // 侧边栏
    'sidebar.views': '视图',
    'sidebar.favorites': '收藏',
    'sidebar.all': '全部',
    'sidebar.noFavorites': '暂无收藏',
    'sidebar.loading': '加载中...',

    // 搜索
    'search.placeholder': '搜索 Jobs...',

    // 构建历史
    'history.title': '构建历史',
    'history.selectJob': '选择一个 Job 查看构建历史',
    'history.noBuilds': '暂无构建记录',
    'history.start': '开始',
    'history.end': '结束',
    'history.duration': '耗时',
    'history.running': '运行中...',

    // 构建状态
    'status.success': '成功',
    'status.failure': '失败',
    'status.unstable': '不稳定',
    'status.aborted': '中止',
    'status.building': '运行中',
    'status.disabled': '禁用',
    'status.notbuilt': '未构建',

    // 操作
    'action.addFavorite': '添加收藏',
    'action.removeFavorite': '取消收藏',
    'action.triggerBuild': '触发构建',
    'action.confirm': '确认',
    'action.cancel': '取消',
    'action.delete': '删除',
    'action.edit': '编辑',

    // 设置弹窗
    'settings.title': '管理 Jenkins 实例',
    'settings.add': '添加实例',
    'settings.name': '实例名称',
    'settings.namePlaceholder': '例如：测试环境',
    'settings.url': 'Jenkins 地址',
    'settings.urlPlaceholder': '例如：https://jenkins.example.com',
    'settings.username': '用户名',
    'settings.usernamePlaceholder': '用户名',
    'settings.token': 'API Token',
    'settings.tokenPlaceholder': 'API Token',
    'settings.test': '测试连接',
    'settings.save': '保存',
    'settings.delete': '删除',
    'settings.confirmDelete': '确定要删除这个实例吗？',

    // 通知
    'notification.addSuccess': '实例添加成功',
    'notification.deleteSuccess': '实例已删除',
    'notification.buildSuccess': '构建已触发',
    'notification.buildFailed': '构建触发失败',

    // 确认弹窗
    'confirm.build': '确认构建',
    'confirm.buildMessage': '确定要触发 {jobName} 的构建吗？',
    'confirm.building': '构建中...',
  },
  'en-US': {
    // General
    'app.name': 'Jenkins Lite',
    'app.version': 'v1.0.0',

    // Sidebar
    'sidebar.views': 'Views',
    'sidebar.favorites': 'Favorites',
    'sidebar.all': 'All',
    'sidebar.noFavorites': 'No favorites',
    'sidebar.loading': 'Loading...',

    // Search
    'search.placeholder': 'Search Jobs...',

    // Build History
    'history.title': 'Build History',
    'history.selectJob': 'Select a Job to view build history',
    'history.noBuilds': 'No build records',
    'history.start': 'Start',
    'history.end': 'End',
    'history.duration': 'Duration',
    'history.running': 'Running...',

    // Build Status
    'status.success': 'Success',
    'status.failure': 'Failure',
    'status.unstable': 'Unstable',
    'status.aborted': 'Aborted',
    'status.building': 'Building',
    'status.disabled': 'Disabled',
    'status.notbuilt': 'Not Built',

    // Actions
    'action.addFavorite': 'Add to Favorites',
    'action.removeFavorite': 'Remove from Favorites',
    'action.triggerBuild': 'Trigger Build',
    'action.confirm': 'Confirm',
    'action.cancel': 'Cancel',
    'action.delete': 'Delete',
    'action.edit': 'Edit',

    // Settings Modal
    'settings.title': 'Manage Jenkins Instances',
    'settings.add': 'Add Instance',
    'settings.name': 'Instance Name',
    'settings.namePlaceholder': 'e.g., Test Environment',
    'settings.url': 'Jenkins URL',
    'settings.urlPlaceholder': 'e.g., https://jenkins.example.com',
    'settings.username': 'Username',
    'settings.usernamePlaceholder': 'Username',
    'settings.token': 'API Token',
    'settings.tokenPlaceholder': 'API Token',
    'settings.test': 'Test Connection',
    'settings.save': 'Save',
    'settings.delete': 'Delete',
    'settings.confirmDelete': 'Are you sure you want to delete this instance?',

    // Notifications
    'notification.addSuccess': 'Instance added successfully',
    'notification.deleteSuccess': 'Instance deleted',
    'notification.buildSuccess': 'Build triggered',
    'notification.buildFailed': 'Build trigger failed',

    // Confirm Modal
    'confirm.build': 'Confirm Build',
    'confirm.buildMessage': 'Are you sure you want to trigger {jobName}?',
    'confirm.building': 'Building...',
  }
}

// 获取当前语言设置，默认为简体中文
export function getLocale(): Locale {
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language
    if (lang.startsWith('en')) return 'en-US'
  }
  return 'zh-CN'
}

// 翻译函数
export function t(key: string, params?: Record<string, string | number>): string {
  const locale = getLocale()
  let text = messages[locale][key] || messages['zh-CN'][key] || key

  // 替换参数
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    })
  }

  return text
}
