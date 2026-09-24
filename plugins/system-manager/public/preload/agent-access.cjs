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

function orderedScopes(scopes) {
  const selected = new Set(scopes)
  return AGENT_SCOPES.filter((scope) => selected.has(scope))
}

function createAgentAccess(hostWindow, options = {}) {
  const clock = typeof options.now === 'function' ? options.now : Date.now
  const ttlMs = Number.isSafeInteger(options.ttlMs) && options.ttlMs > 0 && options.ttlMs <= ACCESS_TTL_MS
    ? options.ttlMs
    : ACCESS_TTL_MS
  const available = Boolean(hostWindow && hostWindow.ztools && typeof hostWindow.ztools.registerTool === 'function')
  let record = null
  let expiryTimer = null

  function clearTimer() {
    if (expiryTimer) clearTimeout(expiryTimer)
    expiryTimer = null
  }

  function expireIfNeeded() {
    if (record && record.expiresAt <= clock()) {
      record = null
      clearTimer()
    }
    return record
  }

  function scheduleExpiry() {
    clearTimer()
    if (!record) return
    expiryTimer = setTimeout(() => {
      record = null
      expiryTimer = null
    }, Math.max(0, record.expiresAt - clock()))
    if (expiryTimer && typeof expiryTimer.unref === 'function') expiryTimer.unref()
  }

  function getState() {
    const activeRecord = expireIfNeeded()
    const remainingMs = available && activeRecord
      ? Math.max(0, Math.floor(activeRecord.expiresAt - clock()))
      : 0
    const active = Boolean(available && activeRecord && remainingMs > 0)
    return Object.freeze({
      available,
      active,
      expiresAt: active ? new Date(activeRecord.expiresAt).toISOString() : null,
      remainingMs: active ? remainingMs : 0,
      scopes: Object.freeze(active ? [...activeRecord.scopes] : []),
    })
  }

  function grant(request) {
    const input = plainObject(request, ['scopes'])
    const scopes = stringArray(input.scopes, 'scopes', {
      min: 1,
      max: AGENT_SCOPES.length,
      itemMax: 40,
      values: AGENT_SCOPES,
    })
    if (!available) {
      record = null
      clearTimer()
      return getState()
    }
    const grantedAt = clock()
    record = {
      grantedAt,
      expiresAt: grantedAt + ttlMs,
      scopes: orderedScopes(scopes),
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
    return Boolean(activeRecord && activeRecord.expiresAt > clock() && activeRecord.scopes.includes(scope))
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
  AGENT_SCOPES,
  createAgentAccess,
  installAgentAccess,
})
