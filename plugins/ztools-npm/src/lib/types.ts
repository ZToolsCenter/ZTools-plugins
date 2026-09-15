// 双源标识
export type NpmSource = 'npm' | 'npmmirror'

// 搜索结果包
export interface NpmPackage {
  id: string
  name: string
  version: string          // latest version
  description: string
  keywords?: string[]
  date?: string
  source?: NpmSource
}

// 单个版本（版本面板行）
export interface NpmVersion {
  v: string
  time?: number            // ms epoch
  status: VersionStatus
  isLatest: boolean
  isDistTag?: boolean
}

export type VersionStatus = 'stable' | 'rc' | 'beta' | 'alpha' | 'dev'

// 解析后的搜索意图
export type ParsedQuery =
  | { kind: 'freeText'; text: string }
  | { kind: 'package'; name: string; versionPrefix?: string }

// npmSearch 返回的双源聚合结果
export interface SearchResult {
  data: NpmPackage[]
  sources: { npm: NpmPackage[]; npmmirror: NpmPackage[] }
  errors?: Partial<Record<NpmSource, unknown>>
}

// 包元数据（npmMeta 返回）
export interface NpmMeta {
  name: string
  description: string
  distTags: Record<string, string>
  versions: { v: string; time?: number }[]
  readme?: string
  license?: string
  homepage?: string
  repository?: string
}

// 包管理器
export type PackageManager = 'npm' | 'pnpm' | 'yarn'
