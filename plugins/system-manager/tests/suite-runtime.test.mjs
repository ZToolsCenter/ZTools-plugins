import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  ACTION_TTL_MS,
  JOURNAL_TTL_MS,
  LAN_SCAN_MIN_INTERVAL_MS,
  createOperationJournal,
  createSuiteRuntime,
} = require('../public/preload/suite-runtime.cjs')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function expectCode(code) {
  return (error) => {
    assert.equal(error && error.code, code)
    return true
  }
}

function createHarness(overrides = {}) {
  let current = Date.parse('2026-07-31T08:00:00.000Z')
  let startupScanNumber = 0
  let cleanerScanNumber = 0
  let applicationPlanNumber = 0
  const scopes = new Set(overrides.scopes || [])
  const calls = {
    applicationExecute: 0,
    cleanerClean: 0,
    networkScan: 0,
    startupSet: 0,
    applicationShutdown: 0,
    startupShutdown: 0,
  }

  const app = {
    id: 'app_demo',
    platform: 'darwin',
    name: 'Demo App',
    version: '1.0',
    publisher: 'Example',
    install: { kind: 'bundle', scope: 'user', path: '/Users/alice/Applications/Demo App.app' },
    uninstall: { mode: 'trash', requiresElevation: false, supported: true },
    protected: false,
  }

  const applicationBridge = Object.freeze({
    async scanApps() {
      return { platform: 'darwin', scannedAt: new Date(current).toISOString(), apps: [app], warnings: [] }
    },
    async inspectApp() {
      const suffix = ++applicationPlanNumber
      return {
        id: `plan_${suffix}`,
        app,
        createdAt: new Date(current).toISOString(),
        expiresAt: new Date(current + 120_000).toISOString(),
        candidates: [{
          id: `app_candidate_${suffix}`,
          path: '/Users/alice/Library/Application Support/Demo App/private.db',
          category: 'data',
          sizeBytes: 64,
          exists: true,
          ownership: 'user',
          confidence: 'exact',
          reason: 'bundle identifier match',
          selectedByDefault: false,
          deletable: true,
        }],
        warnings: [],
      }
    },
    async executePlan(request) {
      calls.applicationExecute += 1
      return {
        planId: request.planId,
        completedAt: new Date(current).toISOString(),
        results: request.selectedIds.map((candidateId) => ({ candidateId, status: 'trashed' })),
      }
    },
    async shutdown() {
      calls.applicationShutdown += 1
      return { state: 'shutdown', drained: true }
    },
  })

  const startupBridge = Object.freeze({
    async scan() {
      const suffix = ++startupScanNumber
      return {
        snapshotId: `startup_${suffix}`,
        platform: 'darwin',
        generatedAt: new Date(current).toISOString(),
        items: Array.from({ length: 3 }, (_, index) => ({
          id: `startup_item_${suffix}_${index}`,
          name: `Startup ${index}`,
          scope: 'user',
          kind: 'login-item',
          source: { label: 'User login items', path: `/Users/alice/Library/LaunchAgents/item-${index}.plist` },
          trigger: 'login',
          enabled: true,
          running: false,
          status: 'enabled',
          commandSummary: `/Users/alice/bin/start --token secret-${index}`,
          impact: { level: 'low', basis: 'heuristic', reasons: ['login'] },
          action: { canToggle: true, requiresElevation: false, reason: 'user item' },
        })),
        warnings: [],
      }
    },
    async setEnabled(request) {
      calls.startupSet += 1
      return {
        changed: true,
        operationId: `startup_operation_${calls.startupSet}`,
        item: {
          id: request.itemId,
          name: 'Startup 0',
          scope: 'user',
          kind: 'login-item',
          source: { label: 'User login items' },
          trigger: 'login',
          enabled: request.enabled,
          running: false,
          status: request.enabled ? 'enabled' : 'disabled',
          impact: { level: 'low', basis: 'heuristic', reasons: ['login'] },
          action: { canToggle: true, requiresElevation: false, reason: 'user item' },
        },
      }
    },
    async undo(request) {
      return {
        restored: true,
        item: {
          id: request.operationId,
          name: 'Startup 0',
          scope: 'user',
          kind: 'login-item',
          source: { label: 'User login items' },
          enabled: true,
          running: false,
          impact: { reasons: [] },
          action: { canToggle: true, requiresElevation: false },
        },
      }
    },
    async shutdown() {
      calls.startupShutdown += 1
      return { state: 'shutdown', drained: true }
    },
  })

  const cleanerBridge = Object.freeze({
    async scan() {
      const suffix = ++cleanerScanNumber
      return {
        snapshotId: `cleaner_${suffix}`,
        generatedAt: new Date(current).toISOString(),
        expiresAt: new Date(current + 120_000).toISOString(),
        candidates: [{
          id: `cleaner_candidate_${suffix}`,
          rootId: 'user-cache',
          category: 'cache',
          label: 'Demo cache',
          location: '/Users/alice/Library/Caches/Demo',
          sizeBytes: 128,
          ageDays: 30,
          kind: 'directory',
          selectedByDefault: true,
        }],
        totalBytes: 128,
        warnings: [],
      }
    },
    async clean(request) {
      calls.cleanerClean += 1
      if (overrides.clean) return overrides.clean(request, { calls, now: () => current })
      return {
        operationId: `clean_operation_${calls.cleanerClean}`,
        completedAt: new Date(current).toISOString(),
        results: request.candidateIds.map((candidateId) => ({ candidateId, status: 'trashed', sizeBytes: 128 })),
        movedBytes: 128,
      }
    },
  })

  const networkInterface = Object.freeze({
    id: 'interface_main',
    name: 'en0',
    address: '192.168.10.2',
    cidr: '192.168.10.2/24',
    prefixLength: 24,
    scope: 'private',
    kind: 'physical',
    requiresConfirmation: Boolean(overrides.restrictedInterface),
    riskReason: overrides.restrictedInterface ? '虚拟或桥接接口' : null,
  })
  const networkBridge = Object.freeze({
    async listInterfaces() { return [networkInterface] },
    async scan() {
      calls.networkScan += 1
      if (overrides.networkScanError) throw overrides.networkScanError
      return {
        scanId: `scan_${calls.networkScan}`,
        status: 'completed',
        interface: networkInterface,
        devices: Array.from({ length: overrides.lanDeviceCount || 1 }, (_, index) => ({
          ip: `192.168.10.${(index % 254) + 1}`,
          hostname: null,
          vendor: null,
          onlineStatus: 'online',
          evidence: index === 0 ? ['self'] : ['icmp'],
          isSelf: index === 0,
        })),
        startedAt: new Date(current).toISOString(),
        finishedAt: new Date(current + 10).toISOString(),
        durationMs: 10,
        scannedHostCount: overrides.lanScannedHostCount || 1,
        truncated: false,
        warnings: [],
        errors: [],
      }
    },
  })

  const hostWindow = { ztools: {} }
  Object.defineProperties(hostWindow, {
    applicationUninstaller: { configurable: false, enumerable: true, value: applicationBridge },
    startupManager: { configurable: false, enumerable: true, value: startupBridge },
    systemCleaner: { configurable: false, enumerable: true, value: cleanerBridge },
    lanDiscovery: { configurable: false, enumerable: true, value: networkBridge },
  })
  const agentAccess = Object.freeze({
    getState() {
      return {
        available: true,
        active: scopes.size > 0,
        expiresAt: scopes.size > 0 ? new Date(current + 600_000).toISOString() : null,
        remainingMs: scopes.size > 0 ? 600_000 : 0,
        scopes: [...scopes],
      }
    },
    hasScope(scope) { return scopes.has(scope) },
  })
  const runtime = createSuiteRuntime({
    hostWindow,
    page: Object.freeze({ kind: 'module', featureCode: overrides.featureCode || 'system-cleaner' }),
    agentAccess,
    now: () => current,
  })
  return {
    calls,
    runtime,
    advance(milliseconds) { current += milliseconds },
    grant(...values) { for (const value of values) scopes.add(value) },
    revoke(...values) {
      if (values.length === 0) scopes.clear()
      else for (const value of values) scopes.delete(value)
    },
  }
}

