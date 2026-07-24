const fs = require('node:fs')
const path = require('node:path')
const https = require('node:https')
const http = require('node:http')
const FormData = require('form-data')

const MAX_REDIRECTS = 5

function requestWithRedirect(url, maxRedirects = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http
    
    protocol.get(url, (response) => {
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
        
        response.destroy()
        
        const redirectUrl = location.startsWith('http') ? location : new URL(location, url).href
        
        requestWithRedirect(redirectUrl, maxRedirects - 1)
          .then(resolve)
          .catch(reject)
        return
      }
      
      resolve(response)
    }).on('error', (error) => {
      reject(error)
    })
  })
}

window.services = {
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  
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
  
  downloadFile (url, options) {
    return new Promise((resolve, reject) => {
      let savePath, onProgress;
      if (typeof options === 'string') {
        savePath = options;
        onProgress = null;
      } else {
        savePath = options?.savePath;
        onProgress = options?.onProgress;
      }
      
      const filePath = savePath || path.join(window.ztools.getPath('downloads'), path.basename(url))
      
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      const file = fs.createWriteStream(filePath)
      
      requestWithRedirect(url)
        .then((response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`请求失败: ${response.statusCode}`))
            file.close()
            return
          }
          
          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloadedSize = 0;
          const hasContentLength = response.headers['content-length'] !== undefined;
          
          response.on('data', (chunk) => {
            downloadedSize += chunk.length;
            
            if (typeof onProgress === 'function') {
              if (hasContentLength && totalSize > 0) {
                const progress = Math.round((downloadedSize / totalSize) * 100);
                onProgress(progress);
              } else {
                const estimatedProgress = Math.min(99, Math.round((downloadedSize / (1024 * 1024)) * 10));
                onProgress(estimatedProgress);
              }
            }
          });
          
          response.pipe(file)
          
          file.on('finish', () => {
            file.close()
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
  
  batchSaveMarkdownFiles (files) {
    const results = []
    const baseDir = path.join(window.ztools.getPath('downloads'), `markdown_batch_${Date.now()}`)
    
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
  
  fileExists (filePath) {
    return fs.existsSync(filePath)
  },
  
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
  },
  
  uploadToPicList(file, config) {
    return new Promise((resolve, reject) => {
      const protocol = config.useHttps ? https : http
      const url = `${config.useHttps ? 'https' : 'http'}://${config.host}:${config.port}/upload`
      const form = new FormData()
      form.append('file', fs.createReadStream(file.path || file), {
        filename: file.name,
        contentType: file.type || 'image/jpeg'
      })
      
      const headers = form.getHeaders()
      if (config.apiKey) {
        url+=`?key=${config.apiKey}`
      }
      
      const request = protocol.request(url, {
        method: 'POST',
        headers: headers
      }, (response) => {
        let data = ''
        response.on('data', (chunk) => {
          data += chunk
        })
        
        response.on('end', () => {
          try {
            const result = JSON.parse(data)
            
            if (response.statusCode === 200 && result.success) {
              resolve({
                success: true,
                url: result.url || result.data?.url || '',
                message: '上传成功'
              })
            } else {
              resolve({
                success: false,
                message: result.message || '上传失败'
              })
            }
          } catch (error) {
            if (response.statusCode === 200) {
              resolve({
                success: true,
                url: data.trim() || '',
                message: '上传成功'
              })
            } else {
              resolve({
                success: false,
                message: `HTTP ${response.statusCode}: ${data.slice(0, 100)}`
              })
            }
          }
        })
      })
      
      request.on('error', (error) => {
        reject(new Error(`上传失败: ${error.message}`))
      })
      
      form.pipe(request)
    })
  }
}