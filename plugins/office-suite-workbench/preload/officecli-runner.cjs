'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn: defaultSpawn } = require('node:child_process')
const { StringDecoder } = require('node:string_decoder')
const { parseCommand } = require('./command-parser.cjs')

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MCP_TIMEOUT_MS = 15_000
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_TIMEOUT_MS = 15 * 60 * 1000
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024
const MCP_TARGETS = Object.freeze(['lms', 'claude', 'cursor', 'vscode'])
const MCP_TARGET_SET = new Set(MCP_TARGETS)

class OfficeCliRunnerError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'OfficeCliRunnerError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

function success(data) {
  return { ok: true, data }
}

function serializableDetails(value) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function failure(error, fallbackCode = 'OFFICECLI_ERROR') {
  const normalized = error instanceof Error ? error : new Error(String(error))
  const result = {
    ok: false,
    error: {
      code: typeof normalized.code === 'string' ? normalized.code : fallbackCode,
      message: String(normalized.message || 'OfficeCLI operation failed.')
    }
  }
  const details = serializableDetails(normalized.details)
  if (details !== undefined) result.error.details = details
  return result
}

function normalizeOptions(options) {
  if (options == null) return {}
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new OfficeCliRunnerError('INVALID_OPTIONS', 'Options must be an object.')
  }
  return options
}

function boundedInteger(value, fallback, maximum, name) {
  if (value == null) return fallback
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new OfficeCliRunnerError(
      'INVALID_OPTIONS',
      `${name} must be a positive integer no greater than ${maximum}.`,
      { name, maximum }
    )
  }
  return number
}

function normalizeEnvironment(input) {
  if (input == null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new OfficeCliRunnerError('INVALID_ENVIRONMENT', 'env must be an object of environment variables.')
  }

  const output = Object.create(null)
  for (const [key, rawValue] of Object.entries(input)) {
    if (!key || key.includes('=') || key.includes('\0')) {
      throw new OfficeCliRunnerError('INVALID_ENVIRONMENT', `Invalid environment variable name: ${key || '(empty)'}.`)
    }
    if (!['string', 'number', 'boolean'].includes(typeof rawValue)) {
      throw new OfficeCliRunnerError('INVALID_ENVIRONMENT', `Environment variable ${key} must be a string, number, or boolean.`)
    }
    const value = String(rawValue)
    if (value.includes('\0')) {
      throw new OfficeCliRunnerError('INVALID_ENVIRONMENT', `Environment variable ${key} contains a NUL character.`)
    }
    output[key] = value
  }
  return output
}

function normalizeDirectoryList(input, name) {
  if (input == null) return []
  if (!Array.isArray(input)) {
    throw new OfficeCliRunnerError('INVALID_OPTIONS', `${name} must be an array of directories.`)
  }
  return input.map((directory, index) => {
    if (typeof directory !== 'string' || directory.length === 0 || directory.includes('\0')) {
      throw new OfficeCliRunnerError('INVALID_OPTIONS', `${name}[${index}] must be a non-empty path string.`)
    }
    return path.resolve(directory)
  })
}

function defaultCommonDirectories(platform, homeDir, environment) {
  if (platform === 'win32') {
    return [
      path.join(homeDir, '.local', 'bin'),
      path.join(homeDir, 'scoop', 'shims'),
      environment.APPDATA && path.join(environment.APPDATA, 'npm'),
      environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'OfficeCLI'),
      environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')
    ].filter(Boolean)
  }

  return [
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, 'bin'),
    path.join(homeDir, '.npm-global', 'bin'),
    path.join(homeDir, '.volta', 'bin'),
    path.join(homeDir, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/home/linuxbrew/.linuxbrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ]
}

function executableNames(platform) {
  return platform === 'win32' ? ['officecli.exe', 'officecli'] : ['officecli']
}