test('runtime shutdown drains the loaded feature bridge and rejects new writes', async () => {
  const harness = createHarness({ featureCode: 'application-uninstaller' })
  const result = await harness.runtime.shutdown()
  assert.deepEqual(result, { state: 'shutdown', drained: true })
  assert.equal(harness.calls.applicationShutdown, 1)
  await assert.rejects(
    harness.runtime.execute_application_removal({ actionId: 'action_1', idempotencyKey: 'idempotency_1' }),
    expectCode('SHUTTING_DOWN'),
  )
  assert.equal(harness.runtime._state.lifecycle, 'shutdown')
})

test('LAN restricted interfaces require explicit confirmation in the prepared action', async () => {
  const harness = createHarness({ featureCode: 'lan-device-discovery', restrictedInterface: true })
  harness.grant('lan_scan')
  await assert.rejects(
    harness.runtime.prepare_lan_scan({ interfaceId: 'interface_main' }),
    expectCode('CONFIRMATION_REQUIRED'),
  )
  const prepared = await harness.runtime.prepare_lan_scan({ interfaceId: 'interface_main', confirmRestrictedInterface: true })
  assert.equal(prepared.summary.requiresConfirmation, true)
  assert.equal(prepared.summary.confirmRestrictedInterface, true)
})

test('reconciled startup rollback is registered for root MCP undo in a new runtime session', async () => {
  let undoCalls = 0
  const startupBridge = Object.freeze({
    async scan() {
      return {
        snapshotId: 'startup_recovered_001', platform: 'linux', generatedAt: new Date().toISOString(),
        recoveredOperationId: 'startup_recovered_operation_001', recoveredOperationCreatedAt: Date.now(), warnings: [],
        items: [{ id: 'startup_item_001', name: 'Recovered service', scope: 'user', kind: 'systemd-unit', source: { label: 'systemd' }, trigger: 'login', enabled: false, running: false, status: 'disabled', impact: { reasons: [] }, action: { canToggle: true, requiresElevation: false } }],
      }
    },
    async setEnabled() { throw new Error('not used') },
    async undo(request) {
      undoCalls += 1
      return { restored: true, item: { id: request.operationId, name: 'Recovered service', scope: 'user', kind: 'systemd-unit', source: { label: 'systemd' }, enabled: true, running: false, status: 'idle', impact: { reasons: [] }, action: { canToggle: true, requiresElevation: false } } }
    },
  })
  const hostWindow = { ztools: {} }
  Object.defineProperty(hostWindow, 'startupManager', { configurable: false, enumerable: true, value: startupBridge })
  const runtime = createSuiteRuntime({
    hostWindow,
    page: Object.freeze({ kind: 'module', featureCode: 'startup-manager' }),
    agentAccess: Object.freeze({ hasScope(scope) { return scope === 'startup_changes' }, getState() { return {} } }),
  })
  await runtime.scan_startup_items({ pageSize: 1 })
  await runtime.undo_startup_change({ operationId: 'startup_recovered_operation_001', idempotencyKey: 'startup_recovered_undo_001' })
  assert.equal(undoCalls, 1)
})

