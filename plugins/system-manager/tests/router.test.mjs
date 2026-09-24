import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'

import { modules } from '../scripts/config.mjs'

const require = createRequire(import.meta.url)
const { DIAGNOSTIC_CMDS, FEATURE_ROUTES, createSuiteRouter, installSuiteRouter, isExplicitDiagnosticIntent, resolveSuitePage } = require('../public/preload/router.cjs')
const { bootstrap } = require('../public/preload/index.cjs')
const suiteRoot = path.resolve('/trusted/system-manager')
const TOOL_NAMES = Object.freeze([
  'get_capabilities', 'collect_diagnostic_report', 'render_diagnostic_report', 'export_diagnostic_report',
  'scan_applications', 'list_applications', 'inspect_application', 'prepare_application_removal',
  'execute_application_removal', 'scan_startup_items', 'list_startup_items', 'prepare_startup_change',
  'set_startup_item_enabled', 'undo_startup_change', 'scan_system_junk', 'list_system_junk',
  'prepare_system_cleanup', 'clean_system_junk', 'list_network_interfaces', 'prepare_lan_scan',
  'scan_lan_devices', 'get_operation_result', 'get_hardware_metrics', 'inspect_archive_safety', 'audit_installed_plugin',
])

function hrefFor(relativePath) {
  return pathToFileURL(path.join(suiteRoot, ...relativePath.split('/'))).href
}

function hostAt(href) {
  const assigned = []
  const location = {
    href,
    assign(value) {
      assigned.push(value)
      this.href = value
    },
  }
  return { host: { location }, assigned }
}

test('exact root file page installs only the frozen suite router', () => {
  const { host } = hostAt(hrefFor('index.html'))
  const installed = installSuiteRouter(host, suiteRoot)
  assert.equal(installed.page.kind, 'dashboard')
  assert.equal(installed.page.featureCode, null)
  assert.equal(host.systemManagerSuite, installed.router)
  assert.equal(Object.isFrozen(installed.router), true)
  assert.deepEqual(Object.keys(installed.router), ['openFeature'])
})

test('five exact module file pages resolve to their fixed feature codes', () => {
  for (const module of modules) {
    const page = resolveSuitePage(hrefFor(`modules/${module.id}/index.html`), suiteRoot)
    assert.equal(page.kind, 'module')
    assert.equal(page.featureCode, module.id)
  }
  assert.deepEqual(Object.keys(FEATURE_ROUTES), ['system-manager', ...modules.map((module) => module.id)])
})

test('router navigates only by fixed code and unknown values return false without navigation', () => {
  const { host, assigned } = hostAt(hrefFor('index.html'))
  const router = createSuiteRouter(host, suiteRoot)
  assert.equal(router.openFeature('system-cleaner'), true)
  assert.deepEqual(assigned, [hrefFor('modules/system-cleaner/index.html')])
  for (const value of ['', '../outside', 'https://evil.invalid', 'constructor', '__proto__', null, 42, { code: 'startup-manager' }]) {
    const before = assigned.length
    assert.equal(router.openFeature(value), false)
    assert.equal(assigned.length, before)
  }
})

test('only documented same-page skip fragments retain the exact page bridge', () => {
  assert.equal(resolveSuitePage(`${hrefFor('index.html')}#modules`, suiteRoot).kind, 'dashboard')
  assert.equal(resolveSuitePage(`${hrefFor('modules/system-cleaner/index.html')}#main`, suiteRoot).featureCode, 'system-cleaner')
  assert.equal(resolveSuitePage(`${hrefFor('modules/system-diagnostic-report/index.html')}#report-content`, suiteRoot).featureCode, 'system-diagnostic-report')
  for (const href of [
    `${hrefFor('index.html')}#main`,
    `${hrefFor('modules/system-cleaner/index.html')}#modules`,
    `${hrefFor('modules/startup-manager/index.html')}#main`,
    `${hrefFor('modules/system-diagnostic-report/index.html')}#main`,
    `${hrefFor('modules/system-diagnostic-report/index.html')}#%72eport-content`,
    `${hrefFor('index.html')}#%6dodules`,
  ]) assert.equal(resolveSuitePage(href, suiteRoot), null, href)
})

test('external file, HTTP(S), query, unrecognized hash and malicious paths expose no router', () => {
  const rawRootHref = pathToFileURL(`${suiteRoot}${path.sep}`).href
  const untrusted = [
    pathToFileURL('/outside/index.html').href,
    'http://127.0.0.1/index.html',
    'https://trusted.invalid/index.html',
    `${hrefFor('index.html')}?feature=system-cleaner`,
    `${hrefFor('index.html')}#system-cleaner`,
    hrefFor('modules/system-cleaner/other.html'),
    `${rawRootHref}evil/../index.html`,
    `${rawRootHref}modules/%2e%2e/index.html`,
    `${rawRootHref}modules/%2foutside/index.html`,
    `${rawRootHref}/index.html`,
    `${rawRootHref}%69ndex.html`,
    hrefFor('index.html').replace('file:///', 'file://localhost/'),
  ]
  for (const href of untrusted) {
    const { host, assigned } = hostAt(href)
    assert.equal(installSuiteRouter(host, suiteRoot), null, href)
    assert.equal(Object.hasOwn(host, 'systemManagerSuite'), false, href)
    assert.deepEqual(assigned, [])
  }
})

