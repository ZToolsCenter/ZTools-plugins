'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { calculateSha256, createManagedScriptFileName, createManagedScriptPath, normalizeManagedFolderPath, normalizeManagedScriptPath } = require('./file-repositories')
const { CURRENT_SCHEMA_VERSION, RepositoryError, atomicWriteJson, mapFileSystemError } = require('./metadata-repository')

const PORTABLE_INTERPRETER_DEFAULTS = {
  javascript: 'node',
  python: 'python',
  powershell: 'powershell',
  shell: 'sh'
}

/** Merges imported entities by stable ID while retaining local entities absent from the package. */
function mergeById(local, imported) {
  const result = new Map(local.map(entity => [entity.id, structuredClone(entity)]))
  for (const entity of imported) result.set(entity.id, structuredClone(entity))
  return [...result.values()]
}

/** Applies local device fields and built-in interpreter commands without silently enabling imported schedules. */
function materializeTasks(importedTasks, localTasks) {
  const localById = new Map(localTasks.map(task => [task.id, task]))
  return importedTasks.map(task => {
    const local = localById.get(task.id)
    const sameKind = local?.interpreter?.kind === task.interpreter.kind
    return {
      ...structuredClone(task),
      interpreter: {
        kind: task.interpreter.kind,
        executable: sameKind
          ? local.interpreter.executable
          : (PORTABLE_INTERPRETER_DEFAULTS[task.interpreter.kind] ?? '')
      },
      workingDirectory: local?.workingDirectory ?? null,
      enabled: local?.enabled ?? false
    }
  })
}

/** Applies imported environment definitions while retaining a same-ID local value when the package omitted it. */
function materializeEnvironments(importedVariables, localVariables) {
  const localById = new Map(localVariables.map(variable => [variable.id, variable]))
  return importedVariables.map(({ valueIncluded, ...variable }) => ({
    ...structuredClone(variable),
    value: valueIncluded ? variable.value : (localById.get(variable.id)?.value ?? '')
  }))
}

/** Validates target references, portable paths, and Windows-safe file/folder tree conflicts before replacement. */
function validateImportTarget(target) {
  const scriptIds = new Set(target.scripts.map(script => script.id))
  const taskIds = new Set(target.tasks.map(task => task.id))
  if (target.tasks.some(task => !scriptIds.has(task.scriptId))) throw new RepositoryError('IMPORT_CONFLICT', '导入目标包含悬空脚本引用')
  const names = new Set()
  for (const variable of target.environments) {
    if (variable.scope === 'task' && !taskIds.has(variable.taskId)) throw new RepositoryError('IMPORT_CONFLICT', '导入目标包含悬空任务引用')
    const key = `${variable.scope}\0${variable.taskId ?? ''}\0${variable.name}`
    if (names.has(key)) throw new RepositoryError('IMPORT_CONFLICT', '导入后同一作用域将出现重名环境变量')
    names.add(key)
  }
  const nodes = []
  for (const script of target.scripts) {
    let normalized
    try { normalized = normalizeManagedScriptPath(script.relativePath, script.language) } catch { throw new RepositoryError('IMPORT_CONFLICT', '导入目标包含无效脚本路径') }
    if (normalized !== script.relativePath) throw new RepositoryError('IMPORT_CONFLICT', '导入目标包含非规范脚本路径')
    nodes.push({ kind: 'script', key: normalized.toLowerCase() })
  }
  for (const folder of target.scriptFolders ?? []) {
    let normalized
    try { normalized = normalizeManagedFolderPath(folder.relativePath) } catch { throw new RepositoryError('IMPORT_CONFLICT', '导入目标包含无效脚本目录路径') }
    if (normalized !== folder.relativePath) throw new RepositoryError('IMPORT_CONFLICT', '导入目标包含非规范脚本目录路径')
    nodes.push({ kind: 'folder', key: normalized.toLowerCase() })
  }
  const seen = new Map()
  for (const node of nodes) {
    const conflict = seen.has(node.key) || nodes.some(candidate => candidate !== node && (
      (node.kind === 'script' && candidate.key.startsWith(`${node.key}/`)) ||
      (candidate.kind === 'script' && node.key.startsWith(`${candidate.key}/`))
    ))
    if (conflict) throw new RepositoryError('IMPORT_CONFLICT', '导入目标的脚本与目录路径存在冲突或重复')
    seen.set(node.key, node)
  }
}

