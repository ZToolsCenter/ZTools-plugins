const fs = require('node:fs')
const path = require('node:path')
const { homedir } = require('node:os')
const { SaxesParser } = require('saxes')
const { exec, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { fileURLToPath, pathToFileURL } = require('node:url')

// ─── 文件日志（开发调试） ──

let _logFile = ''
function getLogFile() {
  if (_logFile) return _logFile
  try {
    const base = window.ztools.getPath('userData')
    _logFile = path.join(base, 'ideopen-debug.log')
  } catch {
    _logFile = path.join(__dirname, 'ideopen-debug.log')
  }
  return _logFile
}

function debugLog(message, data) {
  let isDev = false
  try { isDev = window.ztools.isDev() } catch {}
  if (!isDev) return

  const now = new Date().toISOString()
  const line = data !== undefined
    ? `[${now}] [ideOpen] ${message} ${JSON.stringify(data, null, 2)}`
    : `[${now}] [ideOpen] ${message}`
  console.log(line)
  try {
    fs.appendFileSync(getLogFile(), line + '\n')
  } catch (e) {
    console.warn('[ideOpen] 写入日志文件失败:', e)
  }
}

// ─── glob 路径解析（JetBrains 版本目录含通配符） ──

function resolveGlobPath(pattern) {
  if (!pattern.includes('*')) return pattern

  const starIdx = pattern.indexOf('*')
  const before = pattern.substring(0, starIdx)
  const after = pattern.substring(starIdx + 1)
  const dir = path.dirname(before)
  const prefix = path.basename(before)

  if (!fs.existsSync(dir)) return pattern

  try {
    const entries = fs.readdirSync(dir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        const resolved = path.join(dir, entry) + after
        if (fs.existsSync(resolved)) return resolved
      }
    }
  } catch {}

  return pattern
}

// ─── 类型 ──

// IDEItem: { code, name, command, dbPath, shell }
// ProjectItem: { name, path, uri, type, label }

// ─── SQLite 读取 ──

const RECENT_KEYS = [
  'history.recentlyOpenedPathsList',
  'history.openedPathsList',
  'openedPathsList'
]

function canDeleteProjects(filePath) {
  return ['.vscdb', '.db'].includes(path.extname(filePath).toLowerCase())
}