async function applicationPlan(runtime) {
  const inventory = await runtime.scan_applications({ pageSize: 1 })
  const inspection = await runtime.inspect_application({ inventoryId: inventory.inventoryId, appId: inventory.items[0].id })
  return { inspection, selectedIds: [inspection.candidates[0].id] }
}

async function cleanerSnapshot(runtime) {
  const snapshot = await runtime.scan_system_junk({ pageSize: 1 })
  return { snapshot, candidateIds: [snapshot.items[0].id] }
}

test('runtime rejects extra keys and defaults to path- and command-redacted output', async () => {
  const applicationHarness = createHarness({ featureCode: 'application-uninstaller' })
  const { runtime: applicationRuntime } = applicationHarness
  await assert.rejects(applicationRuntime.get_capabilities({ extra: true }), expectCode('INVALID_ARGUMENT'))

  const inventory = await applicationRuntime.scan_applications({ pageSize: 1 })
  assert.equal(Object.hasOwn(inventory.items[0].install, 'path'), false)
  assert.doesNotMatch(JSON.stringify(inventory), /Users\/alice|Applications\/Demo/)
  const inspection = await applicationRuntime.inspect_application({ inventoryId: inventory.inventoryId, appId: inventory.items[0].id })
  assert.equal(Object.hasOwn(inspection.candidates[0], 'path'), false)
  assert.doesNotMatch(JSON.stringify(inspection), /Application Support|private\.db/)

  const { runtime: startupRuntime } = createHarness({ featureCode: 'startup-manager' })
  const startup = await startupRuntime.scan_startup_items({ pageSize: 1 })
  assert.equal(Object.hasOwn(startup.items[0], 'commandSummary'), false)
  assert.doesNotMatch(JSON.stringify(startup), /--token|Users\/alice/)
  const startupWithSummary = await startupRuntime.scan_startup_items({ pageSize: 1, includeCommandSummary: true })
  assert.equal(typeof startupWithSummary.items[0].commandSummary, 'string')
  assert.match(startupWithSummary.items[0].commandSummary, /redacted/)
  assert.doesNotMatch(startupWithSummary.items[0].commandSummary, /secret-0|Users\/alice/)
})

