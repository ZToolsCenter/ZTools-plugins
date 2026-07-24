const { Buffer } = require('node:buffer')
const os = require('node:os')

// 确保全局可用（某些依赖库直接读取 global.Buffer）
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}

const fs = require('node:fs')
const { createHash } = require('node:crypto')
const path = require('node:path')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  getSystemInfo() {
    const platform = os.platform()
    return {
      platform: platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux',
    }
  },

  getThemeInfo() {
    return window.ztools.getThemeInfo()
  },

  onThemeChange(callback) {
    window.ztools.onThemeChange(callback)
  },
  // ===== 文件系统能力 =====

  /**
   * 读取文件内容
   */
  readFile(filePath, encoding = 'utf-8') {
    console.log('[Preload] readFile:', filePath)
    const content = fs.readFileSync(filePath, encoding)
    console.log('[Preload] readFile complete, size:', content.length)
    return content
  },

  /**
   * 以二进制方式读取文件内容
   */
  readBinaryFile(filePath) {
    console.log('[Preload] readBinaryFile:', filePath)
    const content = fs.readFileSync(filePath)
    console.log('[Preload] readBinaryFile complete, size:', content.byteLength)
    return content
  },

  /**
   * 写入文件
   */
  writeFile(filePath, content) {
    console.log('[Preload] writeFile:', filePath, 'size:', content.length)
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      console.log('[Preload] Creating directory:', dir)
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log('[Preload] writeFile complete')
  },

  /**
   * 计算文件 hash
   */
  async computeFileHash(filePath, algorithm = 'sha256') {
    console.log('[Preload] computeFileHash:', { filePath, algorithm })

    if (algorithm !== 'sha256') {
      throw new Error(`不支持的 hash 算法: ${algorithm}`)
    }

    return new Promise((resolve, reject) => {
      const hash = createHash(algorithm)
      const stream = fs.createReadStream(filePath)

      stream.on('error', reject)
      stream.on('data', chunk => hash.update(chunk))
      stream.on('end', () => {
        const digest = hash.digest('hex')
        console.log('[Preload] computeFileHash complete:', { filePath, algorithm, digest })
        resolve(digest)
      })
    })
  },

  /**
   * 检查路径是否存在
   */
  exists(p) {
    const result = fs.existsSync(p)
    console.log('[Preload] exists:', p, '=>', result)
    return result
  },

  /** path 工具 */
  path,

  /**
   * 重命名文件或目录
   */
  rename(oldPath, newPath) {
    console.log('[Preload] rename:', oldPath, '->', newPath)
    fs.renameSync(oldPath, newPath)
    console.log('[Preload] rename complete')
  },

  /**
   * 递归删除目录
   */
  removeDirectory(dirPath) {
    console.log('[Preload] removeDirectory:', dirPath)
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true })
      console.log('[Preload] removeDirectory complete')
    } else {
      console.log('[Preload] removeDirectory: path does not exist')
    }
  },

  /**
   * 删除文件
   */
  removeFile(filePath) {
    console.log('[Preload] removeFile:', filePath)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log('[Preload] removeFile complete')
    } else {
      console.log('[Preload] removeFile: file does not exist')
    }
  },

  /**
   * 复制文件
   */
  copyFile(src, dest) {
    console.log('[Preload] copyFile:', src, '->', dest)
    fs.copyFileSync(src, dest)
    console.log('[Preload] copyFile complete')
  },

  /**
   * 递归复制目录
   */
  copyDirectory(src, dest) {
    console.log('[Preload] copyDirectory:', src, '->', dest)
    fs.cpSync(src, dest, { recursive: true })
    console.log('[Preload] copyDirectory complete')
  },
}


window.ztools.setExpendHeight(600)