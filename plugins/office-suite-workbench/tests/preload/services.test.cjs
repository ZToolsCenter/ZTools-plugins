'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  AI_CANCEL_SETTLE_TIMEOUT_MS,
  AI_TOOL_TIMEOUT_MS,
  MCP_TOOL_TIMEOUT_MS,
  attachOfficeSuite,
  getHostCompatibility
} = require('../../preload/services.cjs')

test('preload stays inert for real hosts without a trustworthy 2.4+ version', () => {
  assert.deepEqual(getHostCompatibility(undefined), {
    mode: 'browser-preview',
    requiresUpgrade: false,
    reason: 'browser-preview'
  })
  assert.equal(getHostCompatibility({}).requiresUpgrade, true)
  assert.equal(getHostCompatibility({ getAppVersion() { throw new Error('bridge failure') } }).requiresUpgrade, true)
  assert.equal(getHostCompatibility({ getAppVersion() { return 'invalid' } }).requiresUpgrade, true)
  assert.equal(getHostCompatibility({ getAppVersion() { return '2.3.9' } }).requiresUpgrade, true)
  assert.equal(getHostCompatibility({ getAppVersion() { return '2.4.0-beta.1' } }).requiresUpgrade, true)
  assert.equal(getHostCompatibility({ getAppVersion() { return '2.4.0' } }).requiresUpgrade, false)
  assert.equal(getHostCompatibility({ getAppVersion() { return '3.2.0' } }).requiresUpgrade, false)
})

function runnerMock() {
  const calls = []
  const method = (name) => async (...args) => {
    calls.push({ name, args })
    return { ok: true, data: { name, args } }
  }
  return {
    calls,
    installer: {
      async check(version) {
        calls.push({ name: 'check', args: [version] })
        return { installed: true, currentVersion: version, latestVersion: '1.2.4', updateAvailable: true, checkedAt: '2026-07-27T00:00:00.000Z' }
      },
      async install() {
        calls.push({ name: 'install', args: [] })
        return { installed: true, binaryPath: '/tmp/officecli', version: '1.2.3', release: 'v1.2.3', asset: 'test' }
      },
      async update(binaryPath) {
        calls.push({ name: 'update', args: [binaryPath] })
        return { installed: true, binaryPath, version: '1.2.4', release: 'v1.2.4', asset: 'test' }
      }
    },
    runner: {
      getStatus: method('getStatus'),
      run: method('run'),
      getMcpStatus: method('getMcpStatus'),
      registerMcp: method('registerMcp'),
      unregisterMcp: method('unregisterMcp'),
      probeMcp: method('probeMcp'),
      getMcpConfigs: method('getMcpConfigs')
    }
  }
}

test('attachOfficeSuite exposes only the fixed narrow UI methods', () => {
  const mock = runnerMock()
  const target = {}
  attachOfficeSuite(target, mock.runner, mock.installer)
  assert.deepEqual(Object.keys(target.officeSuite).sort(), [
    'cancelAiRuns',
    'checkOfficeCliUpdate',
    'getMcpConfigs',
    'getMcpStatus',
    'getStatus',
    'installOfficeCli',
    'probeMcp',
    'registerMcp',
    'run',
    'runForAi',
    'unregisterMcp',
    'updateOfficeCli'
  ])
})

test('one-click installer is exposed as a fixed no-argument bridge method', async () => {
  const mock = runnerMock()
  const target = {}
  attachOfficeSuite(target, mock.runner, mock.installer)

  const result = await target.officeSuite.installOfficeCli({ binaryPath: '/tmp/untrusted' })
  assert.equal(result.ok, true)
  assert.equal(result.data.version, '1.2.3')
  assert.deepEqual(mock.calls, [{ name: 'install', args: [] }])
})

test('background update check and one-click update derive the binary path from the trusted runner', async () => {
  const mock = runnerMock()
  mock.runner.getStatus = async () => ({
    ok: true,
    data: { installed: true, binaryPath: '/tmp/officecli', version: '1.2.3' }
  })
  const target = {}
  attachOfficeSuite(target, mock.runner, mock.installer)

  const check = await target.officeSuite.checkOfficeCliUpdate({ binaryPath: '/tmp/untrusted' })
  assert.equal(check.ok, true)
  assert.equal(check.data.updateAvailable, true)

  const update = await target.officeSuite.updateOfficeCli({ binaryPath: '/tmp/untrusted' })
  assert.equal(update.ok, true)
  assert.equal(update.data.version, '1.2.4')
  assert.deepEqual(mock.calls, [
    { name: 'check', args: ['1.2.3'] },
    { name: 'update', args: ['/tmp/officecli'] }
  ])
})

