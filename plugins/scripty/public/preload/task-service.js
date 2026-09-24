'use strict'

const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { isValidFivePartCron, parseFivePartCron } = require('./cron-utils')
const { isRunnableScriptPath } = require('./file-repositories')
const { createInterpreterResolver } = require('./interpreter-resolver')
const { RepositoryError } = require('./metadata-repository')

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const defaultInterpreterResolver = createInterpreterResolver()

/** Converts a successful preload operation into the stable cross-context result envelope. */
function success(data) {
  return { ok: true, data, requestId: randomUUID() }
}

/** Maps repository and unexpected failures to a serializable error without exposing stack traces or paths. */
function failure(error) {
  const known = error instanceof RepositoryError
  return {
    ok: false,
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : 'Scripty 内部发生未知错误',
      fieldErrors: known ? error.fieldErrors : undefined,
      recoverable: !['DATA_CORRUPTED', 'UNSUPPORTED_DATA_VERSION', 'INTERNAL_ERROR'].includes(
        known ? error.code : 'INTERNAL_ERROR'
      )
    },
    requestId: randomUUID()
  }
}

/** Executes one API operation behind a common exception boundary and always resolves to Result<T>. */
async function invoke(operation) {
  try {
    return success(await operation())
  } catch (error) {
    return failure(error)
  }
}

/** Validates entity IDs at the API boundary before repository access. */
function assertEntityId(id) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new RepositoryError('INVALID_ID', '任务 ID 不是有效的 UUID')
  }
}

/** Resolves an interpreter reference through the shared preload resolver without invoking it. */
function resolveInterpreter(task, interpreterResolver = defaultInterpreterResolver) {
  return interpreterResolver.resolve(task.interpreter?.kind, task.interpreter?.executable)
}

/** Derives the first actionable readiness issue and retains the executable selected by the resolver. */
function evaluateTaskReadiness(task, script, managedScriptRepository, interpreterResolver = defaultInterpreterResolver, dependencyService = null) {
  if (!script || !managedScriptRepository.exists(script, script?.language)) {
    return { readiness: 'script_missing', resolvedExecutable: null }
  }
  const resolvedExecutable = resolveInterpreter(task, interpreterResolver)
  if (!resolvedExecutable) return { readiness: 'interpreter_unavailable', resolvedExecutable: null }
  if (!isValidFivePartCron(task.cron)) return { readiness: 'invalid_cron', resolvedExecutable: null }
  if (task.workingDirectory) {
    try {
      if (!fs.statSync(task.workingDirectory).isDirectory()) {
        return { readiness: 'invalid_working_directory', resolvedExecutable: null }
      }
    } catch {
      return { readiness: 'invalid_working_directory', resolvedExecutable: null }
    }
  }
  return { readiness: 'ready', resolvedExecutable }
}

/** Returns the public readiness state without exposing the resolved device-local executable path. */
function getTaskReadiness(task, script, managedScriptRepository, interpreterResolver = defaultInterpreterResolver, dependencyService = null) {
  return evaluateTaskReadiness(task, script, managedScriptRepository, interpreterResolver, dependencyService).readiness
}

/** Validates and normalizes the editable task fields before they enter persistent storage. */
function normalizeTaskDraft(input, scripts) {
  const fieldErrors = {}
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 100) fieldErrors.name = '任务名称应为 1 到 100 个字符'
  const selectedScript = typeof input?.scriptId === 'string'
    ? scripts.find(script => script.id === input.scriptId)
    : undefined
  if (!selectedScript) {
    fieldErrors.scriptId = '请选择已存在的托管脚本'
  } else if (!isRunnableScriptPath(selectedScript.relativePath)) {
    // 新建脚本已放开扩展名限制,但任务只能引用扩展名受支持(可执行)的脚本。
    fieldErrors.scriptId = '所选脚本的扩展名不受支持,无法作为任务运行'
  }
  const kind = input?.interpreter?.kind
  if (!['javascript', 'python', 'powershell', 'shell'].includes(kind)) {
    fieldErrors['interpreter.kind'] = '请选择受支持的解释器类型'
  }
  const executable = typeof input?.interpreter?.executable === 'string'
    ? input.interpreter.executable.trim()
    : ''
  if (!executable || executable.length > 1000) {
    fieldErrors['interpreter.executable'] = '解释器命令或路径不能为空'
  }
  if (!Array.isArray(input?.args) || input.args.length > 100 || input.args.some(argument => typeof argument !== 'string' || argument.length > 2000)) {
    fieldErrors.args = '参数必须是不超过 100 项、每项不超过 2000 字符的字符串数组'
  }
  if (input?.workingDirectory !== null && input?.workingDirectory !== undefined && typeof input.workingDirectory !== 'string') {
    fieldErrors.workingDirectory = '工作目录必须是路径字符串或留空'
  }
  if (typeof input?.workingDirectory === 'string' && input.workingDirectory.length > 2000) {
    fieldErrors.workingDirectory = '工作目录路径过长'
  }
  if (input?.timeoutMs !== null && input?.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 86400000)) {
    fieldErrors.timeoutMs = '超时必须是 1 秒到 24 小时之间的整数毫秒数'
  }
  if (!isValidFivePartCron(input?.cron ?? null)) fieldErrors.cron = 'Cron 必须是有效的五段表达式'
  const policy = input?.concurrency?.policy
  const limit = input?.concurrency?.limit
  if (!['forbid', 'limited'].includes(policy) || !Number.isInteger(limit) || limit < 1) {
    fieldErrors.concurrency = '并发配置无效'
  }
  if (Object.keys(fieldErrors).length > 0) {
    const error = new RepositoryError('VALIDATION_ERROR', '任务配置不完整')
    error.fieldErrors = fieldErrors
    throw error
  }

  return {
    name,
    note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '',
    scriptId: input.scriptId,
    interpreter: { kind, executable },
    args: input.args.slice(),
    workingDirectory: typeof input.workingDirectory === 'string' && input.workingDirectory.trim() ? input.workingDirectory.trim() : null,
    cron: input.cron?.trim() || null,
    timeoutMs: input.timeoutMs ?? null,
    enabled: Boolean(input.enabled),
    concurrency: { policy, limit: policy === 'forbid' ? 1 : limit }
  }
}

