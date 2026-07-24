const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const http = require('node:http')

// 最大重定向次数
const MAX_REDIRECTS = 5

// 支持跟随重定向的请求函数
function requestWithRedirect(url, maxRedirects = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    
    protocol.get(url, (response) => {
      // 处理重定向
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        const location = response.headers.location
        
        if (!location) {
          reject(new Error('重定向但缺少 Location 头'))
          return
        }
        
        if (maxRedirects <= 0) {
          reject(new Error('超过最大重定向次数'))
          return
        }
        
        // 关闭当前响应
        response.destroy()
        
        // 处理相对路径
        const redirectUrl = location.startsWith('http') ? location : new URL(location, url).href
        
        // 递归跟随重定向
        requestWithRedirect(redirectUrl, maxRedirects - 1)
          .then(resolve)
          .catch(reject)
        return
      }
      
      // 返回响应
      resolve(response)
    }).on('error', (error) => {
      reject(error)
    })
  })
}

// 通过 window 对象向渲染进程注入 nodejs 能力
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
  
  // 下载文件
  downloadFile (url, options) {
    return new Promise((resolve, reject) => {
      // 解析参数，兼容旧的调用方式
      let savePath, onProgress;
      if (typeof options === 'string') {
        // 旧的调用方式: downloadFile(url, savePath)
        savePath = options;
        onProgress = null;
      } else {
        // 新的调用方式: downloadFile(url, { savePath, onProgress })
        savePath = options?.savePath;
        onProgress = options?.onProgress;
      }
      
      const filePath = savePath || path.join(window.ztools.getPath('downloads'), path.basename(url))
      
      // 确保目录存在
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      const file = fs.createWriteStream(filePath)
      
      // 使用支持重定向的请求函数
      requestWithRedirect(url)
        .then((response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`请求失败: ${response.statusCode}`))
            file.close()
            return
          }
          
          // 获取文件总大小
          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloadedSize = 0;
          
          // 确保即使没有content-length头，也能显示进度
          const hasContentLength = response.headers['content-length'] !== undefined;
          
          // 监听数据传输事件，计算进度
          response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            
            if (typeof onProgress === 'function') {
              if (hasContentLength && totalSize > 0) {
                // 有content-length头，计算精确进度（0-100）
                const progress = Math.round((downloadedSize / totalSize) * 100);
                onProgress(progress);
              } else {
                // 没有content-length头，返回负数表示进度未知，携带已下载字节数
                // 格式：-downloadedSize（负的已下载字节数）
                onProgress(-downloadedSize);
              }
            }
          });
          
          response.pipe(file)
          
          file.on('finish', () => {
            file.close()
            // 下载完成，确保进度显示为100%
            if (typeof onProgress === 'function') {
              onProgress(100);
            }
            resolve(filePath)
          })
        })
        .catch((error) => {
          fs.unlink(filePath, () => {})
          reject(error)
        })
    })
  },
  
  // 批量保存Markdown文件
  batchSaveMarkdownFiles (files) {
    const results = []
    const baseDir = path.join(window.ztools.getPath('downloads'), `markdown_batch_${Date.now()}`)
    
    // 确保基础目录存在
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true })
    }
    
    files.forEach((file, index) => {
      try {
        const safeFileName = file.filename || `document_${index + 1}`
        const fileName = `${safeFileName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '_')}.md`
        const filePath = path.join(baseDir, fileName)
        fs.writeFileSync(filePath, file.content, { encoding: 'utf-8' })
        results.push({ success: true, path: filePath, originalName: file.filename })
      } catch (error) {
        results.push({ success: false, error: error.message, originalName: file.filename })
      }
    })
    
    return { results, baseDir }
  },
  
  // 读取目录下的所有文件
  readDirectoryFiles (dirPath) {
    const results = []
    
    function readDir (dir, relativePath = '') {
      const files = fs.readdirSync(dir)
      
      files.forEach(file => {
        const filePath = path.join(dir, file)
        const stats = fs.statSync(filePath)
        
        if (stats.isDirectory()) {
          readDir(filePath, path.join(relativePath, file))
        } else {
          results.push({
            path: filePath,
            relativePath: path.join(relativePath, file),
            name: file,
            size: stats.size,
            mtime: stats.mtime
          })
        }
      })
    }
    
    readDir(dirPath)
    return results
  },
  
  // 检查文件是否存在
  fileExists (filePath) {
    return fs.existsSync(filePath)
  },
  
  // 获取文件信息
  getFileInfo (filePath) {
    try {
      const stats = fs.statSync(filePath)
      return {
        exists: true,
        size: stats.size,
        mtime: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile()
      }
    } catch (error) {
      return { exists: false, error: error.message }
    }
  }
}