test('opaque cursors are bound to one snapshot and cannot be replayed across snapshots', async () => {
  const { runtime } = createHarness({ featureCode: 'startup-manager' })
  const first = await runtime.scan_startup_items({ pageSize: 1 })
  const second = await runtime.scan_startup_items({ pageSize: 1 })
  assert.equal(typeof first.nextCursor, 'string')
  assert.notEqual(first.snapshotId, second.snapshotId)
  await assert.rejects(runtime.list_startup_items({
    snapshotId: second.snapshotId,
    cursor: first.nextCursor,
    pageSize: 1,
  }), expectCode('INVALID_ARGUMENT'))
})

test('runtimeSessionId is stable only within one renderer runtime', async () => {
  const first = createHarness()
  const second = createHarness()
  const firstCapabilities = await first.runtime.get_capabilities({})
  const repeatedCapabilities = await first.runtime.get_capabilities({})
  const secondCapabilities = await second.runtime.get_capabilities({})
  assert.match(firstCapabilities.runtimeSessionId, /^[A-Za-z0-9_-]+$/)
  assert.equal(repeatedCapabilities.runtimeSessionId, firstCapabilities.runtimeSessionId)
  assert.notEqual(secondCapabilities.runtimeSessionId, firstCapabilities.runtimeSessionId)

  const missing = await first.runtime.get_operation_result({ idempotencyKey: 'session-result-missing-001' })
  assert.equal(missing.runtimeSessionId, firstCapabilities.runtimeSessionId)
  assert.equal(missing.found, false)
})