test('native AI bridge enforces per-turn write approval without weakening MCP policy', async () => {
  const mock = runnerMock()
  const target = {}
  attachOfficeSuite(target, mock.runner)

  const read = await target.officeSuite.runForAi(
    ['get', '/tmp/report.docx', '/body'],
    { allowWrite: false }
  )
  assert.equal(read.ok, true)
  assert.equal(mock.calls[0].name, 'run')
  assert.deepEqual(mock.calls[0].args[0], ['get', '/tmp/report.docx', '/body'])
  assert.equal(mock.calls[0].args[1].timeoutMs, AI_TOOL_TIMEOUT_MS)
  assert.deepEqual(mock.calls[0].args[1].env, { OFFICECLI_NO_AUTO_RESIDENT: '1' })
  assert.equal(mock.calls[0].args[1].signal instanceof AbortSignal, true)

  const blockedWrite = await target.officeSuite.runForAi(
    ['set', '/tmp/report.docx', '/body/p[1]', '--prop', 'bold=true'],
    { allowWrite: false }
  )
  assert.equal(blockedWrite.ok, false)
  assert.equal(blockedWrite.error.code, 'AI_WRITE_APPROVAL_REQUIRED')
  assert.equal(mock.calls.length, 1)

  const allowedWrite = await target.officeSuite.runForAi(
    ['set', '/tmp/report.docx', '/body/p[1]', '--prop', 'bold=true'],
    { allowWrite: true }
  )
  assert.equal(allowedWrite.ok, true)
  assert.equal(mock.calls.length, 2)

  const invalidOptions = await target.officeSuite.runForAi('help', { allowWrite: true, env: {} })
  assert.equal(invalidOptions.ok, false)
  assert.equal(invalidOptions.error.code, 'INVALID_OPTIONS')
})

test('AI OfficeCLI runs can be cancelled as a group', async () => {
  const signals = []
  const runner = {
    run(_command, options) {
      signals.push(options.signal)
      return new Promise((resolve) => {
        options.signal.addEventListener('abort', () => resolve({
          ok: false,
          error: { code: 'OFFICECLI_ABORTED', message: 'OfficeCLI operation was cancelled.' }
        }), { once: true })
      })
    }
  }
  const target = {}
  attachOfficeSuite(target, runner)

  const first = target.officeSuite.runForAi(['get', '/tmp/first.docx', '/body'], { allowWrite: false })
  const second = target.officeSuite.runForAi(['get', '/tmp/second.docx', '/body'], { allowWrite: false })
  const cancellation = target.officeSuite.cancelAiRuns()
  assert.equal(signals.every((signal) => signal.aborted), true)
  assert.equal((await first).error.code, 'OFFICECLI_ABORTED')
  assert.equal((await second).error.code, 'OFFICECLI_ABORTED')
  assert.deepEqual(await cancellation, { cancelled: 2, settled: true })
  assert.deepEqual(await target.officeSuite.cancelAiRuns(), { cancelled: 0, settled: true })
})

test('a new AI run waits for the cancelled snapshot to settle and is not aborted with it', async () => {
  const calls = []
  let finishFirst
  const runner = {
    run(command, options) {
      calls.push({ command, signal: options.signal })
      if (calls.length === 1) {
        return new Promise((resolve) => { finishFirst = resolve })
      }
      return Promise.resolve({
        ok: true,
        data: { command: command[0], args: command.slice(1), exitCode: 0, stdout: 'second', stderr: '' }
      })
    }
  }
  const target = {}
  attachOfficeSuite(target, runner)

  const first = target.officeSuite.runForAi(['set', '/tmp/first.docx', '/body', '--prop', 'bold=true'], { allowWrite: true })
  const cancellation = target.officeSuite.cancelAiRuns()
  const second = target.officeSuite.runForAi(['get', '/tmp/second.docx', '/body'], { allowWrite: false })
  await Promise.resolve()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].signal.aborted, true)

  finishFirst({ ok: false, error: { code: 'OFFICECLI_ABORTED', message: 'cancelled after close' } })
  assert.equal((await first).error.code, 'OFFICECLI_ABORTED')
  assert.deepEqual(await cancellation, { cancelled: 1, settled: true })
  assert.equal((await second).ok, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].signal.aborted, false)
})

