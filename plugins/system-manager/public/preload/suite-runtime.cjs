'use strict'

const crypto = require('node:crypto')

const { AGENT_SCOPES } = require('./agent-access.cjs')
const validation = require('./validation.cjs')

const ACTION_TTL_MS = 90 * 1000
const INVENTORY_TTL_MS = 5 * 60 * 1000
const JOURNAL_MAX_ENTRIES = 100
const JOURNAL_TTL_MS = 10 * 60 * 1000
const LAN_SCAN_MIN_INTERVAL_MS = 15 * 1000
const MAX_ACTIONS = 100
const MAX_RENDER_BYTES = 20 * 1024 * 1024
const REPORT_MAX_SNAPSHOTS = 3
const REPORT_TTL_MS = 5 * 60 * 1000
const RUNTIME_VERSION = '1.0'
const SUPPORTED_PLATFORMS = Object.freeze(['darwin', 'win32', 'linux'])

const FEATURE_BRIDGES = Object.freeze({
  diagnostics: 'systemReport',
  applications: 'applicationUninstaller',
  startup: 'startupManager',
  cleaner: 'systemCleaner',
  network: 'lanDiscovery',
})
const FEATURE_DOMAINS = Object.freeze({
  'system-diagnostic-report': 'diagnostics',
  'application-uninstaller': 'applications',
  'startup-manager': 'startup',
  'system-cleaner': 'cleaner',
  'lan-device-discovery': 'network',
})
const DOMAIN_METHODS = Object.freeze({
  diagnostics: Object.freeze(['collect']),
  applications: Object.freeze(['scanApps', 'inspectApp', 'executePlan']),
  startup: Object.freeze(['scan', 'setEnabled', 'undo']),
  cleaner: Object.freeze(['scan', 'clean']),
  network: Object.freeze(['listInterfaces', 'scan']),
})

const TOOL_CAPABILITIES = Object.freeze([
  ['get_capabilities', 'read', null],
  ['collect_diagnostic_report', 'read', null],
  ['render_diagnostic_report', 'read', null],
  ['export_diagnostic_report', 'write', 'report_export'],
  ['scan_applications', 'read', null],
  ['list_applications', 'read', null],
  ['inspect_application', 'read', null],
  ['prepare_application_removal', 'prepare', 'application_removal'],
  ['execute_application_removal', 'write', 'application_removal'],
  ['scan_startup_items', 'read', null],
  ['list_startup_items', 'read', null],
  ['prepare_startup_change', 'prepare', 'startup_changes'],
  ['set_startup_item_enabled', 'write', 'startup_changes'],
  ['undo_startup_change', 'write', 'startup_changes'],
  ['scan_system_junk', 'read', null],
  ['list_system_junk', 'read', null],
  ['prepare_system_cleanup', 'prepare', 'system_cleanup'],
  ['clean_system_junk', 'write', 'system_cleanup'],
  ['list_network_interfaces', 'read', null],
  ['prepare_lan_scan', 'prepare', 'lan_scan'],
  ['scan_lan_devices', 'write', 'lan_scan'],
  ['get_operation_result', 'read', null],
].map(([name, mode, scope]) => Object.freeze({ name, mode, scope })))

class RuntimeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'RuntimeError'
    this.code = code
    this.expose = true
    this.stack = `${this.name}: ${this.message}`
  }
}

function runtimeError(code, message) {
  return new RuntimeError(code, message)
}

