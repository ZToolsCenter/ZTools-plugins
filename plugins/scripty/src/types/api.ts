import type {
  ConcurrencyConfig,
  Dependency,
  DependencyKind,
  EntityId,
  EnvironmentScope,
  EnvironmentVariable,
  ExportManifest,
  ExportOptions,
  InterpreterConfig,
  RunRecord,
  RunStatus,
  RunTrigger,
  Script,
  ScriptFolder,
  ScriptLanguage,
  Settings,
  Task
} from './domain'

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_ID'
  | 'INVALID_CRON'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'NAME_CONFLICT'
  | 'REFERENCE_CONFLICT'
  | 'STALE_WRITE'
  | 'SCRIPT_MISSING'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'PATH_NOT_ALLOWED'
  | 'INTERPRETER_UNAVAILABLE'
  | 'DEPENDENCY_ENVIRONMENT_MISSING'
  | 'DEPENDENCY_INSTALL_ACTIVE'
  | 'DEPENDENCY_INSTALL_FAILED'
  | 'SPAWN_FAILED'
  | 'RUN_ALREADY_ACTIVE'
  | 'RUN_LIMIT_REACHED'
  | 'RUN_NOT_ACTIVE'
  | 'STOP_FAILED'
  | 'DATA_CORRUPTED'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'DISK_FULL'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED_DATA_VERSION'
  | 'MIGRATION_FAILED'
  | 'UNSUPPORTED_EXPORT_VERSION'
  | 'PACKAGE_INVALID'
  | 'HASH_MISMATCH'
  | 'PACKAGE_LIMIT_EXCEEDED'
  | 'IMPORT_CONFLICT'
  | 'IMPORT_ROLLBACK_FAILED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'CONFIRMATION_REQUIRED'
  | 'SCHEDULER_UNAVAILABLE'
  | 'PLUGIN_SHUTTING_DOWN'
  | 'INTERNAL_ERROR'

export interface ScriptyError {
  code: ErrorCode
  message: string
  recoverable: boolean
  fieldErrors?: Record<string, string>
  details?: Record<string, string | number | boolean | null>
}

export type Result<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: ScriptyError; requestId: string }

export interface Page<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export type SchedulerStatus = 'active' | 'inactive' | 'unavailable'
export type TaskReadiness =
  | 'ready'
  | 'script_missing'
  | 'interpreter_unavailable'
  | 'invalid_cron'
  | 'invalid_working_directory'

export interface AppSnapshot {
  schedulerStatus: SchedulerStatus
  activeRuns: ActiveRun[]
  settings: SettingsView
  schedulerNotice: string
}

export interface ScriptQuery {
  search?: string
  language?: ScriptLanguage
}

export type ScriptSummary = Omit<Script, 'contentHash'>

export interface ScriptDetail extends Script {
  content: string
}

export interface CreateScriptInput {
  name: string
  language: ScriptLanguage
  content: string
  relativePath: string
  note: string
}

export type UpdateScriptInput = CreateScriptInput

export type ScriptFolderSummary = ScriptFolder

export interface CreateScriptFolderInput {
  relativePath: string
}

export interface MoveManagedPathInput {
  relativePath: string
}

export interface TaskQuery {
  search?: string
  enabled?: boolean
  readiness?: TaskReadiness
}

export interface TaskSummary extends Task {
  scriptName: string
  readiness: TaskReadiness
  nextRunAt: string | null
  activeRunCount: number
}

export interface TaskDetail extends TaskSummary {
  script: ScriptSummary
}

