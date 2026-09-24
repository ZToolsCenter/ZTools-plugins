'use strict'

const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { setTimeout, clearTimeout } = require('node:timers')
const { buildTaskEnvironment } = require('./environment-service')
const { createInterpreterResolver } = require('./interpreter-resolver')
const { RepositoryError } = require('./metadata-repository')
const { SensitiveStreamMasker } = require('./sensitive-masker')
const { evaluateTaskReadiness, invoke } = require('./task-service')

const STOP_TIMEOUT_MS = 10000
const TERMINATION_CONFIRM_MS = 1000
const FINALIZATION_WRITE_ATTEMPTS = 2
const SCHEDULED_TRIGGER_TOKEN = Symbol('scheduled-trigger')
const defaultInterpreterResolver = createInterpreterResolver()

/** Formats the current local time as `yyyy-mm-dd hh:mm:ss` for log-line prefixes. */
function logTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Sends one process-tree signal without a shell, using forced taskkill semantics on Windows. */
function signalProcessTree(child, signal, platform = process.platform, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    if (!child?.pid) return reject(new RepositoryError('STOP_FAILED', '运行进程没有有效 PID'))
    if (platform === 'win32') {
      const killer = spawnProcess('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
      let stderr = ''
      killer.stderr?.on('data', chunk => { stderr += chunk.toString('utf8') })
      killer.once('error', error => reject(new RepositoryError('STOP_FAILED', '无法启动 Windows 进程树清理', error)))
      killer.once('exit', code => code === 0 ? resolve() : reject(new RepositoryError('STOP_FAILED', stderr.trim() || 'Windows 进程树清理失败')))
      return
    }
    try {
      process.kill(-child.pid, signal)
      resolve()
    } catch (groupError) {
      try {
        if (!child.kill(signal)) throw groupError
        resolve()
      } catch (error) {
        reject(new RepositoryError('STOP_FAILED', '无法终止进程树', error))
      }
    }
  })
}

/** Terminates a process tree gracefully while preserving the original public helper contract. */
function terminateProcessTree(child, platform = process.platform, spawnProcess = spawn) {
  return signalProcessTree(child, 'SIGTERM', platform, spawnProcess)
}

/** Atomically recovers records left non-terminal by a previous preload or ZTools shutdown. */
function recoverInterruptedRuns(metadataRepository, timestamp = new Date().toISOString()) {
  const records = metadataRepository.read('runRecords')
  let changed = false
  const recovered = records.map(record => {
    if (!['starting', 'running'].includes(record.status)) return record
    changed = true
    return {
      ...record,
      status: 'interrupted',
      finishedAt: timestamp,
      durationMs: Math.max(0, Date.parse(timestamp) - Date.parse(record.startedAt)),
      exitCode: null,
      errorSummary: '插件或 ZTools 在任务运行期间退出'
    }
  })
  if (changed) metadataRepository.write('runRecords', recovered)
  return recovered.filter(record => record.status === 'interrupted')
}

