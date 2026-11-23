const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { test, beforeEach, mock } = require('node:test')
const { pathToFileURL } = require('node:url')

const project = path.resolve("中文项目 with spaces's")
const uri = pathToFileURL(project).href
const macOnly = { skip: process.platform !== 'darwin' }
const missingCode = Object.assign(new Error('code: command not found'), { code: 127 })
let shellError
const shell = mock.fn((_command, _options, done) => done(shellError, '', ''))
const file = mock.fn((_command, _args, _options, done) => done(null, '', ''))

global.window = {
  ztools: {
    getPath: () => '/nonexistent-test-app-data',
    dbStorage: { getItem: () => null, setItem: () => {} }
  }
}
const { exec, execFile } = childProcess
childProcess.exec = shell
childProcess.execFile = file
require('../public/preload/services.js')
Object.assign(childProcess, { exec, execFile })
const { openProject, getQuickFillPresets } = window.services

beforeEach(() => {
  shellError = null
  shell.mock.resetCalls()
  file.mock.resetCalls()
})

test('missing code opens the local project in the macOS VS Code app', macOnly, async () => {
  shellError = missingCode
  await openProject('code', uri)
  assert.equal(shell.mock.callCount(), 1)
  assert.deepEqual(file.mock.calls[0].arguments.slice(0, 2), [
    '/usr/bin/open', ['-a', 'Visual Studio Code', '--', project]
  ])
})

test('missing idea opens the local project in IntelliJ IDEA on macOS', macOnly, async t => {
  t.mock.method(fs, 'existsSync', () => false)
  shellError = Object.assign(new Error('idea: command not found'), { code: 127 })
  await openProject('idea', uri, 'zsh -l -i -c')
  assert.equal(shell.mock.callCount(), 1)
  assert.deepEqual(file.mock.calls[0].arguments.slice(0, 2), [
    '/usr/bin/open', ['-a', 'IntelliJ IDEA', '--', project]
  ])
})

test('missing code uses the bundled CLI for remote directories and workspaces', macOnly, async t => {
  shellError = missingCode
  const bundled = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
  t.mock.method(fs, 'existsSync', filePath => filePath === bundled)

  const remote = 'vscode-remote://ssh-remote+fixture/projects/demo'
  await openProject('code', remote)
  await openProject('code', remote + '.code-workspace')
  assert.deepEqual(file.mock.calls.map(call => call.arguments.slice(0, 2)), [
    [bundled, ['--folder-uri', remote]],
    [bundled, ['--file-uri', remote + '.code-workspace']]
  ])
})

test('quick fill exposes all eight macOS app commands and uses them for local paths', macOnly, async t => {
  t.mock.method(fs, 'existsSync', () => false)
  const apps = ['Visual Studio Code', 'Cursor', 'VSCodium', 'IntelliJ IDEA', 'PyCharm', 'WebStorm', 'GoLand', 'Qoder IDE']
  const presets = getQuickFillPresets()
  assert.deepEqual(presets.map(preset => preset.command), apps.map(app => `/usr/bin/open -a "${app}"`))

  for (const { command } of presets) {
    await openProject(command, uri)
  }
  for (const [i, call] of shell.mock.calls.entries()) {
    assert.ok(call.arguments[0].includes(`/usr/bin/open -a "${apps[i]}"`))
    assert.ok(call.arguments[0].includes('中文项目 with spaces'))
  }
  assert.equal(shell.mock.callCount(), apps.length)
  assert.equal(file.mock.callCount(), 0)
})

test('quick fill recognizes installed alternate app names on macOS', macOnly, t => {
  const installed = new Set(['/Applications/Qoder.app', '/Applications/IntelliJ IDEA CE.app', '/Applications/PyCharm CE.app'])
  t.mock.method(fs, 'existsSync', filePath => installed.has(filePath))
  const presets = new Map(getQuickFillPresets().map(({ code, command }) => [code, command]))
  assert.equal(presets.get('qoder'), '/usr/bin/open -a "Qoder"')
  assert.equal(presets.get('idea'), '/usr/bin/open -a "IntelliJ IDEA CE"')
  assert.equal(presets.get('pycharm'), '/usr/bin/open -a "PyCharm CE"')
})

test('macOS app presets route remote URIs to the corresponding bundled CLI', macOnly, async t => {
  const apps = [['Visual Studio Code', 'code'], ['Cursor', 'cursor'], ['VSCodium', 'codium'], ['Qoder IDE', 'code']]
  const binaries = apps.map(([app, cli]) => `/Applications/${app}.app/Contents/Resources/app/bin/${cli}`)
  t.mock.method(fs, 'existsSync', filePath => binaries.includes(filePath))
  const remote = 'vscode-remote://ssh-remote+fixture/projects/demo.code-workspace'
  for (const [app] of apps) {
    await openProject(`/usr/bin/open -a "${app}"`, remote)
  }
  assert.deepEqual(file.mock.calls.map(call => call.arguments.slice(0, 2)),
    binaries.map(cli => [cli, ['--file-uri', remote]]))
  assert.equal(shell.mock.callCount(), 0)
})

test('a macOS remote app preset can use the existing CLI on PATH', macOnly, async t => {
  t.mock.method(fs, 'existsSync', () => false)
  const remote = 'vscode-remote://ssh-remote+fixture/projects/demo'
  await openProject('open -a "VSCodium"', remote)
  assert.ok(shell.mock.calls[0].arguments[0].includes('codium --folder-uri'))
  assert.equal(file.mock.callCount(), 0)
})

test('configured commands use the shell and report failures without retrying', async () => {
  await openProject('code', uri)
  assert.equal(file.mock.callCount(), 0)

  shellError = Object.assign(new Error('code failed'), { code: 1 })
  await assert.rejects(openProject('code', uri), /code failed/)
  shellError = missingCode
  await assert.rejects(openProject('custom-editor', uri), /code: command not found/)
  assert.equal(file.mock.callCount(), 0)
})
