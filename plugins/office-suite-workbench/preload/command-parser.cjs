'use strict'

/**
 * Parse the small, auditable subset of OfficeCLI that the ZTools UI may run.
 *
 * This module deliberately does not try to emulate a shell. Quoting is only a
 * convenience for turning a command string into argv; the resulting arguments
 * are passed directly to child_process.spawn with shell:false by the runner.
 */

const MAX_COMMAND_LENGTH = 64 * 1024
const MAX_ARGUMENTS = 512
const MAX_ARGUMENT_LENGTH = 16 * 1024

const DOCUMENT_COMMANDS = Object.freeze([
  'add',
  'add-part',
  'batch',
  'close',
  'create',
  'dump',
  'get',
  'help',
  'import',
  'load_skill',
  'merge',
  'move',
  'open',
  'query',
  'raw',
  'raw-set',
  'refresh',
  'remove',
  'save',
  'set',
  'swap',
  'validate',
  'view'
])
const DOCUMENT_COMMAND_SET = new Set(DOCUMENT_COMMANDS)

// These commands change OfficeCLI itself, install integrations, start a
// protocol server, or expose internal process plumbing. They are available only
// through purpose-built runner methods (MCP registration/probing) when needed.
const BLOCKED_MANAGEMENT_COMMANDS = Object.freeze([
  '__resident-serve__',
  'config',
  'install',
  'load-skill',
  'mcp',
  'plugin',
  'plugins',
  'serve',
  'skill',
  'skills',
  'uninstall',
  'update',
  'upgrade',
  'watch',
  'unwatch'
])
const BLOCKED_MANAGEMENT_COMMAND_SET = new Set(BLOCKED_MANAGEMENT_COMMANDS)

const MIN_ARGUMENTS = Object.freeze({
  add: 2,
  'add-part': 2,
  batch: 1,
  close: 1,
  create: 1,
  dump: 1,
  get: 1,
  help: 0,
  import: 2,
  load_skill: 1,
  merge: 2,
  move: 2,
  open: 1,
  query: 2,
  raw: 1,
  'raw-set': 2,
  refresh: 1,
  remove: 2,
  save: 1,
  set: 2,
  swap: 3,
  validate: 1,
  view: 2
})

class CommandValidationError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'CommandValidationError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

function tokenizeCommand(command) {
  if (typeof command !== 'string') {
    throw new CommandValidationError('INVALID_COMMAND_TYPE', 'Command must be a string or an argv array.')
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new CommandValidationError('COMMAND_TOO_LONG', `Command exceeds ${MAX_COMMAND_LENGTH} characters.`)
  }
  if (command.includes('\0')) {
    throw new CommandValidationError('INVALID_CHARACTER', 'Command must not contain NUL characters.')
  }

  const tokens = []
  let value = ''
  let quote = null
  let tokenStarted = false

  const pushToken = () => {
    if (!tokenStarted) return
    tokens.push(value)
    value = ''
    tokenStarted = false
    if (tokens.length > MAX_ARGUMENTS) {
      throw new CommandValidationError('TOO_MANY_ARGUMENTS', `Command exceeds ${MAX_ARGUMENTS} arguments.`)
    }
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (quote === "'") {
      if (character === "'") {
        quote = null
      } else {
        value += character
      }
      tokenStarted = true
      continue
    }

    if (quote === '"') {
      if (character === '"') {
        quote = null
      } else if (character === '\\') {
        if (index + 1 >= command.length) {
          throw new CommandValidationError('DANGLING_ESCAPE', 'Command ends with an incomplete escape sequence.')
        }
        const next = command[index + 1]
        // Match normal double-quote semantics without swallowing OfficeCLI's
        // meaningful sequences such as \n and \t in property values.
        if (next === '"') {
          value += next
          index += 1
        } else {
          value += `\\${next}`
          index += 1
        }
      } else {
        value += character
      }
      tokenStarted = true
      continue
    }

    if (/\s/u.test(character)) {
      pushToken()
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      tokenStarted = true
      continue
    }
    if (character === '\\') {
      if (index + 1 >= command.length) {
        throw new CommandValidationError('DANGLING_ESCAPE', 'Command ends with an incomplete escape sequence.')
      }
      const next = command[index + 1]
      if (/\s/u.test(next) || next === "'" || next === '"') {
        value += next
        index += 1
      } else {
        // Preserve ordinary Windows/path backslashes. Only characters that
        // affect tokenization are treated as escaped outside quotes.
        value += '\\'
      }
      tokenStarted = true
      continue
    }

    value += character
    tokenStarted = true
  }

  if (quote !== null) {
    throw new CommandValidationError('UNTERMINATED_QUOTE', `Command contains an unterminated ${quote} quote.`)
  }
  pushToken()
  return tokens
}

