'use strict'

const {
  isAllowedSystemInformationMethod,
  projectSystemInformationResult
} = require('./systeminformation-protocol.cjs')

function probeError(code) {
  const error = new Error(code === 'METHOD_NOT_ALLOWED'
    ? 'System information method is not allowed'
    : 'System information source is unavailable')
  error.code = code
  return error
}

async function executeProbe(methodName, loadSystemInformation = () => require('systeminformation')) {
  if (!isAllowedSystemInformationMethod(methodName)) {
    throw probeError('METHOD_NOT_ALLOWED')
  }

  const systeminformation = loadSystemInformation()
  if (!systeminformation || typeof systeminformation[methodName] !== 'function') {
    throw probeError('SOURCE_UNAVAILABLE')
  }

  // Several systeminformation methods run synchronous platform probes before
  // returning a promise. The invocation itself must stay inside this process.
  const value = await Promise.resolve().then(() => systeminformation[methodName]())
  return projectSystemInformationResult(methodName, value)
}

function errorCode(error) {
  if (error && error.code === 'METHOD_NOT_ALLOWED') return 'METHOD_NOT_ALLOWED'
  if (error && error.code === 'SOURCE_UNAVAILABLE') return 'SOURCE_UNAVAILABLE'
  return 'COLLECTOR_FAILED'
}

async function main(options = {}) {
  const argv = Array.isArray(options.argv) ? options.argv : process.argv
  const output = options.stdout && typeof options.stdout.write === 'function'
    ? options.stdout
    : process.stdout
  const loadSystemInformation = typeof options.loadSystemInformation === 'function'
    ? options.loadSystemInformation
    : () => require('systeminformation')

  let envelope
  try {
    const value = await executeProbe(argv[2], loadSystemInformation)
    envelope = { ok: true, value }
  } catch (error) {
    // Messages, stacks, command output, and local paths never cross the helper
    // boundary. stderr is deliberately unused.
    envelope = { ok: false, code: errorCode(error) }
  }

  output.write(JSON.stringify(envelope))
  return envelope
}

if (require.main === module) {
  void main().catch(() => {
    // Avoid Node's unhandled-rejection diagnostics on stderr. A write failure
    // already makes the client reject the missing/invalid envelope.
    process.exitCode = 1
  })
}

module.exports = {
  executeProbe,
  main
}
