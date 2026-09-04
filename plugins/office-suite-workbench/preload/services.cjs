'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { parseCommand } = require('./command-parser.cjs')
const { createOfficeCliInstaller } = require('./officecli-installer.cjs')
const {
  OfficeCliRunnerError,
  createOfficeCliRunner,
  failure
} = require('./officecli-runner.cjs')

const OFFICE_DOCUMENT_TOOL = 'office_document'
const MCP_TOOL_TIMEOUT_MS = 120_000
const registeredToolHosts = new WeakMap()
const EXTERNAL_MCP_BLOCKED_COMMANDS = new Set(['add-part', 'import', 'merge', 'open', 'raw-set'])
const EXTERNAL_MCP_NON_FILE_COMMANDS = new Set(['help', 'load_skill'])
const STATUS_OPTION_FIELDS = new Set()
const RUN_OPTION_FIELDS = new Set(['timeoutMs'])
const MAX_PREVIEW_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_PREVIEW_TOTAL_BYTES = 24 * 1024 * 1024
const MAX_PREVIEW_IMAGES = 8
const AI_TOOL_TIMEOUT_MS = 120_000
const AI_CANCEL_SETTLE_TIMEOUT_MS = 2_500
const MINIMUM_ZTOOLS_VERSION = Object.freeze([2, 4, 0])
const AI_WRITE_COMMANDS = new Set([
  'add',
  'batch',
  'close',
  'create',
  'move',
  'refresh',
  'remove',
  'save',
  'set',
  'swap'
])
const EXTERNAL_MCP_BLOCKED_OPTIONS = new Set(['-o', '--out', '--output', '--save', '--browser'])
const EXTERNAL_MCP_BLOCKED_PROPERTY_KEYS = new Set([
  'fallback',
  'image',
  'path',
  'poster',
  'preview',
  'src'
])
const EXTERNAL_MCP_IMAGE_VALUE_KEYS = new Set(['background', 'fill'])

function getHostCompatibility(api) {
  if (api === undefined) {
    return { mode: 'browser-preview', requiresUpgrade: false, reason: 'browser-preview' }
  }
  let value
  try {
    if (typeof api?.getAppVersion !== 'function') {
      return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-unavailable' }
    }
    value = api.getAppVersion()
  } catch {
    return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-unavailable' }
  }
  const version = typeof value === 'string' ? value.trim() : ''
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?([+-][0-9A-Za-z.-]+)?$/u.exec(version)
  if (!match) return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-invalid' }
  const parts = [match[1], match[2], match[3] || '0'].map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    return { mode: 'upgrade-required', requiresUpgrade: true, reason: 'version-invalid' }
  }
  let belowMinimum = false
  for (let index = 0; index < MINIMUM_ZTOOLS_VERSION.length; index += 1) {
    if (parts[index] === MINIMUM_ZTOOLS_VERSION[index]) continue
    belowMinimum = parts[index] < MINIMUM_ZTOOLS_VERSION[index]
    break
  }
  if (!belowMinimum && parts.every((part, index) => part === MINIMUM_ZTOOLS_VERSION[index])) {
    belowMinimum = Boolean(match[4]?.startsWith('-'))
  }
  if (belowMinimum) {
    return { mode: 'upgrade-required', version, requiresUpgrade: true, reason: 'below-minimum' }
  }
  return { mode: 'supported', version, requiresUpgrade: false, reason: 'supported' }
}

async function safeInvoke(runner, method, args) {
  try {
    const handler = runner?.[method]
    if (typeof handler !== 'function') {
      throw new OfficeCliRunnerError('BRIDGE_UNAVAILABLE', `Office suite runner method ${method} is unavailable.`)
    }
    const result = await handler.apply(runner, args)
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new OfficeCliRunnerError('INVALID_RUNNER_RESPONSE', `Office suite runner method ${method} returned an invalid response.`)
    }
    return result
  } catch (error) {
    return failure(error, 'OFFICE_SUITE_BRIDGE_ERROR')
  }
}

async function safeInstallerInvoke(installer, method = 'install', args = []) {
  try {
    if (!installer || typeof installer[method] !== 'function') {
      throw new OfficeCliRunnerError('INSTALLER_UNAVAILABLE', 'OfficeCLI installer is unavailable.')
    }
    return { ok: true, data: await installer[method](...args) }
  } catch (error) {
    return failure(error, 'OFFICECLI_INSTALL_FAILED')
  }
}