/** Builds the read-only script summary API needed by task forms without exposing source contents. */
function createScriptSummariesApi(metadataRepository) {
  return {
    /** Returns script metadata summaries, optionally filtered by search text and language. */
    list(query = {}) {
      return invoke(() => {
        const search = typeof query.search === 'string' ? query.search.trim().toLocaleLowerCase() : ''
        return metadataRepository.read('scripts')
          .filter(script => !query.language || script.language === query.language)
          .filter(script => !search || `${script.name} ${script.note}`.toLocaleLowerCase().includes(search))
          .map(({ contentHash, ...summary }) => summary)
      })
    }
  }
}

/** Creates a no-op scheduler adapter so isolated repositories retain their prior non-scheduling behavior. */
function createNoopScheduler() {
  return {
    prepareTask: task => ({ taskId: task.id, state: 'prepared' }),
    prepareRemoval: taskId => ({ taskId, state: 'prepared' }),
    commit() {},
    abort() {},
    getNextRunAt: () => null
  }
}

/** Builds the task API with shared interpreter resolution while keeping raw repository objects inside preload. */
function createTasksApi(metadataRepository, managedScriptRepository, scheduler = createNoopScheduler(), interpreterResolver = defaultInterpreterResolver, dependencyService = null) {
  /** Persists a complete task collection and commits its prepared schedule only after storage succeeds. */
  function persistTaskChange(nextTasks, scheduleTask, removedTaskId = null) {
    const change = removedTaskId
      ? scheduler.prepareRemoval(removedTaskId)
      : scheduler.prepareTask(scheduleTask)
    try {
      metadataRepository.write('tasks', nextTasks)
    } catch (error) {
      scheduler.abort(change)
      throw error
    }
    scheduler.commit(change)
  }

  /** Loads tasks and scripts together so every row includes its display name and derived readiness. */
  function loadSummaries() {
    const tasks = metadataRepository.read('tasks')
    const scripts = metadataRepository.read('scripts')
    const scriptsById = new Map(scripts.map(script => [script.id, script]))
    return tasks.map(task => {
      const script = scriptsById.get(task.scriptId)
      return {
        ...task,
        scriptName: script?.name ?? '脚本已缺失',
        readiness: getTaskReadiness(task, script, managedScriptRepository, interpreterResolver, dependencyService),
        nextRunAt: scheduler.getNextRunAt(task.id),
        activeRunCount: 0
      }
    })
  }

  /** Returns one fresh summary or raises NOT_FOUND for stale renderer state. */
  function loadSummary(id) {
    const summary = loadSummaries().find(task => task.id === id)
    if (!summary) throw new RepositoryError('NOT_FOUND', '任务不存在')
    return summary
  }

  return {
    /** Returns task summaries filtered by normalized search text, enabled state, and exact readiness. */
    list(query = {}) {
      return invoke(() => {
        const search = typeof query.search === 'string' ? query.search.trim().toLocaleLowerCase() : ''
        return loadSummaries().filter(task => {
          if (search && !`${task.name} ${task.note} ${task.scriptName}`.toLocaleLowerCase().includes(search)) {
            return false
          }
          if (typeof query.enabled === 'boolean' && task.enabled !== query.enabled) return false
          if (query.readiness && task.readiness !== query.readiness) return false
          return true
        })
      })
    },

    /** Returns one task with its referenced script metadata for edit-form hydration. */
    get(id) {
      return invoke(() => {
        assertEntityId(id)
        const task = metadataRepository.read('tasks').find(item => item.id === id)
        if (!task) throw new RepositoryError('NOT_FOUND', '任务不存在')
        const script = metadataRepository.read('scripts').find(item => item.id === task.scriptId)
        if (!script) throw new RepositoryError('REFERENCE_CONFLICT', '任务引用的脚本不存在')
        return { ...loadSummary(id), script }
      })
    },

    /** Creates a validated task with a server-generated UUID and immutable creation timestamp. */
    create(input) {
      return invoke(() => {
        const scripts = metadataRepository.read('scripts')
        const normalized = normalizeTaskDraft(input, scripts)
        const now = new Date().toISOString()
        const task = { id: randomUUID(), ...normalized, createdAt: now, updatedAt: now }
        persistTaskChange([...metadataRepository.read('tasks'), task], task)
        return loadSummary(task.id)
      })
    },

    /** Replaces editable fields while preserving task identity and creation time. */
    update(id, input) {
      return invoke(() => {
        assertEntityId(id)
        const tasks = metadataRepository.read('tasks')
        const index = tasks.findIndex(task => task.id === id)
        if (index < 0) throw new RepositoryError('NOT_FOUND', '任务不存在')
        const normalized = normalizeTaskDraft(input, metadataRepository.read('scripts'))
        const updated = { ...tasks[index], ...normalized, updatedAt: new Date().toISOString() }
        const nextTasks = tasks.slice()
        nextTasks[index] = updated
        persistTaskChange(nextTasks, updated)
        return loadSummary(id)
      })
    },

    /** Copies one task as disabled with a new UUID so duplication never starts scheduling silently. */
    duplicate(id) {
      return invoke(() => {
        assertEntityId(id)
        const tasks = metadataRepository.read('tasks')
        const source = tasks.find(task => task.id === id)
        if (!source) throw new RepositoryError('NOT_FOUND', '任务不存在')
        const now = new Date().toISOString()
        const duplicate = {
          ...source,
          id: randomUUID(),
          name: `${source.name} 副本`.slice(0, 100),
          enabled: false,
          createdAt: now,
          updatedAt: now
        }
        persistTaskChange([...tasks, duplicate], duplicate)
        return loadSummary(duplicate.id)
      })
    },

    /** Deletes one task only when no task-scoped environment variables still reference it. */
    remove(id) {
      return invoke(() => {
        assertEntityId(id)
        const tasks = metadataRepository.read('tasks')
        if (!tasks.some(task => task.id === id)) throw new RepositoryError('NOT_FOUND', '任务不存在')
        const referenced = metadataRepository.read('environments').some(variable => variable.taskId === id)
        if (referenced) throw new RepositoryError('REFERENCE_CONFLICT', '任务仍被环境变量引用，无法删除')
        persistTaskChange(tasks.filter(task => task.id !== id), null, id)
      })
    },

    /** Validates a task draft and reports its first runtime readiness issue without persisting it. */
    validate(input) {
      return invoke(() => {
        const scripts = metadataRepository.read('scripts')
        const normalized = normalizeTaskDraft(input, scripts)
        const script = scripts.find(item => item.id === normalized.scriptId)
        const readiness = getTaskReadiness(normalized, script, managedScriptRepository, interpreterResolver)
        return { valid: readiness === 'ready', readiness, fieldErrors: {} }
      })
    },

    /** Parses one five-field Cron and returns the next five local schedule instants. */
    previewSchedule(cron) {
      return invoke(() => {
        const expression = parseFivePartCron(cron)
        if (!expression) throw new RepositoryError('INVALID_CRON', 'Cron 表达式无效')
        return { cron: cron.trim(), nextRuns: Array.from({ length: 5 }, () => expression.next().toISOString()) }
      })
    },

    /** Atomically updates one task's enabled flag and timestamp, then returns its fresh derived summary. */
    setEnabled(id, enabled) {
      return invoke(() => {
        assertEntityId(id)
        if (typeof enabled !== 'boolean') {
          throw new RepositoryError('VALIDATION_ERROR', 'enabled 必须是布尔值')
        }
        const tasks = metadataRepository.read('tasks')
        const index = tasks.findIndex(task => task.id === id)
        if (index < 0) throw new RepositoryError('NOT_FOUND', '任务不存在')
        const updated = {
          ...tasks[index],
          enabled,
          updatedAt: new Date().toISOString()
        }
        const nextTasks = tasks.slice()
        nextTasks[index] = updated
        persistTaskChange(nextTasks, updated)
        return loadSummary(id)
      })
    }
  }
}

module.exports = {
  createScriptSummariesApi,
  createTasksApi,
  evaluateTaskReadiness,
  failure,
  getTaskReadiness,
  invoke,
  isValidFivePartCron,
  normalizeTaskDraft,
  parseFivePartCron,
  resolveInterpreter,
  success
}
