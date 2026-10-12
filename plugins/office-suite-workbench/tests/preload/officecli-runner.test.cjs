'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const {
  createMcpConfigs,
  createOfficeCliRunner
} = require('../../preload/officecli-runner.cjs')

async function executableFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-suite-runner-'))
  const binaryPath = path.join(directory, process.platform === 'win32' ? 'officecli.exe' : 'officecli')
  await fs.writeFile(binaryPath, process.platform === 'win32' ? '' : '#!/bin/sh\nexit 0\n')
  if (process.platform !== 'win32') await fs.chmod(binaryPath, 0o755)
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { binaryPath, directory }
}

function fakeSpawn(responder) {
  const calls = []
  const spawn = (binaryPath, args, options) => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.killed = false
    child.killSignals = []
    child.kill = (signal) => {
      child.killed = true
      child.killSignal = signal
      child.killSignals.push(signal)
      return true
    }

    const call = { binaryPath, args: args.slice(), options, input: '', child }
    calls.push(call)
    child.stdin.setEncoding('utf8')
    child.stdin.on('data', (chunk) => { call.input += chunk })
    child.stdin.on('finish', () => {
      setImmediate(() => responder({ call, child, complete: ({ stdout = '', stderr = '', exitCode = 0 } = {}) => {
        if (stdout) child.stdout.write(stdout)
        if (stderr) child.stderr.write(stderr)
        child.stdout.end()
        child.stderr.end()
        setImmediate(() => child.emit('close', exitCode, null))
      } }))
    })
    return child
  }
  return { calls, spawn }
}

function fakeMcpSpawn() {
  const calls = []
  const spawn = (binaryPath, args, options) => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    const call = { binaryPath, args: args.slice(), options, messages: [] }
    calls.push(call)
    let buffer = ''

    child.stdin.setEncoding('utf8')
    child.stdin.on('data', (chunk) => {
      buffer += chunk
      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        if (!line.trim()) continue
        const request = JSON.parse(line)
        call.messages.push(request)
        if (request.method === 'initialize') {
          setImmediate(() => child.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'officecli', version: '1.2.3' },
              capabilities: { tools: { listChanged: false } }
            }
          })}\n`))
        }
        if (request.method === 'tools/list') {
          setImmediate(() => child.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: { tools: [{ name: 'officecli' }] }
          })}\n`))
        }
      }
    })
    child.stdin.on('finish', () => {
      setImmediate(() => {
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0, null)
      })
    })
    return child
  }
  return { calls, spawn }
}

test('runner discovers OfficeCLI from a supplied PATH and reports version', async (t) => {
  const fixture = await executableFixture(t)
  const fake = fakeSpawn(({ complete }) => complete({ stdout: 'officecli 1.2.3\n' }))
  const runner = createOfficeCliRunner({
    spawn: fake.spawn,
    env: { PATH: '' },
    homeDir: fixture.directory,
    commonPaths: []
  })

  const result = await runner.getStatus({ pathEnv: fixture.directory })
  assert.deepEqual(result, {
    ok: true,
    data: { installed: true, binaryPath: fixture.binaryPath, version: '1.2.3' }
  })
  assert.equal(fake.calls[0].options.shell, false)
  assert.deepEqual(fake.calls[0].args, ['--version'])
})

test('runner honors the read-only OFFICECLI_PATH environment override', async (t) => {
  const fixture = await executableFixture(t)
  const fake = fakeSpawn(({ complete }) => complete({ stdout: '1.2.4\n' }))
  const runner = createOfficeCliRunner({
    spawn: fake.spawn,
    env: { PATH: '', OFFICECLI_PATH: fixture.binaryPath },
    commonPaths: []
  })

  const result = await runner.getStatus()
  assert.equal(result.ok, true)
  assert.equal(result.data.binaryPath, fixture.binaryPath)
  assert.equal(result.data.version, '1.2.4')
})

test('win32 discovery includes the official LOCALAPPDATA OfficeCLI install directory', async (t) => {
  const localAppData = await fs.mkdtemp(path.join(os.tmpdir(), 'office-suite-win-localappdata-'))
  const installDirectory = path.join(localAppData, 'OfficeCLI')
  const binaryPath = path.join(installDirectory, 'officecli.exe')
  await fs.mkdir(installDirectory, { recursive: true })
  await fs.writeFile(binaryPath, '')
  t.after(() => fs.rm(localAppData, { recursive: true, force: true }))

  const fake = fakeSpawn(({ complete }) => complete({ stdout: '1.2.5\n' }))
  const runner = createOfficeCliRunner({
    spawn: fake.spawn,
    platform: 'win32',
    env: { Path: '', LOCALAPPDATA: localAppData },
    homeDir: localAppData,
    commonPaths: []
  })

  const result = await runner.getStatus()
  assert.equal(result.ok, true)
  assert.equal(result.data.binaryPath, binaryPath)
  assert.equal(result.data.version, '1.2.5')
})