/** Converts portable scripts to local paths, preserving 1.1 paths for new scripts and resolving collisions deterministically. */
function materializeScripts(importedScripts, localScripts) {
  const localById = new Map(localScripts.map(script => [script.id, script]))
  const used = new Set(localScripts.map(script => script.relativePath?.toLowerCase()).filter(Boolean))
  return importedScripts.map(script => {
    const local = localById.get(script.id)
    let relativePath = local?.relativePath ?? script.relativePath ?? createManagedScriptPath(script.name, script.language, script.id)
    let counter = 0
    while (!local && used.has(relativePath.toLowerCase())) {
      counter += 1
      const dot = relativePath.lastIndexOf('.')
      relativePath = `${relativePath.slice(0, dot)}-${script.id.slice(0, 8)}${counter > 1 ? `-${counter}` : ''}${relativePath.slice(dot)}`
    }
    used.add(relativePath.toLowerCase())
    const { managedFileName, ...portable } = structuredClone(script)
    return { ...portable, relativePath }
  })
}

/** Builds the complete merge or overwrite target while preserving device fields and omitted secret values. */
function buildImportTarget(snapshot, current, mode) {
  if (!['merge', 'overwrite'].includes(mode)) throw new RepositoryError('VALIDATION_ERROR', '导入模式无效')
  const importedScripts = materializeScripts(snapshot.documents.scripts.data, current.scripts)
  const importedFolders = structuredClone(snapshot.documents.scriptFolders?.data ?? [])
  const importedDependencies = structuredClone(snapshot.documents.dependencies?.data ?? [])
  const importedTasks = materializeTasks(snapshot.documents.tasks.data, current.tasks)
  const importedEnvironments = materializeEnvironments(snapshot.documents.environments.data, current.environments)
  const importedSettings = {
    ...current.settings,
    ...structuredClone(snapshot.documents.settings.data),
    defaultWorkingDirectory: current.settings.defaultWorkingDirectory,
    schedulerNoticeAcknowledged: current.settings.schedulerNoticeAcknowledged
  }
  const target = mode === 'merge'
    ? {
        scripts: mergeById(current.scripts, importedScripts),
        scriptFolders: mergeById(current.scriptFolders ?? [], importedFolders),
        dependencies: mergeById(current.dependencies ?? [], importedDependencies),
        tasks: mergeById(current.tasks, importedTasks),
        environments: mergeById(current.environments, importedEnvironments),
        settings: importedSettings
      }
    : {
        scripts: importedScripts,
        scriptFolders: importedFolders,
        dependencies: importedDependencies,
        tasks: importedTasks,
        environments: importedEnvironments,
        settings: importedSettings
      }
  validateImportTarget(target)
  return target
}

/** Writes a transaction descriptor atomically so startup recovery can identify completed replacement phases. */
function writeDescriptor(transactionDirectory, descriptor) {
  atomicWriteJson(path.join(transactionDirectory, 'transaction.json'), descriptor)
}

/** Restores original data and scripts directories after an interrupted or failed import commit. */
function rollbackTransaction(root, transactionDirectory, descriptor) {
  const dataPath = path.join(root, 'data')
  const scriptsPath = path.join(root, 'scripts')
  const rollbackData = path.join(transactionDirectory, 'rollback-data')
  const rollbackScripts = path.join(transactionDirectory, 'rollback-scripts')
  if (descriptor.dataInstalled) fs.rmSync(dataPath, { recursive: true, force: true })
  if (descriptor.scriptsInstalled) fs.rmSync(scriptsPath, { recursive: true, force: true })
  if (descriptor.dataBackedUp && fs.existsSync(rollbackData)) fs.renameSync(rollbackData, dataPath)
  if (descriptor.scriptsBackedUp && fs.existsSync(rollbackScripts)) fs.renameSync(rollbackScripts, scriptsPath)
}