async function checkOfficeCliUpdate(runner, installer) {
  const status = await safeInvoke(runner, 'getStatus', [undefined])
  if (!status.ok) return status
  if (!status.data.installed || !status.data.version) {
    return {
      ok: true,
      data: {
        installed: false,
        updateAvailable: false,
        currentVersion: status.data.version || null,
        latestVersion: null,
        checkedAt: new Date().toISOString()
      }
    }
  }
  return safeInstallerInvoke(installer, 'check', [status.data.version])
}

async function updateOfficeCli(runner, installer) {
  const status = await safeInvoke(runner, 'getStatus', [undefined])
  if (!status.ok) return status
  if (!status.data.installed || !status.data.binaryPath) {
    return failure(new OfficeCliRunnerError('OFFICECLI_NOT_FOUND', 'OfficeCLI must be installed before it can be updated.'))
  }
  return safeInstallerInvoke(installer, 'update', [status.data.binaryPath])
}

function sanitizeUiOptions(options, allowedFields) {
  if (options == null) return undefined
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new OfficeCliRunnerError('INVALID_OPTIONS', 'Bridge options must be an object.')
  }
  const output = {}
  for (const [key, value] of Object.entries(options)) {
    if (!allowedFields.has(key)) {
      throw new OfficeCliRunnerError(
        'OPTION_BLOCKED',
        `Bridge option "${key}" is not exposed to the renderer.`,
        { option: key }
      )
    }
    output[key] = value
  }
  return output
}

function safeUiInvoke(runner, method, args, options, allowedFields) {
  try {
    return safeInvoke(runner, method, [...args, sanitizeUiOptions(options, allowedFields)])
  } catch (error) {
    return Promise.resolve(failure(error, 'OFFICE_SUITE_BRIDGE_ERROR'))
  }
}

function previewMimeType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return 'image/jpeg'
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function previewPathCandidates(stdout) {
  const candidates = []
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    const candidate = line.trim().replace(/^(['"])(.*)\1$/u, '$2')
    if (!candidate || !path.isAbsolute(candidate)) continue
    candidates.push(candidate)
  }
  return candidates
}

function collectPreviewImages(output) {
  if (!output || typeof output !== 'object') return []
  const previews = []
  const seen = new Set()
  let totalBytes = 0

  for (const candidate of previewPathCandidates(output.stdout)) {
    if (previews.length >= MAX_PREVIEW_IMAGES) break
    try {
      const sourceStat = fs.lstatSync(candidate)
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) continue
      if (sourceStat.size <= 0 || sourceStat.size > MAX_PREVIEW_IMAGE_BYTES) continue
      if (totalBytes + sourceStat.size > MAX_PREVIEW_TOTAL_BYTES) continue

      const resolvedPath = fs.realpathSync(candidate)
      if (seen.has(resolvedPath)) continue
      const buffer = fs.readFileSync(resolvedPath)
      const mimeType = previewMimeType(buffer)
      if (!mimeType) continue

      seen.add(resolvedPath)
      totalBytes += buffer.length
      previews.push({
        path: resolvedPath,
        mimeType,
        size: buffer.length,
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
      })
    } catch {
      // Command output remains available even when a transient preview file disappears.
    }
  }
  return previews
}

function withPreviewImages(result) {
  if (!result?.ok || !result.data || typeof result.data !== 'object') return result
  const previewImages = collectPreviewImages(result.data)
  if (!previewImages.length) return result
  return {
    ...result,
    data: {
      ...result.data,
      previewImages
    }
  }
}

async function safeUiRun(runner, command, options) {
  let sanitizedOptions
  try {
    sanitizedOptions = sanitizeUiOptions(options, RUN_OPTION_FIELDS)
  } catch (error) {
    return failure(error, 'OFFICE_SUITE_BRIDGE_ERROR')
  }

  const result = await safeInvoke(runner, 'run', [command, sanitizedOptions])
  return withPreviewImages(result)
}

async function safeAiRun(runner, command, options, signal) {
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new OfficeCliRunnerError('INVALID_OPTIONS', 'AI tool options must be an object.')
    }
    const optionKeys = Object.keys(options)
    if (optionKeys.some((key) => key !== 'allowWrite') || typeof options.allowWrite !== 'boolean') {
      throw new OfficeCliRunnerError(
        'INVALID_OPTIONS',
        'AI tool options accept only the boolean allowWrite field.'
      )
    }
    const parsed = validateExternalToolCommand(command)
    if (AI_WRITE_COMMANDS.has(parsed.command) && !options.allowWrite) {
      throw new OfficeCliRunnerError(
        'AI_WRITE_APPROVAL_REQUIRED',
        `OfficeCLI command "${parsed.command}" requires the user to enable file modifications for this AI turn.`,
        { command: parsed.command }
      )
    }
    const result = await safeInvoke(runner, 'run', [parsed.argv, {
      timeoutMs: AI_TOOL_TIMEOUT_MS,
      env: { OFFICECLI_NO_AUTO_RESIDENT: '1' },
      signal
    }])
    return withPreviewImages(result)
  } catch (error) {
    return failure(error, 'OFFICE_SUITE_AI_TOOL_ERROR')
  }
}

