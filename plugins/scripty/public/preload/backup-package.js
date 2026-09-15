'use strict'

const { CURRENT_SCHEMA_VERSION, RepositoryError } = require('./metadata-repository')
const { isValidFivePartCron } = require('./cron-utils')
const { calculateSha256, createManagedScriptFileName, createManagedScriptPath, normalizeManagedFolderPath, normalizeManagedScriptPath } = require('./file-repositories')
const {
  EXPORT_FORMAT_VERSION,
  HASH_PATTERN,
  MAX_JSON_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILES,
  MAX_SCRIPT_BYTES,
  assertExportOptions,
  compareStableText
} = require('./backup-protocol')

const BACKUP_DATA_SCHEMA_VERSION = 2
const SEMVER_CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const ENTITY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const CONCURRENCY_POLICIES = new Set(['forbid', 'limited'])
const SCRIPT_LANGUAGES = new Set(['javascript', 'python', 'powershell', 'shell'])
const MAX_ARGUMENTS = 100
const MAX_ARGUMENT_LENGTH = 2000
const MAX_ENVIRONMENT_VALUE_LENGTH = 10000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 86400000

/** Returns a fresh fail-closed scope for exports that have not received explicit user choices. */
function createDefaultExportOptions() {
  return {
    includeEnvironments: false,
    includeEnvironmentValues: false,
    includeSensitiveValues: false
  }
}

/** Serializes one protocol document as deterministic indented UTF-8 bytes with a single trailing LF. */
function serializeExportJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Copies option booleans once so getters cannot make projection and manifest decisions disagree. */
function normalizeExportOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new RepositoryError('VALIDATION_ERROR', '导出选项格式无效')
  }
  return {
    includeEnvironments: options.includeEnvironments,
    includeEnvironmentValues: options.includeEnvironmentValues,
    includeSensitiveValues: options.includeSensitiveValues
  }
}

/** Returns whether a timestamp is already in the protocol's normalized ISO 8601 UTC representation. */
function isCanonicalIsoDateTime(value) {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

/** Returns whether a version follows SemVer 2.0.0, including the no-leading-zero rule for numeric prerelease identifiers. */
function isSemanticVersion(value) {
  if (typeof value !== 'string') return false
  const match = SEMVER_CORE_PATTERN.exec(value)
  if (!match) return false
  return !match[4]?.split('.').some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))
}

/** Validates caller-supplied package metadata without reading system time or application files. */
function assertPackageMetadata(appVersion, exportedAt) {
  if (!isSemanticVersion(appVersion)) {
    throw new RepositoryError('VALIDATION_ERROR', '应用版本必须是 SemVer')
  }
  if (!isCanonicalIsoDateTime(exportedAt)) {
    throw new RepositoryError('VALIDATION_ERROR', '导出时间必须是规范的 ISO 8601 UTC 时间')
  }
}

/** Validates a versioned repository envelope before its data enters a cross-device projection. */
function assertEnvelope(envelope, name, expectedShape) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new RepositoryError('DATA_CORRUPTED', `${name} 导出数据缺少版本信封`)
  }
  if (envelope.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new RepositoryError('UNSUPPORTED_DATA_VERSION', `${name}导出数据不是当前数据版本`)
  }
  const shapeValid = expectedShape === 'array'
    ? Array.isArray(envelope.data)
    : envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
  if (!shapeValid) throw new RepositoryError('DATA_CORRUPTED', `${name} 导出数据格式无效`)
}

/** Rejects duplicate or malformed entity IDs before references and package paths are derived from them. */
function createEntityMap(entities, label) {
  const entries = new Map()
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object' || !ENTITY_ID_PATTERN.test(entity.id)) {
      throw new RepositoryError('DATA_CORRUPTED', `${label}包含无效 ID`)
    }
    if (entries.has(entity.id)) throw new RepositoryError('DATA_CORRUPTED', `${label}包含重复 ID`)
    entries.set(entity.id, entity)
  }
  return entries
}

/** Rejects malformed strings before JSON serialization can omit required protocol fields. */
function assertString(value, label, allowEmpty = true) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new RepositoryError('DATA_CORRUPTED', `${label}格式无效`)
  }
}

/** Validates fields common to every exported entity, including canonical timestamps. */
function assertTimestampedEntity(entity, label) {
  assertString(entity.name, `${label}名称`, false)
  assertString(entity.note, `${label}备注`)
  if (!isCanonicalIsoDateTime(entity.createdAt) || !isCanonicalIsoDateTime(entity.updatedAt)) {
    throw new RepositoryError('DATA_CORRUPTED', `${label}时间格式无效`)
  }
}