function cleanText(value, maxLength = 240) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[A-Z]:\\(?:Users\\[^\\\s]+|[^\s]+)(?:\\[^\s]*)?/gi, '[redacted-path]')
    .replace(/\/(?:Users|home)\/[^/\s]+(?:\/[^\s]*)?/g, '[redacted-path]')
    .replace(/\b[A-Fa-f0-9]{2}(?::[A-Fa-f0-9]{2}){5}\b/g, '[redacted-mac]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function redactAbsolutePaths(value) {
  return String(value == null ? '' : value)
    .replace(/[A-Z]:\\[^\s"'<>|]+/gi, '[redacted-path]')
    .replace(/(?:\/[^\/\s"'<>|`]+)+/g, '[redacted-path]')
}

function sanitizeCommandSummary(value) {
  if (value == null) return null
  // Command lines have an effectively unbounded credential vocabulary
  // (cloud-specific environment variables, URL userinfo, shell expansion,
  // bespoke flags). Returning selected redactions is therefore unsafe. The
  // opt-in MCP view exposes only bounded structural metadata.
  const tokens = String(value).match(/"[^"]*"|'[^']*'|\S+/g) || []
  const argumentCount = Math.max(0, Math.min(999, tokens.length - 1))
  return `Command details redacted; argument count: ${argumentCount}`
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function frozenJson(value) {
  const cloned = cloneJson(value)
  const freeze = (item) => {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return item
    for (const child of Object.values(item)) freeze(child)
    return Object.freeze(item)
  }
  return freeze(cloned)
}

function safeNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback
}

function safeInteger(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback = 0) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}

function safeOptionalInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) ? safeInteger(value, 0, maximum, 0) : null
}

function safePlatform(value) {
  if (SUPPORTED_PLATFORMS.includes(value)) return value
  return SUPPORTED_PLATFORMS.includes(process.platform) ? process.platform : 'linux'
}

function safeIso(value, fallbackMs) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return new Date(Number.isFinite(parsed) ? parsed : fallbackMs).toISOString()
}

function sanitizeWarning(value) {
  if (typeof value === 'string') return cleanText(redactAbsolutePaths(value))
  if (!value || typeof value !== 'object') return ''
  const code = cleanText(value.code, 60)
  const message = cleanText(redactAbsolutePaths(value.message || value.detail), 200)
  return code && message ? `${code}: ${message}` : message || code
}

function sanitizeWarnings(values, max = 100) {
  return (Array.isArray(values) ? values : []).slice(0, max).map(sanitizeWarning).filter(Boolean)
}

function sanitizeApplication(app) {
  const install = app && app.install && typeof app.install === 'object' ? app.install : {}
  const uninstall = app && app.uninstall && typeof app.uninstall === 'object' ? app.uninstall : {}
  return {
    id: cleanText(app && app.id, 200),
    platform: safePlatform(app && app.platform),
    name: cleanText(app && app.name, 200),
    version: app && app.version == null ? null : cleanText(app.version, 100),
    publisher: app && app.publisher == null ? null : cleanText(app.publisher, 160),
    install: {
      kind: cleanText(install.kind, 60),
      scope: install.scope === 'system' ? 'system' : 'user',
    },
    uninstall: {
      mode: cleanText(uninstall.mode, 40),
      requiresElevation: Boolean(uninstall.requiresElevation),
      supported: Boolean(uninstall.supported),
    },
    protected: Boolean(app && app.protected),
  }
}

function sanitizeApplicationCandidate(candidate) {
  return {
    id: cleanText(candidate && candidate.id, 200),
    category: cleanText(candidate && candidate.category, 40),
    sizeBytes: safeOptionalInteger(candidate && candidate.sizeBytes),
    exists: Boolean(candidate && candidate.exists),
    ownership: candidate && candidate.ownership === 'system' ? 'system' : 'user',
    confidence: cleanText(candidate && candidate.confidence, 20),
    reason: cleanText(redactAbsolutePaths(candidate && candidate.reason), 240),
    selectedByDefault: Boolean(candidate && candidate.selectedByDefault),
    deletable: Boolean(candidate && candidate.deletable),
  }
}

function sanitizeStartupItem(item, includeCommandSummary) {
  const source = item && item.source && typeof item.source === 'object' ? item.source : {}
  const impact = item && item.impact && typeof item.impact === 'object' ? item.impact : {}
  const action = item && item.action && typeof item.action === 'object' ? item.action : {}
  const output = {
    id: cleanText(item && item.id, 200),
    name: cleanText(item && item.name, 160),
    scope: item && item.scope === 'system' ? 'system' : 'user',
    kind: cleanText(item && item.kind, 60),
    source: { label: cleanText(source.label, 100) },
    trigger: cleanText(item && item.trigger, 120),
    enabled: typeof (item && item.enabled) === 'boolean' ? item.enabled : null,
    running: typeof (item && item.running) === 'boolean' ? item.running : null,
    status: cleanText(item && item.status, 80),
    impact: {
      level: cleanText(impact.level, 20),
      basis: cleanText(impact.basis, 40),
      reasons: sanitizeWarnings(impact.reasons, 10),
    },
    action: {
      canToggle: Boolean(action.canToggle),
      requiresElevation: Boolean(action.requiresElevation),
      reason: action.reason == null ? null : cleanText(action.reason, 200),
    },
  }
  if (includeCommandSummary) output.commandSummary = sanitizeCommandSummary(item && item.commandSummary)
  return output
}

function sanitizeCleanerCandidate(candidate) {
  return {
    id: cleanText(candidate && candidate.id, 200),
    rootId: cleanText(candidate && candidate.rootId, 80),
    category: cleanText(candidate && candidate.category, 40),
    label: cleanText(candidate && candidate.label, 160),
    sizeBytes: safeInteger(candidate && candidate.sizeBytes),
    ageDays: safeInteger(candidate && candidate.ageDays),
    kind: cleanText(candidate && candidate.kind, 30),
    selectedByDefault: Boolean(candidate && candidate.selectedByDefault),
  }
}

function sanitizeInterface(item) {
  return {
    id: cleanText(item && item.id, 200),
    name: cleanText(item && item.name, 120),
    address: cleanText(item && item.address, 48),
    cidr: cleanText(item && item.cidr, 52),
    prefixLength: Number.isInteger(item && item.prefixLength) && item.prefixLength >= 0 && item.prefixLength <= 32 ? item.prefixLength : null,
    scope: cleanText(item && item.scope, 20),
    kind: cleanText(item && item.kind, 20),
    requiresConfirmation: Boolean(item && item.requiresConfirmation),
    riskReason: item && item.riskReason == null ? null : cleanText(item.riskReason, 120),
  }
}

function sanitizeOperationMessage(value) {
  if (value == null) return undefined
  const text = String(value)
  if (/[A-Z]:\\/i.test(text) || /(^|[\s("'\[])\/[^/\s]/.test(text)) {
    return 'Operation failed for a redacted local path'
  }
  return cleanText(redactAbsolutePaths(text), 200)
}

function bridgeValue(hostWindow, name, requiredMethods) {
  const descriptor = Object.getOwnPropertyDescriptor(hostWindow, name)
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null
  const bridge = descriptor.value
  if (!bridge || typeof bridge !== 'object' || !Object.isFrozen(bridge)) return null
  return requiredMethods.every((method) => typeof bridge[method] === 'function') ? bridge : null
}

function unwrapBridge(result) {
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return result
  if (result.ok) return result.value
  const code = result.error && result.error.code
  const mapped = {
    INVALID_REQUEST: 'INVALID_ARGUMENT',
    SNAPSHOT_EXPIRED: 'SNAPSHOT_EXPIRED',
    ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
    READ_ONLY: 'READ_ONLY',
    ITEM_CHANGED: 'ITEM_CHANGED',
    OPERATION_NOT_FOUND: 'OPERATION_NOT_FOUND',
    OPERATION_EXPIRED: 'OPERATION_NOT_FOUND',
    STATE_UNKNOWN: 'STATE_UNKNOWN',
    SHUTTING_DOWN: 'SHUTTING_DOWN',
  }[code]
  if (mapped) throw runtimeError(mapped, cleanText(result.error.message, 200) || 'The request is no longer valid')
  throw new Error('Business bridge operation failed')
}

function createOperationJournal(clock) {
  const records = new Map()

  function prune() {
    const cutoff = clock() - JOURNAL_TTL_MS
    for (const [key, record] of records) {
      const retainedAt = record.completedAt == null ? record.startedAt : record.completedAt
      if (record.status !== 'pending' && retainedAt < cutoff) records.delete(key)
    }
    while (records.size > JOURNAL_MAX_ENTRIES) {
      const removable = [...records].find(([, record]) => record.status !== 'pending')
      if (!removable) break
      records.delete(removable[0])
    }
  }

  async function run(tool, key, signature, task) {
    prune()
    const existing = records.get(key)
    if (existing) {
      if (existing.tool !== tool || existing.signature !== signature) {
        throw runtimeError('IDEMPOTENCY_CONFLICT', 'idempotencyKey is already bound to a different operation')
      }
      if (existing.status === 'failed') throw existing.error
      return existing.status === 'pending' ? existing.promise : cloneJson(existing.result)
    }
    while (records.size >= JOURNAL_MAX_ENTRIES) {
      const removable = [...records].find(([, record]) => record.status !== 'pending')
      if (!removable) throw new Error('Operation journal is busy')
      records.delete(removable[0])
    }

    const record = { tool, signature, status: 'pending', startedAt: clock(), completedAt: null, result: null, error: null, promise: null }
    records.set(key, record)
    record.promise = Promise.resolve()
      .then(task)
      .then((result) => {
        record.result = frozenJson(result)
        record.status = 'completed'
        record.completedAt = clock()
        return cloneJson(record.result)
      }, (error) => {
        if (error && (error.code === 'AUTHORIZATION_REQUIRED' || error.code === 'RATE_LIMITED')) {
          if (records.get(key) === record) records.delete(key)
          throw error
        }
        record.error = error && error.expose === true
          ? runtimeError(error.code, sanitizeOperationMessage(error.message) || 'Operation failed')
          : new Error('Operation failed')
        record.status = 'failed'
        record.completedAt = clock()
        throw record.error
      })
    return record.promise
  }

  function get(key) {
    prune()
    const record = records.get(key)
    if (!record) return { found: false, idempotencyKey: key }
    const output = {
      found: true,
      idempotencyKey: key,
      tool: record.tool,
      status: record.status,
      startedAt: new Date(record.startedAt).toISOString(),
      completedAt: record.completedAt == null ? null : new Date(record.completedAt).toISOString(),
    }
    if (record.status === 'completed') output.result = cloneJson(record.result)
    if (record.status === 'failed') output.error = {
      code: record.error && record.error.expose === true ? record.error.code : 'OPERATION_FAILED',
      message: record.error && record.error.expose === true ? sanitizeOperationMessage(record.error.message) : 'The operation failed safely',
    }
    return output
  }

  return Object.freeze({ get, run, _records: records })
}

function createSuiteRuntime(options = {}) {
  const hostWindow = options.hostWindow
  const page = options.page
  const runtimeRequire = typeof options.runtimeRequire === 'function' ? options.runtimeRequire : require
  const clock = typeof options.now === 'function' ? options.now : Date.now
  const agentAccess = options.agentAccess
  if (!hostWindow || !page || !agentAccess) throw new TypeError('trusted runtime options are required')

  const cursorSecret = crypto.randomBytes(32)
  const runtimeSessionId = crypto.randomUUID()
  const serviceCache = new Map()
  const reports = new Map()
  const appInventories = new Map()
  const appPlans = new Map()
  const startupSnapshots = new Map()
  const startupOperations = new Map()
  const cleanerSnapshots = new Map()
  const actions = new Map()
  const journal = createOperationJournal(clock)
  let currentAppInventoryId = null
  let lastLanScanStartedAt = null
  let lifecycle = 'active'
  const inFlightWrites = new Set()
  function hostStorage(namespace) {
    const db = hostWindow && hostWindow.ztools && hostWindow.ztools.dbStorage
    if (!db || typeof db.getItem !== 'function' || typeof db.setItem !== 'function') return undefined
    const keyFor = (key) => namespace ? `${namespace}:${key}` : key
    return {
      get: (key) => db.getItem(keyFor(key)),
      set: (key, value) => db.setItem(keyFor(key), value),
      remove: (key) => typeof db.removeItem === 'function' ? db.removeItem(keyFor(key)) : db.setItem(keyFor(key), null),
    }
  }

  const moduleDomain = page.kind === 'module' ? FEATURE_DOMAINS[page.featureCode] : null

  function attachCurrentFeatureBridge() {
    if (!moduleDomain || serviceCache.has(moduleDomain)) return Boolean(moduleDomain && serviceCache.has(moduleDomain))
    const shared = bridgeValue(hostWindow, FEATURE_BRIDGES[moduleDomain], DOMAIN_METHODS[moduleDomain])
    if (!shared) return false
    serviceCache.set(moduleDomain, shared)
    return true
  }
  attachCurrentFeatureBridge()

  function requireAuthorization(scope) {
    if (!agentAccess.hasScope(scope)) {
      throw runtimeError('AUTHORIZATION_REQUIRED', `Active agent access with scope ${scope} is required`)
    }
  }

  function runtimeWriteError() {
    return runtimeError('SHUTTING_DOWN', 'The plugin is shutting down; new write operations are rejected')
  }

  function runWriteJournal(tool, key, signature, task) {
    const existing = journal._records.get(key)
    if (!existing && lifecycle !== 'active') throw runtimeWriteError()
    const result = journal.run(tool, key, signature, task)
    if (!existing) {
      inFlightWrites.add(result)
      const release = () => { inFlightWrites.delete(result) }
      result.then(release, release)
    }
    return result
  }

  async function shutdown() {
    if (lifecycle === 'shutdown') return { state: lifecycle, drained: true }
    lifecycle = 'shutting-down'
    const pending = [...inFlightWrites]
    const serviceShutdowns = [...serviceCache.values()]
      .filter((value) => value && typeof value.shutdown === 'function')
      .map((value) => Promise.resolve().then(() => value.shutdown()))
    if (pending.length || serviceShutdowns.length) {
      let timer
      await Promise.race([
        Promise.allSettled([...pending, ...serviceShutdowns]),
        new Promise((resolve) => { timer = setTimeout(resolve, 200); if (timer && typeof timer.unref === 'function') timer.unref() }),
      ])
      if (timer) clearTimeout(timer)
    }
    lifecycle = 'shutdown'
    return { state: lifecycle, drained: inFlightWrites.size === 0 }
  }

  function trimSnapshots(map, max) {
    const current = clock()
    for (const [key, value] of map) if (!value || value.expiresAt <= current) map.delete(key)
    while (map.size > max) map.delete(map.keys().next().value)
  }

  function encodeCursor(kind, snapshotId, offset) {
    const payload = Buffer.from(JSON.stringify({ kind, snapshotId, offset }), 'utf8')
    const mac = crypto.createHmac('sha256', cursorSecret).update(payload).digest().subarray(0, 16)
    return Buffer.concat([mac, payload]).toString('base64url')
  }

  function decodeCursor(value, kind, snapshotId) {
    if (value === undefined) return 0
    try {
      const decoded = Buffer.from(value, 'base64url')
      if (decoded.toString('base64url') !== value) throw new Error('non-canonical cursor')
      if (decoded.length <= 16) throw new Error('short cursor')
      const mac = decoded.subarray(0, 16)
      const payload = decoded.subarray(16)
      const expected = crypto.createHmac('sha256', cursorSecret).update(payload).digest().subarray(0, 16)
      if (!crypto.timingSafeEqual(mac, expected)) throw new Error('bad cursor')
      const parsed = JSON.parse(payload.toString('utf8'))
      if (!parsed || Object.getPrototypeOf(parsed) !== Object.prototype || Object.keys(parsed).length !== 3) throw new Error('bad payload')
      if (parsed.kind !== kind || parsed.snapshotId !== snapshotId || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error('wrong cursor')
      return parsed.offset
    } catch {
      throw runtimeError('INVALID_ARGUMENT', 'cursor is invalid or belongs to a different snapshot')
    }
  }

  function pageItems(kind, snapshotId, items, cursor, pageSize) {
    const offset = decodeCursor(cursor, kind, snapshotId)
    if (offset > items.length) throw runtimeError('INVALID_ARGUMENT', 'cursor is outside the snapshot')
    const pageValues = items.slice(offset, offset + pageSize)
    const nextOffset = offset + pageValues.length
    return {
      items: cloneJson(pageValues),
      nextCursor: nextOffset < items.length ? encodeCursor(kind, snapshotId, nextOffset) : null,
    }
  }

  function createAction(kind, payload, summary) {
    const current = clock()
    for (const [key, action] of actions) if (action.expiresAt <= current || action.used) actions.delete(key)
    while (actions.size >= MAX_ACTIONS) actions.delete(actions.keys().next().value)
    const actionId = crypto.randomUUID()
    const actionDigest = crypto.createHash('sha256')
      .update(JSON.stringify({ kind, payload }))
      .digest('hex')
    const action = { kind, payload, summary: frozenJson(summary), actionDigest, expiresAt: current + ACTION_TTL_MS, used: false }
    actions.set(actionId, action)
    return {
      actionId,
      action: kind,
      actionDigest,
      expiresAt: new Date(action.expiresAt).toISOString(),
      summary: cloneJson(action.summary),
    }
  }

  function validateAction(actionId, expectedKind) {
    const action = actions.get(actionId)
    if (!action || action.used) throw runtimeError('ACTION_NOT_FOUND', 'actionId is unknown or has already been consumed')
    if (action.kind !== expectedKind) throw runtimeError('ACTION_NOT_FOUND', 'actionId belongs to a different operation')
    if (action.expiresAt <= clock()) {
      actions.delete(actionId)
      throw runtimeError('ACTION_EXPIRED', 'actionId expired; prepare the operation again')
    }
    return action
  }

  function consumeAction(actionId, expectedKind) {
    const action = validateAction(actionId, expectedKind)
    action.used = true
    return action.payload
  }

  function directDiagnosticService() {
    const nodeOs = runtimeRequire('node:os')
    const { collectSystemReport } = runtimeRequire('../modules/system-diagnostic-report/preload/collectors/core.cjs')
    const { collectSystemVolumeStats } = runtimeRequire('../modules/system-diagnostic-report/preload/collectors/node-probes.cjs')
    const { createSystemInformationProcessRunner } = runtimeRequire('../modules/system-diagnostic-report/preload/collectors/systeminformation-process-client.cjs')
    const environment = Object.create(null)
    if (typeof process.env.SystemDrive === 'string' && /^[A-Za-z]:$/.test(process.env.SystemDrive)) environment.SystemDrive = process.env.SystemDrive
    if (typeof process.env.SystemRoot === 'string' && /^[A-Za-z]:\\Windows$/i.test(process.env.SystemRoot)) environment.SystemRoot = process.env.SystemRoot
    const processInfo = Object.freeze({
      platform: safePlatform(process.platform),
      execPath: process.execPath,
      env: Object.freeze(environment),
      versions: Object.freeze({ node: process.versions.node, electron: process.versions.electron }),
    })
    const runSystemInformation = createSystemInformationProcessRunner({ processInfo })
    const flights = new Map()
    return Object.freeze({
      collect(input = {}) {
        const privacy = input.privacy === 'safe' ? 'safe' : 'fingerprint-minimal'
        if (flights.has(privacy)) return flights.get(privacy)
        const flight = collectSystemReport({ privacy }, {
          runSystemInformation,
          nodeOs,
          getSystemVolumeStats: () => collectSystemVolumeStats({ processInfo }),
          getDisplays: () => {
            const api = hostWindow.ztools
            try { return api && typeof api.getAllDisplays === 'function' ? api.getAllDisplays() : [] } catch { return [] }
          },
          getZToolsVersion: () => {
            const api = hostWindow.ztools
            try { return api && typeof api.getAppVersion === 'function' ? String(api.getAppVersion()).slice(0, 40) : null } catch { return null }
          },
          processInfo,
        })
        flights.set(privacy, flight)
        const clear = () => { if (flights.get(privacy) === flight) flights.delete(privacy) }
        flight.then(clear, clear)
        return flight
      },
    })
  }

  function directApplicationService() {
    const { shell } = runtimeRequire('electron')
    const { createEngine } = runtimeRequire('../modules/application-uninstaller/preload/core/engine.cjs')
    return createEngine({ storage: hostStorage(''), trashItem: (target) => shell.trashItem(target), revealItem: (target) => shell.showItemInFolder(target) })
  }

  function directStartupService() {
    const { createManager } = runtimeRequire('../modules/startup-manager/preload/core/manager.cjs')
    return createManager({ storage: hostStorage('') })
  }

  function directCleanerService() {
    const nodeOs = runtimeRequire('node:os')
    const { shell } = runtimeRequire('electron')
    const { createCleaner } = runtimeRequire('../modules/system-cleaner/preload/core.cjs')
    const { platformRoots } = runtimeRequire('../modules/system-cleaner/preload/roots.cjs')
    let home
    try { home = nodeOs.userInfo().homedir } catch { home = nodeOs.homedir() }
    const roots = platformRoots(process.platform, { home, temp: nodeOs.tmpdir() })
    return createCleaner({
      home,
      tempRoot: roots.find((item) => item.id === 'user-temp')?.path || null,
      roots,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      trashItem: (target) => shell.trashItem(target),
    })
  }

  function directNetworkService() {
    const { createLanScanner } = runtimeRequire('../modules/lan-device-discovery/preload/network/scanner.cjs')
    return createLanScanner()
  }

  function service(domain) {
    if (serviceCache.has(domain)) return serviceCache.get(domain)
    const value = {
      diagnostics: directDiagnosticService,
      applications: directApplicationService,
      startup: directStartupService,
      cleaner: directCleanerService,
      network: directNetworkService,
    }[domain]()
    serviceCache.set(domain, value)
    return value
  }

  function reportSnapshot(reportId) {
    trimSnapshots(reports, REPORT_MAX_SNAPSHOTS)
    const snapshot = reports.get(reportId)
    if (!snapshot) throw runtimeError('REPORT_EXPIRED', 'reportId is unknown or expired')
    return snapshot
  }

  function renderReport(snapshot, format) {
    let content
    if (format === 'json') {
      content = JSON.stringify(snapshot.report, null, 2)
    } else {
      const report = snapshot.report
      const titles = {
        overview: 'Overview', os: 'Operating system', device: 'Device', cpu: 'CPU', memory: 'Memory',
        storage: 'Storage', graphics: 'Graphics', displays: 'Displays', battery: 'Battery', runtime: 'Runtime',
        performance: 'Performance', sources: 'Sources', warnings: 'Warnings', errors: 'Errors',
      }
      const lines = [
        '# System diagnostic report', '',
        `- Generated: ${snapshot.generatedAt}`,
        `- Privacy: ${snapshot.privacy}`,
        `- Status: ${cleanText(snapshot.status, 40)}`,
        '',
      ]
      for (const key of Object.keys(titles)) {
        if (report[key] === undefined) continue
        const serialized = JSON.stringify(report[key], null, 2).replace(/```/g, '\\`\\`\\`')
        lines.push(`## ${titles[key]}`, '', '```json', serialized, '```', '')
      }
      lines.push('> Sensitive identifiers and paths are redacted by the selected privacy mode.', '')
      content = lines.join('\n')
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_RENDER_BYTES) throw new Error('Rendered report exceeds the safe size limit')
    return content
  }

  async function saveRenderedReport(snapshot, format, defaultName) {
    const api = hostWindow.ztools
    if (!api || typeof api.showSaveDialog !== 'function') throw runtimeError('SAVE_UNAVAILABLE', 'The host save dialog is unavailable')
    const nodePath = runtimeRequire('node:path')
    const nodeFs = runtimeRequire('node:fs/promises')
    const extension = format === 'json' ? '.json' : '.md'
    const base = nodePath.basename(defaultName || `system-report-${snapshot.reportId}${extension}`)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .slice(0, 160)
    const fileName = base.toLowerCase().endsWith(extension) ? base : `${base || 'system-report'}${extension}`
    const selection = await api.showSaveDialog({
      title: 'Save system diagnostic report',
      defaultPath: fileName,
      filters: [{ name: format === 'json' ? 'JSON' : 'Markdown', extensions: [format === 'json' ? 'json' : 'md'] }],
    })
    const filePath = typeof selection === 'string' ? selection : selection && !selection.canceled ? selection.filePath : null
    if (!filePath) return { reportId: snapshot.reportId, format, canceled: true }
    await nodeFs.writeFile(filePath, renderReport(snapshot, format), { encoding: 'utf8' })
    return { reportId: snapshot.reportId, format, canceled: false, fileName: nodePath.basename(filePath) }
  }

  async function get_capabilities(request) {
    validation.plainObject(request, [])
    return {
      version: RUNTIME_VERSION,
      runtimeSessionId,
      platform: process.platform,
      authorization: agentAccess.getState(),
      scopes: [...AGENT_SCOPES],
      limits: {
        actionTtlMs: ACTION_TTL_MS,
        authorizationTtlMs: 10 * 60 * 1000,
        inventoryTtlMs: INVENTORY_TTL_MS,
        journalEntries: JOURNAL_MAX_ENTRIES,
        journalTtlMs: JOURNAL_TTL_MS,
        lanScanMinIntervalMs: LAN_SCAN_MIN_INTERVAL_MS,
        pageSizeMax: 100,
        reportSnapshots: REPORT_MAX_SNAPSHOTS,
        reportTtlMs: REPORT_TTL_MS,
      },
      tools: TOOL_CAPABILITIES.map((item) => ({ ...item })),
    }
  }

  async function collect_diagnostic_report(request) {
    const input = validation.plainObject(request, ['privacy'])
    const privacy = input.privacy === undefined
      ? 'fingerprint-minimal'
      : validation.string(input.privacy, 'privacy', { values: ['fingerprint-minimal', 'safe'], max: 32 })
    const report = await service('diagnostics').collect({ privacy })
    const reportId = crypto.randomUUID()
    const generatedAt = safeIso(report && report.overview && report.overview.generatedAt, clock())
    const snapshot = {
      reportId,
      generatedAt,
      expiresAt: clock() + REPORT_TTL_MS,
      privacy,
      status: ['ok', 'warning', 'partial', 'failed'].includes(report && report.status) ? report.status : 'unknown',
      report: frozenJson(report),
    }
    reports.set(reportId, snapshot)
    trimSnapshots(reports, REPORT_MAX_SNAPSHOTS)
    return {
      reportId,
      generatedAt,
      expiresAt: new Date(snapshot.expiresAt).toISOString(),
      privacy,
      status: snapshot.status,
      report: cloneJson(snapshot.report),
    }
  }

  async function render_diagnostic_report(request) {
    const input = validation.plainObject(request, ['reportId', 'format'])
    const reportId = validation.id(input.reportId, 'reportId')
    const format = validation.string(input.format, 'format', { values: ['json', 'markdown'], max: 16 })
    const snapshot = reportSnapshot(reportId)
    return { reportId, format, generatedAt: snapshot.generatedAt, content: renderReport(snapshot, format) }
  }

  async function export_diagnostic_report(request) {
    const input = validation.plainObject(request, ['reportId', 'format', 'defaultName', 'idempotencyKey'])
    const reportId = validation.id(input.reportId, 'reportId')
    const format = validation.string(input.format, 'format', { values: ['json', 'markdown'], max: 16 })
    const defaultName = validation.optionalString(input.defaultName, 'defaultName', { min: 1, max: 160, pattern: /^[^\\/\u0000-\u001f]+$/ })
    const key = validation.idempotencyKey(input.idempotencyKey)
    const signature = JSON.stringify({ reportId, format, defaultName: defaultName || null })
    return runWriteJournal('export_diagnostic_report', key, signature, async () => {
      requireAuthorization('report_export')
      const snapshot = reportSnapshot(reportId)
      return {
        ...await saveRenderedReport(snapshot, format, defaultName),
        idempotencyKey: key,
      }
    })
  }

  async function scan_applications(request) {
    const input = validation.plainObject(request, ['pageSize'])
    const pageSize = validation.pageSize(input.pageSize)
    const result = await service('applications').scanApps()
    const inventoryId = crypto.randomUUID()
    const items = (Array.isArray(result && result.apps) ? result.apps : []).slice(0, 5000).map(sanitizeApplication)
    const snapshot = { inventoryId, items, expiresAt: clock() + INVENTORY_TTL_MS }
    appInventories.clear()
    appPlans.clear()
    appInventories.set(inventoryId, snapshot)
    currentAppInventoryId = inventoryId
    const pageResult = pageItems('applications', inventoryId, items, undefined, pageSize)
    return {
      inventoryId,
      platform: safePlatform(result && result.platform),
      scannedAt: safeIso(result && result.scannedAt, clock()),
      total: items.length,
      items: pageResult.items,
      nextCursor: pageResult.nextCursor,
      warnings: sanitizeWarnings(result && result.warnings, 20),
    }
  }

  function appInventory(inventoryId) {
    trimSnapshots(appInventories, 1)
    const snapshot = appInventories.get(inventoryId)
    if (!snapshot) throw runtimeError('SNAPSHOT_EXPIRED', 'application inventory is unknown or expired')
    return snapshot
  }

  async function list_applications(request) {
    const input = validation.plainObject(request, ['inventoryId', 'cursor', 'pageSize'])
    const inventoryId = validation.id(input.inventoryId, 'inventoryId')
    const cursor = validation.cursor(input.cursor)
    const pageSize = validation.pageSize(input.pageSize)
    const snapshot = appInventory(inventoryId)
    const pageResult = pageItems('applications', inventoryId, snapshot.items, cursor, pageSize)
    return { inventoryId, total: snapshot.items.length, pageSize, items: pageResult.items, nextCursor: pageResult.nextCursor }
  }

  async function inspect_application(request) {
    const input = validation.plainObject(request, ['inventoryId', 'appId'])
    const inventoryId = validation.id(input.inventoryId, 'inventoryId')
    const appId = validation.id(input.appId, 'appId')
    const inventory = appInventory(inventoryId)
    if (inventoryId !== currentAppInventoryId || !inventory.items.some((item) => item.id === appId)) {
      throw runtimeError('NOT_FOUND', 'application is not part of the current inventory')
    }
    const plan = await service('applications').inspectApp(appId)
    const candidates = (Array.isArray(plan && plan.candidates) ? plan.candidates : []).slice(0, 200).map(sanitizeApplicationCandidate)
    appPlans.clear()
    appPlans.set(plan.id, {
      inventoryId,
      planId: plan.id,
      app: sanitizeApplication(plan.app),
      appName: cleanText(plan && plan.app && plan.app.name, 200),
      candidates: new Map(candidates.map((item) => [item.id, item])),
      expiresAt: Math.min(Date.parse(plan.expiresAt) || clock() + ACTION_TTL_MS, clock() + 2 * 60 * 1000),
    })
    return {
      inventoryId,
      planId: plan.id,
      app: sanitizeApplication(plan.app),
      createdAt: safeIso(plan.createdAt, clock()),
      expiresAt: safeIso(plan.expiresAt, clock() + ACTION_TTL_MS),
      candidates,
      warnings: sanitizeWarnings(plan.warnings, 20),
    }
  }

  async function prepare_application_removal(request) {
    const input = validation.plainObject(request, ['planId', 'selectedIds'])
    const planId = validation.id(input.planId, 'planId')
    const selectedIds = validation.stringArray(input.selectedIds, 'selectedIds', { min: 1, max: 200, pattern: validation.SAFE_ID })
    requireAuthorization('application_removal')
    const plan = appPlans.get(planId)
    if (!plan || plan.expiresAt <= clock()) throw runtimeError('SNAPSHOT_EXPIRED', 'application plan is unknown or expired')
    for (const id of selectedIds) {
      const candidate = plan.candidates.get(id)
      if (!candidate || !candidate.deletable) throw runtimeError('INVALID_ARGUMENT', 'selectedIds contains an unavailable candidate')
    }
    return createAction('application_removal', { planId, selectedIds, appName: plan.appName }, {
      app: plan.app,
      candidateCount: selectedIds.length,
    })
  }

  async function execute_application_removal(request) {
    const input = validation.plainObject(request, ['actionId', 'idempotencyKey'])
    const actionId = validation.id(input.actionId, 'actionId')
    const key = validation.idempotencyKey(input.idempotencyKey)
    return runWriteJournal('execute_application_removal', key, actionId, async () => {
      requireAuthorization('application_removal')
      const action = consumeAction(actionId, 'application_removal')
      const result = await service('applications').executePlan({ planId: action.planId, selectedIds: action.selectedIds, confirmation: action.appName })
      return {
        planId: cleanText(result && result.planId, 200),
        completedAt: safeIso(result && result.completedAt, clock()),
        results: (Array.isArray(result && result.results) ? result.results : []).slice(0, 201).map((item) => ({
          candidateId: cleanText(item && item.candidateId, 200),
          status: cleanText(item && item.status, 40),
          ...(sanitizeOperationMessage(item && item.message) ? { message: sanitizeOperationMessage(item.message) } : {}),
        })),
        idempotencyKey: key,
      }
    })
  }

  async function scan_startup_items(request) {
    const input = validation.plainObject(request, ['pageSize', 'includeCommandSummary'])
    const pageSize = validation.pageSize(input.pageSize)
    const includeCommandSummary = validation.optionalBoolean(input.includeCommandSummary, 'includeCommandSummary', false)
    const raw = unwrapBridge(await service('startup').scan())
    const snapshotId = validation.id(raw.snapshotId, 'snapshotId')
    if (raw.recoveredOperationId) {
      // The module has already enforced its own 10-minute journal TTL. Use
      // this runtime's clock for the rehydrated metadata to avoid mixing
      // wall-clock sources in tests or after a system clock adjustment.
      startupOperations.set(raw.recoveredOperationId, { includeCommandSummary, expiresAt: clock() + INVENTORY_TTL_MS })
    }
    const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 5000).map((item) => sanitizeStartupItem(item, includeCommandSummary))
    const snapshot = { snapshotId, items, includeCommandSummary, expiresAt: clock() + INVENTORY_TTL_MS }
    startupSnapshots.set(snapshotId, snapshot)
    trimSnapshots(startupSnapshots, 3)
    const pageResult = pageItems('startup', snapshotId, items, undefined, pageSize)
    return {
      snapshotId,
      platform: safePlatform(raw.platform),
      generatedAt: safeIso(raw.generatedAt, clock()),
      total: items.length,
      items: pageResult.items,
      nextCursor: pageResult.nextCursor,
      warnings: sanitizeWarnings(raw.warnings, 100),
      includeCommandSummary,
    }
  }

  function startupSnapshot(snapshotId) {
    trimSnapshots(startupSnapshots, 3)
    const snapshot = startupSnapshots.get(snapshotId)
    if (!snapshot) throw runtimeError('SNAPSHOT_EXPIRED', 'startup snapshot is unknown or expired')
    return snapshot
  }

  async function list_startup_items(request) {
    const input = validation.plainObject(request, ['snapshotId', 'cursor', 'pageSize'])
    const snapshotId = validation.id(input.snapshotId, 'snapshotId')
    const cursor = validation.cursor(input.cursor)
    const pageSize = validation.pageSize(input.pageSize)
    const snapshot = startupSnapshot(snapshotId)
    const pageResult = pageItems('startup', snapshotId, snapshot.items, cursor, pageSize)
    return { snapshotId, total: snapshot.items.length, pageSize, items: pageResult.items, nextCursor: pageResult.nextCursor, includeCommandSummary: snapshot.includeCommandSummary }
  }

  async function prepare_startup_change(request) {
    const input = validation.plainObject(request, ['snapshotId', 'itemId', 'enabled'])
    const snapshotId = validation.id(input.snapshotId, 'snapshotId')
    const itemId = validation.id(input.itemId, 'itemId')
    const enabled = validation.boolean(input.enabled, 'enabled')
    requireAuthorization('startup_changes')
    const snapshot = startupSnapshot(snapshotId)
    const item = snapshot.items.find((candidate) => candidate.id === itemId)
    if (!item) throw runtimeError('ITEM_NOT_FOUND', 'startup item is not part of the snapshot')
    if (!item.action.canToggle || item.scope !== 'user') throw runtimeError('READ_ONLY', 'startup item is read-only')
    return createAction('startup_change', { snapshotId, itemId, enabled, includeCommandSummary: snapshot.includeCommandSummary }, {
      item: sanitizeStartupItem(item, false),
      enabled,
    })
  }

  async function set_startup_item_enabled(request) {
    const input = validation.plainObject(request, ['actionId', 'idempotencyKey'])
    const actionId = validation.id(input.actionId, 'actionId')
    const key = validation.idempotencyKey(input.idempotencyKey)
    return runWriteJournal('set_startup_item_enabled', key, actionId, async () => {
      requireAuthorization('startup_changes')
      const action = consumeAction(actionId, 'startup_change')
      const result = unwrapBridge(await service('startup').setEnabled({ snapshotId: action.snapshotId, itemId: action.itemId, enabled: action.enabled }))
      if (result.operationId) startupOperations.set(result.operationId, { includeCommandSummary: action.includeCommandSummary, expiresAt: clock() + INVENTORY_TTL_MS })
      return {
        changed: Boolean(result.changed),
        operationId: result.operationId || null,
        item: sanitizeStartupItem(result.item, action.includeCommandSummary),
        idempotencyKey: key,
      }
    })
  }

  async function undo_startup_change(request) {
    const input = validation.plainObject(request, ['operationId', 'idempotencyKey'])
    const operationId = validation.id(input.operationId, 'operationId')
    const key = validation.idempotencyKey(input.idempotencyKey)
    return runWriteJournal('undo_startup_change', key, operationId, async () => {
      requireAuthorization('startup_changes')
      const metadata = startupOperations.get(operationId)
      if (!metadata || metadata.expiresAt <= clock()) throw runtimeError('OPERATION_NOT_FOUND', 'startup operation is unknown or expired')
      const result = unwrapBridge(await service('startup').undo({ operationId }))
      startupOperations.delete(operationId)
      return { restored: Boolean(result.restored), item: sanitizeStartupItem(result.item, metadata.includeCommandSummary), idempotencyKey: key }
    })
  }

  async function scan_system_junk(request) {
    const input = validation.plainObject(request, ['categories', 'pageSize'])
    const categories = validation.optionalStringArray(input.categories, 'categories', { min: 1, max: 3, values: ['cache', 'logs', 'temporary'], itemMax: 16 })
    const pageSize = validation.pageSize(input.pageSize)
    const raw = await service('cleaner').scan(categories ? { categories } : {})
    const snapshotId = validation.id(raw.snapshotId, 'snapshotId')
    const items = (Array.isArray(raw.candidates) ? raw.candidates : []).slice(0, 2000).map(sanitizeCleanerCandidate)
    const expiresAtMs = Math.min(Date.parse(raw.expiresAt) || clock() + 2 * 60 * 1000, clock() + INVENTORY_TTL_MS)
    cleanerSnapshots.set(snapshotId, { snapshotId, items, totalBytes: safeInteger(raw.totalBytes), expiresAt: expiresAtMs })
    trimSnapshots(cleanerSnapshots, 4)
    const pageResult = pageItems('cleaner', snapshotId, items, undefined, pageSize)
    return {
      snapshotId,
      generatedAt: safeIso(raw.generatedAt, clock()),
      expiresAt: new Date(expiresAtMs).toISOString(),
      total: items.length,
      totalBytes: safeInteger(raw.totalBytes),
      items: pageResult.items,
      nextCursor: pageResult.nextCursor,
      warnings: sanitizeWarnings(raw.warnings, 100),
    }
  }

  function cleanerSnapshot(snapshotId) {
    trimSnapshots(cleanerSnapshots, 4)
    const snapshot = cleanerSnapshots.get(snapshotId)
    if (!snapshot) throw runtimeError('SNAPSHOT_EXPIRED', 'cleaner snapshot is unknown or expired')
    return snapshot
  }

  async function list_system_junk(request) {
    const input = validation.plainObject(request, ['snapshotId', 'cursor', 'pageSize'])
    const snapshotId = validation.id(input.snapshotId, 'snapshotId')
    const cursor = validation.cursor(input.cursor)
    const pageSize = validation.pageSize(input.pageSize)
    const snapshot = cleanerSnapshot(snapshotId)
    const pageResult = pageItems('cleaner', snapshotId, snapshot.items, cursor, pageSize)
    return { snapshotId, total: snapshot.items.length, totalBytes: snapshot.totalBytes, pageSize, items: pageResult.items, nextCursor: pageResult.nextCursor }
  }

  async function prepare_system_cleanup(request) {
    const input = validation.plainObject(request, ['snapshotId', 'candidateIds'])
    const snapshotId = validation.id(input.snapshotId, 'snapshotId')
    const candidateIds = validation.stringArray(input.candidateIds, 'candidateIds', { min: 1, max: 2000, pattern: validation.SAFE_ID })
    requireAuthorization('system_cleanup')
    const snapshot = cleanerSnapshot(snapshotId)
    const byId = new Map(snapshot.items.map((item) => [item.id, item]))
    let selectedBytes = 0
    for (const id of candidateIds) {
      const candidate = byId.get(id)
      if (!candidate) throw runtimeError('INVALID_ARGUMENT', 'candidateIds contains an item outside the snapshot')
      selectedBytes += candidate.sizeBytes || 0
    }
    return createAction('system_cleanup', { snapshotId, candidateIds }, { candidateCount: candidateIds.length, selectedBytes })
  }

  async function clean_system_junk(request) {
    const input = validation.plainObject(request, ['actionId', 'idempotencyKey'])
    const actionId = validation.id(input.actionId, 'actionId')
    const key = validation.idempotencyKey(input.idempotencyKey)
    return runWriteJournal('clean_system_junk', key, actionId, async () => {
      requireAuthorization('system_cleanup')
      const action = consumeAction(actionId, 'system_cleanup')
      const result = await service('cleaner').clean({ snapshotId: action.snapshotId, candidateIds: action.candidateIds, confirmation: '移到废纸篓' })
      return {
        operationId: cleanText(result && result.operationId, 200),
        completedAt: safeIso(result && result.completedAt, clock()),
        results: (Array.isArray(result && result.results) ? result.results : []).slice(0, 2000).map((item) => ({
          candidateId: cleanText(item && item.candidateId, 200),
          status: cleanText(item && item.status, 40),
          sizeBytes: safeInteger(item && item.sizeBytes),
          ...(item && item.code ? { code: cleanText(item.code, 60) } : {}),
          ...(sanitizeOperationMessage(item && item.message) ? { message: sanitizeOperationMessage(item.message) } : {}),
        })),
        movedBytes: safeInteger(result && result.movedBytes),
        idempotencyKey: key,
      }
    })
  }

  async function list_network_interfaces(request) {
    validation.plainObject(request, [])
    const values = await service('network').listInterfaces()
    return { interfaces: (Array.isArray(values) ? values : []).slice(0, 64).map(sanitizeInterface) }
  }

  function sameInterface(left, right) {
    return Boolean(left && right && left.id === right.id && left.address === right.address && left.prefixLength === right.prefixLength && left.scope === right.scope && left.kind === right.kind)
  }

  async function prepare_lan_scan(request) {
    const input = validation.plainObject(request, ['interfaceId', 'resolveHostnames', 'confirmRestrictedInterface'])
    const interfaceId = validation.id(input.interfaceId, 'interfaceId')
    const resolveHostnames = validation.optionalBoolean(input.resolveHostnames, 'resolveHostnames', false)
    const confirmRestrictedInterface = validation.optionalBoolean(input.confirmRestrictedInterface, 'confirmRestrictedInterface', false)
    requireAuthorization('lan_scan')
    const values = await service('network').listInterfaces()
    const selected = (Array.isArray(values) ? values : []).find((item) => item && item.id === interfaceId)
    if (!selected) throw runtimeError('INVALID_INTERFACE', 'interfaceId is not an active supported interface')
    if (selected.requiresConfirmation && !confirmRestrictedInterface) {
      throw runtimeError('CONFIRMATION_REQUIRED', 'This interface requires explicit confirmation before scanning')
    }
    const safeInterface = sanitizeInterface(selected)
    return createAction('lan_scan', { interfaceId, resolveHostnames, confirmRestrictedInterface, interface: safeInterface }, {
      interface: safeInterface,
      resolveHostnames,
      requiresConfirmation: Boolean(selected.requiresConfirmation),
      confirmRestrictedInterface,
    })
  }

  async function scan_lan_devices(request) {
    const input = validation.plainObject(request, ['actionId', 'idempotencyKey'])
    const actionId = validation.id(input.actionId, 'actionId')
    const key = validation.idempotencyKey(input.idempotencyKey)
    return runWriteJournal('scan_lan_devices', key, actionId, async () => {
      requireAuthorization('lan_scan')
      validateAction(actionId, 'lan_scan')
      if (lastLanScanStartedAt != null && clock() - lastLanScanStartedAt < LAN_SCAN_MIN_INTERVAL_MS) {
        throw runtimeError('RATE_LIMITED', 'LAN scans are limited to one start every 15 seconds')
      }
      lastLanScanStartedAt = clock()
      const action = consumeAction(actionId, 'lan_scan')
      const values = await service('network').listInterfaces()
      const current = (Array.isArray(values) ? values : []).find((item) => item && item.id === action.interfaceId)
      if (!sameInterface(action.interface, sanitizeInterface(current))) throw runtimeError('INVALID_INTERFACE', 'network interface changed after preparation')
      const result = await service('network').scan({
        interfaceId: action.interfaceId,
        resolveHostnames: action.resolveHostnames,
        confirmRestrictedInterface: action.confirmRestrictedInterface === true,
      })
      return {
        scanId: cleanText(result && result.scanId, 200),
        status: ['completed', 'partial', 'cancelled'].includes(result && result.status) ? result.status : 'partial',
        interface: sanitizeInterface(result && result.interface),
        devices: (Array.isArray(result && result.devices) ? result.devices : []).slice(0, 255).map((device) => ({
          ip: cleanText(device && device.ip, 48),
          hostname: device && device.hostname == null ? null : cleanText(device.hostname, 255),
          vendor: device && device.vendor == null ? null : cleanText(device.vendor, 160),
          onlineStatus: cleanText(device && device.onlineStatus, 30),
          evidence: sanitizeWarnings(device && device.evidence, 10),
          isSelf: Boolean(device && device.isSelf),
        })),
        startedAt: safeIso(result && result.startedAt, clock()),
        finishedAt: safeIso(result && result.finishedAt, clock()),
        durationMs: Math.min(30_000, Math.max(0, Math.round(safeNumber(result && result.durationMs, 0)))),
        scannedHostCount: Math.min(254, Math.max(0, Math.round(safeNumber(result && result.scannedHostCount, 0)))),
        truncated: Boolean(result && result.truncated),
        warnings: sanitizeWarnings(result && result.warnings, 100),
        errors: (Array.isArray(result && result.errors) ? result.errors : []).slice(0, 100).map((error) => ({
          code: cleanText(error && error.code, 60),
          message: cleanText(error && error.message, 200),
        })),
        idempotencyKey: key,
      }
    })
  }

  async function get_operation_result(request) {
    const input = validation.plainObject(request, ['idempotencyKey'])
    return {
      runtimeSessionId,
      ...journal.get(validation.idempotencyKey(input.idempotencyKey)),
    }
  }

  return Object.freeze({
    get_capabilities,
    collect_diagnostic_report,
    render_diagnostic_report,
    export_diagnostic_report,
    scan_applications,
    list_applications,
    inspect_application,
    prepare_application_removal,
    execute_application_removal,
    scan_startup_items,
    list_startup_items,
    prepare_startup_change,
    set_startup_item_enabled,
    undo_startup_change,
    scan_system_junk,
    list_system_junk,
    prepare_system_cleanup,
    clean_system_junk,
    list_network_interfaces,
    prepare_lan_scan,
    scan_lan_devices,
    get_operation_result,
    shutdown,
    isShuttingDown: () => lifecycle !== 'active',
    attachCurrentFeatureBridge,
    _state: Object.freeze({ actions, appInventories, appPlans, cleanerSnapshots, journal, reports, runtimeSessionId, serviceCache, startupOperations, startupSnapshots, inFlightWrites, get lifecycle() { return lifecycle } }),
  })
}

module.exports = Object.freeze({
  ACTION_TTL_MS,
  INVENTORY_TTL_MS,
  JOURNAL_MAX_ENTRIES,
  JOURNAL_TTL_MS,
  LAN_SCAN_MIN_INTERVAL_MS,
  MAX_ACTIONS,
  REPORT_MAX_SNAPSHOTS,
  REPORT_TTL_MS,
  RUNTIME_VERSION,
  RuntimeError,
  TOOL_CAPABILITIES,
  cleanText,
  redactAbsolutePaths,
  sanitizeCommandSummary,
  createOperationJournal,
  createSuiteRuntime,
  runtimeError,
})