test('a queued AI run cancelled by a later epoch never reaches the runner', async () => {
  const calls = []
  let finishFirst
  const runner = {
    run(command, options) {
      calls.push({ command, signal: options.signal })
      return new Promise((resolve) => { finishFirst = resolve })
    }
  }
  const target = {}
  attachOfficeSuite(target, runner)

  const first = target.officeSuite.runForAi(['set', '/tmp/first.docx', '/body', '--prop', 'bold=true'], { allowWrite: true })
  const firstCancellation = target.officeSuite.cancelAiRuns()
  const queued = target.officeSuite.runForAi(['set', '/tmp/queued.docx', '/body', '--prop', 'italic=true'], { allowWrite: true })
  const secondCancellation = target.officeSuite.cancelAiRuns()
  await Promise.resolve()
  assert.equal(calls.length, 1)

  finishFirst({ ok: false, error: { code: 'OFFICECLI_ABORTED', message: 'cancelled after close' } })
  assert.equal((await first).error.code, 'OFFICECLI_ABORTED')
  assert.deepEqual(await firstCancellation, { cancelled: 1, settled: true })
  assert.deepEqual(await secondCancellation, { cancelled: 1, settled: true })
  assert.equal((await queued).error.code, 'AI_RUN_CANCELLED')
  assert.equal(calls.length, 1)
})

test('a new AI run starts only after the fixed cancellation timeout and reports unsettled', async () => {
  assert.equal(AI_CANCEL_SETTLE_TIMEOUT_MS, 2_500)
  const calls = []
  const runner = {
    run(command, options) {
      calls.push({ command, signal: options.signal, at: Date.now() })
      if (calls.length === 1) return new Promise(() => {})
      return Promise.resolve({
        ok: true,
        data: { command: command[0], args: command.slice(1), exitCode: 0, stdout: 'after-timeout', stderr: '' }
      })
    }
  }
  const target = {}
  attachOfficeSuite(target, runner)

  void target.officeSuite.runForAi(['set', '/tmp/hung.docx', '/body', '--prop', 'bold=true'], { allowWrite: true })
  const startedAt = Date.now()
  const cancellation = target.officeSuite.cancelAiRuns()
  const second = target.officeSuite.runForAi(['get', '/tmp/second.docx', '/body'], { allowWrite: false })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(calls.length, 1)

  assert.deepEqual(await cancellation, { cancelled: 1, settled: false })
  assert.equal((await second).ok, true)
  assert.equal(calls.length, 2)
  assert.ok(calls[1].at - startedAt >= AI_CANCEL_SETTLE_TIMEOUT_MS - 100)
})

test('renderer bridge rejects hidden runner options before invocation', async () => {
  const mock = runnerMock()
  const target = {}
  attachOfficeSuite(target, mock.runner)

  const blocked = await target.officeSuite.run('help', {
    env: { PATH: '/tmp/untrusted' },
    pathEnv: '/tmp/untrusted'
  })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error.code, 'OPTION_BLOCKED')
  assert.equal(mock.calls.length, 0)

  const binaryOverride = await target.officeSuite.getStatus({ binaryPath: '/tmp/not-officecli' })
  assert.equal(binaryOverride.ok, false)
  assert.equal(binaryOverride.error.code, 'OPTION_BLOCKED')
  assert.equal(mock.calls.length, 0)

  const allowed = await target.officeSuite.run('help', {
    timeoutMs: 5_000
  })
  assert.equal(allowed.ok, true)
  assert.deepEqual(mock.calls[0].args, [
    'help',
    { timeoutMs: 5_000 }
  ])
})

