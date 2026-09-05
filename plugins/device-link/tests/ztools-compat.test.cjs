'use strict'

const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const typescript = require('typescript')
const vm = require('node:vm')

function loadRendererCompatibility() {
  const sourcePath = path.resolve(__dirname, '../src/lib/ztoolsCompat.ts')
  const source = fs.readFileSync(sourcePath, 'utf8')
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports }, { filename: sourcePath })
  return module.exports
}

test('renderer version gate executes its production source of truth', () => {
  const { detectZToolsHostCompatibility, requiresZToolsUpgrade } = loadRendererCompatibility()
  assert.equal(requiresZToolsUpgrade('2.3.9'), true)
  assert.equal(requiresZToolsUpgrade('2.4.0'), false)
  assert.equal(requiresZToolsUpgrade('3.2.0'), false)
  assert.equal(requiresZToolsUpgrade('2.4.0-beta.1'), true)
  assert.equal(JSON.stringify(detectZToolsHostCompatibility(undefined)), JSON.stringify({
    mode: 'browser-preview',
    requiresUpgrade: false,
    reason: 'browser-preview',
  }))
  assert.equal(detectZToolsHostCompatibility({}).requiresUpgrade, true)
})