/** Validates the persisted concurrency structure shared by task and settings projections. */
function assertConcurrency(value, label) {
  if (!value || typeof value !== 'object' || !CONCURRENCY_POLICIES.has(value.policy)) {
    throw new RepositoryError('DATA_CORRUPTED', `${label}并发策略无效`)
  }
  if (!Number.isInteger(value.limit) || value.limit < 1 || (value.policy === 'forbid' && value.limit !== 1)) {
    throw new RepositoryError('DATA_CORRUPTED', `${label}并发数量无效`)
  }
}

/** Builds a Script DTO field by field so future local-only metadata cannot enter backups implicitly. */
function projectScript(script) {
  return {
    id: script.id,
    name: script.name,
    managedFileName: createManagedScriptFileName(script.id, script.language),
    relativePath: script.relativePath,
    language: script.language,
    contentHash: script.contentHash,
    note: script.note,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt
  }
}

/** Builds a portable task while preserving language semantics and clearing device-specific execution paths. */
function projectTask(task) {
  return {
    id: task.id,
    name: task.name,
    note: task.note,
    scriptId: task.scriptId,
    interpreter: {
      kind: task.interpreter.kind,
      executable: null
    },
    args: [...task.args],
    workingDirectory: null,
    cron: task.cron,
    timeoutMs: task.timeoutMs,
    enabled: task.enabled,
    concurrency: {
      policy: task.concurrency.policy,
      limit: task.concurrency.limit
    },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }
}

/** Projects one environment definition and includes its value only when the selected scope permits it. */
function projectEnvironment(variable, options) {
  const valueIncluded = options.includeEnvironmentValues && (!variable.sensitive || options.includeSensitiveValues)
  return {
    id: variable.id,
    name: variable.name,
    value: valueIncluded ? variable.value : '',
    valueIncluded,
    note: variable.note,
    scope: variable.scope,
    taskId: variable.taskId,
    enabled: variable.enabled,
    sensitive: variable.sensitive,
    createdAt: variable.createdAt,
    updatedAt: variable.updatedAt
  }
}

/** Whitelists portable settings so newly added device fields remain excluded unless the protocol opts in. */
function projectSettings(settings) {
  return {
    defaultTimeoutMs: settings.defaultTimeoutMs,
    defaultConcurrency: {
      policy: settings.defaultConcurrency.policy,
      limit: settings.defaultConcurrency.limit
    },
    logRetention: {
      maxRunsPerTask: settings.logRetention.maxRunsPerTask,
      maxAgeDays: settings.logRetention.maxAgeDays
    },
    updatedAt: settings.updatedAt
  }
}

/** Creates the manifest description for one raw package file without including manifest.json itself. */
function createFileEntry(file) {
  return {
    path: file.path,
    sha256: calculateSha256(file.content),
    size: file.content.length
  }
}

