const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const DEFAULT_PORT = 32123
const WS_PORT_OFFSET = 1
const WS_READY_STATE_OPEN = 1
const CONFIG_PATH = path.join(os.homedir(), '.ztools-swap-file.json')

let _nodeIdSeq = 0

// 配置持久化
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch {}
  return {}
}

function saveConfig(updates) {
  try {
    const config = { ...loadConfig(), ...updates }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save config:', err)
  }
}

// Fastify server instance
let server = null
let _uploadDir = null
let wsServer = null
let fileTree = []

// WebSocket 客户端集合
const wsClients = new Set()

/** 广播消息到所有 WebSocket 客户端 */
function broadcast(type, data) {
  wsClients.forEach(client => {
    if (client.readyState === WS_READY_STATE_OPEN) {
      client.send(JSON.stringify({ type, data }))
    }
  })
}

/** 检查 IP 是否为私有地址（局域网或 localhost） */
function isPrivateIP(ip) {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true
  if (ip.startsWith('172.')) {
    const secondOctet = parseInt(ip.split('.')[1], 10)
    if (secondOctet >= 16 && secondOctet <= 31) return true
  }
  return false
}

/** 获取所有局域网 IP 地址 */
function getLanIP() {
  const interfaces = os.networkInterfaces()
  const lanIPs = []

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && isPrivateIP(iface.address)) {
        lanIPs.push(iface.address)
      }
    }
  }

  return lanIPs.length > 0 ? lanIPs : ['127.0.0.1']
}

/**
 * 构造文件节点对象
 * @param {string} fullPath 文件系统绝对路径
 * @param {string} relativePath 相对路径（用于 API）
 * @param {fs.Stats} stats 文件状态
 * @param {boolean} isDir 是否为目录
 */
function createFileNode(fullPath, relativePath, stats, isDir) {
  const name = path.basename(fullPath)
  return {
    id: `node_${++_nodeIdSeq}`,
    name,
    path: relativePath || name,
    fullPath,
    size: isDir ? 0 : stats.size,
    type: isDir ? 'folder' : 'file',
    mtime: stats.mtimeMs,
    ...(isDir ? { children: null } : {})
  }
}

/** 构造服务器状态响应对象 */
function buildServerStatus(port, lanIP) {
  return {
    running: true,
    port,
    lanIP,
    accessUrl: `http://${lanIP}:${port}`
  }
}

/** 递归扫描目录，返回一级子项列表 */
function scanDirRecursive(dirPath, relativePath = '') {
  const items = []
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      const relPath = relativePath ? relativePath + '/' + entry.name : entry.name

      try {
        const stats = fs.statSync(fullPath)
        items.push(createFileNode(fullPath, relPath, stats, entry.isDirectory()))
      } catch (err) {
        console.error(`无法访问 ${fullPath}:`, err.message)
      }
    }
  } catch (err) {
    console.error(`无法读取目录 ${dirPath}:`, err.message)
  }

  return items
}

/** 在文件树中递归查找指定 path 的节点 */
function findNodeByPath(tree, targetPath) {
  for (const item of tree) {
    if (item.path === targetPath) return item
    if (item.children) {
      const found = findNodeByPath(item.children, targetPath)
      if (found) return found
    }
  }
  return null
}

/** 从路径列表构建文件树根节点 */
function buildFileTree(paths) {
  const tree = []

  for (const item of paths) {
    try {
      const stats = fs.statSync(item)
      tree.push(createFileNode(item, path.basename(item), stats, stats.isDirectory()))
    } catch (err) {
      console.error(`无法访问 ${item}:`, err.message)
    }
  }

  return tree
}

/** 获取上传保存目录 */
function getUploadDir() {
  if (!_uploadDir) {
    const config = loadConfig()
    _uploadDir = config.uploadDir || path.join(os.tmpdir(), 'SwapFile')
  }
  if (!fs.existsSync(_uploadDir)) {
    fs.mkdirSync(_uploadDir, { recursive: true })
  }
  return _uploadDir
}