test('document runner injects argv without a shell and returns parsed JSON', async (t) => {
  const fixture = await executableFixture(t)
  const fake = fakeSpawn(({ complete }) => complete({ stdout: '{"success":true,"data":{"text":"Hello"}}\n' }))
  const runner = createOfficeCliRunner({ spawn: fake.spawn, env: { PATH: '' }, commonPaths: [] })

  const result = await runner.run('officecli get "Report Q4.docx" /body --json', {
    binaryPath: fixture.binaryPath,
    env: { OFFICE_TEST_FLAG: 'yes' }
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.command, 'get')
  assert.deepEqual(result.data.args, ['Report Q4.docx', '/body', '--json'])
  assert.deepEqual(result.data.json, { success: true, data: { text: 'Hello' } })
  assert.deepEqual(fake.calls[0].args, ['get', 'Report Q4.docx', '/body', '--json'])
  assert.equal(fake.calls[0].options.shell, false)
  assert.equal(fake.calls[0].options.env.OFFICE_TEST_FLAG, 'yes')
  assert.equal(fake.calls[0].options.env.OFFICECLI_SKIP_UPDATE, '1')
  assert.equal(fake.calls[0].options.env.OFFICECLI_NO_AUTO_RESIDENT, '1')
})

test('document runner preserves UTF-8 characters split across stdout chunks', async (t) => {
  const fixture = await executableFixture(t)
  const fake = fakeSpawn(({ child, complete }) => {
    const output = Buffer.from('{"text":"中文"}\n', 'utf8')
    const split = output.indexOf(Buffer.from('中')) + 1
    child.stdout.write(output.subarray(0, split))
    child.stdout.write(output.subarray(split))
    complete()
  })
  const runner = createOfficeCliRunner({ spawn: fake.spawn, env: { PATH: '' }, commonPaths: [] })

  const result = await runner.run(['get', '/tmp/report.docx'], { binaryPath: fixture.binaryPath })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.json, { text: '中文' })
})

test('dangerous commands and unsupported MCP targets never reach spawn', async (t) => {
  const fixture = await executableFixture(t)
  const fake = fakeSpawn(({ complete }) => complete())
  const runner = createOfficeCliRunner({ spawn: fake.spawn, env: { PATH: '' }, commonPaths: [] })

  const blocked = await runner.run('officecli mcp claude', { binaryPath: fixture.binaryPath })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'COMMAND_BLOCKED')

  const target = await runner.registerMcp('codex', { binaryPath: fixture.binaryPath })
  assert.equal(target.ok, false)
  assert.equal(target.error.code, 'INVALID_MCP_TARGET')
  assert.equal(fake.calls.length, 0)
})

test('MCP status, register, and unregister use fixed OfficeCLI argv', async (t) => {
  const fixture = await executableFixture(t)
  const fake = fakeSpawn(({ call, complete }) => {
    if (call.args.join(' ') === 'mcp list') {
      complete({ stdout: 'officecli MCP registration status:\n  ✓ LM Studio       registered\n  ✗ Claude Code     not registered\n  ✓ Cursor          registered\n  ✗ VS Code         not registered\n' })
      return
    }
    complete({ stdout: 'ok\n' })
  })
  const runner = createOfficeCliRunner({ spawn: fake.spawn, env: { PATH: '' }, commonPaths: [] })
  const options = { binaryPath: fixture.binaryPath }

  const status = await runner.getMcpStatus(options)
  assert.equal(status.ok, true)
  assert.deepEqual(status.data.targets, { lms: true, claude: false, cursor: true, vscode: false })

  assert.equal((await runner.registerMcp('cursor', options)).ok, true)
  assert.equal((await runner.unregisterMcp('vscode', options)).ok, true)
  assert.deepEqual(fake.calls.map((call) => call.args), [
    ['mcp', 'list'],
    ['mcp', 'cursor'],
    ['mcp', 'uninstall', 'vscode']
  ])
})

test('native MCP probe performs initialize and tools/list over stdio', async (t) => {
  const fixture = await executableFixture(t)
  const fake = fakeMcpSpawn()
  const runner = createOfficeCliRunner({ spawn: fake.spawn, env: { PATH: '' }, commonPaths: [] })

  const result = await runner.probeMcp({ binaryPath: fixture.binaryPath })
  assert.deepEqual(result, {
    ok: true,
    data: {
      serverInfo: { name: 'officecli', version: '1.2.3' },
      protocolVersion: '2024-11-05',
      toolNames: ['officecli']
    }
  })
  assert.deepEqual(fake.calls[0].args, ['mcp'])
  assert.equal(fake.calls[0].options.shell, false)
  assert.deepEqual(fake.calls[0].messages.map((message) => message.method), [
    'initialize',
    'notifications/initialized',
    'tools/list'
  ])
})