function normalizeArgv(input) {
  if (typeof input === 'string') return tokenizeCommand(input)
  if (!Array.isArray(input)) {
    throw new CommandValidationError('INVALID_COMMAND_TYPE', 'Command must be a string or an argv array.')
  }
  if (input.length > MAX_ARGUMENTS) {
    throw new CommandValidationError('TOO_MANY_ARGUMENTS', `Command exceeds ${MAX_ARGUMENTS} arguments.`)
  }

  let totalLength = 0
  return input.map((argument, index) => {
    if (typeof argument !== 'string') {
      throw new CommandValidationError(
        'INVALID_ARGUMENT_TYPE',
        `Argument ${index + 1} must be a string.`,
        { index }
      )
    }
    if (argument.includes('\0')) {
      throw new CommandValidationError('INVALID_CHARACTER', `Argument ${index + 1} contains a NUL character.`)
    }
    totalLength += argument.length
    if (totalLength > MAX_COMMAND_LENGTH) {
      throw new CommandValidationError('COMMAND_TOO_LONG', `Command exceeds ${MAX_COMMAND_LENGTH} characters.`)
    }
    return argument
  })
}

function isOfficeCliPrefix(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const basename = value.replaceAll('\\', '/').split('/').pop().toLowerCase()
  return basename === 'officecli' || basename === 'officecli.exe'
}

function validateToken(token, index) {
  if (token.length === 0) {
    throw new CommandValidationError('EMPTY_ARGUMENT', `Argument ${index + 1} must not be empty.`, { index })
  }
  if (token.length > MAX_ARGUMENT_LENGTH) {
    throw new CommandValidationError(
      'ARGUMENT_TOO_LONG',
      `Argument ${index + 1} exceeds ${MAX_ARGUMENT_LENGTH} characters.`,
      { index }
    )
  }
}

function parseCommand(input) {
  const argv = normalizeArgv(input)
  if (argv.length > 0 && isOfficeCliPrefix(argv[0])) argv.shift()
  if (argv.length === 0) {
    throw new CommandValidationError('EMPTY_COMMAND', 'An OfficeCLI document command is required.')
  }

  argv.forEach(validateToken)
  const command = argv[0].toLowerCase()

  if (BLOCKED_MANAGEMENT_COMMAND_SET.has(command)) {
    throw new CommandValidationError(
      'COMMAND_BLOCKED',
      `OfficeCLI management command "${command}" is not available through the document runner.`,
      { command }
    )
  }
  if (!DOCUMENT_COMMAND_SET.has(command)) {
    throw new CommandValidationError(
      'COMMAND_NOT_ALLOWED',
      `OfficeCLI command "${command}" is not in the document-operation allowlist.`,
      { command }
    )
  }

  const args = argv.slice(1)
  const requiredCount = MIN_ARGUMENTS[command] ?? 0
  if (args.length < requiredCount) {
    throw new CommandValidationError(
      'MISSING_ARGUMENTS',
      `OfficeCLI command "${command}" requires at least ${requiredCount} argument${requiredCount === 1 ? '' : 's'}.`,
      { command, minimum: requiredCount, received: args.length }
    )
  }
  if (requiredCount > 0 && command !== 'load_skill' && args[0].startsWith('-')) {
    throw new CommandValidationError(
      'MISSING_DOCUMENT_PATH',
      `OfficeCLI command "${command}" requires a document path before options.`,
      { command }
    )
  }

  return Object.freeze({
    command,
    args: Object.freeze(args.slice()),
    argv: Object.freeze([command, ...args])
  })
}

module.exports = {
  BLOCKED_MANAGEMENT_COMMANDS,
  CommandValidationError,
  DOCUMENT_COMMANDS,
  MAX_ARGUMENTS,
  MAX_ARGUMENT_LENGTH,
  MAX_COMMAND_LENGTH,
  isOfficeCliPrefix,
  parseCommand,
  tokenizeCommand
}
