'use strict'

const path = require('node:path')
const { spawn } = require('node:child_process')
const {
  SYSTEM_INFORMATION_METHODS,
  isAllowedSystemInformationMethod,
  projectSystemInformationResult
} = require('./systeminformation-protocol.cjs')

const SYSTEM_INFORMATION_HELPER_PATH = path.join(__dirname, 'systeminformation-helper.cjs')
const MAX_CONCURRENT_HELPERS = 2
const MAX_COMBINED_OUTPUT_BYTES = 256 * 1024
const PROCESS_GROUP_POLL_MS = 10
const DEFAULT_CLEANUP_WATCHDOG_MS = 2_000
const MIN_CLEANUP_WATCHDOG_MS = 10
const MAX_CLEANUP_WATCHDOG_MS = 30_000
const HELPER_ERROR_CODES = new Set([
  'METHOD_NOT_ALLOWED',
  'SOURCE_UNAVAILABLE',
  'COLLECTOR_FAILED'
])

// This scheduler is intentionally shared by every runner created from this
// module. Creating another runner must not bypass the process-wide limit.
const pendingJobs = []
const runningJobs = new Set()
let activeHelpers = 0
let schedulerFuseError = null

function probeError(code) {
  const normalizedCode = code === 'METHOD_NOT_ALLOWED'
    ? 'METHOD_NOT_ALLOWED'
    : code === 'SOURCE_UNAVAILABLE'
      ? 'SOURCE_UNAVAILABLE'
      : 'COLLECTOR_FAILED'
  const error = new Error(normalizedCode === 'METHOD_NOT_ALLOWED'
    ? 'System information method is not allowed'
    : normalizedCode === 'SOURCE_UNAVAILABLE'
      ? 'System information source is unavailable'
      : 'System information probe failed')
  error.code = normalizedCode
  return error
}

function abortError(signal) {
  if (signal && signal.reason instanceof Error) return signal.reason
  const error = new Error('System information probe was aborted')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function hasAbortEvents(signal) {
  return Boolean(signal &&
    typeof signal.addEventListener === 'function' &&
    typeof signal.removeEventListener === 'function')
}

function readEnvironmentValue(environment, name) {
  if (!environment || typeof environment !== 'object') return null
  const target = name.toLowerCase()
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() !== target) continue
    return typeof environment[key] === 'string' ? environment[key] : null
  }
  return null
}

function resolveWindowsSystemRoot(environment) {
  const value = readEnvironmentValue(environment, 'SystemRoot')
  // SystemRoot is an OS-owned invariant, not a general directory input. Keep
  // this deliberately narrower than win32.isAbsolute so UNC, device, nested,
  // alternate-separator, dot-segment, and trailing-slash paths all fail.
  return typeof value === 'string' && /^[A-Za-z]:\\Windows$/i.test(value)
    ? value
    : null
}

function resolveWindowsTaskkillPath(environment) {
  const systemRoot = resolveWindowsSystemRoot(environment)
  return systemRoot ? path.win32.join(systemRoot, 'System32', 'taskkill.exe') : null
}

function createChildEnvironment(platform, sourceEnvironment) {
  if (platform === 'win32') {
    const systemRoot = resolveWindowsSystemRoot(sourceEnvironment)
    if (!systemRoot) return null
    const system32 = path.win32.join(systemRoot, 'System32')
    return Object.freeze({
      SystemRoot: systemRoot,
      WINDIR: systemRoot,
      ComSpec: path.win32.join(system32, 'cmd.exe'),
      PATH: [
        system32,
        systemRoot,
        path.win32.join(system32, 'Wbem'),
        path.win32.join(system32, 'WindowsPowerShell', 'v1.0')
      ].join(';'),
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_NO_WARNINGS: '1'
    })
  }

  return Object.freeze({
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'C',
    LC_ALL: 'C',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_NO_WARNINGS: '1'
  })
}

function isValidExecutablePath(platform, executablePath) {
  if (typeof executablePath !== 'string' || !executablePath || executablePath.includes('\0')) {
    return false
  }
  if (platform === 'win32') {
    return /^[A-Za-z]:\\/.test(executablePath) &&
      !executablePath.includes('/') &&
      path.win32.isAbsolute(executablePath)
  }
  return path.posix.isAbsolute(executablePath)
}

