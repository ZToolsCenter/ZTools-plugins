import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { distRoot, modules, root } from '../scripts/config.mjs'

const childScript = path.join(root, 'tests', 'runtime-preload-child.cjs')
const preload = path.join(distRoot, 'preload', 'index.cjs')

const TOOL_NAMES = Object.freeze([
  'get_capabilities', 'collect_diagnostic_report', 'render_diagnostic_report', 'export_diagnostic_report',
  'scan_applications', 'list_applications', 'inspect_application', 'prepare_application_removal',
  'execute_application_removal', 'scan_startup_items', 'list_startup_items', 'prepare_startup_change',
  'set_startup_item_enabled', 'undo_startup_change', 'scan_system_junk', 'list_system_junk',
  'prepare_system_cleanup', 'clean_system_junk', 'list_network_interfaces', 'prepare_lan_scan',
  'scan_lan_devices', 'get_operation_result',
])

function preloadState(pageUrl, hostMode = 'modern') {
  const result = spawnSync(process.execPath, [childScript, preload, pageUrl, hostMode], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
    timeout: 10_000,
  })
  assert.equal(result.status, 0, `child failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}

test('trusted dashboard registers all tools without eagerly loading a business service', () => {
  const page = pathToFileURL(path.join(distRoot, 'index.html')).href
  const state = preloadState(page)
  assert.deepEqual(state.bridges, ['systemManagerSuite', 'systemManagerAgentAccess'])
  assert.deepEqual(state.registeredTools.map(({ name }) => name), TOOL_NAMES)
  assert.equal(state.registeredTools.every(({ handlerType }) => handlerType === 'function'), true)
  assert.deepEqual(state.serviceLoads, [])
})

test('five trusted module pages re-register all tools but expose only their one business bridge', () => {
  for (const module of modules) {
    const page = pathToFileURL(path.join(distRoot, 'modules', module.id, 'index.html')).href
    const state = preloadState(page)
    assert.deepEqual(state.bridges, ['systemManagerSuite', module.bridge], module.id)
    assert.deepEqual(state.registeredTools.map(({ name }) => name), TOOL_NAMES, module.id)
    assert.equal(state.registeredTools.every(({ handlerType }) => handlerType === 'function'), true, module.id)
    assert.equal(state.serviceLoads.length, 1, module.id)
    assert.match(state.serviceLoads[0], new RegExp(`modules[/\\\\]${module.id}[/\\\\]preload[/\\\\]services\\.cjs$`), module.id)
  }
})

test('unknown file and HTTP pages receive zero privileged bridges', () => {
  for (const page of [pathToFileURL(path.join(distRoot, 'unknown.html')).href, 'http://127.0.0.1:5173/modules/system-cleaner/index.html']) {
    const state = preloadState(page)
    assert.deepEqual(state.bridges, [])
    assert.deepEqual(state.registeredTools, [])
    assert.deepEqual(state.serviceLoads, [])
  }
})

test('legacy host skips MCP registration without breaking dashboard navigation', () => {
  const page = pathToFileURL(path.join(distRoot, 'index.html')).href
  const state = preloadState(page, 'legacy')
  assert.deepEqual(state.bridges, ['systemManagerSuite', 'systemManagerAgentAccess'])
  assert.deepEqual(state.registeredTools, [])
  assert.deepEqual(state.serviceLoads, [])
})

test('one host registration rejection does not block later tools', () => {
  const page = pathToFileURL(path.join(distRoot, 'index.html')).href
  const state = preloadState(page, 'reject-one')
  assert.deepEqual(state.registeredTools.map(({ name }) => name), TOOL_NAMES.filter((name) => name !== 'render_diagnostic_report'))
  assert.equal(state.registeredTools.at(-1).name, 'get_operation_result')
})
