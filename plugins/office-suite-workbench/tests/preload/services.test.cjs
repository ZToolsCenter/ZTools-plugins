'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  AI_TOOL_TIMEOUT_MS,
  MCP_TOOL_TIMEOUT_MS,
  attachOfficeSuite
} = require('../../preload/services.cjs')

function runnerMock() {
  const calls = []
  const method = (name) => async (...args) => {
    calls.push({ name, args })
    return { ok: true, data: { name, args } }
  }
  return {
    calls,
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
  attachOfficeSuite(target, mock.runner)
  assert.deepEqual(Object.keys(target.officeSuite).sort(), [
    'getMcpConfigs',
    'getMcpStatus',
    'getStatus',
    'probeMcp',
    'registerMcp',
    'run',
    'runForAi',
    'unregisterMcp'
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
  assert.deepEqual(mock.calls[0], {
    name: 'run',
    args: [
      ['get', '/tmp/report.docx', '/body'],
      {
        timeoutMs: AI_TOOL_TIMEOUT_MS,
        env: { OFFICECLI_NO_AUTO_RESIDENT: '1' }
      }
    ]
  })

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
