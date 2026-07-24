import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import http from 'node:http'
import https from 'node:https'

function curlToolDevProxy() {
  return {
    name: 'curl-tool-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/__curl_tool_proxy', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', async () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            const result = await sendHttpRequest(payload)
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(result))
          } catch (error) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: error?.message || '请求失败' }))
          }
        })
      })
    }
  }
}

function sendHttpRequest(options) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const target = new URL(options.url)
    const client = target.protocol === 'http:' ? http : https
    const body = options.bodyBase64 ? Buffer.from(options.bodyBase64, 'base64') : options.body || ''
    const request = client.request(
      {
        method: options.method || 'GET',
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: options.headers || {},
        timeout: options.timeoutMs || 30000,
        rejectUnauthorized: options.insecure ? false : undefined
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const headers = Object.entries(response.headers).flatMap(([key, value]) => {
            if (Array.isArray(value)) return value.map((item) => ({ key, value: item }))
            return [{ key, value: String(value ?? '') }]
          })
          resolve({
            status: response.statusCode || 0,
            statusText: response.statusMessage || '',
            duration: Date.now() - startedAt,
            size: buffer.length,
            headers,
            contentType: String(response.headers['content-type'] || ''),
            body: isTextResponse(response.headers) ? buffer.toString('utf8') : '',
            bodyBase64: buffer.toString('base64')
          })
        })
      }
    )

    request.on('timeout', () => request.destroy(new Error('请求超时')))
    request.on('error', reject)
    if (body && !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) {
      request.write(body)
    }
    request.end()
  })
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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), curlToolDevProxy()],
  base: './'
})