/** Validates cross-repository references, portable settings, and managed script bytes before returning any package files. */
function validateAndReadSource(envelopes, readScriptContent, includeEnvironments) {
  if (!envelopes || typeof envelopes !== 'object') {
    throw new RepositoryError('DATA_CORRUPTED', '缺少导出数据快照')
  }
  assertEnvelope(envelopes.scripts, '脚本', 'array')
  assertEnvelope(envelopes.scriptFolders, '脚本目录', 'array')
  assertEnvelope(envelopes.dependencies, '依赖', 'array')
  assertEnvelope(envelopes.tasks, '任务', 'array')
  assertEnvelope(envelopes.environments, '环境变量', 'array')
  assertEnvelope(envelopes.settings, '设置', 'object')
  if (typeof readScriptContent !== 'function') {
    throw new RepositoryError('VALIDATION_ERROR', '缺少受控脚本读取函数')
  }

  const snapshot = {
    scripts: { schemaVersion: envelopes.scripts.schemaVersion, data: structuredClone(envelopes.scripts.data) },
    scriptFolders: { schemaVersion: envelopes.scriptFolders.schemaVersion, data: structuredClone(envelopes.scriptFolders.data) },
    dependencies: { schemaVersion: envelopes.dependencies.schemaVersion, data: structuredClone(envelopes.dependencies.data) },
    tasks: { schemaVersion: envelopes.tasks.schemaVersion, data: structuredClone(envelopes.tasks.data) },
    environments: { schemaVersion: envelopes.environments.schemaVersion, data: structuredClone(envelopes.environments.data) },
    settings: { schemaVersion: envelopes.settings.schemaVersion, data: structuredClone(envelopes.settings.data) }
  }
  const scriptsById = createEntityMap(snapshot.scripts.data, '脚本')
  const foldersById = createEntityMap(snapshot.scriptFolders.data, '脚本目录')
  const dependenciesById = createEntityMap(snapshot.dependencies.data, '依赖')
  const tasksById = createEntityMap(snapshot.tasks.data, '任务')
  const environmentsById = includeEnvironments
    ? createEntityMap(snapshot.environments.data, '环境变量')
    : new Map()
  const scriptContents = new Map()
  const scripts = [...scriptsById.values()].sort((a, b) => compareStableText(a.id, b.id)).map(script => {
    const content = readScriptContent(script)
    if (typeof content !== 'string') throw new RepositoryError('DATA_CORRUPTED', '托管脚本内容格式无效')
    if (Buffer.byteLength(content, 'utf8') > MAX_SCRIPT_BYTES) throw new RepositoryError('DATA_CORRUPTED', '托管脚本超过导出单文件限制')
    const currentHash = calculateSha256(content)
    if (script.contentHash !== currentHash) throw new RepositoryError('DATA_CORRUPTED', '托管脚本内容与元数据哈希不一致')
    const projected = projectScript({ ...script, contentHash: currentHash })
    scriptContents.set(script.id, Buffer.from(content, 'utf8'))
    return projected
  })

  for (const script of scripts) {
    assertTimestampedEntity(script, '脚本')
    if (!SCRIPT_LANGUAGES.has(script.language) || !HASH_PATTERN.test(script.contentHash)) {
      throw new RepositoryError('DATA_CORRUPTED', '脚本语言或内容哈希无效')
    }
    try { normalizeManagedScriptPath(script.relativePath, script.language) } catch {
      throw new RepositoryError('DATA_CORRUPTED', '脚本相对路径无效')
    }
    const expectedName = createManagedScriptFileName(script.id, script.language)
    if (script.managedFileName !== expectedName) {
      throw new RepositoryError('DATA_CORRUPTED', '脚本托管文件名与 ID 或语言不一致')
    }
    if (calculateSha256(scriptContents.get(script.id)) !== script.contentHash) {
      throw new RepositoryError('DATA_CORRUPTED', '托管脚本内容与导出快照不一致')
    }
  }

  const folderPaths = new Set()
  for (const folder of foldersById.values()) {
    if (!isCanonicalIsoDateTime(folder.createdAt) || !isCanonicalIsoDateTime(folder.updatedAt)) throw new RepositoryError('DATA_CORRUPTED', '脚本目录时间无效')
    let relativePath
    try { relativePath = normalizeManagedFolderPath(folder.relativePath) } catch { throw new RepositoryError('DATA_CORRUPTED', '脚本目录路径无效') }
    const key = relativePath.toLocaleLowerCase()
    if (folderPaths.has(key)) throw new RepositoryError('DATA_CORRUPTED', '脚本目录路径重复')
    folderPaths.add(key)
  }
  const dependencyNames = new Set()
  for (const dependency of dependenciesById.values()) {
    if (!['node', 'python'].includes(dependency.kind) || typeof dependency.name !== 'string' || typeof dependency.versionSpec !== 'string' || !isCanonicalIsoDateTime(dependency.createdAt) || !isCanonicalIsoDateTime(dependency.updatedAt)) {
      throw new RepositoryError('DATA_CORRUPTED', '依赖声明无效')
    }
    const key = `${dependency.kind}:${dependency.name}`
    if (dependencyNames.has(key)) throw new RepositoryError('DATA_CORRUPTED', '依赖声明重复')
    dependencyNames.add(key)
  }

  for (const task of tasksById.values()) {
    assertTimestampedEntity(task, '任务')
    if (!scriptsById.has(task.scriptId)) throw new RepositoryError('DATA_CORRUPTED', '任务引用的脚本不存在')
    if (!task.interpreter || !SCRIPT_LANGUAGES.has(task.interpreter.kind) || typeof task.interpreter.executable !== 'string') {
      throw new RepositoryError('DATA_CORRUPTED', '任务执行配置格式无效')
    }
    if (task.interpreter.kind !== scriptsById.get(task.scriptId).language) {
      throw new RepositoryError('DATA_CORRUPTED', '任务解释器类型与脚本语言不一致')
    }
    if (!Array.isArray(task.args) || task.args.length > MAX_ARGUMENTS || task.args.some((argument) => typeof argument !== 'string' || argument.length > MAX_ARGUMENT_LENGTH)) {
      throw new RepositoryError('DATA_CORRUPTED', '任务参数格式无效')
    }
    if (task.workingDirectory !== null && typeof task.workingDirectory !== 'string') {
      throw new RepositoryError('DATA_CORRUPTED', '任务工作目录格式无效')
    }
    if (!isValidFivePartCron(task.cron)) throw new RepositoryError('DATA_CORRUPTED', '任务 Cron 格式无效')
    if (task.timeoutMs !== null && (!Number.isInteger(task.timeoutMs) || task.timeoutMs < MIN_TIMEOUT_MS || task.timeoutMs > MAX_TIMEOUT_MS)) {
      throw new RepositoryError('DATA_CORRUPTED', '任务超时时间无效')
    }
    if (typeof task.enabled !== 'boolean') throw new RepositoryError('DATA_CORRUPTED', '任务启用状态无效')
    assertConcurrency(task.concurrency, '任务')
  }

  if (includeEnvironments) {
    const namesByScope = new Set()
    for (const variable of environmentsById.values()) {
      assertTimestampedEntity(variable, '环境变量')
      if (!ENVIRONMENT_NAME_PATTERN.test(variable.name)) {
        throw new RepositoryError('DATA_CORRUPTED', '环境变量名称格式无效')
      }
      assertString(variable.value, '环境变量值')
      if (variable.value.length > MAX_ENVIRONMENT_VALUE_LENGTH) {
        throw new RepositoryError('DATA_CORRUPTED', '环境变量值超过允许长度')
      }
      if (typeof variable.enabled !== 'boolean' || typeof variable.sensitive !== 'boolean') {
        throw new RepositoryError('DATA_CORRUPTED', '环境变量状态格式无效')
      }
      if (variable.scope === 'global' && variable.taskId !== null) {
        throw new RepositoryError('DATA_CORRUPTED', '全局环境变量不能引用任务')
      }
      if (variable.scope === 'task' && !tasksById.has(variable.taskId)) {
        throw new RepositoryError('DATA_CORRUPTED', '任务环境变量引用的任务不存在')
      }
      if (variable.scope !== 'global' && variable.scope !== 'task') {
        throw new RepositoryError('DATA_CORRUPTED', '环境变量作用域无效')
      }
      const key = `${variable.scope}\0${variable.taskId ?? ''}\0${variable.name}`
      if (namesByScope.has(key)) throw new RepositoryError('DATA_CORRUPTED', '同一作用域存在重名环境变量')
      namesByScope.add(key)
    }
  }

  const settings = snapshot.settings.data
  if (!Number.isInteger(settings.defaultTimeoutMs) || settings.defaultTimeoutMs < MIN_TIMEOUT_MS || settings.defaultTimeoutMs > MAX_TIMEOUT_MS) {
    throw new RepositoryError('DATA_CORRUPTED', '默认超时时间无效')
  }
  assertConcurrency(settings.defaultConcurrency, '默认')
  if (!settings.logRetention || typeof settings.logRetention !== 'object') {
    throw new RepositoryError('DATA_CORRUPTED', '日志保留设置无效')
  }
  for (const field of ['maxRunsPerTask', 'maxAgeDays']) {
    const value = settings.logRetention[field]
    if (value !== null && (!Number.isInteger(value) || value < 1)) {
      throw new RepositoryError('DATA_CORRUPTED', '日志保留设置无效')
    }
  }
  if (!isCanonicalIsoDateTime(settings.updatedAt)) {
    throw new RepositoryError('DATA_CORRUPTED', '设置更新时间无效')
  }
  const tasks = [...tasksById.values()].sort((a, b) => compareStableText(a.id, b.id)).map(projectTask)
  const environments = includeEnvironments
    ? [...environmentsById.values()].sort((a, b) => compareStableText(a.id, b.id)).map((variable) => ({ ...variable }))
    : []
  return {
    environments,
    schemaVersion: BACKUP_DATA_SCHEMA_VERSION,
    scriptContents,
    scripts,
    scriptFolders: structuredClone(snapshot.scriptFolders.data),
    dependencies: structuredClone(snapshot.dependencies.data),
    settings: projectSettings(settings),
    tasks
  }
}