test('MCP config generator returns generic/client JSON and Codex TOML', async (t) => {
  const fixture = await executableFixture(t)
  const runner = createOfficeCliRunner({ env: { PATH: '' }, commonPaths: [] })
  const result = await runner.getMcpConfigs({ binaryPath: fixture.binaryPath })

  assert.equal(result.ok, true)
  assert.deepEqual(result.data.configs.generic, { command: fixture.binaryPath, args: ['mcp'] })
  assert.deepEqual(result.data.configs.claude.mcpServers.officecli, result.data.configs.generic)
  assert.deepEqual(result.data.configs.cursor.mcpServers.officecli, result.data.configs.generic)
  assert.deepEqual(result.data.configs.vscode.servers.officecli, {
    type: 'stdio',
    ...result.data.configs.generic
  })
  assert.match(result.data.configs.codex, /^\[mcp_servers\.officecli\]/u)
  assert.match(result.data.configs.codex, /args = \["mcp"\]/u)

  const windows = createMcpConfigs('C:\\Program Files\\OfficeCLI\\officecli.exe')
  assert.match(windows.codex, /C:\\\\Program Files/u)
})

test('non-zero exits and output limits resolve to serializable errors', async (t) => {
  const fixture = await executableFixture(t)
  const failedSpawn = fakeSpawn(({ complete }) => complete({ stderr: 'document is invalid\n', exitCode: 2 }))
  const failedRunner = createOfficeCliRunner({ spawn: failedSpawn.spawn, env: { PATH: '' }, commonPaths: [] })
  const failed = await failedRunner.run('validate report.docx', { binaryPath: fixture.binaryPath })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'OFFICECLI_EXIT')
  assert.equal(failed.error.details.exitCode, 2)
  assert.doesNotThrow(() => JSON.stringify(failed))

  const largeSpawn = fakeSpawn(({ complete }) => complete({ stdout: 'x'.repeat(64) }))
  const limitedRunner = createOfficeCliRunner({ spawn: largeSpawn.spawn, env: { PATH: '' }, commonPaths: [] })
  const limited = await limitedRunner.run('get report.docx /', {
    binaryPath: fixture.binaryPath,
    maxOutputBytes: 16
  })
  assert.equal(limited.ok, false)
  assert.equal(limited.error.code, 'OUTPUT_LIMIT_EXCEEDED')
})

test('timeout and output-limit failures wait for child close before resolving', async (t) => {
  const fixture = await executableFixture(t)

  const timeoutSpawn = fakeSpawn(() => undefined)
  const timeoutRunner = createOfficeCliRunner({ spawn: timeoutSpawn.spawn, env: { PATH: '' }, commonPaths: [] })
  let timeoutSettled = false
  const timeoutPromise = timeoutRunner
    .run(['get', '/tmp/report.docx'], { binaryPath: fixture.binaryPath, timeoutMs: 10 })
    .then((result) => { timeoutSettled = true; return result })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(timeoutSettled, false)
  assert.equal(timeoutSpawn.calls[0].child.killSignal, 'SIGTERM')
  timeoutSpawn.calls[0].child.emit('close', null, 'SIGTERM')
  const timeout = await timeoutPromise
  assert.equal(timeout.ok, false)
  assert.equal(timeout.error.code, 'OFFICECLI_TIMEOUT')

  const outputSpawn = fakeSpawn(({ child }) => child.stdout.write('x'.repeat(64)))
  const outputRunner = createOfficeCliRunner({ spawn: outputSpawn.spawn, env: { PATH: '' }, commonPaths: [] })
  let outputSettled = false
  const outputPromise = outputRunner
    .run(['get', '/tmp/report.docx'], { binaryPath: fixture.binaryPath, maxOutputBytes: 16 })
    .then((result) => { outputSettled = true; return result })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(outputSettled, false)
  assert.equal(outputSpawn.calls[0].child.killSignal, 'SIGTERM')
  outputSpawn.calls[0].child.emit('close', null, 'SIGTERM')
  const output = await outputPromise
  assert.equal(output.ok, false)
  assert.equal(output.error.code, 'OUTPUT_LIMIT_EXCEEDED')
})

test('abort terminates a running OfficeCLI process and returns OFFICECLI_ABORTED', async (t) => {
  const fixture = await executableFixture(t)
  const fake = fakeSpawn(() => undefined)
  const runner = createOfficeCliRunner({ spawn: fake.spawn, env: { PATH: '' }, commonPaths: [] })
  const controller = new AbortController()

  let settled = false
  const runPromise = runner
    .run(['get', '/tmp/report.docx'], { binaryPath: fixture.binaryPath, signal: controller.signal })
    .then((result) => { settled = true; return result })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(settled, false)
  assert.equal(fake.calls[0].child.killSignal, 'SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 260))
  assert.deepEqual(fake.calls[0].child.killSignals, ['SIGTERM', 'SIGKILL'])
  fake.calls[0].child.emit('close', null, 'SIGTERM')
  const result = await runPromise
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'OFFICECLI_ABORTED')
})
