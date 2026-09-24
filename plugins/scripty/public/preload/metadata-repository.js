'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const CURRENT_SCHEMA_VERSION = 2
const METADATA_FILES = Object.freeze({
  scripts: 'scripts.json',
  scriptFolders: 'script-folders.json',
  dependencies: 'dependencies.json',
  tasks: 'tasks.json',
  environments: 'environments.json',
  runRecords: 'run-records.json',
  settings: 'settings.json'
})

class RepositoryError extends Error {
  /**
   * Wraps storage failures with a stable code while retaining the original error for preload diagnostics.
   */
  constructor(code, message, cause) {
    super(message, { cause })
    this.name = 'RepositoryError'
    this.code = code
  }
}

/** Creates a fresh default settings object so callers cannot mutate a shared singleton. */
function createDefaultSettings(now = new Date().toISOString()) {
  return {
    defaultTimeoutMs: 300000,
    defaultConcurrency: { policy: 'forbid', limit: 1 },
    logRetention: { maxRunsPerTask: 100, maxAgeDays: 30 },
    defaultWorkingDirectory: null,
    schedulerNoticeAcknowledged: false,
    updatedAt: now
  }
}

/** Returns the initial payload for one known repository without accepting arbitrary file names. */
function createInitialData(repositoryName) {
  if (repositoryName === 'settings') return createDefaultSettings()
  return []
}

/** Validates the versioned storage envelope before any data is returned to a service. */
function validateEnvelope(value, repositoryName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RepositoryError('DATA_CORRUPTED', `${METADATA_FILES[repositoryName]} 的数据根格式无效`)
  }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 0) {
    throw new RepositoryError('DATA_CORRUPTED', `${METADATA_FILES[repositoryName]} 缺少有效的数据版本`)
  }
  if (!Object.hasOwn(value, 'data')) {
    throw new RepositoryError('DATA_CORRUPTED', `${METADATA_FILES[repositoryName]} 缺少 data 字段`)
  }
  return value
}

/** Validates the current-version payload shape after any required migrations have completed. */
function validateCurrentEnvelope(value, repositoryName) {
  validateEnvelope(value, repositoryName)
  if (value.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new RepositoryError(
      'UNSUPPORTED_DATA_VERSION',
      `${METADATA_FILES[repositoryName]} 不是当前数据版本`
    )
  }
  if (repositoryName === 'settings') {
    if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) {
      throw new RepositoryError('DATA_CORRUPTED', 'settings.json 的 data 必须是对象')
    }
  } else if (!Array.isArray(value.data)) {
    throw new RepositoryError('DATA_CORRUPTED', `${METADATA_FILES[repositoryName]} 的 data 必须是数组`)
  }
  return value
}

/** Maps native file-system failures to stable storage codes without exposing absolute paths. */
function mapFileSystemError(error, fallbackCode, message) {
  const codeBySystemError = {
    EACCES: 'PERMISSION_DENIED',
    EPERM: 'PERMISSION_DENIED',
    ENOSPC: 'DISK_FULL'
  }
  return new RepositoryError(codeBySystemError[error?.code] ?? fallbackCode, message, error)
}

/**
 * Persists a complete JSON envelope using a same-directory temporary file and atomic rename.
 * The target remains unchanged if serialization, flushing, or replacement fails.
 */
function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let fileDescriptor
  try {
    const content = `${JSON.stringify(value, null, 2)}\n`
    fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600)
    fs.writeFileSync(fileDescriptor, content, { encoding: 'utf8' })
    fs.fsyncSync(fileDescriptor)
    fs.closeSync(fileDescriptor)
    fileDescriptor = undefined
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    if (fileDescriptor !== undefined) {
      try {
        fs.closeSync(fileDescriptor)
      } catch {}
    }
    try {
      fs.rmSync(temporaryPath, { force: true })
    } catch {}
    throw mapFileSystemError(error, 'WRITE_FAILED', `无法写入 ${path.basename(filePath)}`)
  }
}

class MetadataRepository {
  /** Creates a repository rooted at the fixed Scripty metadata directory with an explicit migration chain. */
  constructor(metadataDirectory, migrationRegistry) {
    if (!path.isAbsolute(metadataDirectory)) {
      throw new TypeError('metadataDirectory 必须是绝对路径')
    }
    this.metadataDirectory = metadataDirectory
    this.migrationRegistry = migrationRegistry ?? require('./migrations').createMigrationRegistry()
  }

  /** Resolves a known repository name to its fixed metadata path. */
  getFilePath(repositoryName) {
    const fileName = METADATA_FILES[repositoryName]
    if (!fileName) throw new TypeError(`未知的元数据仓库：${repositoryName}`)
    return path.join(this.metadataDirectory, fileName)
  }

  /** Creates the metadata directory and only the data files that do not yet exist. */
  initialize() {
    try {
      fs.mkdirSync(this.metadataDirectory, { recursive: true })
    } catch (error) {
      throw mapFileSystemError(error, 'WRITE_FAILED', '无法创建元数据目录')
    }

    for (const repositoryName of Object.keys(METADATA_FILES)) {
      const filePath = this.getFilePath(repositoryName)
      if (!fs.existsSync(filePath)) {
        atomicWriteJson(filePath, {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          data: createInitialData(repositoryName)
        })
      }
    }

    return this.readAll()
  }

  /**
   * Reads one envelope, migrates older versions in memory, validates the current payload, and only
   * then atomically persists the migrated document. Newer versions are rejected without writeback.
   */
  readEnvelope(repositoryName) {
    const filePath = this.getFilePath(repositoryName)
    let content
    try {
      content = fs.readFileSync(filePath, 'utf8')
    } catch (error) {
      throw mapFileSystemError(error, 'READ_FAILED', `无法读取 ${path.basename(filePath)}`)
    }

    try {
      const parsed = validateEnvelope(JSON.parse(content), repositoryName)
      if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new RepositoryError(
          'UNSUPPORTED_DATA_VERSION',
          `${path.basename(filePath)} 的数据版本高于当前支持版本`
        )
      }
      const migrated = parsed.schemaVersion < CURRENT_SCHEMA_VERSION
        ? this.migrationRegistry.migrate(repositoryName, parsed, CURRENT_SCHEMA_VERSION)
        : parsed
      const validated = validateCurrentEnvelope(migrated, repositoryName)
      if (parsed.schemaVersion < CURRENT_SCHEMA_VERSION) atomicWriteJson(filePath, validated)
      return validated
    } catch (error) {
      if (error instanceof RepositoryError) throw error
      throw new RepositoryError('DATA_CORRUPTED', `${path.basename(filePath)} 不是有效的 JSON`, error)
    }
  }

  /** Returns the payload from one validated metadata file. */
  read(repositoryName) {
    return this.readEnvelope(repositoryName).data
  }

  /** Reads every repository after initialization for a consistent application snapshot. */
  readAll() {
    return Object.fromEntries(
      Object.keys(METADATA_FILES).map((repositoryName) => [repositoryName, this.read(repositoryName)])
    )
  }

  /** Replaces one repository payload after validating the complete target envelope. */
  write(repositoryName, data) {
    const envelope = validateCurrentEnvelope(
      { schemaVersion: CURRENT_SCHEMA_VERSION, data },
      repositoryName
    )
    atomicWriteJson(this.getFilePath(repositoryName), envelope)
    return data
  }
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  METADATA_FILES,
  MetadataRepository,
  RepositoryError,
  atomicWriteJson,
  createDefaultSettings,
  mapFileSystemError,
  validateCurrentEnvelope,
  validateEnvelope
}
