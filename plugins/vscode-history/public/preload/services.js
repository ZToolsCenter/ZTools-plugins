const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { URL } = require('url')

console.log('[services] preload loaded')

// ==================== 路径处理工具函数 ====================

/**
 * 检测是否为 Windows 路径（如 C:\xxx 或 C:/xxx）
 */
function isWindowsPath(p) {
  return typeof p === 'string' && /^[A-Za-z]:[\\/]/.test(p)
}

/**
 * 将 file:// URI 转换为本地文件系统路径（跨平台兼容）
 * 使用 Node.js 内置 url.URL API 解析 URI
 */
function uriToFileSystemPath(uri) {
  if (!uri || typeof uri !== 'string') return uri

  // 处理 file:// URI（VSCode 存储的格式）
  const match = uri.match(/^file:\/\/\/(.+)$/i)
  if (match) {
    let rest = match[1]

    // 移除开头的 /（如果有的话）
    if (rest.startsWith('/')) rest = rest.slice(1)

    // 检测是否有 Windows 盘符（C: 或 C%3A）
    // Windows 路径不能被 url.URL 正确解析（会把 C: 当 hostname）
    const hasDriveLetter = /^[A-Za-z](%3[Aa]|:)/i.test(rest)
    if (hasDriveLetter) {
      const driveMatch = rest.match(/^([A-Za-z])(%3[Aa]|:)/i)
      let drive = driveMatch[1].toUpperCase()
      let pathPart = rest.slice(driveMatch[0].length)
      // 移除 pathPart 开头的 /
      if (pathPart.startsWith('/')) pathPart = pathPart.slice(1)
      // 先尝试标准 decodeURIComponent（UTF-8 编码）
      let decoded
      try { decoded = decodeURIComponent(pathPart) } catch { decoded = pathPart }
      // 如果解码结果仍包含 UTF-16 编码，尝试 UTF-16 解码
      if (decoded !== pathPart && /%[0-9A-Fa-f]{2}/.test(decoded)) {
        decoded = decodeUTF16Component(decoded)
      }
      // Windows 路径始终使用反斜杠
      return drive + ':' + decoded.replace(/\//g, '\\')
    }

    // 没有盘符（Mac/Linux 路径如 /Users/xxx）
    // 使用 url.URL 标准 API 解析非 Windows file:// URI
    try {
      const fileUrl = new URL(`file:///${rest}`)
      return fileUrl.pathname
    } catch (err) {
      console.warn('[services] Failed to parse URI with URL:', uri, err.message)
    }

    // fallback
    try { return decodeURIComponent(rest) } catch { return rest }
  }

  // 非 file:// URI
  if (uri.includes('/')) {
    try { return decodeURIComponent(uri) } catch { return uri }
  }
  return uri
}

/**
 * 将本地路径转换为 file:// URI（跨平台兼容）
 * 使用 Node.js 内置 path 模块处理路径
 */
function osPathToURI(osPath) {
  if (!osPath || typeof osPath !== 'string') return osPath

  // 使用 path.posix.normalize 统一处理路径分隔符
  const normalized = path.posix.normalize(osPath.replace(/\\/g, '/'))

  // 检测 Windows 路径（如 E:\xxx 或 E:/xxx）
  const isWin = isWindowsPath(osPath)

  if (isWin) {
    // Windows 路径需要特殊处理：
    // 1. 驱动器字母需要编码为 %XX（避免被解析为 host）
    // 2. 使用 file:/// 前缀（三个斜杠）
    const drive = osPath[0].toUpperCase()
    const encodedDrive = '%' + drive.charCodeAt(0).toString(16).toUpperCase()
    const rest = osPath.slice(2) // 移除 "E:"
    // 对路径部分进行 URI 编码
    const encodedPath = encodeURIComponent(rest).replace(/%2[fF]/g, '/')
    return 'file:///'+ encodedDrive + '/' + encodedPath
  }

  // 非 Windows 路径
  const encodedPath = encodeURIComponent(normalized).replace(/%2[fF]/g, '/')
  // 始终使用 file:///（三个斜杠）作为前缀
  return 'file://' + encodedPath
}

/**
 * 将 UTF-16 编码的 URI 组件解码为 Unicode 字符串
 * VS Code state.vscdb 使用 UTF-16 编码存储路径（如 %6D%4B 表示 U+6D4B）
 */
function decodeUTF16Component(str) {
  if (!str) return str
  // 检查是否包含 UTF-16 编码模式（两个连续的 %XX%XX）
  const utf16Pattern = /%([0-9A-Fa-f]{2})%([0-9A-Fa-f]{2})/g
  try {
    return str.replace(utf16Pattern, (_, highByte, lowByte) => {
      const codePoint = (parseInt(highByte, 16) << 8) | parseInt(lowByte, 16)
      return String.fromCharCode(codePoint)
    })
  } catch {
    return str
  }
}

window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },

  /**
   * 将 file:// URI 转换为本地文件系统路径（跨平台兼容）
   * 使用 Node.js url.URL 标准 API
   */
  _uriToFileSystemPath(uri) {
    return uriToFileSystemPath(uri)
  },

  /**
   * 将 file:// URI 转换为当前操作系统的标准路径格式
   * 用于复制到剪贴板，路径分隔符符合当前 OS 规范
   */
  _uriToOSPath(uri) {
    if (!uri || typeof uri !== 'string') return uri
    // 复用 uriToFileSystemPath 并转换为 OS 路径格式
    const systemPath = uriToFileSystemPath(uri)
    // Windows 路径保持反斜杠，其他平台路径保持正斜杠
    if (isWindowsPath(systemPath)) return systemPath
    return systemPath.split('/').join(path.sep)
  },

  /**
   * 将 UTF-16 编码的 URI 组件解码为 Unicode 字符串
   * VS Code state.vscdb 使用 UTF-16 编码存储路径（如 %6D%4B 表示 U+6D4B）
   */
  _decodeUTF16Component(str) {
    return decodeUTF16Component(str)
  },

  /**
   * 将 file:// URI 解码为本地文件系统路径（跨平台兼容）
   * 处理 %3A 等 URL 编码，以及 VS Code 的 UTF-16 编码
   */
  _decodeURIPath(uri) {
    if (!uri || typeof uri !== 'string') return uri

    // 检测是否为 Windows 路径
    const isWin = isWindowsPath(uri)
    const sep = isWin ? '\\' : '/'

    // 处理 file:// URI
    const match = uri.match(/^file:\/\/\/(.+)$/i)
    if (match) {
      let rest = match[1]
      if (rest.startsWith('/')) rest = rest.slice(1)

      const driveMatch = rest.match(/^([A-Za-z])(%3[Aa]|:)/i)
      if (driveMatch) {
        let drive = driveMatch[1].toUpperCase()
        let pathPart = rest.slice(driveMatch[0].length)
        if (pathPart.startsWith('/')) pathPart = pathPart.slice(1)
        // 先尝试标准 decodeURIComponent（UTF-8 编码）
        let decoded
        try { decoded = decodeURIComponent(pathPart) } catch { decoded = pathPart }
        // 如果解码结果仍包含编码，尝试 UTF-16 解码
        if (decoded !== pathPart && /%[0-9A-Fa-f]{2}/.test(decoded)) {
          decoded = this._decodeUTF16Component(decoded)
        }
        return drive + ':' + decoded.replace(/\//g, sep)
      }

      // 先尝试标准 decodeURIComponent（UTF-8 编码）
      let decoded
      try { decoded = decodeURIComponent(rest) } catch { decoded = rest }
      // 如果解码结果仍包含编码，尝试 UTF-16 解码
      if (decoded !== rest && /%[0-9A-Fa-f]{2}/.test(decoded)) {
        decoded = this._decodeUTF16Component(decoded)
      }
      return decoded.replace(/\//g, sep)
    }

    if (uri.includes('/')) {
      // 先尝试标准 decodeURIComponent（UTF-8 编码）
      let decoded
      try { decoded = decodeURIComponent(uri) } catch { decoded = uri }
      // 如果解码结果仍包含编码，尝试 UTF-16 解码
      if (decoded !== uri && /%[0-9A-Fa-f]{2}/.test(decoded)) {
        decoded = this._decodeUTF16Component(decoded)
      }
      return decoded.replace(/\//g, sep)
    }
    return uri
  },

  /**
   * 将本地路径转换为 file:// URI（跨平台兼容）
   * 处理路径编码，支持 UTF-8 多字节字符（如中文）
   * 始终使用 file:/// 前缀避免 URI 解析为 host
   */
  _osPathToURI(osPath) {
    return osPathToURI(osPath)
  },

  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matchs[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },

  // ==================== VSCode DB 操作 ====================

  /**
   * 获取 VSCode 历史项目列表
   * @param {string} dbPath - state.vscdb 数据库路径
   * @returns {Promise<string[]>} 项目路径数组
   */
  async getVSCodeHistory(dbPath) {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`数据库文件不存在: ${dbPath}`)
    }
    console.log('[services] getVSCodeHistory start, dbPath:', dbPath)
    const SQL = await this._initSQL()
    const db = new SQL.Database(fs.readFileSync(dbPath))
    const results = db.exec(
      "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'"
    )
    db.close()

    if (!results || !results[0] || !results[0].values[0]) {
      throw new Error('未找到历史记录数据')
    }

    const data = JSON.parse(results[0].values[0].toString())
    console.log('[services] raw entries count:', data.entries?.length || 0)

    const paths = data.entries.map((entry) => {
      if (typeof entry === 'string') return entry
      return entry.fileUri || entry.folderUri || entry.workspace?.configPath || ''
    }).filter(Boolean)

    console.log('[services] extracted paths count:', paths.length)

    // 只保留文件夹路径
    const kept = []
    for (const p of paths) {
      const fsPath = this._uriToFileSystemPath(p)
      let exists = false
      try {
        exists = fs.existsSync(fsPath) && fs.statSync(fsPath).isDirectory()
      } catch {
        exists = false
      }
      // console.log('[services] path:', p, '-> fsPath:', fsPath, 'existsDir:', exists)
      if (exists) kept.push(p)
    }

    console.log('[services] final kept folders count:', kept.length)
    return kept
  },

  /**
   * 删除单个 VSCode 历史记录
   * @param {string} dbPath - state.vscdb 数据库路径
   * @param {string} targetPath - 要删除的项目路径
   * @returns {Promise<boolean>} 是否删除成功
   */
  async deleteVSCodeHistory(dbPath, targetPath) {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`数据库文件不存在: ${dbPath}`)
    }
    const SQL = await this._initSQL()
    const db = new SQL.Database(fs.readFileSync(dbPath))

    const results = db.exec(
      "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'"
    )
    if (!results || !results[0] || !results[0].values[0]) {
      db.close()
      return false
    }

    const data = JSON.parse(results[0].values[0].toString())
    const normalizedTarget = this._uriToFileSystemPath(targetPath)
    const originalLength = data.entries.length
    data.entries = data.entries.filter((entry) => {
      if (typeof entry === 'string') return entry !== normalizedTarget
      const entryPath = entry.fileUri || entry.folderUri || entry.workspace?.configPath
      return this._uriToFileSystemPath(entryPath) !== normalizedTarget
    })

    if (data.entries.length === originalLength) {
      db.close()
      return false
    }

    const updatedJson = JSON.stringify(data)
    db.run(
      "UPDATE ItemTable SET value = ? WHERE key = 'history.recentlyOpenedPathsList'",
      [updatedJson]
    )

    // 原子写入：先备份，再写临时文件，最后重命名
    const backupPath = dbPath + '.bak'
    try {
      fs.copyFileSync(dbPath, backupPath)
      const tmpPath = dbPath + '.tmp'
      fs.writeFileSync(tmpPath, db.export())
      fs.renameSync(tmpPath, dbPath)
    } catch (err) {
      // 写入失败时恢复备份
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, dbPath)
        fs.unlinkSync(backupPath)
      }
      throw err
    } finally {
      db.close()
      // 清理备份文件
      try { fs.unlinkSync(backupPath) } catch {}
    }
    return true
  },

  /**
   * 批量删除 VSCode 历史记录
   * @param {string} dbPath - state.vscdb 数据库路径
   * @param {string[]} targetPaths - 要删除的项目路径数组
   * @returns {Promise<number>} 删除成功的记录数
   */
  async deleteMultipleVSCodeHistory(dbPath, targetPaths) {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`数据库文件不存在: ${dbPath}`)
    }
    const SQL = await this._initSQL()
    const db = new SQL.Database(fs.readFileSync(dbPath))

    const results = db.exec(
      "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'"
    )
    if (!results || !results[0] || !results[0].values[0]) {
      db.close()
      return 0
    }

    const data = JSON.parse(results[0].values[0].toString())
    const normalizedTargets = targetPaths.map((p) => this._uriToFileSystemPath(p))
    const originalLength = data.entries.length
    data.entries = data.entries.filter((entry) => {
      if (typeof entry === 'string') return !normalizedTargets.includes(entry)
      const entryPath = entry.fileUri || entry.folderUri || entry.workspace?.configPath
      return !normalizedTargets.includes(this._uriToFileSystemPath(entryPath))
    })

    const deletedCount = originalLength - data.entries.length
    if (deletedCount > 0) {
      const updatedJson = JSON.stringify(data)
      db.run(
        "UPDATE ItemTable SET value = ? WHERE key = 'history.recentlyOpenedPathsList'",
        [updatedJson]
      )

      // 原子写入：先备份，再写临时文件，最后重命名
      const backupPath = dbPath + '.bak'
      try {
        fs.copyFileSync(dbPath, backupPath)
        const tmpPath = dbPath + '.tmp'
        fs.writeFileSync(tmpPath, db.export())
        fs.renameSync(tmpPath, dbPath)
      } catch (err) {
        // 写入失败时恢复备份
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, dbPath)
          fs.unlinkSync(backupPath)
        }
        throw err
      } finally {
        db.close()
        // 清理备份文件
        try { fs.unlinkSync(backupPath) } catch {}
      }
    } else {
      db.close()
    }
    return deletedCount
  },

  /**
   * 获取所有 IDE 配置
   * @returns {object[]} IDE 配置列表
   */
  getAllIDEConfigs() {
    const keys = window.services.getAllDbStorageKeys()
    const configs = []
    for (const key of keys) {
      if (key.startsWith('vscode_plugin.')) {
        const config = window.ztools.dbStorage.getItem(key)
        if (config) {
          configs.push({ ...config, _configKey: key })
        }
      }
    }
    return configs
  },

  /**
   * 保存单个 IDE 配置
   */
  saveIDEConfig(config) {
    const key = config.code || config._key
    if (!key) throw new Error('缺少 code')
    window.ztools.dbStorage.setItem(key, config)
  },

  /**
   * 删除 IDE 配置
   */
  deleteIDEConfig(code) {
    window.ztools.dbStorage.removeItem(code)
  },

  /**
   * 创建默认 IDE 配置
   * @param {string} code - ide 标识 (如 'vscode', 'cursor')
   * @param {string} command - 可执行命令
   */
  createDefaultIDE(code, command) {
    const appName = code === 'vscode' ? 'Code' : code === 'cursor' ? 'Cursor' : ''
    const dbPath = path.join(
      window.ztools.getPath('appData'),
      appName || code,
      'User',
      'globalStorage',
      'state.vscdb'
    )
    const config = {
      code: code.toLowerCase(),
      icon: '',
      terminal: '',
      command: command || code.toLowerCase(),
      database: dbPath,
      timeout: '10000',
    }
    this.saveIDEConfig(config)
    return config
  },

  /**
   * 解析路径条目
   */
  parsePathEntry(entry) {
    if (typeof entry === 'string') return entry
    return entry.fileUri || entry.folderUri || entry.workspace?.configPath || ''
  },

  /**
   * 生成标准数据库路径（跨平台兼容）
   * 使用 Node.js path 标准库统一处理
   * @param {string} appName - 应用名称（如 Code, Cursor）
   * @returns {string} 标准数据库路径
   */
  createDBPath(appName) {
    // 获取 appData 路径并统一分隔符为正斜杠
    const appDataPath = window.ztools.getPath('appData').replace(/[\\\/]/g, '/')
    // 使用 path.posix.join 统一处理路径（避免 Windows path.join 不处理 / 的问题）
    const relativePath = path.posix.join(appName || 'Code', 'User', 'globalStorage', 'state.vscdb')
    // 组合后统一转换为当前平台分隔符
    return (appDataPath + '/' + relativePath).replace(/\//g, path.sep)
  },

  // ==================== 工具函数 ====================

  /**
   * 执行 shell 命令
   */
  shellExec(cmd, options = {}) {
    return new Promise((resolve, reject) => {
      const { exec } = require('node:child_process')
      const timeout = options.timeout || 10000
      const proc = exec(cmd, { timeout }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message))
        resolve(stdout)
      })
      proc.on('error', (err) => reject(err))
    })
  },

  /**
   * 获取 dbStorage 所有键名（支持前缀过滤）
   */
  getAllDbStorageKeys(prefix) {
    console.log('[services] getAllDbStorageKeys called, prefix:', prefix)
    const db = window.ztools.db
    if (!db || typeof db.allDocs !== 'function') {
      console.warn('[services] db.allDocs not available')
      return []
    }
    try {
      // ZTools API: db.allDocs() 返回 DbDoc[]，使用 _id 作为 key
      const docs = db.allDocs()
      console.log('[services] db.allDocs result:', docs)
      let keys = docs.map((doc) => doc._id).filter(Boolean)
      if (prefix) {
        keys = keys.filter((k) => k.startsWith(prefix))
        console.log('[services] filtered keys:', keys)
      }
      return keys
    } catch (e) {
      console.error('[services] allDocs error:', e)
      return []
    }
  },

  /**
   * 检查目录是否存在
   */
  _dirExists(uri) {
    const fsPath = this._uriToFileSystemPath(uri)
    try {
      return fs.existsSync(fsPath) && fs.statSync(fsPath).isDirectory()
    } catch {
      return false
    }
  },

  /**
   * 获取应用目录
   */
  getPath(dir) {
    return window.ztools.getPath(dir)
  },

  /**
   * 获取连接路径
   */
  getConnectPath() {
    return window.ztools.getConnectPath()
  },
}