function createOfficeSuiteServices(runner = createOfficeCliRunner(), installer = createOfficeCliInstaller()) {
  const aiRuns = new Set()
  let aiCancelBarrier = Promise.resolve({ cancelled: 0, settled: true })
  let aiCancelBarrierPending = false
  let aiCancelEpoch = 0

  function waitForRunSnapshot(snapshot) {
    if (!snapshot.length) return Promise.resolve({ cancelled: 0, settled: true })
    return new Promise((resolve) => {
      let finished = false
      const finish = (settled) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        resolve({ cancelled: snapshot.length, settled })
      }
      const timer = setTimeout(() => finish(false), AI_CANCEL_SETTLE_TIMEOUT_MS)
      void Promise.allSettled(snapshot.map((run) => run.pending)).then(() => finish(true))
    })
  }

  return Object.freeze({
    getStatus(options) {
      return safeUiInvoke(runner, 'getStatus', [], options, STATUS_OPTION_FIELDS)
    },
    installOfficeCli() {
      return safeInstallerInvoke(installer)
    },
    checkOfficeCliUpdate() {
      return checkOfficeCliUpdate(runner, installer)
    },
    updateOfficeCli() {
      return updateOfficeCli(runner, installer)
    },
    run(command, options) {
      return safeUiRun(runner, command, options)
    },
    async runForAi(command, options) {
      const runEpoch = aiCancelEpoch
      while (aiCancelBarrierPending) {
        const barrier = aiCancelBarrier
        await barrier
        if (barrier === aiCancelBarrier) break
      }
      if (runEpoch !== aiCancelEpoch) {
        return failure(new OfficeCliRunnerError(
          'AI_RUN_CANCELLED',
          'The queued AI OfficeCLI run was cancelled before it started.'
        ), 'OFFICE_SUITE_AI_TOOL_ERROR')
      }
      const controller = new AbortController()
      const run = {
        controller,
        pending: safeAiRun(runner, command, options, controller.signal)
      }
      aiRuns.add(run)
      try {
        return await run.pending
      } finally {
        aiRuns.delete(run)
      }
    },
    cancelAiRuns() {
      aiCancelEpoch += 1
      const snapshot = Array.from(aiRuns)
      for (const run of snapshot) run.controller.abort()
      const previousBarrier = aiCancelBarrier
      const snapshotBarrier = waitForRunSnapshot(snapshot)
      const barrier = Promise.all([previousBarrier, snapshotBarrier]).then(([, current]) => current)
      aiCancelBarrierPending = true
      aiCancelBarrier = barrier
      void barrier.then(() => {
        if (aiCancelBarrier === barrier) aiCancelBarrierPending = false
      })
      return barrier
    },
    getMcpStatus(options) {
      return safeUiInvoke(runner, 'getMcpStatus', [], options, STATUS_OPTION_FIELDS)
    },
    registerMcp(target, options) {
      return safeUiInvoke(runner, 'registerMcp', [target], options, STATUS_OPTION_FIELDS)
    },
    unregisterMcp(target, options) {
      return safeUiInvoke(runner, 'unregisterMcp', [target], options, STATUS_OPTION_FIELDS)
    },
    probeMcp(options) {
      return safeUiInvoke(runner, 'probeMcp', [], options, STATUS_OPTION_FIELDS)
    },
    getMcpConfigs(options) {
      return safeUiInvoke(runner, 'getMcpConfigs', [], options, STATUS_OPTION_FIELDS)
    }
  })
}

function validateToolInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new OfficeCliRunnerError('INVALID_TOOL_INPUT', 'office_document input must be an object containing command.')
  }
  const keys = Object.keys(input)
  if (keys.length !== 1 || keys[0] !== 'command') {
    throw new OfficeCliRunnerError(
      'INVALID_TOOL_INPUT',
      'office_document accepts only the command field.',
      { allowedFields: ['command'] }
    )
  }
  if (typeof input.command !== 'string' && !Array.isArray(input.command)) {
    throw new OfficeCliRunnerError('INVALID_TOOL_INPUT', 'office_document command must be a string or argv array.')
  }
  return input.command
}