test('renderer bridge embeds standalone OfficeCLI image paths as safe previews', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-suite-preview-'))
  const imagePath = path.join(directory, 'page 1.png')
  const textPath = path.join(directory, 'not-an-image.png')
  await fs.writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64'))
  await fs.writeFile(textPath, 'not really an image')
  t.after(() => fs.rm(directory, { recursive: true, force: true }))

  const mock = runnerMock()
  mock.runner.run = async () => ({
    ok: true,
    data: {
      exitCode: 0,
      stdout: `${imagePath}\n${imagePath}\n${textPath}\ncreated at ${imagePath}\n`,
      stderr: ''
    }
  })
  const target = {}
  attachOfficeSuite(target, mock.runner)

  const result = await target.officeSuite.run(['view', '/tmp/report.docx', 'screenshot'])
  assert.equal(result.ok, true)
  assert.equal(result.data.previewImages.length, 1)
  assert.equal(result.data.previewImages[0].path, await fs.realpath(imagePath))
  assert.equal(result.data.previewImages[0].mimeType, 'image/png')
  assert.match(result.data.previewImages[0].dataUrl, /^data:image\/png;base64,/u)
})

test('native office_document tool registers once and reuses the same runner', async () => {
  const mock = runnerMock()
  const registrations = []
  const target = {
    ztools: {
      registerTool(name, handler) {
        registrations.push({ name, handler })
      }
    }
  }

  attachOfficeSuite(target, mock.runner)
  attachOfficeSuite(target, mock.runner)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].name, 'office_document')

  const result = await registrations[0].handler({ command: ['get', '/tmp/report.docx', '/body'] })
  assert.equal(result.ok, true)
  assert.equal(result.name, 'run')
  assert.equal('data' in result, false)
  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].name, 'run')
  assert.deepEqual(mock.calls[0].args, [
    ['get', '/tmp/report.docx', '/body'],
    {
      timeoutMs: MCP_TOOL_TIMEOUT_MS,
      env: { OFFICECLI_NO_AUTO_RESIDENT: '1' }
    }
  ])

  const replacement = runnerMock()
  attachOfficeSuite(target, replacement.runner)
  await registrations[0].handler({ command: ['get', '/tmp/replacement.docx', '/body'] })
  assert.equal(replacement.calls.length, 1)
  assert.equal(mock.calls.length, 1)
})

test('native office_document tool accepts only command and resolves errors', async () => {
  const mock = runnerMock()
  let handler
  const target = {
    ztools: {
      registerTool(_name, registeredHandler) {
        handler = registeredHandler
      }
    }
  }
  attachOfficeSuite(target, mock.runner)

  await assert.rejects(
    handler({ command: 'get /tmp/report.docx /body', binaryPath: '/tmp/officecli' }),
    (error) => error.code === 'INVALID_TOOL_INPUT'
  )
  assert.equal(mock.calls.length, 0)

  await assert.rejects(handler({}), (error) => error.code === 'INVALID_TOOL_INPUT')
})

test('native office_document management commands remain rejected by the shared runner contract', async () => {
  const mock = runnerMock()
  mock.runner.run = async (command) => {
    const { parseCommand } = require('../../preload/command-parser.cjs')
    try {
      parseCommand(command)
      return { ok: true, data: {} }
    } catch (error) {
      return { ok: false, error: { code: error.code, message: error.message } }
    }
  }
  let handler
  const target = { ztools: { registerTool: (_name, value) => { handler = value } } }
  attachOfficeSuite(target, mock.runner)

  await assert.rejects(handler({ command: 'officecli mcp claude' }), (error) => error.code === 'COMMAND_BLOCKED')
})