// ==================== SQL.js 初始化 ====================

const initSqlJs = require('sql.js')
let _sqlInstance = null
const _sqlInitPromise = (async () => {
  try {
    console.log('[sql.js] __dirname:', __dirname)
    console.log('[sql.js] initSqlJs type:', typeof initSqlJs)
    console.log('[sql.js] sql.js module:', typeof initSqlJs === 'function' ? 'OK' : 'MISSING')

    const fs = require('node:fs')

    // wasm 文件位于 dist/preload/vendor/sqljs/dist/
    const wasmDir = path.join(__dirname, 'vendor', 'sqljs', 'dist')
    const wasmPath = path.join(wasmDir, 'sql-wasm.wasm')
    console.log('[sql.js] wasmDir:', wasmDir)
    console.log('[sql.js] wasm exists:', fs.existsSync(wasmPath))

    if (!fs.existsSync(wasmPath)) {
      // fallback: 尝试从 node_modules 加载
      console.log('[sql.js] trying fallback from node_modules/sql.js')
    }

    const wasmBytes = fs.readFileSync(wasmPath)

    const SQL = await initSqlJs({
      wasmBinary: wasmBytes,
    })
    _sqlInstance = SQL
    return SQL
  } catch (err) {
    console.error('[sql.js] 初始化失败:', err.message)
    console.error('[sql.js] stack:', err.stack)
    throw err
  }
})()

// eslint-disable-next-line no-undef
window.services._initSQL = () => _sqlInitPromise
