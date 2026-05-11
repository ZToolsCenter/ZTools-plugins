import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import http from 'http'
import https from 'https'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'cors-proxy',
      configureServer(server) {
        server.middlewares.use('/__cors_proxy', (req, res) => {
          try {
            const targetUrl = req.headers['x-target-url']
            if (!targetUrl || typeof targetUrl !== 'string') {
              res.statusCode = 400
              return res.end('Missing x-target-url header')
            }
            
            const parsed = new URL(targetUrl)
            
            // Clean up headers
            delete req.headers['x-target-url']
            delete req.headers.host
            delete req.headers.origin
            delete req.headers.referer
            
            const client = parsed.protocol === 'https:' ? https : http
            const proxyReq = client.request(targetUrl, {
              method: req.method,
              headers: { ...req.headers, host: parsed.host },
              rejectUnauthorized: false
            }, (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
              proxyRes.pipe(res, { end: true })
            })
            
            proxyReq.on('error', (err) => {
              console.error('Proxy Error:', err)
              res.statusCode = 502
              res.end('Proxy Error: ' + err.message)
            })
            
            req.pipe(proxyReq, { end: true })
          } catch (err) {
            console.error('Proxy Exception:', err)
            res.statusCode = 500
            res.end('Internal Proxy Error')
          }
        })
      }
    }
  ],
  base: './'
})