function batchCommandsValue(args, index) {
  const argument = args[index]
  const lower = argument.toLowerCase()
  if (lower === '--commands') {
    if (index + 1 >= args.length) {
      throw new OfficeCliRunnerError('MCP_BATCH_UNSAFE', 'batch --commands requires inline JSON.')
    }
    return args[index + 1]
  }
  if (lower.startsWith('--commands=') || lower.startsWith('--commands:')) {
    return argument.slice('--commands='.length)
  }
  return null
}

function batchOperationName(item) {
  if (!item || typeof item !== 'object') return null
  const commandEntries = Object.entries(item).filter(([key]) => ['command', 'op'].includes(key.toLowerCase()))
  if (commandEntries.length !== 1) return null
  const value = commandEntries[0][1]
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]*$/iu.test(value.trim())) return null
  return value.trim().toLowerCase()
}

function validateExternalPropertyValue(keyInput, value) {
  const key = String(keyInput || '').trim().toLowerCase()
  const terminalKey = key.split('.').pop()
  const readsExternalResource = EXTERNAL_MCP_BLOCKED_PROPERTY_KEYS.has(key) ||
    EXTERNAL_MCP_BLOCKED_PROPERTY_KEYS.has(terminalKey)
  const embedsImageValue = EXTERNAL_MCP_IMAGE_VALUE_KEYS.has(key) &&
    typeof value === 'string' && /^(?:image|url)\s*[:(]/iu.test(value.trim())

  if (!readsExternalResource && !embedsImageValue) return
  throw new OfficeCliRunnerError(
    'MCP_EXTERNAL_RESOURCE_BLOCKED',
    `OfficeCLI property "${key || '(empty)'}" may not read a file or URL in external MCP calls.`,
    { property: key }
  )
}

function validateExternalPropertyToken(input) {
  if (typeof input !== 'string') return
  const separatorIndex = input.search(/[=:]/u)
  if (separatorIndex <= 0) return
  validateExternalPropertyValue(input.slice(0, separatorIndex), input.slice(separatorIndex + 1))
}

function validateExternalCommandProperties(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const lower = argument.toLowerCase()
    if (lower === '--prop') {
      if (index + 1 < args.length) validateExternalPropertyToken(args[index + 1])
      index += 1
      continue
    }
    if (lower.startsWith('--prop=') || lower.startsWith('--prop:')) {
      validateExternalPropertyToken(argument.slice('--prop='.length))
    }
  }
}

function validateExternalBatchOperation(operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new OfficeCliRunnerError('MCP_BATCH_UNSAFE', 'External MCP batch commands must contain operation objects.')
  }

  const name = batchOperationName(operation)
  if (!name) {
    throw new OfficeCliRunnerError('MCP_BATCH_UNSAFE', 'Every external MCP batch operation requires a command name.')
  }
  if (EXTERNAL_MCP_BLOCKED_COMMANDS.has(name)) {
    throw new OfficeCliRunnerError(
      'MCP_COMMAND_BLOCKED',
      `OfficeCLI command "${name}" is disabled for external MCP calls.`,
      { command: name }
    )
  }

  const blockedOutputField = Object.keys(operation).find((key) =>
    ['out', 'output', 'outputpath', 'save'].includes(key.toLowerCase())
  )
  if (blockedOutputField) {
    throw new OfficeCliRunnerError(
      'MCP_OUTPUT_PATH_BLOCKED',
      'External MCP batch commands must not write auxiliary output files.',
      { field: blockedOutputField }
    )
  }

  const propsEntries = Object.entries(operation).filter(([key]) =>
    ['props', 'properties'].includes(key.toLowerCase())
  )
  for (const [, props] of propsEntries) {
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
      throw new OfficeCliRunnerError('MCP_BATCH_UNSAFE', 'External MCP batch props must be an object.')
    }
    for (const [key, value] of Object.entries(props)) {
      validateExternalPropertyValue(key, value)
    }
  }

  for (const [key, value] of Object.entries(operation)) {
    const normalized = key.toLowerCase()
    if (normalized === 'path' || ['props', 'properties'].includes(normalized)) continue
    validateExternalPropertyValue(key, value)
  }
}

function validateExternalBatch(args) {
  let hasInlineCommands = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const lower = argument.toLowerCase()
    if (lower === '--input' || lower.startsWith('--input=') || lower.startsWith('--input:')) {
      throw new OfficeCliRunnerError(
        'MCP_BATCH_INPUT_BLOCKED',
        'External MCP calls must use inline batch commands; batch --input is disabled.'
      )
    }

    const commandsValue = batchCommandsValue(args, index)
    if (commandsValue == null) continue
    hasInlineCommands = true
    let operations
    try {
      operations = JSON.parse(commandsValue)
    } catch {
      throw new OfficeCliRunnerError('MCP_BATCH_UNSAFE', 'batch --commands must contain valid inline JSON.')
    }
    if (!Array.isArray(operations)) {
      throw new OfficeCliRunnerError('MCP_BATCH_UNSAFE', 'batch --commands must be a JSON array.')
    }
    operations.forEach(validateExternalBatchOperation)
    if (lower === '--commands') index += 1
  }
  if (!hasInlineCommands) {
    throw new OfficeCliRunnerError(
      'MCP_BATCH_INPUT_BLOCKED',
      'External MCP batch calls must provide inline --commands JSON.'
    )
  }
}

