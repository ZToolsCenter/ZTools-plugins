const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')

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

// ─── sql.js 原生加载 ──

const WASM_DIR = path.join(__dirname, 'node_modules', 'sql.js', 'dist')

let _SQL = null
async function getSQL() {
  if (!_SQL) {
    debugLog('初始化 SQL.js...')
    const sqlJsCode = fs.readFileSync(path.join(WASM_DIR, 'sql-wasm.js'), 'utf-8')
    const initSqlJs = new Function(
      'require', 'module', 'exports',
      sqlJsCode + '\nreturn module.exports;'
    )(require, { exports: {} }, {}).default || require
    const wasmBinary = fs.readFileSync(path.join(WASM_DIR, 'sql-wasm.wasm'))
    _SQL = await initSqlJs({ wasmBinary })
    debugLog('SQL.js 初始化完成')
  }
  return _SQL
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
    const entries = fs.readdirSync(dir)
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

async function readProjectsFromSQLite(dbPath) {
  const SQL = await getSQL()
  const resolvedPath = resolveGlobPath(dbPath)
  const candidates = [resolvedPath]
  // VSCode 共享存储 fallback
  const home = process.env.HOME || process.env.USERPROFILE
  if (home && resolvedPath.includes(path.join('Code', 'User', 'globalStorage'))) {
    const shared = path.join(home, '.vscode-shared', 'sharedStorage', 'state.vscdb')
    if (fs.existsSync(shared) && !candidates.includes(shared)) candidates.push(shared)
  }

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      debugLog(`数据库不存在: ${filePath}`)
      continue
    }
    debugLog(`读取数据库: ${filePath}`)
    const buffer = fs.readFileSync(filePath)
    const db = new SQL.Database(buffer)
    try {
      for (const key of RECENT_KEYS) {
        const results = db.exec(`SELECT value FROM ItemTable WHERE key = '${key}'`)
        if (results.length > 0 && results[0].values.length > 0) {
          const value = results[0].values[0][0]
          const data = JSON.parse(value)
          const entries = data.entries || []
          debugLog(`命中 key=${key}, entries=${entries.length}`)
          if (entries.length > 0) return parseEntries(entries)
        }
      }
    } finally {
      db.close()
    }
  }
  debugLog('未找到项目记录')
  return []
}

// ─── JSON 读取 ──

async function readProjectsFromJSON(jsonPath) {
  debugLog(`读取 JSON: ${jsonPath}`)
  const content = fs.readFileSync(jsonPath, 'utf-8')
  const data = JSON.parse(content)
  for (const key of RECENT_KEYS) {
    const entries = data?.[key]?.entries || []
    if (entries.length > 0) {
      debugLog(`JSON 命中 key=${key}, entries=${entries.length}`)
      return parseEntries(entries)
    }
  }
  debugLog('JSON 未找到项目记录')
  return []
}

// ─── XML 读取（JetBrains） ──