test('all prepare tools require their scope and then issue a 90-second digest-bound action', async () => {
  const applicationHarness = createHarness({ featureCode: 'application-uninstaller' })
  const app = await applicationPlan(applicationHarness.runtime)
  const startupHarness = createHarness({ featureCode: 'startup-manager' })
  const startup = await startupHarness.runtime.scan_startup_items({ pageSize: 1 })
  const cleanerHarness = createHarness({ featureCode: 'system-cleaner' })
  const cleaner = await cleanerSnapshot(cleanerHarness.runtime)
  const networkHarness = createHarness({ featureCode: 'lan-device-discovery' })
  const interfaces = await networkHarness.runtime.list_network_interfaces({})

  const capabilities = await applicationHarness.runtime.get_capabilities({})
  const scopes = Object.fromEntries(capabilities.tools.map((tool) => [tool.name, tool.scope]))
  assert.equal(scopes.prepare_application_removal, 'application_removal')
  assert.equal(scopes.prepare_startup_change, 'startup_changes')
  assert.equal(scopes.prepare_system_cleanup, 'system_cleanup')
  assert.equal(scopes.prepare_lan_scan, 'lan_scan')

  const preparations = [
    {
      harness: applicationHarness,
      scope: 'application_removal',
      call: () => applicationHarness.runtime.prepare_application_removal({ planId: app.inspection.planId, selectedIds: app.selectedIds }),
    },
    {
      harness: startupHarness,
      scope: 'startup_changes',
      call: () => startupHarness.runtime.prepare_startup_change({ snapshotId: startup.snapshotId, itemId: startup.items[0].id, enabled: false }),
    },
    {
      harness: cleanerHarness,
      scope: 'system_cleanup',
      call: () => cleanerHarness.runtime.prepare_system_cleanup({ snapshotId: cleaner.snapshot.snapshotId, candidateIds: cleaner.candidateIds }),
    },
    {
      harness: networkHarness,
      scope: 'lan_scan',
      call: () => networkHarness.runtime.prepare_lan_scan({ interfaceId: interfaces.interfaces[0].id }),
    },
  ]

  for (const preparation of preparations) {
    await assert.rejects(preparation.call(), expectCode('AUTHORIZATION_REQUIRED'))
    preparation.harness.grant(preparation.scope)
    const action = await preparation.call()
    assert.match(action.actionId, /^[A-Za-z0-9_-]+$/)
    assert.match(action.actionDigest, /^[a-f0-9]{64}$/)
    assert.equal(Date.parse(action.expiresAt) - Date.parse('2026-07-31T08:00:00.000Z'), ACTION_TTL_MS)
    preparation.harness.revoke(preparation.scope)
  }
})

test('actions expire after 90 seconds and are consumed only once', async () => {
  const harness = createHarness({ scopes: ['system_cleanup'] })
  const { runtime } = harness
  const first = await cleanerSnapshot(runtime)
  const expiredAction = await runtime.prepare_system_cleanup({ snapshotId: first.snapshot.snapshotId, candidateIds: first.candidateIds })
  harness.advance(ACTION_TTL_MS + 1)
  await assert.rejects(runtime.clean_system_junk({ actionId: expiredAction.actionId, idempotencyKey: 'cleanup-expired-1' }), expectCode('ACTION_EXPIRED'))
  assert.equal(harness.calls.cleanerClean, 0)

  const second = await cleanerSnapshot(runtime)
  const action = await runtime.prepare_system_cleanup({ snapshotId: second.snapshot.snapshotId, candidateIds: second.candidateIds })
  await runtime.clean_system_junk({ actionId: action.actionId, idempotencyKey: 'cleanup-once-001' })
  await assert.rejects(runtime.clean_system_junk({ actionId: action.actionId, idempotencyKey: 'cleanup-once-002' }), expectCode('ACTION_NOT_FOUND'))
  assert.equal(harness.calls.cleanerClean, 1)
})

test('idempotency coalesces concurrency, detects conflicts, survives authorization expiry, and is queryable', async () => {
  const gate = deferred()
  const harness = createHarness({
    scopes: ['system_cleanup'],
    async clean(request, context) {
      await gate.promise
      return {
        operationId: `clean_operation_${context.calls.cleanerClean}`,
        completedAt: new Date(context.now()).toISOString(),
        results: request.candidateIds.map((candidateId) => ({ candidateId, status: 'trashed', sizeBytes: 128 })),
        movedBytes: 128,
      }
    },
  })
  const { runtime } = harness
  const selection = await cleanerSnapshot(runtime)
  const action = await runtime.prepare_system_cleanup({ snapshotId: selection.snapshot.snapshotId, candidateIds: selection.candidateIds })
  const request = { actionId: action.actionId, idempotencyKey: 'cleanup-concurrent-001' }
  const first = runtime.clean_system_junk(request)
  const second = runtime.clean_system_junk({ ...request })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(harness.calls.cleanerClean, 1)
  const pending = await runtime.get_operation_result({ idempotencyKey: request.idempotencyKey })
  assert.equal(pending.found, true)
  assert.equal(pending.status, 'pending')

  gate.resolve()
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.deepEqual(secondResult, firstResult)
  const completed = await runtime.get_operation_result({ idempotencyKey: request.idempotencyKey })
  assert.equal(completed.status, 'completed')
  assert.deepEqual(completed.result, firstResult)

  harness.revoke('system_cleanup')
  assert.deepEqual(await runtime.clean_system_junk({ ...request }), firstResult)
  harness.grant('system_cleanup')
  const otherSelection = await cleanerSnapshot(runtime)
  const otherAction = await runtime.prepare_system_cleanup({ snapshotId: otherSelection.snapshot.snapshotId, candidateIds: otherSelection.candidateIds })
  harness.revoke('system_cleanup')
  await assert.rejects(runtime.clean_system_junk({ actionId: otherAction.actionId, idempotencyKey: request.idempotencyKey }), expectCode('IDEMPOTENCY_CONFLICT'))
  const missing = await runtime.get_operation_result({ idempotencyKey: 'operation-missing-001' })
  assert.equal(missing.found, false)
  assert.equal(missing.idempotencyKey, 'operation-missing-001')
  assert.match(missing.runtimeSessionId, /^[A-Za-z0-9_-]+$/)
})