function extractVersion(output) {
  const text = String(output || '').trim()
  if (!text) return null
  return text.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/u)?.[1] || text.split(/\s+/u)[0]
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function validateMcpTarget(target) {
  if (typeof target !== 'string') {
    throw new OfficeCliRunnerError('INVALID_MCP_TARGET', 'MCP target must be one of: lms, claude, cursor, vscode.')
  }
  const normalized = target.trim().toLowerCase()
  if (!MCP_TARGET_SET.has(normalized)) {
    throw new OfficeCliRunnerError(
      'INVALID_MCP_TARGET',
      `Unsupported MCP target "${target}". Allowed targets: ${MCP_TARGETS.join(', ')}.`,
      { target }
    )
  }
  return normalized
}

function parseMcpTargets(raw) {
  const targets = {}
  for (const line of String(raw || '').split(/\r?\n/u)) {
    const lower = line.toLowerCase()
    let target = null
    if (lower.includes('lm studio')) target = 'lms'
    else if (lower.includes('claude')) target = 'claude'
    else if (lower.includes('cursor')) target = 'cursor'
    else if (lower.includes('vs code') || lower.includes('vscode')) target = 'vscode'
    if (!target || !lower.includes('registered')) continue
    targets[target] = !lower.includes('not registered')
  }
  return targets
}

function tomlString(value) {
  // JSON double-quoted strings are valid TOML basic strings for paths and keep
  // backslashes/quotes escaped on Windows.
  return JSON.stringify(String(value))
}

function createMcpConfigs(binaryPath) {
  const entry = () => ({ command: binaryPath, args: ['mcp'] })
  return {
    generic: entry(),
    claude: { mcpServers: { officecli: entry() } },
    cursor: { mcpServers: { officecli: entry() } },
    vscode: { servers: { officecli: { type: 'stdio', ...entry() } } },
    codex: `[mcp_servers.officecli]\ncommand = ${tomlString(binaryPath)}\nargs = ["mcp"]\n`
  }
}

