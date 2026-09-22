const crypto = require('node:crypto')
const path = require('node:path')
const { DockerImageService } = require('./docker-service')

const SETTINGS_KEY = 'did-tool-settings-v1'
const FALLBACK_SETTINGS_KEY = 'did-tool-settings-encrypted-v1'
const dockerService = new DockerImageService()

/** 判断当前 ZTools 是否提供加密存储。 */
function hasCryptoStorage() {
  return Boolean(
    window.ztools.dbCryptoStorage &&
    typeof window.ztools.dbCryptoStorage.getItem === 'function' &&
    typeof window.ztools.dbCryptoStorage.setItem === 'function'
  )
}

/** 生成旧版 ZTools 本地加密所需的设备密钥。 */
function getFallbackEncryptionKey() {
  const deviceId = typeof window.ztools.getNativeId === 'function'
    ? window.ztools.getNativeId()
    : window.ztools.getPath('userData')
  return crypto.createHash('sha256').update(`did-tool:${deviceId}`).digest()
}

/** 为不支持 dbCryptoStorage 的 ZTools 加密设置。 */
function encryptSettings(settings) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getFallbackEncryptionKey(), iv)
  const content = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()])
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    content: content.toString('base64')
  }
}

/** 解密旧版 ZTools 中保存的设置。 */
function decryptSettings(envelope) {
  if (!envelope || envelope.version !== 1 || !envelope.iv || !envelope.tag || !envelope.content) return null
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getFallbackEncryptionKey(),
      Buffer.from(envelope.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const content = Buffer.concat([
      decipher.update(Buffer.from(envelope.content, 'base64')),
      decipher.final()
    ])
    return JSON.parse(content.toString('utf8'))
  } catch {
    return null
  }
}

/** 获取兼容旧版 ZTools 的普通存储。 */
function getFallbackStorage() {
  const storage = window.ztools.dbStorage
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('当前 ZTools 版本不支持设置存储，请升级 ZTools')
  }
  return storage
}

// 通过 window 对象向渲染进程注入镜像下载能力。
window.services = {
  /** 获取插件默认目录。 */
  getDefaults() {
    return {
      outputDir: path.join(window.ztools.getPath('downloads'), 'did-tool')
    }
  },

  /** 读取插件设置，旧版 ZTools 使用设备密钥解密。 */
  loadSettings() {
    if (hasCryptoStorage()) return window.ztools.dbCryptoStorage.getItem(SETTINGS_KEY) || null
    return decryptSettings(getFallbackStorage().getItem(FALLBACK_SETTINGS_KEY))
  },

  /** 保存插件设置，旧版 ZTools 自动使用 AES-256-GCM 加密。 */
  saveSettings(settings) {
    if (hasCryptoStorage()) {
      window.ztools.dbCryptoStorage.setItem(SETTINGS_KEY, settings)
      return
    }
    getFallbackStorage().setItem(FALLBACK_SETTINGS_KEY, encryptSettings(settings))
  },

  /** 选择镜像包保存目录。 */
  chooseOutputDirectory(defaultPath) {
    const directories = window.ztools.showOpenDialog({
      title: '选择镜像包保存目录',
      defaultPath,
      buttonLabel: '选择此目录',
      properties: ['openDirectory', 'createDirectory']
    })
    return directories?.[0] || null
  },

  /** 解析镜像清单。 */
  inspectImage(options) {
    return dockerService.inspectImage(options)
  },

  /** 创建下载任务。 */
  startDownload(options) {
    return dockerService.startDownload(options)
  },

  /** 获取下载任务进度。 */
  getDownloadTask(taskId) {
    return dockerService.getTask(taskId)
  },

  /** 取消下载任务。 */
  cancelDownloadTask(taskId) {
    return dockerService.cancelTask(taskId)
  },

  /** 在文件管理器中定位生成的镜像包。 */
  showOutputInFolder(filePath) {
    window.ztools.shellShowItemInFolder(filePath)
  }
}
