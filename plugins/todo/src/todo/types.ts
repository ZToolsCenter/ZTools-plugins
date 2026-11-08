/** 待办分组：仅保留待处理与已完成两类。 */
export type GroupId = 'pending' | 'done'

/** 单条待办任务。 */
export interface TodoItem {
  /** 任务唯一标识，由前端生成，只包含小写字母、数字和中划线。 */
  id: string
  /** 任务文本，去除首尾空白后非空。 */
  text: string
  /** 是否已完成；完成后自动归入已完成分组。 */
  done: boolean
  /** 创建时间戳（毫秒）。 */
  createdAt: number
}

/** 用户可调整的显示设置。 */
export interface TodoSettings {
  /** 是否按 Markdown 渲染任务文本。 */
  renderMarkdown: boolean
  /** 是否显示任务创建时间。 */
  showCreatedAt: boolean
}

/** 持久化的完整状态。 */
export interface TodoState {
  version: 1
  items: TodoItem[]
  settings: TodoSettings
}
