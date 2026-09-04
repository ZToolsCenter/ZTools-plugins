'use strict'

const path = require('node:path')
const { installSuiteRouter } = require('./router.cjs')
const { installAgentAccess } = require('./agent-access.cjs')
const { buildToolHandlers, registerSystemManagerTools } = require('./mcp-tools.cjs')
const { createSuiteRuntime } = require('./suite-runtime.cjs')

const SUITE_ROOT = path.resolve(__dirname, '..')

function loadFeatureService(featureCode, runtimeRequire = require) {
  switch (featureCode) {
    case 'system-diagnostic-report':
      runtimeRequire('../modules/system-diagnostic-report/preload/services.cjs')
      return true
    case 'application-uninstaller':
      runtimeRequire('../modules/application-uninstaller/preload/services.cjs')
      return true
    case 'startup-manager':
      runtimeRequire('../modules/startup-manager/preload/services.cjs')
      return true
    case 'system-cleaner':
      runtimeRequire('../modules/system-cleaner/preload/services.cjs')
      return true
    case 'lan-device-discovery':
      runtimeRequire('../modules/lan-device-discovery/preload/services.cjs')
      return true
    default:
      return false
  }
}

function bootstrap(hostWindow, options = {}) {
  const suiteRoot = options.suiteRoot || SUITE_ROOT
  const installed = installSuiteRouter(hostWindow, suiteRoot, options.platform || process.platform)
  if (!installed) return Object.freeze({
    page: null,
    router: null,
    serviceLoaded: false,
    mcpToolsRegistered: 0,
    registeredToolNames: Object.freeze([]),
    agentAccessInstalled: false,
  })

  if (installed.page && installed.page.kind === 'dashboard') {
    try {
      const advanced = require('./advanced-services.cjs')
      hostWindow.systemManagerAdvanced = advanced
    } catch (e) {
      console.warn('Advanced services failed to load:', e)
    }
  }
  const runtimeRequire = options.runtimeRequire || require
  const access = installAgentAccess(hostWindow, installed.page, { now: options.now })
  const runtime = createSuiteRuntime({
    hostWindow,
    page: installed.page,
    suiteRoot,
    runtimeRequire,
    now: options.now,
    agentAccess: access.controller,
  })
  const handlers = buildToolHandlers(runtime)
  const registeredToolNames = registerSystemManagerTools(hostWindow, handlers)
  const serviceLoaded = installed.page.kind === 'module'
    ? loadFeatureService(installed.page.featureCode, runtimeRequire)
    : false
  if (serviceLoaded) runtime.attachCurrentFeatureBridge()
  // ZTools keeps one onPluginOut callback per renderer. Register after the
  // lazy module service so this coordinator remains the single shutdown
  // owner and can drain both Agent journal entries and module recovery hooks.
  const hostApi = hostWindow.ztools
  let lifecycleInstalled = false
  if (hostApi && typeof hostApi.onPluginOut === 'function') {
    hostApi.onPluginOut(() => { void runtime.shutdown() })
    lifecycleInstalled = true
  }
  if (installed.page.kind === 'dashboard') {
    try {
      const advanced = require('./advanced-services.cjs')
      hostWindow.systemManagerAdvanced = advanced
    } catch (e) {
      console.warn('Advanced services failed to load:', e)
    }
  }
  return Object.freeze({
    page: installed.page,
    router: installed.router,
    serviceLoaded,
    mcpToolsRegistered: registeredToolNames.length,
    registeredToolNames,
    agentAccessInstalled: access.installed,
    lifecycleInstalled,
  })
}

if (typeof window !== 'undefined') bootstrap(window)

module.exports = Object.freeze({ SUITE_ROOT, bootstrap, loadFeatureService })
