import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.join(__dirname, 'dist')

const PORT = process.env.PORT || 5500

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/__cors_proxy')) {
    handleCorsProxy(req, res)
    return
  }

  let filePath = req.url === '/' ? '/index.html' : req.url
  filePath = path.join(distPath, filePath || '/index.html')

  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(distPath, 'index.html'), (err2, indexData) => {
          if (err2) {
            res.statusCode = 500
            res.end('Internal Server Error')
            return
          }
          res.setHeader('Content-Type', 'text/html')
          res.end(indexData)
        })
        return
      }
      res.statusCode = 500
      res.end('Internal Server Error')
      return
    }

    res.setHeader('Content-Type', contentType)
    res.end(data)
  })
})

function handleCorsProxy(req: http.IncomingMessage, res: http.ServerResponse) {
  const targetUrl = req.headers['x-target-url']

  if (!targetUrl || typeof targetUrl !== 'string') {
    res.statusCode = 400
    res.end('Missing x-target-url header')
    return
  }

  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    res.statusCode = 400
    res.end('Invalid target URL')
    return
  }

  const cleanHeaders = { ...req.headers }
  delete cleanHeaders['x-target-url']
  delete cleanHeaders['host']
  delete cleanHeaders['origin']
  delete cleanHeaders['referer']
  cleanHeaders['host'] = parsed.host

  const client = parsed.protocol === 'https:' ? https : http

  const proxyReq = client.request(targetUrl, {
    method: req.method,
    headers: cleanHeaders,
    rejectUnauthorized: false
  }, (proxyRes) => {
    const headers = { ...proxyRes.headers } as http.OutgoingHttpHeaders
    headers['access-control-allow-origin'] = '*'
    headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD'
    headers['access-control-allow-headers'] = '*'

    res.writeHead(proxyRes.statusCode || 200, headers)
    proxyRes.pipe(res, { end: true })
  })

  proxyReq.on('error', (err) => {
    console.error('Proxy Error:', err.message)
    res.statusCode = 502
    res.end('Proxy Error: ' + err.message)
  })

  req.pipe(proxyReq, { end: true })
}

server.listen(PORT, () => {
  console.log(`\n  ZapAPI Preview Server`)
  console.log(`  Local:   http://localhost:${PORT}`)
  console.log(`  Network: http://127.0.0.1:${PORT}\n`)
  console.log('  Press Ctrl+C to stop\n')
})
