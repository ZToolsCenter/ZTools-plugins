'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { writeBackupArchive } = require('./backup-archive')
const { validateImportPackage } = require('./backup-import')
const { buildImportTarget, commitImportTarget } = require('./backup-import-transaction')
const { buildExportPackageFiles } = require('./backup-package')
const { RepositoryError } = require('./metadata-repository')
const { invoke } = require('./task-service')

const EXPORT_PREVIEW_TTL_MS = 5 * 60 * 1000
const IMPORT_VALIDATION_TTL_MS = 5 * 60 * 1000
const BASE_WARNING = '不会包含运行历史、运行日志或运行中状态；结构化的解释器路径和工作目录会被移除。'

/** Creates a one-slot snapshot store that promptly releases replaced, expired, and consumed package bytes. */
function createBackupPreviewStore(options = {}) {
  const now = options.now ?? (() => Date.now())
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  let activePreview = null

  /** Clears the active snapshot and timer without retaining package bytes in an expired closure. */
  function clear() {
    if (activePreview?.timer !== undefined) clearTimer(activePreview.timer)
    activePreview = null
  }

  /** Replaces the only active snapshot and schedules token-checked cleanup at its expiry. */
  function replace(token, packageSnapshot, expiresAt) {
    clear()
    const delay = Math.max(0, expiresAt - now())
    const preview = { token, packageSnapshot, expiresAt, timer: undefined }
    preview.timer = setTimer(() => {
      if (activePreview?.token === token) activePreview = null
    }, delay)
    preview.timer?.unref?.()
    activePreview = preview
  }

  /** Resolves an unexpired token without exposing or removing its stored package snapshot. */
  function resolve(token) {
    if (!activePreview || activePreview.token !== token) {
      throw new RepositoryError('TOKEN_INVALID', '导出预览已失效，请重新生成')
    }
    if (activePreview.expiresAt <= now()) {
      clear()
      throw new RepositoryError('TOKEN_EXPIRED', '导出预览已过期，请重新生成')
    }
    return activePreview.packageSnapshot
  }

  /** Atomically removes and returns one unexpired snapshot so concurrent exports cannot reuse it. */
  function consume(token) {
    const packageSnapshot = resolve(token)
    clear()
    return packageSnapshot
  }

  return { clear, replace, resolve, consume }
}

/** Creates a one-slot import store that removes private staging files on replacement, expiry, or consumption. */
function createImportValidationStore(options = {}) {
  const now = options.now ?? (() => Date.now())
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const removeSnapshot = options.removeSnapshot ?? ((snapshot) => fs.rmSync(snapshot.temporaryDirectory, { recursive: true, force: true }))
  let activeValidation = null

  /** Disposes the active import snapshot and timer without exposing its temporary path. */
  function clear() {
    if (activeValidation?.timer !== undefined) clearTimer(activeValidation.timer)
    if (activeValidation?.snapshot) {
      try { removeSnapshot(activeValidation.snapshot) } catch {}
    }
    activeValidation = null
  }

  /** Replaces the active validated package and schedules token-checked staging cleanup. */
  function replace(token, snapshot, expiresAt) {
    clear()
    const validation = { token, snapshot, expiresAt, timer: undefined }
    validation.timer = setTimer(() => {
      if (activeValidation?.token === token) clear()
    }, Math.max(0, expiresAt - now()))
    validation.timer?.unref?.()
    activeValidation = validation
  }

  /** Resolves an unexpired import token for the next preview stage without returning it to renderer code. */
  function resolve(token) {
    if (!activeValidation || activeValidation.token !== token) throw new RepositoryError('TOKEN_INVALID', '导入校验已失效，请重新选择备份包')
    if (activeValidation.expiresAt <= now()) {
      clear()
      throw new RepositoryError('TOKEN_EXPIRED', '导入校验已过期，请重新选择备份包')
    }
    return activeValidation.snapshot
  }

  /** Atomically removes and returns one unexpired snapshot without deleting caller-owned staging files. */
  function consume(token) {
    const snapshot = resolve(token)
    if (activeValidation?.timer !== undefined) clearTimer(activeValidation.timer)
    activeValidation = null
    return snapshot
  }

  return { clear, replace, resolve, consume }
}

