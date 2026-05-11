export interface PluginCommandMatch {
  match?: string
  minLength?: number
  maxLength?: number
  extensions?: string[]
  fileType?: 'file' | 'directory'
}

export interface PluginCommand {
  text?: string
  label?: string
  name?: string
  type?: 'text' | 'regex' | 'over' | 'img' | 'files' | 'window' | string
  match?: PluginCommandMatch
}

export interface PluginFeature {
  code: string
  name?: string
  explain?: string
  icon?: string
  cmds?: PluginCommand[]
}

export interface PluginItem {
  name: string
  title: string
  version?: string
  description?: string
  logo?: string
  features?: PluginFeature[]
  installed?: boolean
  isDevelopment?: boolean
  localVersion?: string
  path?: string
  size?: number
  author?: string
  homepage?: string
}

export interface DocItem {
  key: string
  type: 'document' | 'attachment'
}

export type PluginDocContent = Record<string, unknown> | { error: string } | null

export interface PluginMemoryInfo {
  private: number
  shared: number
  total: number
}

export type TabId = 'detail' | 'commands' | 'data' | 'comments'

export interface TabItem {
  id: TabId
  label: string
}
