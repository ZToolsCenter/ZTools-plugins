/** VSCode 历史记录条目类型 */
export interface RecentEntry {
  folderUri?: string
  workspace?: { id: string; configPath: string }
  label?: string
  remoteAuthority?: string
  fileUri?: string
}

export interface RecentData {
  entries: (string | RecentEntry)[]
}

export interface IDEConfig {
  code: string
  icon: string
  terminal: string
  command: string
  database: string
  timeout: string
}

export interface SearchItem {
  path: string
  decodedPath: string
  title: string
  isWorkspace: boolean
  isRemote: boolean
  ext: string
  dirExists: boolean
}