/** Builds process execution with shared interpreter resolution and isolated dependency environments. */
function createRunService(metadataRepository, managedScriptRepository, logFileRepository, spawnProcess = spawn, platform = process.platform, timers = { setTimeout, clearTimeout }, interpreterResolver = defaultInterpreterResolver, dependencyService = null) {
  const activeRuns = new Map()
  const startReservations = new Map()
  const listeners = new Set()

  /** Atomically reserves one task concurrency slot before asynchronous spawn events can race another start. */
  function reserveTaskSlot(task) {
    const activeCount = Array.from(activeRuns.values()).filter(run => run.record.taskId === task.id).length
    const reservedCount = startReservations.get(task.id) ?? 0
    const currentCount = activeCount + reservedCount
    const limit = task.concurrency.policy === 'forbid' ? 1 : task.concurrency.limit
    if (currentCount >= limit) {
      throw new RepositoryError(task.concurrency.policy === 'forbid' ? 'RUN_ALREADY_ACTIVE' : 'RUN_LIMIT_REACHED', task.concurrency.policy === 'forbid' ? '任务正在运行，禁止重入' : '任务已达到并发上限')
    }
    startReservations.set(task.id, reservedCount + 1)
  }

  /** Releases one pending-start reservation after ownership moves to an active run or startup fails. */
  function releaseTaskSlot(taskId) {
    const count = startReservations.get(taskId) ?? 0
    if (count <= 1) startReservations.delete(taskId)
    else startReservations.set(taskId, count - 1)
  }

  /** Broadcasts one ordered serializable event without letting listener failures break process handling. */
  function emitEvent(event) {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {}
    }
  }

  /** Persists a new or changed run record by replacing its ID-matched entry atomically. */
  function persistRun(record) {
    const records = metadataRepository.read('runRecords')
    const index = records.findIndex(item => item.id === record.id)
    const next = records.slice()
    if (index < 0) next.push(record)
    else next[index] = record
    metadataRepository.write('runRecords', next)
  }

  /** Appends one bounded stream chunk to the run log and broadcasts it with a monotonic sequence. */
  function handleOutput(runId, type, chunk) {
    const active = activeRuns.get(runId)
    if (!active || active.finalized) return
    try {
      const content = active.maskers[type].push(chunk.toString('utf8'))
      if (!content) return
      logFileRepository.append(runId, `${logTimestamp()} [${type}] ${content}`)
      active.sequence += 1
      emitEvent({ type, runId, sequence: active.sequence, chunk: content })
    } catch {
      active.errorSummary = active.errorSummary ?? '写入运行日志失败'
    }
  }

  /** Flushes both masked stream suffixes while recording the first log error without aborting cleanup. */
  function flushOutput(active) {
    for (const type of ['stdout', 'stderr']) {
      try {
        const remainder = active.maskers[type].flush()
        if (!remainder) continue
        logFileRepository.append(active.record.id, `${logTimestamp()} [${type}] ${remainder}`)
        active.sequence += 1
        emitEvent({ type, runId: active.record.id, sequence: active.sequence, chunk: remainder })
      } catch {
        active.errorSummary = active.errorSummary ?? '写入运行日志失败'
      }
    }
  }

  /** Converts unexpected lifecycle failures while preserving stable repository errors and their causes. */
  function normalizeLifecycleError(error, fallbackCode, message) {
    return error instanceof RepositoryError ? error : new RepositoryError(fallbackCode, message, error)
  }

  /** Rejects any unsettled start or stop call when a terminal record cannot be committed. */
  function rejectPendingOperations(active, error) {
    if (!active.startSettled) {
      active.startSettled = true
      active.startReject(error)
    }
    if (active.stopReject && !active.stopSettled) {
      active.stopSettled = true
      active.stopReject(error)
    }
  }

  /** Clears every lifecycle timer associated with an active run before its terminal record is prepared. */
  function clearRunTimers(active) {
    for (const handle of [active.timeoutHandle, active.forceHandle, active.confirmHandle]) {
      if (handle !== null && handle !== undefined) timers.clearTimeout(handle)
    }
    active.timeoutHandle = null
    active.forceHandle = null
    active.confirmHandle = null
  }

  /** Builds a terminal record from the first stop/timeout decision, startup error, process error, or exit result. */
  function buildFinishedRecord(active, code, fallbackSummary) {
    const finishedAt = new Date().toISOString()
    const decidedStatus = active.terminalDecision
    const status = decidedStatus ?? (active.startError || active.processError ? 'failed' : code === 0 ? 'success' : 'failed')
    const processSummary = active.processError
      ? active.spawned ? `运行进程异常：${active.processError.message}` : '无法启动解释器'
      : null
    return {
      ...active.record,
      status,
      exitCode: Number.isInteger(code) && !decidedStatus && !active.startError && !active.processError ? code : null,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(active.record.startedAt)),
      errorSummary: active.errorSummary ?? processSummary ?? fallbackSummary ?? active.record.errorSummary
    }
  }

  /** Commits one cached terminal record with a bounded transient retry before publishing and releasing state. */
  function finalizeRun(runId, code = null, fallbackSummary = null) {
    const active = activeRuns.get(runId)
    if (!active || active.finalized) return active?.finishedRecord ?? null
    if (!active.finishedRecord) {
      clearRunTimers(active)
      flushOutput(active)
      active.finishedRecord = buildFinishedRecord(active, code, fallbackSummary)
    }
    let persistenceError = null
    for (let attempt = 0; attempt < FINALIZATION_WRITE_ATTEMPTS; attempt += 1) {
      try {
        persistRun(active.finishedRecord)
        persistenceError = null
        break
      } catch (error) {
        persistenceError = normalizeLifecycleError(error, 'WRITE_FAILED', '无法持久化最终运行状态')
      }
    }
    if (persistenceError) {
      active.finalizationError = persistenceError
      rejectPendingOperations(active, persistenceError)
      return null
    }

    active.finalized = true
    active.finalizationError = null
    activeRuns.delete(runId)
    active.sequence += 1
    emitEvent({ type: 'finished', runId, sequence: active.sequence, record: active.finishedRecord })
    if (active.stopResolver && !active.stopSettled) {
      active.stopSettled = true
      active.stopResolver(active.finishedRecord)
    }
    if (!active.startSettled) {
      active.startSettled = true
      const startupError = active.startError ?? new RepositoryError('SPAWN_FAILED', active.finishedRecord.errorSummary ?? '无法启动解释器', active.processError)
      active.startReject(startupError)
    }
    return active.finishedRecord
  }

  /** Escalates an unresponsive stop or timeout to forced termination, then guarantees bounded finalization. */
  function scheduleForcedTermination(runId) {
    const active = activeRuns.get(runId)
    if (!active || active.finalized || active.forceHandle !== null) return
    active.forceHandle = timers.setTimeout(async () => {
      const current = activeRuns.get(runId)
      if (!current || current.finalized) return
      try {
        await signalProcessTree(current.child, 'SIGKILL', platform, spawnProcess)
      } catch {
        current.errorSummary = current.errorSummary ?? '无法确认进程树已强制终止'
      }
      if (!activeRuns.has(runId)) return
      current.confirmHandle = timers.setTimeout(() => {
        finalizeRun(runId, null, current.errorSummary ?? '进程终止后未返回退出状态')
      }, TERMINATION_CONFIRM_MS)
    }, STOP_TIMEOUT_MS)
  }

  /** Gives the first explicit stop or timeout decision priority and starts process-tree termination. */
  async function requestTermination(runId, decision = null) {
    const active = activeRuns.get(runId)
    if (!active || active.finalized) return active?.finishedRecord ?? null
    if (decision && !active.terminalDecision) active.terminalDecision = decision
    try {
      scheduleForcedTermination(runId)
    } catch (error) {
      active.errorSummary = active.errorSummary ?? `无法安排进程强制终止：${error.message}`
    }
    try {
      await terminateProcessTree(active.child, platform, spawnProcess)
    } catch {
      active.errorSummary = active.errorSummary ?? '无法确认进程树已终止'
    }
    return null
  }

  /** Starts the effective task timeout after spawn and delegates bounded termination to the shared state machine. */
  function scheduleTimeout(runId, timeoutMs) {
    return timers.setTimeout(() => requestTermination(runId, 'timed_out'), timeoutMs)
  }

  /** Resolves persisted entities and one launch path before any child process or run artifact is created. */
  function resolveRunnableTask(taskId) {
    const task = metadataRepository.read('tasks').find(item => item.id === taskId)
    if (!task) throw new RepositoryError('NOT_FOUND', '任务不存在')
    const script = metadataRepository.read('scripts').find(item => item.id === task.scriptId)
    const evaluation = evaluateTaskReadiness(task, script, managedScriptRepository, interpreterResolver, dependencyService)
    let resolvedExecutable = evaluation.resolvedExecutable
    if (evaluation.readiness === 'ready' && dependencyService) {
      resolvedExecutable = dependencyService.resolveRuntime(script.language, resolvedExecutable)
      if (!resolvedExecutable) throw new RepositoryError('DEPENDENCY_ENVIRONMENT_MISSING', 'Python 依赖环境尚未同步，请先在依赖页同步')
    }
    if (evaluation.readiness !== 'ready') {
      const code = evaluation.readiness === 'script_missing'
        ? 'SCRIPT_MISSING'
        : evaluation.readiness === 'interpreter_unavailable'
          ? 'INTERPRETER_UNAVAILABLE'
          : evaluation.readiness === 'invalid_cron'
            ? 'INVALID_CRON'
            : 'PATH_NOT_ALLOWED'
      throw new RepositoryError(code, '任务配置当前不可运行')
    }
    return { task, script, resolvedExecutable }
  }

  const api = {
    /**
     * Starts one persisted task using executable plus an argument array and returns once spawn emits.
     * The run record snapshots the script's full filename (including extension) for historical details.
     * The renderer cannot provide an executable, source path, command string, shell option, or Cron trigger.
     */
    start(taskId, trigger = 'manual', scheduledToken) {
      return invoke(async () => {
        const publicTrigger = ['manual', 'retry'].includes(trigger)
        const scheduledTrigger = trigger === 'cron' && scheduledToken === SCHEDULED_TRIGGER_TOKEN
        if (!publicTrigger && !scheduledTrigger) throw new RepositoryError('VALIDATION_ERROR', '运行触发来源无效')
        // Best-effort: refresh the interpreter cache from the user's login-shell PATH before launch so
        // interpreters installed via version managers resolve even when they were absent at startup.
        const pending = metadataRepository.read('tasks').find(item => item.id === taskId)
        if (pending?.interpreter?.kind && typeof pending.interpreter.executable === 'string') {
          try {
            await interpreterResolver.resolveAsync(pending.interpreter.kind, pending.interpreter.executable)
          } catch {}
        }
        return new Promise((resolve, reject) => {
        const { task, script, resolvedExecutable } = resolveRunnableTask(taskId)
        reserveTaskSlot(task)
        const runId = randomUUID()
        const startedAt = new Date().toISOString()
        let record
        let scriptPath
        let spawnOptions
        let sensitiveValues
        let effectiveTimeoutMs
        let logCreated = false
        try {
          effectiveTimeoutMs = task.timeoutMs ?? metadataRepository.read('settings').defaultTimeoutMs
          scriptPath = managedScriptRepository.getFilePath(script, script.language)
          const environments = metadataRepository.read('environments')
          const taskEnvironment = buildTaskEnvironment(process.env, environments, task.id)
          if (process.env.PATH !== undefined) taskEnvironment.PATH = process.env.PATH
          spawnOptions = {
            cwd: task.workingDirectory ?? managedScriptRepository.scriptsDirectory,
            env: dependencyService ? dependencyService.buildRuntimeEnvironment(script.language, taskEnvironment) : taskEnvironment,
            shell: false,
            detached: platform !== 'win32',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          }
          sensitiveValues = environments
            .filter(variable => variable.enabled && variable.sensitive && (variable.scope === 'global' || variable.taskId === task.id))
            .map(variable => variable.value)
          record = {
            id: runId,
            taskId: task.id,
            taskNameSnapshot: task.name,
            scriptNameSnapshot: script.relativePath.split('/').pop() || script.name,
            trigger,
            startedAt,
            finishedAt: null,
            status: 'starting',
            exitCode: null,
            durationMs: null,
            logFileName: logFileRepository.create(runId),
            errorSummary: null
          }
          logCreated = true
          persistRun(record)
        } catch (error) {
          if (logCreated) {
            try { logFileRepository.remove(runId) } catch {}
          }
          releaseTaskSlot(task.id)
          return reject(error)
        }

        let child
        try {
          child = spawnProcess(resolvedExecutable, [scriptPath, ...task.args], spawnOptions)
        } catch (error) {
          const finishedAt = new Date().toISOString()
          const failed = { ...record, status: 'failed', finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), errorSummary: '无法启动解释器' }
          let persistenceError = null
          try {
            persistRun(failed)
          } catch (writeError) {
            persistenceError = normalizeLifecycleError(writeError, 'WRITE_FAILED', '无法记录解释器启动失败状态')
          }
          releaseTaskSlot(task.id)
          return reject(persistenceError ?? new RepositoryError('SPAWN_FAILED', '无法启动解释器', error))
        }

        const active = {
          child,
          record,
          sequence: 0,
          maskers: { stdout: new SensitiveStreamMasker(sensitiveValues), stderr: new SensitiveStreamMasker(sensitiveValues) },
          timeoutHandle: null,
          forceHandle: null,
          confirmHandle: null,
          terminalDecision: null,
          processError: null,
          startError: null,
          observedExitCode: null,
          exitObserved: false,
          errorSummary: null,
          finalizationError: null,
          finalized: false,
          spawned: false,
          startSettled: false,
          startReject: reject,
          stopResolver: null,
          stopReject: null,
          stopSettled: false,
          stopPromise: null,
          finishedRecord: null
        }
        activeRuns.set(runId, active)
        releaseTaskSlot(task.id)

        /** Persists the running transition before exposing it, and terminates an untrackable child on failure. */
        function handleChildSpawn() {
          if (active.finalized || active.spawned) return
          active.spawned = true
          const running = { ...record, status: 'running' }
          try {
            persistRun(running)
          } catch (error) {
            active.startError = normalizeLifecycleError(error, 'WRITE_FAILED', '无法记录运行状态')
            active.errorSummary = active.startError.message
            void requestTermination(runId)
            return
          }
          active.record = running
          try {
            active.timeoutHandle = scheduleTimeout(runId, effectiveTimeoutMs)
          } catch (error) {
            active.startError = normalizeLifecycleError(error, 'INTERNAL_ERROR', '无法启动运行超时监控')
            active.errorSummary = active.startError.message
            void requestTermination(runId)
            return
          }
          active.sequence = 1
          emitEvent({ type: 'status', runId, sequence: active.sequence, status: 'running', record: { ...running, pid: child.pid, sequence: active.sequence } })
          active.startSettled = true
          resolve(running)
        }

        /** Converts child-process errors before or after spawn into one failed terminal record. */
        function handleChildError(error) {
          if (active.finalized) return
          active.processError = error
          finalizeRun(runId)
        }

        /** Records native exit evidence while retaining the run until stdio closure confirms output is drained. */
        function handleChildExit(code) {
          active.exitObserved = true
          active.observedExitCode = code
        }

        /** Finalizes after stdio closure using any earlier exit code, or the close code as its fallback. */
        function handleChildClose(code) {
          const observedCode = active.exitObserved ? active.observedExitCode : code
          finalizeRun(runId, observedCode, '运行进程关闭但未返回退出状态')
        }

        child.stdout?.on('data', chunk => handleOutput(runId, 'stdout', chunk))
        child.stderr?.on('data', chunk => handleOutput(runId, 'stderr', chunk))
        child.once('spawn', handleChildSpawn)
        child.once('error', handleChildError)
        child.once('exit', handleChildExit)
        child.once('close', handleChildClose)
        })
      })
    },

    /** Requests bounded process-tree termination and reports terminal commit failures through the result envelope. */
    stop(runId) {
      return invoke(async () => {
        const active = activeRuns.get(runId)
        if (!active) throw new RepositoryError('RUN_NOT_ACTIVE', '运行已结束或不存在')
        if (active.finalizationError) throw active.finalizationError
        if (!active.stopPromise) {
          active.stopPromise = new Promise((resolve, reject) => {
            active.stopResolver = resolve
            active.stopReject = reject
          })
          await requestTermination(runId, 'stopped')
        }
        return await active.stopPromise
      })
    },

    /** Returns serializable active-run snapshots without exposing child process handles. */
    getActive() {
      return invoke(() => Array.from(activeRuns.values(), ({ child, record, sequence }) => ({ ...record, pid: child.pid, sequence })))
    },

    /** Registers one renderer listener and returns an idempotent unsubscribe callback. */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }

  return {
    api,
    /** Starts a persisted task with an unforgeable Cron trigger for preload scheduler use only. */
    startScheduled(taskId) {
      return api.start(taskId, 'cron', SCHEDULED_TRIGGER_TOKEN)
    }
  }
}

/** Preserves the original renderer-facing factory while keeping scheduled starts private. */
function createRunsApi(...args) {
  return createRunService(...args).api
}

module.exports = { STOP_TIMEOUT_MS, TERMINATION_CONFIRM_MS, createRunService, createRunsApi, recoverInterruptedRuns, signalProcessTree, terminateProcessTree }