test('completed journal records retain their full TTL after a long-running operation settles', async () => {
  let current = Date.parse('2026-07-31T08:00:00.000Z')
  const gate = deferred()
  const journal = createOperationJournal(() => current)
  const request = journal.run('export_diagnostic_report', 'export-long-running-001', 'report-signature', async () => {
    await gate.promise
    return { saved: true }
  })

  await Promise.resolve()
  current += JOURNAL_TTL_MS + 1
  assert.equal(journal.get('export-long-running-001').status, 'pending')

  gate.resolve()
  await request
  assert.equal(journal.get('export-long-running-001').status, 'completed')

  current += JOURNAL_TTL_MS
  assert.equal(journal.get('export-long-running-001').status, 'completed')
  current += 1
  assert.equal(journal.get('export-long-running-001').found, false)
})

test('authorization failures do not poison an idempotency key before an action is consumed', async () => {
  const harness = createHarness({ scopes: ['system_cleanup'] })
  const { runtime } = harness
  const selection = await cleanerSnapshot(runtime)
  const action = await runtime.prepare_system_cleanup({ snapshotId: selection.snapshot.snapshotId, candidateIds: selection.candidateIds })
  const request = { actionId: action.actionId, idempotencyKey: 'cleanup-auth-retry-001' }
  harness.revoke('system_cleanup')
  await assert.rejects(runtime.clean_system_junk(request), expectCode('AUTHORIZATION_REQUIRED'))
  assert.equal(harness.calls.cleanerClean, 0)
  const missing = await runtime.get_operation_result({ idempotencyKey: request.idempotencyKey })
  assert.equal(missing.found, false)
  assert.equal(missing.idempotencyKey, request.idempotencyKey)
  assert.match(missing.runtimeSessionId, /^[A-Za-z0-9_-]+$/)
  harness.grant('system_cleanup')
  const result = await runtime.clean_system_junk({ ...request })
  assert.equal(result.movedBytes, 128)
  assert.equal(harness.calls.cleanerClean, 1)
})

test('LAN scans clamp host results, start at most once per 15 seconds, and avoid duplicate traffic', async () => {
  const harness = createHarness({
    featureCode: 'lan-device-discovery',
    scopes: ['lan_scan'],
    lanDeviceCount: 300,
    lanScannedHostCount: 999,
  })
  const { runtime } = harness
  const interfaces = await runtime.list_network_interfaces({})
  const firstAction = await runtime.prepare_lan_scan({ interfaceId: interfaces.interfaces[0].id })
  const firstRequest = { actionId: firstAction.actionId, idempotencyKey: 'lan-scan-first-001' }
  const firstResult = await runtime.scan_lan_devices(firstRequest)
  assert.equal(harness.calls.networkScan, 1)
  assert.equal(firstResult.devices.length, 255)
  assert.equal(firstResult.scannedHostCount, 254)
  assert.deepEqual(await runtime.scan_lan_devices({ ...firstRequest }), firstResult)
  assert.equal(harness.calls.networkScan, 1)

  const secondAction = await runtime.prepare_lan_scan({ interfaceId: interfaces.interfaces[0].id })
  const rateLimitedRequest = { actionId: secondAction.actionId, idempotencyKey: 'lan-scan-rate-001' }
  await assert.rejects(runtime.scan_lan_devices(rateLimitedRequest), expectCode('RATE_LIMITED'))
  assert.equal(harness.calls.networkScan, 1)
  assert.equal((await runtime.get_operation_result({ idempotencyKey: rateLimitedRequest.idempotencyKey })).found, false)
  harness.advance(LAN_SCAN_MIN_INTERVAL_MS)
  const secondResult = await runtime.scan_lan_devices({ ...rateLimitedRequest })
  assert.equal(secondResult.status, 'completed')
  assert.equal(harness.calls.networkScan, 2)
})

