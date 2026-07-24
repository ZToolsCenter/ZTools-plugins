'use strict'

const { setTimeout, clearTimeout } = require('node:timers')
const { parseFivePartCron } = require('./cron-utils')
const { RepositoryError } = require('./metadata-repository')

const MAX_TIMER_DELAY_MS = 2147483647
const CLOCK_RECHECK_INTERVAL_MS = 60000
const OCCURRENCE_DEDUPE_LIMIT = 1024

/** Returns the host's current IANA zone and UTC offset for local-time Cron reconciliation. */
function getDefaultTimezone(date) {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    offsetMinutes: date.getTimezoneOffset()
  }
}

/**
 * Creates an in-memory Cron scheduler that periodically reconciles wall-clock and timezone changes.
 * Prepared changes remain isolated until metadata persistence succeeds and commit publishes them.
 */
function createSchedulerService({
  startScheduledRun,
  now = () => new Date(),
  getTimezone = getDefaultTimezone,
  setTimeout: scheduleTimeout = setTimeout,
  clearTimeout: cancelTimeout = clearTimeout,
  maxTimerDelayMs = MAX_TIMER_DELAY_MS,
  clockRecheckIntervalMs = CLOCK_RECHECK_INTERVAL_MS,
  dedupeLimit = OCCURRENCE_DEDUPE_LIMIT
}) {
  const schedules = new Map()
  const claimedOccurrences = new Map()
  const statusListeners = new Set()
  let state = 'created'
  let lastPublishedStatus = 'unavailable'

  /** Returns the injected current instant as a Date and rejects invalid clock implementations. */
  function currentDate() {
    const value = now()
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) throw new RepositoryError('SCHEDULER_UNAVAILABLE', '调度器时钟不可用')
    return date
  }

  /** Captures a validated timezone fingerprint used to detect zone or DST offset changes. */
  function timezoneSnapshot(date) {
    const value = getTimezone(date) ?? {}
    const timeZone = typeof value.timeZone === 'string' && value.timeZone ? value.timeZone : null
    const offsetMinutes = Number(value.offsetMinutes)
    if (!Number.isFinite(offsetMinutes)) throw new RepositoryError('SCHEDULER_UNAVAILABLE', '调度器时区不可用')
    return { timeZone, offsetMinutes, key: `${timeZone ?? 'local'}|${offsetMinutes}` }
  }

  /** Computes the first Cron occurrence strictly after one sampled instant in its sampled timezone. */
  function getNextDate(cron, from, timezone) {
    const options = { currentDate: from }
    if (timezone.timeZone) options.tz = timezone.timeZone
    const expression = parseFivePartCron(cron, options)
    if (!expression) throw new RepositoryError('INVALID_CRON', 'Cron 表达式无效')
    const next = expression.next().toDate()
    if (next.getTime() <= from.getTime()) throw new RepositoryError('SCHEDULER_UNAVAILABLE', 'Cron 未返回未来计划时间')
    return next
  }

  /** Cancels only an entry's current timer handle without retiring the entry itself. */
  function clearHandle(entry) {
    if (!entry || entry.timeoutHandle === null) return
    try { cancelTimeout(entry.timeoutHandle) } catch {}
    entry.timeoutHandle = null
  }

  /** Permanently retires an entry; identity checks also neutralize callbacks that cannot be cancelled. */
  function retireEntry(entry) {
    if (!entry) return
    entry.cancelled = true
    clearHandle(entry)
  }

  /** Arms one reconciliation wake-up bounded by the target, platform limit, and clock-check interval. */
  function armEntry(entry, sampledNow = currentDate()) {
    clearHandle(entry)
    const remaining = Math.max(0, entry.nextRunAt.getTime() - sampledNow.getTime())
    const delay = Math.min(remaining, maxTimerDelayMs, clockRecheckIntervalMs)
    entry.timeoutHandle = scheduleTimeout(() => handleTimer(entry), delay)
    entry.elapsedBeforeCommit = false
  }

  /** Creates and arms an uncommitted candidate from one consistent time and timezone sample. */
  function createCandidate(taskId, cron, sampledNow = currentDate(), timezone = timezoneSnapshot(sampledNow)) {
    const candidate = {
      taskId,
      cron,
      nextRunAt: getNextDate(cron, sampledNow, timezone),
      timezoneKey: timezone.key,
      timeoutHandle: null,
      committed: false,
      cancelled: false,
      elapsedBeforeCommit: false
    }
    try {
      armEntry(candidate, sampledNow)
      return candidate
    } catch (error) {
      retireEntry(candidate)
      if (error instanceof RepositoryError) throw error
      throw new RepositoryError('SCHEDULER_UNAVAILABLE', '无法创建任务计划', error)
    }
  }

  /** Publishes a replacement future entry and retires the former current entry. */
  function replaceCurrentEntry(entry, sampledNow, timezone) {
    const replacement = createCandidate(entry.taskId, entry.cron, sampledNow, timezone)
    replacement.committed = true
    schedules.set(entry.taskId, replacement)
    retireEntry(entry)
    return replacement
  }

  /** Claims one logical task occurrence before execution and evicts oldest keys at the fixed memory bound. */
  function claimOccurrence(taskId, scheduledAt) {
    const key = `${taskId}|${scheduledAt.toISOString()}`
    if (claimedOccurrences.has(key)) return false
    claimedOccurrences.set(key, true)
    while (claimedOccurrences.size > dedupeLimit) {
      claimedOccurrences.delete(claimedOccurrences.keys().next().value)
    }
    return true
  }

  /**
   * Reconciles one timer callback against current time and timezone, skipping unbounded catch-up.
   * An elapsed entry installs exactly one future entry before its deduplicated run is started.
   */
  function handleTimer(entry) {
    entry.timeoutHandle = null
    if (state !== 'running' || entry.cancelled) return
    if (!entry.committed) {
      entry.elapsedBeforeCommit = true
      return
    }
    if (schedules.get(entry.taskId) !== entry) return

    const sampledNow = currentDate()
    const timezone = timezoneSnapshot(sampledNow)
    if (timezone.key !== entry.timezoneKey) {
      try { replaceCurrentEntry(entry, sampledNow, timezone) } catch { schedules.delete(entry.taskId) }
      return
    }

    if (sampledNow.getTime() < entry.nextRunAt.getTime()) {
      try {
        const recalculated = getNextDate(entry.cron, sampledNow, timezone)
        if (recalculated.getTime() !== entry.nextRunAt.getTime()) replaceCurrentEntry(entry, sampledNow, timezone)
        else armEntry(entry, sampledNow)
      } catch {
        schedules.delete(entry.taskId)
        retireEntry(entry)
      }
      return
    }

    const scheduledAt = entry.nextRunAt
    try {
      replaceCurrentEntry(entry, sampledNow, timezone)
    } catch {
      schedules.delete(entry.taskId)
      retireEntry(entry)
      return
    }
    if (claimOccurrence(entry.taskId, scheduledAt)) {
      Promise.resolve(startScheduledRun(entry.taskId)).catch(() => {})
    }
  }

  /** Prepares one task's target schedule without replacing its currently committed entry. */
  function prepareTask(task) {
    if (state !== 'running') throw new RepositoryError('SCHEDULER_UNAVAILABLE', '调度器当前不可用')
    const previousEntry = schedules.get(task.id) ?? null
    const candidateEntry = task.enabled && task.cron ? createCandidate(task.id, task.cron) : null
    return { taskId: task.id, previousEntry, candidateEntry, state: 'prepared' }
  }

  /** Prepares removal of one task schedule without cancelling it before metadata deletion succeeds. */
  function prepareRemoval(taskId) {
    if (state !== 'running') throw new RepositoryError('SCHEDULER_UNAVAILABLE', '调度器当前不可用')
    return { taskId, previousEntry: schedules.get(taskId) ?? null, candidateEntry: null, state: 'prepared' }
  }

  /** Commits a prepared candidate, rebuilding it first if its pre-commit timer or timezone became stale. */
  function commit(change) {
    if (state !== 'running' || change?.state !== 'prepared') {
      throw new RepositoryError('SCHEDULER_UNAVAILABLE', '调度更新已失效')
    }
    let candidate = change.candidateEntry
    if (candidate) {
      const sampledNow = currentDate()
      const timezone = timezoneSnapshot(sampledNow)
      if (candidate.elapsedBeforeCommit || candidate.timeoutHandle === null || candidate.nextRunAt.getTime() <= sampledNow.getTime() || candidate.timezoneKey !== timezone.key) {
        retireEntry(candidate)
        candidate = createCandidate(change.taskId, candidate.cron, sampledNow, timezone)
        change.candidateEntry = candidate
      }
      candidate.committed = true
      schedules.set(change.taskId, candidate)
    } else {
      schedules.delete(change.taskId)
    }
    change.state = 'committed'
    retireEntry(change.previousEntry)
    publishStatus()
  }

  /** Aborts a prepared candidate while leaving the prior committed schedule untouched. */
  function abort(change) {
    if (!change || change.state !== 'prepared') return
    change.state = 'aborted'
    retireEntry(change.candidateEntry)
  }

  /** Prepares a complete schedule replacement without exposing partial candidates to live callbacks. */
  function prepareSnapshot(tasks) {
    if (state !== 'running') throw new RepositoryError('SCHEDULER_UNAVAILABLE', '调度器当前不可用')
    const candidates = new Map()
    try {
      for (const task of tasks) {
        if (task.enabled && task.cron) candidates.set(task.id, createCandidate(task.id, task.cron))
      }
      return { candidates, previousEntries: new Map(schedules), state: 'prepared' }
    } catch (error) {
      for (const candidate of candidates.values()) retireEntry(candidate)
      throw error
    }
  }

  /** Publishes a prepared complete schedule in one step after its metadata transaction succeeds. */
  function commitSnapshot(change) {
    if (state !== 'running' || change?.state !== 'prepared') throw new RepositoryError('SCHEDULER_UNAVAILABLE', '调度更新已失效')
    for (const entry of change.previousEntries.values()) retireEntry(entry)
    schedules.clear()
    for (const [taskId, candidate] of change.candidates) {
      candidate.committed = true
      schedules.set(taskId, candidate)
    }
    change.state = 'committed'
    publishStatus()
  }

  /** Aborts every candidate in an uncommitted complete schedule replacement. */
  function abortSnapshot(change) {
    if (!change || change.state !== 'prepared') return
    change.state = 'aborted'
    for (const candidate of change.candidates.values()) retireEntry(candidate)
  }

  /** Initializes schedules once, skipping invalid persisted tasks so valid tasks remain available. */
  function initialize(tasks) {
    if (state !== 'created') throw new RepositoryError('SCHEDULER_UNAVAILABLE', '调度器已经初始化')
    state = 'running'
    for (const task of tasks) {
      if (!task.enabled || !task.cron) continue
      try { const change = prepareTask(task); commit(change) } catch {}
    }
    publishStatus()
  }

  /** Returns the committed next instant as ISO UTC, never exposing candidate or timer state. */
  function getNextRunAt(taskId) {
    if (state !== 'running') return null
    return schedules.get(taskId)?.nextRunAt.toISOString() ?? null
  }

  /** Reports availability based on lifecycle and whether at least one task is scheduled. */
  function getStatus() {
    if (state !== 'running') return 'unavailable'
    return schedules.size > 0 ? 'active' : 'inactive'
  }

  /** Publishes only real public-status transitions and isolates listener failures from scheduler work. */
  function publishStatus() {
    const status = getStatus()
    if (status === lastPublishedStatus) return
    lastPublishedStatus = status
    for (const listener of statusListeners) {
      try { listener(status) } catch {}
    }
  }

  /** Registers one status listener, immediately sends its snapshot, and returns an idempotent cleanup. */
  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    statusListeners.add(listener)
    try { listener(getStatus()) } catch {}
    return () => statusListeners.delete(listener)
  }

  /** Permanently stops this preload scheduler instance and invalidates timers and dedupe state. */
  function shutdown() {
    if (state === 'shutdown') return
    state = 'shutdown'
    for (const entry of schedules.values()) retireEntry(entry)
    schedules.clear()
    claimedOccurrences.clear()
    publishStatus()
  }

  return { abort, abortSnapshot, commit, commitSnapshot, getNextRunAt, getStatus, initialize, prepareRemoval, prepareSnapshot, prepareTask, shutdown, subscribe }
}

/** Keeps scheduling alive on background exits and shuts down only when ZTools will destroy preload. */
function registerSchedulerLifecycle(ztools, scheduler) {
  ztools?.onPluginOut?.((processExit) => {
    if (processExit === true) scheduler.shutdown()
  })
}

module.exports = {
  CLOCK_RECHECK_INTERVAL_MS,
  MAX_TIMER_DELAY_MS,
  OCCURRENCE_DEDUPE_LIMIT,
  createSchedulerService,
  getDefaultTimezone,
  registerSchedulerLifecycle
}