/** Recovers every uncommitted import transaction before repositories read formal data. */
function recoverImportTransactions(root) {
  const transactionsPath = path.join(root, '.transactions')
  if (!fs.existsSync(transactionsPath)) return
  for (const name of fs.readdirSync(transactionsPath)) {
    const transactionDirectory = path.join(transactionsPath, name)
    const descriptorPath = path.join(transactionDirectory, 'transaction.json')
    try {
      const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'))
      if (!descriptor.committed) rollbackTransaction(root, transactionDirectory, descriptor)
      fs.rmSync(transactionDirectory, { recursive: true, force: true })
    } catch (error) {
      throw new RepositoryError('IMPORT_ROLLBACK_FAILED', '无法恢复未完成的导入事务', error)
    }
  }
}

/** Builds complete target directories, verifies script bytes, and swaps them with rollback protection. */
function commitImportTarget(root, snapshot, target) {
  const transactionsPath = path.join(root, '.transactions')
  const transactionDirectory = path.join(transactionsPath, randomUUID())
  const targetData = path.join(transactionDirectory, 'target-data')
  const targetScripts = path.join(transactionDirectory, 'target-scripts')
  const descriptor = { dataBackedUp: false, scriptsBackedUp: false, dataInstalled: false, scriptsInstalled: false, committed: false }
  try {
    fs.mkdirSync(targetData, { recursive: true, mode: 0o700 })
    fs.mkdirSync(targetScripts, { recursive: true, mode: 0o700 })
    for (const folder of target.scriptFolders ?? []) fs.mkdirSync(path.join(targetScripts, ...folder.relativePath.split('/')), { recursive: true, mode: 0o700 })
    fs.cpSync(path.join(root, 'data'), targetData, { recursive: true, force: true })
    for (const [name, data] of Object.entries(target)) {
      if (name !== 'settings') atomicWriteJson(path.join(targetData, `${name}.json`), { schemaVersion: CURRENT_SCHEMA_VERSION, data })
    }
    atomicWriteJson(path.join(targetData, 'settings.json'), { schemaVersion: CURRENT_SCHEMA_VERSION, data: target.settings })
    const importedIds = new Set(snapshot.documents.scripts.data.map(script => script.id))
    for (const script of target.scripts) {
      const fileName = createManagedScriptFileName(script.id, script.language)
      const source = importedIds.has(script.id)
        ? path.join(snapshot.temporaryDirectory, 'scripts', fileName)
        : path.join(root, 'scripts', ...script.relativePath.split('/'))
      const content = fs.readFileSync(source)
      if (calculateSha256(content) !== script.contentHash) throw new RepositoryError('HASH_MISMATCH', '提交前脚本内容哈希校验失败')
      const targetPath = path.join(targetScripts, ...script.relativePath.split('/'))
      fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 })
      fs.writeFileSync(targetPath, content, { flag: 'wx', mode: 0o600 })
    }
    writeDescriptor(transactionDirectory, descriptor)
    fs.renameSync(path.join(root, 'data'), path.join(transactionDirectory, 'rollback-data'))
    descriptor.dataBackedUp = true; writeDescriptor(transactionDirectory, descriptor)
    fs.renameSync(path.join(root, 'scripts'), path.join(transactionDirectory, 'rollback-scripts'))
    descriptor.scriptsBackedUp = true; writeDescriptor(transactionDirectory, descriptor)
    fs.renameSync(targetData, path.join(root, 'data'))
    descriptor.dataInstalled = true; writeDescriptor(transactionDirectory, descriptor)
    fs.renameSync(targetScripts, path.join(root, 'scripts'))
    descriptor.scriptsInstalled = true; writeDescriptor(transactionDirectory, descriptor)
    descriptor.committed = true; writeDescriptor(transactionDirectory, descriptor)
    fs.rmSync(transactionDirectory, { recursive: true, force: true })
  } catch (error) {
    try { rollbackTransaction(root, transactionDirectory, descriptor) } catch (rollbackError) {
      throw new RepositoryError('IMPORT_ROLLBACK_FAILED', '导入失败且无法恢复原数据', rollbackError)
    }
    try { fs.rmSync(transactionDirectory, { recursive: true, force: true }) } catch {}
    if (error instanceof RepositoryError) throw error
    throw mapFileSystemError(error, 'WRITE_FAILED', '无法提交导入数据')
  }
}

module.exports = {
  buildImportTarget,
  commitImportTarget,
  materializeEnvironments,
  materializeTasks,
  materializeScripts,
  recoverImportTransactions,
  validateImportTarget
}