/** Projects local entities onto protocol-owned fields before comparing them with validated package data. */
function projectLocalEntity(kind, entity, manifest) {
  if (kind === 'scriptFolders') {
    const { id, relativePath, createdAt, updatedAt } = entity
    return { id, relativePath, createdAt, updatedAt }
  }
  if (kind === 'dependencies') {
    const { id, kind: dependencyKind, name, versionSpec, createdAt, updatedAt } = entity
    return { id, kind: dependencyKind, name, versionSpec, createdAt, updatedAt }
  }
  if (kind === 'scripts') {
    const { id, name, managedFileName, relativePath, language, contentHash, note, createdAt, updatedAt } = entity
    return { id, name, managedFileName, relativePath, language, contentHash, note, createdAt, updatedAt }
  }
  if (kind === 'tasks') {
    const { id, name, note, scriptId, args, cron, timeoutMs, enabled, concurrency, createdAt, updatedAt } = entity
    return { id, name, note, scriptId, interpreter: { kind: entity.interpreter.kind, executable: null }, args, workingDirectory: null, cron, timeoutMs, enabled, concurrency, createdAt, updatedAt }
  }
  const { id, name, note, scope, taskId, enabled, sensitive, createdAt, updatedAt } = entity
  const valueIncluded = manifest.options.includeEnvironmentValues && (!sensitive || manifest.options.includeSensitiveValues)
  return { id, name, value: valueIncluded ? entity.value : '', valueIncluded, note, scope, taskId, enabled, sensitive, createdAt, updatedAt }
}

/** Projects device settings onto the shared subset represented by backup protocol 1.0. */
function projectLocalSettings(settings) {
  return {
    defaultTimeoutMs: settings.defaultTimeoutMs,
    defaultConcurrency: settings.defaultConcurrency,
    logRetention: settings.logRetention,
    updatedAt: settings.updatedAt
  }
}

/** Returns the name key used only to warn about different stable IDs that look equivalent to users. */
function createDisplayConflictKey(kind, entity) {
  return kind === 'environments'
    ? `${entity.scope}\0${entity.taskId ?? ''}\0${entity.name}`
    : kind === 'scriptFolders'
      ? entity.relativePath
      : kind === 'dependencies'
        ? `${entity.kind}:${entity.name}`
        : entity.name
}

/** Computes one entity collection's merge and overwrite actions using stable IDs as the only identity key. */
function compareImportEntities(kind, imported, local, manifest) {
  const localById = new Map(local.map(entity => [entity.id, entity]))
  const localNames = new Map()
  for (const entity of local) {
    const key = createDisplayConflictKey(kind, entity)
    if (!localNames.has(key)) localNames.set(key, [])
    localNames.get(key).push(entity.id)
  }
  const common = { added: 0, updated: 0, retained: 0, conflicts: 0, deleted: 0 }
  for (const entity of imported) {
    const localEntity = localById.get(entity.id)
    if (!localEntity) {
      common.added += 1
      if (localNames.get(createDisplayConflictKey(kind, entity))?.some(id => id !== entity.id)) common.conflicts += 1
    } else if (isDeepStrictEqual(entity, projectLocalEntity(kind, localEntity, manifest))) {
      common.retained += 1
    } else {
      common.updated += 1
    }
  }
  const importedIds = new Set(imported.map(entity => entity.id))
  const localOnly = local.filter(entity => !importedIds.has(entity.id)).length
  return {
    merge: { ...common, retained: common.retained + localOnly },
    overwrite: { ...common, deleted: localOnly }
  }
}

/** Sums per-entity preview counters into the total row shown by the renderer. */
function totalImportChanges(groups) {
  return Object.values(groups).reduce(
    (total, counts) => Object.fromEntries(Object.keys(total).map(key => [key, total[key] + counts[key]])),
    { added: 0, updated: 0, retained: 0, conflicts: 0, deleted: 0 }
  )
}

/** Builds a renderer-safe package summary and both import-mode previews from a validated private snapshot. */
function createImportPreview(snapshot, localEnvelopes, validationToken, expiresAt) {
  const comparisons = {}
  const comparableKinds = ['scripts', 'tasks', 'environments']
  if (snapshot.documents.scriptFolders && localEnvelopes.scriptFolders) comparableKinds.push('scriptFolders')
  if (snapshot.documents.dependencies && localEnvelopes.dependencies) comparableKinds.push('dependencies')
  for (const kind of comparableKinds) {
    comparisons[kind] = compareImportEntities(kind, snapshot.documents[kind].data, localEnvelopes[kind].data, snapshot.manifest)
  }
  const settingsEqual = isDeepStrictEqual(snapshot.documents.settings.data, projectLocalSettings(localEnvelopes.settings.data))
  comparisons.settings = {
    merge: { added: 0, updated: settingsEqual ? 0 : 1, retained: settingsEqual ? 1 : 0, conflicts: 0, deleted: 0 },
    overwrite: { added: 0, updated: settingsEqual ? 0 : 1, retained: settingsEqual ? 1 : 0, conflicts: 0, deleted: 0 }
  }
  const buildMode = mode => {
    const groups = Object.fromEntries(Object.entries(comparisons).map(([kind, value]) => [kind, value[mode]]))
    return { total: totalImportChanges(groups), ...groups }
  }
  const warnings = ['当前仅展示预览，不会修改本地数据。']
  const conflictCount = Object.values(comparisons).reduce((sum, value) => sum + value.merge.conflicts, 0)
  if (conflictCount > 0) warnings.push(`发现 ${conflictCount} 个重名但 ID 不同的实体；合并时会作为新实体保留。`)
  if (!snapshot.manifest.options.includeEnvironmentValues) warnings.push('备份未包含环境变量值；预览比较不会把缺失值视为清空。')
  return {
    validationToken,
    expiresAt: new Date(expiresAt).toISOString(),
    package: {
      formatVersion: snapshot.manifest.formatVersion,
      appVersion: snapshot.manifest.appVersion,
      exportedAt: snapshot.manifest.exportedAt,
      entities: snapshot.manifest.entities,
      options: snapshot.manifest.options
    },
    merge: buildMode('merge'),
    overwrite: buildMode('overwrite'),
    warnings
  }
}

