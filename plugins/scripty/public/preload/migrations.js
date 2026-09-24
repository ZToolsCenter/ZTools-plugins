'use strict'

const { RepositoryError } = require('./metadata-repository')
const { createManagedScriptPath } = require('./file-repositories')

/** Ensures a migration function returns the exact next version and a serializable data payload. */
function validateMigrationResult(result, expectedVersion, repositoryName) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new RepositoryError('MIGRATION_FAILED', `${repositoryName} 的迁移结果格式无效`)
  }
  if (result.schemaVersion !== expectedVersion || !Object.hasOwn(result, 'data')) {
    throw new RepositoryError(
      'MIGRATION_FAILED',
      `${repositoryName} 的迁移必须生成 schemaVersion ${expectedVersion}`
    )
  }
  return result
}

class MigrationRegistry {
  /** Creates an empty per-repository registry; migrations must be explicitly registered by source version. */
  constructor() {
    this.migrations = new Map()
  }

  /** Registers one deterministic migration from version N to N+1 and rejects duplicate steps. */
  register(repositoryName, fromVersion, migrate) {
    if (typeof repositoryName !== 'string' || repositoryName.length === 0) {
      throw new TypeError('repositoryName 不能为空')
    }
    if (!Number.isInteger(fromVersion) || fromVersion < 0) {
      throw new TypeError('fromVersion 必须是非负整数')
    }
    if (typeof migrate !== 'function') throw new TypeError('migrate 必须是函数')

    const key = `${repositoryName}:${fromVersion}`
    if (this.migrations.has(key)) {
      throw new TypeError(`${repositoryName} 的版本 ${fromVersion} 迁移已注册`)
    }
    this.migrations.set(key, migrate)
    return this
  }

  /** Reports whether a repository has one migration step beginning at the requested version. */
  has(repositoryName, fromVersion) {
    return this.migrations.has(`${repositoryName}:${fromVersion}`)
  }

  /**
   * Applies every N→N+1 step until targetVersion, cloning the source so migrations cannot mutate
   * the original parsed document that remains available for diagnostics and recovery.
   */
  migrate(repositoryName, envelope, targetVersion) {
    if (!Number.isInteger(targetVersion) || targetVersion < 0) {
      throw new TypeError('targetVersion 必须是非负整数')
    }
    if (envelope.schemaVersion > targetVersion) {
      throw new RepositoryError(
        'UNSUPPORTED_DATA_VERSION',
        `${repositoryName} 的数据版本高于当前支持版本`
      )
    }

    let current
    try {
      current = structuredClone(envelope)
    } catch (error) {
      throw new RepositoryError('MIGRATION_FAILED', `${repositoryName} 无法复制待迁移数据`, error)
    }

    while (current.schemaVersion < targetVersion) {
      const fromVersion = current.schemaVersion
      const migration = this.migrations.get(`${repositoryName}:${fromVersion}`)
      if (!migration) {
        throw new RepositoryError(
          'MIGRATION_FAILED',
          `${repositoryName} 缺少 ${fromVersion} → ${fromVersion + 1} 迁移`
        )
      }
      try {
        current = validateMigrationResult(
          migration(structuredClone(current)),
          fromVersion + 1,
          repositoryName
        )
      } catch (error) {
        if (error instanceof RepositoryError) throw error
        throw new RepositoryError(
          'MIGRATION_FAILED',
          `${repositoryName} 的 ${fromVersion} → ${fromVersion + 1} 迁移失败`,
          error
        )
      }
    }
    return current
  }
}

/** Allocates deterministic readable paths while retaining any valid path already produced by a partial rollout. */
function migrateScriptsToRelativePaths(envelope) {
  const usedPaths = new Set()
  const scripts = [...envelope.data].sort((left, right) => left.id.localeCompare(right.id)).map(script => {
    const basePath = typeof script.relativePath === 'string' && script.relativePath
      ? script.relativePath
      : createManagedScriptPath(script.name, script.language, script.id)
    let relativePath = basePath
    let counter = 0
    while (usedPaths.has(relativePath.toLocaleLowerCase())) {
      counter += 1
      const extensionIndex = basePath.lastIndexOf('.')
      const suffix = counter === 1 ? script.id.slice(0, 8) : `${script.id.slice(0, 8)}-${counter}`
      relativePath = `${basePath.slice(0, extensionIndex)}-${suffix}${basePath.slice(extensionIndex)}`
    }
    usedPaths.add(relativePath.toLocaleLowerCase())
    const migrated = { ...script, relativePath }
    if (script.managedFileName && script.managedFileName !== relativePath) migrated.legacyManagedFileName = script.managedFileName
    delete migrated.managedFileName
    return migrated
  })
  const byId = new Map(scripts.map(script => [script.id, script]))
  return { schemaVersion: 2, data: envelope.data.map(script => byId.get(script.id)) }
}

/** Advances non-script repositories without changing their version-1 payload shape. */
function migrateUnchangedRepository(envelope) {
  return { schemaVersion: 2, data: envelope.data }
}

/** Creates the application's complete v1-to-v2 migration registry. */
function createMigrationRegistry() {
  const registry = new MigrationRegistry()
    .register('scripts', 1, migrateScriptsToRelativePaths)
  for (const repositoryName of ['tasks', 'environments', 'runRecords', 'settings']) {
    registry.register(repositoryName, 1, migrateUnchangedRepository)
  }
  return registry
}

module.exports = {
  MigrationRegistry,
  createMigrationRegistry,
  migrateScriptsToRelativePaths,
  migrateUnchangedRepository,
  validateMigrationResult
}