test('native office_document enforces external-only path and high-risk command policy', async () => {
  const mock = runnerMock()
  let handler
  const target = { ztools: { registerTool: (_name, value) => { handler = value } } }
  attachOfficeSuite(target, mock.runner)

  for (const command of [
    ['raw-set', '/tmp/report.docx', 'document'],
    ['add-part', '/tmp/report.docx', '/body'],
    ['import', '/tmp/report.xlsx', '/Sheet1', '/etc/passwd'],
    ['merge', '/tmp/template.docx', '/tmp/output.docx', '--data', '/etc/secrets.json'],
    ['open', '/tmp/report.docx']
  ]) {
    await assert.rejects(handler({ command }), (error) => error.code === 'MCP_COMMAND_BLOCKED')
  }
  await assert.rejects(
    handler({ command: ['get', 'relative.docx', '/body'] }),
    (error) => error.code === 'MCP_ABSOLUTE_PATH_REQUIRED'
  )
  await assert.rejects(
    handler({ command: ['batch', '/tmp/report.docx', '--input', '/tmp/commands.json'] }),
    (error) => error.code === 'MCP_BATCH_INPUT_BLOCKED'
  )
  await assert.rejects(
    handler({ command: ['batch', '/tmp/report.docx', '--commands', '[{"command":"raw-set","path":"document"}]'] }),
    (error) => error.code === 'MCP_COMMAND_BLOCKED'
  )
  for (const command of [
    ['add', '/tmp/report.pptx', '/slide[1]', '--type', 'ole', '--prop', 'src=/etc/hosts'],
    ['set', '/tmp/report.pptx', '/slide[1]/picture[1]', '--prop=path:https://internal.example/image.png'],
    ['add', '/tmp/report.pptx', '/slide[1]', '--type', 'media', '--prop:poster=/tmp/poster.png'],
    ['set', '/tmp/report.pptx', '/slide[1]', '--prop', 'background=image:/etc/hosts'],
    ['set', '/tmp/report.pptx', '/slide[1]/shape[1]', '--prop', 'fill=url(http://127.0.0.1/private)']
  ]) {
    await assert.rejects(
      handler({ command }),
      (error) => error.code === 'MCP_EXTERNAL_RESOURCE_BLOCKED'
    )
  }
  for (const operations of [
    [{ command: 'add', parent: '/slide[1]', type: 'ole', props: { src: '/etc/hosts' } }],
    [{ command: 'set', path: '/slide[1]', properties: { background: 'image:/etc/hosts' } }],
    [{ command: 'add', parent: '/slide[1]', type: 'picture', Props: { image: '/tmp/private.png' } }],
    [{ command: 'add', parent: '/slide[1]', props: { text: 'Safe' }, Props: { src: '/etc/hosts' } }]
  ]) {
    await assert.rejects(
      handler({ command: ['batch', '/tmp/report.pptx', '--commands', JSON.stringify(operations)] }),
      (error) => error.code === 'MCP_EXTERNAL_RESOURCE_BLOCKED'
    )
  }
  await assert.rejects(
    handler({ command: ['batch', '/tmp/report.pptx'] }),
    (error) => error.code === 'MCP_BATCH_INPUT_BLOCKED'
  )
  await assert.rejects(
    handler({
      command: [
        'batch',
        '/tmp/report.pptx',
        '--commands',
        '[{"command":"add","Command":"raw-set","parent":"/slide[1]"}]'
      ]
    }),
    (error) => error.code === 'MCP_BATCH_UNSAFE'
  )
  for (const command of [
    ['dump', '/tmp/report.docx', '--out', '/tmp/overwrite.txt'],
    ['view', '/tmp/report.docx', 'html', '-o=/tmp/overwrite.html'],
    ['get', '/tmp/report.docx', '/body', '--save', '/tmp/payload.bin'],
    ['view', '/tmp/report.docx', 'html', '--browser']
  ]) {
    await assert.rejects(handler({ command }), (error) => error.code === 'MCP_OUTPUT_PATH_BLOCKED')
  }
  await assert.rejects(
    handler({ command: ['batch', '/tmp/report.docx', '--commands', '[{"command":"view","path":"/","out":"/tmp/x"}]'] }),
    (error) => error.code === 'MCP_OUTPUT_PATH_BLOCKED'
  )
  assert.equal(mock.calls.length, 0)

  const safe = await handler({
    command: [
      'batch',
      '/tmp/report.pptx',
      '--commands',
      '[{"command":"add","parent":"/slide[1]","type":"shape","props":{"text":"Safe"}}]'
    ]
  })
  assert.equal(safe.ok, true)
  assert.equal(mock.calls.length, 1)
})

test('native office_document throws runner failures as MCP errors', async () => {
  const mock = runnerMock()
  mock.runner.run = async () => ({
    ok: false,
    error: { code: 'OFFICECLI_EXIT', message: 'document failed', details: { exitCode: 2 } }
  })
  let handler
  const target = { ztools: { registerTool: (_name, value) => { handler = value } } }
  attachOfficeSuite(target, mock.runner)

  await assert.rejects(
    handler({ command: ['validate', '/tmp/report.docx'] }),
    (error) => error.code === 'OFFICECLI_EXIT' && error.details.exitCode === 2
  )
})