/** Returns fixed, data-independent warnings for the normalized export scope. */
function createExportWarnings(options) {
  let scopeWarning
  if (!options.includeEnvironments) {
    scopeWarning = '未选择环境变量；环境变量定义和值均不会包含。'
  } else if (!options.includeEnvironmentValues) {
    scopeWarning = '仅包含环境变量定义；所有环境变量值均为空且标记为未包含。'
  } else if (!options.includeSensitiveValues) {
    scopeWarning = '包含未标记为敏感的环境变量值；标记为敏感的值仍会排除。'
  } else {
    scopeWarning = '已确认包含全部环境变量值；预览快照在 preload 内存中包含明文敏感值。'
  }
  return [BASE_WARNING, scopeWarning]
}

/** Requires an exact, own-property acknowledgement before a sensitive snapshot can be read or saved. */
function assertSensitiveExportConfirmation(includeSensitiveValues, confirmation) {
  if (!includeSensitiveValues) return
  if (
    !confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation) ||
    Object.getPrototypeOf(confirmation) !== Object.prototype ||
    Object.keys(confirmation).length !== 1 ||
    !Object.hasOwn(confirmation, 'acknowledgedPlaintextRisk') ||
    confirmation.acknowledgedPlaintextRisk !== true
  ) {
    throw new RepositoryError('CONFIRMATION_REQUIRED', '导出本地明文敏感值前必须明确确认风险')
  }
}

