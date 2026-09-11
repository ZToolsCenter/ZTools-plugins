'use strict'

const { RepositoryError } = require('./metadata-repository')
const { invoke } = require('./task-service')

/** Builds read-only run history operations over immutable persisted summaries. */
function createHistoryApi(metadataRepository, logFileRepository, runsApi) {
  return {
    /** Returns reverse-chronological history with optional status, trigger, task, and text filters. */
    list(query) {
      return invoke(() => {
        const page = Number.isInteger(query?.page) && query.page > 0 ? query.page : 1
        const pageSize = Number.isInteger(query?.pageSize) && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 20
        const search = typeof query?.search === 'string' ? query.search.trim().toLocaleLowerCase() : ''
        const filtered = metadataRepository.read('runRecords')
          .filter(record => !query?.taskId || record.taskId === query.taskId)
          .filter(record => !query?.status || record.status === query.status)
          .filter(record => !query?.trigger || record.trigger === query.trigger)
          .filter(record => !search || `${record.taskNameSnapshot} ${record.scriptNameSnapshot} ${record.errorSummary ?? ''}`.toLocaleLowerCase().includes(search))
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        const start = (page - 1) * pageSize
        return { items: filtered.slice(start, start + pageSize), page, pageSize, total: filtered.length }
      })
    },

    /** Returns one persisted run summary by stable ID. */
    get(runId) {
      return invoke(() => {
        const record = metadataRepository.read('runRecords').find(item => item.id === runId)
        if (!record) throw new RepositoryError('NOT_FOUND', '运行记录不存在')
        return record
      })
    },

    /** Reads one bounded log chunk via run ID without accepting a file name or path. */
    readLog(runId, input) {
      return invoke(() => {
        const exists = metadataRepository.read('runRecords').some(item => item.id === runId)
        if (!exists) throw new RepositoryError('NOT_FOUND', '运行记录不存在')
        return logFileRepository.readChunk(runId, input.offset, input.length)
      })
    },

    /** Retries a historical run using the task's current persisted configuration. */
    retry(runId) {
      return invoke(async () => {
        const record = metadataRepository.read('runRecords').find(item => item.id === runId)
        if (!record) throw new RepositoryError('NOT_FOUND', '运行记录不存在')
        const result = await runsApi.start(record.taskId, 'retry')
        if (result.ok === false) throw new RepositoryError(result.error.code, result.error.message)
        return result.data
      })
    },

    /** Removes persisted run records and controlled logs, optionally narrowing the deletion by task, age, or per-task count. */
    clear(input = {}) {
      return invoke(() => {
        const taskId = typeof input.taskId === 'string' && input.taskId ? input.taskId : null
        const maxRunsPerTask = input.maxRunsPerTask === undefined ? null : input.maxRunsPerTask
        const olderThan = input.olderThan === undefined ? null : input.olderThan
        if (maxRunsPerTask !== null && (!Number.isInteger(maxRunsPerTask) || maxRunsPerTask < 0)) throw new RepositoryError('VALIDATION_ERROR', '日志保留数量必须是非负整数')
        if (olderThan !== null && (typeof olderThan !== 'string' || Number.isNaN(Date.parse(olderThan)))) throw new RepositoryError('VALIDATION_ERROR', '日志清理时间无效')
        const records = metadataRepository.read('runRecords')
        const removeIds = new Set()
        if (!taskId && maxRunsPerTask === null && olderThan === null) {
          for (const record of records) removeIds.add(record.id)
        }
        if (taskId) for (const record of records) if (record.taskId === taskId) removeIds.add(record.id)
        if (olderThan) for (const record of records) if ((record.finishedAt ?? record.startedAt) < olderThan) removeIds.add(record.id)
        if (maxRunsPerTask !== null) {
          const byTask = new Map()
          for (const record of records) {
            if (!byTask.has(record.taskId)) byTask.set(record.taskId, [])
            byTask.get(record.taskId).push(record)
          }
          for (const taskRecords of byTask.values()) {
            taskRecords.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            for (const record of taskRecords.slice(maxRunsPerTask)) removeIds.add(record.id)
          }
        }
        let logFilesRemoved = 0
        let bytesFreed = 0
        for (const record of records) {
          if (!removeIds.has(record.id)) continue
          try {
            const size = logFileRepository.getSize?.(record.id) ?? 0
            logFileRepository.remove(record.id)
            logFilesRemoved += 1
            bytesFreed += size
          } catch (error) {
            if (!['NOT_FOUND', 'SCRIPT_MISSING'].includes(error.code)) throw error
          }
        }
        metadataRepository.write('runRecords', records.filter(record => !removeIds.has(record.id)))
        return { recordsRemoved: removeIds.size, logFilesRemoved, bytesFreed }
      })
    }
  }
}

module.exports = { createHistoryApi }