function createRuntime(options) {
  const hasInjectedProcessInfo = Object.prototype.hasOwnProperty.call(options, 'processInfo')
  const processInfo = hasInjectedProcessInfo ? options.processInfo : process
  if (!processInfo || typeof processInfo !== 'object') return null

  const platform = typeof processInfo.platform === 'string' ? processInfo.platform : null
  const executablePath = processInfo.execPath
  const sourceEnvironment = processInfo.env
  if (!platform || !isValidExecutablePath(platform, executablePath)) return null

  const environment = createChildEnvironment(platform, sourceEnvironment)
  if (!environment) return null
  const taskkillPath = platform === 'win32'
    ? resolveWindowsTaskkillPath(sourceEnvironment)
    : null
  if (platform === 'win32' && !taskkillPath) return null

  return Object.freeze({
    platform,
    executablePath,
    environment,
    taskkillPath
  })
}

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  const expected = expectedKeys.slice().sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function parseEnvelope(methodName, output) {
  if (typeof output !== 'string' || output.length === 0) throw probeError('COLLECTOR_FAILED')

  let envelope
  try {
    envelope = JSON.parse(output)
  } catch {
    throw probeError('COLLECTOR_FAILED')
  }

  if (envelope && envelope.ok === false) {
    if (!exactKeys(envelope, ['ok', 'code']) || !HELPER_ERROR_CODES.has(envelope.code)) {
      throw probeError('COLLECTOR_FAILED')
    }
    throw probeError(envelope.code)
  }

  if (!envelope || envelope.ok !== true || !exactKeys(envelope, ['ok', 'value'])) {
    throw probeError('COLLECTOR_FAILED')
  }

  try {
    // Project again at the trust boundary. Even a compromised or accidentally
    // changed helper cannot return fields outside the audited protocol.
    return projectSystemInformationResult(methodName, envelope.value)
  } catch {
    throw probeError('COLLECTOR_FAILED')
  }
}

function bufferFromChunk(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk
  if (chunk instanceof Uint8Array) return Buffer.from(chunk)
  return Buffer.from(String(chunk), 'utf8')
}

function isPositivePid(value) {
  return Number.isSafeInteger(value) && value > 0
}

function resolveCleanupWatchdog(value) {
  if (!Number.isFinite(value)) return DEFAULT_CLEANUP_WATCHDOG_MS
  return Math.min(
    MAX_CLEANUP_WATCHDOG_MS,
    Math.max(MIN_CLEANUP_WATCHDOG_MS, Math.round(value))
  )
}

function schedulerUnavailableError() {
  const error = probeError('COLLECTOR_FAILED')
  error.name = 'HelperSchedulerUnavailableError'
  return error
}

function tripSchedulerFuse() {
  if (schedulerFuseError) return schedulerFuseError
  schedulerFuseError = schedulerUnavailableError()

  for (const job of pendingJobs.splice(0)) {
    if (!job || job.state !== 'queued') continue
    job.state = 'settled'
    removeAbortListener(job)
    job.reject(schedulerFuseError)
  }

  // Cleanup is no longer provable. Best-effort terminate every active tree,
  // settle all callers, and permanently refuse to create another helper in
  // this preload process. This prevents an accumulation of unknown children.
  for (const job of [...runningJobs]) {
    if (job.state === 'running' && typeof job.failClosed === 'function') {
      job.failClosed(schedulerFuseError)
    }
  }
  return schedulerFuseError
}

