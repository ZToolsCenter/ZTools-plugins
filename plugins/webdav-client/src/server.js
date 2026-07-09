const http = require('node:http')
const https = require('node:https')
const fs = require('fs')
const { parse, URL } = require('node:url')

const shake = (obj, filter) => {
  if (!filter) {
    filter = (e) => e === undefined
  }
  if (!obj) return {}
  const keys = Object.keys(obj)
  return keys.reduce((acc, key) => {
    if (filter(obj[key])) {
      return acc
    } else {
      acc[key] = obj[key]
      return acc
    }
  }, {})
}

/**
 * 创建服务器
 * @param port {number} 端口号
 * @param successCallback {() => void} 成功回调
 * @param errorCallback {(e: Error) => void} 错误回调
 */
function createServer(port, successCallback, errorCallback) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/preview')) {
      /** @type {string} */
      const imageUrl = parse(req.url, true).query.url
      if (!imageUrl) {
        res.writeHead(400)
        res.end('缺少资源链接参数')
        return
      }
      const link = new URL(imageUrl)

      const clientRequest = (link.protocol.startsWith('https') ? https : http)
        .get(
          link,
          {
            // 设置请求头
            headers: shake({
              // 接收range头，以便支持断点续传
              range: req.headers.range,
              // 接收user-agent头，以便伪装成浏览器
              'user-agent': req.headers['user-agent'],
              // 接收referer头，以便伪装成浏览器
              referer: req.headers.referer,
              // 接收accept-encoding头，以便支持gzip压缩
              'accept-encoding': req.headers['accept-encoding'],
              // 接收accept-language头，以便支持多语言
              'accept-language': req.headers['accept-language'],
              // 接收pragma头，以便支持缓存
              pragma: req.headers.pragma,
              // 接收accept头，以便支持多种类型
              accept: req.headers.accept
            })
          },
          (imageResponse) => {
            // 设置响应头
            res.writeHead(imageResponse.statusCode, imageResponse.headers)

            // 将图片内容转发给客户端
            // imageResponse.pipe(res);

            // 逐步返回
            imageResponse.on('data', (chunk) => {
              res.write(chunk)
            })

            imageResponse.on('end', () => {
              res.end()
            })
          }
        )
        .on('error', (error) => {
          res.writeHead(500)
          res.end(`请求资源链接时出错: ${error.message}`)
        })
      // 断开连接，释放资源
      req.on('close', () => {
        console.log('断开连接，释放资源')
        clientRequest.destroy()
      })
    } else {
      console.log(req.url)
      res.writeHead(404)
      res.end('未找到资源')
    }
  })

  server.listen(port, () => {
    successCallback()
    console.log(
      `服务器已启动，监听端口 ${port}，使用方法：http://localhost:${port}/preview?url=xxx`
    )
  })

  server.on('error', errorCallback)
}

/**
 * 下载文件
 * @param url {string} 下载地址
 * @param path {string} 保存路径
 * @param onProgress {(progress: number, total: number) => void} 下载进度回调
 * @return {Promise<void>} 下载完成
 */
function downloadFile(url, path, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(path)
    const link = new URL(url)
    let totalSize = 0
    let downloadedSize = 0

    file
      .on('finish', function () {
        file.close()
        resolve()
      })
      .on('error', (e) => {
        file.close()
        reject(e)
      })

    ;(link.protocol.startsWith('https') ? https : http)
      .get(link, (response) => {
        totalSize = parseInt(response.headers['content-length'], 10)

        response.on('data', function (chunk) {
          downloadedSize += chunk.length
          onProgress(downloadedSize, totalSize)
        })

        response.on('end', function () {
          onProgress(totalSize, totalSize)
        })

        response.pipe(file)
      })
      .on('error', (error) => {
        reject(error)
      })
  })
}

module.exports = {
  downloadFile,
  createServer
}