function openDatabase(filePath, readOnly) {
  const { DatabaseSync } = require('node:sqlite')
  const url = pathToFileURL(filePath)
  url.searchParams.set('mode', readOnly ? 'ro' : 'rw')
  const db = new DatabaseSync(url.href, { readOnly })
  try {
    db.exec('PRAGMA busy_timeout = 500')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function sqliteCandidates(filePath) {
  const normalizedPath = path.resolve(filePath)
  const [shared, standard] = vsCodeDatabasePaths()
  const paths = [filePath]
  if (normalizedPath === shared) paths.push(standard)
  if (normalizedPath === standard ||
      normalizedPath.includes(path.join('Code', 'User', 'globalStorage') + path.sep)) {
    paths.push(shared)
  }
  const existing = paths.filter(candidate => fs.existsSync(candidate))
  if (!existing.length) throw new Error(`文件不存在: ${filePath}`)
  return existing
}

function recentHistory(value) {
  const data = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(data?.entries) ? data : { entries: [] }
}

function readProjectsFromSQLite(dbPath) {
  for (const filePath of sqliteCandidates(dbPath)) {
    debugLog(`读取数据库: ${filePath}`)
    const db = openDatabase(filePath, true)
    try {
      const select = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
      for (const key of RECENT_KEYS) {
        const { entries } = recentHistory(select.get(key)?.value)
        const projects = parseEntries(entries)
        if (projects.length) return projects
      }
    } finally {
      db.close()
    }
  }
  return []
}

// ─── JSON 读取 ──

async function readProjectsFromJSON(jsonPath) {
  debugLog(`读取 JSON: ${jsonPath}`)
  const content = fs.readFileSync(jsonPath, 'utf-8')
  const data = JSON.parse(content)
  for (const key of RECENT_KEYS) {
    const { entries } = recentHistory(data?.[key])
    if (entries.length > 0) {
      debugLog(`JSON 命中 key=${key}, entries=${entries.length}`)
      return parseEntries(entries)
    }
  }
  debugLog('JSON 未找到项目记录')
  return []
}

// ─── XML 读取（JetBrains） ──

function jetBrainsProjectPath(value) {
  if (value === '$USER_HOME$') return homedir()
  if (/^\$USER_HOME\$[\\/]/.test(value)) {
    return path.join(homedir(), value.slice('$USER_HOME$/'.length))
  }
  if (/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(value)) return path.normalize(value)
  return ''
}

function projectName(filePath) {
  return /^[a-z]:[\\/]|^\\\\/i.test(filePath)
    ? path.win32.basename(filePath)
    : path.basename(filePath)
}

function readProjectsFromXML(xmlPath) {
  const parser = new SaxesParser()
  const stack = []
  const legacyPaths = new Set()
  const metadata = new Map()
  let project = null

  parser.on('opentag', tag => {
    const parent = stack.at(-1)
    const { name, key, value } = tag.attributes
    if (tag.name === 'entry' && parent?.name === 'map' &&
        stack.at(-2)?.attributes.name === 'additionalInfo' && key) {
      const filePath = jetBrainsProjectPath(key)
      if (filePath) {
        project = { depth: stack.length, filePath, label: '', activated: 0, opened: 0 }
        metadata.set(filePath, project)
      }
    } else if (tag.name === 'option' && value) {
      if (project) {
        if (name === 'projectName') project.label = value
        if (name === 'activationTimestamp') project.activated = Number(value) || 0
        if (name === 'projectOpenTimestamp') project.opened = Number(value) || 0
      } else if (!name && parent?.name === 'list' &&
                 ['recentPaths', 'openPaths'].includes(stack.at(-2)?.attributes.name)) {
        const filePath = jetBrainsProjectPath(value)
        if (filePath) legacyPaths.add(filePath)
      }
    }
    stack.push(tag)
  })

  parser.on('closetag', () => {
    stack.pop()
    if (project?.depth === stack.length) project = null
  })

  parser.write(fs.readFileSync(xmlPath, 'utf8')).close()
  const byRecency = Array.from(metadata.values())
    .sort((a, b) => (b.activated || b.opened) - (a.activated || a.opened))
  const paths = new Set([...legacyPaths, ...byRecency.map(item => item.filePath)])
  return Array.from(paths, filePath => {
    const label = metadata.get(filePath)?.label || ''
    return {
      name: label || projectName(filePath) || filePath,
      path: filePath,
      uri: filePath,
      type: 'folder',
      label
    }
  })
}

// ─── 统一解析 ──

function recentUri(entry) {
  const uri = typeof entry === 'string'
    ? entry
    : entry?.folderUri || entry?.fileUri || entry?.workspace?.configPath
  return typeof uri === 'string' ? uri : ''
}

function parseEntries(entries) {
  const projects = []
  for (const entry of entries) {
    const uri = recentUri(entry)
    if (!uri) continue
    const remote = /^[a-z]+-remote:\/\//.test(uri)
    const localPath = remote ? '' : uriToPath(uri)
    const label = typeof entry.label === 'string' ? entry.label : ''
    const name = label || projectName(localPath || safeDecodeURIComponent(uri)) || '未命名'
    const type = remote ? 'remote' : uri.endsWith('.code-workspace') ? 'workspace'
      : entry.fileUri && !entry.folderUri ? 'file' : 'folder'
    projects.push({ name, path: localPath, uri, type, label })
  }
  return projects
}

function safeDecodeURIComponent(str) {
  try {
    return decodeURIComponent(str)
  } catch {
    return str
  }
}

function uriToPath(uri) {
  try {
    if (uri.startsWith('file://')) return fileURLToPath(uri)
    if (path.isAbsolute(uri) || path.win32.isAbsolute(uri)) return uri
    return decodeURIComponent(new URL(uri).pathname)
  } catch {
    return uri
  }
}

// ─── 主入口 ──

async function readProjects(filePath) {
  debugLog(`readProjects 入口: ${filePath}`)
  const resolvedPath = resolveGlobPath(filePath)
  if (canDeleteProjects(resolvedPath)) return readProjectsFromSQLite(resolvedPath)
  if (!fs.existsSync(resolvedPath)) throw new Error(`文件不存在: ${resolvedPath}`)

  const ext = path.extname(resolvedPath).toLowerCase()
  if (ext === '.json') {
    const items = await readProjectsFromJSON(resolvedPath)
    debugLog(`JSON 解析结果: ${items.length} 个项目`)
    return items
  }
  if (ext === '.xml') {
    const items = readProjectsFromXML(resolvedPath)
    debugLog(`XML 解析结果: ${items.length} 个项目`)
    return items
  }
  try {
    const items = await readProjectsFromSQLite(resolvedPath)
    debugLog(`自动探测 SQLite 结果: ${items.length} 个项目`)
    return items
  } catch {
    const items = await readProjectsFromJSON(resolvedPath)
    debugLog(`自动探测 JSON 结果: ${items.length} 个项目`)
    return items
  }
}

// ─── 删除项目记录 ──

async function deleteProject(dbPath, uri) {
  const resolvedPath = resolveGlobPath(dbPath)
  if (!canDeleteProjects(resolvedPath)) throw new Error('该历史格式不支持删除')

  for (const filePath of sqliteCandidates(resolvedPath)) {
    const db = openDatabase(filePath, false)
    try {
      // 先获取写锁，再读取最新历史，防止覆盖编辑器同时提交的记录。
      db.exec('BEGIN IMMEDIATE')
      const select = db.prepare('SELECT value FROM ItemTable WHERE key = ?')
      for (const key of RECENT_KEYS) {
        const data = recentHistory(select.get(key)?.value)
        const entries = data.entries.filter(entry => recentUri(entry) !== uri)
        if (entries.length === data.entries.length) continue

        db.prepare('UPDATE ItemTable SET value = ? WHERE key = ?')
          .run(JSON.stringify({ ...data, entries }), key)
        db.exec('COMMIT')
        return
      }
      db.exec('ROLLBACK')
    } finally {
      db.close()
    }
  }
  throw new Error('未找到匹配的记录')
}

// ─── IDE 配置管理 ──

const STORAGE_KEY = 'ide-ides'
const LEGACY_STORAGE_KEY = 'vsc-ides'

function getIDEs() {
  try {
    const data = window.ztools.dbStorage.getItem(STORAGE_KEY)
    if (Array.isArray(data)) {
      debugLog(`getIDEs 从新 key 读取: ${data.length} 个`)
      return data
    }
    const legacy = window.ztools.dbStorage.getItem(LEGACY_STORAGE_KEY)
    if (Array.isArray(legacy) && legacy.length > 0) {
      debugLog(`getIDEs 从旧 key 迁移: ${legacy.length} 个`)
      window.ztools.dbStorage.setItem(STORAGE_KEY, legacy)
      return legacy
    }
    debugLog('getIDEs 未找到配置')
    return []
  } catch (e) {
    debugLog(`getIDEs 异常: ${e}`)
    return []
  }
}

function saveIDEs(ides) {
  debugLog(`saveIDEs: ${ides.length} 个`)
  window.ztools.dbStorage.setItem(STORAGE_KEY, ides)
}

// ─── 打开项目 ──

const defaultShell = process.platform === 'darwin' ? 'zsh -l -i -c' : process.platform === 'linux' ? 'bash -l -i -c' : ''

// 转义 shell 特殊字符，防止命令注入
function escapeShellArg(arg) {
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}

const runShell = promisify(exec)
const runFile = promisify(execFile)
const launchOptions = { windowsHide: true, timeout: 10000 }

const macEditorBundles = new Map([
  ['code', 'com.microsoft.VSCode'],
  ['idea', 'com.jetbrains.intellij']
])

async function openRemoteVSCodeOnMac(args) {

  // 远程 URI 需要交给 VS Code 的 CLI，macOS open 无法把启动参数传给已运行的实例。
  const cli = ['/Applications', path.join(homedir(), 'Applications')]
    .map(dir => path.join(dir, 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'))
    .find(filePath => fs.existsSync(filePath))

  if (!cli) throw new Error('未找到 VS Code 内置命令。请在 VS Code 中将 code 安装到 PATH 后再打开远程项目。')
  await runFile(cli, args, launchOptions)
}

async function openProject(command, uri, shell) {
  const effectiveShell = shell || defaultShell
  const isRemote = /^[a-z]+-remote:\/\//.test(uri)
  const args = isRemote ? [uri.endsWith('.code-workspace') ? '--file-uri' : '--folder-uri', uri] : [uriToPath(uri)]
  const cmd = [command, ...args.slice(0, -1), escapeShellArg(args.at(-1))].join(' ')
  const fullCmd = effectiveShell ? `${effectiveShell} ${escapeShellArg(cmd)}` : cmd
  debugLog(`执行: ${fullCmd}`)

  try {
    try {
      await runShell(fullCmd, launchOptions)
    } catch (error) {
      const launcher = command.trim()
      const bundleId = macEditorBundles.get(launcher)
      if (process.platform !== 'darwin' || error.code !== 127 || !bundleId) throw error

      if (isRemote) {
        if (launcher !== 'code') throw error
        await openRemoteVSCodeOnMac(args)
      } else {
        debugLog(`未找到 ${launcher} 命令，通过 macOS 打开 ${bundleId}`)
        await runFile('/usr/bin/open', ['-b', bundleId, '--', path.resolve(args[0])], launchOptions)
      }
    }
  } catch (error) {
    debugLog(`命令失败: ${error.message}`)
    throw new Error(`启动失败: ${error.stderr?.trim() || error.message}`)
  }
}

// ─── 预设 ──

const jetBrainsDir = () => {
  const home = homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'JetBrains')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || home, 'JetBrains')
  return path.join(home, '.config', 'JetBrains')
}

function vsCodeDatabasePaths() {
  return [
    path.join(homedir(), '.vscode-shared', 'sharedStorage', 'state.vscdb'),
    path.join(window.ztools.getPath('appData'), 'Code', 'User', 'globalStorage', 'state.vscdb')
  ]
}

function getPresets() {
  const appData = window.ztools.getPath('appData')
  const jbDir = jetBrainsDir()
  return {
    vscode: {
      name: 'VS Code',
      command: 'code',
      dbPaths: [
        ...vsCodeDatabasePaths(),
        path.join(appData, 'Code', 'storage.json')
      ]
    },
    cursor: {
      name: 'Cursor',
      command: 'cursor',
      dbPaths: [
        path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
        path.join(appData, 'Cursor', 'storage.json')
      ]
    },
    vscodium: {
      name: 'VSCodium',
      command: 'codium',
      dbPaths: [
        path.join(appData, 'VSCodium', 'User', 'globalStorage', 'state.vscdb'),
        path.join(appData, 'VSCodium', 'storage.json')
      ]
    },
    idea: {
      name: 'IntelliJ IDEA',
      command: 'idea',
      dbPaths: [path.join(jbDir, 'IntelliJIdea*', 'options', 'recentProjects.xml')]
    },
    pycharm: {
      name: 'PyCharm',
      command: 'pycharm',
      dbPaths: [path.join(jbDir, 'PyCharm*', 'options', 'recentProjects.xml')]
    },
    webstorm: {
      name: 'WebStorm',
      command: 'webstorm',
      dbPaths: [path.join(jbDir, 'WebStorm*', 'options', 'recentProjects.xml')]
    },
    goland: {
      name: 'GoLand',
      command: 'goland',
      dbPaths: [path.join(jbDir, 'GoLand*', 'options', 'recentProjects.xml')]
    },
    qoder: {
      name: 'Qoder',
      command: 'qoder',
      dbPaths: [
        path.join(appData, 'Qoder', 'User', 'globalStorage', 'state.vscdb'),
        path.join(appData, 'Qoder', 'storage.json'),
        path.join(appData, 'Qoder', 'User', 'globalStorage', 'storage.json')
      ]
    }
  }
}

function getQuickFillPresets() {
  const aliases = { vscode: 'vsc', vscodium: 'codium' }
  return Object.entries(getPresets()).map(([key, preset]) => ({
    code: aliases[key] || key,
    name: preset.name,
    command: preset.command,
    dbPath: preset.dbPaths.find(p => fs.existsSync(resolveGlobPath(p))) || preset.dbPaths[0],
    shell: defaultShell
  }))
}

function detectPresetPaths() {
  const presets = getPresets()
  const result = {}
  for (const [key, preset] of Object.entries(presets)) {
    debugLog(`detectPresetPaths ${key}: 尝试 ${preset.dbPaths.length} 个路径`)
    for (const p of preset.dbPaths) {
      const resolved = resolveGlobPath(p)
      const exists = fs.existsSync(resolved)
      debugLog(`  ${exists ? '✓' : '✗'} ${resolved}`)
      if (exists) {
        result[key] = resolved
        break
      }
    }
  }
  debugLog('detectPresetPaths 结果:', result)
  return result
}

// ─── 动态 Feature 注册 ──

const REG_CODES_KEY = 'ide-registered-codes'

function registerFeatures() {
  const ides = getIDEs().filter(ide => ide?.code && ide.code.toLowerCase() !== 'ideopen')
  const currentCodes = ides.map(ide => ide.code)
  debugLog(`registerFeatures: current=${currentCodes.join(',') || '(none)'}`)
  const prevCodes = window.ztools.dbStorage.getItem(REG_CODES_KEY) || []

  for (const ide of ides) {
    try {
      window.ztools.setFeature({
        code: ide.code,
        explain: `打开 ${ide.name || ide.code} 最近项目`,
        cmds: [ide.code],
        icon: 'logo.png'
      })
      debugLog(`✅ 注册 feature: ${ide.code}`)
    } catch (e) {
      debugLog(`❌ 注册 ${ide.code} 失败: ${e}`)
    }
  }

  for (const oldCode of prevCodes) {
    if (!currentCodes.includes(oldCode)) {
      try {
        window.ztools.removeFeature(oldCode)
        debugLog(`🗑 删除旧 feature: ${oldCode}`)
      } catch (e) {
        debugLog(`❌ 删除 feature ${oldCode} 失败: ${e}`)
      }
    }
  }

  window.ztools.dbStorage.setItem(REG_CODES_KEY, currentCodes)
}

// ─── 启动时注册所有已保存 IDE 的动态指令 ──

registerFeatures()

// ─── 暴露给渲染进程 ──

window.services = {
  readProjects,
  openProject,
  deleteProject,
  canDeleteProjects,
  getIDEs,
  saveIDEs,
  registerFeatures,
  getPresets,
  getQuickFillPresets,
  detectPresetPaths,
  getAppDataPath: () => window.ztools.getPath('appData'),
  getDefaultShell: () => defaultShell,
  debugLog,
  getLogFile
}