/**
 * Builds every byte and manifest entry required inside a version 1.0 backup.
 * Callers must provide explicit options; use buildDefaultExportPackageFiles when no user scope was selected.
 * The function is synchronous and side-effect free, with time, version, snapshots, and controlled script reads supplied by the caller.
 */
function buildExportPackageFiles(input) {
  if (!input || typeof input !== 'object') throw new RepositoryError('VALIDATION_ERROR', '导出输入格式无效')
  const { appVersion, exportedAt, envelopes, readScriptContent } = input
  const options = normalizeExportOptions(input.options)
  assertPackageMetadata(appVersion, exportedAt)
  assertExportOptions(options)
  const source = validateAndReadSource(envelopes, readScriptContent, options.includeEnvironments)

  const scripts = source.scripts
  const scriptFolders = source.scriptFolders
  const dependencies = source.dependencies
  const tasks = source.tasks
  const environments = source.environments.map((variable) => projectEnvironment(variable, options))
  const settings = source.settings
  const data = {
    dependencies: { schemaVersion: source.schemaVersion, data: dependencies },
    environments: { schemaVersion: source.schemaVersion, data: environments },
    scriptFolders: { schemaVersion: source.schemaVersion, data: scriptFolders },
    scripts: { schemaVersion: source.schemaVersion, data: scripts },
    tasks: { schemaVersion: source.schemaVersion, data: tasks },
    environments: { schemaVersion: source.schemaVersion, data: environments },
    settings: { schemaVersion: source.schemaVersion, data: settings }
  }

  const packageFiles = [
    { path: 'data/dependencies.json', content: serializeExportJson(data.dependencies) },
    { path: 'data/environments.json', content: serializeExportJson(data.environments) },
    { path: 'data/scriptFolders.json', content: serializeExportJson(data.scriptFolders) },
    { path: 'data/scripts.json', content: serializeExportJson(data.scripts) },
    { path: 'data/settings.json', content: serializeExportJson(data.settings) },
    { path: 'data/tasks.json', content: serializeExportJson(data.tasks) },
    ...scripts.map((script) => ({
      path: `scripts/${script.managedFileName}`,
      content: source.scriptContents.get(script.id)
    }))
  ].sort((left, right) => compareStableText(left.path, right.path))
  if (packageFiles.length + 1 > MAX_PACKAGE_FILES) {
    throw new RepositoryError('DATA_CORRUPTED', '导出文件数量超过协议限制')
  }
  for (const file of packageFiles) {
    if (file.path.endsWith('.json') && file.content.length > MAX_JSON_BYTES) {
      throw new RepositoryError('DATA_CORRUPTED', `${file.path} 超过 JSON 文件大小限制`)
    }
  }
  const totalSize = packageFiles.reduce((sum, file) => sum + file.content.length, 0)
  if (totalSize > MAX_PACKAGE_BYTES) throw new RepositoryError('DATA_CORRUPTED', '导出内容超过协议总大小限制')

  const manifest = {
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion,
    exportedAt,
    entities: {
      scripts: scripts.length,
      scriptFolders: scriptFolders.length,
      dependencies: dependencies.length,
      tasks: tasks.length,
      environments: environments.length
    },
    options: {
      includeEnvironments: options.includeEnvironments,
      includeEnvironmentValues: options.includeEnvironmentValues,
      includeSensitiveValues: options.includeSensitiveValues
    },
    files: packageFiles.map(createFileEntry)
  }
  const manifestContent = serializeExportJson(manifest)
  if (totalSize + manifestContent.length > MAX_PACKAGE_BYTES) {
    throw new RepositoryError('DATA_CORRUPTED', '导出内容超过协议总大小限制')
  }
  return {
    manifest,
    data,
    files: [
      { path: 'manifest.json', content: manifestContent },
      ...packageFiles
    ]
  }
}

/** Builds a package with the fail-closed scope, overriding any accidental options supplied by the caller. */
function buildDefaultExportPackageFiles(input) {
  return buildExportPackageFiles({
    ...input,
    options: createDefaultExportOptions()
  })
}

module.exports = {
  EXPORT_FORMAT_VERSION,
  buildDefaultExportPackageFiles,
  buildExportPackageFiles,
  compareStableText,
  createDefaultExportOptions,
  serializeExportJson
}