/** 生成不重名的文件路径 */
function getUniqueFilePath(dir, originalName) {
  let filePath = path.join(dir, originalName)
  if (!fs.existsSync(filePath)) return filePath

  const ext = path.extname(originalName)
  const base = path.basename(originalName, ext)
  let counter = 1
  while (fs.existsSync(filePath)) {
    filePath = path.join(dir, `${base} (${counter})${ext}`)
    counter++
  }
  return filePath
}

/** 创建并配置 Fastify 实例 */
function createFastifyApp() {
  const fastify = require('fastify')({ logger: false })
  const fastifyCors = require('@fastify/cors')
  const fastifyMultipart = require('@fastify/multipart')

  fastify.register(fastifyCors, { origin: true })
  fastify.register(fastifyMultipart, {
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB
  })

  fastify.addHook('onRequest', async (request, reply) => {
    const clientIP = request.ip || request.headers['x-forwarded-for']?.split(',')[0] || '127.0.0.1'
    if (!isPrivateIP(clientIP)) {
      reply.code(403).send({ error: 'Access denied: LAN access only' })
      return reply
    }
  })

  return fastify
}

/** 注册所有 API 路由到 Fastify 实例 */
function registerRoutes(fastify, currentFileTree, lanIP, port) {
  fastify.get('/api/status', async () => {
    return { ...buildServerStatus(port, lanIP), fileCount: currentFileTree.length }
  })

  fastify.get('/api/files', async (request) => {
    const dirPath = request.query.path
    if (!dirPath) return { files: currentFileTree }

    const item = findNodeByPath(currentFileTree, dirPath)
    if (item && item.type === 'folder') {
      if (!item.children) {
        item.children = scanDirRecursive(item.fullPath, item.path)
      }
      return { files: item.children }
    }

    return { files: [] }
  })

  fastify.get('/download/*', async (request, reply) => {
    const filePath = request.params['*']
    const item = findNodeByPath(currentFileTree, filePath)

    if (item && item.fullPath) {
      const ext = path.extname(item.fullPath).toLowerCase()
      const mimeType = getMimeType(ext)

      reply.header('Content-Type', mimeType)
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(item.name)}"`)
      return fs.createReadStream(item.fullPath)
    }

    reply.code(404).send({ error: 'File not found' })
  })

  fastify.post('/api/match', async (request) => {
    const { keyword } = request.body || {}
    if (!keyword) return { matches: [] }
    return { matches: matchFilesInTree(currentFileTree, keyword.toLowerCase()) }
  })

  fastify.post('/api/upload', async (request, reply) => {
    try {
      const file = await request.file()
      if (!file) {
        reply.code(400).send({ success: false, error: '没有选择文件' })
        return
      }

      const uploadDir = getUploadDir()
      const savePath = getUniqueFilePath(uploadDir, file.filename)
      const writeStream = fs.createWriteStream(savePath)

      await new Promise((resolve, reject) => {
        file.file.pipe(writeStream)
        file.file.on('error', reject)
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })

      const stats = fs.statSync(savePath)
      const savedName = path.basename(savePath)

      broadcast('file:uploaded', { name: savedName, size: stats.size, path: savePath })

      return { success: true, name: savedName, size: stats.size }
    } catch (err) {
      console.error('Upload error:', err)
      reply.code(500).send({ success: false, error: err.message })
    }
  })

  // 静态文件服务（Web 页面）
  const webPath = path.join(__dirname, '..', 'web')
  if (fs.existsSync(webPath)) {
    const fastifyStatic = require('@fastify/static')
    fastify.register(fastifyStatic, { root: webPath, prefix: '/' })
  }
}

