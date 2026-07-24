export const DATA_SCHEMA_VERSION = 2 as const
export const EXPORT_FORMAT_VERSION = '1.1' as const

export type EntityId = string
export type IsoDateTime = string

export type ScriptLanguage = 'javascript' | 'python' | 'powershell' | 'shell'
export type RunTrigger = 'manual' | 'cron' | 'retry' | 'all'
export type RunStatus =
  | 'starting'
  | 'running'
  | 'success'
  | 'failed'
  | 'timed_out'
  | 'stopped'
  | 'interrupted'
  | 'all'
export type ConcurrencyPolicy = 'forbid' | 'limited'
export type EnvironmentScope = 'global' | 'task'

export interface VersionedData<T> {
  schemaVersion: number
  data: T
}

export interface TimestampedEntity {
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface Script extends TimestampedEntity {
  id: EntityId
  name: string
  relativePath: string
  language: ScriptLanguage
  contentHash: string
  note: string
}

export interface ScriptFolder extends TimestampedEntity {
  id: EntityId
  relativePath: string
}

export type DependencyKind = 'node' | 'python'

export interface Dependency extends TimestampedEntity {
  id: EntityId
  kind: DependencyKind
  name: string
  versionSpec: string
  postinstall?: string | null
}

export interface InterpreterConfig {
  kind: ScriptLanguage
  executable: string
}

export interface ConcurrencyConfig {
  policy: ConcurrencyPolicy
  limit: number
}

export interface Task extends TimestampedEntity {
  id: EntityId
  name: string
  note: string
  scriptId: EntityId
  interpreter: InterpreterConfig
  args: string[]
  workingDirectory: string | null
  cron: string | null
  timeoutMs: number | null
  enabled: boolean
  concurrency: ConcurrencyConfig
}

export interface EnvironmentVariable extends TimestampedEntity {
  id: EntityId
  name: string
  value: string
  note: string
  scope: EnvironmentScope
  taskId: EntityId | null
  enabled: boolean
  sensitive: boolean
}

export interface LogRetention {
  maxRunsPerTask: number | null
  maxAgeDays: number | null
}

export interface Settings {
  defaultTimeoutMs: number
  defaultConcurrency: ConcurrencyConfig
  logRetention: LogRetention
  defaultWorkingDirectory: string | null
  schedulerNoticeAcknowledged: boolean
  updatedAt: IsoDateTime
}

export interface RunRecord {
  id: EntityId
  taskId: EntityId
  taskNameSnapshot: string
  scriptNameSnapshot: string
  trigger: RunTrigger
  startedAt: IsoDateTime
  finishedAt: IsoDateTime | null
  status: RunStatus
  exitCode: number | null
  durationMs: number | null
  logFileName: string
  errorSummary: string | null
}

export interface ExportEntityCounts {
  scripts: number
  scriptFolders: number
  dependencies: number
  tasks: number
  environments: number
}

export interface ExportOptions {
  includeEnvironments: boolean
  includeEnvironmentValues: boolean
  includeSensitiveValues: boolean
}

export interface ExportFileEntry {
  path: string
  sha256: string
  size: number
}

export interface ExportManifest {
  formatVersion: typeof EXPORT_FORMAT_VERSION
  appVersion: string
  exportedAt: IsoDateTime
  entities: ExportEntityCounts
  options: ExportOptions
  files: ExportFileEntry[]
}

export interface ExportScript extends Script {
  managedFileName: string
}

export interface ExportInterpreterConfig {
  kind: ScriptLanguage
  executable: null
}

export interface ExportTask extends Pick<
  Task,
  | 'id'
  | 'name'
  | 'note'
  | 'scriptId'
  | 'args'
  | 'cron'
  | 'timeoutMs'
  | 'enabled'
  | 'concurrency'
  | 'createdAt'
  | 'updatedAt'
> {
  interpreter: ExportInterpreterConfig
  workingDirectory: null
}

export type ExportSettings = Pick<
  Settings,
  'defaultTimeoutMs' | 'defaultConcurrency' | 'logRetention' | 'updatedAt'
>

export interface ExportEnvironmentVariable extends Pick<
  EnvironmentVariable,
  'id' | 'name' | 'note' | 'scope' | 'taskId' | 'enabled' | 'sensitive' | 'createdAt' | 'updatedAt'
> {
  value: string
  valueIncluded: boolean
}

export interface ExportPackageData {
  scripts: VersionedData<ExportScript[]>
  scriptFolders: VersionedData<ScriptFolder[]>
  dependencies: VersionedData<Dependency[]>
  tasks: VersionedData<ExportTask[]>
  environments: VersionedData<ExportEnvironmentVariable[]>
  settings: VersionedData<ExportSettings>
}

export interface ExportPackageFile {
  path: string
  content: Uint8Array
}

export interface ExportPackageDefinition {
  manifest: ExportManifest
  data: ExportPackageData
  files: ExportPackageFile[]
}