test('unknown or expired LAN actions do not consume the rate-limit start slot', async () => {
  const unknownHarness = createHarness({ featureCode: 'lan-device-discovery', scopes: ['lan_scan'] })
  await assert.rejects(unknownHarness.runtime.scan_lan_devices({
    actionId: 'unknown_action',
    idempotencyKey: 'lan-unknown-action-001',
  }), expectCode('ACTION_NOT_FOUND'))
  const unknownInterfaces = await unknownHarness.runtime.list_network_interfaces({})
  const afterUnknown = await unknownHarness.runtime.prepare_lan_scan({ interfaceId: unknownInterfaces.interfaces[0].id })
  await unknownHarness.runtime.scan_lan_devices({ actionId: afterUnknown.actionId, idempotencyKey: 'lan-after-unknown-001' })
  assert.equal(unknownHarness.calls.networkScan, 1)

  const expiredHarness = createHarness({ featureCode: 'lan-device-discovery', scopes: ['lan_scan'] })
  const expiredInterfaces = await expiredHarness.runtime.list_network_interfaces({})
  const expiring = await expiredHarness.runtime.prepare_lan_scan({ interfaceId: expiredInterfaces.interfaces[0].id })
  expiredHarness.advance(ACTION_TTL_MS + 1)
  await assert.rejects(expiredHarness.runtime.scan_lan_devices({
    actionId: expiring.actionId,
    idempotencyKey: 'lan-expired-action-001',
  }), expectCode('ACTION_EXPIRED'))
  const afterExpired = await expiredHarness.runtime.prepare_lan_scan({ interfaceId: expiredInterfaces.interfaces[0].id })
  await expiredHarness.runtime.scan_lan_devices({ actionId: afterExpired.actionId, idempotencyKey: 'lan-after-expired-001' })
  assert.equal(expiredHarness.calls.networkScan, 1)
})

test('a consumed action with a possible side effect keeps a sticky failed idempotency result', async () => {
  const harness = createHarness({
    featureCode: 'lan-device-discovery',
    scopes: ['lan_scan'],
    networkScanError: new Error('untrusted bridge detail /Users/alice'),
  })
  const interfaces = await harness.runtime.list_network_interfaces({})
  const action = await harness.runtime.prepare_lan_scan({ interfaceId: interfaces.interfaces[0].id })
  const request = { actionId: action.actionId, idempotencyKey: 'lan-sticky-failure-001' }
  await assert.rejects(harness.runtime.scan_lan_devices(request), /Operation failed/)
  assert.equal(harness.calls.networkScan, 1)
  const failed = await harness.runtime.get_operation_result({ idempotencyKey: request.idempotencyKey })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error.code, 'OPERATION_FAILED')
  harness.advance(LAN_SCAN_MIN_INTERVAL_MS)
  await assert.rejects(harness.runtime.scan_lan_devices({ ...request }), /Operation failed/)
  assert.equal(harness.calls.networkScan, 1)
  await assert.rejects(harness.runtime.scan_lan_devices({
    actionId: action.actionId,
    idempotencyKey: 'lan-sticky-failure-002',
  }), expectCode('ACTION_NOT_FOUND'))
})
