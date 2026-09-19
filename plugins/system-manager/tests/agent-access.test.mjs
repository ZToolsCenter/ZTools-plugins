import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  ACCESS_TTL_MS,
  AGENT_SCOPES,
  createAgentAccess,
  installAgentAccess,
} = require('../public/preload/agent-access.cjs')

function modernHost(storage) {
  const ztools = { registerTool() {} }
  if (storage) ztools.dbStorage = storage
  return { ztools }
}

test('legacy hosts report unavailable and cannot activate a grant', () => {
  const modernInProcess = createAgentAccess({ ztools: { registerTool() {} } })
  assert.equal(modernInProcess.grant({ scopes: ['lan_scan'] }).active, true)
  const access = createAgentAccess({ ztools: {} })
  assert.deepEqual(access.getState(), {
    available: false,
    active: false,
    expiresAt: null,
    remainingMs: 0,
    mode: null,
    scopes: [],
  })
  assert.deepEqual(access.grant({ scopes: ['lan_scan'] }), {
    available: false,
    active: false,
    expiresAt: null,
    remainingMs: 0,
    mode: null,
    scopes: [],
  })
  assert.equal(access.hasScope('lan_scan'), false)
  modernInProcess.revoke()
})

test('modern hosts start closed and expose no scope before an explicit grant', () => {
  const access = createAgentAccess(modernHost())
  assert.deepEqual(access.getState(), {
    available: true,
    active: false,
    expiresAt: null,
    remainingMs: 0,
    mode: null,
    scopes: [],
  })
  for (const scope of AGENT_SCOPES) assert.equal(access.hasScope(scope), false)
})

test('grant supports codex modes (ask, auto, full)', () => {
  const access = createAgentAccess(modernHost())
  // full 模式：授予所有 scope
  const fullState = access.grant({ mode: 'full' })
  assert.equal(fullState.active, true)
  assert.equal(fullState.mode, 'full')
  assert.deepEqual(fullState.scopes, AGENT_SCOPES)
  for (const scope of AGENT_SCOPES) assert.equal(access.hasScope(scope), true)

  // ask 模式：不预授权任何 scope
  const askState = access.grant({ mode: 'ask' })
  assert.equal(askState.active, true)
  assert.equal(askState.mode, 'ask')
  assert.deepEqual(askState.scopes, [])
  for (const scope of AGENT_SCOPES) assert.equal(access.hasScope(scope), false)

  // auto 模式：仅授予低危 scope（除启动项和卸载残留）
  const autoState = access.grant({ mode: 'auto' })
  assert.equal(autoState.active, true)
  assert.equal(autoState.mode, 'auto')
  assert.equal(access.hasScope('report_export'), true)
  assert.equal(access.hasScope('lan_scan'), true)
  assert.equal(access.hasScope('system_cleanup'), true)
  assert.equal(access.hasScope('startup_changes'), false)
  assert.equal(access.hasScope('application_removal'), false)
})

test('grant accepts only the five unique allowlisted scopes and rejects extra keys', () => {
  const access = createAgentAccess(modernHost())
  assert.throws(() => access.grant({ scopes: ['lan_scan'], extra: true }), (error) => error?.code === 'INVALID_ARGUMENT')
  assert.throws(() => access.grant({ scopes: [] }), (error) => error?.code === 'INVALID_ARGUMENT')
  assert.throws(() => access.grant({ scopes: ['lan_scan', 'lan_scan'] }), (error) => error?.code === 'INVALID_ARGUMENT')
  assert.throws(() => access.grant({ scopes: ['unknown_scope'] }), (error) => error?.code === 'INVALID_ARGUMENT')

  const state = access.grant({ scopes: ['lan_scan', 'report_export'] })
  assert.equal(state.active, true)
  assert.deepEqual(state.scopes, ['report_export', 'lan_scan'])
  assert.equal(access.hasScope('report_export'), true)
  assert.equal(access.hasScope('startup_changes'), false)
})

test('authorization stays active without 10-minute expiry limit, and custom ttlMs expires fail-closed if specified', () => {
  let now = Date.parse('2026-07-31T08:00:00.000Z')
  // 默认模式：无超时限制（常驻）
  const permanentAccess = createAgentAccess(modernHost(), { now: () => now })
  const permanentGranted = permanentAccess.grant({ scopes: ['system_cleanup'] })
  assert.equal(permanentGranted.active, true)
  assert.equal(permanentGranted.expiresAt, null)
  assert.equal(permanentGranted.remainingMs, null)
  // 过去数小时后依然有效
  now += 24 * 60 * 60 * 1000
  assert.equal(permanentAccess.getState().active, true)
  assert.equal(permanentAccess.hasScope('system_cleanup'), true)

  // 支持可选 custom ttlMs
  const customTtl = 60 * 1000
  const timedAccess = createAgentAccess(modernHost(), { now: () => now, ttlMs: customTtl })
  const timedGranted = timedAccess.grant({ scopes: ['system_cleanup'] })
  assert.equal(timedGranted.remainingMs, customTtl)
  assert.equal(Date.parse(timedGranted.expiresAt) - now, customTtl)
  now += customTtl - 1
  assert.equal(timedAccess.getState().active, true)
  now += 1
  assert.deepEqual(timedAccess.getState(), {
    available: true,
    active: false,
    expiresAt: null,
    remainingMs: 0,
    mode: null,
    scopes: [],
  })
  assert.equal(timedAccess.hasScope('system_cleanup'), false)
})

test('dbStorage is ignored and grants never cross renderer controllers', () => {
  const calls = []
  const hostileStorage = {
    getItem() { calls.push('get'); return { version: 1, grantedAt: 1, expiresAt: Number.MAX_SAFE_INTEGER, scopes: [...AGENT_SCOPES] } },
    setItem() { calls.push('set'); throw new Error('must not write') },
  }
  const host = modernHost(hostileStorage)
  const first = createAgentAccess(host)
  assert.equal(first.getState().active, false)
  assert.deepEqual(calls, [])
  assert.equal(first.grant({ scopes: ['application_removal'] }).active, true)
  assert.deepEqual(calls, [])

  const second = createAgentAccess(host)
  assert.deepEqual(second.getState(), {
    available: true,
    active: false,
    expiresAt: null,
    remainingMs: 0,
    mode: null,
    scopes: [],
  })
  assert.equal(second.hasScope('application_removal'), false)
  assert.equal(first.hasScope('application_removal'), true)
})

test('the frozen Agent access bridge is installed on dashboard only', () => {
  const dashboardHost = modernHost()
  const dashboard = installAgentAccess(dashboardHost, { kind: 'dashboard', featureCode: null })
  assert.equal(dashboard.installed, true)
  assert.equal(Object.isFrozen(dashboardHost.systemManagerAgentAccess), true)
  assert.deepEqual(Object.keys(dashboardHost.systemManagerAgentAccess), ['getState', 'grant', 'revoke'])

  const moduleHost = modernHost()
  const moduleResult = installAgentAccess(moduleHost, { kind: 'module', featureCode: 'system-cleaner' })
  assert.equal(moduleResult.installed, false)
  assert.equal(Object.hasOwn(moduleHost, 'systemManagerAgentAccess'), false)

  const unknownHost = modernHost()
  const unknown = installAgentAccess(unknownHost, null)
  assert.equal(unknown.installed, false)
  assert.equal(Object.hasOwn(unknownHost, 'systemManagerAgentAccess'), false)
})