test('Windows file URLs are canonical, case-insensitive, and reject UNC or ambiguous forms', () => {
  const windowsRoot = String.raw`C:\Users\Demo\System Manager`
  const windowsPage = path.win32.join(windowsRoot, 'modules', 'startup-manager', 'index.html')
  const href = pathToFileURL(windowsPage, { windows: true }).href
  assert.equal(resolveSuitePage(href, windowsRoot, 'win32').featureCode, 'startup-manager')
  assert.equal(resolveSuitePage(href.replace('C:', 'c:'), windowsRoot, 'win32').featureCode, 'startup-manager')
  assert.equal(resolveSuitePage(href.replace('file:', 'FILE:'), windowsRoot, 'win32').featureCode, 'startup-manager')
  const loads = []
  const bootstrapped = bootstrap(hostAt(href.replace('C:', 'c:')).host, { suiteRoot: windowsRoot, platform: 'win32', runtimeRequire: (value) => loads.push(value) })
  assert.equal(bootstrapped.serviceLoaded, true)
  assert.deepEqual(loads, ['../modules/startup-manager/preload/services.cjs'])
  for (const value of [
    'file://server/share/System%20Manager/index.html',
    href.replace('file:///', 'file:/'),
    href.replace('file:///', 'file:'),
    href.replace('/C:/', '/C|/'),
    ` ${href}`,
    `${href} `,
    href.replace('file:///', 'file://%6cocalhost/'),
    `${href}?query=1`,
    href.replace('/modules/', '/modules/%2e%2e/'),
    href.replace('/startup-manager/', '/startup-manager%2fescape/'),
    href.replace('System%20Manager', 'System%2520Manager'),
  ]) assert.equal(resolveSuitePage(value, windowsRoot, 'win32'), null, value)
})

test('plugin entry lifecycle reads only allowlisted code and ignores payload paths', () => {
  let onEnter
  const { host, assigned } = hostAt(hrefFor('modules/startup-manager/index.html'))
  host.ztools = { onPluginEnter(callback) { onEnter = callback } }
  installSuiteRouter(host, suiteRoot)
  onEnter({ code: 'lan-device-discovery', payload: 'file:///outside/index.html' })
  assert.deepEqual(assigned, [hrefFor('modules/lan-device-discovery/index.html')])
  onEnter({ code: '../outside' })
  assert.equal(assigned.length, 1)
})

test('diagnostic intent helper detects explicit diagnostic triggers vs generic entry', () => {
  assert.equal(DIAGNOSTIC_CMDS.size, 5)
  for (const cmd of ['系统诊断', '系统信息', '诊断报告', '电脑配置', '硬件信息']) {
    assert.equal(isExplicitDiagnosticIntent({ code: 'system-diagnostic-report', payload: cmd }), true)
    assert.equal(isExplicitDiagnosticIntent({ code: 'system-diagnostic-report', cmd }), true)
    assert.equal(isExplicitDiagnosticIntent({ code: 'system-diagnostic-report', payload: `  ${cmd}  ` }), true)
  }
  for (const nonDiag of [null, undefined, {}, { code: 'system-diagnostic-report' }, { code: 'system-diagnostic-report', type: 'over' }, { code: 'system-diagnostic-report', payload: '系统管家' }, { code: 'system-diagnostic-report', payload: '' }]) {
    assert.equal(isExplicitDiagnosticIntent(nonDiag), false)
  }
})

test('dashboard does not navigate to diagnostic report on generic plugin entry or plugin title', () => {
  let onEnter
  const { host, assigned } = hostAt(hrefFor('index.html'))
  host.ztools = { onPluginEnter(callback) { onEnter = callback } }
  installSuiteRouter(host, suiteRoot)

  // 默认直接进入系统管家主页：不发生跳转，停留在 Dashboard
  onEnter({ code: 'system-manager' })
  assert.deepEqual(assigned, [])

  onEnter({})
  assert.deepEqual(assigned, [])

  // 点击插件图标启动：不带专属触发词，绝不跳进系统信息
  onEnter({ code: 'system-diagnostic-report' })
  assert.deepEqual(assigned, [])

  // 通过插件名称“系统管家”启动：绝不跳进系统信息
  onEnter({ code: 'system-diagnostic-report', payload: '系统管家' })
  assert.deepEqual(assigned, [])

  onEnter({ code: 'system-diagnostic-report', type: 'over' })
  assert.deepEqual(assigned, [])

  // 明确输入诊断关键词：跳转至系统信息
  onEnter({ code: 'system-diagnostic-report', payload: '系统信息' })
  assert.deepEqual(assigned, [hrefFor('modules/system-diagnostic-report/index.html')])

  // 其他子模块：正常跳转
  onEnter({ code: 'system-cleaner' })
  assert.deepEqual(assigned, [
    hrefFor('modules/system-diagnostic-report/index.html'),
    hrefFor('modules/system-cleaner/index.html'),
  ])
})

