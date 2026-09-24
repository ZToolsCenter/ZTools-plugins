import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'

import { root } from '../scripts/config.mjs'

const require = createRequire(import.meta.url)
const {
  TOOL_NAMES,
  buildToolHandlers,
  registerSystemManagerTools,
} = require('../public/preload/mcp-tools.cjs')

const EXPECTED_TOOL_NAMES = Object.freeze([
  'get_capabilities',
  'collect_diagnostic_report',
  'render_diagnostic_report',
  'export_diagnostic_report',
  'scan_applications',
  'list_applications',
  'inspect_application',
  'prepare_application_removal',
  'execute_application_removal',
  'scan_startup_items',
  'list_startup_items',
  'prepare_startup_change',
  'set_startup_item_enabled',
  'undo_startup_change',
  'scan_system_junk',
  'list_system_junk',
  'prepare_system_cleanup',
  'clean_system_junk',
  'list_network_interfaces',
  'prepare_lan_scan',
  'scan_lan_devices',
  'get_operation_result',
])

const manifest = JSON.parse(await readFile(path.join(root, 'public', 'plugin.json'), 'utf8'))

function fakeRuntime() {
  return Object.fromEntries(EXPECTED_TOOL_NAMES.map((name) => [name, async (input) => ({ name, input })]))
}

function verifySchemaNode(schema, location, seen = new Set()) {
  assert.ok(schema && typeof schema === 'object' && !Array.isArray(schema), `${location} must be a schema object`)
  if (seen.has(schema)) return
  seen.add(schema)
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.includes('string')) assert.ok(Number.isInteger(schema.maxLength) && schema.maxLength > 0, `${location} string maxLength`)
  if (types.includes('array')) {
    assert.ok(Number.isInteger(schema.maxItems) && schema.maxItems > 0, `${location} array maxItems`)
    assert.ok(schema.items && typeof schema.items === 'object', `${location} array items`)
  }
  if (types.includes('object')) {
    assert.ok(schema.additionalProperties === false || (schema.additionalProperties && typeof schema.additionalProperties === 'object'), `${location} controlled additionalProperties`)
    if (schema.required) {
      assert.equal(new Set(schema.required).size, schema.required.length, `${location} unique required`)
      for (const field of schema.required) assert.ok(Object.hasOwn(schema.properties || {}, field), `${location} required ${field} declared`)
    }
  }
  for (const keyword of ['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else']) {
    if (schema[keyword] && typeof schema[keyword] === 'object') verifySchemaNode(schema[keyword], `${location}.${keyword}`, seen)
  }
  for (const keyword of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    for (const [key, child] of Object.entries(schema[keyword] || {})) verifySchemaNode(child, `${location}.${keyword}.${key}`, seen)
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    for (const [index, child] of (schema[keyword] || []).entries()) verifySchemaNode(child, `${location}.${keyword}[${index}]`, seen)
  }
}

test('manifest declarations, exported names and runtime handlers match the fixed 22-tool contract', () => {
  assert.deepEqual(Object.keys(manifest.tools), EXPECTED_TOOL_NAMES)
  assert.deepEqual([...TOOL_NAMES], EXPECTED_TOOL_NAMES)
  const handlers = buildToolHandlers(fakeRuntime())
  assert.deepEqual(Object.keys(handlers), EXPECTED_TOOL_NAMES)
  for (const handler of Object.values(handlers)) assert.equal(typeof handler, 'function')
})

test('every tool has bounded strict input and output schemas', () => {
  for (const [name, declaration] of Object.entries(manifest.tools)) {
    assert.equal(typeof declaration.description, 'string', name)
    assert.ok(declaration.description.length >= 8 && declaration.description.length <= 800, name)
    for (const schemaName of ['inputSchema', 'outputSchema']) {
      const schema = declaration[schemaName]
      assert.equal(schema.type, 'object', `${name}.${schemaName}`)
      assert.equal(schema.additionalProperties, false, `${name}.${schemaName}`)
      assert.ok(schema.properties && typeof schema.properties === 'object', `${name}.${schemaName}`)
      verifySchemaNode(schema, `${name}.${schemaName}`)
    }
    for (const [field, schema] of Object.entries(declaration.inputSchema.properties)) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type]
      if (types.includes('array')) assert.ok(Number.isInteger(schema.minItems) && schema.minItems > 0, `${name}.${field} input minItems`)
    }
  }
})

test('pagination is bounded and uses opaque cursors instead of numeric offsets', () => {
  for (const name of ['scan_applications', 'list_applications', 'scan_startup_items', 'list_startup_items', 'scan_system_junk', 'list_system_junk']) {
    assert.deepEqual(manifest.tools[name].inputSchema.properties.pageSize, {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 50,
    })
  }
  for (const name of ['list_applications', 'list_startup_items', 'list_system_junk']) {
    const properties = manifest.tools[name].inputSchema.properties
    assert.ok(properties.cursor, name)
    assert.equal(Object.hasOwn(properties, 'offset'), false, name)
    assert.ok(manifest.tools[name].outputSchema.properties.nextCursor, name)
  }
})

test('side-effect descriptions disclose authorization and recovery or network/startup impact', () => {
  for (const name of ['export_diagnostic_report', 'execute_application_removal', 'set_startup_item_enabled', 'undo_startup_change', 'clean_system_junk', 'scan_lan_devices']) {
    assert.match(manifest.tools[name].description, /需要用户在系统管家界面短时授权/, name)
  }
  for (const name of ['prepare_application_removal', 'execute_application_removal', 'prepare_system_cleanup', 'clean_system_junk']) {
    assert.match(manifest.tools[name].description, /废纸篓/, name)
    assert.match(manifest.tools[name].description, /人工恢复/, name)
  }
  for (const name of ['prepare_startup_change', 'set_startup_item_enabled', 'undo_startup_change']) assert.match(manifest.tools[name].description, /启动项/, name)
  for (const name of ['prepare_lan_scan', 'scan_lan_devices']) assert.match(manifest.tools[name].description, /ICMP/, name)
})

test('old hosts skip registration without affecting preload startup', () => {
  const handlers = buildToolHandlers(fakeRuntime())
  const result = registerSystemManagerTools({ ztools: {} }, handlers)
  assert.equal(result && typeof result.then, 'undefined')
  assert.deepEqual([...result], [])
})

test('all tools register synchronously in manifest order', () => {
  const calls = []
  const handlers = buildToolHandlers(fakeRuntime())
  const result = registerSystemManagerTools({
    ztools: {
      registerTool(name, handler) {
        calls.push([name, handler])
      },
    },
  }, handlers)
  assert.equal(result && typeof result.then, 'undefined')
  assert.deepEqual(calls.map(([name]) => name), EXPECTED_TOOL_NAMES)
  assert.deepEqual([...result], EXPECTED_TOOL_NAMES)
  for (const [name, handler] of calls) assert.equal(handler, handlers[name])
})

test('one registration failure does not block later tools', () => {
  const rejected = new Set(['render_diagnostic_report', 'prepare_system_cleanup'])
  const attempted = []
  const handlers = buildToolHandlers(fakeRuntime())
  const result = registerSystemManagerTools({
    ztools: {
      registerTool(name) {
        attempted.push(name)
        if (rejected.has(name)) throw new Error('host rejected tool')
      },
    },
  }, handlers)
  assert.deepEqual(attempted, EXPECTED_TOOL_NAMES)
  assert.deepEqual([...result], EXPECTED_TOOL_NAMES.filter((name) => !rejected.has(name)))
})