function readProjectsFromXML(xmlPath) {
  const resolvedPath = resolveGlobPath(xmlPath)
  if (!fs.existsSync(resolvedPath)) return []
  const content = fs.readFileSync(resolvedPath, 'utf-8')

  const pathRe = /<option\s+value="([^"]+)"\s*\/>/g
  const paths = []
  let m
  while ((m = pathRe.exec(content)) !== null) {
    const v = m[1]
    if (v.startsWith('/') || v.match(/^[A-Z]:\\/)) paths.push(v)
  }

  const nameByPath = {}
  const entryRe = /<entry\s+key="([^"]+)"[^>]*>[\s\S]*?<option\s+name="projectName"\s+value="([^"]+)"\s*\/>[\s\S]*?<\/entry>/g
  let n
  while ((n = entryRe.exec(content)) !== null) {
    nameByPath[n[1]] = n[2]
  }

  return paths.map(p => ({
    name: nameByPath[p] || path.basename(p),
    path: p,
    uri: p,
    type: 'folder',
    label: nameByPath[p] || ''
  }))
}

// ─── 统一解析 ──

function parseEntries(entries) {
  debugLog(`parseEntries 输入: ${entries.length} 条`)
  const result = entries
    .map(e => {
      if (e == null) return null
      if (typeof e === 'string') {
        if (!e) return null
        const isRemote = /^[a-z]+-remote:\/\//.test(e)
        const isWorkspace = e.endsWith('.code-workspace')
        const localPath = isRemote ? '' : uriToPath(e)
        return {
          name: path.basename(decodeURIComponent(e).replace(/^file:\/\//, '').replace(/^[a-z]+-remote:\/\//, '')) || '未命名',
          path: localPath,
          uri: e,
          type: isRemote ? 'remote' : isWorkspace ? 'workspace' : 'folder',
          label: ''
        }
      }
      const uri = e.folderUri || e.fileUri || e.workspace?.configPath || ''
      if (!uri) return null
      const decoded = decodeURIComponent(uri)
      const name = path.basename(
        decoded.replace(/^file:\/\//, '').replace(/^[a-z]+-remote:\/\//, '')
      )
      const isRemote = /^[a-z]+-remote:\/\//.test(uri)
      const isWorkspace = uri.endsWith('.code-workspace')
      const isFile = !!e.fileUri && !e.folderUri
      const localPath = isRemote ? '' : uriToPath(uri)
      return {
        name: e.label || name || '未命名',
        path: localPath,
        uri,
        type: isRemote ? 'remote' : isWorkspace ? 'workspace' : isFile ? 'file' : 'folder',
        label: e.label || ''
      }
    })
    .filter(Boolean)
  debugLog(`parseEntries 输出: ${result.length} 条`)
  return result
}

function uriToPath(uri) {
  try {
    const url = new URL(uri)
    return decodeURIComponent(url.pathname)
  } catch {
    return uri
  }
}

// ─── 主入口 ──

async function readProjects(filePath) {
  debugLog(`readProjects 入口: ${filePath}`)
  const resolvedPath = resolveGlobPath(filePath)
  if (!fs.existsSync(resolvedPath)) {
    debugLog(`文件不存在: ${resolvedPath}`)
    throw new Error(`文件不存在: ${resolvedPath}`)
  }
  const ext = path.extname(resolvedPath).toLowerCase()
  debugLog(`文件扩展名: ${ext}`)
  if (ext === '.vscdb' || ext === '.db') {
    const items = await readProjectsFromSQLite(resolvedPath)
    debugLog(`SQLite 解析结果: ${items.length} 个项目`)
    return items
  }
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
  const candidates = [resolvedPath]
  const home = process.env.HOME || process.env.USERPROFILE
  if (home && resolvedPath.includes(path.join('Code', 'User', 'globalStorage'))) {
    const shared = path.join(home, '.vscode-shared', 'sharedStorage', 'state.vscdb')
    if (fs.existsSync(shared) && !candidates.includes(shared)) candidates.push(shared)
  }

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.vscdb' && ext !== '.db') continue

    const SQL = await getSQL()
    const buffer = fs.readFileSync(filePath)
    const db = new SQL.Database(buffer)

    try {
      for (const key of RECENT_KEYS) {
        const results = db.exec(`SELECT value FROM ItemTable WHERE key = '${key}'`)
        if (results.length === 0 || results[0].values.length === 0) continue

        const value = results[0].values[0][0]
        const data = JSON.parse(value)
        const entries = data.entries || []
        const before = entries.length
        data.entries = entries.filter(e => {
          if (typeof e === 'string') return e !== uri
          const ep = e.folderUri || e.fileUri || e.workspace?.configPath
          return ep !== uri
        })
        if (data.entries.length === before) continue

        const updated = JSON.stringify(data)
        db.run(`UPDATE ItemTable SET value = ? WHERE key = '${key}'`, [updated])
        const out = db.export()
        fs.writeFileSync(filePath, Buffer.from(out))
        return
      }
    } finally {
      db.close()
    }
  }
  throw new Error('未找到匹配的记录或数据库不支持删除')
}

// ─── IDE 配置管理 ──

const STORAGE_KEY = 'ide-ides'
const LEGACY_STORAGE_KEY = 'vsc-ides'

function getIDEs() {
  try {
    const data = window.ztools.dbStorage.getItem(STORAGE_KEY)
    if (Array.isArray(data) && data.length > 0) {
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

function openProject(command, uri, shell) {
  const effectiveShell = shell || defaultShell
  const isRemote = /^[a-z]+-remote:\/\//.test(uri)
  const localPath = isRemote ? '' : uriToPath(uri)

  const run = (cmd, timeout = 10000) => new Promise((resolve, reject) => {
    const fullCmd = effectiveShell ? `${effectiveShell} '${cmd}'` : cmd
    debugLog(`执行: ${fullCmd}`)
    exec(fullCmd, { env: process.env, windowsHide: true, timeout }, (err) => {
      if (err) {
        debugLog(`命令失败: ${err.message}`)
        reject(err)
      } else resolve()
    })
  })

  return new Promise((resolve, reject) => {
    if (localPath) {
      run(`${command} "${localPath}"`)
        .then(() => resolve())
        .catch(err => reject(new Error(`启动失败: ${err.message}`)))
      return
    }
    const isWorkspace = uri.endsWith('.code-workspace')
    const flag = isWorkspace ? '--file-uri' : '--folder-uri'
    run(`${command} ${flag} "${uri}"`)
      .then(() => resolve())
      .catch(err => reject(new Error(`启动失败: ${err.message}`)))
  })
}

// ─── 预设 ──

const homeDir = () => process.env.HOME || process.env.USERPROFILE || ''
const jetBrainsDir = () => {
  const home = homeDir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'JetBrains')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || home, 'JetBrains')
  return path.join(home, '.config', 'JetBrains')
}

function getPresets() {
  const appData = window.ztools.getPath('appData')
  const jbDir = jetBrainsDir()
  const home = homeDir()
  return {
    vscode: {
      name: 'VSCode',
      command: 'code',
      dbPaths: [
        path.join(home, '.vscode-shared', 'sharedStorage', 'state.vscdb'),
        path.join(appData, 'Code', 'User', 'globalStorage', 'state.vscdb'),
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
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const appData = window.ztools.getPath('appData')
  const jbDir = jetBrainsDir()
  const vscDbPath = home
    ? path.join(home, '.vscode-shared', 'sharedStorage', 'state.vscdb')
    : path.join(appData, 'Code', 'User', 'globalStorage', 'state.vscdb')
  return [
    { code: 'vsc', name: 'VS Code', command: 'code', dbPath: vscDbPath, shell: defaultShell },
    { code: 'cursor', name: 'Cursor', command: 'cursor', dbPath: path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb'), shell: defaultShell },
    { code: 'codium', name: 'VSCodium', command: 'codium', dbPath: path.join(appData, 'VSCodium', 'User', 'globalStorage', 'state.vscdb'), shell: defaultShell },
    { code: 'idea', name: 'IntelliJ IDEA', command: 'idea', dbPath: path.join(jbDir, 'IntelliJIdea*', 'options', 'recentProjects.xml'), shell: defaultShell },
    { code: 'pycharm', name: 'PyCharm', command: 'pycharm', dbPath: path.join(jbDir, 'PyCharm*', 'options', 'recentProjects.xml'), shell: defaultShell },
    { code: 'webstorm', name: 'WebStorm', command: 'webstorm', dbPath: path.join(jbDir, 'WebStorm*', 'options', 'recentProjects.xml'), shell: defaultShell },
    { code: 'goland', name: 'GoLand', command: 'goland', dbPath: path.join(jbDir, 'GoLand*', 'options', 'recentProjects.xml'), shell: defaultShell },
    { code: 'qoder', name: 'Qoder', command: 'qoder', dbPath: path.join(appData, 'Qoder', 'User', 'globalStorage', 'state.vscdb'), shell: defaultShell }
  ]
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
  const ides = getIDEs()
  const currentCodes = ides.filter(i => i.code).map(i => i.code)
  debugLog(`registerFeatures: current=${currentCodes.join(',') || '(none)'}`)
  const prevCodes = window.ztools.dbStorage.getItem(REG_CODES_KEY) || []

  for (const ide of ides) {
    if (!ide.code) continue
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
