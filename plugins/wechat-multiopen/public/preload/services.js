const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DB_KEY = 'wechat-multiopen-config'

const DEFAULT_WECHAT_PATHS = [
  'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe',
  'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe',
  'C:\\Program Files (x86)\\Tencent\\Weixin\\Weixin.exe',
  'C:\\Program Files (x86)\\Tencent\\WeChat\\WeChat.exe'
]

function isFile(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()
  } catch (_error) {
    return false
  }
}

function isDirectory(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
  } catch (_error) {
    return false
  }
}

function findWeChatInDirectory(dirPath) {
  if (!isDirectory(dirPath)) return ''

  const directMatch = ['Weixin.exe', 'WeChat.exe']
    .map((fileName) => path.join(dirPath, fileName))
    .find(isFile)
  if (directMatch) return directMatch

  try {
    const childDirs = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dirPath, entry.name))

    for (const childDir of childDirs) {
      const childMatch = ['Weixin.exe', 'WeChat.exe']
        .map((fileName) => path.join(childDir, fileName))
        .find(isFile)
      if (childMatch) return childMatch
    }
  } catch (_error) {
    return ''
  }

  return ''
}

function resolveWeChatPath(inputPath) {
  const rawPath = typeof inputPath === 'string' ? inputPath.trim() : ''
  if (!rawPath) return ''
  if (isFile(rawPath)) return rawPath
  return findWeChatInDirectory(rawPath)
}

function normalizeCount(value) {
  const count = Math.floor(Number(value))
  if (!Number.isFinite(count)) return 2
  return Math.max(1, Math.min(count, 20))
}

function readConfig() {
  try {
    const config = window.ztools.dbStorage.getItem(DB_KEY)
    if (!config || typeof config !== 'object') return {}
    return config
  } catch (_error) {
    return {}
  }
}

function saveConfig(config) {
  const wechatPath = resolveWeChatPath(config.wechatPath)
  if (config.wechatPath && !wechatPath) {
    throw new Error('请选择 Weixin.exe 或 WeChat.exe。')
  }

  const nextConfig = {
    wechatPath,
    count: normalizeCount(config.count)
  }
  window.ztools.dbStorage.setItem(DB_KEY, nextConfig)
  return nextConfig
}

function findWeChatPath() {
  const config = readConfig()
  const savedPath = resolveWeChatPath(config.wechatPath)
  if (savedPath) return savedPath
  return DEFAULT_WECHAT_PATHS.find(isFile) || ''
}

function spawnWeChat(wechatPath) {
  const child = spawn(wechatPath, [], {
    cwd: path.dirname(wechatPath),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
  return child.pid
}

function launchWeChat(count, customPath) {
  if (process.platform !== 'win32') {
    throw new Error('微信多开目前只支持 Windows。')
  }

  const launchCount = normalizeCount(count)
  const wechatPath = resolveWeChatPath(customPath) || findWeChatPath()

  if (!isFile(wechatPath)) {
    const error = '没有找到微信主程序，请在设置里选择 Weixin.exe 或 WeChat.exe。'
    throw new Error(error)
  }

  for (let index = 0; index < launchCount; index += 1) {
    spawnWeChat(wechatPath)
  }

  saveConfig({ wechatPath, count: launchCount })
  return { wechatPath, count: launchCount }
}

function pickWeChatPath() {
  const files = window.ztools.showOpenDialog({
    title: '选择 Weixin.exe / WeChat.exe',
    properties: ['openFile'],
    filters: [{ name: 'Weixin.exe / WeChat.exe', extensions: ['exe'] }]
  })

  const selectedPath = Array.isArray(files) ? files[0] || '' : ''
  const selectedName = path.basename(selectedPath).toLowerCase()
  const resolvedPath = ['weixin.exe', 'wechat.exe'].includes(selectedName) ? selectedPath : ''

  if (selectedPath && !resolvedPath) {
    throw new Error('请选择微信主程序 Weixin.exe 或 WeChat.exe。')
  }

  return resolvedPath
}

function notify(message) {
  try {
    window.ztools.showNotification(message)
  } catch (_error) {
    // Notification errors are non-critical.
  }
}

window.services = {
  findWeChatPath,
  launchWeChat,
  notify,
  pickWeChatPath,
  readConfig,
  saveConfig
}
