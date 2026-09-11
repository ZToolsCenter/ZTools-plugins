import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { modules, requireStrictSemver, root } from '../scripts/config.mjs'
import { resolveNpmInvocation } from '../scripts/npm-invocation.mjs'

async function testFiles(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await testFiles(target))
    else if (entry.isFile() && /\.test\.(?:cjs|mjs|ts)$/.test(entry.name)) output.push(target)
  }
  return output
}

test('root package declares one workspace for every fixed system manager module', async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(packageJson.name, 'system-manager')
  assert.equal(packageJson.version, '0.2.1')
  assert.deepEqual(packageJson.workspaces, ['modules/*'])
  assert.equal(packageJson.scripts.build, 'node scripts/build.mjs')
  assert.match(packageJson.scripts.test, /npm run build/)

  for (const module of modules) {
    const child = JSON.parse(await readFile(path.join(root, 'modules', module.id, 'package.json'), 'utf8'))
    assert.equal(child.name, module.id)
    assert.equal(typeof child.scripts.test, 'string')
    assert.equal(child.scripts.build, 'npm run build:dist')
    assert.match(child.scripts['build:dist'], new RegExp(`finalize-module-dist\\.mjs ${module.id}$`))
    await assert.rejects(access(path.join(root, 'modules', module.id, 'dist', 'plugin.json')), (error) => error?.code === 'ENOENT')
    await assert.rejects(access(path.join(root, 'modules', module.id, 'release')), (error) => error?.code === 'ENOENT')
  }
})

test('release versions must be strict SemVer and cannot influence output paths', () => {
  for (const value of ['0.1.0', '1.0.0-rc.1', '2.3.4+build.7']) assert.equal(requireStrictSemver(value), value)
  for (const value of ['v1.0.0', '01.0.0', '1.0', '1.0.0/../x', '../1.0.0', '1.0.0-01']) {
    assert.throws(() => requireStrictSemver(value), /SemVer/)
  }
})

test('workspace npm invocation uses Node plus an absolute npm CLI without a shell wrapper', () => {
  assert.deepEqual(resolveNpmInvocation({
    pathApi: path.win32,
    node: 'C:\\Program Files\\nodejs\\node.exe',
    npmCli: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
  }), {
    file: 'C:\\Program Files\\nodejs\\node.exe',
    prefix: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
  })
  for (const npmCli of ['npm.cmd', 'C:\\tools\\npm.cmd', '..\\npm-cli.js', 'C:\\tools\\evil.js']) {
    assert.throws(() => resolveNpmInvocation({ pathApi: path.win32, node: 'C:\\nodejs\\node.exe', npmCli }), /npm_execpath/)
  }
})

test('five module suites contain at least 160 independently declared tests', async () => {
  let count = 0
  const breakdown = {}
  for (const module of modules) {
    const files = await testFiles(path.join(root, 'modules', module.id, 'tests'))
    let moduleCount = 0
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      moduleCount += [...source.matchAll(/\btest\s*\(/g)].length
    }
    breakdown[module.id] = moduleCount
    count += moduleCount
  }
  assert.ok(count >= 160, `expected >=160 module tests, got ${count}: ${JSON.stringify(breakdown)}`)
  assert.ok(Object.values(breakdown).every((value) => value > 0))
})