function validateExternalToolCommand(commandInput) {
  const parsed = parseCommand(commandInput)
  if (EXTERNAL_MCP_BLOCKED_COMMANDS.has(parsed.command)) {
    throw new OfficeCliRunnerError(
      'MCP_COMMAND_BLOCKED',
      `OfficeCLI command "${parsed.command}" is disabled for external MCP calls.`,
      { command: parsed.command }
    )
  }
  if (!EXTERNAL_MCP_NON_FILE_COMMANDS.has(parsed.command) && !path.isAbsolute(parsed.args[0])) {
    throw new OfficeCliRunnerError(
      'MCP_ABSOLUTE_PATH_REQUIRED',
      'External MCP document commands require an absolute path as their first argument.',
      { command: parsed.command }
    )
  }
  const blockedOption = parsed.args.find((argument) => {
    const lower = argument.toLowerCase()
    return EXTERNAL_MCP_BLOCKED_OPTIONS.has(lower) || [...EXTERNAL_MCP_BLOCKED_OPTIONS].some(
      (option) => lower.startsWith(`${option}=`) || lower.startsWith(`${option}:`)
    )
  })
  if (blockedOption) {
    throw new OfficeCliRunnerError(
      'MCP_OUTPUT_PATH_BLOCKED',
      `OfficeCLI option "${blockedOption}" is disabled for external MCP calls.`,
      { option: blockedOption }
    )
  }
  validateExternalCommandProperties(parsed.args)
  if (parsed.command === 'batch') validateExternalBatch(parsed.args)
  return parsed
}

function throwToolFailure(result) {
  const error = new Error(result?.error?.message || 'Office document tool failed.')
  error.code = result?.error?.code || 'OFFICE_DOCUMENT_ERROR'
  if (result?.error?.details !== undefined) error.details = result.error.details
  throw error
}

function registerOfficeDocumentTool(target, runner) {
  const ztools = target?.ztools
  if (!ztools || typeof ztools.registerTool !== 'function') return false
  const existing = registeredToolHosts.get(ztools)
  if (existing) {
    existing.runner = runner
    return false
  }

  const registration = { runner }

  const handler = async (input) => {
    const command = validateToolInput(input)
    validateExternalToolCommand(command)
    const result = await safeInvoke(registration.runner, 'run', [
      command,
      {
        timeoutMs: MCP_TOOL_TIMEOUT_MS,
        env: { OFFICECLI_NO_AUTO_RESIDENT: '1' }
      }
    ])
    if (!result.ok) throwToolFailure(result)
    return { ok: true, ...result.data }
  }

  ztools.registerTool.call(ztools, OFFICE_DOCUMENT_TOOL, handler)
  registeredToolHosts.set(ztools, registration)
  return true
}

function attachOfficeSuite(target, runner = createOfficeCliRunner(), installer = createOfficeCliInstaller()) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new OfficeCliRunnerError('INVALID_BRIDGE_TARGET', 'A window-like bridge target is required.')
  }
  const services = createOfficeSuiteServices(runner, installer)
  target.officeSuite = services
  registerOfficeDocumentTool(target, runner)
  return services
}

let defaultServices = null
if (typeof window !== 'undefined') {
  const compatibility = getHostCompatibility(window.ztools)
  if (compatibility.requiresUpgrade) {
    // Do not create a runner or register the native tool before the renderer's
    // upgrade-only view is shown.
    window.officeSuite = Object.freeze({})
  } else {
    defaultServices = attachOfficeSuite(window)
  }
}

module.exports = {
  MCP_TOOL_TIMEOUT_MS,
  AI_TOOL_TIMEOUT_MS,
  AI_CANCEL_SETTLE_TIMEOUT_MS,
  OFFICE_DOCUMENT_TOOL,
  attachOfficeSuite,
  collectPreviewImages,
  createOfficeSuiteServices,
  defaultServices,
  getHostCompatibility,
  registerOfficeDocumentTool,
  sanitizeUiOptions,
  validateExternalToolCommand,
  validateToolInput
}
