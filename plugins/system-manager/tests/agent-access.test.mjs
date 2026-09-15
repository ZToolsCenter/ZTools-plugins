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
    scopes: [],
  })
  assert.deepEqual(access.grant({ scopes: ['lan_scan'] }), {
    available: false,
    active: false,
    expiresAt: null,
    remainingMs: 0,
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
    scopes: [],
  })
  for (const scope of AGENT_SCOPES) assert.equal(access.hasScope(scope), false)
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

test('authorization never exceeds ten minutes and expires fail-closed', () => {
  let now = Date.parse('2026-07-31T08:00:00.000Z')
  const access = createAgentAccess(modernHost(), { now: () => now, ttlMs: ACCESS_TTL_MS + 1 })
  const granted = access.grant({ scopes: ['system_cleanup'] })
  assert.equal(granted.remainingMs, ACCESS_TTL_MS)
  assert.equal(Date.parse(granted.expiresAt) - now, ACCESS_TTL_MS)
  now += ACCESS_TTL_MS - 1
  assert.equal(access.getState().active, true)
  now += 1
  assert.deepEqual(access.getState(), {
    available: true,
    active: false,
    expiresAt: null,
    remainingMs: 0,
    scopes: [],
  })
  assert.equal(access.hasScope('system_cleanup'), false)
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
