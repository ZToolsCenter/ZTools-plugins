'use strict'

const { plainObject, stringArray } = require('./validation.cjs')

const ACCESS_TTL_MS = 10 * 60 * 1000
const AGENT_SCOPES = Object.freeze([
  'report_export',
  'application_removal',
  'startup_changes',
  'system_cleanup',
  'lan_scan',
])
const SCOPE_SET = new Set(AGENT_SCOPES)
const AGENT_MODES = Object.freeze(['ask', 'auto', 'full'])

const DEFAULT_MODE_SCOPES = Object.freeze({
  ask: Object.freeze([]),
  auto: Object.freeze(['report_export', 'lan_scan', 'system_cleanup']),
  full: Object.freeze([...AGENT_SCOPES]),
})

function orderedScopes(scopes) {
  const selected = new Set(scopes)
  return AGENT_SCOPES.filter((scope) => selected.has(scope))
}

function createAgentAccess(hostWindow, options = {}) {
  const clock = typeof options.now === 'function' ? options.now : Date.now
  // 默认 null（无超时限制常驻），显式传 ttlMs 时遵循指定过期时间
  const customTtl = typeof options.ttlMs === 'number' && options.ttlMs > 0 ? options.ttlMs : null
  const available = Boolean(hostWindow && hostWindow.ztools && typeof hostWindow.ztools.registerTool === 'function')
  let record = null
  let expiryTimer = null

  function clearTimer() {
    if (expiryTimer) clearTimeout(expiryTimer)
    expiryTimer = null
  }

  function expireIfNeeded() {
    if (record && record.expiresAt !== null && record.expiresAt <= clock()) {
      record = null
      clearTimer()
    }
    return record
  }

  function scheduleExpiry() {
    clearTimer()
    if (!record || record.expiresAt === null) return
    expiryTimer = setTimeout(() => {
      record = null
      expiryTimer = null
    }, Math.max(0, record.expiresAt - clock()))
    if (expiryTimer && typeof expiryTimer.unref === 'function') expiryTimer.unref()
  }

  function getState() {
    const activeRecord = expireIfNeeded()
    const active = Boolean(available && activeRecord)
    const mode = active ? (activeRecord.mode || null) : null
    const scopes = active ? [...activeRecord.scopes] : []
    const expiresAt = active && activeRecord.expiresAt !== null
      ? new Date(activeRecord.expiresAt).toISOString()
      : null
    const remainingMs = active && activeRecord.expiresAt !== null
      ? Math.max(0, Math.floor(activeRecord.expiresAt - clock()))
      : (active ? null : 0)

    return Object.freeze({
      available,
      active,
      mode,
      scopes: Object.freeze(scopes),
      expiresAt,
      remainingMs,
    })
  }

  function grant(request) {
    const input = plainObject(request, ['mode', 'scopes'])
    let mode = null
    let scopes = null

    if (input.mode !== undefined) {
      if (typeof input.mode !== 'string' || !AGENT_MODES.includes(input.mode)) {
        const error = new Error('request.mode is invalid')
        error.name = 'ValidationError'
        error.code = 'INVALID_ARGUMENT'
        error.expose = true
        throw error
      }
      mode = input.mode
      scopes = [...DEFAULT_MODE_SCOPES[mode]]
    }

    if (input.scopes !== undefined) {
      const validatedScopes = stringArray(input.scopes, 'scopes', {
        min: 1,
        max: AGENT_SCOPES.length,
        itemMax: 40,
        values: AGENT_SCOPES,
      })
      scopes = orderedScopes(validatedScopes)
      if (!mode) {
        mode = scopes.length === AGENT_SCOPES.length
          ? 'full'
          : (scopes.length === 0 ? 'ask' : 'auto')
      }
    }

    if (!available) {
      record = null
      clearTimer()
      return getState()
    }

    const grantedAt = clock()
    record = {
      grantedAt,
      expiresAt: customTtl ? grantedAt + customTtl : null,
      mode,
      scopes,
    }
    scheduleExpiry()
    return getState()
  }

  function revoke() {
    record = null
    clearTimer()
    return getState()
  }

  function hasScope(scope) {
    if (!available || !SCOPE_SET.has(scope)) return false
    const activeRecord = expireIfNeeded()
    if (!activeRecord) return false
    if (activeRecord.expiresAt !== null && activeRecord.expiresAt <= clock()) return false
    if (activeRecord.mode === 'full') return true
    return activeRecord.scopes.includes(scope)
  }

  return Object.freeze({ getState, grant, revoke, hasScope })
}

function installAgentAccess(hostWindow, page, options = {}) {
  const controller = createAgentAccess(hostWindow, options)
  let installed = false
  if (page && page.kind === 'dashboard') {
    hostWindow.systemManagerAgentAccess = Object.freeze({
      getState: controller.getState,
      grant: controller.grant,
      revoke: controller.revoke,
    })
    installed = true
  }
  return Object.freeze({ controller, installed })
}

module.exports = Object.freeze({
  ACCESS_TTL_MS,
  AGENT_MODES,
  AGENT_SCOPES,
  createAgentAccess,
  installAgentAccess,
})