export interface TaskDraft {
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

export type CreateTaskInput = TaskDraft
export type UpdateTaskInput = TaskDraft

export interface TaskValidation {
  valid: boolean
  readiness: TaskReadiness
  fieldErrors: Record<string, string>
}

export interface SchedulePreview {
  cron: string
  nextRuns: string[]
}

export interface ActiveRun extends RunRecord {
  pid: number
  sequence: number
}

export type RunEvent =
  | { type: 'status'; runId: EntityId; sequence: number; status: RunStatus; record?: ActiveRun }
  | { type: 'stdout'; runId: EntityId; sequence: number; chunk: string }
  | { type: 'stderr'; runId: EntityId; sequence: number; chunk: string }
  | { type: 'finished'; runId: EntityId; sequence: number; record: RunRecord }

export interface EnvironmentQuery {
  search?: string
  scope?: EnvironmentScope
  taskId?: EntityId
  enabled?: boolean
}

export type EnvironmentSummary = Omit<EnvironmentVariable, 'value'> & {
  maskedValue: string
}

export type EnvironmentDetail = EnvironmentSummary

export interface RevealedEnvironmentValue {
  id: EntityId
  value: string
}

export interface EnvironmentInput {
  name: string
  value: string
  note: string
  scope: EnvironmentScope
  taskId: EntityId | null
  enabled: boolean
  sensitive: boolean
}

export type CreateEnvironmentInput = EnvironmentInput
export type UpdateEnvironmentInput = EnvironmentInput

export interface SaveSummary {
  displayName: string
  size: number
  containsSensitiveValues: boolean
}

export interface RunHistoryQuery {
  page: number
  pageSize: number
  search?: string
  taskId?: EntityId
  status?: RunStatus
  trigger?: RunTrigger
}

export interface LogChunkRequest {
  offset: number
  length: number
}

export interface LogChunk {
  content: string
  offset: number
  nextOffset: number
  end: boolean
}

export interface HistoryCleanupInput {
  taskId?: EntityId
  maxRunsPerTask?: number
  olderThan?: string
}

export interface CleanupSummary {
  recordsRemoved: number
  logFilesRemoved: number
  bytesFreed: number
}

export type SettingsView = Settings

export type ExportPreviewManifest = Omit<ExportManifest, 'files'>

export interface ExportPreview {
  previewToken: string
  expiresAt: string
  manifest: ExportPreviewManifest
  warnings: string[]
}

export interface SensitiveExportConfirmation {
  acknowledgedPlaintextRisk: true
}

export interface ImportChangeCounts {
  added: number
  updated: number
  retained: number
  conflicts: number
  deleted: number
}

export interface ImportChangePreview {
  total: ImportChangeCounts
  scripts: ImportChangeCounts
  scriptFolders: ImportChangeCounts
  dependencies: ImportChangeCounts
  tasks: ImportChangeCounts
  environments: ImportChangeCounts
  settings: ImportChangeCounts
}

export interface ImportPackagePreview {
  validationToken: string
  expiresAt: string
  package: ExportPreviewManifest
  merge: ImportChangePreview
  overwrite: ImportChangePreview
  warnings: string[]
}

export type BackupImportMode = 'merge' | 'overwrite'

export interface OverwriteImportConfirmation {
  acknowledgedOverwriteRisk: true
}

export interface BackupImportSummary {
  mode: BackupImportMode
  changes: ImportChangePreview
  warnings: string[]
}

/** Preview-token-gated backup export, package preview, and constrained import application. */
export interface BackupsApi {
  previewExport(
    input: ExportOptions,
    confirmation?: SensitiveExportConfirmation
  ): Promise<Result<ExportPreview>>
  export(
    previewToken: string,
    confirmation?: SensitiveExportConfirmation
  ): Promise<Result<SaveSummary | null>>
  chooseImportPackage(): Promise<Result<ImportPackagePreview | null>>
  import(
    validationToken: string,
    input: { mode: BackupImportMode },
    confirmation?: OverwriteImportConfirmation
  ): Promise<Result<BackupImportSummary>>
}

/** Read-only runtime scheduler state and optional future host-integration operations. */
export interface AppApi {
  initialize?(): Promise<Result<AppSnapshot>>
  getSchedulerStatus(): Promise<Result<SchedulerStatus>>
  subscribeSchedulerStatus(listener: (status: SchedulerStatus) => void): () => void
  openDataDirectory?(): Promise<Result<void>>
}

/** Managed script and directory operations constrained to Scripty's data root. */
export interface ScriptsApi {
  list(query?: ScriptQuery): Promise<Result<ScriptSummary[]>>
  get(id: EntityId): Promise<Result<ScriptDetail>>
  create(input: CreateScriptInput): Promise<Result<ScriptDetail>>
  update(id: EntityId, input: UpdateScriptInput): Promise<Result<ScriptDetail>>
  listFolders(): Promise<Result<ScriptFolderSummary[]>>
  createFolder(input: CreateScriptFolderInput): Promise<Result<ScriptFolderSummary>>
  moveFolder(id: EntityId, input: MoveManagedPathInput): Promise<Result<ScriptFolderSummary>>
  removeFolder(id: EntityId): Promise<Result<void>>
  move(id: EntityId, input: MoveManagedPathInput): Promise<Result<ScriptSummary>>
  copy(id: EntityId, input: MoveManagedPathInput): Promise<Result<ScriptSummary>>
  copyFolder(id: EntityId, input: MoveManagedPathInput): Promise<Result<ScriptFolderSummary>>
  remove(id: EntityId): Promise<Result<void>>
}

/** Persisted task configuration and schedule preview operations. */
export interface TasksApi {
  list(query?: TaskQuery): Promise<Result<TaskSummary[]>>
  get(id: EntityId): Promise<Result<TaskDetail>>
  create(input: CreateTaskInput): Promise<Result<TaskDetail>>
  update(id: EntityId, input: UpdateTaskInput): Promise<Result<TaskDetail>>
  duplicate(id: EntityId): Promise<Result<TaskDetail>>
  setEnabled(id: EntityId, enabled: boolean): Promise<Result<TaskSummary>>
  remove(id: EntityId): Promise<Result<void>>
  validate(input: TaskDraft): Promise<Result<TaskValidation>>
  previewSchedule(cron: string): Promise<Result<SchedulePreview>>
}

/** Process lifecycle operations and ordered real-time run events. */
export interface RunsApi {
  start(taskId: EntityId, trigger?: Extract<RunTrigger, 'manual' | 'retry'>): Promise<Result<RunRecord>>
  stop(runId: EntityId): Promise<Result<RunRecord>>
  getActive(): Promise<Result<ActiveRun[]>>
  subscribe(listener: (event: RunEvent) => void): () => void
}

/** Environment variable operations that keep sensitive values masked by default. */
export interface EnvironmentsApi {
  list(query?: EnvironmentQuery): Promise<Result<EnvironmentSummary[]>>
  get(id: EntityId, reveal?: false): Promise<Result<EnvironmentDetail>>
  reveal(id: EntityId): Promise<Result<RevealedEnvironmentValue>>
  create(input: CreateEnvironmentInput): Promise<Result<EnvironmentSummary>>
  update(id: EntityId, input: UpdateEnvironmentInput): Promise<Result<EnvironmentSummary>>
  setEnabled(id: EntityId, enabled: boolean): Promise<Result<EnvironmentSummary>>
  remove(id: EntityId): Promise<Result<void>>
}

/** Paginated immutable run history and bounded log reading operations. */
export interface HistoryApi {
  list(query: RunHistoryQuery): Promise<Result<Page<RunRecord>>>
  get(runId: EntityId): Promise<Result<RunRecord>>
  readLog(runId: EntityId, input: LogChunkRequest): Promise<Result<LogChunk>>
  retry(runId: EntityId): Promise<Result<RunRecord>>
  clear(input?: HistoryCleanupInput): Promise<Result<CleanupSummary>>
}

export type DependencyStatus = 'installed' | 'missing' | 'stale'

export interface DependencySummary extends Dependency {
  installedVersion: string | null
  status: DependencyStatus
}

export interface CreateDependencyInput {
  kind: DependencyKind
  name: string
  versionSpec: string
  postinstall?: string | null
}

export interface DependencySyncResult {
  kind: DependencyKind
  exitCode: number
  output: string
  synchronized: boolean
  postinstallOutput?: string
}

export interface DependencyEnvironmentStatus {
  ready: boolean
  installing: boolean
}

export interface DependencyStatusSnapshot {
  node: DependencyEnvironmentStatus
  python: DependencyEnvironmentStatus
}

/** Fixed-root direct dependency operations; callers cannot supply commands or filesystem paths. */
export interface DependenciesApi {
  list(kind?: DependencyKind): Promise<Result<DependencySummary[]>>
  add(input: CreateDependencyInput): Promise<Result<Dependency>>
  updateVersion(id: EntityId, versionSpec: string, postinstall?: string | null): Promise<Result<Dependency>>
  remove(id: EntityId): Promise<Result<void>>
  sync(kind: DependencyKind): Promise<Result<DependencySyncResult>>
  getStatus(): Promise<Result<DependencyStatusSnapshot>>
}

/** Read-only persisted defaults used by history retention and runtime services. */
export interface SettingsApi {
  get(): Promise<Result<SettingsView>>
}

/** The complete constrained API exposed by preload as window.scripty. */
export interface ScriptyApi {
  app: AppApi
  backups: BackupsApi
  dependencies: DependenciesApi
  scripts: ScriptsApi
  tasks: TasksApi
  runs: RunsApi
  environments: EnvironmentsApi
  history: HistoryApi
  settings: SettingsApi
}