/** Creates preview-token-gated backup operations while keeping package bytes and save paths inside preload. */
function createBackupsApi(metadataRepository, managedScriptRepository, options = {}) {
  const appVersion = options.appVersion
  const now = options.now ?? (() => Date.now())
  const createToken = options.randomUUID ?? randomUUID
  const previewStore = options.previewStore ?? createBackupPreviewStore({ now })
  const importStore = options.importStore ?? createImportValidationStore({ now })
  const ztools = options.ztools
  const archiveWriter = options.writeBackupArchive ?? writeBackupArchive
  const importValidator = options.validateImportPackage ?? validateImportPackage
  const dataRoot = options.dataRoot
  const scheduler = options.scheduler
  const importCommitter = options.commitImportTarget ?? commitImportTarget
  const automaticBackup = options.createAutomaticBackup

  return {
    /** Replaces old state and builds a safe preview only after any required plaintext acknowledgement. */
    previewExport(input, confirmation) {
      previewStore.clear()
      return invoke(() => {
        assertSensitiveExportConfirmation(input?.includeSensitiveValues === true, confirmation)
        const packageSnapshot = buildExportPackageFiles({
          appVersion,
          exportedAt: new Date(now()).toISOString(),
          options: input,
          envelopes: {
            scripts: metadataRepository.readEnvelope('scripts'),
            scriptFolders: metadataRepository.readEnvelope('scriptFolders'),
            dependencies: metadataRepository.readEnvelope('dependencies'),
            tasks: metadataRepository.readEnvelope('tasks'),
            environments: metadataRepository.readEnvelope('environments'),
            settings: metadataRepository.readEnvelope('settings')
          },
          readScriptContent: (script) => managedScriptRepository.read(script, script.language)
        })
        const token = createToken()
        const expiresAt = now() + EXPORT_PREVIEW_TTL_MS
        previewStore.replace(token, packageSnapshot, expiresAt)
        const { files, ...safeManifest } = packageSnapshot.manifest
        return {
          previewToken: token,
          expiresAt: new Date(expiresAt).toISOString(),
          manifest: safeManifest,
          warnings: createExportWarnings(packageSnapshot.manifest.options)
        }
      })
    },

    /** Consumes one immutable preview and saves it through the host dialog without exposing its absolute path. */
    export(previewToken, confirmation) {
      return invoke(async () => {
        const packageSnapshot = previewStore.resolve(previewToken)
        assertSensitiveExportConfirmation(packageSnapshot.manifest.options.includeSensitiveValues, confirmation)
        previewStore.consume(previewToken)
        if (!ztools?.showSaveDialog) throw new RepositoryError('INTERNAL_ERROR', '宿主保存对话框不可用')
        const savePath = await ztools.showSaveDialog({
          title: '导出 Scripty 备份',
          defaultPath: 'scripty-backup.zip',
          filters: [{ name: 'ZIP 备份包', extensions: ['zip'] }],
          properties: ['showOverwriteConfirmation', 'dontAddToRecent']
        })
        if (!savePath) return null
        const size = await archiveWriter(packageSnapshot.files, path.resolve(savePath))
        return {
          displayName: path.basename(savePath),
          size,
          containsSensitiveValues: packageSnapshot.manifest.options.includeSensitiveValues
        }
      })
    },

    /** Selects and fully validates one ZIP before returning only a short-lived renderer-safe token. */
    chooseImportPackage() {
      importStore.clear()
      return invoke(async () => {
        if (!ztools?.showOpenDialog) throw new RepositoryError('INTERNAL_ERROR', '宿主文件选择器不可用')
        const files = await ztools.showOpenDialog({
          title: '选择并校验 Scripty 备份',
          properties: ['openFile'],
          filters: [{ name: 'ZIP 备份包', extensions: ['zip'] }]
        })
        if (!Array.isArray(files) || files.length === 0) return null
        const snapshot = await importValidator(path.resolve(files[0]))
        const validationToken = createToken()
        const expiresAt = now() + IMPORT_VALIDATION_TTL_MS
        importStore.replace(validationToken, snapshot, expiresAt)
        try {
          return createImportPreview(snapshot, {
            scripts: metadataRepository.readEnvelope('scripts'),
            scriptFolders: metadataRepository.readEnvelope('scriptFolders'),
            dependencies: metadataRepository.readEnvelope('dependencies'),
            tasks: metadataRepository.readEnvelope('tasks'),
            environments: metadataRepository.readEnvelope('environments'),
            settings: metadataRepository.readEnvelope('settings')
          }, validationToken, expiresAt)
        } catch (error) {
          importStore.clear()
          throw error
        }
      })
    },

    /** Consumes one validated package and applies its merge or overwrite target through a rollback-safe transaction. */
    import(validationToken, input, confirmation) {
      return invoke(async () => {
        if (!input || typeof input !== 'object' || !['merge', 'overwrite'].includes(input.mode)) {
          throw new RepositoryError('VALIDATION_ERROR', '请选择有效的导入模式')
        }
        if (input.mode === 'overwrite') {
          if (!confirmation || Object.keys(confirmation).length !== 1 || confirmation.acknowledgedOverwriteRisk !== true) {
            throw new RepositoryError('CONFIRMATION_REQUIRED', '覆盖恢复前必须明确确认删除和替换风险')
          }
          if (typeof automaticBackup !== 'function') throw new RepositoryError('INTERNAL_ERROR', '自动备份服务不可用')
          await automaticBackup()
        }
        if (!dataRoot || !scheduler?.prepareSnapshot) throw new RepositoryError('INTERNAL_ERROR', '导入事务服务不可用')
        const snapshot = importStore.consume(validationToken)
        try {
          const current = {
            scripts: metadataRepository.read('scripts'),
            scriptFolders: metadataRepository.read('scriptFolders'),
            dependencies: metadataRepository.read('dependencies'),
            tasks: metadataRepository.read('tasks'),
            environments: metadataRepository.read('environments'),
            settings: metadataRepository.read('settings')
          }
          const target = buildImportTarget(snapshot, current, input.mode)
          const scheduleChange = scheduler.prepareSnapshot(target.tasks)
          try {
            importCommitter(dataRoot, snapshot, target)
          } catch (error) {
            scheduler.abortSnapshot(scheduleChange)
            throw error
          }
          scheduler.commitSnapshot(scheduleChange)
          const changes = createImportPreview(snapshot, {
            scripts: { data: current.scripts }, scriptFolders: { data: current.scriptFolders }, dependencies: { data: current.dependencies }, tasks: { data: current.tasks },
            environments: { data: current.environments }, settings: { data: current.settings }
          }, validationToken, now())[input.mode]
          return { mode: input.mode, changes, warnings: ['设备本地解释器、工作目录和未包含的环境变量值已按本机配置保留。'] }
        } finally {
          try { fs.rmSync(snapshot.temporaryDirectory, { recursive: true, force: true }) } catch {}
        }
      })
    }
  }
}

module.exports = {
  EXPORT_PREVIEW_TTL_MS,
  IMPORT_VALIDATION_TTL_MS,
  assertSensitiveExportConfirmation,
  createBackupPreviewStore,
  createBackupsApi,
  createExportWarnings,
  createImportPreview,
  createImportValidationStore
}
