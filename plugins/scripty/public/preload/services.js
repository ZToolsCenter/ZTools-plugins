'use strict'

// 宿主 preload 沙箱（尤其是 Windows 上的 ZTools）可能未定义裸 setImmediate/clearImmediate，
// 而 require 链上的 yauzl/yazl（经 fd-slicer）会在各自 CommonJS 模块内部裸调用它们，
// 导致导入备份时报 ReferenceError "setImmediate is not defined"。
// 这里在加载任何依赖前先把实现挂到 globalThis，使后续被 require 的模块内部裸标识符可解析。
// 优先级：复用宿主原生 -> node:timers -> setTimeout 兜底；取到的实现同时写回 globalThis。
;(function ensureImmediateTimers(g) {
  if (typeof g.setImmediate !== 'function') {
    let setFn
    try {
      const timers = require('node:timers')
      if (typeof timers.setImmediate === 'function') setFn = timers.setImmediate
    } catch (e) {}
    if (typeof setFn !== 'function') {
      setFn = function setImmediateShim(callback) {
        const args = Array.prototype.slice.call(arguments, 1)
        return setTimeout(function () { callback.apply(null, args) }, 0)
      }
    }
    try { g.setImmediate = setFn } catch (e) {}
  }
  if (typeof g.clearImmediate !== 'function') {
    let clearFn
    try {
      const timers = require('node:timers')
      if (typeof timers.clearImmediate === 'function') clearFn = timers.clearImmediate
    } catch (e) {}
    if (typeof clearFn !== 'function') clearFn = function clearImmediateShim(id) { return clearTimeout(id) }
    try { g.clearImmediate = clearFn } catch (e) {}
  }
})(globalThis)

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  LogFileRepository,
  ManagedScriptRepository
} = require('./file-repositories')
const {
  MetadataRepository,
  RepositoryError
} = require('./metadata-repository')
const { createAppApi } = require('./app-service')
const { writeBackupArchive } = require('./backup-archive')
const { buildExportPackageFiles } = require('./backup-package')
const { createBackupsApi } = require('./backup-service')
const { recoverImportTransactions } = require('./backup-import-transaction')
const { createEnvironmentsApi } = require('./environment-service')
const { createDependencyService } = require('./dependency-service')
const { createHistoryApi } = require('./history-service')
const { createInterpreterResolver } = require('./interpreter-resolver')
const { createRunService, recoverInterruptedRuns } = require('./run-service')
const { createSchedulerService, registerSchedulerLifecycle } = require('./scheduler-service')
const { createScriptsApi } = require('./script-service')
const { createSettingsApi } = require('./settings-service')
const { createTasksApi } = require('./task-service')
const { registerScriptyMcpTools } = require('./mcp-tools')

/** Resolves Scripty's fixed device-local directory layout from the ZTools user data path. */
function getDataPaths() {
  const root = path.join(window.ztools.getPath('userData'), 'scripty')
  return {
    root,
    metadata: path.join(root, 'data'),
    scripts: path.join(root, 'scripts'),
    logs: path.join(root, 'logs'),
    backups: path.join(root, 'backups')
  }
}

const dataPaths = getDataPaths()
recoverImportTransactions(dataPaths.root)
const metadataRepository = new MetadataRepository(dataPaths.metadata)
const managedScriptRepository = new ManagedScriptRepository(dataPaths.scripts)
const logFileRepository = new LogFileRepository(dataPaths.logs)
metadataRepository.initialize()
managedScriptRepository.initialize()
managedScriptRepository.migrateLegacyFiles(metadataRepository)
logFileRepository.initialize()
recoverInterruptedRuns(metadataRepository)

const interpreterResolver = createInterpreterResolver({
  platform: process.platform,
  environment: process.env,
  homeDirectory: os.homedir()
})

// Warm the resolver cache from the user's login-shell PATH so task readiness reflects interpreters
// installed via version managers (mise, nvm, pyenv, …) that are absent from the plugin's inherited PATH.
// Built-in command names are the only defaults; failures leave synchronous discovery as the fallback.
;(function warmInterpreterCache() {
  const BUILT_IN_INTERPRETERS = { javascript: 'node', python: 'python', powershell: 'powershell', shell: 'sh' }
  for (const [kind, configured] of Object.entries(BUILT_IN_INTERPRETERS)) {
    Promise.resolve(interpreterResolver.resolveAsync(kind, configured)).catch(() => {})
  }
})()
const dependencyService = createDependencyService(dataPaths.root, metadataRepository, interpreterResolver)
dependencyService.initialize()
const runService = createRunService(metadataRepository, managedScriptRepository, logFileRepository, undefined, process.platform, undefined, interpreterResolver, dependencyService)
const scheduler = createSchedulerService({ startScheduledRun: runService.startScheduled })
scheduler.initialize(metadataRepository.read('tasks'))
registerSchedulerLifecycle(window.ztools, scheduler)
const tasksApi = createTasksApi(metadataRepository, managedScriptRepository, scheduler, interpreterResolver, dependencyService)

/** Creates a timestamped full portable backup in the fixed backups directory before overwrite restoration. */
async function createAutomaticBackup() {
  const exportedAt = new Date().toISOString()
  const packageSnapshot = buildExportPackageFiles({
    appVersion: require('../plugin.json').version,
    exportedAt,
    options: { includeEnvironments: true, includeEnvironmentValues: true, includeSensitiveValues: true },
    envelopes: {
      scripts: metadataRepository.readEnvelope('scripts'),
      scriptFolders: metadataRepository.readEnvelope('scriptFolders'),
      dependencies: metadataRepository.readEnvelope('dependencies'),
      tasks: metadataRepository.readEnvelope('tasks'),
      environments: metadataRepository.readEnvelope('environments'),
      settings: metadataRepository.readEnvelope('settings')
    },
    readScriptContent: script => managedScriptRepository.read(script, script.language)
  })
  fs.mkdirSync(dataPaths.backups, { recursive: true })
  const fileName = `pre-overwrite-${exportedAt.replace(/[:.]/g, '-')}.zip`
  await writeBackupArchive(packageSnapshot.files, path.join(dataPaths.backups, fileName))
  return fileName
}

window.scripty = {
  app: createAppApi(scheduler),
  backups: createBackupsApi(metadataRepository, managedScriptRepository, {
    appVersion: require('../plugin.json').version,
    createAutomaticBackup,
    dataRoot: dataPaths.root,
    scheduler,
    ztools: window.ztools
  }),
  dependencies: dependencyService.api,
  environments: createEnvironmentsApi(metadataRepository),
  history: createHistoryApi(metadataRepository, logFileRepository, runService.api),
  runs: runService.api,
  scripts: createScriptsApi(metadataRepository, managedScriptRepository),
  settings: createSettingsApi(metadataRepository),
  tasks: tasksApi
}

// 向 ZTools 宿主注册 MCP 工具，使脚本与任务能力可经宿主 MCP 端点对外暴露。
registerScriptyMcpTools(window.scripty, window.ztools)

module.exports = {
  dataPaths,
  logFileRepository,
  managedScriptRepository,
  metadataRepository,
  RepositoryError,
  scheduler
}
