// Jenkins 实例配置
export interface JenkinsInstance {
  _id: string
  type: 'jenkins-instance'
  name: string
  url: string
  username: string
  apiToken: string
  crumb?: string
  createdAt: number
  updatedAt: number
}

// Jenkins 视图
export interface JenkinsView {
  name: string
  url: string
  color: string
  description?: string
}

// Job 信息
export interface JobInfo {
  name: string
  fullName?: string
  url: string
  color: string
  lastBuild?: {
    number: number
    url: string
    result?: BuildResult
    timestamp: number
  }
  _class?: string
  jobs?: JobInfo[]
}

// 构建信息
export interface BuildInfo {
  id: string
  number: number
  url: string
  result: BuildResult
  building: boolean
  duration: number
  timestamp: number
  displayName: string
  fullDisplayName: string
}

// 构建结果
export type BuildResult = 'SUCCESS' | 'FAILURE' | 'ABORTED' | 'UNSTABLE' | null

// 收藏
export interface Favorite {
  _id: string
  type: 'favorite'
  instanceId: string
  instanceName: string
  jobName: string
  viewName: string  // 收藏时所在的视图
  addedAt: number
}

// API 响应
export interface JenkinsResponse<T> {
  data: T | null
  error: string | null
}

// 搜索结果
export interface SearchResult {
  type: 'job' | 'instance' | 'build' | 'command'
  title: string
  subtitle?: string
  icon?: string
  action: {
    type: 'build' | 'view' | 'favorite' | 'navigate'
    payload: any
  }
}

// 视图类型
export type ViewType = 'jobs' | 'favorites' | 'settings'

// Job 状态颜色映射
export const JOB_COLOR_MAP: Record<string, { label: string; icon: string; color: string }> = {
  'blue': { label: '成功', icon: '●', color: '#52c41a' },
  'animeblue': { label: '运行中', icon: '◐', color: '#1890ff' },
  'red': { label: '失败', icon: '●', color: '#ff4d4f' },
  'animered': { label: '运行中', icon: '◐', color: '#ff4d4f' },
  'yellow': { label: '不稳定', icon: '⚠', color: '#faad14' },
  'animeyellow': { label: '运行中', icon: '◐', color: '#faad14' },
  'grey': { label: '禁用', icon: '○', color: '#d9d9d9' },
  'disabled': { label: '未执行', icon: '○', color: '#bfbfbf' },
  'notbuilt': { label: '未构建', icon: '○', color: '#d9d9d9' },
  'aborted': { label: '中止', icon: '○', color: '#8c8c8c' },
}