/** 创建 WebSocket 服务器并处理连接 */
function setupWebSocket(port, currentFileTree, lanIP) {
  const WebSocket = require('ws')
  const wss = new WebSocket.Server({ port: port + WS_PORT_OFFSET })

  wss.on('connection', (ws) => {
    wsClients.add(ws)

    broadcast('server:status', buildServerStatus(port, lanIP))

    ws.on('close', () => {
      wsClients.delete(ws)
    })

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message)

        if (data.type === 'scan:directory') {
          const results = scanDirRecursive(data.path, data.relativePath || '')
          ws.send(JSON.stringify({ type: 'scan:result', data: results }))
        } else if (data.type === 'match:files' && data.keyword) {
          const results = matchFilesInTree(currentFileTree, data.keyword.toLowerCase())
          broadcast('match:result', results)
        }
      } catch (err) {
        console.error('WebSocket message error:', err)
      }
    })
  })

  wss.on('error', (err) => {
    console.error('WebSocket server error:', err)
  })

  return wss
}

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // ========== 原有服务 ==========
  readFile(file) {
    if (!fs.existsSync(file)) {
      throw new Error(`文件不存在: ${file}`)
    }
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },

  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },

  writeImageFile(base64Url) {
    const matches = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matches) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matches[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matches[0].length), { encoding: 'base64' })
    return filePath
  },

  // ========== 文件分享服务 ==========
  async getLanIP() {
    return getLanIP()
  },

  async getServerStatus() {
    if (!server) return null

    const lanIP = await this.getLanIP()
    return buildServerStatus(server.server.address().port, lanIP)
  },

  /**
   * 启动文件分享服务器
   * @param {number} port HTTP 端口号
   * @param {string[]} sharedFilePaths 要共享的文件/文件夹绝对路径列表
   */
  async startServer(port = DEFAULT_PORT, sharedFilePaths = []) {
    if (server) {
      await this.stopServer()
    }

    fileTree = buildFileTree(sharedFilePaths)
    const lanIP = await this.getLanIP()

    const fastify = createFastifyApp()
    registerRoutes(fastify, fileTree, lanIP, port)

    try {
      await fastify.listen({ port, host: '0.0.0.0' })
      server = fastify
      wsServer = setupWebSocket(port, fileTree, lanIP)

      return buildServerStatus(port, lanIP)
    } catch (err) {
      console.error('Server start error:', err)
      throw err
    }
  },

  async stopServer() {
    try {
      if (wsServer) {
        wsServer.close()
        wsServer = null
      }

      if (server) {
        await server.close()
        server = null
      }

      wsClients.clear()
      fileTree = []
    } catch (err) {
      console.error('Server stop error:', err)
      throw err
    }
  },

  async scanDirectory(dirPath) {
    try {
      const stats = fs.statSync(dirPath)

      if (stats.isFile()) {
        return [createFileNode(dirPath, path.basename(dirPath), stats, false)]
      } else if (stats.isDirectory()) {
        return scanDirRecursive(dirPath)
      }
    } catch (err) {
      console.error(`无法访问 ${dirPath}:`, err.message)
    }

    return []
  },

  async matchFiles(keyword) {
    if (!keyword) return []
    return matchFilesInTree(fileTree, keyword.toLowerCase())
  },

  getUploadDir() {
    return getUploadDir()
  },

  setUploadDir(dir) {
    _uploadDir = dir
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    saveConfig({ uploadDir: dir })
    return dir
  },

  openUploadDir() {
    const dir = getUploadDir()
    const { exec } = require('child_process')
    if (process.platform === 'win32') {
      exec(`explorer "${dir}"`)
    } else if (process.platform === 'darwin') {
      exec(`open "${dir}"`)
    } else {
      exec(`xdg-open "${dir}"`)
    }
  },

  getSelectedIP() {
    const config = loadConfig()
    return config.selectedIP || null
  },

  setSelectedIP(ip) {
    saveConfig({ selectedIP: ip })
  },

  removeSelectedIP() {
    const config = loadConfig()
    delete config.selectedIP
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  }
}

/** 获取 MIME 类型 */
function getMimeType(ext) {
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.zip': 'application/zip',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

/** 在文件树中递归匹配文件 */
function matchFilesInTree(tree, keyword) {
  const results = []

  function search(nodes) {
    for (const node of nodes) {
      if (node.name.toLowerCase().includes(keyword) || node.path.toLowerCase().includes(keyword)) {
        results.push({ ...node })
      }
      if (node.children) {
        search(node.children)
      }
    }
  }

  search(tree)
  return results
}