function launchHelper(job) {
  const { dependencies, methodName, signal } = job
  const { Spawn, Kill, runtime, cleanupWatchdogMs } = dependencies

  return new Promise((resolve, reject) => {
    if (!runtime) {
      reject(probeError('SOURCE_UNAVAILABLE'))
      return
    }

    let child
    try {
      child = Spawn(runtime.executablePath, [SYSTEM_INFORMATION_HELPER_PATH, methodName], {
        shell: false,
        detached: runtime.platform !== 'win32',
        windowsHide: true,
        env: { ...runtime.environment },
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      reject(probeError('SOURCE_UNAVAILABLE'))
      return
    }

    if (!child || typeof child.once !== 'function') {
      reject(probeError('SOURCE_UNAVAILABLE'))
      return
    }

    const pid = isPositivePid(child.pid) ? child.pid : null
    const stdoutChunks = []
    let combinedOutputBytes = 0
    let stderrSeen = false
    let outputLimitExceeded = false
    let childFailure = false
    let childClosed = false
    let closeCode = null
    let closeSignal = null
    let terminationStarted = false
    let terminationReason = null
    let taskkillFinished = runtime.platform !== 'win32'
    let processGroupGone = runtime.platform === 'win32' || pid === null
    let processGroupPollTimer = null
    let processGroupPollStarted = false
    let cleanupWatchdogTimer = null
    let settled = false

    const cleanup = () => {
      if (processGroupPollTimer !== null) {
        clearTimeout(processGroupPollTimer)
        processGroupPollTimer = null
      }
      if (cleanupWatchdogTimer !== null) {
        clearTimeout(cleanupWatchdogTimer)
        cleanupWatchdogTimer = null
      }
      job.abortRunning = null
      job.failClosed = null
    }

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }

    const maybeFinishTermination = () => {
      if (!terminationStarted || !childClosed || !taskkillFinished || !processGroupGone) return
      finish(reject, terminationReason || probeError('COLLECTOR_FAILED'))
    }

    const startCleanupWatchdog = () => {
      if (cleanupWatchdogTimer !== null) return
      cleanupWatchdogTimer = setTimeout(() => {
        cleanupWatchdogTimer = null
        tripSchedulerFuse()
      }, cleanupWatchdogMs)
    }

    const pollForProcessGroupExit = () => {
      if (settled || !terminationStarted || runtime.platform === 'win32' || !childClosed) return
      if (processGroupGone) {
        maybeFinishTermination()
        return
      }

      try {
        Kill(-pid, 0)
      } catch (error) {
        if (error && error.code === 'ESRCH') {
          processGroupGone = true
          maybeFinishTermination()
          return
        }
        // EPERM proves that the process group still exists. Unexpected errors
        // cannot prove cleanup either, so keep checking instead of releasing
        // the concurrency slot prematurely.
      }

      processGroupPollTimer = setTimeout(pollForProcessGroupExit, PROCESS_GROUP_POLL_MS)
    }

    const startProcessGroupPoll = () => {
      if (processGroupPollStarted || runtime.platform === 'win32') return
      processGroupPollStarted = true
      if (pid === null) {
        processGroupGone = true
        maybeFinishTermination()
        return
      }
      pollForProcessGroupExit()
    }

    const startTaskkill = () => {
      if (runtime.platform !== 'win32') return
      let taskkill
      try {
        taskkill = Spawn(runtime.taskkillPath, ['/PID', String(pid), '/T', '/F'], {
          shell: false,
          detached: false,
          windowsHide: true,
          env: { ...runtime.environment },
          stdio: 'ignore'
        })
      } catch {
        // Without a successful taskkill completion the process tree has not
        // been confirmed dead. Keep the slot rather than report false cleanup.
        return
      }

      if (!taskkill || typeof taskkill.once !== 'function') {
        return
      }

      taskkill.once('error', () => {
        // Node follows a taskkill spawn error with `close`; only `close`
        // establishes completion and is therefore allowed to release the slot.
      })
      taskkill.once('close', (code, signalName) => {
        if (code === 0 && signalName == null) {
          taskkillFinished = true
          maybeFinishTermination()
        }
      })
    }

    const requestTermination = (reason) => {
      if (settled || terminationStarted) return
      terminationStarted = true
      terminationReason = reason
      stdoutChunks.length = 0
      startCleanupWatchdog()

      if (runtime.platform === 'win32') {
        if (pid === null) {
          taskkillFinished = true
        } else {
          startTaskkill()
        }
      } else if (pid !== null) {
        try {
          Kill(-pid, 'SIGKILL')
        } catch (error) {
          if (error && error.code === 'ESRCH') processGroupGone = true
        }
      }

      if (childClosed) startProcessGroupPoll()
      maybeFinishTermination()
    }

    const consumeOutput = (streamName, chunk) => {
      if (settled) return
      const buffer = bufferFromChunk(chunk)
      if (buffer.length > MAX_COMBINED_OUTPUT_BYTES - combinedOutputBytes) {
        outputLimitExceeded = true
        combinedOutputBytes = MAX_COMBINED_OUTPUT_BYTES + 1
        requestTermination(probeError('COLLECTOR_FAILED'))
        return
      }
      combinedOutputBytes += buffer.length

      if (streamName === 'stderr') {
        stderrSeen = true
        // Never retain stderr: dependency errors can contain local paths or
        // command output. Any stderr is a protocol violation.
        requestTermination(probeError('COLLECTOR_FAILED'))
        return
      }
      if (!terminationStarted) stdoutChunks.push(buffer)
    }

    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => consumeOutput('stdout', chunk))
      child.stdout.on('error', () => requestTermination(probeError('COLLECTOR_FAILED')))
    } else {
      childFailure = true
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => consumeOutput('stderr', chunk))
      child.stderr.on('error', () => requestTermination(probeError('COLLECTOR_FAILED')))
    } else {
      childFailure = true
    }

    child.once('error', () => {
      childFailure = true
      if (pid !== null) requestTermination(probeError('SOURCE_UNAVAILABLE'))
    })
    child.once('close', (code, signalName) => {
      if (childClosed) return
      childClosed = true
      closeCode = code
      closeSignal = signalName

      if (terminationStarted) {
        startProcessGroupPoll()
        maybeFinishTermination()
        return
      }

      if (childFailure) {
        finish(reject, probeError('SOURCE_UNAVAILABLE'))
        return
      }
      if (outputLimitExceeded || stderrSeen || closeCode !== 0 || closeSignal != null) {
        finish(reject, probeError('COLLECTOR_FAILED'))
        return
      }

      let value
      try {
        value = parseEnvelope(methodName, Buffer.concat(stdoutChunks).toString('utf8'))
      } catch (error) {
        finish(reject, error)
        return
      }
      finish(resolve, value)
    })

    job.abortRunning = (reason) => requestTermination(reason || abortError(signal))
    job.failClosed = (reason) => {
      requestTermination(reason)
      finish(reject, reason)
    }
    if (signal && signal.aborted) job.abortRunning()
  })
}