function createOfficeCliRunner(dependencies = {}) {
  const spawnImpl = dependencies.spawn || defaultSpawn
  const fsImpl = dependencies.fs || fs
  const platform = dependencies.platform || process.platform
  const homeDir = path.resolve(dependencies.homeDir || os.homedir())
  const baseEnvironment = { ...(dependencies.env || process.env) }
  const now = dependencies.now || Date.now
  const dependencyCommonPaths = normalizeDirectoryList(dependencies.commonPaths, 'commonPaths')

  function buildEnvironment(options) {
    const overrides = normalizeEnvironment(options.env)
    const environment = { ...baseEnvironment, ...overrides }
    const environmentPathKeys = Object.keys(environment).filter((key) => key.toLowerCase() === 'path')
    const overridePathKey = Object.keys(overrides).find((key) => key.toLowerCase() === 'path')
    if (options.pathEnv != null) {
      if (typeof options.pathEnv !== 'string' || options.pathEnv.includes('\0')) {
        throw new OfficeCliRunnerError('INVALID_OPTIONS', 'pathEnv must be a PATH string.')
      }
      for (const key of environmentPathKeys) delete environment[key]
      environment[platform === 'win32' ? 'Path' : 'PATH'] = options.pathEnv
    } else if (overridePathKey) {
      const overridePath = overrides[overridePathKey]
      for (const key of environmentPathKeys) delete environment[key]
      environment[platform === 'win32' ? 'Path' : 'PATH'] = overridePath
    }
    // The plugin must not trigger a binary self-update or leave an implicit
    // resident behind. Explicit `open` remains available when the user asks.
    if (environment.OFFICECLI_SKIP_UPDATE == null) environment.OFFICECLI_SKIP_UPDATE = '1'
    if (environment.OFFICECLI_NO_AUTO_RESIDENT == null) environment.OFFICECLI_NO_AUTO_RESIDENT = '1'
    return environment
  }

  function pathEnvironment(environment, options) {
    if (typeof options.pathEnv === 'string') return options.pathEnv
    if (platform === 'win32') return environment.Path || environment.PATH || ''
    return environment.PATH || ''
  }

  function isExecutable(filePath) {
    try {
      const stat = fsImpl.statSync(filePath)
      if (!stat.isFile()) return false
      fsImpl.accessSync(filePath, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  function requestedBinaryPath(options) {
    if (options.binaryPath == null) return null
    if (typeof options.binaryPath !== 'string' || options.binaryPath.length === 0 || options.binaryPath.includes('\0')) {
      throw new OfficeCliRunnerError('INVALID_BINARY_PATH', 'binaryPath must be a non-empty path string.')
    }
    return path.resolve(options.binaryPath)
  }

  function environmentBinaryPath(options) {
    const environment = buildEnvironment(options)
    const value = environment.OFFICECLI_PATH
    if (value == null || value === '') return null
    if (typeof value !== 'string' || value.includes('\0')) {
      throw new OfficeCliRunnerError('INVALID_BINARY_PATH', 'OFFICECLI_PATH must be a path string.')
    }
    return path.resolve(value)
  }

  function findBinary(options) {
    const requested = requestedBinaryPath(options)
    if (requested) return isExecutable(requested) ? requested : null

    const environmentRequested = environmentBinaryPath(options)
    if (environmentRequested) return isExecutable(environmentRequested) ? environmentRequested : null

    const environment = buildEnvironment(options)
    const delimiter = platform === 'win32' ? ';' : ':'
    const searchPaths = [
      ...normalizeDirectoryList(options.searchPaths, 'searchPaths'),
      ...pathEnvironment(environment, options).split(delimiter).filter(Boolean).map((item) => path.resolve(item)),
      ...dependencyCommonPaths,
      ...defaultCommonDirectories(platform, homeDir, environment)
    ]

    const seen = new Set()
    for (const directory of searchPaths) {
      for (const name of executableNames(platform)) {
        const candidate = path.resolve(directory, name)
        if (seen.has(candidate)) continue
        seen.add(candidate)
        if (isExecutable(candidate)) return candidate
      }
    }
    return null
  }

  function requireBinary(options) {
    const binaryPath = findBinary(options)
    if (binaryPath) return binaryPath
    throw new OfficeCliRunnerError(
      'OFFICECLI_NOT_FOUND',
      options.binaryPath
        ? `OfficeCLI is not executable at ${path.resolve(options.binaryPath)}.`
        : 'OfficeCLI was not found in PATH or the supported common install locations.'
    )
  }

  function processSettings(options, fallbackTimeout = DEFAULT_TIMEOUT_MS) {
    const timeoutMs = boundedInteger(options.timeoutMs, fallbackTimeout, MAX_TIMEOUT_MS, 'timeoutMs')
    const maxOutputBytes = boundedInteger(
      options.maxOutputBytes,
      DEFAULT_MAX_OUTPUT_BYTES,
      MAX_OUTPUT_BYTES,
      'maxOutputBytes'
    )
    let cwd
    if (options.cwd != null) {
      if (typeof options.cwd !== 'string' || options.cwd.length === 0 || options.cwd.includes('\0')) {
        throw new OfficeCliRunnerError('INVALID_OPTIONS', 'cwd must be a non-empty path string.')
      }
      cwd = path.resolve(options.cwd)
    }
    return { timeoutMs, maxOutputBytes, cwd, env: buildEnvironment(options) }
  }

  function execute(binaryPath, args, options, input, fallbackTimeout = DEFAULT_TIMEOUT_MS) {
    const settings = processSettings(options, fallbackTimeout)
    return new Promise((resolve, reject) => {
      const startedAt = now()
      let child
      try {
        child = spawnImpl(binaryPath, args, {
          cwd: settings.cwd,
          env: settings.env,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })
      } catch (error) {
        reject(new OfficeCliRunnerError('OFFICECLI_SPAWN_FAILED', `Unable to start OfficeCLI: ${error.message}`))
        return
      }

      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      let settled = false
      let timer = null
      let forceKillTimer = null
      let exitWaitTimer = null
      let terminationError = null
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')

      const finish = (error, result) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (forceKillTimer) clearTimeout(forceKillTimer)
        if (exitWaitTimer) clearTimeout(exitWaitTimer)
        if (error) reject(error)
        else resolve(result)
      }

      const terminateWithError = (error) => {
        if (settled || terminationError) return
        terminationError = error
        if (timer) clearTimeout(timer)
        // Node exposes a portable signal API only for the direct child. We
        // therefore wait for that child to be reaped and use TERM -> KILL, but
        // cannot promise cross-platform process-tree termination for helpers an
        // upstream OfficeCLI renderer may detach. NO_AUTO_RESIDENT and the MCP
        // command policy minimize that surface.
        try {
          child.kill('SIGTERM')
        } catch {
          // Continue to the forced-kill fallback below.
        }
        forceKillTimer = setTimeout(() => {
          try { child.kill('SIGKILL') } catch { }
        }, 250)
        // Normally `close` settles the promise after the process is reaped. A
        // broken/mock child must not keep the UI waiting forever.
        exitWaitTimer = setTimeout(() => finish(error), 2_000)
      }

      const append = (stream, chunk) => {
        if (terminationError) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
        const bytes = buffer.length
        if (stream === 'stdout') {
          stdoutBytes += bytes
          if (stdoutBytes > settings.maxOutputBytes) {
            terminateWithError(new OfficeCliRunnerError(
              'OUTPUT_LIMIT_EXCEEDED',
              `OfficeCLI stdout exceeded ${settings.maxOutputBytes} bytes.`,
              { stream: 'stdout', maxOutputBytes: settings.maxOutputBytes }
            ))
            return
          }
          stdout += stdoutDecoder.write(buffer)
        } else {
          stderrBytes += bytes
          if (stderrBytes > settings.maxOutputBytes) {
            terminateWithError(new OfficeCliRunnerError(
              'OUTPUT_LIMIT_EXCEEDED',
              `OfficeCLI stderr exceeded ${settings.maxOutputBytes} bytes.`,
              { stream: 'stderr', maxOutputBytes: settings.maxOutputBytes }
            ))
            return
          }
          stderr += stderrDecoder.write(buffer)
        }
      }

      if (!child || !child.stdout || !child.stderr || !child.stdin || typeof child.on !== 'function') {
        finish(new OfficeCliRunnerError('OFFICECLI_SPAWN_FAILED', 'OfficeCLI process did not expose piped stdio.'))
        return
      }

      child.stdout.on('data', (chunk) => append('stdout', chunk))
      child.stderr.on('data', (chunk) => append('stderr', chunk))
      child.on('error', (error) => {
        finish(new OfficeCliRunnerError('OFFICECLI_SPAWN_FAILED', `Unable to start OfficeCLI: ${error.message}`))
      })
      child.on('close', (exitCode, signal) => {
        if (!terminationError) {
          stdout += stdoutDecoder.end()
          stderr += stderrDecoder.end()
        }
        if (terminationError) {
          finish(terminationError)
          return
        }
        finish(null, {
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          signal: signal || null,
          stdout,
          stderr,
          durationMs: Math.max(0, now() - startedAt)
        })
      })

      timer = setTimeout(() => {
        terminateWithError(new OfficeCliRunnerError(
          'OFFICECLI_TIMEOUT',
          `OfficeCLI did not finish within ${settings.timeoutMs} ms.`,
          { timeoutMs: settings.timeoutMs }
        ))
      }, settings.timeoutMs)

      child.stdin.on('error', () => undefined)
      child.stdin.end(input == null ? undefined : String(input))
    })
  }

  function executeMcpHandshake(binaryPath, options) {
    const settings = processSettings(options, DEFAULT_MCP_TIMEOUT_MS)
    const initializeId = 'ztools-officecli-initialize'
    const toolsId = 'ztools-officecli-tools'

    return new Promise((resolve, reject) => {
      let child
      try {
        child = spawnImpl(binaryPath, ['mcp'], {
          cwd: settings.cwd,
          env: settings.env,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })
      } catch (error) {
        reject(new OfficeCliRunnerError('OFFICECLI_SPAWN_FAILED', `Unable to start OfficeCLI MCP: ${error.message}`))
        return
      }

      let settled = false
      let closed = false
      let terminationError = null
      let timer = null
      let forceKillTimer = null
      let exitWaitTimer = null
      let stdoutBytes = 0
      let stderrBytes = 0
      let lineBuffer = ''
      let stderr = ''
      let initializeResponse = null
      let toolsResponse = null
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')

      const finish = (error, data) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (forceKillTimer) clearTimeout(forceKillTimer)
        if (exitWaitTimer) clearTimeout(exitWaitTimer)
        if (error) reject(error)
        else resolve(data)
      }

      const terminateWithError = (error) => {
        if (settled || terminationError) return
        if (closed) {
          finish(error)
          return
        }
        terminationError = error
        if (timer) clearTimeout(timer)
        // See execute(): cross-platform Node can reliably signal the direct
        // OfficeCLI child, not every independently detached descendant.
        try { child.kill('SIGTERM') } catch { }
        forceKillTimer = setTimeout(() => {
          try { child.kill('SIGKILL') } catch { }
        }, 250)
        exitWaitTimer = setTimeout(() => finish(error), 2_000)
      }

      const writeMessage = (message) => {
        if (settled || terminationError) return
        try {
          child.stdin.write(`${JSON.stringify(message)}\n`)
        } catch (error) {
          terminateWithError(new OfficeCliRunnerError('MCP_PROBE_FAILED', `Unable to write to OfficeCLI MCP: ${error.message}`))
        }
      }

      const handleLine = (line) => {
        if (settled || terminationError || !line.trim()) return
        let response
        try {
          response = JSON.parse(line)
        } catch {
          terminateWithError(new OfficeCliRunnerError('MCP_PROTOCOL_ERROR', 'OfficeCLI MCP returned a non-JSON response line.'))
          return
        }
        if (response?.id === initializeId) {
          if (initializeResponse) {
            terminateWithError(new OfficeCliRunnerError('MCP_PROTOCOL_ERROR', 'OfficeCLI MCP returned duplicate initialize responses.'))
            return
          }
          if (response.error) {
            terminateWithError(new OfficeCliRunnerError(
              'MCP_PROTOCOL_ERROR',
              String(response.error.message || 'OfficeCLI MCP initialize failed.'),
              { protocolError: response.error }
            ))
            return
          }
          initializeResponse = response
          // MCP lifecycle ordering is significant: only advertise initialized
          // and request tools after the initialize response has arrived.
          writeMessage({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
          writeMessage({ jsonrpc: '2.0', id: toolsId, method: 'tools/list', params: {} })
          return
        }
        if (response?.id === toolsId) {
          toolsResponse = response
          try { child.stdin.end() } catch { }
        }
      }

      const appendStdout = (chunk) => {
        if (terminationError) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
        stdoutBytes += buffer.length
        if (stdoutBytes > settings.maxOutputBytes) {
          terminateWithError(new OfficeCliRunnerError(
            'OUTPUT_LIMIT_EXCEEDED',
            `OfficeCLI MCP stdout exceeded ${settings.maxOutputBytes} bytes.`,
            { stream: 'stdout', maxOutputBytes: settings.maxOutputBytes }
          ))
          return
        }
        lineBuffer += stdoutDecoder.write(buffer)
        let newlineIndex
        while ((newlineIndex = lineBuffer.indexOf('\n')) >= 0) {
          const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/u, '')
          lineBuffer = lineBuffer.slice(newlineIndex + 1)
          handleLine(line)
        }
      }

      const appendStderr = (chunk) => {
        if (terminationError) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
        stderrBytes += buffer.length
        if (stderrBytes > settings.maxOutputBytes) {
          terminateWithError(new OfficeCliRunnerError(
            'OUTPUT_LIMIT_EXCEEDED',
            `OfficeCLI MCP stderr exceeded ${settings.maxOutputBytes} bytes.`,
            { stream: 'stderr', maxOutputBytes: settings.maxOutputBytes }
          ))
          return
        }
        stderr += stderrDecoder.write(buffer)
      }

      if (!child || !child.stdout || !child.stderr || !child.stdin || typeof child.on !== 'function') {
        finish(new OfficeCliRunnerError('OFFICECLI_SPAWN_FAILED', 'OfficeCLI MCP process did not expose piped stdio.'))
        return
      }

      child.stdout.on('data', appendStdout)
      child.stderr.on('data', appendStderr)
      child.stdin.on('error', (error) => {
        if (!closed && !settled) {
          terminateWithError(new OfficeCliRunnerError('MCP_PROBE_FAILED', `OfficeCLI MCP stdin failed: ${error.message}`))
        }
      })
      child.on('error', (error) => {
        finish(new OfficeCliRunnerError('OFFICECLI_SPAWN_FAILED', `Unable to start OfficeCLI MCP: ${error.message}`))
      })
      child.on('close', (exitCode) => {
        closed = true
        if (!terminationError) {
          lineBuffer += stdoutDecoder.end()
          stderr += stderrDecoder.end()
          if (lineBuffer.trim()) handleLine(lineBuffer.replace(/\r$/u, ''))
        }
        if (terminationError) {
          finish(terminationError)
          return
        }
        if (exitCode !== 0) {
          finish(new OfficeCliRunnerError(
            'MCP_PROBE_FAILED',
            stderr.trim() || `OfficeCLI MCP server exited with code ${exitCode}.`,
            { exitCode, stderr }
          ))
          return
        }
        if (!initializeResponse || !toolsResponse) {
          finish(new OfficeCliRunnerError(
            'MCP_PROTOCOL_ERROR',
            'OfficeCLI MCP did not return both initialize and tools/list responses.'
          ))
          return
        }
        if (toolsResponse.error) {
          finish(new OfficeCliRunnerError(
            'MCP_PROTOCOL_ERROR',
            String(toolsResponse.error.message || 'OfficeCLI MCP tools/list failed.'),
            { protocolError: toolsResponse.error }
          ))
          return
        }
        const listedTools = Array.isArray(toolsResponse.result?.tools) ? toolsResponse.result.tools : []
        finish(null, {
          serverInfo: initializeResponse.result?.serverInfo || null,
          protocolVersion: initializeResponse.result?.protocolVersion || null,
          toolNames: listedTools.map((tool) => tool?.name).filter((name) => typeof name === 'string')
        })
      })

      timer = setTimeout(() => {
        terminateWithError(new OfficeCliRunnerError(
          'OFFICECLI_TIMEOUT',
          `OfficeCLI MCP handshake did not finish within ${settings.timeoutMs} ms.`,
          { timeoutMs: settings.timeoutMs }
        ))
      }, settings.timeoutMs)

      writeMessage({
        jsonrpc: '2.0',
        id: initializeId,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'ztools-office-suite-workbench', version: '0.1.0' }
        }
      })
    })
  }

  async function runRaw(args, options, fallbackTimeout) {
    const binaryPath = requireBinary(options)
    const result = await execute(binaryPath, args, options, undefined, fallbackTimeout)
    if (result.exitCode !== 0) {
      throw new OfficeCliRunnerError(
        'OFFICECLI_EXIT',
        result.stderr.trim() || result.stdout.trim() || `OfficeCLI exited with code ${result.exitCode}.`,
        { binaryPath, args, ...result }
      )
    }
    return { binaryPath, ...result }
  }

  async function getStatusData(options) {
    const requested = requestedBinaryPath(options) || environmentBinaryPath(options)
    const binaryPath = findBinary(options)
    if (!binaryPath) return { installed: false, binaryPath: requested, version: null }
    const result = await execute(binaryPath, ['--version'], options, undefined, 8_000)
    if (result.exitCode !== 0) {
      throw new OfficeCliRunnerError(
        'OFFICECLI_EXIT',
        result.stderr.trim() || result.stdout.trim() || `OfficeCLI --version exited with code ${result.exitCode}.`,
        { binaryPath, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
      )
    }
    return { installed: true, binaryPath, version: extractVersion(result.stdout || result.stderr) }
  }

  async function runDocumentData(commandInput, options) {
    const parsed = parseCommand(commandInput)
    const binaryPath = requireBinary(options)
    const result = await execute(binaryPath, parsed.argv, options)
    const data = {
      command: parsed.command,
      args: parsed.args.slice(),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    }
    const json = parseJsonOutput(result.stdout)
    if (json !== undefined) data.json = json
    if (result.exitCode !== 0) {
      throw new OfficeCliRunnerError(
        'OFFICECLI_EXIT',
        result.stderr.trim() || result.stdout.trim() || `OfficeCLI exited with code ${result.exitCode}.`,
        data
      )
    }
    return data
  }

  async function getMcpStatusData(options) {
    const result = await runRaw(['mcp', 'list'], options, DEFAULT_MCP_TIMEOUT_MS)
    const raw = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? '\n' : '').trim()
    return { raw, targets: parseMcpTargets(raw) }
  }

  async function registerMcpData(targetInput, options) {
    const target = validateMcpTarget(targetInput)
    const result = await runRaw(['mcp', target], options, DEFAULT_MCP_TIMEOUT_MS)
    return { target, stdout: result.stdout, stderr: result.stderr }
  }

  async function unregisterMcpData(targetInput, options) {
    const target = validateMcpTarget(targetInput)
    const result = await runRaw(['mcp', 'uninstall', target], options, DEFAULT_MCP_TIMEOUT_MS)
    return { target, stdout: result.stdout, stderr: result.stderr }
  }

  async function probeMcpData(options) {
    const binaryPath = requireBinary(options)
    return executeMcpHandshake(binaryPath, options)
  }

  async function getMcpConfigsData(options) {
    const binaryPath = requireBinary(options)
    return { binaryPath, configs: createMcpConfigs(binaryPath) }
  }

  async function wrap(work) {
    try {
      return success(await work())
    } catch (error) {
      return failure(error)
    }
  }

  return Object.freeze({
    getStatus(options) {
      return wrap(() => getStatusData(normalizeOptions(options)))
    },
    run(command, options) {
      return wrap(() => runDocumentData(command, normalizeOptions(options)))
    },
    getMcpStatus(options) {
      return wrap(() => getMcpStatusData(normalizeOptions(options)))
    },
    registerMcp(target, options) {
      return wrap(() => registerMcpData(target, normalizeOptions(options)))
    },
    unregisterMcp(target, options) {
      return wrap(() => unregisterMcpData(target, normalizeOptions(options)))
    },
    probeMcp(options) {
      return wrap(() => probeMcpData(normalizeOptions(options)))
    },
    getMcpConfigs(options) {
      return wrap(() => getMcpConfigsData(normalizeOptions(options)))
    }
  })
}

module.exports = {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MCP_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  MCP_TARGETS,
  OfficeCliRunnerError,
  createMcpConfigs,
  createOfficeCliRunner,
  extractVersion,
  failure,
  parseMcpTargets,
  success,
  validateMcpTarget
}
