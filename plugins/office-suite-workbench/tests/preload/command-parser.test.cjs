'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DOCUMENT_COMMANDS,
  parseCommand,
  tokenizeCommand
} = require('../../preload/command-parser.cjs')

test('tokenizeCommand supports quotes and backslash escaping without a shell', () => {
  assert.deepEqual(
    tokenizeCommand('officecli set "Quarterly Report.docx" \'/body/p[1]\' --prop "text=Hello world" --prop note=A\\ B --prop "text=Line\\nNext"'),
    [
      'officecli',
      'set',
      'Quarterly Report.docx',
      '/body/p[1]',
      '--prop',
      'text=Hello world',
      '--prop',
      'note=A B',
      '--prop',
      'text=Line\\nNext'
    ]
  )
})

test('parseCommand accepts string and argv forms and strips an optional binary prefix', () => {
  const fromString = parseCommand('officecli get "Quarterly Report.docx" \'/body/p[1]\' --json')
  assert.equal(fromString.command, 'get')
  assert.deepEqual(fromString.args, ['Quarterly Report.docx', '/body/p[1]', '--json'])

  const fromArgv = parseCommand(['C:\\Tools\\officecli.exe', 'VIEW', 'deck.pptx', 'outline'])
  assert.equal(fromArgv.command, 'view')
  assert.deepEqual(fromArgv.argv, ['view', 'deck.pptx', 'outline'])

  const windowsPath = parseCommand('get C:\\Users\\Harris\\report.docx /body')
  assert.deepEqual(windowsPath.args, ['C:\\Users\\Harris\\report.docx', '/body'])

  const uncPath = parseCommand('get \\\\server\\share\\report.docx /body')
  assert.deepEqual(uncPath.args, ['\\\\server\\share\\report.docx', '/body'])

  const uncArgv = parseCommand(['get', '\\\\server\\share\\report.docx', '/body'])
  assert.deepEqual(uncArgv.args, ['\\\\server\\share\\report.docx', '/body'])

  assert.deepEqual(parseCommand(['get', '/tmp/report.docx']).args, ['/tmp/report.docx'])
  assert.deepEqual(parseCommand(['raw', '/tmp/report.docx']).args, ['/tmp/report.docx'])
})

test('document operation allowlist covers supported read and write operations', () => {
  for (const command of ['create', 'view', 'get', 'query', 'set', 'add', 'remove', 'batch', 'validate', 'merge', 'load_skill']) {
    assert.equal(DOCUMENT_COMMANDS.includes(command), true)
  }
})

test('management and process-control commands are rejected before execution', () => {
  for (const command of [
    'install',
    'skills',
    'plugins',
    'mcp',
    'config',
    'update',
    'watch',
    '__resident-serve__'
  ]) {
    assert.throws(
      () => parseCommand(`officecli ${command} example`),
      (error) => error.code === 'COMMAND_BLOCKED',
      command
    )
  }
})

test('unknown commands and incomplete document commands are rejected', () => {
  assert.throws(() => parseCommand('bash -c whoami'), (error) => error.code === 'COMMAND_NOT_ALLOWED')
  assert.throws(() => parseCommand('set report.docx'), (error) => error.code === 'MISSING_ARGUMENTS')
  assert.throws(() => parseCommand('create --json'), (error) => error.code === 'MISSING_DOCUMENT_PATH')
  assert.throws(() => parseCommand('officecli'), (error) => error.code === 'EMPTY_COMMAND')
})

test('malformed quoting, escaping, and argv values fail strictly', () => {
  assert.throws(() => tokenizeCommand('get "broken.docx /'), (error) => error.code === 'UNTERMINATED_QUOTE')
  assert.throws(() => tokenizeCommand('get report.docx /\\'), (error) => error.code === 'DANGLING_ESCAPE')
  assert.throws(() => parseCommand(['get', 'report.docx', 1]), (error) => error.code === 'INVALID_ARGUMENT_TYPE')
  assert.throws(() => parseCommand(['get', 'report.docx', '']), (error) => error.code === 'EMPTY_ARGUMENT')
})
