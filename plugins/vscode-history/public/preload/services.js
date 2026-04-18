const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

console.log('[services] preload loaded')

window.services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
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
    function uriToFileSystemPath(uri) {
      if (!uri || typeof uri !== 'string') return uri

      // 处理 file:// URI（VSCode 存储的格式）
      const match = uri.match(/^file:\/\/\/(.+)$/i)
      if (match) {
        let rest = match[1]

        // 移除开头的 /（如果有的话）
        if (rest.startsWith('/')) rest = rest.slice(1)

        // 处理盘符 C: 或 C%3A（VSCode 可能编码冒号为 %3A）
        const driveMatch = rest.match(/^([A-Za-z])(%3[Aa]|:)/i)
        if (driveMatch) {
          let drive = driveMatch[1].toUpperCase()
          let pathPart = rest.slice(driveMatch[0].length)
          // 移除 pathPart 开头的 /
          if (pathPart.startsWith('/')) pathPart = pathPart.slice(1)
          try { pathPart = decodeURIComponent(pathPart.replace(/\//g, '\\')) } catch {}
          return drive + ':' + pathPart
        }

        // 没有盘符
        try { return decodeURIComponent(rest.replace(/\//g, '\\')) } catch {}
        return rest.replace(/\//g, '\\')
      }

      // 非 file:// URI
      if (uri.includes('/')) {
        try { return decodeURIComponent(uri).replace(/\//g, '\\') } catch {}
      }
      return uri
    }

    const kept = []
    for (const p of paths) {
      const fsPath = uriToFileSystemPath(p)
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
    function uriToFileSystemPath(uri) {
      if (!uri || typeof uri !== 'string') return uri
      const match = uri.match(/^file:\/\/\/([A-Za-z]:)?(\/.*)?$/)
      if (match) {
        const drive = match[1] || ''
        const pathPart = match[2] || ''
        return drive + (pathPart.startsWith('/') ? pathPart.slice(1) : pathPart)
      }
      return uri
    }
    const normalizedTarget = uriToFileSystemPath(targetPath)
    const originalLength = data.entries.length
    data.entries = data.entries.filter((entry) => {
      if (typeof entry === 'string') return entry !== normalizedTarget
      const entryPath = entry.fileUri || entry.folderUri || entry.workspace?.configPath
      return uriToFileSystemPath(entryPath) !== normalizedTarget
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
    fs.writeFileSync(dbPath, db.export())
    db.close()
    return true
  },

  /**
   * 批量删除 VSCode 历史记录
   * @param {string} dbPath - state.vscdb 数据库路径
   * @param {string[]} targetPaths - 要删除的项目路径数组
   * @returns {Promise<number>} 删除成功的记录数
   */
  async deleteMultipleVSCodeHistory(dbPath, targetPaths) {
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
    function uriToFileSystemPath(uri) {
      if (!uri || typeof uri !== 'string') return uri
      const match = uri.match(/^file:\/\/\/([A-Za-z]:)?(\/.*)?$/)
      if (match) {
        const drive = match[1] || ''
        const pathPart = match[2] || ''
        return drive + (pathPart.startsWith('/') ? pathPart.slice(1) : pathPart)
      }
      return uri
    }
    const normalizedTargets = targetPaths.map(uriToFileSystemPath)
    const originalLength = data.entries.length
    data.entries = data.entries.filter((entry) => {
      if (typeof entry === 'string') return !normalizedTargets.includes(entry)
      const entryPath = entry.fileUri || entry.folderUri || entry.workspace?.configPath
      return !normalizedTargets.includes(uriToFileSystemPath(entryPath))
    })

    const deletedCount = originalLength - data.entries.length
    if (deletedCount > 0) {
      const updatedJson = JSON.stringify(data)
      db.run(
        "UPDATE ItemTable SET value = ? WHERE key = 'history.recentlyOpenedPathsList'",
        [updatedJson]
      )
      fs.writeFileSync(dbPath, db.export())
    }
    db.close()
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
      timeout: '3000',
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

  // ==================== 工具函数 ====================

  /**
   * 执行 shell 命令
   */
  shellExec(cmd, options = {}) {
    return new Promise((resolve, reject) => {
      const { exec } = require('node:child_process')
      const timeout = options.timeout || 30000
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

let _sqlInstance = null
const _sqlInitPromise = (async () => {
  try {
    const initSqlJs = require('sql.js')
    const fs = require('node:fs')

    // wasm 文件位于 dist/preload/vendor/sqljs/dist/
    const wasmDir = path.join(__dirname, 'vendor', 'sqljs', 'dist')
    const wasmPath = path.join(wasmDir, 'sql-wasm.wasm')
    const wasmBytes = fs.readFileSync(wasmPath)

    const SQL = await initSqlJs({
      wasmBinary: wasmBytes,
    })
    _sqlInstance = SQL
    return SQL
  } catch (err) {
    console.error('SQL.js 初始化失败:', err)
    throw err
  }
})()

// eslint-disable-next-line no-undef
window.services._initSQL = () => _sqlInitPromise
