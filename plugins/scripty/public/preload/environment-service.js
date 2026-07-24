'use strict'

const { randomUUID } = require('node:crypto')
const { RepositoryError } = require('./metadata-repository')
const { invoke } = require('./task-service')

const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Validates environment input, references, and same-scope uniqueness before persistence. */
function normalizeEnvironmentInput(input, environments, tasks, currentId = null) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!ENVIRONMENT_NAME_PATTERN.test(name)) throw new RepositoryError('VALIDATION_ERROR', '环境变量名称格式无效')
  const scope = input?.scope
  if (!['global', 'task'].includes(scope)) throw new RepositoryError('VALIDATION_ERROR', '环境变量作用域无效')
  const taskId = scope === 'task' ? input.taskId : null
  if (scope === 'task' && !tasks.some(task => task.id === taskId)) throw new RepositoryError('REFERENCE_CONFLICT', '任务级环境变量必须引用已存在任务')
  if (environments.some(variable => variable.id !== currentId && variable.name === name && variable.scope === scope && variable.taskId === taskId)) {
    throw new RepositoryError('NAME_CONFLICT', '同一作用域内已存在同名环境变量')
  }
  if (typeof input.value !== 'string' || input.value.length > 10000) throw new RepositoryError('VALIDATION_ERROR', '环境变量值无效或过长')
  return { name, value: input.value, note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '', scope, taskId, enabled: Boolean(input.enabled), sensitive: Boolean(input.sensitive) }
}

/** Removes raw values from ordinary list and mutation responses. */
function toSummary(variable) {
  const { value, ...summary } = variable
  return { ...summary, maskedValue: variable.sensitive ? '••••••••' : value }
}

/** Merges enabled variables in precedence order: system, global, then task-specific overrides. */
function buildTaskEnvironment(systemEnvironment, environments, taskId) {
  const result = { ...systemEnvironment }
  for (const variable of environments.filter(item => item.enabled && item.scope === 'global')) result[variable.name] = variable.value
  for (const variable of environments.filter(item => item.enabled && item.scope === 'task' && item.taskId === taskId)) result[variable.name] = variable.value
  return result
}

/** Builds CRUD operations whose normal responses never expose sensitive plaintext values. */
function createEnvironmentsApi(metadataRepository) {
  return {
    /** Lists environment summaries with optional scope, task, enabled, and text filtering. */
    list(query = {}) {
      return invoke(() => {
        const search = typeof query.search === 'string' ? query.search.trim().toLocaleLowerCase() : ''
        return metadataRepository.read('environments')
          .filter(variable => !query.scope || variable.scope === query.scope)
          .filter(variable => !query.taskId || variable.taskId === query.taskId)
          .filter(variable => typeof query.enabled !== 'boolean' || variable.enabled === query.enabled)
          .filter(variable => !search || `${variable.name} ${variable.note}`.toLocaleLowerCase().includes(search))
          .map(toSummary)
      })
    },

    /** Returns one masked environment detail for edit-form metadata hydration. */
    get(id) {
      return invoke(() => {
        const variable = metadataRepository.read('environments').find(item => item.id === id)
        if (!variable) throw new RepositoryError('NOT_FOUND', '环境变量不存在')
        return toSummary(variable)
      })
    },

    /** Explicitly reveals one value; callers must gate this operation with user confirmation. */
    reveal(id) {
      return invoke(() => {
        const variable = metadataRepository.read('environments').find(item => item.id === id)
        if (!variable) throw new RepositoryError('NOT_FOUND', '环境变量不存在')
        return { id: variable.id, value: variable.value }
      })
    },

    /** Creates one validated environment variable with a generated UUID. */
    create(input) {
      return invoke(() => {
        const environments = metadataRepository.read('environments')
        const now = new Date().toISOString()
        const variable = { id: randomUUID(), ...normalizeEnvironmentInput(input, environments, metadataRepository.read('tasks')), createdAt: now, updatedAt: now }
        metadataRepository.write('environments', [...environments, variable])
        return toSummary(variable)
      })
    },

    /** Updates one environment variable while preserving identity and creation time. */
    update(id, input) {
      return invoke(() => {
        const environments = metadataRepository.read('environments')
        const index = environments.findIndex(variable => variable.id === id)
        if (index < 0) throw new RepositoryError('NOT_FOUND', '环境变量不存在')
        const updated = { ...environments[index], ...normalizeEnvironmentInput(input, environments, metadataRepository.read('tasks'), id), updatedAt: new Date().toISOString() }
        const next = environments.slice(); next[index] = updated
        metadataRepository.write('environments', next)
        return toSummary(updated)
      })
    },

    /** Atomically toggles one variable without requiring or exposing its current value. */
    setEnabled(id, enabled) {
      return invoke(() => {
        if (typeof enabled !== 'boolean') throw new RepositoryError('VALIDATION_ERROR', 'enabled 必须是布尔值')
        const environments = metadataRepository.read('environments')
        const index = environments.findIndex(variable => variable.id === id)
        if (index < 0) throw new RepositoryError('NOT_FOUND', '环境变量不存在')
        const updated = { ...environments[index], enabled, updatedAt: new Date().toISOString() }
        const next = environments.slice(); next[index] = updated
        metadataRepository.write('environments', next)
        return toSummary(updated)
      })
    },

    /** Deletes one environment variable by stable ID. */
    remove(id) {
      return invoke(() => {
        const environments = metadataRepository.read('environments')
        if (!environments.some(variable => variable.id === id)) throw new RepositoryError('NOT_FOUND', '环境变量不存在')
        metadataRepository.write('environments', environments.filter(variable => variable.id !== id))
      })
    }
  }
}

module.exports = { ENVIRONMENT_NAME_PATTERN, buildTaskEnvironment, createEnvironmentsApi, normalizeEnvironmentInput, toSummary }