test('module page navigates back to dashboard when generic system-manager entry is triggered', () => {
  let onEnter
  const { host, assigned } = hostAt(hrefFor('modules/application-uninstaller/index.html'))
  host.ztools = { onPluginEnter(callback) { onEnter = callback } }
  installSuiteRouter(host, suiteRoot)

  // 在子模块内点击“系统管家”或无意触发默认 feature：返回 Dashboard 首页
  onEnter({ code: 'system-manager' })
  assert.deepEqual(assigned, [hrefFor('index.html')])

  onEnter({ code: 'system-diagnostic-report', payload: '系统管家' })
  assert.deepEqual(assigned, [hrefFor('index.html'), hrefFor('index.html')])
})


test('bootstrap loads no service on dashboard and exactly one cjs service per module page', () => {
  const dashboardLoads = []
  const registered = []
  const { host: dashboardHost } = hostAt(hrefFor('index.html'))
  dashboardHost.ztools = {
    registerTool(name, handler) { registered.push([name, handler]) },
  }
  const dashboard = bootstrap(dashboardHost, { suiteRoot, runtimeRequire: (value) => dashboardLoads.push(value) })
  assert.equal(dashboard.serviceLoaded, false)
  assert.deepEqual(dashboardLoads, [])
  assert.equal(dashboard.agentAccessInstalled, true)
  assert.equal(dashboard.mcpToolsRegistered, TOOL_NAMES.length)
  assert.deepEqual(dashboard.registeredToolNames, TOOL_NAMES)
  assert.deepEqual(registered.map(([name]) => name), TOOL_NAMES)
  assert.equal(registered.every(([, handler]) => typeof handler === 'function'), true)
  assert.equal(Object.hasOwn(dashboardHost, 'systemManagerAgentAccess'), true)

  for (const module of modules) {
    const loads = []
    const moduleRegistered = []
    const lifecycleCallbacks = []
    const { host: moduleHost } = hostAt(hrefFor(`modules/${module.id}/index.html`))
    moduleHost.ztools = {
      registerTool(name) { moduleRegistered.push(name) },
      onPluginOut(callback) { lifecycleCallbacks.push(callback) },
    }
    const result = bootstrap(moduleHost, {
      suiteRoot,
      runtimeRequire: (value) => loads.push(value),
    })
    assert.equal(result.serviceLoaded, true)
    assert.equal(result.agentAccessInstalled, false)
    assert.equal(result.mcpToolsRegistered, TOOL_NAMES.length)
    assert.deepEqual(result.registeredToolNames, TOOL_NAMES)
    assert.deepEqual(moduleRegistered, TOOL_NAMES)
    assert.equal(Object.hasOwn(moduleHost, 'systemManagerAgentAccess'), false)
    assert.deepEqual(loads, [`../modules/${module.id}/preload/services.cjs`])
    assert.equal(lifecycleCallbacks.length, 1, `${module.id} has one root lifecycle callback`)
  }
})

test('dashboard on an older host keeps navigation and Agent access UI but skips tool registration', () => {
  const { host } = hostAt(hrefFor('index.html'))
  host.ztools = {}
  const result = bootstrap(host, { suiteRoot })
  assert.equal(result.serviceLoaded, false)
  assert.equal(result.agentAccessInstalled, true)
  assert.equal(result.mcpToolsRegistered, 0)
  assert.deepEqual(result.registeredToolNames, [])
  assert.equal(Object.hasOwn(host, 'systemManagerSuite'), true)
  assert.equal(Object.hasOwn(host, 'systemManagerAgentAccess'), true)
})

test('bootstrap on unknown or non-file pages exposes neither router nor business service', () => {
  for (const href of [pathToFileURL('/outside/index.html').href, 'http://127.0.0.1/index.html', hrefFor('unknown.html')]) {
    const loads = []
    const { host } = hostAt(href)
    const result = bootstrap(host, { suiteRoot, runtimeRequire: (value) => loads.push(value) })
    assert.equal(result.page, null)
    assert.equal(result.router, null)
    assert.equal(result.serviceLoaded, false)
    assert.equal(result.agentAccessInstalled, false)
    assert.equal(result.mcpToolsRegistered, 0)
    assert.deepEqual(result.registeredToolNames, [])
    assert.equal(Object.hasOwn(host, 'systemManagerSuite'), false)
    assert.equal(Object.hasOwn(host, 'systemManagerAgentAccess'), false)
    assert.deepEqual(loads, [])
  }
})
