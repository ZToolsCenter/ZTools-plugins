const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const https = require('node:https')

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
  writeBinaryFile(payload) {
    const safeName = String(payload.fileName || Date.now().toString()).replace(/[\\/:*?"<>|]/g, '_')
    const filePath = path.join(window.ztools.getPath('downloads'), safeName)
    fs.writeFileSync(filePath, payload.base64, { encoding: 'base64' })
    return filePath
  },
  sendHttpRequest(options) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now()
      const target = new URL(options.url)
      const client = target.protocol === 'http:' ? http : https
      const headers = options.headers || {}
      const body = options.bodyBase64 ? Buffer.from(options.bodyBase64, 'base64') : options.body || ''
      const request = client.request(
        {
          method: options.method || 'GET',
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          headers,
          timeout: options.timeoutMs || 30000,
          rejectUnauthorized: options.insecure ? false : undefined
        },
        (response) => {
          const chunks = []
          response.on('data', (chunk) => chunks.push(chunk))
          response.on('end', () => {
            const buffer = Buffer.concat(chunks)
            const responseHeaders = Object.entries(response.headers).flatMap(([key, value]) => {
              if (Array.isArray(value)) {
                return value.map((item) => ({ key, value: item }))
              }
              return [{ key, value: String(value ?? '') }]
            })
            resolve({
              status: response.statusCode || 0,
              statusText: response.statusMessage || '',
              duration: Date.now() - startedAt,
              size: buffer.length,
              headers: responseHeaders,
              contentType: String(response.headers['content-type'] || ''),
              body: isTextResponse(response.headers) ? buffer.toString('utf8') : '',
              bodyBase64: buffer.toString('base64')
            })
          })
        }
      )

      request.on('timeout', () => {
        request.destroy(new Error('请求超时'))
      })
      request.on('error', reject)

      if (body && !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) {
        request.write(body)
      }
      request.end()
    })
  }
}

function isTextResponse(headers) {
  const contentType = String(headers['content-type'] || '').toLowerCase()
  return (
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('javascript') ||
    contentType.includes('form-urlencoded')
  )
}
