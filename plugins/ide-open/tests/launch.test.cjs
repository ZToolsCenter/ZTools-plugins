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

global.window = { ztools: { dbStorage: { getItem: () => null, setItem: () => {} } } }
const { exec, execFile } = childProcess
childProcess.exec = shell
childProcess.execFile = file
require('../public/preload/services.js')
Object.assign(childProcess, { exec, execFile })
const { openProject } = window.services

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
    '/usr/bin/open', ['-b', 'com.microsoft.VSCode', '--', project]
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

test('configured commands use the shell and report failures without retrying', async () => {
  await openProject('code', uri)
  assert.equal(file.mock.callCount(), 0)

  shellError = Object.assign(new Error('code failed'), { code: 1 })
  await assert.rejects(openProject('code', uri), /code failed/)
  shellError = missingCode
  await assert.rejects(openProject('custom-editor', uri), /code: command not found/)
  assert.equal(file.mock.callCount(), 0)
})