function removePendingJob(job) {
  const index = pendingJobs.indexOf(job)
  if (index >= 0) pendingJobs.splice(index, 1)
}

function removeAbortListener(job) {
  if (hasAbortEvents(job.signal)) job.signal.removeEventListener('abort', job.onAbort)
}

function settleRunningJob(job, callback, value) {
  if (job.state !== 'running') return
  job.state = 'settled'
  removeAbortListener(job)
  runningJobs.delete(job)
  activeHelpers -= 1
  pumpQueue()
  callback(value)
}

function pumpQueue() {
  if (schedulerFuseError) return
  while (activeHelpers < MAX_CONCURRENT_HELPERS && pendingJobs.length > 0) {
    const job = pendingJobs.shift()
    if (!job || job.state !== 'queued') continue
    if (job.signal && job.signal.aborted) {
      job.state = 'settled'
      removeAbortListener(job)
      job.reject(abortError(job.signal))
      continue
    }

    job.state = 'running'
    activeHelpers += 1
    runningJobs.add(job)
    let execution
    try {
      execution = launchHelper(job)
    } catch {
      execution = Promise.reject(probeError('SOURCE_UNAVAILABLE'))
    }
    Promise.resolve(execution).then(
      (value) => settleRunningJob(job, job.resolve, value),
      (error) => settleRunningJob(job, job.reject, error)
    )
  }
}

function scheduleHelper(dependencies, methodName, signal) {
  return new Promise((resolve, reject) => {
    if (schedulerFuseError) {
      reject(schedulerFuseError)
      return
    }
    const job = {
      dependencies,
      methodName,
      signal,
      resolve,
      reject,
      state: 'queued',
      abortRunning: null,
      failClosed: null,
      onAbort: null
    }

    job.onAbort = () => {
      if (job.state === 'queued') {
        removePendingJob(job)
        job.state = 'settled'
        removeAbortListener(job)
        reject(abortError(signal))
        pumpQueue()
        return
      }
      if (job.state === 'running' && typeof job.abortRunning === 'function') {
        job.abortRunning()
      }
    }

    if (signal && signal.aborted) {
      job.state = 'settled'
      reject(abortError(signal))
      return
    }
    if (hasAbortEvents(signal)) signal.addEventListener('abort', job.onAbort, { once: true })
    pendingJobs.push(job)
    pumpQueue()
  })
}

function createSystemInformationProcessRunner(options = {}) {
  const Spawn = Object.prototype.hasOwnProperty.call(options, 'Spawn') ? options.Spawn : spawn
  const Kill = Object.prototype.hasOwnProperty.call(options, 'kill') ? options.kill : process.kill
  if (typeof Spawn !== 'function') throw new TypeError('Spawn must be a function')
  if (typeof Kill !== 'function') throw new TypeError('kill must be a function')

  const dependencies = Object.freeze({
    Spawn,
    Kill,
    runtime: createRuntime(options),
    cleanupWatchdogMs: resolveCleanupWatchdog(options.cleanupWatchdogMs)
  })

  const runSystemInformation = function runSystemInformation(methodName, runOptions = {}) {
    if (!isAllowedSystemInformationMethod(methodName)) {
      return Promise.reject(probeError('METHOD_NOT_ALLOWED'))
    }
    const signal = runOptions && runOptions.signal
    return scheduleHelper(dependencies, methodName, signal)
  }

  Object.defineProperty(runSystemInformation, 'waitsForProcessExit', {
    value: true,
    enumerable: true,
    configurable: false,
    writable: false
  })
  return runSystemInformation
}

module.exports = {
  DEFAULT_CLEANUP_WATCHDOG_MS,
  MAX_COMBINED_OUTPUT_BYTES,
  MAX_CONCURRENT_HELPERS,
  SYSTEM_INFORMATION_HELPER_PATH,
  SYSTEM_INFORMATION_METHODS,
  createSystemInformationProcessRunner,
  resolveWindowsTaskkillPath
}
