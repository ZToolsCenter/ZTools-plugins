import type { Settings } from '../types'

export const TASKS_PREFIX = 'todo-tasks/'
export const GROUPS_PREFIX = 'todo-group/'
export const SETTINGS_KEY = 'todo-settings'
export const ACTIVE_GROUP_KEY = 'todo-active-group'
export const ACTIVE_TASK_KEY = 'todo-active-task'
export const LOCAL_DOCS_KEY = 'todo-dev-docs'

export const noteColors = [
  { name: '柔和浅黄', background: '#FFFECF', text: '#000000' },
  { name: '米白黄', background: '#F5F5DC', text: '#000000' },
  { name: '浅灰白', background: '#F0F0F0', text: '#000000' },
  { name: '珍珠白', background: '#FFFAF0', text: '#000000' },
  { name: '浅薄荷绿', background: '#E8F5E9', text: '#000000' },
  { name: '浅天蓝', background: '#E0F7FA', text: '#000000' }
]

export const defaultGroups = [
  { _id: `${GROUPS_PREFIX}pending`, title: '待处理', sort: 1 },
  { _id: `${GROUPS_PREFIX}doing`, title: '进行中', sort: 2 },
  { _id: `${GROUPS_PREFIX}unnamed`, title: '未命名', sort: 3 }
]

export const defaultSettings: Settings = {
  hideCompleted: false,
  bottomCompleted: false,
  renderMarkdown: false,
  noteBlurTransparent: true,
  noteOpacity: 0.6,
  noteBackground: '#FFFECF',
  tomatoSkin: 'tomato',
  tomatoMinutes: 25,
  tomatoScale: 1
}

